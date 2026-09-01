import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import {
  getDividendLowVolSnapshot,
  listDividendLowVolVersions,
} from '@/app/lib/dividendLowVolStore';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ ok: false, error: 'Unauthorized.' }, { status: 401 });
  }
  try {
    const experimentId = request.nextUrl.searchParams.get('experimentId');
    const [snapshot, versions] = await Promise.all([
      getDividendLowVolSnapshot(experimentId),
      listDividendLowVolVersions(),
    ]);
    return NextResponse.json({ ok: true, snapshot, versions }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    console.error('[dividend-low-vol] read failed', error);
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to load dividend low volatility snapshot.',
    }, { status: 500 });
  }
}
