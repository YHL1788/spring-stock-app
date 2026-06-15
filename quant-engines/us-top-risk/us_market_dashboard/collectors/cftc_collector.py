"""
CFTC Commitments of Traders (COT) Collector
读取 CFTC 公开金融期货持仓周报，提取 Managed Money（CTA + 宏观对冲）净持仓

URL 命名约定（2026 年实测）:
  fut_fin_xls_{year}.zip     ← 当年有效（用户已验证 200）
  fin_fut_xls_{year}.zip     ← 已废弃 (404)

策略：尝试多个 URL 模板，遇 404 自动回退到上一年
"""
import io
import logging
import zipfile
from datetime import datetime
from typing import Optional

import pandas as pd
import requests

from us_market_dashboard.collectors.base import BaseCollector
from us_market_dashboard.config.settings import HTTP_HEADERS, HTTP_TIMEOUT
from us_market_dashboard.storage import db

logger = logging.getLogger(__name__)


# CFTC 财务期货 (Traders in Financial Futures, TFF) 周报
# 用户实测 2026 年: fut_fin_xls_2026.zip 返回 200，其他 404
CFTC_URL_TEMPLATES = [
    "https://www.cftc.gov/sites/default/files/files/dea/history/fut_fin_xls_{year}.zip",
    "https://www.cftc.gov/sites/default/files/files/dea/history/fin_fut_xls_{year}.zip",
    "https://www.cftc.gov/files/dea/history/fut_fin_xls_{year}.zip",
    "https://www.cftc.gov/files/dea/history/fin_fut_xls_{year}.zip",
]

# Mapping: 我们关心的合约名 -> CFTC 报告中市场名的关键词
CONTRACT_NAME_MAP = {
    "ES": "E-MINI S&P 500",
    "NQ": "NASDAQ-100",
    "YM": "DOW JONES",
    "RTY": "RUSSELL E-MINI",
    "ZN": "10-YEAR U.S. TREASURY",
    "ZB": "U.S. TREASURY BONDS",
    "ZF": "5-YEAR U.S. TREASURY",
    "DX": "U.S. DOLLAR INDEX",
    "VX": "VIX FUTURES",
}

# CFTC TFF 报表里的 Leveraged Money（对冲基金 + CTA）列
# 这是金融期货 TFF 报告的标准命名，比商品 COT 的 Managed Money 更精准
MM_LONG_COLS = [
    "Lev_Money_Positions_Long_All",          # ← TFF 主格式 (2026 年实测)
    "M_Money_Positions_Long_All",            # 商品 COT 旧格式
    "MMoney_Positions_Long_All",
    "Mgr_Long_All",
]
MM_SHORT_COLS = [
    "Lev_Money_Positions_Short_All",         # ← TFF 主格式
    "M_Money_Positions_Short_All",
    "MMoney_Positions_Short_All",
    "Mgr_Short_All",
]
# 备用：Asset Manager 持仓（养老金、共同基金，更慢的资金）
AM_LONG_COLS = ["Asset_Mgr_Positions_Long_All"]
AM_SHORT_COLS = ["Asset_Mgr_Positions_Short_All"]

OI_COLS = ["Open_Interest_All", "OI_All"]
DATE_COLS = [
    "Report_Date_as_MM_DD_YYYY",             # ← TFF 主格式
    "Report_Date_as_YYYY-MM-DD",
    "Report_Date_as_YYYY_MM_DD",
]
MARKET_COLS = ["Market_and_Exchange_Names", "Market_Code",
               "Contract_Market_Name"]


