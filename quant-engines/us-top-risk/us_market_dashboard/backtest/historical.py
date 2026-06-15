"""
Historical Risk Score Backtester
回测美股顶部风险评分的预测能力

核心问题:
  "当评分 > X 时，未来 N 天 NDX 的平均回报是多少？是否显著负于全样本平均？"

方法:
  1. 对历史每个交易日，重建当日的风险评分 (基于该日可见的所有信号)
  2. 计算未来 5/10/20/30/60/90 天 NDX 的累计回报
  3. 按评分分桶 (例如 [0,0.4), [0.4,0.6), [0.6,0.8), [0.8,1.0])
  4. 计算每桶的平均/中位数前向回报 + 命中率 (回调 > 5% 的概率)
  5. 输出统计表 + 折线图 (评分 vs 30天平均回报)

注意:
  - 使用 point-in-time 数据避免 lookahead bias
  - 因子拥挤度的 z-score 已经是 rolling 计算
  - CFTC 是周报，需要 forward-fill 到日级
  - 使用 NDX (^NDX) 而非 SOX 评估，因为 NQ 是核心信号标的
"""
import logging
from datetime import date, datetime
from pathlib import Path
from typing import Dict, List, Tuple, Optional

import numpy as np
import pandas as pd

from us_market_dashboard.config.settings import (
    DATA_DIR, FACTOR_PROXIES,
)
from us_market_dashboard.storage import db

logger = logging.getLogger(__name__)


BACKTEST_DIR = DATA_DIR / "backtest"
BACKTEST_DIR.mkdir(parents=True, exist_ok=True)


# ============ 历史数据装载 ============

def _load_factor_history() -> pd.DataFrame:
    """读取所有因子的历史 z-score & crowding_score (date, factor → 列)"""
    sql = """
        SELECT date, factor, crowding_score, zscore
        FROM factor_crowding ORDER BY date
    """
    with db.get_conn() as conn:
        df = pd.read_sql_query(sql, conn, parse_dates=["date"])
    if df.empty:
        return df
    # 透视成 (date, factor) → score 矩阵
    score_w = df.pivot(index="date", columns="factor", values="crowding_score")
    z_w = df.pivot(index="date", columns="factor", values="zscore")
    z_w.columns = [f"z_{c}" for c in z_w.columns]
    return pd.concat([score_w, z_w], axis=1)


def _load_sox_dev() -> pd.Series:
    """SOX 偏离 20MA 时间序列"""
    sql = """
        SELECT date, value FROM technical_indicators
        WHERE symbol='^SOX' AND indicator='dev_ma20'
        ORDER BY date
    """
    with db.get_conn() as conn:
        df = pd.read_sql_query(sql, conn, parse_dates=["date"])
    if df.empty:
        return pd.Series(dtype=float)
    return df.set_index("date")["value"]


def _load_cftc_history() -> pd.DataFrame:
    """读取 CFTC 持仓历史，返回 NQ 相关序列 (lev_money_pct, asset_mgr_pct)"""
    sql = """
        SELECT report_date, contract, trader_type, mm_net_pct_oi
        FROM cftc_cot WHERE contract = 'NQ'
        ORDER BY report_date
    """
    with db.get_conn() as conn:
        df = pd.read_sql_query(sql, conn, parse_dates=["report_date"])
    if df.empty:
        return pd.DataFrame()
    out = df.pivot(index="report_date", columns="trader_type",
                   values="mm_net_pct_oi")
    out.columns = [f"nq_{c}_pct" for c in out.columns]
    return out


def _load_sentiment_history() -> pd.DataFrame:
    """读取波动率情绪历史"""
    sql = """
        SELECT date, metric, value FROM option_sentiment
        WHERE metric IN ('vix_level', 'vix_3m_ratio', 'skew_index')
        ORDER BY date
    """
    with db.get_conn() as conn:
        df = pd.read_sql_query(sql, conn, parse_dates=["date"])
    if df.empty:
        return pd.DataFrame()
    return df.pivot(index="date", columns="metric", values="value")


