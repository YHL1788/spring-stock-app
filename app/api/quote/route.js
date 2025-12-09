import { NextResponse } from 'next/server';

const API_TOKEN = process.env.EOD_API_KEY;
const BASE_URL_EOD = 'https://eodhd.com/api';
const BASE_URL_YAHOO_CHART = 'https://query1.finance.yahoo.com/v8/finance/chart';
const BASE_URL_YAHOO_SUMMARY = 'https://query1.finance.yahoo.com/v10/finance/quoteSummary';
const BASE_URL_YAHOO_NEWS = 'https://query1.finance.yahoo.com/v1/finance/search';

const YAHOO_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
};

// --- 1. 核心工具：判断数据源 (保留原样，未修改) ---
function getDataSource(symbol) {
  const s = symbol.toUpperCase();
  // 如果是 日股(.T), 上海(.SS), 深圳(.SZ)，强制使用 Yahoo
  if (s.endsWith('.T') || s.endsWith('.SS') || s.endsWith('.SZ') || s.startsWith('^')) {
    return 'YAHOO';
  }
  // 其他 (美股 .US, 港股 .HK 等) 使用 EODHD
  return 'EODHD';
}

// --- 2. 代码格式化 (保留原样，未修改) ---
function formatSymbol(rawSymbol, source) {
  let s = rawSymbol.trim().toUpperCase();
  
  if (source === 'YAHOO') {
    // Yahoo 习惯: 7203.T (东京), 600519.SS (上海)
    // 兼容用户可能输入的 .TO (EOD习惯) -> 转 .T
    if (s.endsWith('.TO')) return s.replace(/\.TO$/, '.T');
    // 兼容 Bloomberg .JT -> .T
    if (s.endsWith('.JT')) return s.replace(/\.JT$/, '.T');
    return s;
  } else {
    // EODHD 习惯: AAPL.US, 0700.HK
    // 美股补全 .US
    if (!s.includes('.') && !s.includes('=') && !s.includes('^')) {
      return `${s}.US`;
    }
    // EODHD 对日股通常用 .TO，但既然日股走了 Yahoo，这里主要处理其他市场
    return s;
  }
}

// ==========================================
// A. Yahoo 数据引擎 (针对 .T, .SS, .SZ)
// ==========================================

