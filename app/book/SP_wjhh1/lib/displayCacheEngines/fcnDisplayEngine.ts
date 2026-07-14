import { getAdminDb, getServerAppId } from '@/app/lib/firebaseAdmin';
import { FCNPricer, type FCNParams, type FCNResult } from '@/app/lib/fcnPricer';
import {
  getFCNNoteCurrency,
  normalizeFCNUnderlyingTerms,
} from '@/app/book/SP_wjhh1/lib/fcnSettlementEngine';
import {
  applyCorporateActionsToFCNParams,
  CORPORATE_ACTION_COLLECTION,
  type CorporateActionRecord,
} from '@/app/book/SP_wjhh1/lib/corporateActionEngine';

type MergedRecord = {
  tradeId: string;
  inputId: string;
  outputId: string;
  inputData: any;
  outputData: any;
  updatedAt: any;
  createdAt: any;
  originalLifecycle: 'living' | 'died';
};

type ProcessedFCNRow = {
  id: string;
  account: string;
  market: string;
  notional: number;
  mktVal: number;
  realized: number;
  unrealized: number;
  unrealizedCoupon: number;
  impliedLoss: number;
  totalPnl: number;
  fx_rate: number;
  resultStatus: FCNResult['status'];
  originalLifecycle: 'living' | 'died';
};

type RiskRow = {
  ticker: string;
  market: string;
  shares: number;
  cost: number;
  mktVal: number;
  fx_rate: number;
};

export type FCNDisplayCacheResult = {
  status: 'success' | 'partial_success';
  data: {
    currentMktStats: {
      accounts: string[];
      markets: string[];
      rawMatrix: Record<string, Record<string, number>>;
    };
    currentPlStats: {
      markets: string[];
      rawMatrix: Record<string, { realized: number; unrealized: number; total: number }>;
    };
    cashStats: {
      accounts: string[];
      markets: string[];
      rawMatrix: Record<string, Record<string, number>>;
    };
    riskExposureSummary: Array<{
      ticker: string;
      market: string;
      shares: number;
      cost: number;
      costPrice: number;
    }>;
    rawCounts: {
      inputLiving: number;
      inputDied: number;
      evaluatedLiving: number;
      evaluatedDied: number;
      failedEvaluations: number;
      softLifecycleMoves: number;
    };
    fxRates: Record<string, number>;
    quoteStatus: {
      requestedSymbols: string[];
      missingQuoteCodes: string[];
    };
  };
  warnings: string[];
  errors: string[];
};

const BASE_URL_YAHOO_CHART = 'https://query1.finance.yahoo.com/v8/finance/chart';
const YAHOO_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
};

const FALLBACK_FX_RATES: Record<string, number> = {
  HKD: 1,
  USD: 7.78,
  JPY: 0.052,
  CNY: 1.08,
};

const toNumber = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const getTime = (value: any) => {
  if (!value) return 0;
  if (value.toMillis && typeof value.toMillis === 'function') return value.toMillis();
  if (value.toDate && typeof value.toDate === 'function') return value.toDate().getTime();
  if (value.seconds) return value.seconds * 1000;
  return new Date(value).getTime() || 0;
};

const dateOnly = (date = new Date()) => date.toISOString().slice(0, 10);

const replaceNullWithUndefined = (obj: any): any => {
  if (obj === null) return undefined;
  if (typeof obj !== 'object') return obj;
  if (obj instanceof Date) return obj;
  if (obj?.toDate && typeof obj.toDate === 'function') return obj;
  if (Array.isArray(obj)) return obj.map(replaceNullWithUndefined);
  const next: any = {};
  Object.keys(obj).forEach((key) => {
    next[key] = replaceNullWithUndefined(obj[key]);
  });
  return next;
};

