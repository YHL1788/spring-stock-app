import { NextResponse } from 'next/server';

const API_TOKEN = process.env.EOD_API_KEY;
const BASE_URL_EOD = 'https://eodhd.com/api';
const BASE_URL_YAHOO_CHART = 'https://query1.finance.yahoo.com/v8/finance/chart';
const BASE_URL_YAHOO_SUMMARY = 'https://query1.finance.yahoo.com/v10/finance/quoteSummary';
const BASE_URL_YAHOO_NEWS = 'https://query1.finance.yahoo.com/v1/finance/search';

const YAHOO_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
};

// --- 1. 核心工具：判断数据源 ---
function getDataSource(symbol) {
  const s = symbol.toUpperCase();
  
  // 统一策略：
  // 1. 加密货币 (-USD) -> Yahoo (例如 BTC-USD)
  // 2. 期货 (=F) -> Yahoo (例如 GC=F)
  // 3. 外汇 (=X) -> Yahoo (例如 USDCNY=X)
  // 4. 指数 (^) -> Yahoo (例如 ^GSPC)
  // 5. 亚洲市场 (.T, .SS, .SZ) -> Yahoo
  if (s.includes('-USD') || s.endsWith('=F') || s.endsWith('=X') || s.startsWith('^') || s.endsWith('.T') || s.endsWith('.SS') || s.endsWith('.SZ')) {
    return 'YAHOO';
  }
  
  // 默认走 EODHD (主要用于美股个股 .US 和港股 .HK，获取更详细的基本面)
  return 'EODHD';
}

// --- 2. 代码格式化 ---
function formatSymbol(rawSymbol, source) {
  let s = rawSymbol.trim().toUpperCase();
  
  if (source === 'YAHOO') {
    // Yahoo 格式清洗
    if (s.endsWith('.TO')) return s.replace(/\.TO$/, '.T');
    if (s.endsWith('.JT')) return s.replace(/\.JT$/, '.T');
    return s;
  } else {
    // EODHD 格式清洗
    if (!s.includes('.') && !s.includes('=') && !s.includes('^') && !s.includes('-')) {
      return `${s}`;
    }
    return s;
  }
}

// ==========================================
// A. Yahoo 数据引擎
// ==========================================

async function fetchYahooFullData(symbol, range = '1d') {
  try {
    let interval = '1d';
    // 自动适配 Interval 以获取适合画图的数据密度
    if (range === '1d') interval = '2m';
    else if (range === '5d') interval = '15m';
    else if (['1mo', '3mo'].includes(range)) interval = '1d';
    else interval = '1d'; // 1y, 5y, ytd 使用日线

    const priceRes = await fetch(`${BASE_URL_YAHOO_CHART}/${symbol}?interval=${interval}&range=${range}`, { headers: YAHOO_HEADERS, next: { revalidate: 0 } });
    const priceJson = priceRes.ok ? await priceRes.json() : null;
    const result = priceJson?.chart?.result?.[0];
    const meta = result?.meta;

    if (!meta) return null;

    const timestamps = result.timestamp || [];
    const quotes = result.indicators?.quote?.[0] || {};
    const history = timestamps.map((t, i) => ({
      time: t * 1000,
      close: quotes.close?.[i],
      volume: quotes.volume?.[i]
    })).filter(d => d.close !== null && d.close !== undefined);

    // 获取简要数据 (主要为了市值等信息，Crypto/期货可能没有完整的 SummaryDetail)
    const modules = ['summaryDetail', 'price']; 
    const summaryRes = await fetch(`${BASE_URL_YAHOO_SUMMARY}/${symbol}?modules=${modules.join('%2C')}`, { headers: YAHOO_HEADERS, next: { revalidate: 3600 } });
    const summaryJson = summaryRes.ok ? await summaryRes.json() : null;
    const qs = summaryJson?.quoteSummary?.result?.[0] || {};
    const sd = qs.summaryDetail || {};
    
    return {
      symbol: symbol,
      name: meta.symbol, // Crypto 通常没有 longName，用 symbol 代替
      currency: meta.currency,
      price: meta.regularMarketPrice,
      change: meta.regularMarketPrice - meta.chartPreviousClose,
      changePercent: ((meta.regularMarketPrice - meta.chartPreviousClose) / meta.chartPreviousClose) * 100,
      history: history, // K线数据 (用于 Sparkline)

      trading: {
        dayHigh: meta.regularMarketDayHigh || meta.regularMarketPrice,
        dayLow: meta.regularMarketDayLow || meta.regularMarketPrice,
        volume: meta.regularMarketVolume || 0,
      },
      stats: {
        marketCap: sd.marketCap?.fmt || '--',
      }
    };
  } catch (e) {
    console.error("Yahoo Fetch Error:", e);
    return null;
  }
}

// ==========================================
// B. EODHD 数据引擎
// ==========================================

async function fetchEODFullData(symbol, range = '1d') {
  if (!API_TOKEN) return null;
  try {
    // 1. 获取实时价格
    const priceRes = await fetch(`${BASE_URL_EOD}/real-time/${symbol}?api_token=${API_TOKEN}&fmt=json`, { next: { revalidate: 0 } });
    const priceData = priceRes.ok ? await priceRes.json() : null;

    if (!priceData || priceData.close === undefined) return null;

    // 2. 尝试获取历史数据 (如果不成功则为空)
    // 注意：这里保留 EODHD 历史数据逻辑，以防后续有必须走 EOD 的资产需要画图
    let history = []; 
    // ... (此处省略 EOD 历史数据获取逻辑，因为当前重点是 Yahoo) ...

    return {
      symbol: symbol,
      name: symbol,
      currency: 'USD',
      price: priceData.close,
      change: priceData.change || 0,
      changePercent: priceData.change_p || 0, 
      history: history,

      trading: {
        dayHigh: priceData.high || priceData.close,
        dayLow: priceData.low || priceData.close,
        volume: priceData.volume || 0,
      },
      stats: {
        marketCap: '--',
      }
    };
  } catch (e) {
    console.error("EOD Full Fetch Error:", e);
    return null;
  }
}

// ==========================================
// 主入口
// ==========================================

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const rawSymbol = searchParams.get('symbol');
  const range = searchParams.get('range') || '1d';

  if (!rawSymbol) return NextResponse.json({ error: 'Missing symbol' }, { status: 400 });

  const source = getDataSource(rawSymbol);
  const symbol = formatSymbol(rawSymbol, source);
  
  let data = null;

  if (source === 'YAHOO') {
    data = await fetchYahooFullData(symbol, range);
  } else {
    data = await fetchEODFullData(symbol, range);
  }

  // 兜底逻辑：如果 EODHD 没拿到历史数据，尝试用 Yahoo 补全
  if ((!data || !data.history || data.history.length === 0) && source === 'EODHD') {
     const fallbackSymbol = symbol.replace('.US', ''); 
     const yahooData = await fetchYahooFullData(fallbackSymbol, range);
     if (yahooData && yahooData.history) {
        if (!data) data = yahooData;
        else data.history = yahooData.history;
     }
  }

  if (!data) {
    return NextResponse.json({ error: 'Symbol not found' }, { status: 404 });
  }

  // 统一汇率处理 (HKD)
  const rates = { 'USD': 7.8, 'JPY': 0.052, 'CNY': 1.08, 'EUR': 8.5, 'GBP': 9.8 };
  let priceInHKD = data.price;
  if (data.currency !== 'HKD' && rates[data.currency]) {
    priceInHKD = data.price * rates[data.currency];
  }
  data.priceInHKD = priceInHKD;

  return NextResponse.json(data);
}