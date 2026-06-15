"""
CTA Signal Analyzer
基于多周期均线突破，构建简化版 CTA 趋势跟踪信号代理

核心逻辑：
  对每个资产，分别计算 20/50/100/200 日均线，每根 MA 给出 +1/-1（取决于价格在 MA 上方还是下方）
  然后取均值得到该资产的 CTA 信号 ∈ [-1, 1]

  注意：这只是一个粗糙代理，真实 CTA 模型还包括：
    - 波动率目标（每个资产按反向波动率加权）
    - 风险平价跨资产合成
    - 突破强度而非简单二元
  这里只提供方向性参考，不要当成精确持仓推断。
"""
import json
import logging

import numpy as np
import pandas as pd

from us_market_dashboard.config.settings import (
    CTA_SIGNAL_ASSETS, CTA_SIGNAL_FALLBACKS, CTA_SIGNAL_WINDOWS,
)
from us_market_dashboard.storage import db

logger = logging.getLogger(__name__)


# 资产分类，用于合成
ASSET_CLASS = {
    "ES": "equity", "NQ": "equity",
    "ZN": "bond",
    "GC": "commodity", "CL": "commodity",
    "DX": "fx",
}


def _load_with_fallback(short_name: str, primary: str) -> pd.Series:
    """
    优先用主 ticker，缺数据或 < 252 天时用 fallback
    返回 close 价 Series
    """
    prices = db.load_prices(primary)["close"] if not db.load_prices(primary).empty else pd.Series(dtype=float)
    if len(prices) >= 252:
        return prices

    fallbacks = CTA_SIGNAL_FALLBACKS.get(short_name, [])
    for fb in fallbacks:
        fb_prices = db.load_prices(fb)["close"] if not db.load_prices(fb).empty else pd.Series(dtype=float)
        if len(fb_prices) >= 252:
            logger.info(f"[{short_name}] using fallback ticker {fb} (primary {primary} insufficient)")
            return fb_prices
    return prices  # 返回原 Series（哪怕短）让上层决定


def compute_signal(prices: pd.Series, windows=None) -> pd.DataFrame:
    """
    返回每天的 CTA 信号
    columns: signal (合成), w20, w50, w100, w200 (各周期单独)
    """
    windows = windows or CTA_SIGNAL_WINDOWS
    df = pd.DataFrame(index=prices.index)
    for w in windows:
        ma = prices.rolling(w).mean()
        df[f"w{w}"] = np.sign(prices - ma)
    df["signal"] = df[[f"w{w}" for w in windows]].mean(axis=1)
    return df


def update_cta_signals() -> int:
    """对所有 CTA 资产计算单标的信号"""
    total = 0
    aggregate_data = {}  # {date: {asset_class: [signal, ...]}}

    for short_name, yf_symbol in CTA_SIGNAL_ASSETS.items():
        prices = _load_with_fallback(short_name, yf_symbol)
        if prices.empty or len(prices) < 60:
            logger.warning(f"[{short_name}/{yf_symbol}] insufficient data ({len(prices)} rows)")
            continue
        sig = compute_signal(prices)
        sig = sig.dropna(subset=["signal"])

        records = []
        for dt, row in sig.iterrows():
            ds = dt.strftime("%Y-%m-%d")
            window_signals = {f"w{w}": float(row[f"w{w}"])
                              for w in CTA_SIGNAL_WINDOWS
                              if pd.notna(row[f"w{w}"])}
            records.append({
                "date": ds,
                "asset": short_name,
                "signal": float(row["signal"]),
                "window_signals": json.dumps(window_signals),
            })
            # 累积到资产类别
            asset_class = ASSET_CLASS.get(short_name)
            if asset_class:
                aggregate_data.setdefault(ds, {}).setdefault(asset_class, []).append(
                    float(row["signal"])
                )

        n = db.upsert_cta_signals(records)
        total += n
        logger.info(f"[{short_name}] CTA signal upserted {n} rows; latest={sig['signal'].iloc[-1]:+.2f}")

    # 资产类别合成
    agg_records = []
    for ds in sorted(aggregate_data):
        classes = aggregate_data[ds]
        eq = np.mean(classes.get("equity", [np.nan]))
        bd = np.mean(classes.get("bond", [np.nan]))
        cm = np.mean(classes.get("commodity", [np.nan]))
        fx = np.mean(classes.get("fx", [np.nan]))
        # 综合信号：风险平价等权
        components = [x for x in [eq, bd, cm, fx] if not np.isnan(x)]
        overall = float(np.mean(components)) if components else None
        agg_records.append({
            "date": ds,
            "equity_signal": float(eq) if not np.isnan(eq) else None,
            "bond_signal": float(bd) if not np.isnan(bd) else None,
            "commodity_signal": float(cm) if not np.isnan(cm) else None,
            "fx_signal": float(fx) if not np.isnan(fx) else None,
            "overall_signal": overall,
        })
    nagg = db.upsert_cta_aggregate(agg_records)
    logger.info(f"CTA aggregate upserted {nagg} rows")
    return total


def latest_cta() -> dict:
    """读取最新的 CTA 单标的 + 综合信号"""
    sql_assets = """
        SELECT asset, date, signal FROM cta_signals c1
        WHERE date = (SELECT MAX(date) FROM cta_signals c2 WHERE c2.asset = c1.asset)
        ORDER BY asset
    """
    sql_agg = """
        SELECT * FROM cta_aggregate ORDER BY date DESC LIMIT 1
    """
    with db.get_conn() as conn:
        assets = pd.read_sql_query(sql_assets, conn)
        agg = pd.read_sql_query(sql_agg, conn)
    return {
        "assets": assets.to_dict(orient="records") if not assets.empty else [],
        "aggregate": agg.iloc[0].to_dict() if not agg.empty else {},
    }