const inferExpirationTimeMs = (expDateStr: string, currency: string): number => {
  if (!expDateStr) return Infinity;
  try {
    if (currency === 'USD') {
      const [year, month, day] = expDateStr.split('-').map(Number);
      const nextDay = new Date(year, month - 1, day + 1);
      return new Date(
        `${nextDay.getFullYear()}-${String(nextDay.getMonth() + 1).padStart(2, '0')}-${String(nextDay.getDate()).padStart(2, '0')}T04:00:00+08:00`,
      ).getTime();
    }
    if (currency === 'JPY') return new Date(`${expDateStr}T14:00:00+08:00`).getTime();
    if (currency === 'CNY') return new Date(`${expDateStr}T15:00:00+08:00`).getTime();
    return new Date(`${expDateStr}T16:00:00+08:00`).getTime();
  } catch {
    return dateOnly() >= expDateStr ? 0 : Infinity;
  }
};

const dataCollection = (collectionName: string) => {
  const appId = getServerAppId();
  return getAdminDb()
    .collection('artifacts')
    .doc(appId)
    .collection('public')
    .doc('data')
    .collection(collectionName);
};

const fetchCollection = async (collectionName: string) => {
  const snapshot = await dataCollection(collectionName).get();
  return snapshot.docs.map((doc) => {
    const data = doc.data();
    delete data.id;
    return { id: doc.id, data };
  });
};

const fetchMergedRecords = async (lifeCycle: 'living' | 'died'): Promise<MergedRecord[]> => {
  const [inputDocs, outputDocs] = await Promise.all([
    fetchCollection(`sip_trade_fcn_input_${lifeCycle}`),
    fetchCollection(`sip_holding_fcn_output_${lifeCycle}`),
  ]);

  const outputs: any[] = outputDocs.map(({ id, data }) => ({ ...data, id }));
  const merged = inputDocs
    .map(({ id, data }) => {
      const output = outputs.find((item) => item.tradeId && item.tradeId === data.tradeId);
      if (!output) return null;
      return {
        tradeId: data.tradeId,
        inputId: id,
        outputId: output.id,
        inputData: data,
        outputData: output,
        updatedAt: data.updatedAt || output.updatedAt,
        createdAt: data.createdAt,
        originalLifecycle: lifeCycle,
      } satisfies MergedRecord;
    })
    .filter(Boolean) as MergedRecord[];

  merged.sort((left, right) => {
    const leftTime = getTime(left.updatedAt) || getTime(left.createdAt);
    const rightTime = getTime(right.updatedAt) || getTime(right.createdAt);
    return rightTime - leftTime;
  });
  return merged;
};

const fetchQuote = async (symbol: string): Promise<number | null> => {
  try {
    const response = await fetch(`${BASE_URL_YAHOO_CHART}/${encodeURIComponent(symbol)}?interval=1d&range=5d`, {
      headers: YAHOO_HEADERS,
      cache: 'no-store',
    });
    if (!response.ok) return null;
    const json = await response.json();
    const price = toNumber(json?.chart?.result?.[0]?.meta?.regularMarketPrice);
    return price > 0 ? price : null;
  } catch {
    return null;
  }
};

const fetchHistory = async (symbol: string, from: string, to?: string) => {
  try {
    const fromSeconds = Math.floor(new Date(`${from}T00:00:00Z`).getTime() / 1000);
    const toSeconds = Math.floor(new Date(`${to || dateOnly()}T23:59:59Z`).getTime() / 1000);
    const response = await fetch(
      `${BASE_URL_YAHOO_CHART}/${encodeURIComponent(symbol)}?interval=1d&period1=${fromSeconds}&period2=${toSeconds}`,
      { headers: YAHOO_HEADERS, cache: 'no-store' },
    );
    if (!response.ok) return [];
    const json = await response.json();
    const result = json?.chart?.result?.[0];
    const timestamps: number[] = result?.timestamp || [];
    const closes: number[] = result?.indicators?.quote?.[0]?.close || [];
    return timestamps
      .map((timestamp, index) => ({
        date: new Date(timestamp * 1000).toISOString().slice(0, 10),
        close: toNumber(closes[index]),
      }))
      .filter((item) => item.close > 0);
  } catch {
    return [];
  }
};

