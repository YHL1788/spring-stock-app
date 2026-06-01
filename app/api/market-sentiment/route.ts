import { NextResponse } from 'next/server';

const CNN_FEAR_GREED_API = 'https://production.dataviz.cnn.io/index/fearandgreed/graphdata';
const CRYPTO_FEAR_GREED_API = 'https://api.alternative.me/fng/?limit=730&format=json';
const FRED_CSV_BASE = 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=';
const YAHOO_CHART_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart';

const JSON_HEADERS = {
  Accept: 'application/json,text/plain,*/*',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36',
};

type SeriesPoint = {
  date: string | number;
  score: number;
  rating?: string;
};

type SentimentMetric = {
  id: string;
  title: string;
  shortTitle: string;
  source: string;
  sourceUrl: string;
  score: number | null;
  rawValue?: number | null;
  rating: string;
  timestamp: string | number | null;
  description: string;
  higherMeans: 'greed' | 'fear' | 'neutral';
  history: SeriesPoint[];
  indicators?: Array<{ key: string; label: string; score: number | null; rating: string; value?: number | null }>;
  error?: string;
};

const CNN_INDICATOR_LABELS: Record<string, string> = {
  market_momentum_sp500: '市场动能',
  stock_price_strength: '股价强度',
  stock_price_breadth: '市场宽度',
  put_call_options: '期权情绪',
  market_volatility_vix: '波动率',
  junk_bond_demand: '垃圾债需求',
  safe_haven_demand: '避险需求',
};

function toNumber(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function clampScore(value: number | null) {
  if (value === null) return null;
  return Math.max(0, Math.min(100, value));
}

function normalizeRating(score: number | null, rating?: string) {
  if (rating) return rating;
  if (score === null) return 'unknown';
  if (score <= 25) return 'extreme fear';
  if (score <= 45) return 'fear';
  if (score < 55) return 'neutral';
  if (score < 75) return 'greed';
  return 'extreme greed';
}

function percentileScore(value: number | null, values: number[], higherMeans: 'greed' | 'fear' | 'neutral' = 'greed') {
  if (value === null || values.length === 0) return null;
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const belowOrEqual = sorted.filter(item => item <= value).length;
  const percentile = (belowOrEqual / sorted.length) * 100;
  if (higherMeans === 'fear') return clampScore(100 - percentile);
  return clampScore(percentile);
}

function parseCsv(text: string) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  const headers = lines.shift()?.split(',').map(h => h.trim()) || [];
  return lines.map(line => {
    const cells = line.split(',').map(cell => cell.trim());
    return headers.reduce<Record<string, string>>((acc, header, idx) => {
      acc[header] = cells[idx];
      return acc;
    }, {});
  });
}

function unavailableMetric(id: string, title: string, shortTitle: string, source: string, sourceUrl: string, description: string, error: unknown): SentimentMetric {
  return {
    id,
    title,
    shortTitle,
    source,
    sourceUrl,
    score: null,
    rawValue: null,
    rating: 'unavailable',
    timestamp: null,
    description,
    higherMeans: 'neutral',
    history: [],
    error: error instanceof Error ? error.message : String(error || '数据暂不可用'),
  };
}

async function fetchCnnFearGreed(): Promise<SentimentMetric> {
  try {
    const response = await fetch(CNN_FEAR_GREED_API, {
      headers: { ...JSON_HEADERS, Referer: 'https://edition.cnn.com/' },
      next: { revalidate: 300 },
    });
    if (!response.ok) throw new Error(`CNN API returned ${response.status}`);
    const data = await response.json();
    const current = data?.fear_and_greed || {};
    const score = toNumber(current.score);
    const historyRows = Array.isArray(data?.fear_and_greed_historical?.data) ? data.fear_and_greed_historical.data : [];
    const indicators = Object.keys(CNN_INDICATOR_LABELS).map(key => {
      const item = data?.[key] || {};
      const itemScore = toNumber(item.score);
      return {
        key,
        label: CNN_INDICATOR_LABELS[key],
        score: itemScore,
        value: itemScore,
        rating: normalizeRating(itemScore, item.rating),
      };
    }).filter(item => item.score !== null);

    return {
      id: 'cnn-fear-greed',
      title: 'CNN Fear & Greed Index',
      shortTitle: 'CNN',
      source: 'CNN',
      sourceUrl: 'https://edition.cnn.com/markets/fear-and-greed',
      score,
      rawValue: score,
      rating: normalizeRating(score, current.rating),
      timestamp: current.timestamp || null,
      description: 'CNN 综合市场动能、宽度、期权、波动率、信用和避险需求来衡量美股风险偏好。',
      higherMeans: 'greed',
      history: historyRows.slice(-730).map((item: any) => {
        const itemScore = toNumber(item.y ?? item.score);
        return {
          date: item.x || item.date || item.timestamp,
          score: itemScore,
          rating: normalizeRating(itemScore, item.rating),
        };
      }).filter((item: any) => item.score !== null),
      indicators,
    };
  } catch (error) {
    return unavailableMetric('cnn-fear-greed', 'CNN Fear & Greed Index', 'CNN', 'CNN', 'https://edition.cnn.com/markets/fear-and-greed', 'CNN 美股风险偏好综合指数。', error);
  }
}

