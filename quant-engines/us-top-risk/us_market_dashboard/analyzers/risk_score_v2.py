"""
US Top Risk Score v2 — Direction-Aware Reversal Detection

v1 的失败教训:
  v1 把"高 z-score"等同于"顶部信号"，但在牛市样本期里，
  高 z-score 大多对应"突破延续"而非"反转"。
  回测显示 v1 信号在 2021-2026 期间没有预测力。

v2 的设计原则:
  1. 方向性 (direction): z-score 持续向上 = 动量 (低分)，
     从近期峰值回落 = 反转 (高分)
  2. 多信号同时反转 (confluence): 单个信号极端不算数，
     需要 3 个以上独立信号同时出现见顶迹象
  3. 反向领先指标 (leading): HYG/LQD、IWM/SPY、SOXX/SPY 等
     相对强弱比值的转向，往往领先市场顶部
  4. 信号 hysteresis: 评分需要持续 N 天才升级，避免噪声触发

输出 0-1 评分，但和 v1 的语义不同:
  v2 评分 > 0.7 = "多个独立反转信号同时确认"
  v2 评分 < 0.3 = "正常或动量延续"
"""
import logging
from datetime import date, datetime
from typing import Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

from us_market_dashboard.config.settings import (
    FACTOR_PROXIES, LEADING_INDICATOR_PAIRS,
)
from us_market_dashboard.storage import db

logger = logging.getLogger(__name__)


# ============ 工具函数 ============

def _peak_distance(series: pd.Series, lookback: int = 30) -> pd.Series:
    """
    返回每个时点距 lookback 内最高点的"距离"
    > 0: 当前在峰值，> 0 但绝对值小
    < 0: 当前已从峰值回落
    用于检测"已见顶并回落"
    """
    peak = series.rolling(lookback, min_periods=5).max()
    return series - peak


def _rolling_pct_rank(s: pd.Series, window: int) -> pd.Series:
    """滚动分位数（0-1），点位时间序列"""
    return s.rolling(window, min_periods=60).rank(pct=True)


# ============ 子信号 1: 因子拥挤度反转 ============

def factor_reversal_signal(lookback_peak: int = 20) -> pd.Series:
    """
    检测因子 z-score 是否"已见顶并开始回落"
    返回 0-1 时间序列：每个时点的"反转强度"
    
    高分条件:
      - 至少 1 个因子近期 |z| > 2.0 (曾极端)
      - 该因子 z-score 已从近 N 日峰值回落 > 0.5σ
      - 加分: 多个因子同时反转
    """
    sql = """
        SELECT date, factor, zscore FROM factor_crowding ORDER BY date
    """
    with db.get_conn() as conn:
        df = pd.read_sql_query(sql, conn, parse_dates=["date"])
    if df.empty:
        return pd.Series(dtype=float)

    z_wide = df.pivot(index="date", columns="factor", values="zscore")
    score = pd.Series(0.0, index=z_wide.index)

    for fac in z_wide.columns:
        z = z_wide[fac]
        z_peak = z.rolling(lookback_peak, min_periods=5).max()
        z_trough = z.rolling(lookback_peak, min_periods=5).min()
        # "之前曾极端 + 现在已回落"
        was_extreme_high = z_peak > 2.0
        is_falling = (z_peak - z) > 0.5  # 从峰值跌落 > 0.5σ
        was_extreme_low = z_trough < -2.0
        is_rising = (z - z_trough) > 0.5

        # 上方反转（顶部信号）+1, 下方反转（底部信号）+0.5（不是我们要的）
        # 我们只关心顶部，底部触底也是一个信号但权重低
        top_reversal = (was_extreme_high & is_falling).astype(float)
        bottom_reversal = (was_extreme_low & is_rising).astype(float) * 0.3

        # 信号强度：z 离峰值的距离 + 是否极端
        intensity = ((z_peak - z).clip(0, 2) / 2.0) * top_reversal
        score = score.add(intensity, fill_value=0)

    # 归一化到 [0, 1]，3 个以上因子同时反转 = 满分
    score = (score / 3.0).clip(0, 1)
    return score


# ============ 子信号 2: SOX 反转 ============

def sox_reversal_signal() -> pd.Series:
    """
    SOX 偏离 20MA 的"见顶迹象"
    高分条件:
      - 近 30 天内偏离曾 > 12%
      - 当前已从 30 日峰值回落 > 30% (绝对值)
    """
    sql = """
        SELECT date, value FROM technical_indicators
        WHERE symbol='^SOX' AND indicator='dev_ma20' ORDER BY date
    """
    with db.get_conn() as conn:
        df = pd.read_sql_query(sql, conn, parse_dates=["date"])
    if df.empty:
        return pd.Series(dtype=float)
    s = df.set_index("date")["value"]

    peak_30d = s.rolling(30, min_periods=5).max()
    # 条件 1: 30 日内峰值 > 0.12
    was_extreme = peak_30d > 0.12
    # 条件 2: 当前比峰值低 30% (绝对距离 > 0.04)
    has_fallen = (peak_30d - s) > 0.04
    # 强度：跌得越多分越高
    intensity = ((peak_30d - s).clip(0, 0.10) / 0.10)
    score = (was_extreme & has_fallen).astype(float) * intensity
    return score.clip(0, 1)