async function fetchYahooFullData(symbol, range = '1d') {
  try {
    // 动态调整 interval (新增逻辑)
    let interval = '1d';
    if (range === '1d') interval = '2m';       // 1天 -> 2分钟K线
    else if (range === '5d') interval = '15m'; // 5天 -> 15分钟K线
    else if (['1mo', '3mo'].includes(range)) interval = '1d'; // 短期 -> 日K
    else interval = '1wk'; // 长期 -> 周K

    // 1. 获取价格 (Chart API) - 传入 range 和 interval
    const priceRes = await fetch(`${BASE_URL_YAHOO_CHART}/${symbol}?interval=${interval}&range=${range}`, { headers: YAHOO_HEADERS, next: { revalidate: 0 } });
    const priceJson = priceRes.ok ? await priceRes.json() : null;
    const result = priceJson?.chart?.result?.[0];
    const meta = result?.meta;

    if (!meta) return null; // 价格都没有，视为失败

    // 解析历史数据 (用于前端图表)
    const timestamps = result.timestamp || [];
    const quotes = result.indicators?.quote?.[0] || {};
    const history = timestamps.map((t, i) => ({
      time: t * 1000,
      open: quotes.open?.[i],
      high: quotes.high?.[i],
      low: quotes.low?.[i],
      close: quotes.close?.[i],
      volume: quotes.volume?.[i]
    })).filter(d => d.close !== null && d.close !== undefined); // 过滤无效数据点

    // 2. 获取深度基本面 (QuoteSummary API)
    const modules = ['summaryDetail', 'defaultKeyStatistics', 'assetProfile', 'financialData', 'earnings', 'recommendationTrend'];
    const summaryRes = await fetch(`${BASE_URL_YAHOO_SUMMARY}/${symbol}?modules=${modules.join('%2C')}`, { headers: YAHOO_HEADERS, next: { revalidate: 3600 } });
    const summaryJson = summaryRes.ok ? await summaryRes.json() : null;
    const qs = summaryJson?.quoteSummary?.result?.[0] || {};

    // 3. 获取新闻 (Search API)
    const newsRes = await fetch(`${BASE_URL_YAHOO_NEWS}?q=${symbol}`, { headers: YAHOO_HEADERS, next: { revalidate: 600 } });
    const newsJson = newsRes.ok ? await newsRes.json() : null;
    const newsData = newsJson?.news || [];

    // 4. 数据组装
    const sd = qs.summaryDetail || {};
    const ap = qs.assetProfile || {};
    const fd = qs.financialData || {};
    const ks = qs.defaultKeyStatistics || {};
    const ern = qs.earnings?.financialsChart?.quarterly || [];

    return {
      symbol: symbol,
      name: meta.symbol, 
      currency: meta.currency,
      price: meta.regularMarketPrice,
      change: meta.regularMarketPrice - meta.chartPreviousClose,
      changePercent: ((meta.regularMarketPrice - meta.chartPreviousClose) / meta.chartPreviousClose) * 100,
      
      // 新增：返回历史数据供图表使用
      history: history,

      trading: {
        high52: meta.fiftyTwoWeekHigh || meta.regularMarketPrice,
        low52: meta.fiftyTwoWeekLow || meta.regularMarketPrice,
        volume: meta.regularMarketVolume || 0,
        avgVolume: meta.averageDailyVolume3Month || 0
      },
      stats: {
        marketCap: sd.marketCap?.fmt || '--',
        peRatio: sd.trailingPE?.raw || null,
        dividendYield: (sd.dividendYield?.raw || 0) * 100,
        beta: sd.beta?.raw || null,
        epsTrend: ern.map((e) => ({
          date: e.date,
          actual: e.actual?.raw || 0,
          estimate: e.estimate?.raw || 0
        }))
      },
      profile: {
        sector: ap.sector || 'N/A',
        industry: ap.industry || 'N/A',
        summary: ap.longBusinessSummary || '暂无描述',
        employees: ap.fullTimeEmployees || 0,
        website: ap.website || ''
      },
      financials: {
        profitMargins: (fd.profitMargins?.raw || 0) * 100,
        roa: (fd.returnOnAssets?.raw || 0) * 100,
        roe: (fd.returnOnEquity?.raw || 0) * 100,
        revenueGrowth: fd.revenueGrowth?.fmt || '--'
      },
      analysis: {
        recommendation: fd.recommendationKey || 'none',
        targetPrice: fd.targetMeanPrice?.raw || null,
        numberOfAnalyst: fd.numberOfAnalystOpinions?.raw || 0
      },
      news: newsData.slice(0, 6).map((item) => ({
        uuid: item.uuid,
        title: item.title,
        publisher: item.publisher,
        link: item.link,
        publishTime: item.providerPublishTime
      }))
    };
  } catch (e) {
    console.error("Yahoo Full Fetch Error:", e);
    return null;
  }
}

// ==========================================
// B. EODHD 数据引擎 (针对 .US, .HK 等)
// ==========================================