const fetchFxRate = async (currency: string): Promise<number | null> => {
  if (currency === 'HKD') return 1;
  try {
    const response = await fetch(`${BASE_URL_YAHOO_CHART}/${currency}HKD=X?interval=1d&range=5d`, {
      headers: YAHOO_HEADERS,
      cache: 'no-store',
    });
    if (!response.ok) return null;
    const json = await response.json();
    const price = toNumber(json?.chart?.result?.[0]?.meta?.regularMarketPrice);
    return price > 0 ? price : null;
  } catch {
    return null;
  }
};

const loadCorporateActions = async () => {
  const docs = await fetchCollection(CORPORATE_ACTION_COLLECTION);
  return docs.map(({ id, data }) => ({ id, ...data } as CorporateActionRecord));
};

const buildFxRates = async (records: MergedRecord[], warnings: string[]) => {
  const currencies = new Set<string>(['HKD']);
  records.forEach((record) => {
    const params = record.inputData?.pricerParams as FCNParams | undefined;
    if (!params) return;
    const noteCurrency = getFCNNoteCurrency(params);
    currencies.add(noteCurrency);
    normalizeFCNUnderlyingTerms(params).forEach((term) => currencies.add(term.currency));
  });

  const fxRates: Record<string, number> = { HKD: 1 };
  await Promise.all(Array.from(currencies).map(async (currency) => {
    const rate = await fetchFxRate(currency);
    if (rate) {
      fxRates[currency] = rate;
    } else {
      fxRates[currency] = FALLBACK_FX_RATES[currency] || 1;
      if (currency !== 'HKD') warnings.push(`FX ${currency}/HKD unavailable; fallback ${fxRates[currency]} used.`);
    }
  }));
  return fxRates;
};

