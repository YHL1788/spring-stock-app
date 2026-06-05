export type AssetId = 'cash' | 'stock' | 'pe' | 'cbbc' | 'option' | 'fcn' | 'dqaq';

export type StartAssetId = 'cash' | 'stock' | 'pe' | 'cbbc';

export type SummaryMatrixData = {
  accounts?: string[];
  markets?: string[];
  rawMatrix?: Record<string, Record<string, number> | { realized?: number; unrealized?: number; total?: number }>;
  updatedAt?: string;
};

export type StartConfig = {
  baseDate?: string;
  baseFxRates?: Record<string, number>;
};

export type StartRecord = Record<string, any> & {
  id?: string;
};

export type InitialPortfolioDetail = {
  assetId: StartAssetId;
  sourceCollection: string;
  id: string;
  account: string;
  currency: string;
  label: string;
  quantity: number;
  price: number;
  amountLocal: number;
  fxRate: number;
  amountHKD: number;
};

export type InitialPortfolioState = {
  inceptionDate: string;
  initialNav: number;
  initialCapitalHKD: number;
  initialByAssetHKD: Record<StartAssetId, number>;
  initialByCurrencyHKD: Record<string, number>;
  sourceBaseDates: Record<StartAssetId, string>;
  fxRates: Record<string, number>;
  details: InitialPortfolioDetail[];
  updatedAt: string;
};

export type PortfolioSnapshot = {
  id?: string;
  snapshotAt: string;
  snapshotDate: string;
  totalMarketValueHKD: number;
  totalPnlHKD: number;
  marketValueByAssetHKD: Record<string, number>;
  pnlByAssetHKD: Record<string, number>;
  marketValueByCurrencyHKD: Record<string, number>;
  pnlByCurrencyHKD: Record<string, number>;
  fxRates: Record<string, number>;
  sourceUpdatedAt: Record<string, string>;
  note?: string;
  createdAt?: string;
};

export type CapitalFlow = {
  id?: string;
  flowDate: string;
  amountHKD: number;
  direction: 'IN' | 'OUT';
  account?: string;
  note?: string;
  sourceType?: string;
  sourceCollection?: string;
  currency?: string;
  originalAmount?: number;
  fxRate?: number;
  fxRateSource?: 'history' | 'saved' | 'fallback' | 'hkd';
  createdAt?: string;
};

export type NavPoint = {
  date: string;
  snapshotAt: string;
  totalMarketValueHKD: number;
  totalPnlHKD: number;
  periodNetFlowHKD: number;
  periodProfitHKD: number;
  periodReturn: number;
  unitNav: number;
  cumulativeReturn: number;
  cumulativeProfitHKD: number;
};

export type PerformanceStats = {
  latestNav: number;
  cumulativeReturn: number;
  cumulativeProfitHKD: number;
  maxDrawdown: number;
  annualizedReturn: number;
};

export const START_ASSETS: { id: StartAssetId; collection: string; label: string }[] = [
  { id: 'cash', collection: 'sip_holding_cash_start', label: 'Cash' },
  { id: 'stock', collection: 'sip_holding_spot_start', label: 'Spot' },
  { id: 'pe', collection: 'sip_holding_pe_start', label: 'PE' },
  { id: 'cbbc', collection: 'sip_holding_cbbc_start', label: 'CBBC/Futures' },
];

export const SUMMARY_ASSET_IDS: AssetId[] = ['cash', 'stock', 'pe', 'cbbc', 'option', 'fcn', 'dqaq'];

