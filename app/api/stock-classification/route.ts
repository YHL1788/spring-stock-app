import { NextRequest, NextResponse } from 'next/server';
import {
  classifyExternalProfile,
  getCuratedClassification,
  toYahooSymbol,
  type ExternalStockProfile,
  type StockClassificationInput,
} from '@/app/lib/stockClassification';

export const dynamic = 'force-dynamic';

const SEARCH_URL = 'https://query1.finance.yahoo.com/v1/finance/search';
const YAHOO_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
};

async function fetchYahooProfile(input: StockClassificationInput): Promise<ExternalStockProfile | null> {
  const yahooSymbol = toYahooSymbol(input.symbol, input.currency);
  try {
    const response = await fetch(`${SEARCH_URL}?q=${encodeURIComponent(yahooSymbol)}&quotesCount=8&newsCount=0`, {
      headers: YAHOO_HEADERS,
      cache: 'no-store',
    });
    if (!response.ok) return null;
    const payload = await response.json();
    const quotes = Array.isArray(payload?.quotes) ? payload.quotes : [];
    const exact = quotes.find((quote: any) => String(quote.symbol || '').toUpperCase() === yahooSymbol);
    const equity = quotes.find((quote: any) => ['EQUITY', 'ETF', 'MUTUALFUND', 'INDEX'].includes(String(quote.quoteType || '').toUpperCase()));
    return (exact || equity || quotes[0] || null) as ExternalStockProfile | null;
  } catch {
    return null;
  }
}

async function classifyOne(input: StockClassificationInput) {
  const normalized = {
    symbol: String(input.symbol || '').trim().toUpperCase(),
    currency: String(input.currency || '').trim().toUpperCase(),
    name: String(input.name || '').trim(),
  };
  if (!normalized.symbol) return null;
  const curated = getCuratedClassification(normalized);
  if (curated) return curated;
  const profile = await fetchYahooProfile(normalized);
  return classifyExternalProfile(normalized, profile);
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>) {
  const output = new Array<R>(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await worker(items[index]);
    }
  });
  await Promise.all(runners);
  return output;
}

export async function GET(request: NextRequest) {
  const input = {
    symbol: request.nextUrl.searchParams.get('symbol') || '',
    currency: request.nextUrl.searchParams.get('currency') || '',
    name: request.nextUrl.searchParams.get('name') || '',
  };
  const result = await classifyOne(input);
  if (!result) return NextResponse.json({ error: 'Missing symbol' }, { status: 400 });
  return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const stocks = (Array.isArray(body?.stocks) ? body.stocks : []).slice(0, 250) as StockClassificationInput[];
  if (!stocks.length) return NextResponse.json({ error: 'stocks is required' }, { status: 400 });
  const classified = await mapWithConcurrency(stocks, 6, classifyOne);
  return NextResponse.json({
    results: classified.filter(Boolean),
    requested: stocks.length,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
