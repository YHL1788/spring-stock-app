export type PriceCurrency = 'HKD' | 'USD' | 'CNY' | 'JPY';

export type ContestPlayer = {
  name: string;
  password: string;
  status: 'active' | 'paused';
  createdAt?: string;
  updatedAt?: string;
};

export type PchipContestConfig = {
  startDate: string;
  maxCapitalHKD: number;
  tradingCostRate: number;
  feeMode?: 'realistic' | 'custom';
  customFixedFeeHKD?: number;
  customFeeRate?: number;
  includeStampDuty?: boolean;
  minTradeValueHKD: number;
  weightPnlToleranceRatio: number;
  reaffirmCycleDays: number;
  halfLifeTradingDays: number;
  targetCurrency: 'HKD';
  players?: ContestPlayer[];
};

export type PriceTargetPoint = {
  price: number;
  targetValueHKD: number;
};

export type ResearcherView = {
  id: string;
  researcherName: string;
  symbol: string;
  market: string;
  stockName: string;
  priceCurrency: PriceCurrency;
  effectiveDate: string;
  versionNo: number;
  minTradeShares?: number;
  allowNonMonotonic: boolean;
  status: 'active' | 'paused';
  note: string;
  hasResearchNote?: boolean;
  researchNoteID?: string;
  points: PriceTargetPoint[];
  createdAt: string;
  updatedAt: string;
  reaffirmedAt?: string;
  lastConfidenceAt: string;
};

export type MarketQuote = {
  symbol: string;
  close: number;
  priceCurrency: PriceCurrency;
  fxToHKD: number;
  name?: string;
};

export type SimulationTradeLedger = {
  id: string;
  runId: string;
  date: string;
  researcherName: string;
  account: string;
  symbol: string;
  code: string;
  market: string;
  stockName: string;
  name: string;
  source: 'PCHIP';
  close: number;
  priceCurrency: PriceCurrency;
  fxToHKD: number;
  rawTargetValueHKD: number;
  scaleRatio: number;
  finalTargetValueHKD: number;
  previousShares: number;
  targetShares: number;
  minTradeShares?: number;
  tradeShares: number;
  quantity: number;
  tradePrice: number;
  price: number;
  tradeValueHKD: number;
  amount: number;
  tradingCostRate: number;
  tradingCostHKD: number;
  fee: number;
  side: 'BUY' | 'SELL' | 'NONE';
  direction: 'BUY' | 'SELL' | 'NONE';
  skippedByMinTradeValue: boolean;
  forcedByCapitalConstraint: boolean;
  viewId: string;
  executor: string;
  updatedAt: number;
  createdAt: string;
};

export type PositionSnapshot = {
  researcherName: string;
  symbol: string;
  market: string;
  stockName: string;
  shares: number;
  costBasisHKD: number;
  averageCostHKD: number;
  marketValueHKD: number;
  realizedPnlHKD: number;
  unrealizedPnlHKD: number;
  totalPnlHKD: number;
  lastClose: number;
  fxToHKD: number;
};

export type AccountSnapshot = {
  researcherName: string;
  grossMarketValueHKD: number;
  cashHKD: number;
  availableCapacityHKD: number;
  realizedPnlHKD: number;
  unrealizedPnlHKD: number;
  totalPnlHKD: number;
  stockCount: number;
};

export type VoiceWeight = {
  researcherName: string;
  symbol: string;
  market: string;
  stockName: string;
  totalPnlHKD: number;
  daysSinceLastConfidence: number;
  freshnessDecay: number;
  score: number;
  weight: number;
};

export type GeneratedTrade = Omit<SimulationTradeLedger, 'id' | 'createdAt'>;

const EPSILON = 1e-9;

