import type { FCNParams } from '@/app/lib/fcnPricer';

export type CorporateActionType = 'split' | 'reverse_split';

export interface CorporateActionRecord {
  id?: string;
  ticker: string;
  market?: string;
  actionType: CorporateActionType;
  effectiveDate: string;
  oldShares: number;
  newShares: number;
  factor?: number;
  note?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface CorporateActionAdjustmentDetail {
  ticker: string;
  market?: string;
  fromDate?: string;
  toDate?: string;
  factor: number;
  actions: CorporateActionRecord[];
}

export interface CorporateActionAdjustmentResult<T> {
  adjusted: T;
  details: CorporateActionAdjustmentDetail[];
}

export const CORPORATE_ACTION_COLLECTION = 'sip_corporate_actions';

export const normalizeTickerForCorporateAction = (ticker: string) =>
  String(ticker || '').trim().toUpperCase();

export const getCorporateActionFactor = (
  ticker: string,
  actions: CorporateActionRecord[],
  fromDate?: string,
  toDate?: string,
) => {
  const normalizedTicker = normalizeTickerForCorporateAction(ticker);
  const matched = actions
    .filter((action) => normalizeTickerForCorporateAction(action.ticker) === normalizedTicker)
    .filter((action) => {
      if (!action.effectiveDate) return false;
      if (fromDate && action.effectiveDate <= fromDate) return false;
      if (toDate && action.effectiveDate > toDate) return false;
      return true;
    })
    .sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));

  const factor = matched.reduce((acc, action) => acc * getSingleActionFactor(action), 1);
  return { factor, actions: matched };
};

export const adjustManualPriceToMarketBasis = (price: number, factor: number) => {
  if (!Number.isFinite(price) || !Number.isFinite(factor) || factor <= 0) return price;
  return price / factor;
};

export const adjustManualSharesToMarketBasis = (shares: number, factor: number) => {
  if (!Number.isFinite(shares) || !Number.isFinite(factor) || factor <= 0) return shares;
  return shares * factor;
};

export const applyCorporateActionsToFCNParams = (
  params: FCNParams,
  actions: CorporateActionRecord[],
  valuationDate = new Date().toISOString().slice(0, 10),
): CorporateActionAdjustmentResult<FCNParams> => {
  const adjusted: FCNParams = deepClone(params);
  const details: CorporateActionAdjustmentDetail[] = [];

  adjusted.initial_spots = (params.initial_spots || []).map((initialSpot, index) => {
    const ticker = params.tickers?.[index];
    if (!ticker) return initialSpot;
    const { factor, actions: matchedActions } = getCorporateActionFactor(
      ticker,
      actions,
      params.trade_date,
      valuationDate,
    );
    if (factor === 1 || matchedActions.length === 0) return initialSpot;

    details.push({
      ticker,
      market: params.underlyingTerms?.[index]?.market,
      fromDate: params.trade_date,
      toDate: valuationDate,
      factor,
      actions: matchedActions,
    });

    return adjustManualPriceToMarketBasis(Number(initialSpot), factor);
  });

  if (Array.isArray(params.underlyingTerms)) {
    adjusted.underlyingTerms = params.underlyingTerms.map((term, index) => {
      const detail = details.find(
        (item) => normalizeTickerForCorporateAction(item.ticker) === normalizeTickerForCorporateAction(term.ticker || params.tickers?.[index] || ''),
      );
      if (!detail) return { ...term };
      const sourceInitialPrice = Number.isFinite(Number(term.initialPrice))
        ? Number(term.initialPrice)
        : Number(params.initial_spots?.[index]);
      return {
        ...term,
        initialPrice: adjustManualPriceToMarketBasis(sourceInitialPrice, detail.factor),
        // Historical quotes and live quotes are assumed to already be split-adjusted by the data source.
        currentPrice: term.currentPrice,
      };
    });
  }

  return { adjusted, details };
};

const getSingleActionFactor = (action: CorporateActionRecord) => {
  const oldShares = Number(action.oldShares);
  const newShares = Number(action.newShares);
  if (!Number.isFinite(oldShares) || oldShares <= 0 || !Number.isFinite(newShares) || newShares <= 0) return 1;
  return newShares / oldShares;
};

const deepClone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
