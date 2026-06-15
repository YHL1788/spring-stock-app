"""
Report Builder
组装每日/每周报告文本，发送给 Telegram
"""
import logging
from datetime import date, datetime
from typing import List, Optional

import pandas as pd

from us_market_dashboard.analyzers import crowding, technical, cta
from us_market_dashboard.config.settings import (
    FACTOR_PROXIES, INDICES, CROWDING_WARN, CROWDING_ALERT, CROWDING_OVERSOLD,
    SOX_DEVIATION_WARN, SOX_DEVIATION_ALERT, PCR_LOW, PCR_HIGH,
    CTA_SIGNAL_EXTREME,
)
from us_market_dashboard.storage import db

logger = logging.getLogger(__name__)


def _emoji_for_score(score: float) -> str:
    if score >= CROWDING_ALERT:
        return "🔴"
    if score >= CROWDING_WARN:
        return "🟠"
    if score <= CROWDING_OVERSOLD:
        return "🟢"
    return "⚪"


def _emoji_for_signal(signal: float) -> str:
    if signal >= CTA_SIGNAL_EXTREME:
        return "🟢⬆"
    if signal <= -CTA_SIGNAL_EXTREME:
        return "🔴⬇"
    if signal > 0:
        return "🟢"
    if signal < 0:
        return "🔴"
    return "⚪"


def build_daily_report() -> str:
    """组装每日报告"""
    today = date.today().isoformat()
    parts = [f"<b>🇺🇸 美股情绪日报 · {today}</b>", ""]

    # 1) 因子拥挤度
    snap = crowding.latest_snapshot()
    if not snap.empty:
        parts.append("<b>📊 因子拥挤度（3年滚动分位）</b>")
        for _, r in snap.iterrows():
            cfg = FACTOR_PROXIES.get(r["factor"], {})
            name = cfg.get("name", r["factor"])
            score = r["crowding_score"]
            emoji = _emoji_for_score(score)
            zs = f"{r['zscore']:+.2f}σ" if pd.notna(r['zscore']) else "n/a"
            parts.append(f"{emoji} {name}: <b>{score:.0%}</b>  z={zs}")
        parts.append("")

    # 2) 关键指数偏离 20MA
    parts.append("<b>📈 指数 / 板块技术状态</b>")
    for sym, name in [("^SOX", "费城半导体"),
                      ("^NDX", "纳指100"),
                      ("^GSPC", "标普500"),
                      ("SMH", "SMH 半导体ETF"),
                      ("^RUT", "Russell 2000")]:
        d20 = technical.latest_indicator(sym, "dev_ma20")
        rsi14 = technical.latest_indicator(sym, "rsi14")
        d52 = technical.latest_indicator(sym, "dist_52w_high")
        if not d20:
            continue
        dv = d20["value"]
        emoji = "🔴" if abs(dv) >= SOX_DEVIATION_ALERT else (
            "🟠" if abs(dv) >= SOX_DEVIATION_WARN else "⚪"
        )
        line = f"{emoji} {name}: 偏离20MA <b>{dv:+.1%}</b>"
        if rsi14:
            line += f" · RSI14 {rsi14['value']:.0f}"
        if d52:
            line += f" · 距52W高 {d52['value']:+.1%}"
        parts.append(line)
    parts.append("")

    # 3) 情绪指标 (PCR + VIX 期限结构 + VIX 水平)
    sentiment_lines = []
    pcr_row = _latest_metric("equity_pcr")
    if pcr_row:
        v = pcr_row["value"]
        emoji = "🔴" if v <= PCR_LOW else ("🟠" if v >= PCR_HIGH else "⚪")
        line = f"{emoji} <b>CBOE Equity PCR</b>: {v:.2f}"
        if v <= PCR_LOW:
            line += " ← 过热"
        elif v >= PCR_HIGH:
            line += " ← 恐慌"
        sentiment_lines.append(line)

    vix_ratio = _latest_metric("vix_3m_ratio")
    if vix_ratio:
        v = vix_ratio["value"]
        emoji = "🔴" if v < 0.83 else ("🟠" if v > 1.05 else "⚪")
        line = f"{emoji} <b>VIX/VIX3M</b>: {v:.3f}"
        if v < 0.83:
            line += " ← 极度自满"
        elif v > 1.05:
            line += " ← 期限倒挂"
        sentiment_lines.append(line)

    vix_lvl = _latest_metric("vix_level")
    if vix_lvl:
        v = vix_lvl["value"]
        emoji = "🔴" if v < 14 else ("🟠" if v > 25 else "⚪")
        sentiment_lines.append(f"{emoji} <b>VIX</b>: {v:.1f}")

    skew = _latest_metric("skew_index")
    if skew:
        v = skew["value"]
        emoji = "🟠" if v > 145 else "⚪"
        sentiment_lines.append(f"{emoji} <b>SKEW</b>: {v:.0f}")

    if sentiment_lines:
        parts.append("<b>💭 期权 / 波动率情绪</b>")
        parts.extend(sentiment_lines)
        parts.append("")

    # 4) CTA 信号
    cta_data = cta.latest_cta()
    if cta_data["assets"]:
        parts.append("<b>🎯 CTA 趋势信号（自构建代理）</b>")
        for a in cta_data["assets"]:
            parts.append(f"  {_emoji_for_signal(a['signal'])} {a['asset']}: {a['signal']:+.2f}")
        agg = cta_data["aggregate"]
        if agg and agg.get("overall_signal") is not None:
            ov = agg["overall_signal"]
            parts.append(f"  ━━━")
            parts.append(f"  {_emoji_for_signal(ov)} <b>综合: {ov:+.2f}</b>")
        parts.append("")

    parts.append("<i>说明: 拥挤度高 = 风格过热(反向信号); CTA 信号极端表示趋势资金高度一边倒</i>")
    return "\n".join(parts)