function normalizeMinTradeShares(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function roundTradeSharesToLotSize(shares: number, lotSize: number): number {
  if (!Number.isFinite(shares) || Math.abs(shares) < EPSILON) return 0;
  const normalizedLot = normalizeMinTradeShares(lotSize);
  const roundedAbs = Math.floor(Math.abs(shares) / normalizedLot) * normalizedLot;
  if (roundedAbs < EPSILON) return 0;
  return shares > 0 ? roundedAbs : -roundedAbs;
}

export function normalizePoints(points: PriceTargetPoint[]): PriceTargetPoint[] {
  const valid = points
    .map((point) => ({
      price: Number(point.price),
      targetValueHKD: Number(point.targetValueHKD),
    }))
    .filter((point) => Number.isFinite(point.price) && point.price > 0 && Number.isFinite(point.targetValueHKD) && point.targetValueHKD >= 0)
    .sort((a, b) => a.price - b.price);

  return valid.filter((point, index) => index === 0 || Math.abs(point.price - valid[index - 1].price) > EPSILON);
}

export function hasNonMonotonicValue(points: PriceTargetPoint[]): boolean {
  const sorted = normalizePoints(points);
  return sorted.some((point, index) => index > 0 && point.targetValueHKD > sorted[index - 1].targetValueHKD + EPSILON);
}

export function businessDaysBetween(startDate: string, endDate: string): number {
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return 0;

  let days = 0;
  const cursor = new Date(start);
  cursor.setDate(cursor.getDate() + 1);
  while (cursor <= end) {
    const day = cursor.getDay();
    if (day !== 0 && day !== 6) days += 1;
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

export function freshnessDecay(daysSinceLastConfidence: number, reaffirmCycleDays: number, halfLifeTradingDays: number): number {
  if (daysSinceLastConfidence <= reaffirmCycleDays) return 1;
  const effectiveStaleDays = daysSinceLastConfidence - reaffirmCycleDays;
  return Math.pow(0.5, effectiveStaleDays / Math.max(1, halfLifeTradingDays));
}

export function pchipValue(points: PriceTargetPoint[], price: number): number {
  const sorted = normalizePoints(points);
  const n = sorted.length;
  if (n === 0 || !Number.isFinite(price)) return 0;
  if (n === 1) return sorted[0].targetValueHKD;

  const xs = sorted.map((point) => point.price);
  const ys = sorted.map((point) => point.targetValueHKD);

  if (price <= xs[0]) return ys[0];
  if (price >= xs[n - 1]) return ys[n - 1];

  const h: number[] = [];
  const delta: number[] = [];
  for (let i = 0; i < n - 1; i += 1) {
    h.push(xs[i + 1] - xs[i]);
    delta.push((ys[i + 1] - ys[i]) / h[i]);
  }

  const d = new Array<number>(n).fill(0);
  d[0] = endpointSlope(h[0], h[1], delta[0], delta[1]);
  d[n - 1] = endpointSlope(h[n - 2], h[n - 3], delta[n - 2], delta[n - 3]);

  for (let i = 1; i < n - 1; i += 1) {
    if (delta[i - 1] * delta[i] <= 0) {
      d[i] = 0;
    } else {
      const w1 = 2 * h[i] + h[i - 1];
      const w2 = h[i] + 2 * h[i - 1];
      d[i] = (w1 + w2) / (w1 / delta[i - 1] + w2 / delta[i]);
    }
  }

  let k = 0;
  while (k < n - 2 && price > xs[k + 1]) k += 1;

  const t = (price - xs[k]) / h[k];
  const h00 = (2 * t ** 3) - (3 * t ** 2) + 1;
  const h10 = (t ** 3) - (2 * t ** 2) + t;
  const h01 = (-2 * t ** 3) + (3 * t ** 2);
  const h11 = (t ** 3) - (t ** 2);

  return Math.max(0, h00 * ys[k] + h10 * h[k] * d[k] + h01 * ys[k + 1] + h11 * h[k] * d[k + 1]);
}

function endpointSlope(h0?: number, h1?: number, delta0?: number, delta1?: number): number {
  if (!Number.isFinite(h0) || !Number.isFinite(delta0)) return 0;
  if (!Number.isFinite(h1) || !Number.isFinite(delta1)) return delta0 || 0;

  let d = ((2 * h0! + h1!) * delta0! - h0! * delta1!) / (h0! + h1!);
  if (d * delta0! <= 0) d = 0;
  else if (delta0! * delta1! < 0 && Math.abs(d) > Math.abs(3 * delta0!)) d = 3 * delta0!;
  return d;
}

export function targetValueForPrice(points: PriceTargetPoint[], price: number, fxToHKD: number): number {
  const sorted = normalizePoints(points);
  if (sorted.length === 0 || !Number.isFinite(price) || price <= 0 || !Number.isFinite(fxToHKD) || fxToHKD <= 0) return 0;

  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (price < first.price) {
    const boundaryShares = first.targetValueHKD / (first.price * fxToHKD);
    return boundaryShares * price * fxToHKD;
  }
  if (price > last.price) {
    const boundaryShares = last.targetValueHKD / (last.price * fxToHKD);
    return boundaryShares * price * fxToHKD;
  }
  return pchipValue(sorted, price);
}

export function buildCurve(points: PriceTargetPoint[], fxToHKD: number, steps = 80): Array<{ price: number; targetValueHKD: number }> {
  const sorted = normalizePoints(points);
  if (sorted.length === 0) return [];
  const min = sorted[0].price;
  const max = sorted[sorted.length - 1].price;
  const padding = Math.max((max - min) * 0.12, min * 0.08);
  const from = Math.max(0.01, min - padding);
  const to = max + padding;
  const span = Math.max(to - from, 1);

  return Array.from({ length: steps }, (_, index) => {
    const price = from + (span * index) / (steps - 1);
    return {
      price,
      targetValueHKD: targetValueForPrice(sorted, price, fxToHKD),
    };
  });
}

export function rebuildPositions(trades: SimulationTradeLedger[], quotes: Record<string, MarketQuote> = {}): PositionSnapshot[] {
  const sortedTrades = [...trades].sort((a, b) => `${a.date}-${a.createdAt}`.localeCompare(`${b.date}-${b.createdAt}`));
  const map = new Map<string, PositionSnapshot>();

  sortedTrades.forEach((trade) => {
    const key = positionKey(trade.researcherName, trade.symbol, trade.market);
    const existing = map.get(key) || {
      researcherName: trade.researcherName,
      symbol: trade.symbol,
      market: trade.market,
      stockName: trade.stockName,
      shares: 0,
      costBasisHKD: 0,
      averageCostHKD: 0,
      marketValueHKD: 0,
      realizedPnlHKD: 0,
      unrealizedPnlHKD: 0,
      totalPnlHKD: 0,
      lastClose: trade.close,
      fxToHKD: trade.fxToHKD,
    };

    if (trade.side === 'BUY' && trade.tradeShares > 0) {
      const buyAmountHKD = Math.abs(getTradeAmountHKD(trade));
      const buyShares = Math.abs(trade.quantity || trade.tradeShares);
      existing.costBasisHKD += buyAmountHKD;
      existing.shares += buyShares;
    }

    if (trade.side === 'SELL' && trade.tradeShares < 0 && existing.shares > EPSILON) {
      const sellShares = Math.min(Math.abs(trade.quantity || trade.tradeShares), existing.shares);
      const averageCost = existing.costBasisHKD / existing.shares;
      const proceedsHKD = Math.abs(getTradeAmountHKD(trade));
      existing.realizedPnlHKD += proceedsHKD - averageCost * sellShares;
      existing.costBasisHKD = Math.max(0, existing.costBasisHKD - averageCost * sellShares);
      existing.shares = Math.max(0, existing.shares - sellShares);
    }

    existing.averageCostHKD = existing.shares > EPSILON ? existing.costBasisHKD / existing.shares : 0;
    existing.lastClose = trade.close;
    existing.fxToHKD = trade.fxToHKD;
    existing.stockName = trade.stockName || existing.stockName;
    map.set(key, existing);
  });

  return Array.from(map.values()).map((position) => {
    const quote = quotes[symbolKey(position.symbol, position.market)];
    const close = quote?.close || position.lastClose;
    const fxToHKD = quote?.fxToHKD || position.fxToHKD || 1;
    const marketValueHKD = position.shares * close * fxToHKD;
    const unrealizedPnlHKD = marketValueHKD - position.costBasisHKD;
    return {
      ...position,
      lastClose: close,
      fxToHKD,
      marketValueHKD,
      unrealizedPnlHKD,
      totalPnlHKD: position.realizedPnlHKD + unrealizedPnlHKD,
    };
  });
}

export function buildAccountSnapshots(positions: PositionSnapshot[], maxCapitalHKD: number, trades: SimulationTradeLedger[] = []): AccountSnapshot[] {
  const map = new Map<string, AccountSnapshot>();
  const cashMap = buildCashMap(trades, maxCapitalHKD);
  positions.forEach((position) => {
    const item = map.get(position.researcherName) || {
      researcherName: position.researcherName,
      grossMarketValueHKD: 0,
      cashHKD: cashMap.get(position.researcherName) ?? maxCapitalHKD,
      availableCapacityHKD: maxCapitalHKD,
      realizedPnlHKD: 0,
      unrealizedPnlHKD: 0,
      totalPnlHKD: 0,
      stockCount: 0,
    };
    if (position.shares > EPSILON || Math.abs(position.totalPnlHKD) > EPSILON) item.stockCount += 1;
    item.grossMarketValueHKD += position.marketValueHKD;
    item.realizedPnlHKD += position.realizedPnlHKD;
    item.unrealizedPnlHKD += position.unrealizedPnlHKD;
    item.totalPnlHKD += position.totalPnlHKD;
    item.cashHKD = cashMap.get(position.researcherName) ?? maxCapitalHKD;
    item.availableCapacityHKD = item.cashHKD;
    map.set(position.researcherName, item);
  });

  cashMap.forEach((cashHKD, researcherName) => {
    if (!map.has(researcherName)) {
      map.set(researcherName, {
        researcherName,
        grossMarketValueHKD: 0,
        cashHKD,
        availableCapacityHKD: cashHKD,
        realizedPnlHKD: 0,
        unrealizedPnlHKD: 0,
        totalPnlHKD: 0,
        stockCount: 0,
      });
    }
  });

  return Array.from(map.values()).sort((a, b) => b.totalPnlHKD - a.totalPnlHKD);
}

export function buildCashMap(trades: SimulationTradeLedger[], maxCapitalHKD: number): Map<string, number> {
  const map = new Map<string, number>();
  trades.forEach((trade) => {
    const researcherName = trade.account || trade.researcherName;
    const previousCash = map.get(researcherName) ?? maxCapitalHKD;
    map.set(researcherName, previousCash - getTradeAmountHKD(trade));
  });
  return map;
}

export function buildVoiceWeights(
  views: ResearcherView[],
  positions: PositionSnapshot[],
  asOfDate: string,
  config: PchipContestConfig,
): VoiceWeight[] {
  const activeViews = views.filter((view) => view.status === 'active');
  const positionMap = new Map(positions.map((position) => [positionKey(position.researcherName, position.symbol, position.market), position]));
  const bySymbol = new Map<string, VoiceWeight[]>();

  activeViews.forEach((view) => {
    const position = positionMap.get(positionKey(view.researcherName, view.symbol, view.market));
    const totalPnlHKD = position?.totalPnlHKD || 0;
    const daysSinceLastConfidence = businessDaysBetween(view.lastConfidenceAt || view.updatedAt, asOfDate);
    const decay = freshnessDecay(daysSinceLastConfidence, config.reaffirmCycleDays, config.halfLifeTradingDays);
    const pnlToleranceHKD = config.maxCapitalHKD * (config.weightPnlToleranceRatio || 0);
    const score = Math.max(totalPnlHKD + pnlToleranceHKD, 0) * decay;
    const key = symbolKey(view.symbol, view.market);
    const item: VoiceWeight = {
      researcherName: view.researcherName,
      symbol: view.symbol,
      market: view.market,
      stockName: view.stockName,
      totalPnlHKD,
      daysSinceLastConfidence,
      freshnessDecay: decay,
      score,
      weight: 0,
    };
    bySymbol.set(key, [...(bySymbol.get(key) || []), item]);
  });

  const weights: VoiceWeight[] = [];
  bySymbol.forEach((items) => {
    const totalScore = items.reduce((sum, item) => sum + item.score, 0);
    const equalWeight = items.length > 0 ? 1 / items.length : 0;
    items.forEach((item) => {
      weights.push({
        ...item,
        weight: totalScore > EPSILON ? item.score / totalScore : equalWeight,
      });
    });
  });
  return weights.sort((a, b) => `${a.symbol}-${b.weight}`.localeCompare(`${b.symbol}-${a.weight}`));
}

export function selectEffectiveViews(views: ResearcherView[], runDate: string): ResearcherView[] {
  const activeViews = views.filter((view) => view.status === 'active' && (!view.effectiveDate || view.effectiveDate <= runDate));
  const map = new Map<string, ResearcherView>();

  activeViews.forEach((view) => {
    const key = positionKey(view.researcherName, view.symbol, view.market);
    const existing = map.get(key);
    if (!existing) {
      map.set(key, view);
      return;
    }
    const existingDate = existing.effectiveDate || existing.updatedAt.slice(0, 10);
    const viewDate = view.effectiveDate || view.updatedAt.slice(0, 10);
    if (viewDate > existingDate || (viewDate === existingDate && (view.versionNo || 1) > (existing.versionNo || 1))) {
      map.set(key, view);
    }
  });

  return Array.from(map.values());
}

export function generateDailyTrades(params: {
  runId: string;
  runDate: string;
  config: PchipContestConfig;
  views: ResearcherView[];
  previousPositions: PositionSnapshot[];
  quotes: Record<string, MarketQuote>;
}): GeneratedTrade[] {
  const activeViews = selectEffectiveViews(params.views, params.runDate);
  const previousPositionMap = new Map(params.previousPositions.map((position) => [positionKey(position.researcherName, position.symbol, position.market), position]));
  const byResearcher = new Map<string, Array<{ view: ResearcherView; quote: MarketQuote; rawTargetValueHKD: number }>>();

  activeViews.forEach((view) => {
    const quote = params.quotes[symbolKey(view.symbol, view.market)];
    if (!quote || quote.close <= 0 || quote.fxToHKD <= 0) return;
    const rawTargetValueHKD = targetValueForPrice(view.points, quote.close, quote.fxToHKD);
    byResearcher.set(view.researcherName, [
      ...(byResearcher.get(view.researcherName) || []),
      { view, quote, rawTargetValueHKD },
    ]);
  });

  const trades: GeneratedTrade[] = [];
  byResearcher.forEach((items, researcherName) => {
    const totalRawTarget = items.reduce((sum, item) => sum + item.rawTargetValueHKD, 0);
    const scaleRatio = totalRawTarget > params.config.maxCapitalHKD && totalRawTarget > 0
      ? params.config.maxCapitalHKD / totalRawTarget
      : 1;
    const forcedByCapitalConstraint = scaleRatio < 1 - EPSILON;

    items.forEach(({ view, quote, rawTargetValueHKD }) => {
      const key = positionKey(researcherName, view.symbol, view.market);
      const previousShares = previousPositionMap.get(key)?.shares || 0;
      const finalTargetValueHKD = rawTargetValueHKD * scaleRatio;
      const targetShares = finalTargetValueHKD / (quote.close * quote.fxToHKD);
      const plannedTradeShares = targetShares - previousShares;
      const minTradeShares = normalizeMinTradeShares(view.minTradeShares);
      const roundedTradeShares = roundTradeSharesToLotSize(plannedTradeShares, minTradeShares);
      const plannedTradeValueHKD = roundedTradeShares * quote.close * quote.fxToHKD;
      const skipByMinTrade = Math.abs(plannedTradeValueHKD) < params.config.minTradeValueHKD && !forcedByCapitalConstraint;
      const tradeShares = skipByMinTrade ? 0 : roundedTradeShares;
      const tradeValueHKD = tradeShares * quote.close * quote.fxToHKD;
      const side = tradeShares > EPSILON ? 'BUY' : tradeShares < -EPSILON ? 'SELL' : 'NONE';
      const tradingCostHKD = side === 'NONE' ? 0 : calculateTradingFeeHKD({
        config: params.config,
        side,
        market: view.market,
        priceCurrency: quote.priceCurrency,
        tradeShares,
        tradePrice: quote.close,
        tradeValueHKD,
        fxToHKD: quote.fxToHKD,
      });
      const effectiveCostRate = Math.abs(tradeValueHKD) > EPSILON ? tradingCostHKD / Math.abs(tradeValueHKD) : 0;

      trades.push({
        runId: params.runId,
        date: params.runDate,
        researcherName,
        account: researcherName,
        symbol: view.symbol,
        code: view.symbol,
        market: view.market,
        stockName: view.stockName,
        name: view.stockName,
        source: 'PCHIP',
        close: quote.close,
        priceCurrency: quote.priceCurrency,
        fxToHKD: quote.fxToHKD,
        rawTargetValueHKD,
        scaleRatio,
        finalTargetValueHKD,
        previousShares,
        targetShares,
        minTradeShares,
        tradeShares,
        quantity: tradeShares,
        tradePrice: quote.close,
        price: side === 'BUY'
          ? quote.close + (Math.abs(tradeValueHKD) > EPSILON ? tradingCostHKD / Math.abs(tradeShares || 1) / quote.fxToHKD : 0)
          : quote.close - (Math.abs(tradeValueHKD) > EPSILON ? tradingCostHKD / Math.abs(tradeShares || 1) / quote.fxToHKD : 0),
        tradeValueHKD,
        amount: side === 'BUY'
          ? Math.abs(tradeValueHKD) + tradingCostHKD
          : side === 'SELL'
            ? -(Math.abs(tradeValueHKD) - tradingCostHKD)
            : 0,
        tradingCostRate: effectiveCostRate,
        tradingCostHKD,
        fee: tradingCostHKD,
        side,
        direction: side,
        skippedByMinTradeValue: skipByMinTrade,
        forcedByCapitalConstraint,
        viewId: view.id,
        executor: 'PCHIP模拟引擎',
        updatedAt: Date.now(),
      });
    });
  });
  return trades;
}

function calculateTradingFeeHKD(params: {
  config: PchipContestConfig;
  side: 'BUY' | 'SELL' | 'NONE';
  market: string;
  priceCurrency: PriceCurrency;
  tradeShares: number;
  tradePrice: number;
  tradeValueHKD: number;
  fxToHKD: number;
}): number {
  const grossValueHKD = Math.abs(params.tradeValueHKD);
  if (params.side === 'NONE' || grossValueHKD <= EPSILON) return 0;
  if ((params.config.feeMode || 'custom') === 'custom') {
    const fixed = Math.max(0, Number(params.config.customFixedFeeHKD ?? 0));
    const rate = Math.max(0, Number(params.config.customFeeRate ?? params.config.tradingCostRate ?? 0));
    return fixed + grossValueHKD * rate;
  }

  const market = String(params.market || params.priceCurrency || '').toUpperCase();
  const currency = String(params.priceCurrency || market || '').toUpperCase();
  const localValue = grossValueHKD / Math.max(params.fxToHKD, EPSILON);
  const shares = Math.abs(params.tradeShares);

  if (market === 'USD' || currency === 'USD') {
    const commissionUsd = Math.max(shares * 0.005, 1);
    const cappedUsd = Math.min(commissionUsd, localValue * 0.01);
    const sellRegFeeUsd = params.side === 'SELL' ? Math.max(localValue * 0.0000278, 0) + Math.max(shares * 0.000166, 0.01) : 0;
    return (cappedUsd + sellRegFeeUsd) * params.fxToHKD;
  }

  if (market === 'JPY' || currency === 'JPY') {
    const commissionJpy = Math.max(localValue * 0.0008, 80);
    const platformJpy = 180;
    return (commissionJpy + platformJpy) * params.fxToHKD;
  }

  if (market === 'CNY' || currency === 'CNY') {
    const commissionCny = Math.max(localValue * 0.0003, 5);
    const handlingCny = localValue * 0.0000487;
    const transferCny = localValue * 0.00002;
    const stampCny = params.config.includeStampDuty && params.side === 'SELL' ? localValue * 0.0005 : 0;
    return (commissionCny + handlingCny + transferCny + stampCny) * params.fxToHKD;
  }

  const commissionHkd = Math.max(localValue * 0.0003, 3);
  const platformHkd = 15;
  const tradingSystemHkd = 0.5;
  const settlementHkd = Math.min(Math.max(localValue * 0.00002, 2), 100);
  const stampHkd = params.config.includeStampDuty ? localValue * 0.001 : 0;
  return (commissionHkd + platformHkd + tradingSystemHkd + settlementHkd + stampHkd) * params.fxToHKD;
}

function getTradeAmountHKD(trade: SimulationTradeLedger): number {
  if (Number.isFinite(trade.amount) && Math.abs(trade.amount) > EPSILON) return trade.amount;
  if (trade.side === 'BUY') return Math.abs(trade.tradeValueHKD) + trade.tradingCostHKD;
  if (trade.side === 'SELL') return -(Math.abs(trade.tradeValueHKD) - trade.tradingCostHKD);
  return 0;
}

export function symbolKey(symbol: string, market: string): string {
  return `${symbol.trim().toUpperCase()}__${market.trim().toUpperCase()}`;
}

export function positionKey(researcherName: string, symbol: string, market: string): string {
  return `${researcherName.trim()}__${symbolKey(symbol, market)}`;
}