# ============ 子信号 3: CFTC 极端持仓维持 ============

def cftc_extreme_persistent() -> pd.Series:
    """
    CFTC NQ Lev Money 是否"持续极端 + 快慢钱反向"
    高分条件:
      - Lev Money NQ < -40% OI 持续 >= 2 周
      - Asset Manager NQ > 0 (反向)
      - 加分: 极端值还在加深 (周环比更负)
    """
    sql = """
        SELECT report_date, contract, trader_type, mm_net_pct_oi
        FROM cftc_cot WHERE contract = 'NQ' ORDER BY report_date
    """
    with db.get_conn() as conn:
        df = pd.read_sql_query(sql, conn, parse_dates=["report_date"])
    if df.empty:
        return pd.Series(dtype=float)

    pivot = df.pivot(index="report_date", columns="trader_type",
                     values="mm_net_pct_oi")
    if "lev_money" not in pivot.columns:
        return pd.Series(dtype=float)

    lev = pivot["lev_money"]
    am = pivot.get("asset_mgr", pd.Series(0, index=pivot.index))

    # 极端空头持续 (用 2 周窗口)
    extreme = (lev < -0.40).rolling(2, min_periods=1).sum() >= 2
    # 快慢钱反向
    divergence = (lev < 0) & (am > 0)
    # 加深 (本周比上周更负)
    deepening = lev.diff() < -0.05

    weekly_score = (
        extreme.astype(float) * 0.5
        + divergence.astype(float) * 0.3
        + deepening.astype(float) * 0.2
    ).clip(0, 1)

    # 转日级序列 (forward fill)
    daily_idx = pd.date_range(weekly_score.index.min(),
                               pd.Timestamp.today(),
                               freq="B")
    return weekly_score.reindex(daily_idx, method="ffill").fillna(0)


# ============ 子信号 4: VIX 上升趋势 ============

def vix_rising_signal() -> pd.Series:
    """
    VIX 是否在上升趋势 (这次重点不是"VIX 低 = 自满"，
    而是"VIX 从低位开始上行 = 风险溢价定价回归")
    高分条件:
      - VIX 5日变化 > +15%
      - 当前 VIX 比 60 日均值高
      - 加分: VIX/VIX3M 期限结构开始倒挂
    """
    with db.get_conn() as conn:
        df = pd.read_sql_query("""
            SELECT date, metric, value FROM option_sentiment
            WHERE metric IN ('vix_level', 'vix_3m_ratio', 'vix_change_5d')
            ORDER BY date
        """, conn, parse_dates=["date"])
    if df.empty:
        return pd.Series(dtype=float)

    pivot = df.pivot(index="date", columns="metric", values="value")
    if "vix_level" not in pivot.columns:
        return pd.Series(dtype=float)

    vix = pivot["vix_level"]
    vix_60ma = vix.rolling(60, min_periods=10).mean()
    vix_above_ma = vix > vix_60ma
    
    # VIX 5日变化（自己计算如果没存）
    if "vix_change_5d" in pivot.columns:
        chg5 = pivot["vix_change_5d"]
    else:
        chg5 = vix.pct_change(5)
    
    rising_fast = chg5 > 0.15
    
    # 期限结构倒挂（>= 0.95 表示接近倒挂）
    if "vix_3m_ratio" in pivot.columns:
        inverting = pivot["vix_3m_ratio"] > 0.95
    else:
        inverting = pd.Series(False, index=vix.index)
    
    score = (
        rising_fast.astype(float) * 0.5
        + (vix_above_ma & rising_fast).astype(float) * 0.3
        + inverting.astype(float) * 0.2
    ).clip(0, 1)
    return score


# ============ 子信号 5: 领先指标转弱 ============

def leading_indicators_signal() -> pd.Series:
    """
    检测领先指标是否在"快速恶化"
    每个领先指标对（如 IWM/SPY）：
      - 计算比值的 60 日动量
      - 当前比值是否在过去 60 日的较低分位
      - 加分: 比值刚跌破 200 日均线
    """
    scores = []
    for key, (num, denom, name) in LEADING_INDICATOR_PAIRS.items():
        n_px = db.load_prices(num)["close"] if not db.load_prices(num).empty else None
        d_px = db.load_prices(denom)["close"] if not db.load_prices(denom).empty else None
        if n_px is None or d_px is None or n_px.empty or d_px.empty:
            continue

        ratio = (n_px / d_px).dropna()
        if len(ratio) < 60:
            continue

        # 60 日动量为负 (过去 60 日比值下降)
        mom60 = ratio.pct_change(60)
        # 当前比值在 60 日内的分位数
        pct60 = ratio.rolling(60, min_periods=20).rank(pct=True)
        # 200 日均线
        ma200 = ratio.rolling(200, min_periods=50).mean()
        below_ma = ratio < ma200

        sig = (
            (mom60 < -0.05).astype(float) * 0.4
            + (pct60 < 0.20).astype(float) * 0.3
            + below_ma.astype(float) * 0.3
        ).clip(0, 1)
        scores.append(sig)

    if not scores:
        return pd.Series(dtype=float)

    df = pd.concat(scores, axis=1).fillna(0)
    # 多个领先指标同时弱 → 高分
    return df.mean(axis=1)


