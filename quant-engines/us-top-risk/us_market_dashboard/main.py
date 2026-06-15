"""
US Market Dashboard - Main Pipeline
入口脚本，提供命令行接口

用法：
  python -m us_market_dashboard.main init          # 初始化数据库
  python -m us_market_dashboard.main backfill      # 首次回填 5 年历史
  python -m us_market_dashboard.main daily         # 日常更新（增量+计算+推送）
  python -m us_market_dashboard.main weekly        # 周报推送
  python -m us_market_dashboard.main report        # 仅打印当前报告(不推送)
  python -m us_market_dashboard.main alerts        # 检查并推送告警
"""
import argparse
import logging
import sys
from datetime import date

from us_market_dashboard.config.settings import LOG_DIR, TECHNICAL_SYMBOLS
from us_market_dashboard.storage import db
from us_market_dashboard.collectors.yfinance_collector import YFinanceCollector
from us_market_dashboard.collectors.cboe_collector import CBOEPutCallCollector
from us_market_dashboard.collectors.cftc_collector import CFTCCollector
from us_market_dashboard.analyzers import crowding, technical, cta
from us_market_dashboard.notifiers import reports
from us_market_dashboard.notifiers.telegram import send_message


def _setup_logging(verbose: bool = False):
    level = logging.DEBUG if verbose else logging.INFO
    log_file = LOG_DIR / f"usmd_{date.today().isoformat()}.log"
    logging.basicConfig(
        level=level,
        format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
        handlers=[
            logging.StreamHandler(sys.stdout),
            logging.FileHandler(log_file, encoding="utf-8"),
        ],
    )


def cmd_init():
    db.init_db()
    print("✓ Database initialized.")


def cmd_backfill():
    """首次跑：回填 5 年历史"""
    db.init_db()
    print("→ Phase 1: Downloading 5y historical prices ...")
    YFinanceCollector(incremental=False).collect()

    print("→ Phase 2: Computing factor crowding ...")
    crowding.update_all_factors()

    print("→ Phase 3: Computing technical indicators ...")
    technical.update_technical(TECHNICAL_SYMBOLS)

    print("→ Phase 4: Computing CTA signals ...")
    cta.update_cta_signals()

    print("→ Phase 5: Fetching CBOE PCR ...")
    try:
        CBOEPutCallCollector().collect()
    except Exception as e:
        print(f"  ✗ CBOE failed (will retry next run): {e}")

    print("→ Phase 6: Fetching CFTC COT ...")
    try:
        CFTCCollector().collect()
    except Exception as e:
        print(f"  ✗ CFTC failed (will retry next run): {e}")

    print("✓ Backfill complete.")


def cmd_daily(skip_push: bool = False):
    """日常更新：增量数据 + 重算指标 + 推送日报 + 触发告警"""
    db.init_db()
    print("→ Updating prices (incremental) ...")
    YFinanceCollector(incremental=True).collect()

    print("→ Recomputing factor crowding ...")
    crowding.update_all_factors()

    print("→ Recomputing technical indicators ...")
    technical.update_technical(TECHNICAL_SYMBOLS)

    print("→ Recomputing CTA signals ...")
    cta.update_cta_signals()

    print("→ Updating CBOE PCR ...")
    try:
        CBOEPutCallCollector().collect()
    except Exception as e:
        print(f"  ✗ CBOE failed: {e}")

    # 推送日报
    if not skip_push:
        print("→ Sending daily report ...")
        report_text = reports.build_daily_report()
        send_message(report_text)

        # 检查告警
        print("→ Checking alerts ...")
        alerts = reports.collect_alerts()
        today = date.today().isoformat()
        for a in alerts:
            if not db.alert_already_sent(a["type"], today):
                send_message(a["message"])
                db.log_alert(a["type"], a["severity"], a["message"], a["value"])
                print(f"  ! {a['type']} sent")
            else:
                print(f"  · {a['type']} already sent today, skipped")
    print("✓ Daily run complete.")


def cmd_weekly():
    """周报：含 CFTC 数据更新"""
    db.init_db()
    print("→ Updating CFTC COT ...")
    try:
        CFTCCollector().collect()
    except Exception as e:
        print(f"  ✗ CFTC failed: {e}")

    print("→ Sending weekly report ...")
    text = reports.build_weekly_report()
    send_message(text)
    print("✓ Weekly run complete.")


