"""
US Market Dashboard - SQLite Storage Layer
统一的数据存储接口，沿用 JunQuant 的 SQLite 风格
"""
import sqlite3
import logging
from contextlib import contextmanager
from datetime import datetime, date
from typing import Iterable, Optional

import pandas as pd

from us_market_dashboard.config.settings import DB_PATH

logger = logging.getLogger(__name__)


# ============ 表结构 ============
SCHEMA = {
    # 价格 (OHLCV) - 通用，覆盖 ETF / 指数 / 期货
    "prices": """
        CREATE TABLE IF NOT EXISTS prices (
            symbol      TEXT NOT NULL,
            date        TEXT NOT NULL,
            open        REAL,
            high        REAL,
            low         REAL,
            close       REAL,
            adj_close   REAL,
            volume      INTEGER,
            updated_at  TEXT,
            PRIMARY KEY (symbol, date)
        )
    """,
    # 因子拥挤度时间序列
    "factor_crowding": """
        CREATE TABLE IF NOT EXISTS factor_crowding (
            factor          TEXT NOT NULL,
            date            TEXT NOT NULL,
            ratio           REAL,         -- long/short 比值原始值
            ret_60d         REAL,         -- 多空 60 日累计收益
            vol_60d         REAL,         -- 多空 60 日波动率
            valuation_proxy REAL,         -- 估值代理（待扩展）
            crowding_score  REAL,         -- 综合拥挤度 [0,1]
            zscore          REAL,         -- 比值的 z-score
            updated_at      TEXT,
            PRIMARY KEY (factor, date)
        )
    """,
    # 期权情绪（CBOE PCR 等）
    "option_sentiment": """
        CREATE TABLE IF NOT EXISTS option_sentiment (
            date            TEXT NOT NULL,
            metric          TEXT NOT NULL,  -- 'equity_pcr', 'index_pcr', 'total_pcr'
            value           REAL,
            ma20            REAL,
            percentile_750  REAL,
            updated_at      TEXT,
            PRIMARY KEY (date, metric)
        )
    """,
    # 技术指标（SOX 偏离等）
    "technical_indicators": """
        CREATE TABLE IF NOT EXISTS technical_indicators (
            symbol          TEXT NOT NULL,
            date            TEXT NOT NULL,
            indicator       TEXT NOT NULL,  -- 'dev_ma20', 'rsi14', 'dist_52w_high'
            value           REAL,
            updated_at      TEXT,
            PRIMARY KEY (symbol, date, indicator)
        )
    """,
    # CTA 信号（自构建多周期均线）
    "cta_signals": """
        CREATE TABLE IF NOT EXISTS cta_signals (
            date            TEXT NOT NULL,
            asset           TEXT NOT NULL,  -- 'ES', 'NQ', 'ZN', ...
            signal          REAL,           -- 范围 [-1, 1]
            window_signals  TEXT,           -- JSON: 各周期单独信号
            updated_at      TEXT,
            PRIMARY KEY (date, asset)
        )
    """,
    # CTA 综合信号
    "cta_aggregate": """
        CREATE TABLE IF NOT EXISTS cta_aggregate (
            date            TEXT PRIMARY KEY,
            equity_signal   REAL,
            bond_signal     REAL,
            commodity_signal REAL,
            fx_signal       REAL,
            overall_signal  REAL,
            updated_at      TEXT
        )
    """,
    # CFTC COT 持仓
    "cftc_cot": """
        CREATE TABLE IF NOT EXISTS cftc_cot (
            report_date     TEXT NOT NULL,
            contract        TEXT NOT NULL,  -- 'ES', 'NQ', 'ZN', ...
            trader_type     TEXT NOT NULL DEFAULT 'lev_money',  -- 'lev_money' | 'asset_mgr'
            mm_long         INTEGER,
            mm_short        INTEGER,
            mm_net          INTEGER,
            mm_net_pct_oi   REAL,
            updated_at      TEXT,
            PRIMARY KEY (report_date, contract, trader_type)
        )
    """,
    # 告警历史（防止重复推送）
    "alerts_history": """
        CREATE TABLE IF NOT EXISTS alerts_history (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            alert_date      TEXT NOT NULL,
            alert_type      TEXT NOT NULL,
            severity        TEXT NOT NULL,   -- 'info', 'warn', 'alert'
            message         TEXT,
            metric_value    REAL,
            sent_at         TEXT
        )
    """,
}

INDEX_DDL = [
    "CREATE INDEX IF NOT EXISTS idx_prices_date ON prices(date)",
    "CREATE INDEX IF NOT EXISTS idx_crowding_date ON factor_crowding(date)",
    "CREATE INDEX IF NOT EXISTS idx_alerts_date ON alerts_history(alert_date)",
]


