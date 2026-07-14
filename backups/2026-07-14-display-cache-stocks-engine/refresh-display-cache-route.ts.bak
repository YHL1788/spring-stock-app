import { NextRequest, NextResponse } from 'next/server';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getAdminDb, getServerAppId } from '@/app/lib/firebaseAdmin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const LOCK_COLLECTION = 'sip_display_cache_locks';
const RUNS_COLLECTION = 'sip_display_cache_runs';
const MODULES_COLLECTION = 'sip_display_cache_modules';
const LATEST_COLLECTION = 'sip_display_cache_latest';
const LOCK_ID = 'global';
const LATEST_ID = 'current';
const LOCK_TTL_MS = 15 * 60 * 1000;

const createRunId = () => {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const random = Math.random().toString(36).slice(2, 8);
  return `display_${stamp}_${random}`;
};

const getDataDoc = (collectionName: string, docId: string) => {
  const appId = getServerAppId();
  return getAdminDb()
    .collection('artifacts')
    .doc(appId)
    .collection('public')
    .doc('data')
    .collection(collectionName)
    .doc(docId);
};

const validateSecret = (request: NextRequest) => {
  const expected = process.env.DISPLAY_REFRESH_SECRET || process.env.CRON_SECRET;
  if (!expected) {
    return { ok: true, warning: 'DISPLAY_REFRESH_SECRET is not configured; request accepted without secret.' };
  }
  const provided = request.nextUrl.searchParams.get('secret')
    || request.headers.get('x-display-refresh-secret')
    || request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  return { ok: provided === expected, warning: '' };
};

const acquireLock = async (runId: string) => {
  const db = getAdminDb();
  const lockRef = getDataDoc(LOCK_COLLECTION, LOCK_ID);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + LOCK_TTL_MS);

  await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(lockRef);
    const data = snap.exists ? snap.data() : null;
    const currentExpiresAt = data?.expiresAt?.toDate?.() as Date | undefined;
    const isActive = data?.locked === true && currentExpiresAt && currentExpiresAt.getTime() > now.getTime();
    if (isActive) {
      throw new Error(`Display cache refresh is already running: ${data?.runId || 'unknown'}`);
    }
    transaction.set(lockRef, {
      locked: true,
      runId,
      status: 'running',
      owner: 'refresh-display-cache-api',
      startedAt: Timestamp.fromDate(now),
      expiresAt: Timestamp.fromDate(expiresAt),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
};

const releaseLock = async (runId: string, status: 'success' | 'failed') => {
  await getDataDoc(LOCK_COLLECTION, LOCK_ID).set({
    locked: false,
    runId,
    status,
    releasedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
};

async function handleRefresh(request: NextRequest) {
  const secretResult = validateSecret(request);
  if (!secretResult.ok) {
    return NextResponse.json({ ok: false, error: 'Unauthorized display refresh request.' }, { status: 401 });
  }

  const runId = createRunId();
  const startedAt = new Date();
  const runRef = getDataDoc(RUNS_COLLECTION, runId);
  const infrastructureModuleRef = getDataDoc(MODULES_COLLECTION, `${runId}__infrastructure`);
  const latestRef = getDataDoc(LATEST_COLLECTION, LATEST_ID);

  try {
    await acquireLock(runId);
    await runRef.set({
      runId,
      status: 'running',
      mode: 'display_cache',
      triggeredBy: request.headers.get('x-vercel-cron') ? 'vercel-cron' : 'manual-api',
      startedAt: Timestamp.fromDate(startedAt),
      warnings: secretResult.warning ? [secretResult.warning] : [],
      modules: {},
      source: 'backend-display-cache',
      updatedAt: FieldValue.serverTimestamp(),
    });

    await infrastructureModuleRef.set({
      runId,
      module: 'infrastructure',
      status: 'success',
      calculatedAt: FieldValue.serverTimestamp(),
      data: {
        message: 'Display cache backend infrastructure is reachable.',
        formalBookDataTouched: false,
      },
      warnings: [],
      errors: [],
      source: 'backend-display-cache',
    });

    const finishedAt = new Date();
    await runRef.set({
      status: 'success',
      finishedAt: Timestamp.fromDate(finishedAt),
      modules: {
        infrastructure: 'success',
      },
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    await latestRef.set({
      runId,
      status: 'success',
      completedAt: Timestamp.fromDate(finishedAt),
      modules: {
        infrastructure: 'success',
      },
      source: 'backend-display-cache',
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    await releaseLock(runId, 'success');
    return NextResponse.json({ ok: true, runId, status: 'success' }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await runRef.set({
      runId,
      status: 'failed',
      errorMessage: message,
      finishedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true }).catch(() => {});
    await releaseLock(runId, 'failed').catch(() => {});
    const status = message.includes('already running') ? 423 : 500;
    return NextResponse.json({ ok: false, runId, error: message }, { status, headers: { 'Cache-Control': 'no-store' } });
  }
}

export async function GET(request: NextRequest) {
  return handleRefresh(request);
}

export async function POST(request: NextRequest) {
  return handleRefresh(request);
}
