"""
End-to-end smoke test
快速验证 pipeline 能跑通（不需要 Telegram，使用少量 symbol）
"""
import logging
import sys
import tempfile
from pathlib import Path

# 把项目根加到路径
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

# 用临时 db 测试，避免污染
import os
tmp_dir = Path(tempfile.mkdtemp(prefix="usmd_test_"))
os.environ["USMD_DATA_DIR"] = str(tmp_dir)
os.environ["USMD_LOG_DIR"] = str(tmp_dir)

# 这里要在设置环境变量后再 import
from us_market_dashboard.storage import db
from us_market_dashboard.analyzers import crowding, technical, cta
from us_market_dashboard.notifiers import reports
import pandas as pd
import numpy as np

logging.basicConfig(level=logging.INFO, format="%(levelname)s | %(message)s")


def make_synthetic_prices(symbol: str, days: int = 800, seed: int = 0,
                          drift: float = 0.0003) -> pd.DataFrame:
    """生成 synthetic 价格数据，避免真实网络依赖"""
    rng = np.random.default_rng(seed)
    rets = rng.normal(drift, 0.012, days)
    px = 100 * np.exp(np.cumsum(rets))
    dates = pd.bdate_range(end=pd.Timestamp.today().normalize(), periods=days)
    return pd.DataFrame({
        "date": dates,
        "open": px * (1 + rng.normal(0, 0.001, days)),
        "high": px * (1 + np.abs(rng.normal(0, 0.005, days))),
        "low": px * (1 - np.abs(rng.normal(0, 0.005, days))),
        "close": px,
        "adj_close": px,
        "volume": rng.integers(1_000_000, 10_000_000, days),
    })


def seed_test_data():
    """填充所有需要的 symbol 的 synthetic 价格"""
    from us_market_dashboard.config.settings import (
        FACTOR_PROXIES, KEY_TICKERS, CTA_SIGNAL_ASSETS,
    )
    syms = set()
    for cfg in FACTOR_PROXIES.values():
        syms.add(cfg["long"])
        syms.add(cfg["short"])
    syms.update(KEY_TICKERS)
    syms.update(CTA_SIGNAL_ASSETS.values())
    syms.update(["^SOX", "^NDX", "^GSPC", "^RUT"])

    for i, sym in enumerate(sorted(syms)):
        # 不同 seed 模拟不同走势
        # 故意让 ARKK 走势相对 SPY 强 → 投机性增长拥挤度高
        if sym == "ARKK":
            df = make_synthetic_prices(sym, seed=i, drift=0.0010)
        elif sym == "SPHB":
            df = make_synthetic_prices(sym, seed=i, drift=0.0008)
        elif sym == "^SOX":
            df = make_synthetic_prices(sym, seed=i, drift=0.0012)
        else:
            df = make_synthetic_prices(sym, seed=i)
        db.upsert_prices(df, sym)


def test_pipeline():
    print("\n=== 1. Init DB ===")
    db.init_db()

    print("\n=== 2. Seed synthetic prices ===")
    seed_test_data()

    print("\n=== 3. Compute factor crowding ===")
    summary = crowding.update_all_factors()
    print(f"  Factor records: {summary}")
    snap = crowding.latest_snapshot()
    print("\n  Latest crowding snapshot:")
    print(snap.to_string(index=False))

    print("\n=== 4. Compute technical indicators ===")
    n = technical.update_technical(["^SOX", "^NDX", "^GSPC", "SPY", "QQQ"])
    print(f"  Technical records: {n}")
    sox = technical.latest_indicator("^SOX", "dev_ma20")
    print(f"  ^SOX dev_ma20: {sox}")

    print("\n=== 5. Compute CTA signals ===")
    n = cta.update_cta_signals()
    print(f"  CTA records: {n}")
    cta_data = cta.latest_cta()
    print(f"  Latest aggregate: {cta_data['aggregate']}")

    print("\n=== 6. Build reports ===")
    daily = reports.build_daily_report()
    print("--- DAILY REPORT ---")
    print(daily)
    print()

    print("--- ALERTS ---")
    alerts = reports.collect_alerts()
    for a in alerts:
        print(f"  [{a['severity']}] {a['type']}")
        print(f"    {a['message']}")

    print("\n--- WEEKLY REPORT ---")
    weekly = reports.build_weekly_report()
    print(weekly)


if __name__ == "__main__":
    test_pipeline()
    print(f"\n✓ All tests passed. Test data in: {tmp_dir}")
