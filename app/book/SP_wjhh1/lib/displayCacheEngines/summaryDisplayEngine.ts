import { getAdminDb, getServerAppId } from '@/app/lib/firebaseAdmin';
import {
  buildPortfolioSnapshot,
  type AssetId,
  type PortfolioSnapshot,
  type SummaryMatrixData,
} from '@/app/book/SP_wjhh1/lib/portfolioNavEngine';

export type SummaryDisplayCacheResult = {
  status: 'success' | 'partial_success';
  data: {
    snapshot: PortfolioSnapshot;
    mktDataMap: Record<string, SummaryMatrixData>;
    plDataMap: Record<string, SummaryMatrixData>;
    fxRates: Record<string, number>;
    rawCounts: {
      displayCacheInputs: string[];
      formalSummaryInputs: string[];
      missingInputs: string[];
    };
  };
  warnings: string[];
  errors: string[];
};

const DISPLAY_ASSETS: AssetId[] = ['cash', 'stock', 'option', 'fcn', 'dqaq'];
const FORMAL_ONLY_ASSETS: AssetId[] = ['pe', 'cbbc'];
const FALLBACK_FX_RATES: Record<string, number> = {
  HKD: 1,
  USD: 7.78,
  JPY: 0.052,
  CNY: 1.08,
};

const getDataCollection = (collectionName: string) => {
  const appId = getServerAppId();
  return getAdminDb()
    .collection('artifacts')
    .doc(appId)
    .collection('public')
    .doc('data')
    .collection(collectionName);
};

const getDataDoc = (collectionName: string, docId: string) => getDataCollection(collectionName).doc(docId);

const timestampToIso = (value: any) => {
  if (!value) return new Date().toISOString();
  if (value.toDate && typeof value.toDate === 'function') return value.toDate().toISOString();
  if (value.seconds) return new Date(value.seconds * 1000).toISOString();
  if (typeof value === 'string') return value;
  return new Date(value).toISOString();
};

const fetchDisplayCacheData = async (moduleName: string) => {
  const snapshot = await getDataDoc('sip_display_cache_current', moduleName).get();
  if (!snapshot.exists) return null;
  const docData = snapshot.data();
  return {
    data: docData?.data || {},
    updatedAt: timestampToIso(docData?.calculatedAt),
  };
};

const fetchFormalSummary = async (collectionName: string): Promise<SummaryMatrixData | null> => {
  const snapshot = await getDataDoc(collectionName, 'latest_summary').get();
  return snapshot.exists ? snapshot.data() as SummaryMatrixData : null;
};

const withUpdatedAt = (matrix: SummaryMatrixData | null | undefined, updatedAt: string): SummaryMatrixData | null => {
  if (!matrix || !Array.isArray(matrix.markets) || !matrix.rawMatrix) return null;
  return { ...matrix, updatedAt };
};

const mergeFxRates = (target: Record<string, number>, source?: Record<string, number>) => {
  if (!source) return;
  Object.entries(source).forEach(([currency, rate]) => {
    const numeric = Number(rate);
    if (currency && Number.isFinite(numeric) && numeric > 0) target[currency] = numeric;
  });
};

export const calculateSummaryDisplayCache = async (): Promise<SummaryDisplayCacheResult> => {
  const warnings: string[] = [];
  const errors: string[] = [];
  const displayCacheInputs: string[] = [];
  const formalSummaryInputs: string[] = [];
  const missingInputs: string[] = [];
  const mktDataMap: Record<string, SummaryMatrixData> = {};
  const plDataMap: Record<string, SummaryMatrixData> = {};
  const fxRates: Record<string, number> = { ...FALLBACK_FX_RATES };

  await Promise.all(DISPLAY_ASSETS.map(async (assetId) => {
    const cached = await fetchDisplayCacheData(assetId);
    if (!cached) {
      missingInputs.push(`${assetId} display cache`);
      return;
    }
    displayCacheInputs.push(`${assetId} display cache`);
    if (assetId === 'cash') {
      const mkt = withUpdatedAt(cached.data.currentCashStats, cached.updatedAt);
      const pl = withUpdatedAt(cached.data.currentPlStats, cached.updatedAt);
      if (mkt) mktDataMap[assetId] = mkt;
      if (pl) plDataMap[assetId] = pl;
      mergeFxRates(fxRates, cached.data.fxRates);
      return;
    }

    const mkt = withUpdatedAt(cached.data.currentMktStats, cached.updatedAt);
    const pl = withUpdatedAt(cached.data.currentPlStats, cached.updatedAt);
    if (mkt) mktDataMap[assetId] = mkt;
    else missingInputs.push(`${assetId} currentMktStats`);
    if (pl) plDataMap[assetId] = pl;
    else missingInputs.push(`${assetId} currentPlStats`);
    mergeFxRates(fxRates, cached.data.fxRates || cached.data.quoteStatus?.fxRates);
  }));

  await Promise.all(FORMAL_ONLY_ASSETS.map(async (assetId) => {
    const [mkt, pl] = await Promise.all([
      fetchFormalSummary(`sip_holding_${assetId}_mktvalue`),
      fetchFormalSummary(`sip_holding_${assetId}_pl`),
    ]);
    if (mkt) {
      mktDataMap[assetId] = mkt;
      formalSummaryInputs.push(`sip_holding_${assetId}_mktvalue/latest_summary`);
    } else {
      missingInputs.push(`${assetId} formal mktvalue summary`);
    }
    if (pl) {
      plDataMap[assetId] = pl;
      formalSummaryInputs.push(`sip_holding_${assetId}_pl/latest_summary`);
    } else {
      missingInputs.push(`${assetId} formal pl summary`);
    }
  }));

  if (missingInputs.length > 0) {
    warnings.push(`Missing summary inputs: ${missingInputs.join(', ')}.`);
  }

  const snapshot = buildPortfolioSnapshot({
    mktDataMap,
    plDataMap,
    fxRates,
    note: 'backend-display-cache-preview',
  });

  return {
    status: warnings.length > 0 ? 'partial_success' : 'success',
    data: {
      snapshot,
      mktDataMap,
      plDataMap,
      fxRates,
      rawCounts: {
        displayCacheInputs,
        formalSummaryInputs,
        missingInputs,
      },
    },
    warnings,
    errors,
  };
};