@contextmanager
def get_conn():
    """上下文管理器，自动 commit / close"""
    conn = sqlite3.connect(DB_PATH, timeout=30, isolation_level=None)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    try:
        yield conn
    finally:
        conn.close()


def init_db():
    """初始化所有表"""
    with get_conn() as conn:
        cur = conn.cursor()
        for name, ddl in SCHEMA.items():
            cur.execute(ddl)
            logger.debug(f"Initialized table: {name}")
        for idx in INDEX_DDL:
            cur.execute(idx)
        conn.commit()
    logger.info(f"Database initialized at {DB_PATH}")


def upsert_prices(df: pd.DataFrame, symbol: str):
    """
    Upsert 价格数据
    df 要求列: date, open, high, low, close, adj_close, volume
    """
    if df is None or df.empty:
        return 0

    df = df.copy()
    df["symbol"] = symbol
    df["updated_at"] = datetime.utcnow().isoformat()

    # 标准化列
    if "Adj Close" in df.columns:
        df = df.rename(columns={
            "Open": "open", "High": "high", "Low": "low",
            "Close": "close", "Adj Close": "adj_close", "Volume": "volume"
        })
    if "date" not in df.columns:
        df = df.reset_index().rename(columns={"Date": "date", "index": "date"})
    df["date"] = pd.to_datetime(df["date"]).dt.strftime("%Y-%m-%d")

    cols = ["symbol", "date", "open", "high", "low", "close",
            "adj_close", "volume", "updated_at"]
    # 确保所有列都存在
    for c in cols:
        if c not in df.columns:
            df[c] = None
    df = df[cols]

    rows = [tuple(x) for x in df.itertuples(index=False, name=None)]
    sql = """
        INSERT INTO prices (symbol, date, open, high, low, close, adj_close, volume, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(symbol, date) DO UPDATE SET
            open=excluded.open, high=excluded.high, low=excluded.low,
            close=excluded.close, adj_close=excluded.adj_close,
            volume=excluded.volume, updated_at=excluded.updated_at
    """
    with get_conn() as conn:
        conn.executemany(sql, rows)
    return len(rows)


def load_prices(symbol: str, start: Optional[str] = None,
                end: Optional[str] = None, use_adj: bool = True) -> pd.DataFrame:
    """读取某个 symbol 的价格序列"""
    sql = "SELECT date, open, high, low, close, adj_close, volume FROM prices WHERE symbol = ?"
    params = [symbol]
    if start:
        sql += " AND date >= ?"
        params.append(start)
    if end:
        sql += " AND date <= ?"
        params.append(end)
    sql += " ORDER BY date"
    with get_conn() as conn:
        df = pd.read_sql_query(sql, conn, params=params, parse_dates=["date"])
    if df.empty:
        return df
    df = df.set_index("date")
    # 用复权价做主收盘价
    if use_adj and df["adj_close"].notna().any():
        df["close"] = df["adj_close"].fillna(df["close"])
    return df


def upsert_factor_crowding(records: Iterable[dict]):
    """批量写入因子拥挤度"""
    sql = """
        INSERT INTO factor_crowding
        (factor, date, ratio, ret_60d, vol_60d, valuation_proxy, crowding_score, zscore, updated_at)
        VALUES (:factor, :date, :ratio, :ret_60d, :vol_60d, :valuation_proxy,
                :crowding_score, :zscore, :updated_at)
        ON CONFLICT(factor, date) DO UPDATE SET
            ratio=excluded.ratio, ret_60d=excluded.ret_60d, vol_60d=excluded.vol_60d,
            valuation_proxy=excluded.valuation_proxy,
            crowding_score=excluded.crowding_score, zscore=excluded.zscore,
            updated_at=excluded.updated_at
    """
    records = list(records)
    if not records:
        return 0
    now = datetime.utcnow().isoformat()
    for r in records:
        r.setdefault("updated_at", now)
        for k in ("ratio", "ret_60d", "vol_60d", "valuation_proxy",
                  "crowding_score", "zscore"):
            r.setdefault(k, None)
    with get_conn() as conn:
        conn.executemany(sql, records)
    return len(records)


def upsert_option_sentiment(records: Iterable[dict]):
    sql = """
        INSERT INTO option_sentiment (date, metric, value, ma20, percentile_750, updated_at)
        VALUES (:date, :metric, :value, :ma20, :percentile_750, :updated_at)
        ON CONFLICT(date, metric) DO UPDATE SET
            value=excluded.value, ma20=excluded.ma20,
            percentile_750=excluded.percentile_750, updated_at=excluded.updated_at
    """
    records = list(records)
    if not records:
        return 0
    now = datetime.utcnow().isoformat()
    for r in records:
        r.setdefault("updated_at", now)
        r.setdefault("ma20", None)
        r.setdefault("percentile_750", None)
    with get_conn() as conn:
        conn.executemany(sql, records)
    return len(records)


