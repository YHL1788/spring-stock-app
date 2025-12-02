// app/api/quote/route.js
import { NextResponse } from 'next/server';

// 伪装请求头，防止被 Yahoo 拦截
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
};

// 1. 获取股价数据 (Price Data)
async function fetchYahooPrice(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`;
  try {
    // next: { revalidate: 0 } 禁用缓存，保证价格实时
    const res = await fetch(url, { headers: HEADERS, next: { revalidate: 0 } });
    if (!res.ok) return null;
    const json = await res.json();
    return json.chart.result?.[0]?.meta || null;
  } catch (e) {
    console.error("Price fetch error:", e);
    return null;
  }
}

// 2. 获取新闻数据 (News Data - 切回 Yahoo Search API)
async function fetchYahooNews(symbol) {
  // 这里的 v1/finance/search 接口速度极快
  const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${symbol}`;
  
  try {
    const res = await fetch(url, { headers: HEADERS, next: { revalidate: 0 } });
    if (!res.ok) return [];
    const json = await res.json();
    
    // Yahoo Search API 返回的数据里有一个 'news' 数组
    const newsItems = json.news || [];
    
    // 清洗数据，只取前 5 条
    return newsItems.slice(0, 5).map(item => ({
        uuid: item.uuid,
        title: item.title,
        publisher: item.publisher,
        link: item.link,
        publishTime: item.providerPublishTime // Yahoo 返回的是秒级时间戳，直接可用
    }));
  } catch (e) {
    console.error("News fetch error:", e);
    return [];
  }
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get('symbol');

  if (!symbol) {
    return NextResponse.json({ error: '必须提供股票代码' }, { status: 400 });
  }

  const upperSymbol = symbol.toUpperCase();

  try {
    // 并行执行：同时查价格和查新闻
    const [stockMeta, newsData] = await Promise.all([
      fetchYahooPrice(upperSymbol),
      fetchYahooNews(upperSymbol)
    ]);
    
    if (!stockMeta) {
         return NextResponse.json({ error: '未找到该股票' }, { status: 404 });
    }

    // --- 价格处理逻辑 ---
    const currentPrice = stockMeta.regularMarketPrice;
    const previousClose = stockMeta.chartPreviousClose;
    const currency = stockMeta.currency;
    
    let changePercent = 0;
    if (previousClose) {
        changePercent = ((currentPrice - previousClose) / previousClose) * 100;
    }

    // --- 汇率处理逻辑 (自动折算 HKD) ---
    let priceInHKD = currentPrice;
    if (currency !== 'HKD') {
        const exchangeSymbol = `${currency}HKD=X`;
        const rateMeta = await fetchYahooPrice(exchangeSymbol);
        if (rateMeta) {
            priceInHKD = currentPrice * rateMeta.regularMarketPrice;
        }
    }

    return NextResponse.json({
        symbol: upperSymbol,
        currency: currency,
        price: currentPrice,
        changePercent: changePercent,
        priceInHKD: priceInHKD,
        news: newsData // 返回 Yahoo 的新闻
    });

  } catch (error) {
    console.error("Main API Error:", error);
    return NextResponse.json({ error: '系统内部错误' }, { status: 500 });
  }
}