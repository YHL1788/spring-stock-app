import { NextResponse } from 'next/server';

const API_TOKEN = process.env.EOD_API_KEY;
const BASE_URL = 'https://eodhd.com/api';

// 1. 股票代码标准化 (EODHD 格式)
// 美股需要加 .US 后缀 (如 AAPL -> AAPL.US)
// 港股/日股通常自带后缀 (0700.HK, 7203.T)
function formatSymbol(symbol) {
  const upper = symbol.toUpperCase();
  if (!upper.includes('.')) {
    return `${upper}.US`;
  }
  return upper; // 假设带点的都是正确的 EOD 格式 (如 .HK, .TO)
}

// 2. 获取实时/延迟价格 (Live Price)
async function fetchLivePrice(symbol) {
  // fmt=json 是必须的
  const url = `${BASE_URL}/real-time/${symbol}?api_token=${API_TOKEN}&fmt=json`;
  try {
    const res = await fetch(url, { next: { revalidate: 0 } });
    if (!res.ok) return null;
    return await res.json(); // 返回 { code, timestamp, close, change, change_p ... }
  } catch (e) {
    console.error("Price fetch error:", e);
    return null;
  }
}

// 3. 获取深度基本面 (Fundamentals)
// 包含: 公司简介, 核心指标, 财务, 评级, EPS 历史
async function fetchFundamentals(symbol) {
  const url = `${BASE_URL}/fundamentals/${symbol}?api_token=${API_TOKEN}`;
  try {
    const res = await fetch(url, { next: { revalidate: 3600 } }); // 基本面缓存1小时
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    console.error("Fundamentals fetch error:", e);
    return null;
  }
}

// 4. 获取新闻 (EODHD News)
async function fetchNews(symbol) {
  // s=AAPL.US
  const url = `${BASE_URL}/news?s=${symbol}&api_token=${API_TOKEN}&limit=6`;
  try {
    const res = await fetch(url, { next: { revalidate: 600 } });
    if (!res.ok) return [];
    return await res.json();
  } catch (e) {
    console.error("News fetch error:", e);
    return [];
  }
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const rawSymbol = searchParams.get('symbol');

  if (!rawSymbol) return NextResponse.json({ error: 'Missing symbol' }, { status: 400 });
  if (!API_TOKEN) return NextResponse.json({ error: 'API Key missing' }, { status: 500 });

  const symbol = formatSymbol(rawSymbol);

  try {
    // 并行请求：价格 + 基本面 + 新闻
    const [priceData, fundData, newsData] = await Promise.all([
      fetchLivePrice(symbol),
      fetchFundamentals(symbol),
      fetchNews(symbol)
    ]);

    if (!priceData || !fundData) {
      return NextResponse.json({ error: 'Symbol not found or limit reached' }, { status: 404 });
    }

    // --- 数据提取 ---
    // General: 概况
    const gen = fundData.General || {};
    // Highlights: 核心指标
    const hl = fundData.Highlights || {};
    // Valuation: 估值
    const val = fundData.Valuation || {};
    // Technicals: 技术指标 (52周, Beta)
    const tech = fundData.Technicals || {};
    // AnalystRatings: 分析师评级
    const analyst = fundData.AnalystRatings || {};
    // Earnings: 财报历史
    const earningsHistory = fundData.Earnings?.History || {};

    // --- 汇率估算 (简化版) ---
    // EODHD 的 General.CurrencyCode 会告诉我们货币 (USD, HKD, JPY)
    const currency = gen.CurrencyCode || 'USD';
    let priceInHKD = priceData.close;
    // 简单硬编码汇率，实际生产环境建议调用 EODHD 的 Forex API
    const rates = { 'USD': 7.8, 'JPY': 0.052, 'CNY': 1.08, 'EUR': 8.5, 'GBP': 9.8 };
    if (currency !== 'HKD' && rates[currency]) {
        priceInHKD = priceData.close * rates[currency];
    }

    // --- 组装 Dashboard 数据 ---
    const data = {
      symbol: gen.Code || rawSymbol.toUpperCase(),
      currency: currency,
      price: priceData.close,
      priceInHKD: priceInHKD,
      change: priceData.change,
      changePercent: priceData.change_p, // EODHD 直接返回百分比数值 (e.g. -1.25)

      // 1. 交易数据
      trading: {
        high52: tech['52WeekHigh'] || priceData.close,
        low52: tech['52WeekLow'] || priceData.close,
        volume: priceData.volume || 0,
        avgVolume: 0 // 实时接口可能不返回平均量，暂置0或从 Fundamentals 计算
      },

      // 2. 核心指标
      stats: {
        marketCap: hl.MarketCapitalization ? (hl.MarketCapitalization / 1000000).toFixed(2) + 'M' : '--',
        peRatio: hl.PERatio || val.TrailingPE || null,
        dividendYield: (hl.DividendYield || 0) * 100,
        beta: tech.Beta || null,
        // 处理 EPS 趋势 (取最近4次)
        epsTrend: Object.values(earningsHistory)
            .slice(0, 4)
            .reverse() // EODHD 顺序可能需要调整，视实际返回而定
            .map((e) => ({
                date: e.reportDate,
                actual: e.epsActual,
                estimate: e.epsEstimate
            }))
      },

      // 3. 公司概况
      profile: {
        sector: gen.Sector || 'N/A',
        industry: gen.Industry || 'N/A',
        summary: gen.Description || '暂无描述',
        employees: gen.FullTimeEmployees || 0,
        website: gen.WebURL || ''
      },

      // 4. 财务健康 (EODHD 提供非常详细的 Financials 字段)
      financials: {
        profitMargins: (hl.ProfitMargin || 0) * 100,
        roa: (hl.ReturnOnAssetsTTM || 0) * 100,
        roe: (hl.ReturnOnEquityTTM || 0) * 100,
        revenueGrowth: (hl.RevenueTTM / 1000000).toFixed(2) + 'M' // 这里暂时展示营收额，因为增长率需计算
      },

      // 5. 分析师评级 (EODHD 强项)
      analysis: {
        recommendation: analyst.Rating || 'none', // e.g. "Strong Buy"
        targetPrice: analyst.TargetPrice || null,
        numberOfAnalyst: 0 // EODHD 这个字段可能在不同层级
      },

      // 6. 新闻
      news: Array.isArray(newsData) ? newsData.slice(0, 6).map(item => ({
        uuid: item.date + item.title, // 生成一个唯一ID
        title: item.title,
        publisher: 'EOD News', // EOD news source 有时是 tags
        link: item.link,
        publishTime: new Date(item.date).getTime() / 1000
      })) : []
    };

    return NextResponse.json(data);

  } catch (error) {
    console.error("Main API Error:", error);
    return NextResponse.json({ error: 'Server Error' }, { status: 500 });
  }
}