async function fetchCryptoFearGreed(): Promise<SentimentMetric> {
  try {
    const response = await fetch(CRYPTO_FEAR_GREED_API, { headers: JSON_HEADERS, next: { revalidate: 1800 } });
    if (!response.ok) throw new Error(`Alternative.me API returned ${response.status}`);
    const data = await response.json();
    const rows = Array.isArray(data?.data) ? data.data : [];
    const history = rows.map((item: any) => ({
      date: Number(item.timestamp) * 1000,
      score: Number(item.value),
      rating: item.value_classification,
    })).filter((item: SeriesPoint) => Number.isFinite(item.score)).reverse();
    const latest = history[history.length - 1];
    const latestRaw = rows[0] || {};

    return {
      id: 'crypto-fear-greed',
      title: 'Crypto Fear & Greed Index',
      shortTitle: 'Crypto',
      source: 'Alternative.me',
      sourceUrl: 'https://alternative.me/crypto/fear-and-greed-index/',
      score: latest?.score ?? null,
      rawValue: latest?.score ?? null,
      rating: latestRaw.value_classification || normalizeRating(latest?.score ?? null),
      timestamp: latest?.date ?? null,
      description: '加密市场情绪指标，越高代表加密资产风险偏好越强，越低代表恐惧越重。',
      higherMeans: 'greed',
      history,
    };
  } catch (error) {
    return unavailableMetric('crypto-fear-greed', 'Crypto Fear & Greed Index', 'Crypto', 'Alternative.me', 'https://alternative.me/crypto/fear-and-greed-index/', '加密市场风险偏好指数。', error);
  }
}

async function fetchYahooSeries(symbol: string, range = '2y'): Promise<Array<{ date: number; value: number | null }>> {
  const response = await fetch(`${YAHOO_CHART_BASE}/${encodeURIComponent(symbol)}?interval=1d&range=${range}`, {
    headers: JSON_HEADERS,
    next: { revalidate: 900 },
  });
  if (!response.ok) throw new Error(`Yahoo ${symbol} returned ${response.status}`);
  const json = await response.json();
  const result = json?.chart?.result?.[0];
  const timestamps = result?.timestamp || [];
  const closes = result?.indicators?.quote?.[0]?.close || [];
  return timestamps.map((timestamp: number, idx: number) => ({
    date: timestamp * 1000,
    value: toNumber(closes[idx]),
  })).filter((item: any) => item.value !== null);
}