def cmd_report():
    """仅打印（用于调试）"""
    print(reports.build_daily_report())
    print()
    print("=== Alerts ===")
    for a in reports.collect_alerts():
        print(f"  [{a['severity']}] {a['type']}: {a['message']}")


def cmd_alerts():
    """只跑告警检查并推送"""
    db.init_db()
    alerts = reports.collect_alerts()
    today = date.today().isoformat()
    sent = 0
    for a in alerts:
        if not db.alert_already_sent(a["type"], today):
            if send_message(a["message"]):
                db.log_alert(a["type"], a["severity"], a["message"], a["value"])
                sent += 1
    print(f"✓ {sent}/{len(alerts)} alerts sent.")


def cmd_migrate():
    """处理 schema 升级（如 cftc_cot 加 trader_type 列）"""
    print(f"→ Checking schema migrations on {db.DB_PATH} ...")
    with db.get_conn() as conn:
        cur = conn.execute("PRAGMA table_info(cftc_cot)")
        cols = [r[1] for r in cur.fetchall()]
        if cols and "trader_type" not in cols:
            print("  Migrating cftc_cot: adding trader_type column ...")
            # SQLite 不能直接改主键，drop+rebuild
            conn.execute("DROP TABLE IF EXISTS cftc_cot")
            print("  ✓ Old cftc_cot dropped (will be recreated on next fetch)")
        else:
            print("  cftc_cot: already up to date")
    db.init_db()
    print("✓ Migration complete. Run `fetch-external` to refill CFTC data.")


def cmd_fetch_external():
    """单独拉取外部数据源（CBOE PCR + CFTC COT），不更新价格"""
    db.init_db()
    print("→ Fetching CBOE PCR / sentiment metrics ...")
    try:
        n = CBOEPutCallCollector().collect()
        print(f"  ✓ Sentiment: {n} rows")
    except Exception as e:
        print(f"  ✗ Sentiment failed: {e}")

    print("→ Fetching CFTC COT ...")
    try:
        n = CFTCCollector().collect()
        print(f"  ✓ CFTC COT: {n} rows")
    except Exception as e:
        print(f"  ✗ CFTC failed: {e}")


def cmd_report_snapshot(push_telegram: bool = True):
    """生成市场快照报告（markdown + Telegram 推送）"""
    from us_market_dashboard.notifiers import snapshot

    print("→ Generating market snapshot report ...")
    out_path = snapshot.generate_and_save()
    print(f"  ✓ Markdown saved: {out_path}")

    if push_telegram:
        print("→ Pushing summary to Telegram ...")
        ok = snapshot.push_to_telegram(send_full_md=False)
        print(f"  {'✓ Sent' if ok else '✗ Failed (or not configured)'}")
    else:
        print("→ Skipping Telegram push (--skip-push)")

    # 同时打印到终端方便调试
    print("\n" + "=" * 70)
    print(out_path.read_text(encoding="utf-8"))


def cmd_backtest(generate_charts: bool = True, version: str = "v1"):
    """生成历史回测验证报告"""
    from us_market_dashboard.backtest import historical

    print(f"→ Reconstructing historical risk scores ({version}) ...")
    out_path = historical.generate_backtest_report(version=version)
    print(f"  ✓ Backtest report: {out_path}")

    if generate_charts:
        print("→ Generating charts ...")
        try:
            files = historical.generate_charts(version=version)
            for f in files:
                print(f"  ✓ Chart: {f}")
        except Exception as e:
            print(f"  ⚠ Chart generation skipped: {e}")
            print("    (matplotlib may not be installed: pip install matplotlib)")

    # 打印报告主体
    print("\n" + "=" * 70)
    print(out_path.read_text(encoding="utf-8"))


