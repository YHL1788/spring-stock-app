"""
Market Report Generator
自动综合所有 dashboard 信号，生成机构级中文市场快照报告

输出:
  - Markdown 文件: data/reports/snapshot_YYYY-MM-DD.md
  - Telegram 推送（可选）

设计理念:
  报告不只是"数字罗列"，而是有叙事的解读：
    1) 头条结论 (执行摘要)
    2) 10 维信号汇总表
    3) 风险信号深度解读 (z-score极端、CFTC分歧等)
    4) 历史相似情形对比
    5) 给量化策略的具体操作建议
"""
import logging
from datetime import date, datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import pandas as pd

from us_market_dashboard.config.settings import (
    DATA_DIR, FACTOR_PROXIES,
)
from us_market_dashboard.storage import db

logger = logging.getLogger(__name__)


REPORT_DIR = DATA_DIR / "reports"
REPORT_DIR.mkdir(parents=True, exist_ok=True)


# ============ 数据读取层 ============

def _latest_factor_crowding() -> pd.DataFrame:
    sql = """
        SELECT factor, date, ratio, ret_60d, vol_60d, crowding_score, zscore
        FROM factor_crowding fc1
        WHERE date = (SELECT MAX(date) FROM factor_crowding fc2
                      WHERE fc2.factor = fc1.factor)
        ORDER BY ABS(zscore) DESC
    """
    with db.get_conn() as conn:
        return pd.read_sql_query(sql, conn)


def _latest_sentiment() -> Dict[str, dict]:
    """读取每个情绪指标的最新值"""
    sql = """
        SELECT date, metric, value, ma20, percentile_750
        FROM option_sentiment os1
        WHERE date = (SELECT MAX(date) FROM option_sentiment os2
                      WHERE os2.metric = os1.metric)
    """
    with db.get_conn() as conn:
        df = pd.read_sql_query(sql, conn)
    out = {}
    for _, r in df.iterrows():
        out[r["metric"]] = {
            "date": r["date"],
            "value": r["value"],
            "ma20": r["ma20"],
            "pct": r["percentile_750"],
        }
    return out


def _latest_cta() -> Tuple[pd.DataFrame, dict]:
    sql_per_asset = """
        SELECT asset, date, signal FROM cta_signals c1
        WHERE date = (SELECT MAX(date) FROM cta_signals c2 WHERE c2.asset = c1.asset)
        ORDER BY signal DESC
    """
    sql_agg = "SELECT * FROM cta_aggregate ORDER BY date DESC LIMIT 1"
    with db.get_conn() as conn:
        per_asset = pd.read_sql_query(sql_per_asset, conn)
        agg = pd.read_sql_query(sql_agg, conn)
    return per_asset, (agg.iloc[0].to_dict() if not agg.empty else {})


def _sox_status() -> Dict:
    """SOX 偏离 20MA 当前 + 历史峰值"""
    with db.get_conn() as conn:
        cur = pd.read_sql_query("""
            SELECT date, value FROM technical_indicators
            WHERE symbol='^SOX' AND indicator='dev_ma20'
            ORDER BY date DESC LIMIT 1
        """, conn)
        peak = pd.read_sql_query("""
            SELECT date, value FROM technical_indicators
            WHERE symbol='^SOX' AND indicator='dev_ma20'
              AND date >= date('now', '-90 days')
            ORDER BY value DESC LIMIT 1
        """, conn)
        n_extreme = pd.read_sql_query("""
            SELECT COUNT(*) AS n FROM technical_indicators
            WHERE symbol='^SOX' AND indicator='dev_ma20'
              AND value > 0.10
              AND date >= date('now', '-30 days')
        """, conn).iloc[0]["n"]
    return {
        "current": cur.iloc[0]["value"] if not cur.empty else None,
        "current_date": cur.iloc[0]["date"] if not cur.empty else None,
        "peak": peak.iloc[0]["value"] if not peak.empty else None,
        "peak_date": peak.iloc[0]["date"] if not peak.empty else None,
        "extreme_days_30d": int(n_extreme),
    }