export function validateStartBaseDates(configs: Record<StartAssetId, StartConfig>) {
  const sourceBaseDates = START_ASSETS.reduce((acc, asset) => {
    acc[asset.id] = configs[asset.id]?.baseDate || '';
    return acc;
  }, {} as Record<StartAssetId, string>);

  const missing = START_ASSETS.filter((asset) => !sourceBaseDates[asset.id]);
  if (missing.length > 0) {
    throw new Error(`期初库缺少 baseDate：${missing.map((asset) => asset.label).join(' / ')}。请先在对应持仓页面设置期初日期。`);
  }

  const unique = Array.from(new Set(Object.values(sourceBaseDates)));
  if (unique.length !== 1) {
    throw new Error([
      '四个期初库 baseDate 不一致，无法生成净值起点。',
      ...START_ASSETS.map((asset) => `${asset.label}: ${sourceBaseDates[asset.id] || '缺失'}`),
      '请先回到对应持仓页面统一期初日期。',
    ].join('\n'));
  }

  return { inceptionDate: unique[0], sourceBaseDates };
}

export function buildInitialPortfolioState(params: {
  configs: Record<StartAssetId, StartConfig>;
  records: Record<StartAssetId, StartRecord[]>;
  fallbackFxRates?: Record<string, number>;
  initialNav?: number;
}): InitialPortfolioState {
  const { inceptionDate, sourceBaseDates } = validateStartBaseDates(params.configs);
  const initialByAssetHKD = { cash: 0, stock: 0, pe: 0, cbbc: 0 };
  const initialByCurrencyHKD: Record<string, number> = {};
  const mergedBaseFxRates = START_ASSETS.reduce((acc, asset) => ({
    ...acc,
    ...normalizeFxRates(params.configs[asset.id]?.baseFxRates),
  }), normalizeFxRates(params.fallbackFxRates || { HKD: 1 }));
  const fxRates: Record<string, number> = { HKD: 1, ...mergedBaseFxRates };
  const details: InitialPortfolioDetail[] = [];

  START_ASSETS.forEach((asset) => {
    const configFx = normalizeFxRates(params.configs[asset.id]?.baseFxRates || {});
    const rows = params.records[asset.id] || [];
    rows.forEach((record, index) => {
      const currency = normalizeCurrency(record.currency || record.market || 'HKD');
      const account = String(record.account || '未分类');
      const quantity = asset.id === 'cash' ? 1 : toNumber(record.quantity, 0);
      const price = asset.id === 'cash' ? toNumber(record.amount, 0) : toNumber(record.costPrice ?? record.price, 0);
      const amountLocal = asset.id === 'cash' ? toNumber(record.amount, 0) : quantity * price;
      const fxRate = toNumber(configFx[currency] ?? mergedBaseFxRates[currency] ?? fxRates[currency] ?? 1, 1);
      const amountHKD = amountLocal * fxRate;
      const label = String(record.code || record.fundCode || record.futuresCode || record.name || record.fundName || record.futuresName || asset.label);

      fxRates[currency] = fxRate;
      initialByAssetHKD[asset.id] += amountHKD;
      initialByCurrencyHKD[currency] = (initialByCurrencyHKD[currency] || 0) + amountHKD;
      details.push({
        assetId: asset.id,
        sourceCollection: asset.collection,
        id: String(record.id || `${asset.id}_${index}`),
        account,
        currency,
        label,
        quantity,
        price,
        amountLocal,
        fxRate,
        amountHKD,
      });
    });
  });

  return {
    inceptionDate,
    initialNav: params.initialNav || 1,
    initialCapitalHKD: Object.values(initialByAssetHKD).reduce((sum, value) => sum + value, 0),
    initialByAssetHKD,
    initialByCurrencyHKD,
    sourceBaseDates,
    fxRates,
    details,
    updatedAt: new Date().toISOString(),
  };
}

