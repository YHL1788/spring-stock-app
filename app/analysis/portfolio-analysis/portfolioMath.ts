export type PricePoint = {
  date: string;
  close: number;
  adjClose?: number;
};

export type AssetSeries = {
  symbol: string;
  currency?: string;
  prices: PricePoint[];
};

export type AssetMetrics = {
  symbol: string;
  observations: number;
  totalReturn: number;
  annualizedReturn: number;
  annualizedVolatility: number;
  sharpe: number | null;
  maxDrawdown: number;
  skewness: number | null;
  excessKurtosis: number | null;
  historicalVar95: number | null;
  beta: number | null;
  alphaAnnualized: number | null;
};

export type RelativeValueResult = {
  observations: number;
  correlation: number | null;
  alpha: number;
  hedgeRatio: number;
  latestSpread: number | null;
  latestZScore: number | null;
  halfLife: number | null;
  adfTStatistic: number | null;
  adfIndicativeStationary: boolean;
  chart: Array<{
    date: string;
    normalizedA: number;
    normalizedB: number;
    spread: number;
    zScore: number | null;
  }>;
};

export type FactorDefinition = {
  key: string;
  name: string;
  longSymbol: string;
  shortSymbol?: string;
};

export type FactorExposure = {
  key: string;
  name: string;
  beta: number;
  contribution: number;
};

export type FactorAnalysisResult = {
  observations: number;
  alphaAnnualized: number | null;
  rSquared: number | null;
  residualVolatility: number | null;
  portfolioAnnualizedReturn: number | null;
  exposures: FactorExposure[];
  rollingChart: Array<Record<string, string | number | null>>;
  contributionChart: Array<{
    name: string;
    value: number;
    type: 'factor' | 'alpha' | 'residual';
  }>;
  cumulativeChart: Array<Record<string, string | number>>;
};

const TRADING_DAYS = 252;

function finite(values: number[]) {
  return values.filter(Number.isFinite);
}

function mean(values: number[]) {
  const clean = finite(values);
  return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : 0;
}

function variance(values: number[], sample = true) {
  const clean = finite(values);
  if (clean.length < (sample ? 2 : 1)) return 0;
  const avg = mean(clean);
  const divisor = sample ? clean.length - 1 : clean.length;
  return clean.reduce((sum, value) => sum + (value - avg) ** 2, 0) / divisor;
}

function stdDev(values: number[], sample = true) {
  return Math.sqrt(Math.max(variance(values, sample), 0));
}

function covariance(left: number[], right: number[]) {
  const size = Math.min(left.length, right.length);
  if (size < 2) return 0;
  const x = left.slice(0, size);
  const y = right.slice(0, size);
  const xMean = mean(x);
  const yMean = mean(y);
  return x.reduce((sum, value, index) => (
    sum + (value - xMean) * (y[index] - yMean)
  ), 0) / (size - 1);
}

export function correlation(left: number[], right: number[]) {
  const denominator = stdDev(left) * stdDev(right);
  return denominator > 0 ? covariance(left, right) / denominator : null;
}

function quantile(values: number[], probability: number) {
  const clean = finite(values).sort((a, b) => a - b);
  if (!clean.length) return null;
  const position = (clean.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return clean[lower];
  return clean[lower] + (clean[upper] - clean[lower]) * (position - lower);
}

function usablePrice(point: PricePoint) {
  const value = Number(point.adjClose ?? point.close);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function sanitizeSeries(series: AssetSeries): AssetSeries {
  const byDate = new Map<string, PricePoint>();
  series.prices.forEach(point => {
    const value = usablePrice(point);
    if (point.date && value !== null) {
      byDate.set(point.date, { date: point.date, close: value, adjClose: value });
    }
  });
  return {
    ...series,
    symbol: series.symbol.trim().toUpperCase(),
    prices: Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date)),
  };
}

export function dailyReturns(series: AssetSeries) {
  const clean = sanitizeSeries(series);
  return clean.prices.slice(1).map((point, index) => {
    const previous = usablePrice(clean.prices[index]);
    const current = usablePrice(point);
    return {
      date: point.date,
      value: previous && current ? current / previous - 1 : 0,
    };
  }).filter(point => Number.isFinite(point.value));
}