async function fetchVolatilityGauge(): Promise<SentimentMetric> {
  try {
    const seriesList = await Promise.all([
      fetchYahooSeries('^VIX'),
      fetchYahooSeries('^VVIX'),
      fetchYahooSeries('^VIX9D'),
    ]);
    const [vix, vvix, vix9d] = seriesList;
    const latest = vix[vix.length - 1];
    const values = vix.map(item => item.value as number);
    const score = percentileScore(latest?.value ?? null, values, 'fear');
    const indicators = [
      { key: 'vix', label: 'VIX', value: latest?.value ?? null, score: percentileScore(latest?.value ?? null, values, 'fear'), rating: '波动率恐慌' },
      { key: 'vvix', label: 'VVIX', value: vvix[vvix.length - 1]?.value ?? null, score: percentileScore(vvix[vvix.length - 1]?.value ?? null, vvix.map(item => item.value as number), 'fear'), rating: '波动率的波动率' },
      { key: 'vix9d', label: 'VIX9D', value: vix9d[vix9d.length - 1]?.value ?? null, score: percentileScore(vix9d[vix9d.length - 1]?.value ?? null, vix9d.map(item => item.value as number), 'fear'), rating: '短端恐慌' },
    ];

    return {
      id: 'volatility',
      title: 'VIX 波动率恐慌指标',
      shortTitle: 'VIX',
      source: 'Yahoo Finance / Cboe',
      sourceUrl: 'https://www.cboe.com/tradable_products/vix/',
      score,
      rawValue: latest?.value ?? null,
      rating: normalizeRating(score),
      timestamp: latest?.date ?? null,
      description: '用 VIX 的近两年历史分位转换为 0-100 情绪分数；分数越低代表波动率恐慌越重。',
      higherMeans: 'greed',
      history: vix.map(item => ({
        date: item.date,
        score: percentileScore(item.value, values, 'fear') ?? 0,
        rating: normalizeRating(percentileScore(item.value, values, 'fear')),
      })),
      indicators,
    };
  } catch (error) {
    return unavailableMetric('volatility', 'VIX 波动率恐慌指标', 'VIX', 'Yahoo Finance / Cboe', 'https://www.cboe.com/tradable_products/vix/', 'VIX、VVIX、VIX9D 的波动率情绪模块。', error);
  }
}

async function fetchFredSeries(seriesId: string) {
  const response = await fetch(`${FRED_CSV_BASE}${seriesId}`, { headers: JSON_HEADERS, next: { revalidate: 3600 } });
  if (!response.ok) throw new Error(`FRED ${seriesId} returned ${response.status}`);
  const rows = parseCsv(await response.text());
  return rows.map(row => ({
    date: row.observation_date || row.DATE || row.date,
    value: toNumber(row[seriesId]),
  })).filter(item => item.date && item.value !== null);
}

async function fetchFinancialStress(): Promise<SentimentMetric> {
  try {
    const [stlfsi, nfci] = await Promise.all([fetchFredSeries('STLFSI4'), fetchFredSeries('NFCI')]);
    const latest = stlfsi[stlfsi.length - 1];
    const values = stlfsi.slice(-260).map(item => item.value as number);
    const score = percentileScore(latest?.value ?? null, values, 'fear');

    return {
      id: 'financial-stress',
      title: '金融压力指数',
      shortTitle: 'Stress',
      source: 'FRED',
      sourceUrl: 'https://fred.stlouisfed.org/series/STLFSI4',
      score,
      rawValue: latest?.value ?? null,
      rating: normalizeRating(score),
      timestamp: latest?.date ?? null,
      description: 'St. Louis Fed 金融压力指数和芝加哥联储 NFCI，用来观察系统性金融压力。',
      higherMeans: 'greed',
      history: stlfsi.slice(-260).map(item => ({
        date: item.date,
        score: percentileScore(item.value, values, 'fear') ?? 0,
        rating: normalizeRating(percentileScore(item.value, values, 'fear')),
      })),
      indicators: [
        { key: 'stlfsi4', label: 'STLFSI4', value: latest?.value ?? null, score, rating: 'St. Louis Fed Financial Stress' },
        { key: 'nfci', label: 'NFCI', value: nfci[nfci.length - 1]?.value ?? null, score: percentileScore(nfci[nfci.length - 1]?.value ?? null, nfci.slice(-260).map(item => item.value as number), 'fear'), rating: 'Chicago Fed National Financial Conditions' },
      ],
    };
  } catch (error) {
    return unavailableMetric('financial-stress', '金融压力指数', 'Stress', 'FRED', 'https://fred.stlouisfed.org/series/STLFSI4', '美国金融压力与金融条件指标。', error);
  }
}

function parseNaaiMRows(html: string) {
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const matches = [...text.matchAll(/([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4})\s+(-?\d+(?:\.\d+)?)/g)];
  return matches.map(match => ({
    date: match[1],
    value: toNumber(match[2]),
  })).filter(item => item.value !== null);
}

