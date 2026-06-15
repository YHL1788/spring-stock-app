"""
Technical Indicators Analyzer
计算偏离均线、RSI、距 52 周高低点等技术指标
"""
import logging
from typing import List

import numpy as np
import pandas as pd

from us_market_dashboard.storage import db

logger = logging.getLogger(__name__)


def deviation_from_ma(prices: pd.Series, window: int = 20) -> pd.Series:
    """偏离移动均线百分比"""
    ma = prices.rolling(window).mean()
    return (prices / ma - 1.0)


def rsi(prices: pd.Series, window: int = 14) -> pd.Series:
    """Wilder RSI"""
    delta = prices.diff()
    up = delta.clip(lower=0)
    down = -delta.clip(upper=0)
    roll_up = up.ewm(alpha=1/window, adjust=False).mean()
    roll_down = down.ewm(alpha=1/window, adjust=False).mean()
    rs = roll_up / roll_down.replace(0, np.nan)
    return 100 - 100 / (1 + rs)


def distance_from_52w_high(prices: pd.Series) -> pd.Series:
    """距 52 周（252 个交易日）最高点的百分比距离"""
    high_52w = prices.rolling(252, min_periods=60).max()
    return (prices / high_52w - 1.0)


def update_technical(symbols: List[str]) -> int:
    """对一批 symbol 计算并写入技术指标"""
    total = 0
    for sym in symbols:
        prices = db.load_prices(sym)["close"]
        if prices.empty:
            logger.warning(f"[{sym}] no price data")
            continue

        dev_ma20 = deviation_from_ma(prices, 20)
        dev_ma50 = deviation_from_ma(prices, 50)
        dev_ma200 = deviation_from_ma(prices, 200)
        rsi14 = rsi(prices, 14)
        dist_52wh = distance_from_52w_high(prices)

        records = []
        for dt in prices.index:
            ds = dt.strftime("%Y-%m-%d")
            for indicator, series in [
                ("dev_ma20", dev_ma20),
                ("dev_ma50", dev_ma50),
                ("dev_ma200", dev_ma200),
                ("rsi14", rsi14),
                ("dist_52w_high", dist_52wh),
            ]:
                v = series.loc[dt]
                if pd.notna(v):
                    records.append({
                        "symbol": sym,
                        "date": ds,
                        "indicator": indicator,
                        "value": float(v),
                    })
        n = db.upsert_technical(records)
        total += n
        logger.info(f"[{sym}] technical indicators upserted {n} rows")
    return total


def latest_indicator(symbol: str, indicator: str) -> dict:
    """读取最新的某一项技术指标"""
    sql = """
        SELECT date, value FROM technical_indicators
        WHERE symbol = ? AND indicator = ?
        ORDER BY date DESC LIMIT 1
    """
    with db.get_conn() as conn:
        cur = conn.execute(sql, (symbol, indicator))
        row = cur.fetchone()
    if row:
        return {"date": row[0], "value": row[1]}
    return {}