def upsert_technical(records: Iterable[dict]):
    sql = """
        INSERT INTO technical_indicators (symbol, date, indicator, value, updated_at)
        VALUES (:symbol, :date, :indicator, :value, :updated_at)
        ON CONFLICT(symbol, date, indicator) DO UPDATE SET
            value=excluded.value, updated_at=excluded.updated_at
    """
    records = list(records)
    if not records:
        return 0
    now = datetime.utcnow().isoformat()
    for r in records:
        r.setdefault("updated_at", now)
    with get_conn() as conn:
        conn.executemany(sql, records)
    return len(records)


def upsert_cta_signals(records: Iterable[dict]):
    sql = """
        INSERT INTO cta_signals (date, asset, signal, window_signals, updated_at)
        VALUES (:date, :asset, :signal, :window_signals, :updated_at)
        ON CONFLICT(date, asset) DO UPDATE SET
            signal=excluded.signal, window_signals=excluded.window_signals,
            updated_at=excluded.updated_at
    """
    records = list(records)
    if not records:
        return 0
    now = datetime.utcnow().isoformat()
    for r in records:
        r.setdefault("updated_at", now)
    with get_conn() as conn:
        conn.executemany(sql, records)
    return len(records)


def upsert_cta_aggregate(records: Iterable[dict]):
    sql = """
        INSERT INTO cta_aggregate
        (date, equity_signal, bond_signal, commodity_signal, fx_signal, overall_signal, updated_at)
        VALUES (:date, :equity_signal, :bond_signal, :commodity_signal,
                :fx_signal, :overall_signal, :updated_at)
        ON CONFLICT(date) DO UPDATE SET
            equity_signal=excluded.equity_signal,
            bond_signal=excluded.bond_signal,
            commodity_signal=excluded.commodity_signal,
            fx_signal=excluded.fx_signal,
            overall_signal=excluded.overall_signal,
            updated_at=excluded.updated_at
    """
    records = list(records)
    if not records:
        return 0
    now = datetime.utcnow().isoformat()
    for r in records:
        r.setdefault("updated_at", now)
        for k in ("equity_signal", "bond_signal", "commodity_signal",
                  "fx_signal", "overall_signal"):
            r.setdefault(k, None)
    with get_conn() as conn:
        conn.executemany(sql, records)
    return len(records)


def upsert_cftc(records: Iterable[dict]):
    sql = """
        INSERT INTO cftc_cot
        (report_date, contract, trader_type, mm_long, mm_short, mm_net, mm_net_pct_oi, updated_at)
        VALUES (:report_date, :contract, :trader_type, :mm_long, :mm_short, :mm_net,
                :mm_net_pct_oi, :updated_at)
        ON CONFLICT(report_date, contract, trader_type) DO UPDATE SET
            mm_long=excluded.mm_long, mm_short=excluded.mm_short,
            mm_net=excluded.mm_net, mm_net_pct_oi=excluded.mm_net_pct_oi,
            updated_at=excluded.updated_at
    """
    records = list(records)
    if not records:
        return 0
    now = datetime.utcnow().isoformat()
    for r in records:
        r.setdefault("updated_at", now)
        r.setdefault("trader_type", "lev_money")
    with get_conn() as conn:
        conn.executemany(sql, records)
    return len(records)


def log_alert(alert_type: str, severity: str, message: str,
              metric_value: Optional[float] = None,
              alert_date: Optional[str] = None):
    if alert_date is None:
        alert_date = date.today().isoformat()
    sql = """
        INSERT INTO alerts_history
        (alert_date, alert_type, severity, message, metric_value, sent_at)
        VALUES (?, ?, ?, ?, ?, ?)
    """
    with get_conn() as conn:
        conn.execute(sql, (alert_date, alert_type, severity, message,
                           metric_value, datetime.utcnow().isoformat()))


def alert_already_sent(alert_type: str, alert_date: str) -> bool:
    """避免同一告警当天重复推送"""
    sql = """
        SELECT 1 FROM alerts_history
        WHERE alert_date = ? AND alert_type = ? LIMIT 1
    """
    with get_conn() as conn:
        cur = conn.execute(sql, (alert_date, alert_type))
        return cur.fetchone() is not None


def latest_date(symbol: str) -> Optional[str]:
    """某个 symbol 最近一条价格的日期"""
    with get_conn() as conn:
        cur = conn.execute(
            "SELECT MAX(date) FROM prices WHERE symbol = ?", (symbol,)
        )
        row = cur.fetchone()
        return row[0] if row and row[0] else None