def cmd_extend_history(years: int = 10):
    """扩展历史数据到 N 年，用于更可靠的回测验证

    会做这些事:
    1. 重新拉取所有 ETF/指数 10 年数据
    2. 重新计算 10 年的因子拥挤度、技术指标、CTA 信号
    3. 循环拉取 CFTC 历史 zip (按年)
    4. 重新跑 CBOE 历史 PCR (本来就是 2006-2019 完整归档)
    """
    db.init_db()
    period = f"{years}y"

    print(f"→ Phase 1: Re-downloading {period} of ETF/index prices ...")
    print("  (这会覆盖现有数据库的价格记录)")
    YFinanceCollector(period=period, incremental=False).collect()

    print("\n→ Phase 2: Recomputing factor crowding ...")
    crowding.update_all_factors()

    print("\n→ Phase 3: Recomputing technical indicators ...")
    technical.update_technical(TECHNICAL_SYMBOLS)

    print("\n→ Phase 4: Recomputing CTA signals ...")
    cta.update_cta_signals()

    print("\n→ Phase 5: Re-fetching sentiment (含 CBOE 2006-2019 PCR 归档) ...")
    try:
        n = CBOEPutCallCollector(backfill_period=period).collect()
        print(f"  ✓ Sentiment: {n} rows")
    except Exception as e:
        print(f"  ✗ Sentiment failed: {e}")

    print(f"\n→ Phase 6: Fetching CFTC COT for past {years} years ...")
    from datetime import datetime
    current_year = datetime.utcnow().year
    total_cftc = 0
    for year in range(current_year - years + 1, current_year + 1):
        try:
            print(f"  Fetching CFTC year {year} ...")
            n = CFTCCollector(year=year, fallback_prev_year=False).collect()
            print(f"    ✓ {n} rows")
            total_cftc += n
        except Exception as e:
            print(f"    ⚠ year {year} failed: {e}")
    print(f"  Total CFTC: {total_cftc} rows")

    print(f"\n✓ History extended to {years} years.")
    print("  Now run: python -m us_market_dashboard backtest --version v2")


def cmd_score_v2():
    """显示 v2 当前评分细分 + 子信号解读"""
    from us_market_dashboard.analyzers.risk_score_v2 import (
        latest_v2_breakdown, explain_signal,
    )
    print("\n🎯 v2 风险评分细分（基于反转 + 共振 + 领先指标）\n")
    info = latest_v2_breakdown()
    if not info:
        print("⚠ 没有足够数据生成 v2 评分（可能需要先 fetch-external 拉领先指标）")
        return

    print(f"日期: {info['date']}")
    print(f"原始评分 (raw): {info['raw_score']:.0%}")
    print(f"确认评分 (confirmed, 持续 3 天 > 0.5): {info['confirmed_score']:.0%}")
    print(f"激活子信号数: {info['n_active_signals']}/5\n")

    print("子信号细分:")
    print("-" * 70)
    label_map = {
        "factor_reversal":   "1. 因子反转",
        "sox_reversal":      "2. SOX 反转",
        "cftc_extreme":      "3. CFTC 极端持续",
        "vix_rising":        "4. VIX 上升",
        "leading_weak":      "5. 领先指标转弱",
    }
    for k, v in info["sub_signals"].items():
        bar = "█" * int(v * 20) + "░" * (20 - int(v * 20))
        emoji = "🔴" if v >= 0.6 else ("🟡" if v >= 0.3 else "⚪")
        label = label_map.get(k, k)
        print(f"  {emoji} {label:20s} {v:.2f} [{bar}]")
        print(f"      {explain_signal(k, v)}")

    print()
    confirmed = info["confirmed_score"]
    if confirmed > 0.7:
        print("🔴 综合判断: 多个独立反转信号同时确认 → 真正的顶部预警")
    elif confirmed > 0.5:
        print("🟠 综合判断: 部分反转信号出现，需要持续观察")
    elif confirmed > 0.3:
        print("🟡 综合判断: 个别信号偏高但未形成共振")
    else:
        print("⚪ 综合判断: 正常市场或动量延续阶段")