async function fetchEODFullData(symbol) {
  if (!API_TOKEN) return null;
  try {
    // 1. 获取实时价格
    const priceRes = await fetch(`${BASE_URL_EOD}/real-time/${symbol}?api_token=${API_TOKEN}&fmt=json`, { next: { revalidate: 0 } });
    const priceData = priceRes.ok ? await priceRes.json() : null;

    if (!priceData || priceData.close === undefined) return null;

    // 2. 获取深度基本面
    const fundRes = await fetch(`${BASE_URL_EOD}/fundamentals/${symbol}?api_token=${API_TOKEN}`, { next: { revalidate: 3600 } });
    const fundData = fundRes.ok ? await fundRes.json() : {};

    // 3. 获取新闻
    const newsRes = await fetch(`${BASE_URL_EOD}/news?s=${symbol}&api_token=${API_TOKEN}&limit=6`, { next: { revalidate: 600 } });
    const newsData = newsRes.ok ? await newsRes.json() : [];

    // 4. 数据组装
    const gen = fundData.General || {};
    const hl = fundData.Highlights || {};
    const val = fundData.Valuation || {};
    const tech = fundData.Technicals || {};
    const analyst = fundData.AnalystRatings || {};
    const earningsHistory = fundData.Earnings?.History || {};

    return {
      symbol: gen.Code || symbol,
      name: gen.Name || symbol,
      currency: gen.CurrencyCode || 'USD',
      price: priceData.close,
      change: priceData.change || 0,
      changePercent: priceData.change_p || 0, 

      trading: {
        high52: tech['52WeekHigh'] || priceData.close,
        low52: tech['52WeekLow'] || priceData.close,
        volume: priceData.volume || 0,
        avgVolume: 0 
      },
      stats: {
        marketCap: hl.MarketCapitalization ? (hl.MarketCapitalization / 1000000).toFixed(2) + 'M' : '--',
        peRatio: hl.PERatio || val.TrailingPE || null,
        dividendYield: (hl.DividendYield || 0) * 100,
        beta: tech.Beta || null,
        epsTrend: Object.values(earningsHistory || {})
          .slice(0, 4)
          .reverse()
          .map((e) => ({
            date: e.reportDate,
            actual: e.epsActual,
            estimate: e.epsEstimate
          }))
      },
      profile: {
        sector: gen.Sector || 'N/A',
        industry: gen.Industry || 'N/A',
        summary: gen.Description || '暂无描述',
        employees: gen.FullTimeEmployees || 0,
        website: gen.WebURL || ''
      },
      financials: {
        profitMargins: (hl.ProfitMargin || 0) * 100,
        roa: (hl.ReturnOnAssetsTTM || 0) * 100,
        roe: (hl.ReturnOnEquityTTM || 0) * 100,
        revenueGrowth: hl.RevenueTTM ? (hl.RevenueTTM / 1000000).toFixed(2) + 'M' : '--'
      },
      analysis: {
        recommendation: analyst.Rating || 'none',
        targetPrice: analyst.TargetPrice || null,
        numberOfAnalyst: 0
      },
      news: Array.isArray(newsData) ? newsData.slice(0, 6).map((item) => ({
        uuid: item.date + item.title,
        title: item.title,
        publisher: 'EOD News',
        link: item.link,
        publishTime: new Date(item.date).getTime() / 1000
      })) : []
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
  const range = searchParams.get('range') || '1d'; // 获取前端传入的 range

  if (!rawSymbol) return NextResponse.json({ error: 'Missing symbol' }, { status: 400 });

  // 1. 决定数据源
  const source = getDataSource(rawSymbol);
  const symbol = formatSymbol(rawSymbol, source);
  
  console.log(`Querying ${symbol} via ${source}...`);

  let data = null;

  // 2. 执行对应策略
  if (source === 'YAHOO') {
    data = await fetchYahooFullData(symbol, range);
  } else {
    data = await fetchEODFullData(symbol);
  }

  // 3. 兜底逻辑：如果 EOD 没拿到或者需要图表（EODHD 暂时不支持 range 历史图表），尝试 Yahoo 补充历史数据
  // 也就是说，如果 data 存在（来自 EOD），但是 data.history 不存在，我们也要去 Yahoo 拿一下历史 K 线数据
  if (!data || (source === 'EODHD' && !data.history)) {
    let fallbackSymbol = symbol.replace('.US', ''); 
    if (symbol.endsWith('.HK')) fallbackSymbol = symbol; // 港股保留 .HK
    
    // 尝试用 Yahoo 获取包含历史数据的完整对象
    const yahooData = await fetchYahooFullData(fallbackSymbol, range);
    
    if (yahooData) {
      if (!data) {
        // 场景 A: EOD 彻底失败，完全使用 Yahoo 数据作为替补
        data = yahooData;
      } else {
        // 场景 B: EOD 获取成功（基本面数据好），但缺 K 线历史，只把 Yahoo 的 history 拼上去
        data.history = yahooData.history;
      }
    }
  }

  if (!data) {
    return NextResponse.json({ error: 'Symbol not found' }, { status: 404 });
  }

  // 4. 统一处理汇率 (计算 priceInHKD)
  const rates = { 'USD': 7.8, 'JPY': 0.052, 'CNY': 1.08, 'EUR': 8.5, 'GBP': 9.8 };
  let priceInHKD = data.price;
  if (data.currency !== 'HKD' && rates[data.currency]) {
    priceInHKD = data.price * rates[data.currency];
  }
  data.priceInHKD = priceInHKD;

  return NextResponse.json(data);
}