function alignReturnPair(left: AssetSeries, right: AssetSeries) {
  const cleanLeft = sanitizeSeries(left);
  const cleanRight = sanitizeSeries(right);
  const rightMap = new Map(cleanRight.prices.map(point => [point.date, usablePrice(point) as number]));
  const alignedPrices = cleanLeft.prices
    .filter(point => rightMap.has(point.date))
    .map(point => ({
      date: point.date,
      left: usablePrice(point) as number,
      right: rightMap.get(point.date) as number,
    }));

  return alignedPrices.slice(1).map((point, index) => ({
    date: point.date,
    left: point.left / alignedPrices[index].left - 1,
    right: point.right / alignedPrices[index].right - 1,
  }));
}

function maxDrawdown(prices: number[]) {
  let peak = -Infinity;
  let worst = 0;
  prices.forEach(price => {
    peak = Math.max(peak, price);
    if (peak > 0) worst = Math.min(worst, price / peak - 1);
  });
  return worst;
}

function skewness(values: number[]) {
  const clean = finite(values);
  if (clean.length < 3) return null;
  const avg = mean(clean);
  const sd = stdDev(clean, false);
  if (!sd) return null;
  return mean(clean.map(value => ((value - avg) / sd) ** 3));
}

function excessKurtosis(values: number[]) {
  const clean = finite(values);
  if (clean.length < 4) return null;
  const avg = mean(clean);
  const sd = stdDev(clean, false);
  if (!sd) return null;
  return mean(clean.map(value => ((value - avg) / sd) ** 4)) - 3;
}

export function calculateAssetMetrics(
  series: AssetSeries,
  riskFreeRate = 0,
  benchmark?: AssetSeries,
): AssetMetrics {
  const clean = sanitizeSeries(series);
  const prices = clean.prices.map(point => usablePrice(point) as number);
  const returns = dailyReturns(clean).map(point => point.value);
  const years = returns.length / TRADING_DAYS;
  const totalReturn = prices.length > 1 ? prices[prices.length - 1] / prices[0] - 1 : 0;
  const annualizedReturn = years > 0 && totalReturn > -1
    ? (1 + totalReturn) ** (1 / years) - 1
    : 0;
  const annualizedVolatility = stdDev(returns) * Math.sqrt(TRADING_DAYS);
  const sharpe = annualizedVolatility > 0
    ? (annualizedReturn - riskFreeRate) / annualizedVolatility
    : null;

  let beta: number | null = null;
  let alphaAnnualized: number | null = null;
  if (benchmark && benchmark.symbol !== series.symbol) {
    const pair = alignReturnPair(clean, benchmark);
    if (pair.length >= 20) {
      const assetReturns = pair.map(item => item.left);
      const benchmarkReturns = pair.map(item => item.right);
      const benchmarkVariance = variance(benchmarkReturns);
      if (benchmarkVariance > 0) {
        beta = covariance(assetReturns, benchmarkReturns) / benchmarkVariance;
        alphaAnnualized = (mean(assetReturns) - beta * mean(benchmarkReturns)) * TRADING_DAYS;
      }
    }
  }

  return {
    symbol: clean.symbol,
    observations: returns.length,
    totalReturn,
    annualizedReturn,
    annualizedVolatility,
    sharpe,
    maxDrawdown: maxDrawdown(prices),
    skewness: skewness(returns),
    excessKurtosis: excessKurtosis(returns),
    historicalVar95: quantile(returns, 0.05),
    beta,
    alphaAnnualized,
  };
}

export function buildNormalizedChart(seriesList: AssetSeries[]) {
  const maps = seriesList.map(series => {
    const clean = sanitizeSeries(series);
    const first = usablePrice(clean.prices[0]);
    return new Map(clean.prices.map(point => [
      point.date,
      first ? ((usablePrice(point) as number) / first) * 100 : 100,
    ]));
  });
  const dates = Array.from(new Set(maps.flatMap(map => Array.from(map.keys())))).sort();
  return dates.map(date => {
    const row: Record<string, string | number | null> = { date };
    seriesList.forEach((series, index) => {
      row[series.symbol] = maps[index].get(date) ?? null;
    });
    return row;
  });
}

export function buildDrawdownChart(seriesList: AssetSeries[]) {
  const maps = seriesList.map(series => {
    const clean = sanitizeSeries(series);
    let peak = -Infinity;
    return new Map(clean.prices.map(point => {
      const price = usablePrice(point) as number;
      peak = Math.max(peak, price);
      return [point.date, peak > 0 ? (price / peak - 1) * 100 : 0];
    }));
  });
  const dates = Array.from(new Set(maps.flatMap(map => Array.from(map.keys())))).sort();
  return dates.map(date => {
    const row: Record<string, string | number | null> = { date };
    seriesList.forEach((series, index) => {
      row[series.symbol] = maps[index].get(date) ?? null;
    });
    return row;
  });
}