export function buildPortfolioSnapshot(params: {
  mktDataMap: Record<string, SummaryMatrixData>;
  plDataMap: Record<string, SummaryMatrixData>;
  fxRates: Record<string, number>;
  snapshotAt?: string;
  note?: string;
}): PortfolioSnapshot {
  const snapshotAt = params.snapshotAt || new Date().toISOString();
  const marketValueByAssetHKD: Record<string, number> = {};
  const pnlByAssetHKD: Record<string, number> = {};
  const marketValueByCurrencyHKD: Record<string, number> = {};
  const pnlByCurrencyHKD: Record<string, number> = {};
  const sourceUpdatedAt: Record<string, string> = {};

  SUMMARY_ASSET_IDS.forEach((assetId) => {
    const mkt = params.mktDataMap[assetId];
    const pl = params.plDataMap[assetId];
    const marketValue = sumMarketMatrixHKD(mkt, params.fxRates, marketValueByCurrencyHKD);
    const pnl = sumPnlMatrixHKD(pl, params.fxRates, pnlByCurrencyHKD);
    marketValueByAssetHKD[assetId] = marketValue;
    pnlByAssetHKD[assetId] = pnl;
    if (mkt?.updatedAt) sourceUpdatedAt[`${assetId}_mktvalue`] = mkt.updatedAt;
    if (pl?.updatedAt) sourceUpdatedAt[`${assetId}_pl`] = pl.updatedAt;
  });

  return {
    snapshotAt,
    snapshotDate: snapshotAt.slice(0, 10),
    totalMarketValueHKD: Object.values(marketValueByAssetHKD).reduce((sum, value) => sum + value, 0),
    totalPnlHKD: Object.values(pnlByAssetHKD).reduce((sum, value) => sum + value, 0),
    marketValueByAssetHKD,
    pnlByAssetHKD,
    marketValueByCurrencyHKD,
    pnlByCurrencyHKD,
    fxRates: { HKD: 1, ...params.fxRates },
    sourceUpdatedAt,
    note: params.note || '',
    createdAt: snapshotAt,
  };
}

export function calculateNavSeries(initialState: InitialPortfolioState | null, snapshots: PortfolioSnapshot[], flows: CapitalFlow[]): NavPoint[] {
  if (!initialState) return [];
  const sortedSnapshots = [...snapshots]
    .filter((snapshot) => snapshot.snapshotDate >= initialState.inceptionDate)
    .sort((a, b) => a.snapshotAt.localeCompare(b.snapshotAt));
  const sortedFlows = [...flows].sort((a, b) => a.flowDate.localeCompare(b.flowDate));
  const points: NavPoint[] = [];
  let previousAsset = initialState.initialCapitalHKD;
  let previousNav = initialState.initialNav || 1;
  let totalUnits = previousAsset / Math.max(previousNav, 0.000001);
  let previousDate = initialState.inceptionDate;
  let cumulativeProfitHKD = 0;

  points.push({
    date: initialState.inceptionDate,
    snapshotAt: `${initialState.inceptionDate}T00:00:00.000Z`,
    totalMarketValueHKD: initialState.initialCapitalHKD,
    totalPnlHKD: 0,
    periodNetFlowHKD: 0,
    periodProfitHKD: 0,
    periodReturn: 0,
    unitNav: previousNav,
    cumulativeReturn: previousNav / (initialState.initialNav || 1) - 1,
    cumulativeProfitHKD: 0,
  });

  sortedSnapshots.forEach((snapshot) => {
    const periodFlows = flowsBetween(sortedFlows, previousDate, snapshot.snapshotDate);
    const netFlow = periodFlows.reduce((sum, flow) => sum + signedFlowHKD(flow), 0);
    periodFlows.forEach((flow) => {
      totalUnits += signedFlowHKD(flow) / Math.max(previousNav, 0.000001);
    });
    const profit = snapshot.totalMarketValueHKD - previousAsset - netFlow;
    const nextNav = totalUnits > 0.000001 ? snapshot.totalMarketValueHKD / totalUnits : previousNav;
    const periodReturn = previousNav > 0.000001 ? nextNav / previousNav - 1 : 0;
    cumulativeProfitHKD += profit;
    points.push({
      date: snapshot.snapshotDate,
      snapshotAt: snapshot.snapshotAt,
      totalMarketValueHKD: snapshot.totalMarketValueHKD,
      totalPnlHKD: snapshot.totalPnlHKD,
      periodNetFlowHKD: netFlow,
      periodProfitHKD: profit,
      periodReturn,
      unitNav: nextNav,
      cumulativeReturn: nextNav / (initialState.initialNav || 1) - 1,
      cumulativeProfitHKD,
    });
    previousAsset = snapshot.totalMarketValueHKD;
    previousNav = nextNav;
    previousDate = snapshot.snapshotDate;
  });

  return points;
}

