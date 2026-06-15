"""
Sentiment Collector — Multi-metric option/volatility sentiment

由于 CBOE 在 2019 年停止免费发布 daily PCR，我们改用更可靠的
volatility-based sentiment 组合：

1. equity_pcr_archive    : CBOE 2006-2019 历史归档（用于分位数基线）
2. vix_3m_ratio          : VIX/VIX3M 期限结构（< 0.85 = 自满, > 1.0 = 恐慌）
3. vix_level             : VIX 绝对水平
4. vix_change_5d         : VIX 5 日变化（异动检测）
5. skew_index            : CBOE SKEW 尾部风险指数 (^SKEW)

VIX/VIX3M 是机构投资者最常用的情绪代理之一：
- 当远月波动率溢价高（ratio 低），市场极度自满，类似 PCR 极低
- 当近月恐慌（ratio 倒挂 > 1.0），类似 PCR 极高
"""
import io
import logging
from datetime import datetime, timedelta

import numpy as np
import pandas as pd
import requests

from us_market_dashboard.collectors.base import BaseCollector
from us_market_dashboard.config.settings import (
    CBOE_PCR_URL, HTTP_TIMEOUT, CROWDING_LOOKBACK_DAYS,
)
from us_market_dashboard.storage import db

logger = logging.getLogger(__name__)


# 数据新鲜度阈值
STALENESS_DAYS = 30


def _is_fresh(df: pd.DataFrame, source: str, max_age: int = STALENESS_DAYS) -> bool:
    if df is None or df.empty:
        return False
    latest = pd.to_datetime(df["date"]).max()
    age_days = (datetime.utcnow() - latest.to_pydatetime().replace(tzinfo=None)).days
    if age_days > max_age:
        logger.warning(
            f"  ⚠ {source}: stale (latest={latest.date()}, age={age_days} days)"
        )
        return False
    return True


BROWSER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/121.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1",
}


