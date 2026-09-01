import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb, getServerAppId } from '@/app/lib/firebaseAdmin';
import type {
  DividendLowVolSnapshot,
  DividendLowVolVersion,
} from '@/types/dividend-low-vol';

const RUNS_COLLECTION = 'sip_dividend_low_vol_runs';
const LATEST_COLLECTION = 'sip_dividend_low_vol_latest';
const LATEST_ID = 'current';

const dataCollection = (name: string) => getAdminDb()
  .collection('artifacts')
  .doc(getServerAppId())
  .collection('public')
  .doc('data')
  .collection(name);

const serializeValue = (value: any): any => {
  if (value == null) return value;
  if (typeof value?.toDate === 'function') return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(serializeValue);
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, serializeValue(child)]));
  }
  return value;
};

export const validateDividendLowVolSnapshot = (payload: unknown): DividendLowVolSnapshot => {
  const snapshot = payload as DividendLowVolSnapshot;
  const experimentId = snapshot?.experiment?.experiment_id;
  if (snapshot?.schema_version !== 1 || snapshot?.source !== 'hk-dividend-low-vol-lab') {
    throw new Error('Unsupported dividend low volatility snapshot schema.');
  }
  if (!experimentId || !/^[A-Za-z0-9_-]{4,80}$/.test(experimentId)) {
    throw new Error('Invalid experiment id.');
  }
  if (
    !Array.isArray(snapshot.backtest_monthly)
    || !Array.isArray(snapshot.backtest_holdings)
    || !Array.isArray(snapshot.latest_selection)
    || !Array.isArray(snapshot.rank_ic_monthly)
  ) {
    throw new Error('Snapshot is missing backtest or selection arrays.');
  }
  if (!snapshot.backtest_monthly.length) {
    throw new Error('Snapshot does not contain a completed monthly backtest.');
  }
  if (snapshot.backtest_monthly.length > 360 || snapshot.backtest_holdings.length > 6000) {
    throw new Error('Snapshot exceeds the supported history size.');
  }
  return snapshot;
};

export const saveDividendLowVolSnapshot = async (payload: unknown) => {
  const snapshot = validateDividendLowVolSnapshot(payload);
  const experimentId = snapshot.experiment.experiment_id;
  const runRef = dataCollection(RUNS_COLLECTION).doc(experimentId);
  const latestRef = dataCollection(LATEST_COLLECTION).doc(LATEST_ID);
  const batch = getAdminDb().batch();

  batch.set(runRef, {
    ...snapshot,
    received_at: FieldValue.serverTimestamp(),
  }, { merge: false });

  if (snapshot.experiment.approved) {
    batch.set(latestRef, {
      experiment_id: experimentId,
      display_name: snapshot.experiment.display_name,
      published_at: snapshot.published_at,
      updated_at: FieldValue.serverTimestamp(),
    }, { merge: false });
  }

  await batch.commit();
  return { experimentId, approved: snapshot.experiment.approved };
};

export const listDividendLowVolVersions = async (): Promise<DividendLowVolVersion[]> => {
  const result = await dataCollection(RUNS_COLLECTION)
    .orderBy('received_at', 'desc')
    .limit(50)
    .get();
  return result.docs.map((doc) => {
    const data = serializeValue(doc.data());
    return {
      experiment_id: doc.id,
      display_name: data.experiment?.display_name || data.experiment?.version_name || doc.id,
      version_name: data.experiment?.version_name || doc.id,
      model_label: data.experiment?.model_label || data.experiment?.model_name || '未知模型',
      approved: Boolean(data.experiment?.approved),
      status: data.experiment?.status || 'completed',
      published_at: data.published_at || '',
      received_at: data.received_at || null,
      factor_month_end: data.summary?.factor_month_end || null,
    };
  });
};

export const getDividendLowVolSnapshot = async (requestedExperimentId?: string | null) => {
  let experimentId = requestedExperimentId || '';
  if (!experimentId) {
    const latest = await dataCollection(LATEST_COLLECTION).doc(LATEST_ID).get();
    experimentId = latest.exists ? String(latest.data()?.experiment_id || '') : '';
  }
  if (!experimentId) {
    const fallback = await dataCollection(RUNS_COLLECTION).orderBy('received_at', 'desc').limit(1).get();
    experimentId = fallback.empty ? '' : fallback.docs[0].id;
  }
  if (!experimentId) return null;

  const snapshot = await dataCollection(RUNS_COLLECTION).doc(experimentId).get();
  if (!snapshot.exists) return null;
  const data = serializeValue(snapshot.data());
  delete data.received_at;
  return data as DividendLowVolSnapshot;
};