export function buildCorrelationMatrix(seriesList: AssetSeries[]) {
  return seriesList.map(left => seriesList.map(right => {
    if (left.symbol === right.symbol) return 1;
    const pair = alignReturnPair(left, right);
    return pair.length >= 3
      ? correlation(pair.map(item => item.left), pair.map(item => item.right))
      : null;
  }));
}

function linearRegression(x: number[], y: number[]) {
  const size = Math.min(x.length, y.length);
  const cleanX = x.slice(0, size);
  const cleanY = y.slice(0, size);
  const xVariance = variance(cleanX);
  const slope = xVariance > 0 ? covariance(cleanX, cleanY) / xVariance : 0;
  const intercept = mean(cleanY) - slope * mean(cleanX);
  return { intercept, slope };
}

function rollingZScore(values: number[], window: number) {
  return values.map((value, index) => {
    const start = Math.max(0, index - window + 1);
    const sample = values.slice(start, index + 1);
    if (sample.length < Math.min(window, 20)) return null;
    const sd = stdDev(sample);
    return sd > 0 ? (value - mean(sample)) / sd : null;
  });
}

function calculateHalfLife(spread: number[]) {
  if (spread.length < 20) return null;
  const lagged = spread.slice(0, -1);
  const changes = spread.slice(1).map((value, index) => value - lagged[index]);
  const { slope } = linearRegression(lagged, changes);
  if (!Number.isFinite(slope) || slope >= 0) return null;
  const halfLife = -Math.log(2) / slope;
  return Number.isFinite(halfLife) && halfLife > 0 ? halfLife : null;
}

// A compact no-lag Dickey-Fuller diagnostic. It is intentionally labelled
// "indicative" in the UI because production ADF tests should select lag order.
function approximateAdf(spread: number[]) {
  if (spread.length < 30) return null;
  const lagged = spread.slice(0, -1);
  const changes = spread.slice(1).map((value, index) => value - lagged[index]);
  const { intercept, slope } = linearRegression(lagged, changes);
  const residuals = changes.map((value, index) => value - intercept - slope * lagged[index]);
  const xMean = mean(lagged);
  const sumSquaresX = lagged.reduce((sum, value) => sum + (value - xMean) ** 2, 0);
  if (sumSquaresX <= 0 || residuals.length <= 2) return null;
  const residualVariance = residuals.reduce((sum, value) => sum + value ** 2, 0) / (residuals.length - 2);
  const standardError = Math.sqrt(residualVariance / sumSquaresX);
  return standardError > 0 ? slope / standardError : null;
}

export function calculateRelativeValue(
  assetA: AssetSeries,
  assetB: AssetSeries,
  zWindow = 60,
): RelativeValueResult {
  const a = sanitizeSeries(assetA);
  const b = sanitizeSeries(assetB);
  const bMap = new Map(b.prices.map(point => [point.date, usablePrice(point) as number]));
  const aligned = a.prices
    .filter(point => bMap.has(point.date))
    .map(point => ({
      date: point.date,
      priceA: usablePrice(point) as number,
      priceB: bMap.get(point.date) as number,
    }));

  if (aligned.length < 2) {
    return {
      observations: aligned.length,
      correlation: null,
      alpha: 0,
      hedgeRatio: 0,
      latestSpread: null,
      latestZScore: null,
      halfLife: null,
      adfTStatistic: null,
      adfIndicativeStationary: false,
      chart: [],
    };
  }

  const logA = aligned.map(item => Math.log(item.priceA));
  const logB = aligned.map(item => Math.log(item.priceB));
  const regression = linearRegression(logB, logA);
  const spread = logA.map((value, index) => value - regression.intercept - regression.slope * logB[index]);
  const zScores = rollingZScore(spread, Math.max(20, zWindow));
  const returnsA = aligned.slice(1).map((item, index) => item.priceA / aligned[index].priceA - 1);
  const returnsB = aligned.slice(1).map((item, index) => item.priceB / aligned[index].priceB - 1);
  const firstA = aligned[0].priceA;
  const firstB = aligned[0].priceB;
  const adfTStatistic = approximateAdf(spread);

  return {
    observations: aligned.length,
    correlation: correlation(returnsA, returnsB),
    alpha: regression.intercept,
    hedgeRatio: regression.slope,
    latestSpread: spread[spread.length - 1],
    latestZScore: zScores[zScores.length - 1],
    halfLife: calculateHalfLife(spread),
    adfTStatistic,
    adfIndicativeStationary: adfTStatistic !== null && adfTStatistic < -2.86,
    chart: aligned.map((item, index) => ({
      date: item.date,
      normalizedA: (item.priceA / firstA) * 100,
      normalizedB: (item.priceB / firstB) * 100,
      spread: spread[index],
      zScore: zScores[index],
    })),
  };
}

