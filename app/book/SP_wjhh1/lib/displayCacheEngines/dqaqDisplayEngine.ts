import { getAdminDb, getServerAppId } from '@/app/lib/firebaseAdmin';
import {
  DQAQValuator,
  type BasicInfo,
  type Period,
  type SimulationParams,
  type UnderlyingInfo,
  type ValuationResult,
} from '@/app/lib/DQ-AQPricer';

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

type ProcessedDQAQRow = {
  id: string;
  account: string;
  currency: string;
  mktVal: number;
  fullPrice: number;
  fxRate: number;
};

type RiskRow = {
  ticker: string;
  market: string;
  shares: number;
  cost: number;
  mktVal: number;
};

export type DQAQDisplayCacheResult = {
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
    fetchCollection(`sip_trade_dqaq_input_${lifeCycle}`),
    fetchCollection(`sip_holding_dqaq_output_${lifeCycle}`),
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

const evaluateRecord = async (
  record: MergedRecord,
  fxRates: Record<string, number>,
  quoteCache: Map<string, number>,
  requestedSymbols: Set<string>,
  missingQuoteCodes: Set<string>,
  warnings: string[],
) => {
  const inputData = record.inputData;
  const basic = inputData.basic as BasicInfo;
  const underlying = inputData.underlying as UnderlyingInfo & { current_price?: number };
  const sim = inputData.sim as SimulationParams;
  const periods = inputData.periods as Period[];
  const sigma = toNumber(inputData.sigma, 0.2);
  if (!basic || !underlying || !sim || !Array.isArray(periods) || periods.length === 0) {
    throw new Error('Missing DQ-AQ input fields');
  }

  const contractEnd = periods[periods.length - 1].obs_end;
  const isExpired = Date.now() >= inferExpirationTimeMs(contractEnd, basic.currency);
  let currentPrice = toNumber(underlying.spot_price);
  requestedSymbols.add(underlying.ticker);

  if (isExpired) {
    const start = new Date(`${contractEnd}T00:00:00Z`);
    start.setUTCDate(start.getUTCDate() - 7);
    const history = await fetchHistory(underlying.ticker, start.toISOString().slice(0, 10), contractEnd);
    const valid = history.filter((item) => item.date <= contractEnd).sort((a, b) => a.date.localeCompare(b.date));
    if (valid.length > 0) {
      currentPrice = valid[valid.length - 1].close;
    } else {
      missingQuoteCodes.add(underlying.ticker);
      warnings.push(`${record.tradeId}: expiry quote unavailable for ${underlying.ticker}; spot fallback used.`);
    }
  } else if (quoteCache.has(underlying.ticker)) {
    currentPrice = quoteCache.get(underlying.ticker) || currentPrice;
  } else {
    const quote = await fetchQuote(underlying.ticker);
    if (quote) {
      quoteCache.set(underlying.ticker, quote);
      currentPrice = quote;
    } else {
      missingQuoteCodes.add(underlying.ticker);
      warnings.push(`${record.tradeId}: quote unavailable for ${underlying.ticker}; spot fallback used.`);
    }
  }

  const cutoffDate = isExpired ? contractEnd : dateOnly();
  const history = await fetchHistory(underlying.ticker, sim.history_start_date || basic.trade_date, cutoffDate);
  const historyPrices = history.map((item) => item.close);
  const historyDates = history.map((item) => item.date);
  const fx = fxRates[basic.currency] || sim.sim_fx_rate || 1;

  let valuationDate = dateOnly();
  if (isExpired && valuationDate < contractEnd) valuationDate = contractEnd;
  if (!isExpired && valuationDate >= contractEnd) {
    const previous = new Date(`${contractEnd}T00:00:00Z`);
    previous.setUTCDate(previous.getUTCDate() - 1);
    valuationDate = previous.toISOString().slice(0, 10);
  }

  const valuator = new DQAQValuator(basic, underlying, sim, periods, sigma);
  const result = valuator.generate_report(currentPrice, historyPrices, historyDates, valuationDate, fx);
  return { record, basic, underlying: { ...underlying, current_price: currentPrice }, result, fx };
};

const processLivingRow = (item: Awaited<ReturnType<typeof evaluateRecord>>): ProcessedDQAQRow => ({
  id: item.record.tradeId,
  account: item.basic.account || 'N/A',
  currency: item.basic.currency || 'HKD',
  mktVal: toNumber(item.result.val_net_usd),
  fullPrice: toNumber(item.result.val_full_usd),
  fxRate: item.fx,
});

const buildMktStats = (rows: ProcessedDQAQRow[]) => {
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
    rawMatrix[row.currency][row.account] += row.mktVal || 0;
  });
  return { accounts, markets, rawMatrix };
};

const buildPlStats = (rows: ProcessedDQAQRow[]) => {
  const markets = Array.from(new Set(rows.map((row) => row.currency).filter(Boolean))).sort();
  const rawMatrix: Record<string, { realized: number; unrealized: number; total: number }> = {};
  markets.forEach((market) => {
    rawMatrix[market] = { realized: 0, unrealized: 0, total: 0 };
  });
  rows.forEach((row) => {
    rawMatrix[row.currency].unrealized += row.mktVal || 0;
    rawMatrix[row.currency].total += row.mktVal || 0;
  });
  return { markets, rawMatrix };
};

const buildRiskSummary = (items: Awaited<ReturnType<typeof evaluateRecord>>[]) => {
  const summary: Record<string, { ticker: string; market: string; shares: number; cost: number }> = {};
  items.forEach((item) => {
    const exposureShares = toNumber(item.result.expected_shares) - toNumber(item.result.shares_settled_paid);
    const costPrice = toNumber(item.underlying.spot_price) * toNumber(item.basic.strike_pct);
    const exposureCost = costPrice * exposureShares;
    const ticker = item.underlying.ticker;
    if (!summary[ticker]) {
      summary[ticker] = { ticker, market: item.basic.currency, shares: 0, cost: 0 };
    }
    summary[ticker].shares += exposureShares;
    summary[ticker].cost += exposureCost;
  });
  return Object.values(summary).map((item) => ({
    ...item,
    costPrice: item.shares !== 0 ? item.cost / item.shares : 0,
  }));
};

export const calculateDQAQDisplayCache = async (): Promise<DQAQDisplayCacheResult> => {
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

  for (const record of livingRecords) {
    try {
      evaluatedLiving.push(await evaluateRecord(record, fxRates, quoteCache, requestedSymbols, missingQuoteCodes, warnings));
    } catch (error) {
      failedEvaluations += 1;
      warnings.push(`${record.tradeId}: DQ-AQ evaluation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  for (const record of diedRecords) {
    try {
      evaluatedDied.push(await evaluateRecord(record, fxRates, quoteCache, requestedSymbols, missingQuoteCodes, warnings));
    } catch (error) {
      failedEvaluations += 1;
      warnings.push(`${record.tradeId}: DQ-AQ historical evaluation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const livingRows = evaluatedLiving.map(processLivingRow);
  return {
    status: warnings.length > 0 || failedEvaluations > 0 ? 'partial_success' : 'success',
    data: {
      currentMktStats: buildMktStats(livingRows),
      currentPlStats: buildPlStats(livingRows),
      riskExposureSummary: buildRiskSummary(evaluatedLiving),
      rawCounts: {
        inputLiving: livingRecords.length,
        inputDied: diedRecords.length,
        evaluatedLiving: evaluatedLiving.length,
        evaluatedDied: evaluatedDied.length,
        failedEvaluations,
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
