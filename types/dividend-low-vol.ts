export type Numeric = number | null;

export type DividendLowVolExperiment = {
  experiment_id: string;
  version_name: string;
  display_name: string;
  experiment_note?: string | null;
  model_name: string;
  model_label: string;
  status: string;
  approved: boolean;
  created_at?: string | null;
  data_start?: string | null;
  data_end?: string | null;
  factor_weights: Record<string, number>;
  risk_settings: Record<string, unknown>;
  backtest_settings: Record<string, unknown>;
};

export type DividendLowVolMetrics = Record<string, Numeric>;

export type DividendLowVolBacktestPoint = {
  month_end: string;
  gross_return?: Numeric;
  transaction_cost?: Numeric;
  net_return?: Numeric;
  turnover?: Numeric;
  cash_weight?: Numeric;
  selected_count?: Numeric;
  entered_count?: Numeric;
  exited_count?: Numeric;
  entered_symbols?: string | null;
  exited_symbols?: string | null;
  retained_symbols?: string | null;
  net_value?: Numeric;
  gross_value?: Numeric;
  drawdown?: Numeric;
  hsi_value?: Numeric;
  hscei_value?: Numeric;
};

export type DividendLowVolHolding = {
  month_end: string;
  symbol: string;
  name?: string | null;
  sector?: string | null;
  model_score?: Numeric;
  target_weight?: Numeric;
  raw_weight?: Numeric;
  actual_return?: Numeric;
  contribution?: Numeric;
  factor_coverage?: Numeric;
  cash_weight?: Numeric;
  constraint_note?: string | null;
  rebalance_action?: string | null;
};

export type DividendLowVolSelection = {
  rank: number;
  symbol: string;
  name?: string | null;
  sector?: string | null;
  model_score?: Numeric;
  factor_coverage?: Numeric;
  target_weight?: Numeric;
  constraint_note?: string | null;
  signal_as_of?: string | null;
  latest_price?: Numeric;
  ma5?: Numeric;
  ma20?: Numeric;
  return_20d?: Numeric;
  trend_strength?: string | null;
  reference_ma?: string | null;
  reference_price?: Numeric;
  reference_low?: Numeric;
  reference_high?: Numeric;
  price_vs_reference?: Numeric;
  entry_guidance?: string | null;
};

export type DividendLowVolSummary = {
  factor_month_end?: string | null;
  candidate_count: number;
  selected_count: number;
  stock_weight: number;
  cash_weight: number;
  backtest_start?: string | null;
  backtest_end?: string | null;
};

export type DividendLowVolRankIcPoint = {
  month_end: string;
  rank_ic?: Numeric;
  valid_count?: Numeric;
  rolling_12m_ic?: Numeric;
};

export type DividendLowVolSnapshot = {
  schema_version: 1;
  published_at: string;
  source: 'hk-dividend-low-vol-lab';
  experiment: DividendLowVolExperiment;
  metrics: DividendLowVolMetrics;
  summary: DividendLowVolSummary;
  backtest_monthly: DividendLowVolBacktestPoint[];
  backtest_holdings: DividendLowVolHolding[];
  latest_selection: DividendLowVolSelection[];
  rank_ic_monthly: DividendLowVolRankIcPoint[];
};

export type DividendLowVolVersion = {
  experiment_id: string;
  display_name: string;
  version_name: string;
  model_label: string;
  approved: boolean;
  status: string;
  published_at: string;
  received_at?: string | null;
  factor_month_end?: string | null;
};

export type DividendLowVolApiResponse = {
  ok: boolean;
  snapshot?: DividendLowVolSnapshot;
  versions?: DividendLowVolVersion[];
  error?: string;
  error_code?: 'storage_quota_exhausted' | 'storage_unavailable' | 'unknown';
  warning?: string;
  stale?: boolean;
};