async function fetchNaaim(): Promise<SentimentMetric> {
  try {
    const sourceUrl = 'https://naaim.org/programs/naaim-exposure-index/';
    const response = await fetch(sourceUrl, { headers: JSON_HEADERS, next: { revalidate: 3600 } });
    if (!response.ok) throw new Error(`NAAIM returned ${response.status}`);
    const rows = parseNaaiMRows(await response.text()).slice(-104);
    const latest = rows[rows.length - 1];
    const values = rows.map(item => item.value as number);
    const score = percentileScore(latest?.value ?? null, values, 'greed');

    return {
      id: 'naaim',
      title: 'NAAIM Exposure Index',
      shortTitle: 'NAAIM',
      source: 'NAAIM',
      sourceUrl,
      score,
      rawValue: latest?.value ?? null,
      rating: normalizeRating(score),
      timestamp: latest?.date ?? null,
      description: '主动投资经理报告的美股平均敞口，越高表示机构仓位越积极。',
      higherMeans: 'greed',
      history: rows.map(item => ({
        date: item.date,
        score: percentileScore(item.value, values, 'greed') ?? 0,
        rating: normalizeRating(percentileScore(item.value, values, 'greed')),
      })),
      indicators: [
        { key: 'naaim_exposure', label: '平均美股敞口', value: latest?.value ?? null, score, rating: '主动管理人仓位' },
      ],
    };
  } catch (error) {
    return unavailableMetric('naaim', 'NAAIM Exposure Index', 'NAAIM', 'NAAIM', 'https://naaim.org/programs/naaim-exposure-index/', '主动投资经理美股敞口。', error);
  }
}

async function fetchPutCall(): Promise<SentimentMetric> {
  try {
    const sourceUrl = 'https://www.cboe.com/data/mktstat.aspx';
    const response = await fetch(sourceUrl, { headers: JSON_HEADERS, next: { revalidate: 900 } });
    if (!response.ok) throw new Error(`Cboe returned ${response.status}`);
    const text = (await response.text()).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const labels = [
      ['total', 'Total Put/Call', /TOTAL PUT\/CALL RATIO\s+([0-9.]+)/i],
      ['index', 'Index Put/Call', /INDEX PUT\/CALL RATIO\s+([0-9.]+)/i],
      ['equity', 'Equity Put/Call', /EQUITY PUT\/CALL RATIO\s+([0-9.]+)/i],
      ['spx', 'SPX + SPXW Put/Call', /SPX \+ SPXW PUT\/CALL RATIO\s+([0-9.]+)/i],
    ];
    const indicators = labels.map(([key, label, regex]) => {
      const value = toNumber(text.match(regex as RegExp)?.[1]);
      const score = value === null ? null : clampScore(100 - ((value - 0.45) / (1.25 - 0.45)) * 100);
      return { key: key as string, label: label as string, value, score, rating: normalizeRating(score) };
    }).filter(item => item.value !== null);
    const main = indicators.find(item => item.key === 'total') || indicators[0];

    return {
      id: 'put-call',
      title: 'Cboe Put/Call Ratio',
      shortTitle: 'P/C',
      source: 'Cboe',
      sourceUrl,
      score: main?.score ?? null,
      rawValue: main?.value ?? null,
      rating: normalizeRating(main?.score ?? null),
      timestamp: new Date().toISOString(),
      description: '期权市场 Put/Call Ratio。比值越高代表保护/押跌需求越强，通常按反向情绪指标理解。',
      higherMeans: 'greed',
      history: [],
      indicators,
    };
  } catch (error) {
    return unavailableMetric('put-call', 'Cboe Put/Call Ratio', 'P/C', 'Cboe', 'https://www.cboe.com/data/mktstat.aspx', '期权市场 Put/Call Ratio。', error);
  }
}

