import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { saveDividendLowVolSnapshot } from '@/app/lib/dividendLowVolStore';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const isAuthorized = (request: NextRequest) => {
  const expected = process.env.DIVIDEND_LOW_VOL_SYNC_SECRET;
  if (!expected) return { ok: false, configurationMissing: true };
  const provided = request.headers.get('x-dividend-low-vol-secret')
    || request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!provided) return { ok: false, configurationMissing: false };
  const actualBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  const matches = actualBuffer.length === expectedBuffer.length
    && timingSafeEqual(actualBuffer, expectedBuffer);
  return { ok: matches, configurationMissing: false };
};

export async function POST(request: NextRequest) {
  const authorization = isAuthorized(request);
  if (authorization.configurationMissing) {
    return NextResponse.json({ ok: false, error: 'Sync endpoint is not configured.' }, { status: 503 });
  }
  if (!authorization.ok) {
    return NextResponse.json({ ok: false, error: 'Unauthorized sync request.' }, { status: 401 });
  }

  try {
    const payload = await request.json();
    const result = await saveDividendLowVolSnapshot(payload);
    return NextResponse.json({ ok: true, ...result }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid sync payload.';
    console.error('[dividend-low-vol] publish failed', error);
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