const evaluateRecord = async (
  record: MergedRecord,
  corporateActions: CorporateActionRecord[],
  fxRates: Record<string, number>,
  quoteCache: Map<string, number>,
  requestedSymbols: Set<string>,
  missingQuoteCodes: Set<string>,
  warnings: string[],
) => {
  const inputData = replaceNullWithUndefined(record.inputData);
  const outputData = replaceNullWithUndefined(record.outputData);
  const sourceParams = inputData.pricerParams as FCNParams | undefined;
  if (!sourceParams) throw new Error('Missing pricerParams');
  const params = JSON.parse(JSON.stringify(sourceParams)) as FCNParams;
  const lastObsDate = params.obs_dates?.[params.obs_dates.length - 1];
  const normalizedTerms = normalizeFCNUnderlyingTerms(params);
  const expiryCurrency = normalizedTerms.some((term) => term.currency === 'USD') ? 'USD'
    : normalizedTerms.some((term) => term.currency === 'HKD') ? 'HKD'
      : normalizedTerms.some((term) => term.currency === 'CNY') ? 'CNY'
        : normalizedTerms.some((term) => term.currency === 'JPY') ? 'JPY'
          : getFCNNoteCurrency(params);
  const isExpired = Date.now() >= inferExpirationTimeMs(lastObsDate, expiryCurrency);

  const fetchedSpots = await Promise.all((params.tickers || []).map(async (ticker, index) => {
    requestedSymbols.add(ticker);
    if (isExpired && lastObsDate) {
      const start = new Date(`${lastObsDate}T00:00:00Z`);
      start.setUTCDate(start.getUTCDate() - 7);
      const history = await fetchHistory(ticker, start.toISOString().slice(0, 10), lastObsDate);
      const valid = history.filter((item) => item.date <= lastObsDate).sort((a, b) => a.date.localeCompare(b.date));
      if (valid.length > 0) return valid[valid.length - 1].close;
    } else if (quoteCache.has(ticker)) {
      return quoteCache.get(ticker) || params.initial_spots[index];
    } else {
      const quote = await fetchQuote(ticker);
      if (quote) {
        quoteCache.set(ticker, quote);
        return quote;
      }
    }

    missingQuoteCodes.add(ticker);
    warnings.push(`${record.tradeId}: quote unavailable for ${ticker}; initial spot fallback used.`);
    return params.current_spots?.[index] || params.initial_spots[index];
  }));

  params.current_spots = fetchedSpots;
  if (Array.isArray(params.underlyingTerms)) {
    params.underlyingTerms = params.underlyingTerms.map((term, index) => ({
      ...term,
      currentPrice: fetchedSpots[index],
    }));
  }

  const today = dateOnly();
  const hasPastObservation = (params.obs_dates || []).some((obsDate) => obsDate <= today);
  const cutoffDate = isExpired && lastObsDate ? lastObsDate : today;
  if (hasPastObservation && params.history_start_date) {
    const histMap: Record<string, { date: string; close: number }[]> = {};
    await Promise.all((params.tickers || []).map(async (ticker) => {
      histMap[ticker] = await fetchHistory(ticker, params.history_start_date!, cutoffDate);
    }));
    params.hist_prices = histMap;
  }

  const noteCurrency = getFCNNoteCurrency(params);
  params.fx_rate = fxRates[noteCurrency] || params.fx_rate || 1;
  if (Array.isArray(params.underlyingTerms)) {
    const noteToHKD = params.fx_rate || 1;
    params.underlyingTerms = params.underlyingTerms.map((term) => {
      const currency = term.currency || noteCurrency;
      if (currency === noteCurrency) return { ...term, settlementFxType: 'SAME_CURRENCY', settlementFxRate: 1 };
      if (term.settlementFxType === 'FIXED' && term.settlementFxRate) return term;
      return {
        ...term,
        settlementFxType: 'FLOATING',
        settlementFxRate: noteToHKD / (fxRates[currency] || 1),
        settlementFxPair: `${currency}/${noteCurrency}`,
      };
    });
  }

  const valuationDate = isExpired && lastObsDate ? lastObsDate : today;
  const { adjusted } = applyCorporateActionsToFCNParams(params, corporateActions, valuationDate);
  const result = new FCNPricer(adjusted).simulate_price();
  return {
    inputData,
    outputData,
    params: adjusted,
    result,
    originalLifecycle: record.originalLifecycle,
    tradeId: record.tradeId,
  };
};

const getAccount = (params: FCNParams, inputData: any) =>
  params.account_name || inputData.inputParams?.account_name || 'N/A';

const processLivingRow = (item: Awaited<ReturnType<typeof evaluateRecord>>): ProcessedFCNRow => {
  const params = item.params;
  const result = item.result;
  const factor = toNumber(params.total_notional) / Math.max(toNumber(params.denomination), 1);
  const mktVal = result.dirty_price * factor;
  const realized = result.hist_coupons_paid * factor;
  const unrealizedCoupon = (result.pending_coupons_pv + result.future_coupons_pv) * factor;
  const impliedLoss = result.implied_loss_pv * factor;
  const unrealized = unrealizedCoupon - impliedLoss;
  const totalPnl = (result.dirty_price + result.hist_coupons_paid - toNumber(params.denomination)) * factor;
  return {
    id: item.tradeId,
    account: getAccount(params, item.inputData),
    market: params.market || getFCNNoteCurrency(params) || 'HKD',
    notional: toNumber(params.total_notional),
    mktVal,
    realized,
    unrealized,
    unrealizedCoupon,
    impliedLoss,
    totalPnl,
    fx_rate: params.fx_rate || 1,
    resultStatus: result.status,
    originalLifecycle: item.originalLifecycle,
  };
};