def cmd_inspect():
    """快速查看数据库当前状态（健康检查）"""
    import pandas as pd
    from us_market_dashboard.storage import db as dbm

    print(f"\n📁 Database: {dbm.DB_PATH}\n")

    with dbm.get_conn() as conn:
        # 1) 表统计
        tables = pd.read_sql(
            "SELECT name FROM sqlite_master WHERE type='table' "
            "AND name NOT LIKE 'sqlite_%' ORDER BY name", conn
        )
        print("📊 Tables & row counts:")
        for t in tables["name"]:
            n = pd.read_sql(f"SELECT COUNT(*) AS n FROM {t}", conn).iloc[0, 0]
            marker = "  " if n > 0 else "⚠ "
            print(f"  {marker}{t:25s} {n:>10,} rows")

        # 2) 价格覆盖
        print("\n📅 Price freshness (top 15 by latest date):")
        cov = pd.read_sql("""
            SELECT symbol, MIN(date) AS first_date, MAX(date) AS last_date,
                   COUNT(*) AS days
            FROM prices GROUP BY symbol
            ORDER BY last_date DESC, symbol
            LIMIT 15
        """, conn)
        if not cov.empty:
            print(cov.to_string(index=False))

        # 3) 最新拥挤度
        print("\n🎯 Latest factor crowding:")
        snap = pd.read_sql("""
            SELECT factor, date,
                   ROUND(crowding_score, 3) AS score,
                   ROUND(zscore, 2) AS zscore,
                   ROUND(ret_60d * 100, 2) AS ret60d_pct
            FROM factor_crowding fc1
            WHERE date = (SELECT MAX(date) FROM factor_crowding fc2
                          WHERE fc2.factor = fc1.factor)
            ORDER BY crowding_score DESC
        """, conn)
        if not snap.empty:
            print(snap.to_string(index=False))

        # 4) 期权 / 波动率情绪 (多维度)
        print("\n💭 Latest sentiment metrics:")
        opt = pd.read_sql("""
            SELECT date, metric, ROUND(value, 3) AS value,
                   ROUND(ma20, 3) AS ma20,
                   ROUND(percentile_750, 3) AS pct_3y
            FROM option_sentiment os1
            WHERE date = (SELECT MAX(date) FROM option_sentiment os2
                          WHERE os2.metric = os1.metric)
            ORDER BY metric
        """, conn)
        if opt.empty:
            print("  ⚠ No sentiment data — run `python -m us_market_dashboard fetch-external`")
        else:
            metric_labels = {
                "equity_pcr_archive":  "📜 Equity PCR (历史归档 2006-2019)",
                "vix_3m_ratio":        "🌡 VIX/VIX3M 期限结构",
                "vix_level":           "📈 VIX 水平",
                "vix_change_5d":       "⚡ VIX 5日变化率",
                "skew_index":          "🎯 CBOE SKEW 尾部风险",
                "vix_sentiment_proxy": "🧪 VIX 衍生 PCR 代理",
                "equity_pcr":          "📊 Equity PCR",
            }
            for _, r in opt.iterrows():
                label = metric_labels.get(r["metric"], r["metric"])
                interp = ""
                v = r["value"]
                m = r["metric"]
                if m == "vix_3m_ratio":
                    if v < 0.85:
                        interp = "  → 远月波动率溢价，市场极度自满 🔴"
                    elif v > 1.00:
                        interp = "  → 期限结构倒挂，近月恐慌 🟠"
                elif m == "vix_level":
                    if v < 14:
                        interp = "  → VIX 极低，自满 🔴"
                    elif v > 25:
                        interp = "  → VIX 偏高，恐慌 🟠"
                elif m == "skew_index":
                    if v > 145:
                        interp = "  → SKEW 高，黑天鹅对冲需求高 🟠"
                elif m == "vix_change_5d":
                    if v > 0.20:
                        interp = "  → VIX 5日内飙升 20%+，恐慌入场 🟠"
                pct_str = f" · 3Y分位 {r['pct_3y']:.0%}" if pd.notna(r["pct_3y"]) else ""
                print(f"  {label}: {v:.3f}{pct_str}  ({r['date']}){interp}")

        # 5) CTA 综合信号
        print("\n🎯 Latest CTA aggregate (last 5 days):")
        agg = pd.read_sql("""
            SELECT date,
                   ROUND(equity_signal, 2) AS eq,
                   ROUND(bond_signal, 2) AS bond,
                   ROUND(commodity_signal, 2) AS cmdty,
                   ROUND(fx_signal, 2) AS fx,
                   ROUND(overall_signal, 2) AS overall
            FROM cta_aggregate ORDER BY date DESC LIMIT 5
        """, conn)
        if not agg.empty:
            print(agg.to_string(index=False))

        # 6) CTA 单标的最新
        print("\n🎯 CTA per-asset signals (latest):")
        ats = pd.read_sql("""
            SELECT asset, date, ROUND(signal, 2) AS signal
            FROM cta_signals c1
            WHERE date = (SELECT MAX(date) FROM cta_signals c2
                          WHERE c2.asset = c1.asset)
            ORDER BY signal DESC
        """, conn)
        if not ats.empty:
            print(ats.to_string(index=False))

        # 7) SOX 极端偏离历史
        print("\n⚠ SOX |dev_ma20| > 10% in last 90 days:")
        sox_ext = pd.read_sql("""
            SELECT date, ROUND(value * 100, 2) AS dev_pct
            FROM technical_indicators
            WHERE symbol='^SOX' AND indicator='dev_ma20'
              AND ABS(value) > 0.10
              AND date >= date('now', '-90 days')
            ORDER BY date DESC LIMIT 30
        """, conn)
        if sox_ext.empty:
            print("  (none in last 90 days)")
        else:
            print(sox_ext.to_string(index=False))

        # 8) CFTC 最新持仓 (Lev Money = CTA + 对冲基金)
        print("\n📑 Latest CFTC Leveraged Money (CTAs + Hedge Funds):")
        cot_lm = pd.read_sql("""
            SELECT contract, report_date,
                   mm_long, mm_short, mm_net,
                   ROUND(mm_net_pct_oi * 100, 2) AS pct_oi
            FROM cftc_cot c1
            WHERE trader_type = 'lev_money'
              AND report_date = (SELECT MAX(report_date) FROM cftc_cot c2
                                 WHERE c2.contract = c1.contract
                                   AND c2.trader_type = 'lev_money')
            ORDER BY contract
        """, conn)
        if cot_lm.empty:
            print("  ⚠ No CFTC data yet — install xlrd then run `fetch-external`")
        else:
            print(cot_lm.to_string(index=False))

        # 9) CFTC Asset Manager 持仓 (养老金/共同基金 - 慢钱)
        print("\n📑 Latest CFTC Asset Managers (Pension / Mutual Funds):")
        cot_am = pd.read_sql("""
            SELECT contract, report_date,
                   mm_long, mm_short, mm_net,
                   ROUND(mm_net_pct_oi * 100, 2) AS pct_oi
            FROM cftc_cot c1
            WHERE trader_type = 'asset_mgr'
              AND report_date = (SELECT MAX(report_date) FROM cftc_cot c2
                                 WHERE c2.contract = c1.contract
                                   AND c2.trader_type = 'asset_mgr')
            ORDER BY contract
        """, conn)
        if not cot_am.empty:
            print(cot_am.to_string(index=False))

        # 9) 历史告警计数
        print("\n🚨 Alert summary (last 30 days):")
        hist_alerts = pd.read_sql("""
            SELECT severity, COUNT(*) AS count
            FROM alerts_history
            WHERE alert_date >= date('now', '-30 days')
            GROUP BY severity
        """, conn)
        if hist_alerts.empty:
            print("  (none)")
        else:
            print(hist_alerts.to_string(index=False))

        # 10) 最近 10 条告警
        print("\n🚨 Last 10 alerts:")
        recent = pd.read_sql("""
            SELECT alert_date, severity, alert_type,
                   ROUND(metric_value, 3) AS value
            FROM alerts_history
            ORDER BY id DESC LIMIT 10
        """, conn)
        if recent.empty:
            print("  (none)")
        else:
            print(recent.to_string(index=False))

    print()


