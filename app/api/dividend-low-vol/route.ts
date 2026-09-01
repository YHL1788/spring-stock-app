import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import {
  getDividendLowVolSnapshot,
  listDividendLowVolVersions,
} from '@/app/lib/dividendLowVolStore';
import type { DividendLowVolApiResponse } from '@/types/dividend-low-vol';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const CACHE_TTL_MS = 15 * 60 * 1000;
const STALE_TTL_MS = 24 * 60 * 60 * 1000;

type CachedResult = {
  cachedAt: number;
  payload: DividendLowVolApiResponse;
};

const globalCache = globalThis as typeof globalThis & {
  __dividendLowVolCache?: Map<string, CachedResult>;
};
const responseCache = globalCache.__dividendLowVolCache
  || (globalCache.__dividendLowVolCache = new Map<string, CachedResult>());

const isQuotaError = (error: unknown) => {
  const code = String((error as { code?: unknown })?.code || '').toLowerCase();
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return code.includes('resource-exhausted')
    || message.includes('resource_exhausted')
    || message.includes('quota exceeded');
};

export async function GET(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ ok: false, error: 'Unauthorized.' }, { status: 401 });
  }
  try {
    const experimentId = request.nextUrl.searchParams.get('experimentId');
    const cacheKey = experimentId || '__latest__';
    const cached = responseCache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt <= CACHE_TTL_MS) {
      return NextResponse.json(cached.payload, {
        headers: { 'Cache-Control': 'private, max-age=60' },
      });
    }
    const [snapshot, versions] = await Promise.all([
      getDividendLowVolSnapshot(experimentId),
      listDividendLowVolVersions(),
    ]);
    const payload: DividendLowVolApiResponse = { ok: true, snapshot: snapshot || undefined, versions };
    responseCache.set(cacheKey, { cachedAt: Date.now(), payload });
    return NextResponse.json(payload, {
      headers: { 'Cache-Control': 'private, max-age=60' },
    });
  } catch (error) {
    console.error('[dividend-low-vol] read failed', error);
    const experimentId = request.nextUrl.searchParams.get('experimentId');
    const cacheKey = experimentId || '__latest__';
    const cached = responseCache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt <= STALE_TTL_MS) {
      return NextResponse.json({
        ...cached.payload,
        stale: true,
        warning: '云端数据服务暂时繁忙，当前展示最近一次成功读取的结果。',
      }, { headers: { 'Cache-Control': 'private, no-store' } });
    }
    const quotaExceeded = isQuotaError(error);
    return NextResponse.json({
      ok: false,
      error_code: quotaExceeded ? 'storage_quota_exhausted' : 'storage_unavailable',
      error: quotaExceeded
        ? '云端数据服务今日配额已用尽，暂时无法读取同步结果。请稍后再试或提升 Firebase 配额。'
        : '云端数据服务暂时不可用，请稍后重试。',
    }, { status: 503 });
  }
}