async function fetchAaii(): Promise<SentimentMetric> {
  try {
    const sourceUrl = 'https://insights.aaii.com/';
    const response = await fetch('https://insights.aaii.com/?q=Sentiment%20Survey', { headers: JSON_HEADERS, next: { revalidate: 3600 } });
    if (!response.ok) throw new Error(`AAII insights returned ${response.status}`);
    const text = (await response.text()).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const bullish = toNumber(text.match(/Bullish[^0-9]+([0-9]+(?:\.[0-9]+)?)%/i)?.[1]);
    const bearish = toNumber(text.match(/Bearish[^0-9]+([0-9]+(?:\.[0-9]+)?)%/i)?.[1]);
    const neutral = toNumber(text.match(/Neutral[^0-9]+([0-9]+(?:\.[0-9]+)?)%/i)?.[1]);
    if (bullish === null || bearish === null) throw new Error('AAII 当前情绪数据解析失败');
    const spread = bullish - bearish;
    const score = clampScore(50 + spread);

    return {
      id: 'aaii',
      title: 'AAII Investor Sentiment',
      shortTitle: 'AAII',
      source: 'AAII',
      sourceUrl,
      score,
      rawValue: spread,
      rating: normalizeRating(score),
      timestamp: new Date().toISOString(),
      description: '美国个人投资者看多/看空调查，Bull-Bear Spread 越高代表散户越乐观。',
      higherMeans: 'greed',
      history: [],
      indicators: [
        { key: 'bullish', label: 'Bullish', value: bullish, score: bullish, rating: '看多比例' },
        { key: 'neutral', label: 'Neutral', value: neutral, score: neutral, rating: '中性比例' },
        { key: 'bearish', label: 'Bearish', value: bearish, score: bearish === null ? null : 100 - bearish, rating: '看空比例' },
        { key: 'spread', label: 'Bull-Bear Spread', value: spread, score, rating: '多空差' },
      ],
    };
  } catch (error) {
    return unavailableMetric('aaii', 'AAII Investor Sentiment', 'AAII', 'AAII', 'https://www.aaii.com/sentimentsurvey', '美国个人投资者情绪调查。', error);
  }
}

async function fetchCot(): Promise<SentimentMetric> {
  try {
    const sourceUrl = 'https://publicreporting.cftc.gov/Commitments-of-Traders/Legacy_All/srt6-5q2f';
    const query = encodeURIComponent("contract_market_name like '%E-MINI S&P 500%' AND report_type = 'Futures Only'");
    const response = await fetch(`https://publicreporting.cftc.gov/resource/srt6-5q2f.json?$limit=120&$order=report_date_as_yyyy_mm_dd%20DESC&$where=${query}`, {
      headers: JSON_HEADERS,
      next: { revalidate: 3600 },
    });
    if (!response.ok) throw new Error(`CFTC returned ${response.status}`);
    const rows = await response.json();
    const parsed = (Array.isArray(rows) ? rows : []).map((row: any) => {
      const long = toNumber(row.noncomm_positions_long_all);
      const short = toNumber(row.noncomm_positions_short_all);
      const oi = toNumber(row.open_interest_all);
      const net = long !== null && short !== null ? long - short : null;
      const netPct = net !== null && oi ? (net / oi) * 100 : null;
      return { date: row.report_date_as_yyyy_mm_dd, value: netPct };
    }).filter(item => item.date && item.value !== null).reverse();
    const latest = parsed[parsed.length - 1];
    const values = parsed.map(item => item.value as number);
    const score = percentileScore(latest?.value ?? null, values, 'greed');

    return {
      id: 'cot-spx',
      title: 'CFTC COT S&P 500 非商业净仓位',
      shortTitle: 'COT',
      source: 'CFTC',
      sourceUrl,
      score,
      rawValue: latest?.value ?? null,
      rating: normalizeRating(score),
      timestamp: latest?.date ?? null,
      description: 'CFTC COT 中 E-mini S&P 500 非商业交易者净仓位占未平仓比例，越高代表投机资金越偏多。',
      higherMeans: 'greed',
      history: parsed.map(item => ({
        date: item.date,
        score: percentileScore(item.value, values, 'greed') ?? 0,
        rating: normalizeRating(percentileScore(item.value, values, 'greed')),
      })),
      indicators: [
        { key: 'noncommercial_net_pct_oi', label: '非商业净仓位/未平仓', value: latest?.value ?? null, score, rating: 'S&P 500 投机净仓位' },
      ],
    };
  } catch (error) {
    return unavailableMetric('cot-spx', 'CFTC COT S&P 500 非商业净仓位', 'COT', 'CFTC', 'https://publicreporting.cftc.gov/stories/s/Commitments-of-Traders/r4w3-av2u/', 'CFTC 期货市场大资金仓位。', error);
  }
}

export async function GET() {
  const metrics = await Promise.all([
    fetchCnnFearGreed(),
    fetchCryptoFearGreed(),
    fetchVolatilityGauge(),
    fetchPutCall(),
  ]);

  return NextResponse.json({
    updatedAt: new Date().toISOString(),
    metrics,
  });
}
