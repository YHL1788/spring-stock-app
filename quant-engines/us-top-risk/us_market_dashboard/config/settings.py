"""
US Market Dashboard - Configuration
配置所有数据源、ETF代理、阈值、推送参数
"""
import os
from pathlib import Path

# ============ 路径 ============
BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.environ.get("USMD_DATA_DIR", BASE_DIR / "data"))
LOG_DIR = Path(os.environ.get("USMD_LOG_DIR", BASE_DIR / "logs"))
DATA_DIR.mkdir(parents=True, exist_ok=True)
LOG_DIR.mkdir(parents=True, exist_ok=True)

DB_PATH = DATA_DIR / "us_market.db"

# ============ Telegram 推送 ============
# 沿用 OpenClaw / 俊靓 的配置方式：环境变量优先
TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID = os.environ.get("TELEGRAM_CHAT_ID", "")
TELEGRAM_ENABLED = bool(TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID)

# ============ 因子拥挤度 ETF 映射 ============
# 每个因子 = (多头ETF, 对手ETF或基准, 显示名)
FACTOR_PROXIES = {
    "momentum": {
        "long": "MTUM",      # iShares MSCI USA Momentum
        "short": "SPY",      # 对基准
        "name": "动量因子",
        "description": "MTUM 相对 SPY 的相对强度",
    },
    "high_beta": {
        "long": "SPHB",      # Invesco S&P 500 High Beta
        "short": "SPLV",     # Invesco S&P 500 Low Volatility
        "name": "高 Beta",
        "description": "SPHB / SPLV 多空价差",
    },
    "high_vol": {
        "long": "SPHB",
        "short": "USMV",     # iShares MSCI USA Min Vol
        "name": "高波动率",
        "description": "SPHB / USMV 多空价差（高波动 vs 最低波动）",
    },
    "speculative_growth": {
        "long": "ARKK",      # ARK Innovation
        "short": "SPY",
        "name": "投机性增长",
        "description": "ARKK 相对 SPY，反映高估值无盈利成长股情绪",
    },
    "junk_quality": {
        # 反向：QUAL 弱势 = 垃圾股强势
        "long": "SPY",
        "short": "QUAL",     # iShares MSCI USA Quality
        "name": "垃圾股(低质量)",
        "description": "SPY / QUAL，比值升高表明低质量跑赢，垃圾股拥挤",
    },
}

# ============ 关键指数与板块 ============
INDICES = {
    "^GSPC": "S&P 500",
    "^NDX": "Nasdaq 100",
    "^SOX": "费城半导体指数",
    "^RUT": "Russell 2000",
    "^VIX": "VIX 恐慌指数",
    "^VIX3M": "VIX 3个月波动率",
    "^SKEW": "SKEW 尾部风险",
}

# 关键 ETF（用于偏离度等技术指标）
KEY_TICKERS = ["SPY", "QQQ", "SOXX", "SMH", "IWM", "DIA", "ARKK", "MTUM", "QUAL", "NVDA"]

# 反向领先指标对（v2 评分系统用）
# 每对：(numerator, denominator, name)
# 含义：分子相对于分母走弱 = bearish for risk assets
LEADING_INDICATOR_PAIRS = {
    "junk_quality_spread": ("HYG", "LQD",
                            "高收益债 vs 投资级债（信用利差）"),
    "small_vs_large":      ("IWM", "SPY",
                            "小盘 vs 大盘"),
    "semi_vs_market":      ("SOXX", "SPY",
                            "半导体 vs 大盘"),
    "transports_vs_indus": ("IYT", "XLI",
                            "运输 vs 工业（道氏理论）"),
    "discretionary_staples": ("XLY", "XLP",
                              "可选消费 vs 必需消费"),
}
# 把所有用到的 ETF 也加入需要下载的列表
LEADING_TICKERS = sorted(set(
    [pair[0] for pair in LEADING_INDICATOR_PAIRS.values()]
    + [pair[1] for pair in LEADING_INDICATOR_PAIRS.values()]
))