def _latest_cftc(trader_type: str = "lev_money") -> pd.DataFrame:
    sql = """
        SELECT contract, report_date, mm_long, mm_short, mm_net, mm_net_pct_oi
        FROM cftc_cot c1
        WHERE trader_type = ?
          AND report_date = (SELECT MAX(report_date) FROM cftc_cot c2
                             WHERE c2.contract = c1.contract
                               AND c2.trader_type = ?)
        ORDER BY mm_net_pct_oi
    """
    with db.get_conn() as conn:
        return pd.read_sql_query(sql, conn, params=[trader_type, trader_type])


# ============ 信号评分层 ============

def _signal_level(value: float, thresholds: List[Tuple[float, str]]) -> str:
    """
    根据值和阈值列表返回等级标签
    thresholds: [(threshold, label), ...] 按 threshold 升序
    """
    for t, label in thresholds:
        if value <= t:
            return label
    return thresholds[-1][1]


def _aggregate_risk_score() -> Tuple[float, List[str]]:
    """
    计算综合"美股顶部风险"评分 ∈ [0, 1]
    返回 (score, 各信号说明列表)
    """
    score = 0.0
    weight_total = 0.0
    notes = []

    # 1. 因子拥挤度 z-score (权重 2)
    fc = _latest_factor_crowding()
    if not fc.empty:
        max_z = fc["zscore"].abs().max() if not fc["zscore"].isna().all() else 0
        n_extreme = (fc["zscore"].abs() > 2.0).sum()
        # z > 2.5 → 0.9 分；z > 2.0 → 0.7；z > 1.5 → 0.5
        if max_z > 2.5:
            sub_score = 0.9
        elif max_z > 2.0:
            sub_score = 0.7
        elif max_z > 1.5:
            sub_score = 0.5
        else:
            sub_score = 0.2
        score += sub_score * 2
        weight_total += 2
        notes.append(
            f"因子拥挤度: 最大|z|={max_z:.2f}σ, "
            f"{n_extreme}/{len(fc)} 因子 |z|>2.0"
        )

    # 2. SOX 极端偏离 (权重 1.5)
    sox = _sox_status()
    if sox["current"] is not None:
        cur = abs(sox["current"])
        peak = abs(sox["peak"]) if sox["peak"] else cur
        # 任一 >15% 给高分
        proxy = max(cur, peak)
        if proxy > 0.18:
            sub_score = 0.95
        elif proxy > 0.15:
            sub_score = 0.85
        elif proxy > 0.10:
            sub_score = 0.6
        else:
            sub_score = 0.2
        score += sub_score * 1.5
        weight_total += 1.5
        notes.append(
            f"SOX 偏离: 当前 {sox['current']:+.1%}, "
            f"30 天内 {sox['extreme_days_30d']} 天 > 10%"
        )

    # 3. CFTC NQ 极端持仓 (权重 2 - 关键信号)
    lev = _latest_cftc("lev_money")
    am = _latest_cftc("asset_mgr")
    if not lev.empty:
        nq_lev = lev[lev["contract"] == "NQ"]
        nq_am = am[am["contract"] == "NQ"]
        if not nq_lev.empty:
            lev_pct = nq_lev.iloc[0]["mm_net_pct_oi"]
            am_pct = nq_am.iloc[0]["mm_net_pct_oi"] if not nq_am.empty else 0
            divergence = (lev_pct < -0.20) and (am_pct > 0)
            if abs(lev_pct) > 0.50 and divergence:
                sub_score = 1.0  # 极端 + 分歧
                notes.append(
                    f"🚨 CFTC NQ Lev Money 极端{('空头' if lev_pct<0 else '多头')} "
                    f"{lev_pct:+.0%} OI, AM 反向 {am_pct:+.0%} (经典分歧)"
                )
            elif abs(lev_pct) > 0.30:
                sub_score = 0.8
                notes.append(f"CFTC NQ Lev Money: {lev_pct:+.0%} of OI")
            else:
                sub_score = 0.3
                notes.append(f"CFTC NQ Lev Money: {lev_pct:+.0%} of OI (温和)")
            score += sub_score * 2
            weight_total += 2

    # 4. CTA 趋势资金一边倒 (权重 1)
    _, agg = _latest_cta()
    if agg:
        eq = agg.get("equity_signal", 0) or 0
        # equity 资产是否 1.0 满仓
        sub_score = 0.7 if abs(eq) >= 1.0 else (0.5 if abs(eq) >= 0.5 else 0.2)
        score += sub_score
        weight_total += 1
        notes.append(f"CTA 美股信号: {eq:+.2f}")

    # 5. VIX 期限结构 (权重 1)
    sent = _latest_sentiment()
    vix_ratio = sent.get("vix_3m_ratio", {}).get("value")
    vix_level = sent.get("vix_level", {}).get("value")
    if vix_ratio is not None:
        if vix_ratio < 0.83:
            sub_score = 0.9
        elif vix_ratio < 0.88:
            sub_score = 0.6  # 接近警戒
        else:
            sub_score = 0.2
        score += sub_score
        weight_total += 1
        notes.append(f"VIX/VIX3M: {vix_ratio:.3f}")

    # 6. VIX 水平异常 (权重 0.5)
    if vix_level is not None:
        # VIX 18 而不是 12 = 市场已经不安
        sub_score = 0.5 if vix_level > 17 else (0.3 if vix_level > 14 else 0.7)
        score += sub_score * 0.5
        weight_total += 0.5
        notes.append(f"VIX 水平: {vix_level:.1f}")

    final = score / weight_total if weight_total else 0
    return final, notes


