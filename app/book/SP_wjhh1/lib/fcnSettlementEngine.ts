export type FCNSettlementFxType = 'SAME_CURRENCY' | 'FLOATING' | 'FIXED';
export type FCNRoundingMode = 'NONE' | 'CEIL' | 'ROUND' | 'FLOOR';

export interface FCNUnderlyingTerm {
  ticker: string;
  name?: string;
  market?: string;
  currency?: string;
  initialPrice?: number;
  currentPrice?: number;
  settlementFxType?: FCNSettlementFxType;
  settlementFxRate?: number;
  settlementFxPair?: string;
}

export interface FCNDeliveryRules {
  aggregateNotesForDelivery?: boolean;
  ndsRoundingDecimals?: number;
  ndsRoundingMode?: FCNRoundingMode;
  integralSharesRounding?: 'ROUND' | 'FLOOR';
  residualCashEnabled?: boolean;
}

export interface FCNSettlementCompatibleParams {
  schemaVersion?: number;
  market?: string;
  noteCurrency?: string;
  reportingCurrency?: string;
  total_notional: number;
  denomination: number;
  tickers: string[];
  ticker_name?: string[];
  initial_spots: number[];
  current_spots?: number[];
  strike_pct: number;
  underlyingTerms?: FCNUnderlyingTerm[];
  deliveryRules?: FCNDeliveryRules;
}

export interface NormalizedFCNUnderlyingTerm {
  ticker: string;
  name: string;
  market: string;
  currency: string;
  initialPrice: number;
  currentPrice: number;
  settlementFxType: FCNSettlementFxType;
  settlementFxRate?: number;
  settlementFxPair: string;
}

export interface FCNSettlementBreakdown {
  schemaVersion: number;
  isLegacy: boolean;
  noteCurrency: string;
  reportingCurrency: string;
  underlying: NormalizedFCNUnderlyingTerm;
  underlyingIndex: number;
  noteCount: number;
  strikePrice: number;
  settlementFxRate: number;
  rawSharesPerNote: number;
  roundedSharesPerNote: number;
  integralSharesPerNote: number;
  residualSharesPerNote: number;
  totalIntegralShares: number;
  residualCashPerNote: number;
  residualCashTotal: number;
  deliveryAmountLocal: number;
  markToMarketNoteCurrencyPerNote: number;
}

const CURRENCY_MARKET_MAP: Record<string, string> = {
  USD: 'US',
  HKD: 'HK',
  JPY: 'JP',
  CNY: 'CH',
};

const MARKET_CURRENCY_MAP: Record<string, string> = {
  US: 'USD',
  HK: 'HKD',
  JP: 'JPY',
  CH: 'CNY',
};

const positiveNumber = (value: unknown): number | undefined => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

const inferMarketFromTicker = (ticker: string): string => {
  const normalized = String(ticker || '').trim().toUpperCase();
  if (normalized.endsWith('.HK')) return 'HK';
  if (normalized.endsWith('.T')) return 'JP';
  if (normalized.endsWith('.SS') || normalized.endsWith('.SZ')) return 'CH';
  return 'US';
};

export const marketToCurrency = (market?: string): string => {
  const normalized = String(market || '').trim().toUpperCase();
  return MARKET_CURRENCY_MAP[normalized] || normalized || 'HKD';
};

export const currencyToMarket = (currency?: string): string => {
  const normalized = String(currency || '').trim().toUpperCase();
  return CURRENCY_MARKET_MAP[normalized] || 'HK';
};

export const getFCNNoteCurrency = (params: FCNSettlementCompatibleParams): string =>
  String(params.noteCurrency || params.market || 'HKD').trim().toUpperCase();

export const isLegacyFCNParams = (params: FCNSettlementCompatibleParams): boolean =>
  Number(params.schemaVersion || 1) < 2 || !Array.isArray(params.underlyingTerms);

export const normalizeFCNUnderlyingTerms = (
  params: FCNSettlementCompatibleParams,
): NormalizedFCNUnderlyingTerm[] => {
  const noteCurrency = getFCNNoteCurrency(params);
  const isLegacy = isLegacyFCNParams(params);

  return (params.tickers || []).map((ticker, index) => {
    const configured = params.underlyingTerms?.[index];
    const inferredMarket = inferMarketFromTicker(ticker);
    const market = String(
      configured?.market || (isLegacy ? currencyToMarket(noteCurrency) : inferredMarket),
    ).toUpperCase();
    const currency = String(
      configured?.currency || (isLegacy ? noteCurrency : marketToCurrency(market)),
    ).toUpperCase();
    const settlementFxType: FCNSettlementFxType =
      currency === noteCurrency
        ? 'SAME_CURRENCY'
        : configured?.settlementFxType || 'FLOATING';

    return {
      ticker,
      name: configured?.name || params.ticker_name?.[index] || ticker,
      market,
      currency,
      initialPrice:
        positiveNumber(configured?.initialPrice) ||
        positiveNumber(params.initial_spots?.[index]) ||
        0,
      currentPrice:
        positiveNumber(configured?.currentPrice) ||
        positiveNumber(params.current_spots?.[index]) ||
        positiveNumber(params.initial_spots?.[index]) ||
        0,
      settlementFxType,
      settlementFxRate:
        settlementFxType === 'SAME_CURRENCY'
          ? 1
          : positiveNumber(configured?.settlementFxRate),
      settlementFxPair:
        configured?.settlementFxPair || `${currency}/${noteCurrency}`,
    };
  });
};

const roundTo = (value: number, decimals: number, mode: FCNRoundingMode): number => {
  if (mode === 'NONE') return value;
  const factor = 10 ** Math.max(0, Math.floor(decimals));
  if (mode === 'CEIL') return Math.ceil(value * factor - 1e-12) / factor;
  if (mode === 'FLOOR') return Math.floor(value * factor + 1e-12) / factor;
  return Math.round(value * factor) / factor;
};