export function calculatePerformanceStats(points: NavPoint[]): PerformanceStats {
  if (points.length === 0) {
    return { latestNav: 1, cumulativeReturn: 0, cumulativeProfitHKD: 0, maxDrawdown: 0, annualizedReturn: 0 };
  }
  const first = points[0];
  const latest = points[points.length - 1];
  let peak = first.unitNav;
  let maxDrawdown = 0;
  points.forEach((point) => {
    peak = Math.max(peak, point.unitNav);
    if (peak > 0) maxDrawdown = Math.min(maxDrawdown, point.unitNav / peak - 1);
  });
  const days = Math.max(1, daysBetween(first.date, latest.date));
  const annualizedReturn = Math.pow(Math.max(latest.unitNav / Math.max(first.unitNav, 0.000001), 0.000001), 365 / days) - 1;
  return {
    latestNav: latest.unitNav,
    cumulativeReturn: latest.cumulativeReturn,
    cumulativeProfitHKD: latest.cumulativeProfitHKD,
    maxDrawdown,
    annualizedReturn,
  };
}

function sumMarketMatrixHKD(data: SummaryMatrixData | undefined, fxRates: Record<string, number>, byCurrency: Record<string, number>) {
  if (!data?.rawMatrix) return 0;
  let total = 0;
  Object.entries(data.rawMatrix).forEach(([currency, row]) => {
    const local = Object.values(row || {}).reduce((sum, value: any) => sum + toNumber(value, 0), 0);
    const hkd = local * toNumber(fxRates[normalizeCurrency(currency)] ?? 1, 1);
    byCurrency[normalizeCurrency(currency)] = (byCurrency[normalizeCurrency(currency)] || 0) + hkd;
    total += hkd;
  });
  return total;
}

function sumPnlMatrixHKD(data: SummaryMatrixData | undefined, fxRates: Record<string, number>, byCurrency: Record<string, number>) {
  if (!data?.rawMatrix) return 0;
  let total = 0;
  Object.entries(data.rawMatrix).forEach(([currency, row]: any) => {
    const local = toNumber(row?.total, 0);
    const hkd = local * toNumber(fxRates[normalizeCurrency(currency)] ?? 1, 1);
    byCurrency[normalizeCurrency(currency)] = (byCurrency[normalizeCurrency(currency)] || 0) + hkd;
    total += hkd;
  });
  return total;
}

function flowsBetween(flows: CapitalFlow[], fromDateExclusive: string, toDateInclusive: string) {
  return flows.filter((flow) => flow.flowDate > fromDateExclusive && flow.flowDate <= toDateInclusive);
}

function signedFlowHKD(flow: CapitalFlow) {
  const amount = Math.abs(toNumber(flow.amountHKD, 0));
  return flow.direction === 'OUT' ? -amount : amount;
}

function normalizeCurrency(value: any) {
  return String(value || 'HKD').trim().toUpperCase();
}

function normalizeFxRates(rates: Record<string, any> = {}) {
  const normalized: Record<string, number> = {};
  Object.entries(rates).forEach(([currency, rate]) => {
    const key = normalizeCurrency(currency);
    const value = toNumber(rate, NaN);
    if (Number.isFinite(value) && value > 0) normalized[key] = value;
  });
  normalized.HKD = normalized.HKD || 1;
  return normalized;
}

function toNumber(value: any, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function daysBetween(a: string, b: string) {
  const start = new Date(`${a}T00:00:00`).getTime();
  const end = new Date(`${b}T00:00:00`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 1;
  return Math.max(1, Math.round((end - start) / 86_400_000));
}