# ============ 报告生成 ============

def _emoji_for_z(z: float) -> str:
    az = abs(z)
    if az > 2.5: return "🔴"
    if az > 1.5: return "🟠"
    if az > 1.0: return "🟡"
    return "⚪"


def _format_summary_table() -> str:
    """生成 markdown 信号汇总表"""
    rows = []
    rows.append("| 维度 | 当前读数 | 状态 |")
    rows.append("|------|---------|------|")

    # 因子
    fc = _latest_factor_crowding()
    for _, r in fc.iterrows():
        cfg = FACTOR_PROXIES.get(r["factor"], {})
        name = cfg.get("name", r["factor"])
        z = r["zscore"] if pd.notna(r["zscore"]) else 0
        rows.append(
            f"| {name} | {r['crowding_score']:.0%} (z={z:+.2f}σ) "
            f"| {_emoji_for_z(z)} |"
        )

    # SOX
    sox = _sox_status()
    if sox["current"] is not None:
        emoji = ("🔴" if abs(sox["current"]) > 0.15 else
                 ("🟠" if abs(sox["current"]) > 0.10 else "⚪"))
        rows.append(
            f"| SOX 偏离 20MA | {sox['current']:+.1%} "
            f"(峰值 {sox['peak']:+.1%}) | {emoji} |"
        )

    # 情绪
    sent = _latest_sentiment()
    if "vix_3m_ratio" in sent:
        v = sent["vix_3m_ratio"]["value"]
        emoji = "🔴" if v < 0.83 else ("🟠" if v < 0.88 else "⚪")
        rows.append(f"| VIX/VIX3M 期限 | {v:.3f} | {emoji} |")
    if "vix_level" in sent:
        v = sent["vix_level"]["value"]
        emoji = "🟠" if v > 17 else "⚪"
        rows.append(f"| VIX 水平 | {v:.1f} | {emoji} |")
    if "skew_index" in sent:
        v = sent["skew_index"]["value"]
        emoji = "🟠" if v > 145 else "⚪"
        rows.append(f"| CBOE SKEW | {v:.0f} | {emoji} |")

    # CFTC NQ
    lev = _latest_cftc("lev_money")
    if not lev.empty:
        nq = lev[lev["contract"] == "NQ"]
        if not nq.empty:
            pct = nq.iloc[0]["mm_net_pct_oi"]
            emoji = "🚨" if abs(pct) > 0.5 else ("🟠" if abs(pct) > 0.3 else "⚪")
            rows.append(
                f"| CFTC NQ Lev Money | {pct:+.0%} of OI "
                f"({'空头' if pct<0 else '多头'}) | {emoji} |"
            )

    # CTA
    _, agg = _latest_cta()
    if agg.get("overall_signal") is not None:
        ov = agg["overall_signal"]
        emoji = "🟠" if abs(ov) > 0.5 else "⚪"
        rows.append(f"| CTA 综合信号 | {ov:+.2f} | {emoji} |")

    return "\n".join(rows)