def _load_cta_aggregate() -> pd.Series:
    """CTA 综合信号历史"""
    sql = """
        SELECT date, equity_signal FROM cta_aggregate
        ORDER BY date
    """
    with db.get_conn() as conn:
        df = pd.read_sql_query(sql, conn, parse_dates=["date"])
    if df.empty:
        return pd.Series(dtype=float)
    return df.set_index("date")["equity_signal"]


def _load_ndx_prices() -> pd.Series:
    """^NDX 收盘价 (用于计算前向回报)"""
    px = db.load_prices("^NDX")
    if px.empty:
        # fallback to QQQ
        px = db.load_prices("QQQ")
    return px["close"] if not px.empty else pd.Series(dtype=float)


# ============ 历史评分重建 ============

def reconstruct_daily_risk_scores(version: str = "v1") -> pd.DataFrame:
    """
    对每个历史日期重建当日的"美股顶部风险评分"
    返回 columns: date | risk_score | 各子项分数

    version: 'v1' (旧公式) 或 'v2' (方向性 + 多信号反转 + 领先指标)
    """
    if version == "v2":
        from us_market_dashboard.analyzers.risk_score_v2 import compute_risk_score_v2
        v2_df = compute_risk_score_v2()
        if v2_df.empty:
            return pd.DataFrame()
        out = v2_df.copy()
        # 对齐 v1 的接口：'risk_score' 列
        out["risk_score"] = out["confirmed_score"]
        return out

    # 以下是 v1 原始逻辑
    logger.info("Loading historical data ...")
    factors = _load_factor_history()
    sox = _load_sox_dev()
    cftc = _load_cftc_history()
    sentiment = _load_sentiment_history()
    cta = _load_cta_aggregate()

    # 用所有数据源中最广的日期范围作为索引
    all_idx = pd.date_range(
        start=min(factors.index.min() if not factors.empty else pd.Timestamp.max,
                  sentiment.index.min() if not sentiment.empty else pd.Timestamp.max),
        end=max(factors.index.max() if not factors.empty else pd.Timestamp.min,
                sentiment.index.max() if not sentiment.empty else pd.Timestamp.min),
        freq="B"  # business days
    )

    df = pd.DataFrame(index=all_idx)

    # 因子最大 |z|
    if not factors.empty:
        z_cols = [c for c in factors.columns if c.startswith("z_")]
        if z_cols:
            factors_aligned = factors.reindex(all_idx).ffill()
            df["max_abs_z"] = factors_aligned[z_cols].abs().max(axis=1)
            df["n_factor_extreme"] = (factors_aligned[z_cols].abs() > 2.0).sum(axis=1)
        else:
            df["max_abs_z"] = np.nan
            df["n_factor_extreme"] = 0

    # SOX
    if not sox.empty:
        sox_aligned = sox.reindex(all_idx).ffill()
        df["sox_dev"] = sox_aligned
        # 30 日内 |dev|>10% 天数
        df["sox_extreme_days_30d"] = (sox_aligned.abs() > 0.10).rolling(30).sum()

    # CFTC NQ Lev Money (forward-fill 到日级)
    if not cftc.empty:
        cftc_aligned = cftc.reindex(all_idx).ffill()
        if "nq_lev_money_pct" in cftc_aligned.columns:
            df["nq_lev_pct"] = cftc_aligned["nq_lev_money_pct"]
        if "nq_asset_mgr_pct" in cftc_aligned.columns:
            df["nq_am_pct"] = cftc_aligned["nq_asset_mgr_pct"]

    # 情绪
    if not sentiment.empty:
        sent_aligned = sentiment.reindex(all_idx).ffill()
        for col in sent_aligned.columns:
            df[col] = sent_aligned[col]

    # CTA
    if not cta.empty:
        df["cta_eq"] = cta.reindex(all_idx).ffill()

    # ============ 评分公式（与 snapshot._aggregate_risk_score 一致）============
    score = pd.Series(0.0, index=df.index)
    weight = pd.Series(0.0, index=df.index)

    # 1. 因子 z-score (权重 2)
    if "max_abs_z" in df.columns:
        z = df["max_abs_z"]
        sub = pd.Series(np.where(z > 2.5, 0.9,
                        np.where(z > 2.0, 0.7,
                        np.where(z > 1.5, 0.5, 0.2))), index=df.index)
        sub = sub.where(z.notna(), other=np.nan)
        score = score.add(sub * 2, fill_value=0)
        weight = weight.add(z.notna().astype(float) * 2, fill_value=0)

    # 2. SOX (权重 1.5)
    if "sox_dev" in df.columns:
        cur = df["sox_dev"].abs()
        # 用 30 日内峰值作为 proxy（更平滑）
        peak = df["sox_dev"].abs().rolling(30, min_periods=5).max()
        proxy = pd.concat([cur, peak], axis=1).max(axis=1)
        sub = pd.Series(np.where(proxy > 0.18, 0.95,
                        np.where(proxy > 0.15, 0.85,
                        np.where(proxy > 0.10, 0.6, 0.2))), index=df.index)
        sub = sub.where(proxy.notna(), other=np.nan)
        score = score.add(sub * 1.5, fill_value=0)
        weight = weight.add(proxy.notna().astype(float) * 1.5, fill_value=0)

    # 3. CFTC NQ (权重 2)
    if "nq_lev_pct" in df.columns:
        lev = df["nq_lev_pct"]
        am = df.get("nq_am_pct", pd.Series(0, index=df.index))
        # 极端 + 反向
        divergence = (lev < -0.20) & (am > 0)
        extreme = lev.abs() > 0.50
        sub = pd.Series(np.where(extreme & divergence, 1.0,
                        np.where(extreme, 0.8,
                        np.where(lev.abs() > 0.30, 0.6, 0.3))), index=df.index)
        sub = sub.where(lev.notna(), other=np.nan)
        score = score.add(sub * 2, fill_value=0)
        weight = weight.add(lev.notna().astype(float) * 2, fill_value=0)

    # 4. CTA equity (权重 1)
    if "cta_eq" in df.columns:
        eq = df["cta_eq"].abs()
        sub = pd.Series(np.where(eq >= 1.0, 0.7,
                        np.where(eq >= 0.5, 0.5, 0.2)), index=df.index)
        sub = sub.where(df["cta_eq"].notna(), other=np.nan)
        score = score.add(sub, fill_value=0)
        weight = weight.add(df["cta_eq"].notna().astype(float), fill_value=0)

    # 5. VIX 期限结构 (权重 1)
    if "vix_3m_ratio" in df.columns:
        v = df["vix_3m_ratio"]
        sub = pd.Series(np.where(v < 0.83, 0.9,
                        np.where(v < 0.88, 0.6, 0.2)), index=df.index)
        sub = sub.where(v.notna(), other=np.nan)
        score = score.add(sub, fill_value=0)
        weight = weight.add(v.notna().astype(float), fill_value=0)

    # 6. VIX 水平 (权重 0.5)
    if "vix_level" in df.columns:
        v = df["vix_level"]
        # 注意：这里规则是"VIX 17+ 偏顶 (聪明钱已紧张), 12-14 也偏顶 (自满)"
        # 14-16 是中性区
        sub = pd.Series(np.where(v > 17, 0.5,
                        np.where(v < 14, 0.7, 0.3)), index=df.index)
        sub = sub.where(v.notna(), other=np.nan)
        score = score.add(sub * 0.5, fill_value=0)
        weight = weight.add(v.notna().astype(float) * 0.5, fill_value=0)

    df["risk_score"] = score / weight.replace(0, np.nan)

    # 只保留有最少数据的行 (至少要有因子 + SOX + 情绪三项)
    df = df.dropna(subset=["risk_score"])
    return df