def main():
    parser = argparse.ArgumentParser(description="US Market Dashboard")
    parser.add_argument(
        "command",
        choices=["init", "backfill", "daily", "weekly", "report", "alerts",
                 "inspect", "fetch-external", "migrate", "report-snapshot",
                 "backtest", "score-v2", "extend-history"],
        help="Subcommand"
    )
    parser.add_argument("--verbose", "-v", action="store_true")
    parser.add_argument("--skip-push", action="store_true",
                        help="Run pipeline without sending Telegram messages")
    parser.add_argument("--skip-charts", action="store_true",
                        help="Skip chart generation in backtest")
    parser.add_argument("--version", choices=["v1", "v2"], default="v1",
                        help="Risk score version for backtest")
    parser.add_argument("--years", type=int, default=10,
                        help="Years of history for extend-history command")
    args = parser.parse_args()

    _setup_logging(args.verbose)

    cmd = {
        "init": cmd_init,
        "backfill": cmd_backfill,
        "daily": lambda: cmd_daily(skip_push=args.skip_push),
        "weekly": cmd_weekly,
        "report": cmd_report,
        "alerts": cmd_alerts,
        "inspect": cmd_inspect,
        "fetch-external": cmd_fetch_external,
        "migrate": cmd_migrate,
        "report-snapshot": lambda: cmd_report_snapshot(push_telegram=not args.skip_push),
        "backtest": lambda: cmd_backtest(
            generate_charts=not args.skip_charts,
            version=args.version,
        ),
        "score-v2": cmd_score_v2,
        "extend-history": lambda: cmd_extend_history(years=args.years),
    }[args.command]
    cmd()


if __name__ == "__main__":
    main()