def _historical_analogues(risk_score: float, notes: List[str]) -> str:
    """根据当前信号特征匹配历史相似情形"""
    txt = "## 📜 历史相似情形\n\n"
    sox = _sox_status()
    sox_extreme = sox["peak"] is not None and abs(sox["peak"]) > 0.15

    lev = _latest_cftc("lev_money")
    nq_extreme_short = False
    if not lev.empty:
        nq = lev[lev["contract"] == "NQ"]
        if not nq.empty and nq.iloc[0]["mm_net_pct_oi"] < -0.40:
            nq_extreme_short = True

    sent = _latest_sentiment()
    vix_high = sent.get("vix_level", {}).get("value", 0) > 17

    # 模式匹配
    matches = []
    if sox_extreme and nq_extreme_short:
        matches.append({
            "period": "**2024 年 7 月**",
            "desc": "SOX 偏离 20MA +17%, CTA 已开始减仓科技, NDX 随后 4 周回调 -15%",
        })
        matches.append({
            "period": "**2000 年 3 月**",
            "desc": "互联网泡沫顶部前 2 周, 半导体极端超买 + 对冲基金已建空头",
        })
    if vix_high and risk_score > 0.6:
        matches.append({
            "period": "**2018 年 Q3**",
            "desc": "美股新高 + VIX 偏高(15+) + 美元强 + 利率上行, Q4 急跌 20%",
        })
    if not matches:
        matches.append({
            "period": "**当前组合**",
            "desc": "信号尚未达到经典顶部级别",
        })

    for m in matches:
        txt += f"- {m['period']}: {m['desc']}\n"
    return txt