function solveLinearSystem(matrix: number[][], vector: number[]) {
  const size = vector.length;
  const augmented = matrix.map((row, index) => [...row, vector[index]]);

  for (let column = 0; column < size; column += 1) {
    let pivotRow = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivotRow][column])) {
        pivotRow = row;
      }
    }
    if (Math.abs(augmented[pivotRow][column]) < 1e-12) return null;
    [augmented[column], augmented[pivotRow]] = [augmented[pivotRow], augmented[column]];

    const pivot = augmented[column][column];
    for (let index = column; index <= size; index += 1) {
      augmented[column][index] /= pivot;
    }

    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = augmented[row][column];
      for (let index = column; index <= size; index += 1) {
        augmented[row][index] -= factor * augmented[column][index];
      }
    }
  }

  return augmented.map(row => row[size]);
}

function multipleRegression(features: number[][], target: number[]) {
  const rows = Math.min(features.length, target.length);
  const factorCount = features[0]?.length ?? 0;
  if (rows <= factorCount + 2 || factorCount === 0) return null;

  const design = features.slice(0, rows).map(row => [1, ...row]);
  const y = target.slice(0, rows);
  const width = factorCount + 1;
  const xtx = Array.from({ length: width }, () => Array(width).fill(0));
  const xty = Array(width).fill(0);

  design.forEach((row, rowIndex) => {
    for (let left = 0; left < width; left += 1) {
      xty[left] += row[left] * y[rowIndex];
      for (let right = 0; right < width; right += 1) {
        xtx[left][right] += row[left] * row[right];
      }
    }
  });

  // A tiny ridge term stabilizes highly correlated ETF proxy factors without
  // materially changing ordinary least-squares estimates.
  for (let index = 1; index < width; index += 1) xtx[index][index] += 1e-10;
  const coefficients = solveLinearSystem(xtx, xty);
  if (!coefficients) return null;

  const fitted = design.map(row => row.reduce(
    (sum, value, index) => sum + value * coefficients[index],
    0,
  ));
  const residuals = y.map((value, index) => value - fitted[index]);
  const targetMean = mean(y);
  const totalSquares = y.reduce((sum, value) => sum + (value - targetMean) ** 2, 0);
  const residualSquares = residuals.reduce((sum, value) => sum + value ** 2, 0);

  return {
    intercept: coefficients[0],
    betas: coefficients.slice(1),
    fitted,
    residuals,
    rSquared: totalSquares > 0 ? 1 - residualSquares / totalSquares : null,
  };
}

function alignedPriceRows(seriesList: AssetSeries[]) {
  if (!seriesList.length) return [];
  const clean = seriesList.map(sanitizeSeries);
  const maps = clean.map(series => new Map(
    series.prices.map(point => [point.date, usablePrice(point) as number]),
  ));
  const dates = Array.from(maps[0].keys())
    .filter(date => maps.every(map => map.has(date)))
    .sort();
  return dates.map(date => ({
    date,
    prices: maps.map(map => map.get(date) as number),
  }));
}

