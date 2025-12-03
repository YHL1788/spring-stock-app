import { NextResponse } from 'next/server';

// 伪装请求头，防止被 Yahoo 拦截
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
};

// 1. 获取股价数据 (Price Data - 原始稳定接口)
async function fetchYahooPrice(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`;
  try {
    const res = await fetch(url, { headers: HEADERS, next: { revalidate: 0 } });
    if (!res.ok) return null;
    const json = await res.json();
    return json.chart.result?.[0]?.meta || null;
  } catch (e) {
    console.error("Price fetch error:", e);
    return null;
  }
}

// 2. 获取新闻数据 (News Data - 原始稳定接口)
async function fetchYahooNews(symbol) {
  const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${symbol}`;
  
  try {
    const res = await fetch(url, { headers: HEADERS, next: { revalidate: 0 } });
    if (!res.ok) return [];
    const json = await res.json();
    const newsItems = json.news || [];
    
    return newsItems.slice(0, 6).map(item => ({
        uuid: item.uuid,
        title: item.title,
        publisher: item.publisher,
        link: item.link,
        publishTime: item.providerPublishTime
    }));
  } catch (e) {
    console.error("News fetch error:", e);
    return [];
  }
}

// 3. 汇率查询
async function fetchExchangeRate(currency) {
  if (currency === 'HKD') return 1;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${currency}HKD=X?interval=1d&range=1d`;
  try {
    const res = await fetch(url, { headers: HEADERS });
    const json = await res.json();
    return json.chart.result?.[0]?.meta?.regularMarketPrice || 1;
  } catch {
    return 1;
  }
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get('symbol');

  if (!symbol) return NextResponse.json({ error: 'Missing symbol' }, { status: 400 });

  const upperSymbol = symbol.toUpperCase();

  try {
    // 并行执行：查价格 + 查新闻
    const [stockMeta, newsData] = await Promise.all([
      fetchYahooPrice(upperSymbol),
      fetchYahooNews(upperSymbol)
    ]);
    
    if (!stockMeta) {
         return NextResponse.json({ error: 'Symbol not found' }, { status: 404 });
    }

    // --- 价格处理逻辑 ---
    const currentPrice = stockMeta.regularMarketPrice || 0;
    const previousClose = stockMeta.chartPreviousClose || currentPrice;
    const currency = stockMeta.currency || 'USD';
    
    let change = currentPrice - previousClose;
    let changePercent = 0;
    if (previousClose) {
        changePercent = (change / previousClose) * 100;
    }

    // --- 汇率处理逻辑 ---
    let priceInHKD = currentPrice;
    if (currency !== 'HKD') {
        const rate = await fetchExchangeRate(currency);
        priceInHKD = currentPrice * rate;
    }

    // --- 组装数据 (填充前端需要的 6 大板块，缺失的用默认值) ---
    const data = {
        symbol: upperSymbol,
        currency: currency,
        price: currentPrice,
        priceInHKD: priceInHKD,
        change: change,
        changePercent: changePercent,

        // 板块 1: 交易数据 (部分有数据)
        trading: {
            high52: stockMeta.fiftyTwoWeekHigh || currentPrice,
            low52: stockMeta.fiftyTwoWeekLow || currentPrice,
            volume: 0, // 基础接口不常返回准确日成交量，暂置0
            avgVolume: 0,
        },

        // 板块 2: 核心指标 (暂无数据)
        stats: {
            marketCap: '--',
            peRatio: null,
            dividendYield: 0,
            beta: null,
            epsTrend: [] 
        },

        // 板块 3: 公司概况 (暂无数据)
        profile: {
            sector: 'N/A',
            industry: 'N/A',
            summary: '暂无详细描述 (待接入自定义数据源)',
            employees: 0,
            website: ''
        },

        // 板块 4: 财务健康 (暂无数据)
        financials: {
            profitMargins: 0,
            roa: 0,
            roe: 0,
            revenueGrowth: 0
        },

        // 板块 5: 分析师评级 (暂无数据)
        analysis: {
            recommendation: 'none',
            targetPrice: null,
            numberOfAnalyst: 0
        },

        // 板块 6: 新闻 (有数据)
        news: newsData 
    };

    return NextResponse.json(data);

  } catch (error) {
    console.error("Main API Error:", error);
    return NextResponse.json({ error: '系统内部错误' }, { status: 500 });
  }
}