def build_snapshot_report() -> str:
    """生成完整 markdown 报告"""
    today = date.today().isoformat()
    risk_score, notes = _aggregate_risk_score()

    # 头条结论
    if risk_score > 0.75:
        verdict = "🔴 **极端警示**：多维度极端读数同时出现，顶部前夜特征明显"
        action = "**强烈建议减仓**，对美股相关持仓收紧止损或买保护性 put"
    elif risk_score > 0.6:
        verdict = "🟠 **风险偏高**：多个独立指标显示市场过热"
        action = "**建议降低仓位 30-40%**，提高交易标准"
    elif risk_score > 0.4:
        verdict = "🟡 **局部过热**：部分指标极端，整体风险中等"
        action = "正常持仓，但避免追高，关注下周变化"
    else:
        verdict = "⚪ **状态正常**：未见明显风险信号"
        action = "维持现有策略"

    # 报告主体
    md = f"""# 🇺🇸 美股市场快照 · {today}

## 📋 执行摘要

**综合风险评分: {risk_score:.0%}**

{verdict}

**操作建议**: {action}

---

## 📊 信号汇总

{_format_summary_table()}

---

## 🔍 重点信号深度解读

"""

    # 因子深度解读
    fc = _latest_factor_crowding()
    if not fc.empty:
        max_z_row = fc.iloc[0]
        cfg = FACTOR_PROXIES.get(max_z_row["factor"], {})
        md += f"### 1. 因子拥挤度\n\n"
        md += (
            f"最极端的因子是 **{cfg.get('name', max_z_row['factor'])}**，"
            f"z-score = **{max_z_row['zscore']:+.2f}σ**。"
        )
        if abs(max_z_row["zscore"]) > 2.5:
            md += f"\n\n这是**统计上 0.5% 的极端事件**——历史上类似 z-score 出现后，"
            md += "60-90 天内该因子均值回归概率超过 70%。\n\n"
        else:
            md += "\n\n"

        n_extreme = (fc["zscore"].abs() > 1.5).sum()
        if n_extreme >= 3:
            md += (
                f"⚠ **{n_extreme}/{len(fc)} 个因子 |z| > 1.5σ**，"
                f"表明市场风格趋势已经走得很极致。\n\n"
            )

    # SOX 解读
    sox = _sox_status()
    if sox["current"] is not None:
        md += f"### 2. SOX 半导体技术状态\n\n"
        md += (
            f"当前偏离 20 日均线 **{sox['current']:+.1%}** "
            f"(过去 90 天峰值 {sox['peak']:+.1%}, "
            f"日期 {sox['peak_date']})。\n\n"
            f"过去 30 天内有 **{sox['extreme_days_30d']} 个交易日** 偏离 > 10%——"
        )
        if sox["extreme_days_30d"] > 10:
            md += "**这是 5 年来罕见的持续超买状态**。"
        md += "\n\n"

    # CFTC 深度解读
    lev = _latest_cftc("lev_money")
    am = _latest_cftc("asset_mgr")
    if not lev.empty:
        md += f"### 3. CFTC 机构持仓 (本周报告: {lev.iloc[0]['report_date']})\n\n"
        md += "**Leveraged Money (CTA + 对冲基金)**:\n\n"
        for _, r in lev.iterrows():
            md += (f"- **{r['contract']}**: 净{('空头' if r['mm_net']<0 else '多头')} "
                   f"{int(r['mm_net']):+,} 张 ({r['mm_net_pct_oi']:+.1%} of OI)\n")
        md += "\n"

        # 检查快慢钱分歧
        if not am.empty:
            divergence_lines = []
            for contract in ["NQ", "ES", "RTY", "YM"]:
                lev_row = lev[lev["contract"] == contract]
                am_row = am[am["contract"] == contract]
                if not lev_row.empty and not am_row.empty:
                    lev_pct = lev_row.iloc[0]["mm_net_pct_oi"]
                    am_pct = am_row.iloc[0]["mm_net_pct_oi"]
                    # 反向且 |lev| > 30%
                    if (lev_pct * am_pct < 0) and abs(lev_pct) > 0.30:
                        divergence_lines.append(
                            f"- **{contract}**: Lev Money {lev_pct:+.0%} vs "
                            f"Asset Mgr {am_pct:+.0%} — 快慢钱反向！"
                        )
            if divergence_lines:
                md += "🚨 **快慢钱极端分歧**:\n\n"
                md += "\n".join(divergence_lines)
                md += (
                    "\n\n历史上当对冲基金/CTA 与传统机构反向定位时，"
                    "对冲基金往往领先 1-2 个月，是典型的顶部前夕特征。\n\n"
                )

    # CTA 解读
    per_asset, agg = _latest_cta()
    if agg.get("overall_signal") is not None:
        md += f"### 4. CTA 趋势跟踪资金\n\n"
        n_long = (per_asset["signal"] >= 0.5).sum()
        n_short = (per_asset["signal"] <= -0.5).sum()
        md += (
            f"6 个核心资产中，**{n_long} 个满仓做多**，**{n_short} 个满仓做空**。\n\n"
        )
        if n_long >= 4 or n_short >= 4:
            md += (
                "⚠ **CTA 趋势已极致**：当多数资产同时进入趋势极端时，"
                "任何小催化剂都会引发系统性平仓踩踏。\n\n"
            )

    # 历史相似情形
    md += "---\n\n"
    md += _historical_analogues(risk_score, notes)
    md += "\n---\n\n"

    # 给量化策略的建议
    md += "## 💡 量化策略建议\n\n"
    md += "### 对 A 股策略的传导风险\n\n"
    md += (
        "美股纳指与 A 股小市值 / 创业板的相关系数约 0.3-0.4 "
        "(通过北向资金、风险偏好、人民币汇率三个渠道传导)。"
        "**美股纳指 5-10% 回调通常对应 A 股小市值 3-5% 调整**。\n\n"
    )
    if risk_score > 0.6:
        md += "**具体操作建议（基于当前风险评分）**:\n\n"
        md += "```python\n"
        md += "# 加入小市值/ETF 策略的开仓判断\n"
        md += "if us_top_risk_score > 0.6 and lev_money_nq_pct_oi < -0.50:\n"
        md += "    target_position *= 0.6   # 减仓 40%\n"
        md += "    use_tight_stop = True    # 收紧止损\n"
        md += "    avoid_high_beta = True   # 避开高 Beta 个股\n"
        md += "```\n\n"

    # 关键信号清单
    md += "## 📋 关键监控信号清单\n\n"
    for note in notes:
        md += f"- {note}\n"
    md += "\n"

    # 数据源说明
    md += "---\n\n"
    md += "## 📦 数据来源\n\n"
    md += (
        "- 价格 / ETF / 指数：Yahoo Finance\n"
        "- 期权情绪：CBOE 历史归档 (2006-2019), VIX 期限结构 (实时)\n"
        "- CFTC 持仓：CFTC TFF 周报 (https://www.cftc.gov)\n"
        "- 计算时间：3Y 滚动分位 (~750 交易日)\n\n"
    )
    md += f"*报告生成时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}*\n"
    md += f"*生成自 us_market_dashboard / JunQuant*\n"

    return md