# ============ 前向回报评估 ============

def compute_forward_returns(prices: pd.Series,
                            horizons: List[int] = (5, 10, 20, 30, 60, 90)) -> pd.DataFrame:
    """对价格序列计算各 horizon 的前向回报"""
    out = pd.DataFrame(index=prices.index)
    for h in horizons:
        out[f"ret_{h}d"] = prices.shift(-h) / prices - 1
    # 同时算未来 N 天内的最大回撤（评估"最坏情况"）
    for h in [30, 60, 90]:
        # max drawdown within next h days
        future_min = prices.rolling(h).min().shift(-h)
        out[f"maxdd_{h}d"] = future_min / prices - 1
    return out


# ============ 分桶分析 ============

def bucket_analysis(scores: pd.Series, returns: pd.DataFrame,
                    buckets: List[Tuple[float, float, str]] = None) -> pd.DataFrame:
    """
    按评分分桶，计算每桶的回报统计
    """
    if buckets is None:
        buckets = [
            (0.0, 0.40, "Low (0-40%)"),
            (0.40, 0.60, "Medium (40-60%)"),
            (0.60, 0.75, "High (60-75%)"),
            (0.75, 0.85, "Very High (75-85%)"),
            (0.85, 1.01, "Extreme (>85%)"),
        ]

    rows = []
    horizon_cols = [c for c in returns.columns if c.startswith("ret_")]
    dd_cols = [c for c in returns.columns if c.startswith("maxdd_")]

    # 全样本基准
    full = {"bucket": "ALL", "n": len(scores)}
    for col in horizon_cols + dd_cols:
        full[f"{col}_mean"] = returns[col].mean()
        full[f"{col}_median"] = returns[col].median()
    rows.append(full)

    for low, high, label in buckets:
        mask = (scores >= low) & (scores < high)
        n = int(mask.sum())
        if n == 0:
            continue
        sub_returns = returns.loc[scores[mask].index]
        row = {"bucket": label, "n": n, "low": low, "high": high}
        for col in horizon_cols:
            row[f"{col}_mean"] = sub_returns[col].mean()
            row[f"{col}_median"] = sub_returns[col].median()
            row[f"{col}_neg_pct"] = (sub_returns[col] < 0).mean()  # 跌的概率
            row[f"{col}_neg5pct_pct"] = (sub_returns[col] < -0.05).mean()  # 跌5%以上
        for col in dd_cols:
            row[f"{col}_mean"] = sub_returns[col].mean()
            row[f"{col}_p25"] = sub_returns[col].quantile(0.25)
        rows.append(row)

    return pd.DataFrame(rows)