const processDiedRow = (item: Awaited<ReturnType<typeof evaluateRecord>>): ProcessedFCNRow => {
  const params = item.params;
  const result = item.result;
  const factor = toNumber(params.total_notional) / Math.max(toNumber(params.denomination), 1);
  return {
    id: item.tradeId,
    account: getAccount(params, item.inputData),
    market: params.market || getFCNNoteCurrency(params) || 'HKD',
    notional: toNumber(params.total_notional),
    mktVal: 0,
    realized: result.hist_coupons_paid * factor,
    unrealized: 0,
    unrealizedCoupon: 0,
    impliedLoss: 0,
    totalPnl: result.hist_coupons_paid * factor,
    fx_rate: params.fx_rate || 1,
    resultStatus: result.status,
    originalLifecycle: item.originalLifecycle,
  };
};

const buildRiskRows = (items: Awaited<ReturnType<typeof evaluateRecord>>[], fxRates: Record<string, number>) => {
  const rows: RiskRow[] = [];
  items.forEach((item) => {
    const { result, params } = item;
    if (!(result.status === 'Settling_Delivery' || (result.status === 'Active' && result.loss_prob > 0))) return;
    const factor = toNumber(params.total_notional) / Math.max(toNumber(params.denomination), 1);
    const terms = normalizeFCNUnderlyingTerms(params);
    (params.tickers || []).forEach((ticker, index) => {
      const term = terms[index];
      const initialPrice = term?.initialPrice || params.initial_spots[index] || 0;
      const currentPrice = term?.currentPrice || params.current_spots?.[index] || initialPrice;
      const strikePrice = initialPrice * toNumber(params.strike_pct);
      const shares = toNumber(result.exposure_shares_avg[index]) * factor;
      const cost = strikePrice * shares;
      const mktVal = currentPrice * shares;
      if (Math.abs(mktVal) < 0.000001) return;
      const market = term?.currency || getFCNNoteCurrency(params);
      rows.push({
        ticker,
        market,
        shares,
        cost,
        mktVal,
        fx_rate: fxRates[market] || params.fx_rate || 1,
      });
    });
  });
  return rows;
};

const buildTwoDimensionalStats = (rows: ProcessedFCNRow[], valueKey: 'mktVal' | 'cash') => {
  const accounts = Array.from(new Set(rows.map((row) => row.account).filter(Boolean))).sort();
  const markets = Array.from(new Set(rows.map((row) => row.market).filter(Boolean))).sort();
  const rawMatrix: Record<string, Record<string, number>> = {};
  markets.forEach((market) => {
    rawMatrix[market] = {};
    accounts.forEach((account) => {
      rawMatrix[market][account] = 0;
    });
  });

  rows.forEach((row) => {
    if (!rawMatrix[row.market]) return;
    const value = valueKey === 'mktVal' ? row.mktVal : row.notional - row.realized;
    rawMatrix[row.market][row.account] += value;
  });
  return { accounts, markets, rawMatrix };
};

const buildCashStats = (livingRows: ProcessedFCNRow[], diedRows: ProcessedFCNRow[]) => {
  const rows = [...livingRows, ...diedRows];
  const accounts = Array.from(new Set(rows.map((row) => row.account).filter(Boolean))).sort();
  const markets = Array.from(new Set(rows.map((row) => row.market).filter(Boolean))).sort();
  const rawMatrix: Record<string, Record<string, number>> = {};
  markets.forEach((market) => {
    rawMatrix[market] = {};
    accounts.forEach((account) => {
      rawMatrix[market][account] = 0;
    });
  });

  livingRows.forEach((row) => {
    rawMatrix[row.market][row.account] += row.notional;
  });
  rows.forEach((row) => {
    rawMatrix[row.market][row.account] -= row.realized;
  });
  return { accounts, markets, rawMatrix };
};

const buildPlStats = (livingRows: ProcessedFCNRow[], diedRows: ProcessedFCNRow[]) => {
  const markets = Array.from(new Set([...livingRows, ...diedRows].map((row) => row.market).filter(Boolean))).sort();
  const rawMatrix: Record<string, { realized: number; unrealized: number; total: number }> = {};
  markets.forEach((market) => {
    rawMatrix[market] = { realized: 0, unrealized: 0, total: 0 };
  });
  livingRows.forEach((row) => {
    rawMatrix[row.market].realized += row.realized;
    rawMatrix[row.market].unrealized += row.unrealized;
    rawMatrix[row.market].total += row.realized + row.unrealized;
  });
  diedRows.forEach((row) => {
    rawMatrix[row.market].realized += row.realized;
    rawMatrix[row.market].total += row.realized;
  });
  return { markets, rawMatrix };
};

