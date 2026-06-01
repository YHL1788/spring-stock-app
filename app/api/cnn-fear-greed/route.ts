import { NextResponse } from 'next/server';

const CNN_FEAR_GREED_API = 'https://production.dataviz.cnn.io/index/fearandgreed/graphdata';

const INDICATOR_KEYS = [
  'market_momentum_sp500',
  'stock_price_strength',
  'stock_price_breadth',
  'put_call_options',
  'market_volatility_vix',
  'junk_bond_demand',
  'safe_haven_demand',
];

function toNumber(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
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

export async function GET() {
  try {
    const response = await fetch(CNN_FEAR_GREED_API, {
      headers: {
        Accept: 'application/json',
        Referer: 'https://edition.cnn.com/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36',
      },
      next: { revalidate: 300 },
    });

    if (!response.ok) {
      return NextResponse.json({ error: `CNN API returned ${response.status}` }, { status: 502 });
    }

    const data = await response.json();
    const current = data?.fear_and_greed || {};
    const score = toNumber(current.score);
    const historyRows = Array.isArray(data?.fear_and_greed_historical?.data)
      ? data.fear_and_greed_historical.data
      : [];

    const indicators = INDICATOR_KEYS.map((key) => {
      const item = data?.[key] || {};
      const itemScore = toNumber(item.score);
      return {
        key,
        score: itemScore,
        rating: normalizeRating(itemScore, item.rating),
      };
    }).filter((item) => item.score !== null);

    return NextResponse.json({
      source: 'CNN',
      sourceUrl: 'https://edition.cnn.com/markets/fear-and-greed',
      score,
      rating: normalizeRating(score, current.rating),
      timestamp: current.timestamp || null,
      previous: {
        close: toNumber(current.previous_close),
        oneWeek: toNumber(current.previous_1_week),
        oneMonth: toNumber(current.previous_1_month),
        oneYear: toNumber(current.previous_1_year),
      },
      indicators,
      history: historyRows.slice(-730).map((item: any) => ({
        date: item.x || item.date || item.timestamp,
        score: toNumber(item.y ?? item.score),
        rating: normalizeRating(toNumber(item.y ?? item.score), item.rating),
      })).filter((item: any) => item.score !== null),
      updatedAt: new Date().toISOString(),
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Failed to fetch CNN Fear & Greed Index' }, { status: 500 });
  }
}