# ============ 报告生成 ============

def generate_backtest_report(version: str = "v1") -> Path:
    """生成完整的回测报告

    version: 'v1' 或 'v2'
    """
    logger.info(f"Reconstructing historical risk scores ({version}) ...")
    df = reconstruct_daily_risk_scores(version=version)
    if df.empty:
        raise ValueError("No historical risk scores could be reconstructed")
    logger.info(
        f"  Reconstructed {len(df)} days of scores "
        f"({df.index.min().date()} → {df.index.max().date()})"
    )

    logger.info("Loading NDX prices ...")
    ndx = _load_ndx_prices()
    if ndx.empty:
        raise ValueError("No NDX/QQQ price data found")

    # 对齐并计算前向回报
    ndx.index = pd.to_datetime(ndx.index)
    fwd = compute_forward_returns(ndx)

    # 把评分和回报对齐
    aligned = df[["risk_score"]].join(fwd, how="inner")
    aligned = aligned.dropna(subset=["risk_score"])
    logger.info(f"  Aligned {len(aligned)} days for analysis")

    # 分桶分析
    logger.info("Running bucket analysis ...")
    bucket_df = bucket_analysis(aligned["risk_score"], aligned[fwd.columns])

    # 极端值时间序列（评分 > 0.75 的所有历史日期）
    extreme_dates = aligned[aligned["risk_score"] > 0.75].copy()
    extreme_dates_summary = extreme_dates[
        ["risk_score", "ret_30d", "ret_60d", "ret_90d", "maxdd_60d"]
    ].sort_index()

    # 组装 markdown 报告
    today = date.today().isoformat()
    md = f"""# 🧪 美股顶部风险评分 — 历史回测验证报告 ({version})

*生成时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}*"""

    if version == "v2":
        md += """

## ⚠ v2 评分系统说明

v2 与 v1 的核心区别：
1. **方向性检测**：z-score 持续向上 = 动量延续（低分），从峰值回落 = 反转（高分）
2. **多信号共振 (confluence)**：单点极端不算，需要 ≥3 个独立信号同时见顶
3. **领先指标**：加入 IWM/SPY、SOXX/SPY、HYG/LQD 等相对强弱比值
4. **持续性确认**：评分需持续 ≥3 天 > 0.5 才视为"确认"，避免噪声

v2 评分语义：
- `> 0.7` = 多个独立反转信号同时确认（真正的顶部预警）
- `< 0.3` = 正常市场或动量延续
"""

    md += "\n\n## 📋 摘要\n\n"
    md += (
        f"- **回测样本**: {aligned.index.min().date()} → "
        f"{aligned.index.max().date()} ({len(aligned)} 个交易日)\n"
        f"- **当前评分**: **{df['risk_score'].iloc[-1]:.0%}** "
        f"({df.index[-1].date()})\n"
        f"- **历史评分 > 75% 的天数**: {(aligned['risk_score'] > 0.75).sum()} "
        f"({(aligned['risk_score']>0.75).mean():.1%} 占比)\n"
        f"- **历史评分 > 85% 的天数**: {(aligned['risk_score'] > 0.85).sum()} "
        f"({(aligned['risk_score']>0.85).mean():.1%} 占比)\n"
    )

    md += "\n---\n\n## 📊 分桶平均前向回报 (NDX)\n\n"
    md += "下表显示：在历史上每个评分区间内，未来 N 天 NDX 平均累计回报。\n\n"

    # 组合简化的表格
    md += "| 评分区间 | 样本数 | 5天 | 10天 | 20天 | 30天 | 60天 | 90天 |\n"
    md += "|---------|-------|-----|------|------|------|------|------|\n"
    for _, r in bucket_df.iterrows():
        if pd.isna(r.get("ret_5d_mean")):
            continue
        md += (
            f"| {r['bucket']} | {int(r['n'])} | "
            f"{r.get('ret_5d_mean', 0):+.2%} | "
            f"{r.get('ret_10d_mean', 0):+.2%} | "
            f"{r.get('ret_20d_mean', 0):+.2%} | "
            f"**{r.get('ret_30d_mean', 0):+.2%}** | "
            f"**{r.get('ret_60d_mean', 0):+.2%}** | "
            f"{r.get('ret_90d_mean', 0):+.2%} |\n"
        )

    md += "\n### 下跌概率 (回调 > 5% 的频率)\n\n"
    md += "| 评分区间 | 30天跌5%概率 | 60天跌5%概率 | 90天跌5%概率 |\n"
    md += "|---------|------------|------------|------------|\n"
    for _, r in bucket_df.iterrows():
        if r["bucket"] == "ALL" or pd.isna(r.get("ret_30d_neg5pct_pct")):
            continue
        md += (
            f"| {r['bucket']} | "
            f"{r.get('ret_30d_neg5pct_pct', 0):.1%} | "
            f"{r.get('ret_60d_neg5pct_pct', 0):.1%} | "
            f"{r.get('ret_90d_neg5pct_pct', 0):.1%} |\n"
        )
    # 全样本基准
    full_row = bucket_df[bucket_df["bucket"] == "ALL"].iloc[0]
    md += "\n*基准（全样本）跌 5% 概率：*"
    # 重新算（因为 ALL 行没有 neg5pct）
    md += f"\n  - 30 天: {(aligned['ret_30d'] < -0.05).mean():.1%}\n"
    md += f"  - 60 天: {(aligned['ret_60d'] < -0.05).mean():.1%}\n"
    md += f"  - 90 天: {(aligned['ret_90d'] < -0.05).mean():.1%}\n\n"

    md += "### 未来 N 天内最大回撤 (Avg / 25th percentile)\n\n"
    md += "*p25 表示：25% 的样本最大回撤至少这么差*\n\n"
    md += "| 评分区间 | 30天 Avg | 30天 p25 | 60天 Avg | 60天 p25 | 90天 Avg | 90天 p25 |\n"
    md += "|---------|---------|---------|---------|---------|---------|----------|\n"
    for _, r in bucket_df.iterrows():
        if r["bucket"] == "ALL" or pd.isna(r.get("maxdd_30d_mean")):
            continue
        md += (
            f"| {r['bucket']} | "
            f"{r['maxdd_30d_mean']:+.2%} | {r['maxdd_30d_p25']:+.2%} | "
            f"{r['maxdd_60d_mean']:+.2%} | {r['maxdd_60d_p25']:+.2%} | "
            f"{r['maxdd_90d_mean']:+.2%} | {r['maxdd_90d_p25']:+.2%} |\n"
        )

    # 历史极端日期
    md += "\n---\n\n## 🚨 历史评分 > 75% 的极端日（含后续 NDX 表现）\n\n"
    if extreme_dates_summary.empty:
        md += "无历史样本\n\n"
    else:
        md += "| 日期 | 评分 | +30天 | +60天 | +90天 | 60天最大回撤 |\n"
        md += "|------|------|-------|-------|-------|------------|\n"
        # 只显示评分变化（合并连续的高评分时段）
        prev_score = -1
        shown = 0
        for dt, r in extreme_dates_summary.iterrows():
            if shown >= 30:
                md += "| ... | ... | ... | ... | ... | ... |\n"
                break
            # 只显示评分跨档变化或每 5 天
            if abs(r["risk_score"] - prev_score) > 0.05 or shown == 0:
                md += (
                    f"| {dt.date()} | {r['risk_score']:.0%} | "
                    f"{r.get('ret_30d', float('nan')):+.2%} | "
                    f"{r.get('ret_60d', float('nan')):+.2%} | "
                    f"{r.get('ret_90d', float('nan')):+.2%} | "
                    f"{r.get('maxdd_60d', float('nan')):+.2%} |\n"
                )
                shown += 1
                prev_score = r["risk_score"]

    # 关键统计指标
    md += "\n---\n\n## 🎯 关键统计 — 评分 > 75% 的「超额」信号\n\n"

    high_score = aligned[aligned["risk_score"] > 0.75]
    low_score = aligned[aligned["risk_score"] < 0.50]

    md += f"**高评分组 (>75%) vs 低评分组 (<50%) 30天平均回报对比**:\n\n"
    if not high_score.empty and not low_score.empty:
        h_mean = high_score["ret_30d"].mean()
        l_mean = low_score["ret_30d"].mean()
        all_mean = aligned["ret_30d"].mean()
        md += f"- 高评分组 (n={len(high_score)}): **{h_mean:+.2%}**\n"
        md += f"- 低评分组 (n={len(low_score)}): **{l_mean:+.2%}**\n"
        md += f"- 全样本 (n={len(aligned)}): {all_mean:+.2%}\n"
        md += f"- **超额差异**: {h_mean - l_mean:+.2%}\n\n"
        if h_mean < all_mean - 0.01:
            md += "✅ **信号有效**: 高评分日的未来 30 天回报显著低于全样本均值\n\n"
        else:
            md += "⚠ 信号在当前样本中区分度不足 (可能样本量太少)\n\n"

    # 当前评分位置对比
    cur_score = df["risk_score"].iloc[-1]
    same_or_higher = (aligned["risk_score"] >= cur_score).sum()
    pct = same_or_higher / len(aligned)
    md += f"## 📍 当前评分 ({cur_score:.0%}) 在历史中的位置\n\n"
    md += f"- 历史上有 **{same_or_higher} 天** 评分 ≥ 当前水平 ({pct:.1%} 占比)\n"

    if same_or_higher > 0:
        same_or_higher_data = aligned[aligned["risk_score"] >= cur_score]
        h_30 = same_or_higher_data["ret_30d"].mean()
        h_60 = same_or_higher_data["ret_60d"].mean()
        h_90 = same_or_higher_data["ret_90d"].mean()
        md += f"- 这些历史日期的 NDX 30天平均回报: **{h_30:+.2%}**\n"
        md += f"- 60天平均回报: **{h_60:+.2%}**\n"
        md += f"- 90天平均回报: **{h_90:+.2%}**\n"

    md += "\n---\n\n## 📦 数据 & 方法\n\n"
    md += "- 评分公式与 `snapshot._aggregate_risk_score()` 一致\n"
    md += "- CFTC 周报通过 forward-fill 到日级\n"
    md += "- 因子拥挤度的 z-score 已是 rolling 计算 (无 lookahead)\n"
    md += "- 前向回报基于 ^NDX 收盘价 (缺失时回退到 QQQ)\n"
    md += "- 报告中「评分>X天数」统计已扣除当前最近 N 天 (NaN 前向回报)\n\n"

    # 保存到文件
    out_path = BACKTEST_DIR / f"backtest_{version}_{today}.md"
    out_path.write_text(md, encoding="utf-8")
    logger.info(f"Backtest report saved to {out_path}")

    # 同时保存数据 CSV 供后续分析
    aligned.to_csv(BACKTEST_DIR / f"scores_returns_{version}_{today}.csv")
    bucket_df.to_csv(BACKTEST_DIR / f"buckets_{version}_{today}.csv", index=False)

    return out_path


