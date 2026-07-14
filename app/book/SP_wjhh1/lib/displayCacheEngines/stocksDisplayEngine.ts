import { getAdminDb, getServerAppId } from '@/app/lib/firebaseAdmin';
import {
  calculateAverageCostHoldings,
  type AverageCostInitialHolding,
  type AverageCostQuote,
  type AverageCostStockInfo,
  type AverageCostTrade,
} from '@/app/book/SP_wjhh1/lib/averageCostEngine';

type SourceName = 'SPOT' | 'FCN' | 'DQ/AQ' | 'OPTION_CALL' | 'OPTION_PUT';

type UnifiedTrade = AverageCostTrade & {
  source: SourceName;
};

type StockDisplayCacheResult = {
  status: 'success' | 'partial_success';
  data: {
    holdings: ReturnType<typeof calculateAverageCostHoldings>['holdings'];
    holdingSums: {
      totalCostHKD: number;
      mktValHKD: number;
      grossCostHKD: number;
      grossMktValHKD: number;
      unrealizedPnlHKD: number;
      totalUnrealizedPct: number;
    };
    currentMktStats: {
      accounts: string[];
      markets: string[];
      rawMatrix: Record<string, Record<string, number>>;
    };
    currentPlStats: {
      markets: string[];
      rawMatrix: Record<string, { realized: number; unrealized: number; total: number }>;
    };
    netBuyStats: {
      accounts: string[];
      markets: string[];
      rawMatrix: Record<string, Record<string, number>>;
      totalNetBuyHKD: number;
    };
    riskExposureSummary: Array<{
      code: string;
      market: string;
      costPrice: number;
      shares: number;
      cost: number;
    }>;
    rawCounts: {
      initialHoldings: number;
      trades: number;
      activeTrades: number;
      stockPool: number;
    };
    quoteStatus: {
      requestedSymbols: string[];
      missingQuoteCodes: string[];
      fxRates: Record<string, number>;
      quotes: Record<string, AverageCostQuote>;
    };
  };
  warnings: string[];
  errors: string[];
};

const BASE_URL_YAHOO_CHART = 'https://query1.finance.yahoo.com/v8/finance/chart';
const YAHOO_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
};

const toNumber = (value: unknown, fallback = 0) => {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
};

const getTime = (value: any) => {
  if (!value) return 0;
  if (value.toMillis && typeof value.toMillis === 'function') return value.toMillis();
  if (value.toDate && typeof value.toDate === 'function') return value.toDate().getTime();
  if (value.seconds) return value.seconds * 1000;
  return new Date(value).getTime() || 0;
};

const mapMarket = (market: string | undefined, defaultValue: string) => {
  if (!market) return defaultValue;
  const up = market.toUpperCase();
  if (up === 'US') return 'USD';
  if (up === 'HK') return 'HKD';
  if (up === 'CH' || up === 'CN') return 'CNY';
  if (up === 'JP') return 'JPY';
  if (['USD', 'HKD', 'CNY', 'JPY'].includes(up)) return up;
  return defaultValue;
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
  return snapshot.docs.map((doc) => ({ id: doc.id, data: doc.data() }));
};

const fetchQuote = async (symbol: string): Promise<AverageCostQuote | null> => {
  try {
    const response = await fetch(`${BASE_URL_YAHOO_CHART}/${encodeURIComponent(symbol)}?interval=1d&range=5d`, {
      headers: YAHOO_HEADERS,
      cache: 'no-store',
    });
    if (!response.ok) return null;
    const json = await response.json();
    const result = json?.chart?.result?.[0];
    const meta = result?.meta;
    const price = toNumber(meta?.regularMarketPrice);
    const previousClose = toNumber(meta?.chartPreviousClose);
    if (price <= 0) return null;
    const changePercent = previousClose > 0 ? (price - previousClose) / previousClose : 0;
    return { price, changePercent };
  } catch {
    return null;
  }
};

