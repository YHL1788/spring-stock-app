export type TradeDirection = 'BUY' | 'SELL';
export type HoldingSide = 'LONG' | 'SHORT' | 'FLAT';

export interface AverageCostInitialHolding {
  code: string;
  market: string;
  account: string;
  quantity: number;
  costPrice: number;
}

export interface AverageCostTrade {
  id?: string;
  date: string;
  account: string;
  market: string;
  code: string;
  name?: string;
  direction: TradeDirection;
  quantity: number;
  price: number;
  amount: number;
  fee?: number;
  updatedAt?: number;
  executor?: string;
}

export interface AverageCostQuote {
  price: number;
  changePercent?: number;
}

export interface AverageCostStockInfo {
  symbol: string;
  name?: string;
  sector_level_1?: string;
  sector_level_2?: string;
}

export interface AverageCostHolding {
  market: string;
  code: string;
  name: string;
  sector_level_1: string;
  sector_level_2: string;
  quantity: number;
  side: HoldingSide;
  avgCost: number;
  totalCostHKD: number;
  currentPrice: number;
  dailyChangePct: number;
  mktValHKD: number;
  grossExposureHKD: number;
  unrealizedPnlHKD: number;
  realizedPnlHKD: number;
  unrealizedPnlLocal: number;
  realizedPnlLocal: number;
  pnlRatio: number;
  accounts: Record<string, number>;
}

export interface AverageCostWarning {
  code: string;
  tradeId?: string;
  date?: string;
  message: string;
}

export interface CalculateAverageCostInput {
  initialHoldings: AverageCostInitialHolding[];
  trades: AverageCostTrade[];
  quotes?: Record<string, AverageCostQuote>;
  fxRates?: Record<string, number>;
  stockPool?: AverageCostStockInfo[];
}

export interface CalculateAverageCostResult {
  holdings: AverageCostHolding[];
  warnings: AverageCostWarning[];
}

type MutableHolding = AverageCostHolding;

const EPSILON = 0.0000001;

const toFiniteNumber = (value: unknown, fallback = 0) => {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
};

const sameSign = (left: number, right: number) => {
  if (Math.abs(left) < EPSILON || Math.abs(right) < EPSILON) return false;
  return Math.sign(left) === Math.sign(right);
};

const getSide = (quantity: number): HoldingSide => {
  if (quantity > EPSILON) return 'LONG';
  if (quantity < -EPSILON) return 'SHORT';
  return 'FLAT';
};

const getTradeSignedQuantity = (trade: AverageCostTrade) => {
  const quantityAbs = Math.abs(toFiniteNumber(trade.quantity));
  return trade.direction === 'BUY' ? quantityAbs : -quantityAbs;
};

const getTradePrice = (trade: AverageCostTrade) => {
  const quantityAbs = Math.abs(toFiniteNumber(trade.quantity));
  const amountAbs = Math.abs(toFiniteNumber(trade.amount));
  if (quantityAbs > EPSILON && amountAbs > EPSILON) return amountAbs / quantityAbs;

  const price = toFiniteNumber(trade.price);
  return price > 0 ? price : 0;
};

const buildStockMap = (stockPool: AverageCostStockInfo[] = []) => {
  const map = new Map<string, AverageCostStockInfo>();
  stockPool.forEach((item) => {
    if (item.symbol) map.set(item.symbol.toUpperCase(), item);
  });
  return map;
};

const createHolding = (
  code: string,
  market: string,
  name: string | undefined,
  stockMap: Map<string, AverageCostStockInfo>,
): MutableHolding => {
  const stockInfo = stockMap.get(code.toUpperCase());
  return {
    market,
    code,
    name: stockInfo?.name || name || code,
    sector_level_1: stockInfo?.sector_level_1 || '未知',
    sector_level_2: stockInfo?.sector_level_2 || '未知',
    quantity: 0,
    side: 'FLAT',
    avgCost: 0,
    totalCostHKD: 0,
    currentPrice: 0,
    dailyChangePct: 0,
    mktValHKD: 0,
    grossExposureHKD: 0,
    unrealizedPnlHKD: 0,
    realizedPnlHKD: 0,
    unrealizedPnlLocal: 0,
    realizedPnlLocal: 0,
    pnlRatio: 0,
    accounts: {},
  };
};

const addAccountQuantity = (holding: MutableHolding, account: string, signedQuantity: number) => {
  if (!account) return;
  holding.accounts[account] = (holding.accounts[account] || 0) + signedQuantity;
};

const addSameSidePosition = (holding: MutableHolding, signedQuantity: number, price: number) => {
  const currentAbsQty = Math.abs(holding.quantity);
  const addAbsQty = Math.abs(signedQuantity);
  const nextAbsQty = currentAbsQty + addAbsQty;

  if (nextAbsQty <= EPSILON) {
    holding.quantity = 0;
    holding.avgCost = 0;
    holding.side = 'FLAT';
    return;
  }

  holding.avgCost = ((currentAbsQty * holding.avgCost) + (addAbsQty * price)) / nextAbsQty;
  holding.quantity += signedQuantity;
  holding.side = getSide(holding.quantity);
};