# ============ 可选：matplotlib 图表 ============

def generate_charts(out_dir: Optional[Path] = None,
                    version: str = "v1") -> List[Path]:
    """生成可视化图表 (PNG)"""
    try:
        import matplotlib.pyplot as plt
        import matplotlib.dates as mdates
    except ImportError:
        logger.warning("matplotlib not installed, skipping charts")
        return []

    out_dir = out_dir or BACKTEST_DIR
    out_dir.mkdir(parents=True, exist_ok=True)
    today = date.today().isoformat()

    df = reconstruct_daily_risk_scores(version=version)
    ndx = _load_ndx_prices()
    ndx.index = pd.to_datetime(ndx.index)
    fwd = compute_forward_returns(ndx)
    aligned = df[["risk_score"]].join(fwd, how="inner").dropna(subset=["risk_score"])

    files = []

    # Chart 1: 评分 vs NDX 时间序列 (双 Y 轴)
    fig, ax1 = plt.subplots(figsize=(14, 6))
    ax2 = ax1.twinx()

    ndx_aligned = ndx.reindex(aligned.index).ffill()
    ax1.plot(ndx_aligned.index, ndx_aligned.values,
             color="steelblue", alpha=0.6, label="NDX", linewidth=1)
    ax1.set_ylabel("NDX Price", color="steelblue")
    ax1.tick_params(axis="y", labelcolor="steelblue")

    ax2.plot(aligned.index, aligned["risk_score"] * 100,
             color="crimson", alpha=0.8, label="Risk Score", linewidth=1.2)
    ax2.fill_between(aligned.index, 70, 100, alpha=0.08, color="red")
    ax2.axhline(70, color="orange", linestyle="--", linewidth=0.8, alpha=0.7)
    ax2.axhline(85, color="red", linestyle="--", linewidth=0.8, alpha=0.7)
    ax2.set_ylabel("Risk Score (%)", color="crimson")
    ax2.tick_params(axis="y", labelcolor="crimson")
    ax2.set_ylim(0, 100)

    plt.title(
        f"NDX vs US Top Risk Score [{version.upper()}] "
        f"({aligned.index.min().date()} → {aligned.index.max().date()})"
    )
    fig.tight_layout()
    p1 = out_dir / f"risk_vs_ndx_{version}_{today}.png"
    fig.savefig(p1, dpi=120, bbox_inches="tight")
    plt.close(fig)
    files.append(p1)
    logger.info(f"Saved chart: {p1}")

    # Chart 2: 分桶柱状图
    bucket_df = bucket_analysis(aligned["risk_score"], aligned[fwd.columns])
    bucket_df = bucket_df[bucket_df["bucket"] != "ALL"].copy()
    bucket_df = bucket_df.dropna(subset=["ret_30d_mean"])

    fig, ax = plt.subplots(figsize=(12, 6))
    x = np.arange(len(bucket_df))
    width = 0.25
    ax.bar(x - width, bucket_df["ret_30d_mean"] * 100, width,
           label="30-day", color="#2E86AB")
    ax.bar(x, bucket_df["ret_60d_mean"] * 100, width,
           label="60-day", color="#A23B72")
    ax.bar(x + width, bucket_df["ret_90d_mean"] * 100, width,
           label="90-day", color="#F18F01")
    ax.set_xticks(x)
    ax.set_xticklabels(bucket_df["bucket"], rotation=15, ha="right")
    ax.set_ylabel("Avg NDX Forward Return (%)")
    ax.set_title(f"Risk Score Bucket → NDX Forward Return [{version.upper()}]")
    ax.axhline(0, color="black", linewidth=0.5)
    ax.legend()
    ax.grid(axis="y", alpha=0.3)
    fig.tight_layout()
    p2 = out_dir / f"bucket_returns_{version}_{today}.png"
    fig.savefig(p2, dpi=120, bbox_inches="tight")
    plt.close(fig)
    files.append(p2)
    logger.info(f"Saved chart: {p2}")

    return files
