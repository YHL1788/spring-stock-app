import { NextResponse } from 'next/server';

// 定义 Yahoo Finance 的相关 API 端点
const BASE_URL_YAHOO_CHART = 'https://query1.finance.yahoo.com/v8/finance/chart';
const BASE_URL_YAHOO_SUMMARY = 'https://query1.finance.yahoo.com/v10/finance/quoteSummary';
const BASE_URL_YAHOO_SEARCH = 'https://query1.finance.yahoo.com/v1/finance/search';

// 模拟浏览器 User-Agent 以避免被 Yahoo 拦截
const YAHOO_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
};

// --- 辅助函数：获取新闻 ---
async function fetchYahooNews(symbol) {
  try {
    // 使用 Yahoo Search API 获取相关新闻
    const res = await fetch(`${BASE_URL_YAHOO_SEARCH}?q=${symbol}`, { headers: YAHOO_HEADERS, next: { revalidate: 300 } }); // 5分钟缓存
    const json = await res.json();
    const news = json.news || [];
    
    return news.map(item => ({
      uuid: item.uuid,
      title: item.title,
      publisher: item.publisher,
      link: item.link,
      publishTime: item.providerPublishTime,
      thumbnail: item.thumbnail?.resolutions?.[0]?.url // 获取缩略图（如果有）
    }));
  } catch (e) {
    console.error("News Fetch Error:", e);
    return [];
  }
}

// --- 辅助函数：获取实时汇率 ---
async function fetchRealTimeFxRate(currency) {
  if (currency === 'HKD') return 1.0;
  try {
    const symbol = `${currency}HKD=X`; // Yahoo 的外汇对格式，例如 USDHKD=X
    // 汇率请求，设置 5 分钟缓存避免频繁请求触发限制
    const res = await fetch(`${BASE_URL_YAHOO_CHART}/${symbol}?interval=1d&range=1d`, { 
        headers: YAHOO_HEADERS, 
        next: { revalidate: 300 } 
    });
    const json = await res.json();
    const price = json?.chart?.result?.[0]?.meta?.regularMarketPrice;
    return price || null;
  } catch (e) {
    console.error(`FX Fetch Error for ${currency}:`, e);
    return null;
  }
}

// --- 核心函数：获取 Yahoo 完整数据 ---
async function fetchYahooFullData(symbol, range = '1d') {
  try {
    let interval = '1d';
    // 自动适配 Interval 以获取适合画图的数据密度
    if (range === '1d') interval = '2m';
    else if (range === '5d') interval = '15m';
    else if (['1mo', '3mo'].includes(range)) interval = '1d';
    else interval = '1d'; // 1y, 5y, ytd 使用日线

    // 1. 获取图表数据 (Chart API)
    const priceRes = await fetch(`${BASE_URL_YAHOO_CHART}/${symbol}?interval=${interval}&range=${range}`, { headers: YAHOO_HEADERS, next: { revalidate: 60 } });
    const priceJson = priceRes.ok ? await priceRes.json() : null;
    const result = priceJson?.chart?.result?.[0];
    const meta = result?.meta;

    if (!meta) return null;

    const timestamps = result.timestamp || [];
    const quotes = result.indicators?.quote?.[0] || {};
    
    // 组装 K 线历史数据
    const history = timestamps.map((t, i) => ({
      time: t * 1000,
      open: quotes.open?.[i],
      high: quotes.high?.[i],
      low: quotes.low?.[i],
      close: quotes.close?.[i],
      volume: quotes.volume?.[i]
    })).filter(d => d.close !== null && d.close !== undefined);

    // 2. 获取基础概览数据 (Summary API)
    // 获取 price 和 summaryDetail 模块
    const modules = ['summaryDetail', 'price']; 
    const summaryRes = await fetch(`${BASE_URL_YAHOO_SUMMARY}/${symbol}?modules=${modules.join('%2C')}`, { headers: YAHOO_HEADERS, next: { revalidate: 3600 } });
    const summaryJson = summaryRes.ok ? await summaryRes.json() : null;
    const qs = summaryJson?.quoteSummary?.result?.[0] || {};
    const sd = qs.summaryDetail || {};
    const price = qs.price || {};

    // 3. 获取新闻
    const newsData = await fetchYahooNews(symbol);

    return {
      symbol: symbol,
      name: price.shortName || meta.symbol, // 优先使用短名称
      currency: meta.currency,
      exchange: meta.exchangeName,
      price: meta.regularMarketPrice,
      change: meta.regularMarketPrice - meta.chartPreviousClose,
      changePercent: ((meta.regularMarketPrice - meta.chartPreviousClose) / meta.chartPreviousClose) * 100,
      
      // 52周范围
      high52: sd.fiftyTwoWeekHigh?.raw || 0,
      low52: sd.fiftyTwoWeekLow?.raw || 0,
      marketCap: price.marketCap?.fmt || sd.marketCap?.fmt || '--',

      history: history, // 图表数据
      news: newsData    // 新闻数据
    };
  } catch (e) {
    console.error("Yahoo Fetch Error:", e);
    return null;
  }
}

// ==========================================
// 主入口
// ==========================================

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  
  // --- 1. 纯汇率高速查询通道 (为 FCN 盯市专门优化) ---
  const currencyParam = searchParams.get('currency');
  if (currencyParam) {
    const currency = currencyParam.toUpperCase().trim();
    if (currency === 'HKD') {
      return NextResponse.json({ currency: 'HKD', rate: 1.0, isRealTimeFx: true });
    }
    
    const realTimeRate = await fetchRealTimeFxRate(currency);
    // 静态回退汇率 (Fallback)，防止 Yahoo 汇率 API 偶尔抽风或查不到
    const FALLBACK_RATES = { 'USD': 7.78, 'JPY': 0.052, 'CNY': 1.08, 'EUR': 8.5, 'GBP': 9.8 };
    const rate = realTimeRate || FALLBACK_RATES[currency] || 1;
    
    return NextResponse.json({
      currency,
      rate,
      isRealTimeFx: !!realTimeRate
    });
  }

  // --- 2. 完整股票/ETF信息查询通道 ---
  const rawSymbol = searchParams.get('symbol');
  const range = searchParams.get('range') || '1d';

  if (!rawSymbol) return NextResponse.json({ error: 'Missing symbol or currency parameter' }, { status: 400 });

  // 简单清洗代码
  const symbol = rawSymbol.toUpperCase().trim();
  
  // 统一只调用 Yahoo 逻辑
  const data = await fetchYahooFullData(symbol, range);

  if (!data) {
    return NextResponse.json({ error: 'Symbol not found or data unavailable' }, { status: 404 });
  }

  // 动态计算实时 HKD 参考价
  let priceInHKD = data.price;
  if (data.currency && data.currency !== 'HKD') {
    // 拉取实时汇率
    const realTimeRate = await fetchRealTimeFxRate(data.currency);
    
    // 静态回退汇率
    const FALLBACK_RATES = { 'USD': 7.78, 'JPY': 0.052, 'CNY': 1.08, 'EUR': 8.5, 'GBP': 9.8 };
    
    const rate = realTimeRate || FALLBACK_RATES[data.currency] || 1;
    priceInHKD = data.price * rate;
    
    // 附加汇率信息供前端透明化展示
    data.fxRateUsed = rate;
    data.isRealTimeFx = !!realTimeRate;
  } else {
    data.fxRateUsed = 1.0;
    data.isRealTimeFx = true;
  }
  data.priceInHKD = priceInHKD;

  return NextResponse.json(data);
}