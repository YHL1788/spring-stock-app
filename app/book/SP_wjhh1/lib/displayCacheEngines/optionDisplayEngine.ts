import { getAdminDb, getServerAppId } from '@/app/lib/firebaseAdmin';

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

type ProcessedOptionRow = {
  id: string;
  account: string;
  currency: string;
  ticker: string;
  name: string;
  notional: number;
  strike: number;
  spotPrice: number;
  realizedPremium: number;
  unrealizedPnl: number;
  totalPnl: number;
  fxRate: number;
  originalLifecycle: 'living' | 'died';
};

type RiskRow = {
  ticker: string;
  market: string;
  shares: number;
  cost: number;
};

export type OptionDisplayCacheResult = {
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
      missingDeliveryCandidates: number;
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
    fetchCollection(`sip_trade_option_input_${lifeCycle}`),
    fetchCollection(`sip_holding_option_output_${lifeCycle}`),
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

const buildFxRates = async (records: MergedRecord[], warnings: string[]) => {
  const currencies = new Set<string>(['HKD']);
  records.forEach((record) => {
    const currency = record.inputData?.basic?.currency;
    if (currency) currencies.add(String(currency).toUpperCase());
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

const hasExistingDelivery = async (tradeId: string) => {
  const snapshot = await dataCollection('sip_holding_option_output_get-stock')
    .where('tradeId', '==', tradeId)
    .limit(1)
    .get();
  return !snapshot.empty;
};

const evaluateRecord = async (
  record: MergedRecord,
  fxRates: Record<string, number>,
  quoteCache: Map<string, number>,
  requestedSymbols: Set<string>,
  missingQuoteCodes: Set<string>,
  warnings: string[],
) => {
  const basic = record.inputData?.basic || {};
  const underlying = record.inputData?.underlying || {};
  const dates = record.inputData?.dates || {};
  const currency = String(basic.currency || record.outputData?.currency || 'HKD').toUpperCase();
  const ticker = String(underlying.ticker || record.outputData?.ticker || '').trim();
  const expiryDate = dates.expiryDate || dates.expiry || '';
  if (!ticker) throw new Error('Missing option ticker');

  const isExpired = Date.now() >= inferExpirationTimeMs(expiryDate, currency);
  let spot = toNumber(underlying.spotPrice ?? underlying.spot_price ?? record.outputData?.spotPrice);
  requestedSymbols.add(ticker);

  if (isExpired) {
    const start = new Date(`${expiryDate}T00:00:00Z`);
    start.setUTCDate(start.getUTCDate() - 7);
    const history = await fetchHistory(ticker, start.toISOString().slice(0, 10), expiryDate);
    const valid = history.filter((item) => item.date <= expiryDate).sort((a, b) => a.date.localeCompare(b.date));
    if (valid.length > 0) {
      spot = valid[valid.length - 1].close;
    } else {
      missingQuoteCodes.add(ticker);
      warnings.push(`${record.tradeId}: expiry quote unavailable for ${ticker}; stored spot fallback used.`);
    }
  } else if (quoteCache.has(ticker)) {
    spot = quoteCache.get(ticker) || spot;
  } else {
    const quote = await fetchQuote(ticker);
    if (quote) {
      quoteCache.set(ticker, quote);
      spot = quote;
    } else {
      missingQuoteCodes.add(ticker);
      warnings.push(`${record.tradeId}: quote unavailable for ${ticker}; stored spot fallback used.`);
    }
  }

  const qty = toNumber(basic.qty);
  const strike = toNumber(underlying.strike ?? record.outputData?.strike);
  const premium = toNumber(basic.premium);
  const fee = toNumber(basic.fee);
  const isCall = String(basic.optionType || record.outputData?.type || 'Call') === 'Call';
  const notional = isCall ? qty * strike : -qty * strike;
  const realizedPremium = -(qty * premium) - fee;
  const intrinsicValue = isCall
    ? qty * Math.max(spot - strike, 0)
    : qty * Math.max(strike - spot, 0);
  const unrealizedPnl = isExpired ? 0 : intrinsicValue;
  const totalPnl = realizedPremium + intrinsicValue;
  const isITM = isCall ? spot > strike : spot < strike;
  const fxRate = fxRates[currency] || toNumber(basic.fxRate, 1) || 1;

  let missingDelivery = false;
  if (record.originalLifecycle === 'died' && isExpired && isITM) {
    missingDelivery = !(await hasExistingDelivery(record.tradeId));
  }

  return {
    record,
    row: {
      id: record.tradeId,
      account: basic.account || record.outputData?.account || 'N/A',
      currency,
      ticker,
      name: record.outputData?.name || `${underlying.name || ticker} ${basic.direction || ''} ${strike} ${basic.optionType || ''}`.trim(),
      notional,
      strike,
      spotPrice: spot,
      realizedPremium,
      unrealizedPnl,
      totalPnl,
      fxRate,
      originalLifecycle: record.originalLifecycle,
    } satisfies ProcessedOptionRow,
    risk: buildRiskRow(record, ticker, currency, qty, strike, spot, isCall),
    isExpired,
    missingDelivery,
  };
};

const buildRiskRow = (
  record: MergedRecord,
  ticker: string,
  currency: string,
  qty: number,
  strike: number,
  spot: number,
  isCall: boolean,
): RiskRow | null => {
  const isITM = isCall ? spot > strike : spot < strike;
  if (!isITM) return null;
  let exposureShares = isCall ? qty : -qty;
  const direction = String(record.inputData?.basic?.direction || '').toUpperCase();
  if (direction === 'SELL') exposureShares = -exposureShares;
  return {
    ticker,
    market: currency,
    shares: exposureShares,
    cost: exposureShares * strike,
  };
};

const buildTwoDimensionalStats = (rows: ProcessedOptionRow[], valueKey: 'unrealizedPnl') => {
  const accounts = Array.from(new Set(rows.map((row) => row.account).filter(Boolean))).sort();
  const markets = Array.from(new Set(rows.map((row) => row.currency).filter(Boolean))).sort();
  const rawMatrix: Record<string, Record<string, number>> = {};
  markets.forEach((market) => {
    rawMatrix[market] = {};
    accounts.forEach((account) => {
      rawMatrix[market][account] = 0;
    });
  });
  rows.forEach((row) => {
    rawMatrix[row.currency][row.account] += row[valueKey] || 0;
  });
  return { accounts, markets, rawMatrix };
};

const buildPlStats = (livingRows: ProcessedOptionRow[], diedRows: ProcessedOptionRow[]) => {
  const markets = Array.from(new Set([...livingRows, ...diedRows].map((row) => row.currency).filter(Boolean))).sort();
  const rawMatrix: Record<string, { realized: number; unrealized: number; total: number }> = {};
  markets.forEach((market) => {
    rawMatrix[market] = { realized: 0, unrealized: 0, total: 0 };
  });
  livingRows.forEach((row) => {
    rawMatrix[row.currency].realized += row.realizedPremium || 0;
    rawMatrix[row.currency].unrealized += row.unrealizedPnl || 0;
  });
  diedRows.forEach((row) => {
    rawMatrix[row.currency].realized += row.realizedPremium || 0;
  });
  markets.forEach((market) => {
    rawMatrix[market].total = rawMatrix[market].realized + rawMatrix[market].unrealized;
  });
  return { markets, rawMatrix };
};

const buildCashStats = (rows: ProcessedOptionRow[]) => {
  const accounts = Array.from(new Set(rows.map((row) => row.account).filter(Boolean))).sort();
  const markets = Array.from(new Set(rows.map((row) => row.currency).filter(Boolean))).sort();
  const rawMatrix: Record<string, Record<string, number>> = {};
  markets.forEach((market) => {
    rawMatrix[market] = {};
    accounts.forEach((account) => {
      rawMatrix[market][account] = 0;
    });
  });
  rows.forEach((row) => {
    rawMatrix[row.currency][row.account] += -(row.realizedPremium || 0);
  });
  return { accounts, markets, rawMatrix };
};

const buildRiskSummary = (rows: RiskRow[]) => {
  const summary: Record<string, RiskRow> = {};
  rows.forEach((row) => {
    if (row.shares === 0) return;
    if (!summary[row.ticker]) {
      summary[row.ticker] = { ticker: row.ticker, market: row.market, shares: 0, cost: 0 };
    }
    summary[row.ticker].shares += row.shares;
    summary[row.ticker].cost += row.cost;
  });
  return Object.values(summary).map((row) => ({
    ...row,
    costPrice: Math.abs(row.shares) > 0.0001 ? row.cost / row.shares : 0,
  }));
};

export const calculateOptionDisplayCache = async (): Promise<OptionDisplayCacheResult> => {
  const warnings: string[] = [];
  const errors: string[] = [];
  const quoteCache = new Map<string, number>();
  const requestedSymbols = new Set<string>();
  const missingQuoteCodes = new Set<string>();

  const [livingRecords, diedRecords] = await Promise.all([
    fetchMergedRecords('living'),
    fetchMergedRecords('died'),
  ]);
  const allRecords = [...livingRecords, ...diedRecords];
  const fxRates = await buildFxRates(allRecords, warnings);

  const evaluatedLiving: Awaited<ReturnType<typeof evaluateRecord>>[] = [];
  const evaluatedDied: Awaited<ReturnType<typeof evaluateRecord>>[] = [];
  let failedEvaluations = 0;
  let softLifecycleMoves = 0;
  let missingDeliveryCandidates = 0;

  for (const record of livingRecords) {
    try {
      const evaluated = await evaluateRecord(record, fxRates, quoteCache, requestedSymbols, missingQuoteCodes, warnings);
      if (evaluated.isExpired) {
        softLifecycleMoves += 1;
        warnings.push(`${record.tradeId}: option appears expired; cache kept read-only and did not migrate living/died.`);
      }
      evaluatedLiving.push(evaluated);
    } catch (error) {
      failedEvaluations += 1;
      warnings.push(`${record.tradeId}: Option evaluation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  for (const record of diedRecords) {
    try {
      const evaluated = await evaluateRecord(record, fxRates, quoteCache, requestedSymbols, missingQuoteCodes, warnings);
      if (!evaluated.isExpired) {
        softLifecycleMoves += 1;
        warnings.push(`${record.tradeId}: option appears unexpired; cache kept read-only and did not move it back to living.`);
      }
      if (evaluated.missingDelivery) missingDeliveryCandidates += 1;
      evaluatedDied.push(evaluated);
    } catch (error) {
      failedEvaluations += 1;
      warnings.push(`${record.tradeId}: Option historical evaluation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const livingRows = evaluatedLiving.map((item) => item.row);
  const diedRows = evaluatedDied.map((item) => item.row);
  const riskRows = evaluatedLiving.map((item) => item.risk).filter(Boolean) as RiskRow[];

  return {
    status: warnings.length > 0 || failedEvaluations > 0 ? 'partial_success' : 'success',
    data: {
      currentMktStats: buildTwoDimensionalStats(livingRows, 'unrealizedPnl'),
      currentPlStats: buildPlStats(livingRows, diedRows),
      cashStats: buildCashStats([...livingRows, ...diedRows]),
      riskExposureSummary: buildRiskSummary(riskRows),
      rawCounts: {
        inputLiving: livingRecords.length,
        inputDied: diedRecords.length,
        evaluatedLiving: evaluatedLiving.length,
        evaluatedDied: evaluatedDied.length,
        failedEvaluations,
        softLifecycleMoves,
        missingDeliveryCandidates,
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