const fetchFxRate = async (currency: string): Promise<number | null> => {
  if (currency === 'HKD') return 1;
  try {
    const symbol = `${currency}HKD=X`;
    const response = await fetch(`${BASE_URL_YAHOO_CHART}/${symbol}?interval=1d&range=5d`, {
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

const FALLBACK_FX_RATES: Record<string, number> = {
  HKD: 1,
  USD: 7.78,
  JPY: 0.052,
  CNY: 1.08,
};

const loadInitialHoldings = async () => {
  const docs = await fetchCollection('sip_holding_spot_start');
  const initialHoldings: AverageCostInitialHolding[] = [];
  let baseDate = '';
  let baseFxRates: Record<string, number> = {};

  docs.forEach(({ id, data }) => {
    if (id === '_global_config') {
      baseDate = String(data.baseDate || '');
      baseFxRates = (data.baseFxRates || {}) as Record<string, number>;
      return;
    }
    if (id === 'latest_summary') return;
    initialHoldings.push({
      code: String(data.code || ''),
      market: mapMarket(data.market, 'HKD'),
      account: String(data.account || ''),
      quantity: toNumber(data.quantity),
      costPrice: toNumber(data.costPrice),
    });
  });

  return { initialHoldings, baseDate, baseFxRates };
};

const loadStockPool = async (): Promise<AverageCostStockInfo[]> => {
  const docs = await fetchCollection('stock_pool');
  return docs.map(({ data }) => ({
    symbol: String(data.symbol || ''),
    name: data.name ? String(data.name) : undefined,
    sector_level_1: data.sector_level_1 ? String(data.sector_level_1) : undefined,
    sector_level_2: data.sector_level_2 ? String(data.sector_level_2) : undefined,
  })).filter((item) => item.symbol);
};

const loadTrades = async (): Promise<UnifiedTrade[]> => {
  const [spotDocs, fcnDocs, dqaqDocs, optionDocs] = await Promise.all([
    fetchCollection('sip_spot_trade'),
    fetchCollection('sip_holding_fcn_output_get-stock'),
    fetchCollection('sip_holding_dqaq_output_get-stock'),
    fetchCollection('sip_holding_option_output_get-stock'),
  ]);

  const trades: UnifiedTrade[] = [];

  spotDocs.forEach(({ id, data }) => {
    const direction = String(data.direction || 'BUY').toUpperCase() === 'SELL' ? 'SELL' : 'BUY';
    const rawAmount = toNumber(data.amount_incl_fee || data.amount_excl_fee);
    trades.push({
      id,
      source: 'SPOT',
      date: String(data.date || ''),
      account: String(data.account || ''),
      market: mapMarket(data.market, 'HKD'),
      code: String(data.code || ''),
      name: data.name ? String(data.name) : undefined,
      direction,
      quantity: toNumber(data.quantity),
      price: toNumber(data.avg_price_incl_fee || data.price_excl_fee),
      amount: rawAmount,
      fee: toNumber(data.fee),
      updatedAt: getTime(data.createdAt),
      executor: String(data.executor || ''),
    });
  });

  fcnDocs.forEach(({ id, data }) => {
    const direction = String(data.direction || 'BUY').toUpperCase() === 'SELL' ? 'SELL' : 'BUY';
    const rawAmount = toNumber(data.amountWithFee || data.amountNoFee);
    trades.push({
      id,
      source: 'FCN',
      date: String(data.date || ''),
      account: String(data.account || ''),
      market: mapMarket(data.market, 'HKD'),
      code: String(data.stockCode || ''),
      name: data.stockName ? String(data.stockName) : undefined,
      direction,
      quantity: toNumber(data.quantity),
      price: toNumber(data.priceWithFee || data.priceNoFee),
      amount: direction === 'BUY' ? rawAmount : -rawAmount,
      fee: toNumber(data.fee),
      updatedAt: getTime(data.createdAt),
      executor: String(data.executor || ''),
    });
  });

  dqaqDocs.forEach(({ id, data }) => {
    const direction = String(data.direction || 'BUY').toUpperCase() === 'SELL' ? 'SELL' : 'BUY';
    const amountNoFee = toNumber(data.amountNoFee);
    const fee = toNumber(data.fee);
    trades.push({
      id,
      source: 'DQ/AQ',
      date: String(data.date || ''),
      account: String(data.account || ''),
      market: mapMarket(data.market, 'USD'),
      code: String(data.stockCode || ''),
      name: data.stockName ? String(data.stockName) : undefined,
      direction,
      quantity: toNumber(data.quantity),
      price: toNumber(data.priceNoFee),
      amount: amountNoFee + fee,
      fee,
      updatedAt: getTime(data.createdAt),
      executor: String(data.executor || ''),
    });
  });

  optionDocs.forEach(({ id, data }) => {
    const direction = String(data.direction || 'SELL').toUpperCase() === 'BUY' ? 'BUY' : 'SELL';
    const source = String(data.type || '').toLowerCase().includes('put') ? 'OPTION_PUT' : 'OPTION_CALL';
    const amountNoFee = toNumber(data.amountNoFee);
    const fee = toNumber(data.fee);
    trades.push({
      id,
      source,
      date: String(data.date || ''),
      account: String(data.account || ''),
      market: mapMarket(data.market, 'USD'),
      code: String(data.stockCode || ''),
      name: data.stockName ? String(data.stockName) : undefined,
      direction,
      quantity: toNumber(data.quantity),
      price: toNumber(data.priceNoFee),
      amount: amountNoFee + fee,
      fee,
      updatedAt: getTime(data.createdAt),
      executor: String(data.executor || ''),
    });
  });

  return trades.filter((trade) => trade.code && trade.date);
};

const buildMarketData = async (initialHoldings: AverageCostInitialHolding[], trades: UnifiedTrade[]) => {
  const markets = new Set<string>();
  const symbols = new Set<string>();

  const collect = (code: string, market: string) => {
    if (market && market !== 'HKD') markets.add(market);
    if (code) symbols.add(code);
  };

  initialHoldings.forEach((holding) => collect(holding.code, holding.market));
  trades.forEach((trade) => collect(trade.code, trade.market));

  const fxRates: Record<string, number> = { HKD: 1 };
  const warnings: string[] = [];
  await Promise.all(Array.from(markets).map(async (currency) => {
    const rate = await fetchFxRate(currency);
    if (rate) {
      fxRates[currency] = rate;
    } else {
      fxRates[currency] = FALLBACK_FX_RATES[currency] || 1;
      warnings.push(`FX ${currency}/HKD unavailable; fallback ${fxRates[currency]} used.`);
    }
  }));

  const quotes: Record<string, AverageCostQuote> = {};
  const symbolList = Array.from(symbols);
  const batchSize = 8;
  for (let index = 0; index < symbolList.length; index += batchSize) {
    const batch = symbolList.slice(index, index + batchSize);
    await Promise.all(batch.map(async (symbol) => {
      const quote = await fetchQuote(symbol);
      if (quote) quotes[symbol] = quote;
    }));
  }

  return { fxRates, quotes, requestedSymbols: symbolList, warnings };
};

const buildCurrentMktStats = (holdings: ReturnType<typeof calculateAverageCostHoldings>['holdings']) => {
  const accountsSet = new Set<string>();
  const marketsSet = new Set<string>();
  holdings.forEach((holding) => {
    if (holding.market) marketsSet.add(holding.market);
    Object.keys(holding.accounts).forEach((account) => accountsSet.add(account));
  });

  const accounts = Array.from(accountsSet).sort();
  const markets = Array.from(marketsSet).sort();
  const rawMatrix: Record<string, Record<string, number>> = {};
  markets.forEach((market) => {
    rawMatrix[market] = {};
    accounts.forEach((account) => {
      rawMatrix[market][account] = 0;
    });
  });

  holdings.forEach((holding) => {
    if (!holding.market || !rawMatrix[holding.market]) return;
    Object.entries(holding.accounts).forEach(([account, quantity]) => {
      rawMatrix[holding.market][account] += quantity * holding.currentPrice;
    });
  });

  return { accounts, markets, rawMatrix };
};

const buildCurrentPlStats = (holdings: ReturnType<typeof calculateAverageCostHoldings>['holdings']) => {
  const markets = Array.from(new Set(holdings.map((holding) => holding.market).filter(Boolean))).sort();
  const rawMatrix: Record<string, { realized: number; unrealized: number; total: number }> = {};
  markets.forEach((market) => {
    rawMatrix[market] = { realized: 0, unrealized: 0, total: 0 };
  });
  holdings.forEach((holding) => {
    if (!holding.market || !rawMatrix[holding.market]) return;
    rawMatrix[holding.market].realized += holding.realizedPnlLocal || 0;
    rawMatrix[holding.market].unrealized += holding.unrealizedPnlLocal || 0;
    rawMatrix[holding.market].total += (holding.realizedPnlLocal || 0) + (holding.unrealizedPnlLocal || 0);
  });
  return { markets, rawMatrix };
};

const buildNetBuyStats = (trades: UnifiedTrade[], fxRates: Record<string, number>) => {
  const accountsSet = new Set<string>();
  const marketsSet = new Set<string>();
  trades.forEach((trade) => {
    if (trade.account) accountsSet.add(trade.account);
    if (trade.market) marketsSet.add(trade.market);
  });
  const accounts = Array.from(accountsSet).sort();
  const markets = Array.from(marketsSet).sort();
  const rawMatrix: Record<string, Record<string, number>> = {};
  markets.forEach((market) => {
    rawMatrix[market] = {};
    accounts.forEach((account) => {
      rawMatrix[market][account] = 0;
    });
  });
  let totalNetBuyHKD = 0;
  trades.forEach((trade) => {
    if (trade.market && trade.account && rawMatrix[trade.market]) {
      rawMatrix[trade.market][trade.account] += trade.amount;
    }
    totalNetBuyHKD += trade.amount * (fxRates[trade.market] || 1);
  });
  return { accounts, markets, rawMatrix, totalNetBuyHKD };
};

export const calculateStocksDisplayCache = async (): Promise<StockDisplayCacheResult> => {
  const warnings: string[] = [];
  const errors: string[] = [];
  const [{ initialHoldings, baseDate, baseFxRates }, trades, stockPool] = await Promise.all([
    loadInitialHoldings(),
    loadTrades(),
    loadStockPool(),
  ]);

  const activeTrades = trades.filter((trade) => !baseDate || trade.date > baseDate);
  const marketData = await buildMarketData(initialHoldings, activeTrades);
  warnings.push(...marketData.warnings);
  const fxRates = { ...marketData.fxRates, ...baseFxRates };

  const calculation = calculateAverageCostHoldings({
    initialHoldings,
    trades: activeTrades,
    quotes: marketData.quotes,
    fxRates,
    stockPool,
  });

  warnings.push(...calculation.warnings.map((warning) => `${warning.code}: ${warning.message}`));
  const displayHoldings = calculation.holdings.filter((holding) => Math.abs(holding.quantity) > 0.000001);
  const missingQuoteCodes = displayHoldings
    .filter((holding) => Math.abs(holding.quantity) > 0.000001 && !holding.hasValidQuote)
    .map((holding) => holding.code)
    .sort();

  if (missingQuoteCodes.length > 0) {
    warnings.push(`Missing quotes: ${missingQuoteCodes.join(', ')}`);
  }

  const holdingSumsBase = displayHoldings.reduce((acc, holding) => {
    acc.totalCostHKD += holding.totalCostHKD;
    acc.mktValHKD += holding.mktValHKD;
    acc.grossCostHKD += Math.abs(holding.totalCostHKD);
    acc.grossMktValHKD += Math.abs(holding.mktValHKD);
    acc.unrealizedPnlHKD += holding.unrealizedPnlHKD;
    return acc;
  }, { totalCostHKD: 0, mktValHKD: 0, grossCostHKD: 0, grossMktValHKD: 0, unrealizedPnlHKD: 0 });

  const holdingSums = {
    ...holdingSumsBase,
    totalUnrealizedPct: holdingSumsBase.grossCostHKD > 0 ? holdingSumsBase.unrealizedPnlHKD / holdingSumsBase.grossCostHKD : 0,
  };

  return {
    status: missingQuoteCodes.length > 0 || warnings.length > 0 ? 'partial_success' : 'success',
    data: {
      holdings: displayHoldings,
      holdingSums,
      currentMktStats: buildCurrentMktStats(displayHoldings),
      currentPlStats: buildCurrentPlStats(calculation.holdings),
      netBuyStats: buildNetBuyStats(activeTrades, fxRates),
      riskExposureSummary: displayHoldings.map((holding) => ({
        code: holding.code,
        market: holding.market,
        costPrice: holding.avgCost,
        shares: holding.quantity,
        cost: holding.avgCost * holding.quantity,
      })),
      rawCounts: {
        initialHoldings: initialHoldings.length,
        trades: trades.length,
        activeTrades: activeTrades.length,
        stockPool: stockPool.length,
      },
      quoteStatus: {
        requestedSymbols: marketData.requestedSymbols,
        missingQuoteCodes,
        fxRates,
        quotes: marketData.quotes,
      },
    },
    warnings,
    errors,
  };
};