export const calculateFCNDisplayCache = async (): Promise<FCNDisplayCacheResult> => {
  const warnings: string[] = [];
  const errors: string[] = [];
  const quoteCache = new Map<string, number>();
  const requestedSymbols = new Set<string>();
  const missingQuoteCodes = new Set<string>();

  const [livingRecords, diedRecords, corporateActions] = await Promise.all([
    fetchMergedRecords('living'),
    fetchMergedRecords('died'),
    loadCorporateActions(),
  ]);
  const allRecords = [...livingRecords, ...diedRecords];
  const fxRates = await buildFxRates(allRecords, warnings);

  const evaluated: Awaited<ReturnType<typeof evaluateRecord>>[] = [];
  let failedEvaluations = 0;
  for (const record of allRecords) {
    try {
      evaluated.push(await evaluateRecord(
        record,
        corporateActions,
        fxRates,
        quoteCache,
        requestedSymbols,
        missingQuoteCodes,
        warnings,
      ));
    } catch (error) {
      failedEvaluations += 1;
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`${record.tradeId}: FCN evaluation failed: ${message}`);
    }
  }

  const livingStatuses = new Set<FCNResult['status']>(['Active', 'Settling_NoDelivery', 'Settling_Delivery']);
  const evaluatedLivingItems = evaluated.filter((item) => livingStatuses.has(item.result.status));
  const evaluatedDiedItems = evaluated.filter((item) => !livingStatuses.has(item.result.status));
  const softLifecycleMoves = evaluated.filter((item) => {
    const expected = livingStatuses.has(item.result.status) ? 'living' : 'died';
    return expected !== item.originalLifecycle;
  }).length;
  if (softLifecycleMoves > 0) {
    warnings.push(`${softLifecycleMoves} FCN records have display lifecycle different from stored lifecycle; formal DB not changed.`);
  }

  const livingRows = evaluatedLivingItems.map(processLivingRow);
  const diedRows = evaluatedDiedItems.map(processDiedRow);
  const riskRows = buildRiskRows(evaluatedLivingItems, fxRates);
  const riskSummaryMap: Record<string, { ticker: string; market: string; shares: number; cost: number }> = {};
  riskRows.forEach((row) => {
    if (!riskSummaryMap[row.ticker]) {
      riskSummaryMap[row.ticker] = { ticker: row.ticker, market: row.market, shares: 0, cost: 0 };
    }
    riskSummaryMap[row.ticker].shares += row.shares;
    riskSummaryMap[row.ticker].cost += row.cost;
  });

  return {
    status: warnings.length > 0 || failedEvaluations > 0 ? 'partial_success' : 'success',
    data: {
      currentMktStats: buildTwoDimensionalStats(livingRows, 'mktVal'),
      currentPlStats: buildPlStats(livingRows, diedRows),
      cashStats: buildCashStats(livingRows, diedRows),
      riskExposureSummary: Object.values(riskSummaryMap).map((item) => ({
        ...item,
        costPrice: item.shares > 0 ? item.cost / item.shares : 0,
      })),
      rawCounts: {
        inputLiving: livingRecords.length,
        inputDied: diedRecords.length,
        evaluatedLiving: livingRows.length,
        evaluatedDied: diedRows.length,
        failedEvaluations,
        softLifecycleMoves,
      },
      fxRates,
      quoteStatus: {
        requestedSymbols: Array.from(requestedSymbols).sort(),
        missingQuoteCodes: Array.from(missingQuoteCodes).sort(),
      },
    },
    warnings,
    errors,
  };
};
