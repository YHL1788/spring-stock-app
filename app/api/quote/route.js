import { NextResponse } from 'next/server';
import Parser from 'rss-parser';

const parser = new Parser();

// 1. 从环境变量获取 Finnhub Key (必须配置！)
const API_KEY = process.env.FINNHUB_API_KEY;

// 2. 获取 Google 新闻 (极速、稳定、中文支持好)
async function fetchGoogleNews(symbol) {
  try {
    // 针对不同市场优化搜索关键词
    let query = symbol;
    // 如果是港股 (0700.HK)，Google 搜 "0700.HK" 很准
    // 如果是美股 (AAPL)，搜 "AAPL stock" 避免搜到产品新闻
    if (!symbol.includes('.')) {
        query = `${symbol} stock`;
    }
    
    // 使用 Google News RSS
    const feedUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=zh-CN&gl=CN&ceid=CN:zh-CN`;
    const feed = await parser.parseURL(feedUrl);

    return feed.items.slice(0, 6).map(item => ({
      uuid: item.guid || item.link,
      title: item.title,
      publisher: item.source?.trim() || 'Google News',
      link: item.link,
      publishTime: new Date(item.pubDate).getTime() / 1000
    }));
  } catch (e) {
    console.error("Google News error:", e);
    return [];
  }
}

// 3. 获取 Finnhub 基础数据 (报价)
async function fetchFinnhubQuote(symbol) {
  const url = `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${API_KEY}`;
  const res = await fetch(url, { next: { revalidate: 0 } });
  if (!res.ok) return null;
  return res.json(); // 返回 { c: current, d: change, dp: percent ... }
}

// 4. 获取 Finnhub 公司简介 (Profile2)
async function fetchFinnhubProfile(symbol) {
  const url = `https://finnhub.io/api/v1/stock/profile2?symbol=${symbol}&token=${API_KEY}`;
  const res = await fetch(url, { next: { revalidate: 3600 } }); // 简介不常变，缓存1小时
  if (!res.ok) return {};
  return res.json();
}

// 5. 获取 Finnhub 核心指标 (Metric)
async function fetchFinnhubMetrics(symbol) {
  // metric?metric=all 可以拿到 PE, Beta, 52Week 等
  const url = `https://finnhub.io/api/v1/stock/metric?symbol=${symbol}&metric=all&token=${API_KEY}`;
  const res = await fetch(url, { next: { revalidate: 0 } });
  if (!res.ok) return {};
  const json = await res.json();
  return json.metric || {};
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get('symbol');

  if (!symbol) return NextResponse.json({ error: 'Missing symbol' }, { status: 400 });
  if (!API_KEY) return NextResponse.json({ error: 'Server API Key missing' }, { status: 500 });

  const upperSymbol = symbol.toUpperCase();

  try {
    // 并行请求所有数据源
    const [quote, profile, metrics, news] = await Promise.all([
      fetchFinnhubQuote(upperSymbol),
      fetchFinnhubProfile(upperSymbol),
      fetchFinnhubMetrics(upperSymbol),
      fetchGoogleNews(upperSymbol)
    ]);

    // 如果没有报价，说明股票代码错误
    if (!quote || quote.c === 0) {
      return NextResponse.json({ error: 'Symbol not found' }, { status: 404 });
    }

    // --- 数据组装 ---
    
    // 货币单位 (Finnhub profile 里有 currency，没有就默认 USD)
    const currency = profile.currency || 'USD';
    
    // 简单的汇率估算 (为了展示 priceInHKD)
    // 注意：Finnhub 免费版没有汇率接口，这里为了稳定性，我们先简化处理
    // 如果需要精确汇率，以后可以再接专门的汇率 API
    let rate = 1;
    if (currency === 'USD') rate = 7.82;
    else if (currency === 'JPY') rate = 0.052;
    else if (currency === 'CNY') rate = 1.08;
    
    const currentPrice = quote.c;
    const priceInHKD = currency === 'HKD' ? currentPrice : currentPrice * rate;

    const data = {
      symbol: upperSymbol,
      currency: currency,
      price: currentPrice,
      priceInHKD: priceInHKD,
      change: quote.d,
      changePercent: quote.dp,

      // 板块 1: 交易数据
      trading: {
        high52: metrics['52WeekHigh'] || currentPrice,
        low52: metrics['52WeekLow'] || currentPrice,
        volume: 0, // Finnhub 基础 Quote 不含成交量，免费版很难拿实时成交量，暂时置 0
        avgVolume: metrics['10DayAverageTradingVolume'] * 1000000 || 0, // Finnhub 返回的是百万单位
      },

      // 板块 2: 核心指标
      stats: {
        marketCap: metrics['marketCapitalization'] ? `${metrics['marketCapitalization'].toFixed(2)}M` : '--',
        peRatio: metrics['peTTM'] || null,
        dividendYield: metrics['dividendYieldIndicatedAnnual'] || 0,
        beta: metrics['beta'] || null,
        epsTrend: [] // Finnhub 免费版不提供 EPS 历史，前端会显示“暂无数据”
      },

      // 板块 3: 公司概况
      profile: {
        sector: profile.finnhubIndustry || 'N/A',
        industry: profile.finnhubIndustry || 'N/A', // Finnhub 行业分类较粗
        summary: '数据来源: Finnhub。' + (profile.name ? `${profile.name} 是一家位于 ${profile.country} 的上市公司，主要在 ${profile.exchange} 交易所交易。` : ''),
        employees: 0, // 免费版不含员工数
        website: profile.weburl || ''
      },

      // 板块 4: 财务健康 (部分数据可能在免费版不可用，做空处理)
      financials: {
        profitMargins: metrics['netProfitMarginTTM'] || 0,
        roa: metrics['roaTTM'] || 0,
        roe: metrics['roeTTM'] || 0,
        revenueGrowth: metrics['revenueGrowthTTMYoy'] || 0
      },

      // 板块 5: 分析师评级 (Finnhub 免费版不含评级，前端会显示 N/A)
      analysis: {
        recommendation: 'none',
        targetPrice: null,
        numberOfAnalyst: 0
      },

      // 板块 6: 新闻 (Google News)
      news: news
    };

    return NextResponse.json(data);

  } catch (error) {
    console.error("API Error:", error);
    return NextResponse.json({ error: 'Server Error' }, { status: 500 });
  }
}