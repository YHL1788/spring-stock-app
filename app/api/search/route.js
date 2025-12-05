import { NextResponse } from 'next/server';

const BASE_URL_YAHOO_SEARCH = 'https://query1.finance.yahoo.com/v1/finance/search';

const YAHOO_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
};

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');

  if (!query) return NextResponse.json([]);

  try {
    // 调用 Yahoo 搜索接口
    // q: 关键词
    // quotesCount: 返回股票数量
    // newsCount: 返回新闻数量 (这里设为0，因为只要股票)
    const url = `${BASE_URL_YAHOO_SEARCH}?q=${encodeURIComponent(query)}&quotesCount=10&newsCount=0&enableFuzzyQuery=false&quotesQueryId=tss_match_phrase_query`;
    
    const res = await fetch(url, { headers: YAHOO_HEADERS });
    
    if (!res.ok) return NextResponse.json([]);
    
    const json = await res.json();
    const quotes = json.quotes || [];

    // 数据清洗
    const formattedResults = quotes
      .filter(item => item.quoteType === 'EQUITY' || item.quoteType === 'ETF' || item.quoteType === 'INDEX') // 只保留股票、ETF、指数
      .map(item => ({
        symbol: item.symbol,       // Yahoo 返回的直接就是标准代码 (如 7203.T)
        name: item.shortname || item.longname || item.symbol,
        exchange: item.exchange,
        type: item.quoteType,
        country: item.country || '' // Yahoo 有时不返回 country
      }));

    return NextResponse.json(formattedResults);

  } catch (error) {
    console.error("Yahoo Search API Error:", error);
    return NextResponse.json([]);
  }
}