import { NextResponse } from 'next/server';
import yahooFinance from 'yahoo-finance2'; // 引入专门的 Yahoo 库
import Parser from 'rss-parser';

const parser = new Parser();

// 1. 获取 Google 新闻 (保持不变，效果很好)
async function fetchGoogleNews(symbol) {
  try {
    let query = symbol;
    // 优化搜索关键词
    if (symbol.endsWith('.HK')) {
      query = `股票 ${symbol}`; // 港股加中文前缀搜中文新闻
    } else if (!symbol.includes('.')) {
      query = `${symbol} stock`; // 美股
    }
    
    // 使用 Google News RSS (中文环境)
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

// 2. 汇率查询 (使用 yahoo-finance2)
async function fetchExchangeRate(currency) {
  if (currency === 'HKD') return 1;
  try {
    const symbol = `${currency}HKD=X`;
    const result = await yahooFinance.quote(symbol);
    return result.regularMarketPrice || 1;
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
    // 1. 获取 Yahoo 深度数据
    // quoteSummary 是 Yahoo 最强大的接口，包含基本面、评级、财务等
    const queryOptions = { modules: ['price', 'summaryDetail', 'defaultKeyStatistics', 'assetProfile', 'financialData', 'earnings'] };
    
    // 并行执行：Yahoo 数据 + Google 新闻
    const [yahooData, newsData] = await Promise.all([
      yahooFinance.quoteSummary(upperSymbol, queryOptions),
      fetchGoogleNews(upperSymbol)
    ]);

    if (!yahooData || !yahooData.price) {
      return NextResponse.json({ error: 'Symbol not found' }, { status: 404 });
    }

    // --- 解构数据 ---
    const p = yahooData.price;
    const sd = yahooData.summaryDetail || {};
    const ap = yahooData.assetProfile || {};
    const fd = yahooData.financialData || {};
    const ks = yahooData.defaultKeyStatistics || {};
    const ern = yahooData.earnings?.financialsChart?.quarterly || [];

    // --- 汇率处理 ---
    const currentPrice = p.regularMarketPrice || 0;
    const currency = p.currency || 'USD';
    let priceInHKD = currentPrice;
    
    if (currency !== 'HKD') {
      const rate = await fetchExchangeRate(currency);
      priceInHKD = currentPrice * rate;
    }

    // --- 组装 Dashboard 数据结构 ---
    const data = {
      symbol: upperSymbol,
      currency: currency,
      price: currentPrice,
      priceInHKD: priceInHKD,
      change: p.regularMarketChange || 0,
      changePercent: (p.regularMarketChangePercent || 0) * 100,

      // 板块 1: 交易数据
      trading: {
        high52: sd.fiftyTwoWeekHigh || currentPrice,
        low52: sd.fiftyTwoWeekLow || currentPrice,
        volume: sd.volume || 0,
        avgVolume: sd.averageVolume || 0,
      },

      // 板块 2: 核心指标
      stats: {
        // 格式化市值 (Trillion/Billion/Million)
        marketCap: sd.marketCap ? (sd.marketCap >= 1e12 ? (sd.marketCap/1e12).toFixed(2)+'T' : (sd.marketCap/1e9).toFixed(2)+'B') : '--',
        peRatio: sd.trailingPE || null,
        dividendYield: (sd.dividendYield || 0) * 100,
        beta: sd.beta || null,
        // EPS 趋势
        epsTrend: ern.map((q: any) => ({ 
            date: q.date, 
            actual: q.actual?.raw || q.actual || 0, 
            estimate: q.estimate?.raw || q.estimate || 0 
        }))
      },

      // 板块 3: 公司概况
      profile: {
        sector: ap.sector || 'N/A',
        industry: ap.industry || 'N/A',
        summary: ap.longBusinessSummary || '暂无描述',
        employees: ap.fullTimeEmployees || 0,
        website: ap.website || ''
      },

      // 板块 4: 财务健康
      financials: {
        profitMargins: (fd.profitMargins || 0) * 100,
        roa: (fd.returnOnAssets || 0) * 100,
        roe: (fd.returnOnEquity || 0) * 100,
        revenueGrowth: (fd.revenueGrowth || 0) * 100
      },

      // 板块 5: 分析师评级
      analysis: {
        recommendation: fd.recommendationKey || 'none',
        targetPrice: fd.targetMeanPrice || null,
        numberOfAnalyst: fd.numberOfAnalystOpinions || 0
      },

      // 板块 6: 新闻
      news: newsData
    };

    return NextResponse.json(data);

  } catch (error: any) {
    // 捕获 Yahoo 库的特定错误
    console.error("API Main Error:", error);
    if (error.message?.includes('Not Found')) {
        return NextResponse.json({ error: 'Symbol not found' }, { status: 404 });
    }
    return NextResponse.json({ error: 'Server Error' }, { status: 500 });
  }
}