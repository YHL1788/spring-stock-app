import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const UPSTREAM_URLS = [
  'https://www.junquant.com/api/crowding/score-v2/latest',
  'https://www.junquant.com/api/us-market/score-v2/latest',
];

type UpstreamPayload = {
  available?: boolean;
  date?: string;
  raw_score?: number;
  confirmed_score?: number;
  n_active_signals?: number;
  sub_signals?: Record<string, number>;
};

function riskLabel(score: number) {
  if (score >= 0.85) return '极端风险';
  if (score >= 0.75) return '短期高风险';
  if (score >= 0.6) return '风险升温';
  if (score >= 0.4) return '中性偏谨慎';
  return '正常或动量延续';
}

function normalize(payload: UpstreamPayload) {
  const confirmedScore = Number(payload.confirmed_score || 0);
  const signals = payload.sub_signals || {};
  return {
    available: payload.available !== false,
    current: {
      date: payload.date || '',
      rawScore: Number(payload.raw_score || 0),
      confirmedScore,
      activeSignals: Number(payload.n_active_signals || 0),
      subSignals: {
        factorReversal: Number(signals.factor_reversal || 0),
        soxReversal: Number(signals.sox_reversal || 0),
        cftcExtreme: Number(signals.cftc_extreme || 0),
        vixRising: Number(signals.vix_rising || 0),
        leadingWeak: Number(signals.leading_weak || 0),
      },
      riskLabel: riskLabel(confirmedScore),
      modelVersion: 'junquant-v2',
      source: 'junquant-live',
    },
    history: { points: [] },
  };
}

export async function GET() {
  for (const url of UPSTREAM_URLS) {
    try {
      const response = await fetch(url, {
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) continue;
      const payload = await response.json() as UpstreamPayload;
      if (payload.available === false || !payload.date) continue;
      return NextResponse.json(normalize(payload), {
        headers: { 'Cache-Control': 'no-store' },
      });
    } catch {
      // Try the next compatible upstream endpoint.
    }
  }

  return NextResponse.json(
    { available: false, error: 'Top-risk score is temporarily unavailable.' },
    { status: 503 },
  );
}