# 用于技术指标计算的扩展列表（含指数）
TECHNICAL_SYMBOLS = (KEY_TICKERS + ["^SOX", "^NDX", "^GSPC", "^RUT", "^VIX"]
                     + LEADING_TICKERS)

# ============ 期权情绪数据源 ============
# CBOE Equity Put/Call Ratio - 2026 实测有效的 URL
# (旧 URL cdn.cboe.com/api/global/... 已 403)
CBOE_PCR_URL = "https://cdn.cboe.com/resources/options/volume_and_call_put_ratios/equitypc.csv"
# 备用：index P/C
CBOE_INDEX_PCR_URL = "https://cdn.cboe.com/resources/options/volume_and_call_put_ratios/indexpcarchive.csv"

# 备用：Stooq（无需 API key 的指数下载源）
STOOQ_BASE = "https://stooq.com/q/d/l/"

# ============ CTA / 持仓数据 ============
# Société Générale CTA Index（业绩基准，Yahoo 上有的代理）
SG_CTA_PROXY = "DBMF"  # iMGP DBi Managed Futures Strategy ETF（CTA 复制 ETF）
# 备选：KMLM（KFA Mount Lucas Managed Futures Index Strategy）

# CTA 信号自构建：多周期均线
# 注：yfinance 频繁下架期货合约 (^CPCE, DX=F 等已下架)
# 优先使用 ETF 主源，因为它们是真实交易品种，不会下架
CTA_SIGNAL_ASSETS = {
    "ES": "ES=F",      # 标普期货
    "NQ": "NQ=F",      # 纳指期货
    "ZN": "IEF",       # 7-10Y 国债 ETF (替代 ZN=F，更稳定)
    "GC": "GLD",       # 黄金 ETF (替代 GC=F)
    "CL": "USO",       # 原油 ETF (替代 CL=F)
    "DX": "UUP",       # 美元 ETF (DX=F 已下架)
}
# 备选 ticker（主 ticker 缺数据时自动 fallback）
CTA_SIGNAL_FALLBACKS = {
    "ES": ["SPY"],     # SPY 等价
    "NQ": ["QQQ"],     # QQQ 等价
    "ZN": ["ZN=F"],    # 期货作为备选
    "GC": ["GC=F"],
    "CL": ["CL=F"],
    "DX": ["DX=F"],
}
CTA_SIGNAL_WINDOWS = [20, 50, 100, 200]

# CFTC COT Report
CFTC_COT_FIN_URL = "https://www.cftc.gov/dea/newcot/FinFutWk.txt"
# 替代：用 sodapy 访问 https://publicreporting.cftc.gov 的 socrata API

# ============ 阈值 / 告警 ============
# 拥挤度分位数阈值（基于 750 日滚动）
CROWDING_LOOKBACK_DAYS = 750     # 约 3 年交易日
CROWDING_WARN = 0.85             # 黄色预警
CROWDING_ALERT = 0.95            # 红色告警
CROWDING_OVERSOLD = 0.05         # 反向：极度低迷

# SOX 偏离 20 日均线
SOX_DEVIATION_WARN = 0.10        # 10%
SOX_DEVIATION_ALERT = 0.15       # 15%

# CBOE PCR 极值
PCR_LOW = 0.55                   # 极低 = call 投机过热
PCR_HIGH = 1.20                  # 极高 = put 恐慌

# CTA 信号
CTA_SIGNAL_EXTREME = 0.75        # |signal| > 0.75 视为极端持仓

# ============ HTTP 设置 ============
HTTP_TIMEOUT = 30
HTTP_HEADERS = {
    # 一些数据源会拒绝 default User-Agent
    "User-Agent": "Mozilla/5.0 (compatible; JunQuant-USMD/1.0)"
}

# ============ 数据回填 ============
HISTORICAL_LOOKBACK = "5y"       # yfinance 拉取历史长度
MIN_HISTORY_FOR_RANK = 252       # 计算分位数所需最少历史天数