class CFTCCollector(BaseCollector):
    name = "cftc_cot"

    def __init__(self, year: Optional[int] = None,
                 fallback_prev_year: bool = True):
        self.year = year or datetime.utcnow().year
        self.fallback_prev_year = fallback_prev_year

    def _collect(self) -> int:
        df = self._download_year(self.year)
        # 年初的兜底：当年文件还没生成时用上一年
        if (df is None or df.empty) and self.fallback_prev_year:
            logger.warning(
                f"Year {self.year} unavailable, falling back to {self.year - 1}"
            )
            df = self._download_year(self.year - 1)

        if df is None or df.empty:
            logger.error("All CFTC download attempts failed")
            return 0

        logger.info(f"CFTC raw data: {len(df)} rows, {len(df.columns)} cols")
        logger.debug(f"Columns sample: {list(df.columns)[:10]}")

        # 找出实际使用的列名
        market_col = self._find_col(df, MARKET_COLS)
        date_col = self._find_col(df, DATE_COLS)
        lev_long = self._find_col(df, MM_LONG_COLS)
        lev_short = self._find_col(df, MM_SHORT_COLS)
        am_long = self._find_col(df, AM_LONG_COLS)
        am_short = self._find_col(df, AM_SHORT_COLS)
        oi_col = self._find_col(df, OI_COLS)

        if not all([market_col, date_col, lev_long, lev_short]):
            logger.error(
                f"Required columns missing. "
                f"market={market_col}, date={date_col}, "
                f"lev_long={lev_long}, lev_short={lev_short}"
            )
            logger.error(f"Available columns: {list(df.columns)}")
            return 0

        logger.info(
            f"Column mapping: market={market_col}, date={date_col}, "
            f"lev=[{lev_long},{lev_short}], asset_mgr=[{am_long},{am_short}]"
        )

        records = []
        for short_name, market_keyword in CONTRACT_NAME_MAP.items():
            sub = df[df[market_col].astype(str).str.contains(
                market_keyword, case=False, na=False
            )]
            if sub.empty:
                logger.debug(f"No rows matched for {short_name} ({market_keyword})")
                continue

            for _, row in sub.iterrows():
                try:
                    report_dt = pd.to_datetime(row[date_col]).strftime("%Y-%m-%d")
                    oi = int(self._safe_int(row.get(oi_col))) if oi_col else 0

                    # Leveraged Money (Hedge Funds + CTAs) - 主要趋势资金
                    lm_l = int(self._safe_int(row.get(lev_long)))
                    lm_s = int(self._safe_int(row.get(lev_short)))
                    lm_net = lm_l - lm_s
                    records.append({
                        "report_date": report_dt,
                        "contract": short_name,
                        "trader_type": "lev_money",
                        "mm_long": lm_l,
                        "mm_short": lm_s,
                        "mm_net": lm_net,
                        "mm_net_pct_oi": (lm_net / oi) if oi else 0.0,
                    })

                    # Asset Manager (养老金、共同基金) - 机构慢钱
                    if am_long and am_short:
                        am_l = int(self._safe_int(row.get(am_long)))
                        am_s = int(self._safe_int(row.get(am_short)))
                        am_net = am_l - am_s
                        records.append({
                            "report_date": report_dt,
                            "contract": short_name,
                            "trader_type": "asset_mgr",
                            "mm_long": am_l,
                            "mm_short": am_s,
                            "mm_net": am_net,
                            "mm_net_pct_oi": (am_net / oi) if oi else 0.0,
                        })
                except Exception as e:
                    logger.debug(f"Skip row for {short_name}: {e}")

        n = db.upsert_cftc(records)
        contracts_seen = set(r["contract"] for r in records)
        logger.info(
            f"CFTC COT upserted {n} rows ({len(contracts_seen)} contracts × 2 trader types)"
        )
        return n

    def _download_year(self, year: int) -> Optional[pd.DataFrame]:
        """逐个尝试 URL 模板，第一个成功的返回"""
        for template in CFTC_URL_TEMPLATES:
            url = template.format(year=year)
            try:
                logger.info(f"Trying CFTC URL: {url}")
                resp = requests.get(url, headers=HTTP_HEADERS, timeout=HTTP_TIMEOUT)
                if resp.status_code == 404:
                    logger.info(f"  404 - try next")
                    continue
                resp.raise_for_status()

                zf = zipfile.ZipFile(io.BytesIO(resp.content))
                names = zf.namelist()
                logger.info(f"  ✓ archive contains: {names}")

                # 优先 xls/xlsx，回退 csv/txt
                preferred = [n for n in names if n.lower().endswith((".xls", ".xlsx"))]
                fallback = [n for n in names if n.lower().endswith((".csv", ".txt"))]

                for name in preferred + fallback:
                    try:
                        with zf.open(name) as f:
                            if name.lower().endswith((".xls", ".xlsx")):
                                df = pd.read_excel(f)
                            else:
                                df = pd.read_csv(f, low_memory=False)
                        if df is not None and not df.empty:
                            logger.info(f"  ✓ Parsed {name}: {len(df)} rows")
                            return df
                    except Exception as e:
                        logger.warning(f"  Failed parsing {name}: {e}")
                        continue
            except requests.HTTPError as e:
                logger.info(f"  HTTP {e.response.status_code} - try next")
                continue
            except Exception as e:
                logger.warning(f"  Error: {e}")
                continue

        return None

    @staticmethod
    def _find_col(df: pd.DataFrame, candidates) -> Optional[str]:
        """在 df 列中查找第一个匹配的候选名（大小写、空格无关）"""
        norm = {c.lower().strip().replace(" ", ""): c for c in df.columns}
        for cand in candidates:
            if cand in df.columns:
                return cand
            key = cand.lower().strip().replace(" ", "")
            if key in norm:
                return norm[key]
        return None

    @staticmethod
    def _safe_int(val) -> int:
        """安全转换为 int，含 NaN/None/字符串处理"""
        if val is None or pd.isna(val):
            return 0
        if isinstance(val, str):
            val = val.replace(",", "").strip()
            if not val or val == "-":
                return 0
        try:
            return int(float(val))
        except (ValueError, TypeError):
            return 0