export const calculateFCNSettlement = (
  params: FCNSettlementCompatibleParams,
  underlyingIndex: number,
  finalSpot?: number,
  markSpot?: number,
): FCNSettlementBreakdown => {
  const underlying = normalizeFCNUnderlyingTerms(params)[underlyingIndex];
  if (!underlying) throw new Error(`FCN settlement underlying index ${underlyingIndex} is invalid`);

  const isLegacy = isLegacyFCNParams(params);
  const noteCurrency = getFCNNoteCurrency(params);
  const reportingCurrency = String(params.reportingCurrency || 'HKD').toUpperCase();
  const totalNotional = positiveNumber(params.total_notional);
  const denomination = positiveNumber(params.denomination);
  const strikePct = positiveNumber(params.strike_pct);
  if (!totalNotional || !denomination || !strikePct || !underlying.initialPrice) {
    throw new Error('FCN settlement parameters are incomplete');
  }

  const noteCount = totalNotional / denomination;
  const strikePrice = underlying.initialPrice * strikePct;
  const settlementFxRate =
    underlying.currency === noteCurrency ? 1 : positiveNumber(underlying.settlementFxRate);
  if (!settlementFxRate) {
    throw new Error(
      `Missing settlement FX rate for ${underlying.currency}/${noteCurrency}`,
    );
  }

  if (isLegacy) {
    const rawSharesPerNote = denomination / strikePrice;
    const totalIntegralShares = Math.round(totalNotional / strikePrice);
    return {
      schemaVersion: 1,
      isLegacy: true,
      noteCurrency,
      reportingCurrency,
      underlying,
      underlyingIndex,
      noteCount,
      strikePrice,
      settlementFxRate,
      rawSharesPerNote,
      roundedSharesPerNote: rawSharesPerNote,
      integralSharesPerNote: rawSharesPerNote,
      residualSharesPerNote: 0,
      totalIntegralShares,
      residualCashPerNote: 0,
      residualCashTotal: 0,
      deliveryAmountLocal: totalNotional,
      markToMarketNoteCurrencyPerNote:
        rawSharesPerNote * (positiveNumber(markSpot) || underlying.currentPrice),
    };
  }

  const rules = params.deliveryRules || {};
  const aggregateNotes = Boolean(rules.aggregateNotesForDelivery);
  const decimals = rules.ndsRoundingDecimals ?? 3;
  const ndsMode = rules.ndsRoundingMode || 'CEIL';
  const integralMode = rules.integralSharesRounding || 'FLOOR';
  const residualCashEnabled = rules.residualCashEnabled !== false;
  const settlementSpot = positiveNumber(finalSpot) || underlying.currentPrice;
  const valuationSpot = positiveNumber(markSpot) || settlementSpot;

  if (aggregateNotes) {
    const rawTotalShares = (totalNotional * settlementFxRate) / strikePrice;
    const roundedTotalShares = roundTo(rawTotalShares, decimals, ndsMode);
    const totalIntegralShares =
      integralMode === 'ROUND' ? Math.round(roundedTotalShares) : Math.floor(roundedTotalShares);
    const residualSharesTotal = Math.max(0, roundedTotalShares - totalIntegralShares);
    const residualCashTotal = residualCashEnabled
      ? (residualSharesTotal * settlementSpot) / settlementFxRate
      : 0;

    return {
      schemaVersion: 2,
      isLegacy: false,
      noteCurrency,
      reportingCurrency,
      underlying,
      underlyingIndex,
      noteCount,
      strikePrice,
      settlementFxRate,
      rawSharesPerNote: rawTotalShares / noteCount,
      roundedSharesPerNote: roundedTotalShares / noteCount,
      integralSharesPerNote: totalIntegralShares / noteCount,
      residualSharesPerNote: residualSharesTotal / noteCount,
      totalIntegralShares,
      residualCashPerNote: residualCashTotal / noteCount,
      residualCashTotal,
      deliveryAmountLocal: totalIntegralShares * strikePrice,
      markToMarketNoteCurrencyPerNote:
        ((totalIntegralShares * valuationSpot) / settlementFxRate + residualCashTotal) / noteCount,
    };
  }

  const rawSharesPerNote = (denomination * settlementFxRate) / strikePrice;
  const roundedSharesPerNote = roundTo(rawSharesPerNote, decimals, ndsMode);
  const integralSharesPerNote =
    integralMode === 'ROUND'
      ? Math.round(roundedSharesPerNote)
      : Math.floor(roundedSharesPerNote);
  const residualSharesPerNote = Math.max(0, roundedSharesPerNote - integralSharesPerNote);
  const residualCashPerNote = residualCashEnabled
    ? (residualSharesPerNote * settlementSpot) / settlementFxRate
    : 0;
  const totalIntegralShares = integralSharesPerNote * noteCount;
  const residualCashTotal = residualCashPerNote * noteCount;

  return {
    schemaVersion: 2,
    isLegacy: false,
    noteCurrency,
    reportingCurrency,
    underlying,
    underlyingIndex,
    noteCount,
    strikePrice,
    settlementFxRate,
    rawSharesPerNote,
    roundedSharesPerNote,
    integralSharesPerNote,
    residualSharesPerNote,
    totalIntegralShares,
    residualCashPerNote,
    residualCashTotal,
    deliveryAmountLocal: totalIntegralShares * strikePrice,
    markToMarketNoteCurrencyPerNote:
      (integralSharesPerNote * valuationSpot) / settlementFxRate + residualCashPerNote,
  };
};