def build_weekly_report() -> str:
    """周报：增加 CFTC 持仓变化、过去 5 日变化"""
    today = date.today().isoformat()
    parts = [f"<b>🇺🇸 美股情绪周报 · {today}</b>", ""]

    # 因子拥挤度变化
    parts.append("<b>📊 因子拥挤度（本周变化）</b>")
    for key, cfg in FACTOR_PROXIES.items():
        sql = """
            SELECT date, crowding_score FROM factor_crowding
            WHERE factor = ? ORDER BY date DESC LIMIT 6
        """
        with db.get_conn() as conn:
            df = pd.read_sql_query(sql, conn, params=[key])
        if df.empty or len(df) < 2:
            continue
        latest = df.iloc[0]["crowding_score"]
        prev = df.iloc[-1]["crowding_score"]
        delta = latest - prev
        emoji = _emoji_for_score(latest)
        arrow = "↑" if delta > 0.02 else ("↓" if delta < -0.02 else "→")
        parts.append(
            f"{emoji} {cfg['name']}: {latest:.0%} {arrow} ({delta:+.0%}/周)"
        )
    parts.append("")

    # CFTC 最新持仓 (Leveraged Money = CTA + 对冲基金, 主要趋势资金)
    sql_cot = """
        SELECT contract, report_date, mm_long, mm_short, mm_net, mm_net_pct_oi
        FROM cftc_cot c1
        WHERE trader_type = 'lev_money'
          AND report_date = (SELECT MAX(report_date) FROM cftc_cot c2
                             WHERE c2.contract = c1.contract
                               AND c2.trader_type = 'lev_money')
        ORDER BY contract
    """
    with db.get_conn() as conn:
        cot = pd.read_sql_query(sql_cot, conn)
    if not cot.empty:
        parts.append("<b>📑 CFTC Leveraged Money 净持仓 (CTA+对冲基金)</b>")
        for _, r in cot.iterrows():
            parts.append(
                f"  {r['contract']}: 净 {int(r['mm_net']):+,} "
                f"({r['mm_net_pct_oi']:+.1%} of OI)"
            )
        parts.append(f"<i>报告日: {cot.iloc[0]['report_date']}</i>")
        parts.append("")

    return "\n".join(parts)


