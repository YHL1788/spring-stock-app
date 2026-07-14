import { getAdminDb, getServerAppId } from '@/app/lib/firebaseAdmin';

type SummaryMatrix = {
  accounts?: string[];
  markets?: string[];
  rawMatrix?: Record<string, Record<string, number>>;
};

type PlSummaryMatrix = {
  markets?: string[];
  rawMatrix?: Record<string, { realized: number; unrealized: number; total: number }>;
};

type InitialCash = {
  id: string;
  currency: string;
  account: string;
  amount: number;
};

type CashTrade = {
  id: string;
  date: string;
  account: string;
  currency: string;
  amount: number;
  type: string;
  fxGroupId?: string;
};

export type CashDisplayCacheResult = {
  status: 'success' | 'partial_success';
  data: {
    currentCashStats: {
      accounts: string[];
      markets: string[];
      rawMatrix: Record<string, Record<string, number>>;
    };
    currentPlStats: {
      markets: string[];
      rawMatrix: Record<string, { realized: number; unrealized: number; total: number }>;
    };
    cashBreakdownStats: {
      currencies: string[];
      breakdowns: Record<string, { DIVIDEND: number; FEE: number; INTEREST: number; FX: number; TOTAL: number }>;
    };
    initialCashStats: {
      accounts: string[];
      markets: string[];
      rawMatrix: Record<string, Record<string, number>>;
    };
    baseDate: string;
    baseFxRates: Record<string, number>;
    fxRates: Record<string, number>;
    rawCounts: {
      initialCash: number;
      cashTrades: number;
      activeCashTrades: number;
      displayCacheInputs: string[];
      formalSummaryInputs: string[];
      missingSummaryInputs: string[];
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

const dataCollection = (collectionName: string) => {
  const appId = getServerAppId();
  return getAdminDb()
    .collection('artifacts')
    .doc(appId)
    .collection('public')
    .doc('data')
    .collection(collectionName);
};

const dataDoc = (collectionName: string, docId: string) => dataCollection(collectionName).doc(docId);

const fetchCollection = async (collectionName: string) => {
  const snapshot = await dataCollection(collectionName).get();
  return snapshot.docs.map((doc) => ({ id: doc.id, data: doc.data() }));
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

const buildFxRates = async (currencies: Iterable<string>, warnings: string[]) => {
  const uniqueCurrencies = new Set<string>(['HKD']);
  Array.from(currencies).forEach((currency) => {
    if (currency) uniqueCurrencies.add(String(currency).toUpperCase());
  });

  const fxRates: Record<string, number> = { HKD: 1 };
  await Promise.all(Array.from(uniqueCurrencies).map(async (currency) => {
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

const fetchInitialCash = async () => {
  const docs = await fetchCollection('sip_holding_cash_start');
  const initialCash: InitialCash[] = [];
  let baseDate = '';
  let baseFxRates: Record<string, number> = {};

  docs.forEach(({ id, data }) => {
    if (id === '_global_config') {
      baseDate = String(data.baseDate || '');
      baseFxRates = data.baseFxRates || {};
      return;
    }
    initialCash.push({
      id,
      currency: String(data.currency || 'HKD').toUpperCase(),
      account: String(data.account || 'N/A'),
      amount: toNumber(data.amount),
    });
  });
  return { initialCash, baseDate, baseFxRates };
};

const fetchCashTrades = async (): Promise<CashTrade[]> => {
  const docs = await fetchCollection('sip_trade_cash');
  return docs.map(({ id, data }) => ({
    id,
    date: String(data.date || ''),
    account: String(data.account || 'N/A'),
    currency: String(data.currency || 'HKD').toUpperCase(),
    amount: toNumber(data.amount),
    type: String(data.type || ''),
    fxGroupId: data.fxGroupId,
  }));
};

const fetchFormalSummary = async (collectionName: string): Promise<SummaryMatrix | null> => {
  const snapshot = await dataDoc(collectionName, 'latest_summary').get();
  return snapshot.exists ? snapshot.data() as SummaryMatrix : null;
};

const fetchCurrentCacheData = async (moduleName: string) => {
  const snapshot = await dataDoc('sip_display_cache_current', moduleName).get();
  return snapshot.exists ? snapshot.data()?.data || null : null;
};

const pickSummaryFromCurrentCache = async (
  moduleName: string,
  fieldName: 'netBuyStats' | 'cashStats',
): Promise<SummaryMatrix | null> => {
  const data = await fetchCurrentCacheData(moduleName);
  const summary = data?.[fieldName];
  if (!summary || !Array.isArray(summary.accounts) || !Array.isArray(summary.markets) || !summary.rawMatrix) {
    return null;
  }
  return summary as SummaryMatrix;
};

const buildInitialCashStats = (initialCash: InitialCash[]) => {
  const accounts = Array.from(new Set(initialCash.map((item) => item.account).filter(Boolean))).sort();
  const markets = Array.from(new Set(initialCash.map((item) => item.currency).filter(Boolean))).sort();
  const rawMatrix: Record<string, Record<string, number>> = {};
  markets.forEach((market) => {
    rawMatrix[market] = {};
    accounts.forEach((account) => {
      rawMatrix[market][account] = 0;
    });
  });
  initialCash.forEach((item) => {
    rawMatrix[item.currency][item.account] += item.amount;
  });
  return { accounts, markets, rawMatrix };
};

const buildCurrentCashStats = (
  initialCash: InitialCash[],
  activeCashTrades: CashTrade[],
  subSummaries: SummaryMatrix[],
) => {
  const allAccounts = new Set<string>();
  const allCurrencies = new Set<string>();

  initialCash.forEach((item) => {
    allAccounts.add(item.account);
    allCurrencies.add(item.currency);
  });
  activeCashTrades.forEach((trade) => {
    allAccounts.add(trade.account);
    allCurrencies.add(trade.currency);
  });
  subSummaries.forEach((summary) => {
    (summary.accounts || []).forEach((account) => allAccounts.add(account));
    (summary.markets || []).forEach((market) => allCurrencies.add(market));
  });

  const accounts = Array.from(allAccounts).sort();
  const markets = Array.from(allCurrencies).sort();
  const rawMatrix: Record<string, Record<string, number>> = {};
  markets.forEach((market) => {
    rawMatrix[market] = {};
    accounts.forEach((account) => {
      rawMatrix[market][account] = 0;
    });
  });

  initialCash.forEach((item) => {
    if (rawMatrix[item.currency]?.[item.account] !== undefined) rawMatrix[item.currency][item.account] += item.amount;
  });
  activeCashTrades.forEach((trade) => {
    if (rawMatrix[trade.currency]?.[trade.account] !== undefined) rawMatrix[trade.currency][trade.account] += trade.amount;
  });
  subSummaries.forEach((summary) => {
    (summary.markets || []).forEach((market) => {
      (summary.accounts || []).forEach((account) => {
        if (rawMatrix[market]?.[account] !== undefined) {
          rawMatrix[market][account] -= toNumber(summary.rawMatrix?.[market]?.[account]);
        }
      });
    });
  });

  return { accounts, markets, rawMatrix };
};

const buildCashBreakdownStats = (activeCashTrades: CashTrade[], fxRates: Record<string, number>) => {
  const breakdowns: Record<string, { DIVIDEND: number; FEE: number; INTEREST: number; FX: number; TOTAL: number }> = {};
  const initCurrency = (currency: string) => {
    if (!breakdowns[currency]) breakdowns[currency] = { DIVIDEND: 0, FEE: 0, INTEREST: 0, FX: 0, TOTAL: 0 };
  };

  activeCashTrades.forEach((trade) => {
    if (['DIVIDEND', 'FEE', 'INTEREST'].includes(trade.type)) {
      initCurrency(trade.currency);
      const key = trade.type as 'DIVIDEND' | 'FEE' | 'INTEREST';
      breakdowns[trade.currency][key] += trade.amount;
      breakdowns[trade.currency].TOTAL += trade.amount;
    }
  });

  const fxGroups: Record<string, { out: CashTrade | null; in: CashTrade | null }> = {};
  activeCashTrades.filter((trade) => trade.type === 'FX' && trade.fxGroupId).forEach((trade) => {
    if (!fxGroups[trade.fxGroupId!]) fxGroups[trade.fxGroupId!] = { out: null, in: null };
    if (trade.amount < 0) fxGroups[trade.fxGroupId!].out = trade;
    if (trade.amount > 0) fxGroups[trade.fxGroupId!].in = trade;
  });

  Object.values(fxGroups).forEach((group) => {
    if (!group.out || !group.in) return;
    const rateOut = fxRates[group.out.currency] || 1;
    const rateIn = fxRates[group.in.currency] || 1;
    if (rateIn <= 0) return;
    const expectedInAmount = Math.abs(group.out.amount) * (rateOut / rateIn);
    const fxPnl = group.in.amount - expectedInAmount;
    initCurrency(group.in.currency);
    breakdowns[group.in.currency].FX += fxPnl;
    breakdowns[group.in.currency].TOTAL += fxPnl;
  });

  return { currencies: Object.keys(breakdowns).sort(), breakdowns };
};

const buildCurrentPlStats = (cashBreakdownStats: CashDisplayCacheResult['data']['cashBreakdownStats']) => {
  const rawMatrix: Record<string, { realized: number; unrealized: number; total: number }> = {};
  cashBreakdownStats.currencies.forEach((currency) => {
    const total = cashBreakdownStats.breakdowns[currency].TOTAL;
    rawMatrix[currency] = { realized: total, unrealized: 0, total };
  });
  return { markets: cashBreakdownStats.currencies, rawMatrix };
};

export const calculateCashDisplayCache = async (): Promise<CashDisplayCacheResult> => {
  const warnings: string[] = [];
  const errors: string[] = [];
  const displayCacheInputs: string[] = [];
  const formalSummaryInputs: string[] = [];
  const missingSummaryInputs: string[] = [];

  const [{ initialCash, baseDate, baseFxRates }, cashTrades] = await Promise.all([
    fetchInitialCash(),
    fetchCashTrades(),
  ]);
  const activeCashTrades = cashTrades.filter((trade) => !baseDate || trade.date > baseDate);

  const [
    stockCacheSummary,
    fcnCacheSummary,
    optionCacheSummary,
    spotFormalSummary,
    fcnFormalSummary,
    optionFormalSummary,
    peFormalSummary,
    cbbcFormalSummary,
  ] = await Promise.all([
    pickSummaryFromCurrentCache('stocks', 'netBuyStats'),
    pickSummaryFromCurrentCache('fcn', 'cashStats'),
    pickSummaryFromCurrentCache('option', 'cashStats'),
    fetchFormalSummary('sip_holding_cash_stock'),
    fetchFormalSummary('sip_holding_cash_fcn'),
    fetchFormalSummary('sip_holding_cash_option'),
    fetchFormalSummary('sip_holding_cash_pe'),
    fetchFormalSummary('sip_holding_cash_cbbc'),
  ]);

  const stockSummary = stockCacheSummary || spotFormalSummary;
  const fcnSummary = fcnCacheSummary || fcnFormalSummary;
  const optionSummary = optionCacheSummary || optionFormalSummary;

  if (stockCacheSummary) displayCacheInputs.push('stocks.netBuyStats');
  else if (spotFormalSummary) formalSummaryInputs.push('sip_holding_cash_stock/latest_summary');
  else missingSummaryInputs.push('stock cash summary');

  if (fcnCacheSummary) displayCacheInputs.push('fcn.cashStats');
  else if (fcnFormalSummary) formalSummaryInputs.push('sip_holding_cash_fcn/latest_summary');
  else missingSummaryInputs.push('fcn cash summary');

  if (optionCacheSummary) displayCacheInputs.push('option.cashStats');
  else if (optionFormalSummary) formalSummaryInputs.push('sip_holding_cash_option/latest_summary');
  else missingSummaryInputs.push('option cash summary');

  if (peFormalSummary) formalSummaryInputs.push('sip_holding_cash_pe/latest_summary');
  else missingSummaryInputs.push('pe cash summary');
  if (cbbcFormalSummary) formalSummaryInputs.push('sip_holding_cash_cbbc/latest_summary');
  else missingSummaryInputs.push('cbbc cash summary');

  if (missingSummaryInputs.length > 0) {
    warnings.push(`Missing cash summary inputs: ${missingSummaryInputs.join(', ')}.`);
  }

  const subSummaries = [stockSummary, peFormalSummary, cbbcFormalSummary, optionSummary, fcnSummary]
    .filter(Boolean) as SummaryMatrix[];
  const fxCurrencies = new Set<string>();
  initialCash.forEach((item) => fxCurrencies.add(item.currency));
  cashTrades.forEach((trade) => fxCurrencies.add(trade.currency));
  subSummaries.forEach((summary) => (summary.markets || []).forEach((market) => fxCurrencies.add(market)));
  const fxRates = await buildFxRates(fxCurrencies, warnings);

  const cashBreakdownStats = buildCashBreakdownStats(activeCashTrades, fxRates);
  return {
    status: warnings.length > 0 ? 'partial_success' : 'success',
    data: {
      currentCashStats: buildCurrentCashStats(initialCash, activeCashTrades, subSummaries),
      currentPlStats: buildCurrentPlStats(cashBreakdownStats),
      cashBreakdownStats,
      initialCashStats: buildInitialCashStats(initialCash),
      baseDate,
      baseFxRates,
      fxRates,
      rawCounts: {
        initialCash: initialCash.length,
        cashTrades: cashTrades.length,
        activeCashTrades: activeCashTrades.length,
        displayCacheInputs,
        formalSummaryInputs,
        missingSummaryInputs,
      },
    },
    warnings,
    errors,
  };
};