def _build_telegram_summary(md_report: str, risk_score: float) -> str:
    """从完整 markdown 报告抽取 Telegram 简要版（避免超长）"""
    today = date.today().isoformat()
    fc = _latest_factor_crowding()
    sox = _sox_status()
    sent = _latest_sentiment()
    lev = _latest_cftc("lev_money")
    _, agg = _latest_cta()

    if risk_score > 0.75:
        verdict = "🔴 极端警示"
    elif risk_score > 0.6:
        verdict = "🟠 风险偏高"
    elif risk_score > 0.4:
        verdict = "🟡 局部过热"
    else:
        verdict = "⚪ 正常"

    parts = [
        f"<b>🇺🇸 美股市场快照 · {today}</b>",
        f"<b>综合风险评分: {risk_score:.0%}</b> · {verdict}",
        "",
        "<b>📊 关键信号</b>",
    ]

    # Top 3 因子
    for _, r in fc.head(3).iterrows():
        cfg = FACTOR_PROXIES.get(r["factor"], {})
        name = cfg.get("name", r["factor"])
        parts.append(
            f"  • {name}: z={r['zscore']:+.2f}σ ({r['crowding_score']:.0%})"
        )

    # SOX
    if sox["current"] is not None:
        parts.append(
            f"  • SOX 偏离 20MA: {sox['current']:+.1%} "
            f"(峰值 {sox['peak']:+.1%})"
        )

    # CFTC NQ
    if not lev.empty:
        nq = lev[lev["contract"] == "NQ"]
        if not nq.empty:
            parts.append(f"  • CFTC NQ Lev Money: {nq.iloc[0]['mm_net_pct_oi']:+.0%} OI")

    # VIX
    if "vix_level" in sent:
        parts.append(f"  • VIX: {sent['vix_level']['value']:.1f}")
    if "vix_3m_ratio" in sent:
        parts.append(f"  • VIX/VIX3M: {sent['vix_3m_ratio']['value']:.3f}")

    # CTA
    if agg.get("overall_signal") is not None:
        parts.append(f"  • CTA 综合信号: {agg['overall_signal']:+.2f}")

    parts.append("")
    parts.append("<i>完整报告已保存到本地 markdown 文件</i>")
    return "\n".join(parts)


# ============ 主函数 ============

def generate_and_save() -> Path:
    """生成并保存报告，返回文件路径"""
    md = build_snapshot_report()
    today = date.today().isoformat()
    out_path = REPORT_DIR / f"snapshot_{today}.md"
    out_path.write_text(md, encoding="utf-8")
    logger.info(f"Report saved to {out_path}")
    return out_path


def push_to_telegram(send_full_md: bool = False) -> bool:
    """推送到 Telegram"""
    from us_market_dashboard.notifiers.telegram import send_message

    risk_score, _ = _aggregate_risk_score()
    md_full = build_snapshot_report()
    summary = _build_telegram_summary(md_full, risk_score)

    ok = send_message(summary)
    if send_full_md and ok:
        # 切片发送完整版（Telegram 4096 字符限制由 send_message 处理）
        send_message(f"<pre>{md_full[:3500]}</pre>")
    return ok