export function calculateFactorAnalysis(
  portfolioSeries: AssetSeries[],
  weights: number[],
  factorSeries: AssetSeries[],
  factors: FactorDefinition[],
  riskFreeRate = 0,
  rollingWindow = 60,
): FactorAnalysisResult {
  const empty: FactorAnalysisResult = {
    observations: 0,
    alphaAnnualized: null,
    rSquared: null,
    residualVolatility: null,
    portfolioAnnualizedReturn: null,
    exposures: [],
    rollingChart: [],
    contributionChart: [],
    cumulativeChart: [],
  };
  if (!portfolioSeries.length || !factors.length) return empty;

  const symbolsNeeded = Array.from(new Set(factors.flatMap(factor => (
    factor.shortSymbol ? [factor.longSymbol, factor.shortSymbol] : [factor.longSymbol]
  ))));
  const factorMap = new Map(factorSeries.map(series => [series.symbol, series]));
  if (symbolsNeeded.some(symbol => !factorMap.has(symbol))) return empty;

  const allSeries = [
    ...portfolioSeries,
    ...symbolsNeeded.map(symbol => factorMap.get(symbol) as AssetSeries),
  ];
  const rows = alignedPriceRows(allSeries);
  if (rows.length < Math.max(30, factors.length + 5)) return empty;

  const rawWeights = portfolioSeries.map((_, index) => Number(weights[index]) || 0);
  const weightTotal = rawWeights.reduce((sum, value) => sum + value, 0);
  const normalizedWeights = weightTotal !== 0
    ? rawWeights.map(value => value / weightTotal)
    : rawWeights.map(() => 1 / rawWeights.length);
  const factorSymbolIndex = new Map(symbolsNeeded.map((symbol, index) => [
    symbol,
    portfolioSeries.length + index,
  ]));
  const dailyRiskFree = riskFreeRate / TRADING_DAYS;

  const observations = rows.slice(1).map((row, rowIndex) => {
    const previous = rows[rowIndex];
    const portfolioReturn = normalizedWeights.reduce((sum, weight, index) => (
      sum + weight * (row.prices[index] / previous.prices[index] - 1)
    ), 0);
    const factorReturns = factors.map(factor => {
      const longIndex = factorSymbolIndex.get(factor.longSymbol) as number;
      const longReturn = row.prices[longIndex] / previous.prices[longIndex] - 1;
      if (!factor.shortSymbol) {
        return factor.key === 'market' ? longReturn - dailyRiskFree : longReturn;
      }
      const shortIndex = factorSymbolIndex.get(factor.shortSymbol) as number;
      const shortReturn = row.prices[shortIndex] / previous.prices[shortIndex] - 1;
      return longReturn - shortReturn;
    });
    return {
      date: row.date,
      portfolioReturn,
      excessReturn: portfolioReturn - dailyRiskFree,
      factorReturns,
    };
  });

  const regression = multipleRegression(
    observations.map(item => item.factorReturns),
    observations.map(item => item.excessReturn),
  );
  if (!regression) return empty;

  const years = observations.length / TRADING_DAYS;
  const compoundedReturn = observations.reduce(
    (value, item) => value * (1 + item.portfolioReturn),
    1,
  ) - 1;
  const portfolioAnnualizedReturn = years > 0 && compoundedReturn > -1
    ? (1 + compoundedReturn) ** (1 / years) - 1
    : null;
  const factorContributions = factors.map((factor, factorIndex) => ({
    key: factor.key,
    name: factor.name,
    beta: regression.betas[factorIndex],
    contribution: observations.reduce((sum, item) => (
      sum + regression.betas[factorIndex] * item.factorReturns[factorIndex]
    ), 0),
  }));
  const alphaContribution = regression.intercept * observations.length;
  const residualContribution = regression.residuals.reduce((sum, value) => sum + value, 0);

  const rollingChart: Array<Record<string, string | number | null>> = [];
  const window = Math.max(factors.length + 5, rollingWindow);
  for (let end = window; end <= observations.length; end += 1) {
    const sample = observations.slice(end - window, end);
    const rolling = multipleRegression(
      sample.map(item => item.factorReturns),
      sample.map(item => item.excessReturn),
    );
    if (!rolling) continue;
    const point: Record<string, string | number | null> = { date: observations[end - 1].date };
    factors.forEach((factor, index) => {
      point[factor.name] = rolling.betas[index] ?? null;
    });
    rollingChart.push(point);
  }

  const cumulative: Record<string, number> = {};
  factors.forEach(factor => { cumulative[factor.name] = 0; });
  cumulative.Alpha = 0;
  cumulative['特异收益'] = 0;
  const cumulativeChart = observations.map((item, index) => {
    factors.forEach((factor, factorIndex) => {
      cumulative[factor.name] += regression.betas[factorIndex] * item.factorReturns[factorIndex];
    });
    cumulative.Alpha += regression.intercept;
    cumulative['特异收益'] += regression.residuals[index];
    return { date: item.date, ...cumulative };
  });

  return {
    observations: observations.length,
    alphaAnnualized: regression.intercept * TRADING_DAYS,
    rSquared: regression.rSquared,
    residualVolatility: stdDev(regression.residuals) * Math.sqrt(TRADING_DAYS),
    portfolioAnnualizedReturn,
    exposures: factorContributions,
    rollingChart,
    contributionChart: [
      ...factorContributions.map(item => ({
        name: item.name,
        value: item.contribution,
        type: 'factor' as const,
      })),
      { name: 'Alpha', value: alphaContribution, type: 'alpha' as const },
      { name: '特异收益', value: residualContribution, type: 'residual' as const },
    ],
    cumulativeChart,
  };
}