# ============ 主合成函数 ============

def compute_risk_score_v2(persist_days: int = 3) -> pd.DataFrame:
    """
    合成 v2 风险评分时间序列
    
    persist_days: 评分需持续 N 天以上才视为"确认"，避免噪声
    
    返回 DataFrame:
      columns: date, factor_rev, sox_rev, cftc_extreme, vix_rising, leading_weak,
               n_active, raw_score, confirmed_score
    """
    logger.info("Computing v2 sub-signals ...")
    sigs = {
        "factor_rev":   factor_reversal_signal(),
        "sox_rev":      sox_reversal_signal(),
        "cftc_extreme": cftc_extreme_persistent(),
        "vix_rising":   vix_rising_signal(),
        "leading_weak": leading_indicators_signal(),
    }

    # Use the NDX trading calendar as the canonical timeline. Weekly CFTC data
    # may extend into weekends or the current, not-yet-closed business day;
    # an outer join would otherwise create a false latest row with 0s for all
    # market-based signals.
    ndx_prices = db.load_prices("^NDX")
    if ndx_prices.empty:
        logger.warning("NDX prices unavailable; falling back to signal dates.")
        market_index = pd.concat(sigs, axis=1).index
    else:
        market_index = pd.DatetimeIndex(ndx_prices.index).sort_values().unique()

    aligned = {
        name: signal.sort_index().reindex(market_index).ffill()
        for name, signal in sigs.items()
    }
    df = pd.concat(aligned, axis=1).fillna(0)
    df.columns = list(sigs.keys())

    # 多少个信号"激活" (> 0.4)
    df["n_active"] = (df[list(sigs.keys())] > 0.4).sum(axis=1)

    # 原始评分: 加权平均
    weights = {
        "factor_rev":   0.20,
        "sox_rev":      0.15,
        "cftc_extreme": 0.30,   # 最重要
        "vix_rising":   0.15,
        "leading_weak": 0.20,
    }
    raw = sum(df[k] * w for k, w in weights.items())

    # confluence bonus: 3 个以上信号同时激活，原始分 × 1.3
    bonus = np.where(df["n_active"] >= 3, 1.3,
             np.where(df["n_active"] >= 2, 1.1, 1.0))
    raw = (raw * bonus).clip(0, 1)
    df["raw_score"] = raw

    # 持续性确认: 评分必须持续 N 天 > 0.5 才视为确认
    df["confirmed_score"] = raw.where(
        raw.rolling(persist_days, min_periods=persist_days).min() > 0.5,
        raw * 0.7  # 没持续的话打 7 折
    )

    return df


# ============ 报告辅助 ============

def latest_v2_breakdown() -> Dict:
    """获取最新一天的 v2 评分细分"""
    df = compute_risk_score_v2()
    if df.empty:
        return {}
    last = df.iloc[-1]
    return {
        "date": df.index[-1].strftime("%Y-%m-%d"),
        "raw_score": float(last["raw_score"]),
        "confirmed_score": float(last["confirmed_score"]),
        "n_active_signals": int(last["n_active"]),
        "sub_signals": {
            "factor_reversal":   float(last["factor_rev"]),
            "sox_reversal":      float(last["sox_rev"]),
            "cftc_extreme":      float(last["cftc_extreme"]),
            "vix_rising":        float(last["vix_rising"]),
            "leading_weak":      float(last["leading_weak"]),
        },
    }


def explain_signal(name: str, value: float) -> str:
    """对每个子信号的当前值给一句解读"""
    explanations = {
        "factor_reversal": {
            "high": "因子 z-score 已从近期峰值显著回落（多个因子同时回归）",
            "med":  "部分因子见顶迹象，但未全面反转",
            "low":  "因子还在创新高或处于中性位置",
        },
        "sox_reversal": {
            "high": "SOX 已从极端偏离回落，超买消化中",
            "med":  "SOX 略有回落但未达反转级别",
            "low":  "SOX 没有反转迹象（继续创新高或在低位）",
        },
        "cftc_extreme": {
            "high": "CFTC NQ Lev Money 持续极端空头 + 快慢钱反向 + 仓位加深",
            "med":  "CFTC 持仓偏极端但未持续",
            "low":  "CFTC 持仓正常",
        },
        "vix_rising": {
            "high": "VIX 快速上升 + 期限结构开始倒挂（风险溢价回归）",
            "med":  "VIX 缓慢上升",
            "low":  "VIX 平稳或下降",
        },
        "leading_weak": {
            "high": "多个领先指标（小盘/半导体/信用/运输）同时走弱",
            "med":  "部分领先指标走弱",
            "low":  "领先指标整体健康",
        },
    }
    if name not in explanations:
        return ""
    if value >= 0.6:
        return explanations[name]["high"]
    elif value >= 0.3:
        return explanations[name]["med"]
    else:
        return explanations[name]["low"]