class CBOEPutCallCollector(BaseCollector):
    """
    Multi-metric sentiment collector.
    保留原类名以兼容现有代码，但实际功能扩展为多维度情绪指标。
    """
    name = "sentiment"

    def __init__(self, backfill_period: str = "10y"):
        self.backfill_period = backfill_period

    def _collect(self) -> int:
        total = 0
        # 1. 历史 PCR 归档（一次性写入，建立分位数基线）
        total += self._collect_pcr_archive()

        # 2. VIX 期限结构（核心实时情绪指标）
        total += self._collect_vix_term_structure()

        # 3. VIX 绝对水平 + 动量
        total += self._collect_vix_metrics()

        # 4. SKEW 尾部风险（如果可用）
        total += self._collect_skew()

        return total

    # ============ 1. CBOE 历史 PCR 归档 ============
    def _collect_pcr_archive(self) -> int:
        """
        CBOE 2006-2019 历史 PCR
        虽然停更了，但 13 年历史数据对建立"什么是极端低/高 PCR"的基线非常有价值
        """
        try:
            logger.info(f"Fetching CBOE PCR archive: {CBOE_PCR_URL}")
            resp = requests.get(CBOE_PCR_URL, headers=BROWSER_HEADERS,
                                timeout=HTTP_TIMEOUT)
            if resp.status_code != 200:
                logger.warning(f"  CBOE archive returned {resp.status_code}")
                return 0

            text = resp.text
            lines = text.splitlines()
            header_idx = None
            for i, line in enumerate(lines):
                low = line.lower()
                if "date" in low and ("call" in low or "put" in low or "ratio" in low):
                    header_idx = i
                    break
            if header_idx is None:
                header_idx = 2
            data_text = "\n".join(lines[header_idx:])
            df = pd.read_csv(io.StringIO(data_text))
            df.columns = [c.strip().upper() for c in df.columns]

            date_col = next((c for c in df.columns if "DATE" in c), None)
            ratio_col = next((c for c in df.columns
                              if "P/C" in c or "RATIO" in c or "PCR" in c), None)
            if not date_col or not ratio_col:
                return 0

            df[date_col] = pd.to_datetime(df[date_col], errors="coerce")
            df = df.dropna(subset=[date_col]).sort_values(date_col)
            df["pcr"] = pd.to_numeric(df[ratio_col], errors="coerce")
            df = df.dropna(subset=["pcr"])
            df = df.rename(columns={date_col: "date"})[["date", "pcr"]]

            return self._save(df, "equity_pcr_archive", source="cboe_archive",
                              skip_freshness=True)
        except Exception as e:
            logger.warning(f"  PCR archive failed: {e}")
            return 0

    # ============ 2. VIX 期限结构 (核心实时情绪) ============
    def _collect_vix_term_structure(self) -> int:
        try:
            import yfinance as yf
        except ImportError:
            return 0

        try:
            logger.info("Fetching VIX/VIX3M term structure ...")
            vix = yf.Ticker("^VIX").history(period=self.backfill_period)["Close"]
            vix3m = yf.Ticker("^VIX3M").history(period=self.backfill_period)["Close"]
            if vix.empty or vix3m.empty:
                return 0

            df = pd.concat(
                [vix.rename("vix"), vix3m.rename("vix3m")], axis=1
            ).dropna()
            df = df.reset_index()
            date_col = "Date" if "Date" in df.columns else df.columns[0]
            df["date"] = pd.to_datetime(df[date_col]).dt.tz_localize(None)
            df["pcr"] = df["vix"] / df["vix3m"]   # 复用 pcr 列名作为通用 value
            df = df[["date", "pcr"]].dropna()

            if not _is_fresh(df, "VIX term structure"):
                return 0

            return self._save(df, "vix_3m_ratio", source="yfinance")
        except Exception as e:
            logger.warning(f"  VIX term structure failed: {e}")
            return 0

    # ============ 3. VIX 水平 + 5 日变化 ============
    def _collect_vix_metrics(self) -> int:
        try:
            import yfinance as yf
        except ImportError:
            return 0

        try:
            logger.info("Fetching VIX level + momentum ...")
            vix = yf.Ticker("^VIX").history(period=self.backfill_period)["Close"]
            if vix.empty:
                return 0
            df = vix.reset_index()
            date_col = "Date" if "Date" in df.columns else df.columns[0]
            df["date"] = pd.to_datetime(df[date_col]).dt.tz_localize(None)
            df = df.rename(columns={"Close": "vix_level"})

            # VIX 绝对水平
            level_df = df[["date"]].copy()
            level_df["pcr"] = df["vix_level"]
            n1 = self._save(level_df, "vix_level", source="yfinance")

            # VIX 5 日变化率
            chg_df = df[["date"]].copy()
            chg_df["pcr"] = df["vix_level"].pct_change(5)
            chg_df = chg_df.dropna()
            n2 = self._save(chg_df, "vix_change_5d", source="yfinance")

            return n1 + n2
        except Exception as e:
            logger.warning(f"  VIX metrics failed: {e}")
            return 0

    # ============ 4. SKEW 尾部风险 ============
    def _collect_skew(self) -> int:
        try:
            import yfinance as yf
        except ImportError:
            return 0

        try:
            logger.info("Fetching ^SKEW (CBOE SKEW Index) ...")
            skew = yf.Ticker("^SKEW").history(period=self.backfill_period)["Close"]
            if skew.empty:
                logger.info("  ^SKEW unavailable from yfinance")
                return 0
            df = skew.reset_index()
            date_col = "Date" if "Date" in df.columns else df.columns[0]
            df["date"] = pd.to_datetime(df[date_col]).dt.tz_localize(None)
            df = df.rename(columns={"Close": "pcr"})[["date", "pcr"]].dropna()

            if not _is_fresh(df, "SKEW"):
                return 0
            return self._save(df, "skew_index", source="yfinance")
        except Exception as e:
            logger.warning(f"  SKEW failed: {e}")
            return 0

    # ============ 写库 ============
    def _save(self, df: pd.DataFrame, metric_name: str,
              source: str = "", skip_freshness: bool = False) -> int:
        df = df.copy().sort_values("date").reset_index(drop=True)
        df["ma20"] = df["pcr"].rolling(20).mean()
        df["percentile_750"] = df["pcr"].rolling(
            CROWDING_LOOKBACK_DAYS, min_periods=60
        ).rank(pct=True)

        records = []
        for _, row in df.iterrows():
            records.append({
                "date": pd.to_datetime(row["date"]).strftime("%Y-%m-%d"),
                "metric": metric_name,
                "value": float(row["pcr"]),
                "ma20": float(row["ma20"]) if pd.notna(row["ma20"]) else None,
                "percentile_750": (float(row["percentile_750"])
                                   if pd.notna(row["percentile_750"]) else None),
            })
        n = db.upsert_option_sentiment(records)
        latest = df.iloc[-1] if len(df) else None
        latest_str = (f"latest={latest['pcr']:.3f} on {pd.to_datetime(latest['date']).date()}"
                      if latest is not None else "")
        logger.info(f"  ✓ {metric_name} ({source}) upserted {n} rows {latest_str}")
        return n