def collect_alerts() -> List[dict]:
    """
    扫描所有指标，找出当天需要触发的告警
    返回 [{type, severity, message, value}, ...]
    """
    alerts = []
    snap = crowding.latest_snapshot()
    for _, r in snap.iterrows():
        score = r["crowding_score"]
        cfg = FACTOR_PROXIES.get(r["factor"], {})
        name = cfg.get("name", r["factor"])
        if score >= CROWDING_ALERT:
            alerts.append({
                "type": f"crowding_alert_{r['factor']}",
                "severity": "alert",
                "message": f"🔴 <b>{name}</b> 拥挤度极端: {score:.1%} (3Y分位)",
                "value": score,
            })
        elif score >= CROWDING_WARN:
            alerts.append({
                "type": f"crowding_warn_{r['factor']}",
                "severity": "warn",
                "message": f"🟠 <b>{name}</b> 拥挤度偏高: {score:.1%}",
                "value": score,
            })

    # SOX 偏离
    sox = technical.latest_indicator("^SOX", "dev_ma20")
    if sox:
        dv = sox["value"]
        if abs(dv) >= SOX_DEVIATION_ALERT:
            alerts.append({
                "type": "sox_deviation_alert",
                "severity": "alert",
                "message": f"🔴 <b>SOX 半导体</b> 偏离20MA <b>{dv:+.1%}</b> · 极端读数",
                "value": dv,
            })
        elif abs(dv) >= SOX_DEVIATION_WARN:
            alerts.append({
                "type": "sox_deviation_warn",
                "severity": "warn",
                "message": f"🟠 <b>SOX</b> 偏离20MA {dv:+.1%}",
                "value": dv,
            })

    # CBOE PCR 极值（如有真实数据）
    pcr_row = _latest_metric("equity_pcr")
    if pcr_row:
        v = pcr_row["value"]
        if v <= PCR_LOW:
            alerts.append({
                "type": "pcr_too_low",
                "severity": "alert",
                "message": f"🔴 <b>CBOE PCR</b> {v:.2f} · 看涨期权过热",
                "value": v,
            })
        elif v >= PCR_HIGH:
            alerts.append({
                "type": "pcr_too_high",
                "severity": "warn",
                "message": f"🟠 <b>CBOE PCR</b> {v:.2f} · 恐慌或对冲需求高",
                "value": v,
            })

    # VIX/VIX3M 期限结构
    vix_ratio = _latest_metric("vix_3m_ratio")
    if vix_ratio:
        v = vix_ratio["value"]
        if v < 0.83:
            alerts.append({
                "type": "vix_complacency",
                "severity": "alert",
                "message": f"🔴 <b>VIX/VIX3M</b> {v:.2f} · 期限结构超 contango，市场极度自满",
                "value": v,
            })
        elif v > 1.05:
            alerts.append({
                "type": "vix_inversion",
                "severity": "warn",
                "message": f"🟠 <b>VIX/VIX3M</b> {v:.2f} · 期限结构倒挂，近月恐慌",
                "value": v,
            })

    # VIX 5日动量
    vix_chg = _latest_metric("vix_change_5d")
    if vix_chg:
        v = vix_chg["value"]
        if v > 0.30:
            alerts.append({
                "type": "vix_spike",
                "severity": "warn",
                "message": f"🟠 <b>VIX 5日变化</b> {v:+.0%} · 恐慌快速入场",
                "value": v,
            })

    # SKEW 尾部风险
    skew = _latest_metric("skew_index")
    if skew:
        v = skew["value"]
        if v > 150:
            alerts.append({
                "type": "skew_high",
                "severity": "warn",
                "message": f"🟠 <b>CBOE SKEW</b> {v:.0f} · 黑天鹅对冲需求高",
                "value": v,
            })

    # CTA 极端信号
    cta_data = cta.latest_cta()
    agg = cta_data.get("aggregate", {})
    ov = agg.get("overall_signal")
    if ov is not None and abs(ov) >= CTA_SIGNAL_EXTREME:
        direction = "高度做多" if ov > 0 else "高度做空"
        alerts.append({
            "type": "cta_extreme",
            "severity": "warn",
            "message": f"⚠ <b>CTA 综合信号</b> {ov:+.2f} · 趋势资金{direction}",
            "value": ov,
        })

    return alerts


def _latest_metric(metric: str) -> Optional[dict]:
    sql = """
        SELECT date, value, percentile_750 FROM option_sentiment
        WHERE metric = ? ORDER BY date DESC LIMIT 1
    """
    with db.get_conn() as conn:
        cur = conn.execute(sql, (metric,))
        row = cur.fetchone()
    if not row:
        return None
    return {"date": row[0], "value": row[1], "percentile_750": row[2]}
