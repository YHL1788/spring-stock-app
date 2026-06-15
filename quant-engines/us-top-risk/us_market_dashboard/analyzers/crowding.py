"""
Factor Crowding Analyzer
基于 ETF 多空比值，计算因子拥挤度三维合成评分
"""
import logging
from typing import Optional

import numpy as np
import pandas as pd

from us_market_dashboard.config.settings import (
    FACTOR_PROXIES, CROWDING_LOOKBACK_DAYS, MIN_HISTORY_FOR_RANK,
)
from us_market_dashboard.storage import db

logger = logging.getLogger(__name__)


def _rolling_pct_rank(s: pd.Series, window: int) -> pd.Series:
    """滚动分位数（0-1），需要至少 MIN_HISTORY_FOR_RANK 个数据点"""
    return s.rolling(window, min_periods=MIN_HISTORY_FOR_RANK).rank(pct=True)


def calc_factor_crowding(factor_key: str,
                         lookback: int = CROWDING_LOOKBACK_DAYS) -> pd.DataFrame:
    """
    计算单个因子拥挤度时间序列

    三维合成：
      1) 估值/比值维度: long/short 价格比的滚动分位数（高 = 多头跑赢已久）
      2) 收益维度:    多空 60 日累计收益的滚动分位数
      3) 波动率维度:  多空 60 日年化波动率的反向分位数（拥挤期常异常低波）
    最终: 三者算术平均 → crowding_score ∈ [0, 1]
    """
    if factor_key not in FACTOR_PROXIES:
        raise ValueError(f"Unknown factor: {factor_key}")
    cfg = FACTOR_PROXIES[factor_key]
    long_sym, short_sym = cfg["long"], cfg["short"]

    long_px = db.load_prices(long_sym)["close"]
    short_px = db.load_prices(short_sym)["close"]
    if long_px.empty or short_px.empty:
        logger.warning(f"[{factor_key}] missing data: long={len(long_px)}, short={len(short_px)}")
        return pd.DataFrame()

    df = pd.concat([long_px.rename("long"), short_px.rename("short")], axis=1).dropna()
    if len(df) < MIN_HISTORY_FOR_RANK:
        logger.warning(f"[{factor_key}] insufficient history: {len(df)} rows")
        return pd.DataFrame()

    # 1) 比值
    df["ratio"] = df["long"] / df["short"]
    df["ratio_rank"] = _rolling_pct_rank(df["ratio"], lookback)

    # 收益
    df["long_ret"] = df["long"].pct_change()
    df["short_ret"] = df["short"].pct_change()
    df["ls_ret"] = df["long_ret"] - df["short_ret"]

    # 2) 60 日累计多空收益
    df["ret_60d"] = df["ls_ret"].rolling(60).sum()
    df["ret_rank"] = _rolling_pct_rank(df["ret_60d"], lookback)

    # 3) 60 日多空波动率（年化）
    df["vol_60d"] = df["ls_ret"].rolling(60).std() * np.sqrt(252)
    df["vol_rank"] = _rolling_pct_rank(df["vol_60d"], lookback)

    # 合成: 估值高(0.4) + 收益高(0.3) + 波动低(0.3)
    df["crowding_score"] = (
        0.4 * df["ratio_rank"]
        + 0.3 * df["ret_rank"]
        + 0.3 * (1.0 - df["vol_rank"])
    )

    # z-score 也保留一下（更直观看背离）
    mu = df["ratio"].rolling(lookback, min_periods=MIN_HISTORY_FOR_RANK).mean()
    sd = df["ratio"].rolling(lookback, min_periods=MIN_HISTORY_FOR_RANK).std()
    df["zscore"] = (df["ratio"] - mu) / sd

    df["factor"] = factor_key
    return df.dropna(subset=["crowding_score"])


def update_all_factors() -> dict:
    """对所有因子计算并写库"""
    summary = {}
    for key in FACTOR_PROXIES:
        df = calc_factor_crowding(key)
        if df.empty:
            summary[key] = 0
            continue
        records = []
        for dt, row in df.iterrows():
            records.append({
                "factor": key,
                "date": dt.strftime("%Y-%m-%d"),
                "ratio": float(row["ratio"]) if pd.notna(row["ratio"]) else None,
                "ret_60d": float(row["ret_60d"]) if pd.notna(row["ret_60d"]) else None,
                "vol_60d": float(row["vol_60d"]) if pd.notna(row["vol_60d"]) else None,
                "crowding_score": float(row["crowding_score"]),
                "zscore": float(row["zscore"]) if pd.notna(row["zscore"]) else None,
            })
        n = db.upsert_factor_crowding(records)
        summary[key] = n
        logger.info(f"[{key}] crowding upserted {n} rows; latest score={df['crowding_score'].iloc[-1]:.3f}")
    return summary


def latest_snapshot() -> pd.DataFrame:
    """读取每个因子最新一条拥挤度，用于推送"""
    sql = """
        SELECT factor, date, ratio, ret_60d, vol_60d, crowding_score, zscore
        FROM factor_crowding fc1
        WHERE date = (SELECT MAX(date) FROM factor_crowding fc2 WHERE fc2.factor = fc1.factor)
        ORDER BY crowding_score DESC
    """
    with db.get_conn() as conn:
        return pd.read_sql_query(sql, conn)
