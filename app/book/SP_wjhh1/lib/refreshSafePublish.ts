import { collection, doc, getDocs, query, setDoc, where, writeBatch, type Firestore } from 'firebase/firestore';
import { APP_ID } from '@/app/lib/stockService';

type LatestSummaryPayload = Record<string, unknown>;

interface PublishLatestSummaryOptions {
  db: Firestore;
  collectionName: string;
  docId?: string;
  payload: LatestSummaryPayload;
  refreshGroup: string;
  sourcePage: string;
}

interface ReplaceCollectionDocsOptions {
  db: Firestore;
  collectionName: string;
  records: Array<Record<string, unknown>>;
  matchField: string;
  matchValues: Array<string | number>;
  refreshGroup: string;
  sourcePage: string;
  addCreatedAt?: boolean;
}

const RUNS_COLLECTION = 'sip_refresh_runs';

const makeSafeId = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '_');

const createRunId = (refreshGroup: string, collectionName: string, docId: string) => {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const random = Math.random().toString(36).slice(2, 8);
  return `${makeSafeId(refreshGroup)}__${makeSafeId(collectionName)}__${makeSafeId(docId)}__${stamp}__${random}`;
};

const findInvalidValue = (value: unknown, path = 'payload'): string | null => {
  if (value === undefined) return `${path} is undefined`;
  if (typeof value === 'number' && !Number.isFinite(value)) return `${path} is not finite`;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const invalid = findInvalidValue(value[index], `${path}[${index}]`);
      if (invalid) return invalid;
    }
    return null;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const invalid = findInvalidValue(child, `${path}.${key}`);
      if (invalid) return invalid;
    }
  }
  return null;
};

const hasRows = (value: unknown): boolean => {
  if (!value) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length > 0;
  return false;
};

const hasMeaningfulSummary = (payload: LatestSummaryPayload): boolean => {
  if (hasRows(payload.data)) return true;
  if (hasRows(payload.rawMatrix)) return true;
  if (hasRows(payload.accounts) || hasRows(payload.markets)) return true;
  return false;
};

const assertPublishablePayload = (payload: LatestSummaryPayload) => {
  const invalid = findInvalidValue(payload);
  if (invalid) {
    throw new Error(`Refresh payload validation failed: ${invalid}`);
  }
  if (!hasMeaningfulSummary(payload)) {
    throw new Error('Refresh payload validation failed: empty summary payload');
  }
};

export const publishLatestSummarySafely = async ({
  db,
  collectionName,
  docId = 'latest_summary',
  payload,
  refreshGroup,
  sourcePage,
}: PublishLatestSummaryOptions) => {
  const startedAt = new Date().toISOString();
  const runId = createRunId(refreshGroup, collectionName, docId);
  const targetId = `${collectionName}/${docId}`;
  const outputId = makeSafeId(targetId);
  const targetRef = doc(db, 'artifacts', APP_ID, 'public', 'data', collectionName, docId);
  const runRef = doc(db, 'artifacts', APP_ID, 'public', 'data', RUNS_COLLECTION, runId);
  const outputRef = doc(db, 'artifacts', APP_ID, 'public', 'data', RUNS_COLLECTION, runId, 'outputs', outputId);

  await setDoc(runRef, {
    runId,
    refreshGroup,
    sourcePage,
    status: 'running',
    startedAt,
    targetId,
    targets: [targetId],
  });

  try {
    assertPublishablePayload(payload);
    const finishedAt = new Date().toISOString();
    const finalPayload = {
      ...payload,
      refreshRunId: runId,
      refreshGroup,
      refreshStatus: 'success',
      refreshStartedAt: startedAt,
      refreshFinishedAt: finishedAt,
      sourcePage,
      updatedAt: payload.updatedAt ?? finishedAt,
    };

    await setDoc(outputRef, {
      targetId,
      status: 'draft',
      createdAt: new Date().toISOString(),
      payload: finalPayload,
    });

    const batch = writeBatch(db);
    batch.set(targetRef, finalPayload);
    batch.set(outputRef, {
      status: 'published',
      publishedAt: finishedAt,
    }, { merge: true });
    batch.set(runRef, {
      status: 'success',
      finishedAt,
      publishedAt: finishedAt,
    }, { merge: true });
    await batch.commit();

    return { runId, publishedAt: finishedAt };
  } catch (error) {
    await setDoc(runRef, {
      status: 'failed',
      finishedAt: new Date().toISOString(),
      errorMessage: error instanceof Error ? error.message : String(error),
    }, { merge: true });
    throw error;
  }
};

export const replaceCollectionDocsSafely = async ({
  db,
  collectionName,
  records,
  matchField,
  matchValues,
  refreshGroup,
  sourcePage,
  addCreatedAt = false,
}: ReplaceCollectionDocsOptions) => {
  const startedAt = new Date().toISOString();
  const runId = createRunId(refreshGroup, collectionName, 'collection_replace');
  const targetId = `${collectionName}/*`;
  const outputId = makeSafeId(`${targetId}/${matchField}`);
  const collectionRef = collection(db, 'artifacts', APP_ID, 'public', 'data', collectionName);
  const runRef = doc(db, 'artifacts', APP_ID, 'public', 'data', RUNS_COLLECTION, runId);
  const outputRef = doc(db, 'artifacts', APP_ID, 'public', 'data', RUNS_COLLECTION, runId, 'outputs', outputId);

  await setDoc(runRef, {
    runId,
    refreshGroup,
    sourcePage,
    status: 'running',
    startedAt,
    targetId,
    targets: [targetId],
    matchField,
    matchValues,
  });

  try {
    if (records.length === 0) {
      throw new Error('Refresh collection replacement failed: empty records');
    }

    records.forEach((record, index) => {
      const invalid = findInvalidValue(record, `records[${index}]`);
      if (invalid) throw new Error(`Refresh collection replacement failed: ${invalid}`);
    });

    const oldDocRefs = [];
    for (const matchValue of matchValues) {
      const snap = await getDocs(query(collectionRef, where(matchField, '==', matchValue)));
      oldDocRefs.push(...snap.docs.map((docSnap) => docSnap.ref));
    }

    const finishedAt = new Date().toISOString();
    const newRecords = records.map((record) => ({
      ...record,
      ...(addCreatedAt ? { createdAt: new Date() } : {}),
      refreshRunId: runId,
      refreshGroup,
      refreshStatus: 'success',
      refreshStartedAt: startedAt,
      refreshFinishedAt: finishedAt,
      sourcePage,
    }));

    await setDoc(outputRef, {
      targetId,
      status: 'draft',
      createdAt: new Date().toISOString(),
      matchField,
      matchValues,
      records: newRecords,
      oldDocCount: oldDocRefs.length,
      newDocCount: newRecords.length,
    });

    const batch = writeBatch(db);
    oldDocRefs.forEach((ref) => batch.delete(ref));
    newRecords.forEach((record) => batch.set(doc(collectionRef), record));
    batch.set(outputRef, {
      status: 'published',
      publishedAt: finishedAt,
    }, { merge: true });
    batch.set(runRef, {
      status: 'success',
      finishedAt,
      publishedAt: finishedAt,
      oldDocCount: oldDocRefs.length,
      newDocCount: newRecords.length,
    }, { merge: true });
    await batch.commit();

    return { runId, publishedAt: finishedAt, oldDocCount: oldDocRefs.length, newDocCount: newRecords.length };
  } catch (error) {
    await setDoc(runRef, {
      status: 'failed',
      finishedAt: new Date().toISOString(),
      errorMessage: error instanceof Error ? error.message : String(error),
    }, { merge: true });
    throw error;
  }
};