const closeOppositePosition = (
  holding: MutableHolding,
  signedQuantity: number,
  price: number,
  fxRate: number,
) => {
  const existingQuantity = holding.quantity;
  const closeQty = Math.min(Math.abs(existingQuantity), Math.abs(signedQuantity));
  const existingSide = getSide(existingQuantity);

  if (existingSide === 'LONG') {
    const realized = closeQty * (price - holding.avgCost);
    holding.realizedPnlLocal += realized;
    holding.realizedPnlHKD += realized * fxRate;
  } else if (existingSide === 'SHORT') {
    const realized = closeQty * (holding.avgCost - price);
    holding.realizedPnlLocal += realized;
    holding.realizedPnlHKD += realized * fxRate;
  }

  const remainingExistingAbs = Math.abs(existingQuantity) - closeQty;
  const remainingTradeAbs = Math.abs(signedQuantity) - closeQty;

  if (remainingExistingAbs <= EPSILON) {
    holding.quantity = 0;
    holding.avgCost = 0;
    holding.side = 'FLAT';
  } else {
    holding.quantity = Math.sign(existingQuantity) * remainingExistingAbs;
    holding.side = getSide(holding.quantity);
  }

  if (remainingTradeAbs > EPSILON) {
    const newSignedQuantity = Math.sign(signedQuantity) * remainingTradeAbs;
    holding.quantity = newSignedQuantity;
    holding.avgCost = price;
    holding.side = getSide(holding.quantity);
  }
};

const applySignedPositionChange = (
  holding: MutableHolding,
  signedQuantity: number,
  price: number,
  fxRate: number,
) => {
  if (Math.abs(signedQuantity) <= EPSILON) return;

  if (Math.abs(holding.quantity) <= EPSILON || sameSign(holding.quantity, signedQuantity)) {
    addSameSidePosition(holding, signedQuantity, price);
    return;
  }

  closeOppositePosition(holding, signedQuantity, price, fxRate);
};

export const calculateAverageCostHoldings = ({
  initialHoldings,
  trades,
  quotes = {},
  fxRates = { HKD: 1 },
  stockPool = [],
}: CalculateAverageCostInput): CalculateAverageCostResult => {
  const stockMap = buildStockMap(stockPool);
  const holdingsMap: Record<string, MutableHolding> = {};
  const warnings: AverageCostWarning[] = [];

  const ensureHolding = (code: string, market: string, name?: string) => {
    if (!holdingsMap[code]) {
      holdingsMap[code] = createHolding(code, market, name, stockMap);
    }
    return holdingsMap[code];
  };

  initialHoldings.forEach((initial) => {
    const code = initial.code;
    const quantity = toFiniteNumber(initial.quantity);
    const price = toFiniteNumber(initial.costPrice);
    if (!code || Math.abs(quantity) <= EPSILON) return;

    const holding = ensureHolding(code, initial.market, code);
    addAccountQuantity(holding, initial.account, quantity);
    applySignedPositionChange(holding, quantity, price, fxRates[initial.market] || 1);
  });

  const chronologicalTrades = [...trades].sort((left, right) => {
    const leftTime = new Date(left.date).getTime() || 0;
    const rightTime = new Date(right.date).getTime() || 0;
    return leftTime - rightTime;
  });

  chronologicalTrades.forEach((trade) => {
    const code = trade.code;
    if (!code) return;

    const signedQuantity = getTradeSignedQuantity(trade);
    const price = getTradePrice(trade);
    if (Math.abs(signedQuantity) <= EPSILON) return;

    if (price <= EPSILON) {
      warnings.push({
        code,
        tradeId: trade.id,
        date: trade.date,
        message: '交易价格为 0，已跳过该笔交易',
      });
      return;
    }

    const holding = ensureHolding(code, trade.market, trade.name);
    const fxRate = fxRates[trade.market] || 1;
    addAccountQuantity(holding, trade.account, signedQuantity);
    applySignedPositionChange(holding, signedQuantity, price, fxRate);
  });

  const holdings = Object.values(holdingsMap).map((holding) => {
    const fxRate = fxRates[holding.market] || 1;
    const quote = quotes[holding.code];
    const currentPrice = quote?.price || holding.avgCost;
    const marketValueLocal = holding.quantity * currentPrice;
    const totalCostLocal = holding.quantity * holding.avgCost;
    const unrealizedPnlLocal = holding.quantity * (currentPrice - holding.avgCost);
    const totalCostHKD = totalCostLocal * fxRate;
    const mktValHKD = marketValueLocal * fxRate;
    const unrealizedPnlHKD = unrealizedPnlLocal * fxRate;
    const grossExposureHKD = Math.abs(mktValHKD);
    const costBaseHKD = Math.abs(totalCostHKD);

    return {
      ...holding,
      side: getSide(holding.quantity),
      currentPrice,
      dailyChangePct: quote?.changePercent || 0,
      totalCostHKD,
      mktValHKD,
      grossExposureHKD,
      unrealizedPnlLocal,
      unrealizedPnlHKD,
      pnlRatio: costBaseHKD > EPSILON ? unrealizedPnlHKD / costBaseHKD : 0,
    };
  });

  return {
    holdings: holdings.filter((holding) => Math.abs(holding.quantity) > EPSILON || Math.abs(holding.realizedPnlHKD) > EPSILON),
    warnings,
  };
};
