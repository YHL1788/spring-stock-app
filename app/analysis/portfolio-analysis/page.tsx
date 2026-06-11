"use client";

import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowRightLeft,
  BarChart3,
  CalendarDays,
  ChevronRight,
  CircleAlert,
  Gauge,
  Loader2,
  Orbit,
  Plus,
  RefreshCw,
  SlidersHorizontal,
  Sigma,
  Sparkles,
  TrendingDown,
  TrendingUp,
  X,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useStockPool } from '@/app/hooks/useStockPool';
import {
  AssetMetrics,
  AssetSeries,
  FactorAnalysisResult,
  FactorDefinition,
  buildCorrelationMatrix,
  buildDrawdownChart,
  buildNormalizedChart,
  calculateAssetMetrics,
  calculateFactorAnalysis,
  calculateRelativeValue,
} from './portfolioMath';

type TabKey = 'multi' | 'relative' | 'factor';

const COLORS = ['#0f766e', '#ea580c', '#0369a1', '#ca8a04', '#be123c', '#4d7c0f'];
const DEFAULT_MULTI = ['SPY', 'QQQ', 'GLD'];
const FACTOR_COLORS = ['#0f766e', '#0369a1', '#be123c', '#ca8a04', '#ea580c', '#4d7c0f'];
const FACTOR_DEFINITIONS: FactorDefinition[] = [
  { key: 'market', name: '股票市场', longSymbol: 'SPY' },
  { key: 'duration', name: '利率久期', longSymbol: 'TLT' },
  { key: 'credit', name: '信用风险', longSymbol: 'HYG', shortSymbol: 'IEF' },
  { key: 'dollar', name: '美元', longSymbol: 'UUP' },
  { key: 'commodity', name: '商品', longSymbol: 'DBC' },
  { key: 'momentum', name: '动量风格', longSymbol: 'MTUM', shortSymbol: 'SPY' },
];

function dateOffset(years: number) {
  const date = new Date();
  date.setFullYear(date.getFullYear() - years);
  return date.toISOString().slice(0, 10);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeSymbol(value: string) {
  return value.trim().toUpperCase();
}

function formatPercent(value: number | null, digits = 2) {
  if (value === null || !Number.isFinite(value)) return '--';
  return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(digits)}%`;
}

function formatNumber(value: number | null, digits = 2) {
  if (value === null || !Number.isFinite(value)) return '--';
  return value.toFixed(digits);
}

function compactDate(value: string) {
  return value?.slice(0, 10) || value;
}

function formatTooltipDate(value: React.ReactNode) {
  return compactDate(String(value ?? ''));
}

async function fetchAssetSeries(symbol: string, from: string, to: string): Promise<AssetSeries> {
  const response = await fetch(
    `/api/history?symbol=${encodeURIComponent(symbol)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    { cache: 'no-store' },
  );
  const payload = await response.json();
  if (!response.ok || !Array.isArray(payload?.data)) {
    throw new Error(`${symbol}: ${payload?.error || '历史行情读取失败'}`);
  }
  return {
    symbol: normalizeSymbol(payload.symbol || symbol),
    currency: payload.currency,
    prices: payload.data.map((item: any) => ({
      date: String(item.date),
      close: Number(item.close),
      adjClose: Number(item.adjClose ?? item.close),
    })),
  };
}

export default function PortfolioAnalysisPage() {
  const { stocks: stockPool, loading: stockPoolLoading } = useStockPool();
  const [activeTab, setActiveTab] = useState<TabKey>('multi');
  const [fromDate, setFromDate] = useState(dateOffset(2));
  const [toDate, setToDate] = useState(today());
  const [riskFreeRate, setRiskFreeRate] = useState(0);

  const [multiSymbols, setMultiSymbols] = useState(DEFAULT_MULTI);
  const [multiInput, setMultiInput] = useState('');
  const [benchmark, setBenchmark] = useState(DEFAULT_MULTI[0]);
  const [multiSeries, setMultiSeries] = useState<AssetSeries[]>([]);
  const [multiLoading, setMultiLoading] = useState(false);
  const [multiError, setMultiError] = useState('');

  const [symbolA, setSymbolA] = useState('SPY');
  const [symbolB, setSymbolB] = useState('QQQ');
  const [zWindow, setZWindow] = useState(60);
  const [relativeSeries, setRelativeSeries] = useState<AssetSeries[]>([]);
  const [relativeLoading, setRelativeLoading] = useState(false);
  const [relativeError, setRelativeError] = useState('');

  const [factorSymbols, setFactorSymbols] = useState(DEFAULT_MULTI);
  const [factorInput, setFactorInput] = useState('');
  const [factorWeights, setFactorWeights] = useState<Record<string, number>>({
    SPY: 40,
    QQQ: 40,
    GLD: 20,
  });
  const [factorWindow, setFactorWindow] = useState(60);
  const [factorPortfolioSeries, setFactorPortfolioSeries] = useState<AssetSeries[]>([]);
  const [factorProxySeries, setFactorProxySeries] = useState<AssetSeries[]>([]);
  const [factorLoading, setFactorLoading] = useState(false);
  const [factorError, setFactorError] = useState('');

  const stockOptions = useMemo(() => stockPool.map((stock: any) => ({
    symbol: String(stock.symbol || '').toUpperCase(),
    name: String(stock.name || stock.stockName || ''),
  })).filter(item => item.symbol), [stockPool]);

  useEffect(() => {
    void loadMulti();
    void loadRelative();
    void loadFactor();
    // Initial examples make the workspace useful immediately.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!multiSymbols.includes(benchmark)) setBenchmark(multiSymbols[0] || '');
  }, [benchmark, multiSymbols]);

  useEffect(() => {
    setFactorWeights(current => {
      const next: Record<string, number> = {};
      factorSymbols.forEach(symbol => {
        next[symbol] = current[symbol] ?? Number((100 / Math.max(factorSymbols.length, 1)).toFixed(2));
      });
      return next;
    });
  }, [factorSymbols]);

  async function loadMulti() {
    if (!multiSymbols.length) {
      setMultiError('请至少加入一个标的。');
      return;
    }
    setMultiLoading(true);
    setMultiError('');
    try {
      const results = await Promise.allSettled(
        multiSymbols.map(symbol => fetchAssetSeries(symbol, fromDate, toDate)),
      );
      const successful = results
        .filter((result): result is PromiseFulfilledResult<AssetSeries> => result.status === 'fulfilled')
        .map(result => result.value);
      const failed = results
        .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
        .map(result => result.reason instanceof Error ? result.reason.message : String(result.reason));
      setMultiSeries(successful);
      if (failed.length) setMultiError(`部分标的读取失败：${failed.join('；')}`);
      if (!successful.length) throw new Error('没有获得任何有效历史行情。');
    } catch (error) {
      setMultiSeries([]);
      setMultiError(error instanceof Error ? error.message : '多资产分析失败。');
    } finally {
      setMultiLoading(false);
    }
  }

  async function loadRelative() {
    const left = normalizeSymbol(symbolA);
    const right = normalizeSymbol(symbolB);
    if (!left || !right || left === right) {
      setRelativeError('请输入两个不同的标的代码。');
      return;
    }
    setRelativeLoading(true);
    setRelativeError('');
    try {
      const result = await Promise.all([
        fetchAssetSeries(left, fromDate, toDate),
        fetchAssetSeries(right, fromDate, toDate),
      ]);
      setRelativeSeries(result);
    } catch (error) {
      setRelativeSeries([]);
      setRelativeError(error instanceof Error ? error.message : '相对价值分析失败。');
    } finally {
      setRelativeLoading(false);
    }
  }

  async function loadFactor() {
    if (!factorSymbols.length) {
      setFactorError('请至少加入一个因子分析组合标的。');
      return;
    }
    setFactorLoading(true);
    setFactorError('');
    try {
      const proxySymbols = Array.from(new Set(FACTOR_DEFINITIONS.flatMap(factor => (
        factor.shortSymbol ? [factor.longSymbol, factor.shortSymbol] : [factor.longSymbol]
      ))));
      const allSymbols = Array.from(new Set([...factorSymbols, ...proxySymbols]));
      const results = await Promise.allSettled(
        allSymbols.map(symbol => fetchAssetSeries(symbol, fromDate, toDate)),
      );
      const loaded = results
        .filter((result): result is PromiseFulfilledResult<AssetSeries> => result.status === 'fulfilled')
        .map(result => result.value);
      const loadedMap = new Map(loaded.map(series => [series.symbol, series]));
      const missingPortfolio = factorSymbols.filter(symbol => !loadedMap.has(symbol));
      const missingProxies = proxySymbols.filter(symbol => !loadedMap.has(symbol));
      if (missingPortfolio.length || missingProxies.length) {
        const messages = [
          missingPortfolio.length ? `组合标的：${missingPortfolio.join('、')}` : '',
          missingProxies.length ? `因子代理：${missingProxies.join('、')}` : '',
        ].filter(Boolean);
        throw new Error(`历史行情缺失（${messages.join('；')}）`);
      }
      setFactorPortfolioSeries(factorSymbols.map(symbol => loadedMap.get(symbol) as AssetSeries));
      setFactorProxySeries(proxySymbols.map(symbol => loadedMap.get(symbol) as AssetSeries));
    } catch (error) {
      setFactorPortfolioSeries([]);
      setFactorProxySeries([]);
      setFactorError(error instanceof Error ? error.message : '因子分析失败。');
    } finally {
      setFactorLoading(false);
    }
  }

  function addMultiSymbols() {
    const candidates = multiInput
      .split(/[\s,，;；]+/)
      .map(normalizeSymbol)
      .filter(Boolean);
    if (!candidates.length) return;
    setMultiSymbols(current => Array.from(new Set([...current, ...candidates])).slice(0, 6));
    setMultiInput('');
  }

  function addFactorSymbols() {
    const candidates = factorInput
      .split(/[\s,，;；]+/)
      .map(normalizeSymbol)
      .filter(Boolean);
    if (!candidates.length) return;
    setFactorSymbols(current => Array.from(new Set([...current, ...candidates])).slice(0, 10));
    setFactorInput('');
    setFactorPortfolioSeries([]);
    setFactorProxySeries([]);
    setFactorError('');
  }

  function removeFactorSymbol(symbol: string) {
    setFactorSymbols(current => current.filter(item => item !== symbol));
    setFactorPortfolioSeries([]);
    setFactorProxySeries([]);
    setFactorError('');
  }

  const benchmarkSeries = multiSeries.find(series => series.symbol === benchmark);
  const metrics = useMemo(() => multiSeries.map(series => (
    calculateAssetMetrics(series, riskFreeRate / 100, benchmarkSeries)
  )), [benchmarkSeries, multiSeries, riskFreeRate]);
  const normalizedChart = useMemo(() => buildNormalizedChart(multiSeries), [multiSeries]);
  const drawdownChart = useMemo(() => buildDrawdownChart(multiSeries), [multiSeries]);
  const correlationMatrix = useMemo(() => buildCorrelationMatrix(multiSeries), [multiSeries]);
  const relativeResult = useMemo(() => (
    relativeSeries.length === 2
      ? calculateRelativeValue(relativeSeries[0], relativeSeries[1], zWindow)
      : null
  ), [relativeSeries, zWindow]);
  const factorResult = useMemo(() => (
    factorPortfolioSeries.length
      ? calculateFactorAnalysis(
        factorPortfolioSeries,
        factorPortfolioSeries.map(series => factorWeights[series.symbol] ?? 0),
        factorProxySeries,
        FACTOR_DEFINITIONS,
        riskFreeRate / 100,
        factorWindow,
      )
      : null
  ), [factorPortfolioSeries, factorProxySeries, factorWeights, factorWindow, riskFreeRate]);

  return (
    <main className="min-h-screen bg-[#f3efe6] text-slate-900">
      <div className="mx-auto max-w-[1500px] px-4 py-7 sm:px-6 lg:px-8">
        <header className="relative overflow-hidden rounded-[28px] border border-slate-900/10 bg-[#102a2a] px-6 py-7 text-white shadow-[0_24px_60px_rgba(15,42,42,0.2)] sm:px-8">
          <div className="absolute -right-16 -top-24 h-64 w-64 rounded-full border border-white/10 bg-[#e76f36]/20" />
          <div className="absolute bottom-0 right-1/3 h-px w-72 bg-gradient-to-r from-transparent via-white/30 to-transparent" />
          <div className="relative flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.26em] text-[#f0ad79]">
                <Sigma size={15} /> Quantitative Research Desk
              </div>
              <h1 className="font-serif text-4xl font-semibold tracking-tight sm:text-5xl">组合分析</h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300">
                用统一的日频价格底稿观察收益、波动、回撤、相关结构与相对价值。所有结果均为只读计算，不写入持仓或Firebase。
              </p>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <DateField label="开始日期" value={fromDate} onChange={setFromDate} />
              <DateField label="结束日期" value={toDate} onChange={setToDate} />
              <label className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                <span className="block text-[10px] font-bold uppercase tracking-widest text-slate-400">无风险利率</span>
                <div className="mt-1 flex items-center gap-1">
                  <input
                    type="number"
                    step="0.1"
                    value={riskFreeRate}
                    onChange={event => setRiskFreeRate(Number(event.target.value) || 0)}
                    className="w-20 bg-transparent text-lg font-semibold outline-none"
                  />
                  <span className="text-sm text-slate-400">%</span>
                </div>
              </label>
            </div>
          </div>
        </header>

        <nav className="mt-6 flex w-full gap-2 overflow-x-auto rounded-2xl border border-slate-900/10 bg-white/70 p-2 shadow-sm backdrop-blur">
          <TabButton
            active={activeTab === 'multi'}
            icon={<BarChart3 size={17} />}
            title="多资产统计"
            subtitle="收益、波动、回撤与相关性"
            onClick={() => setActiveTab('multi')}
          />
          <TabButton
            active={activeTab === 'relative'}
            icon={<ArrowRightLeft size={17} />}
            title="相对价值"
            subtitle="对冲比率、价差与均值回归"
            onClick={() => setActiveTab('relative')}
          />
          <TabButton
            active={activeTab === 'factor'}
            icon={<Orbit size={17} />}
            title="因子暴露与归因"
            subtitle="Beta、滚动风格与收益来源"
            onClick={() => setActiveTab('factor')}
          />
          <div className="ml-auto hidden items-center gap-2 px-4 text-xs text-slate-500 lg:flex">
            <Sparkles size={14} className="text-orange-600" />
            历史行情来自现有 <span className="font-mono text-slate-700">/api/history</span>
          </div>
        </nav>

        {activeTab === 'multi' ? (
          <MultiAssetPanel
            symbols={multiSymbols}
            setSymbols={setMultiSymbols}
            input={multiInput}
            setInput={setMultiInput}
            addSymbols={addMultiSymbols}
            stockOptions={stockOptions}
            stockPoolLoading={stockPoolLoading}
            benchmark={benchmark}
            setBenchmark={setBenchmark}
            loading={multiLoading}
            error={multiError}
            load={loadMulti}
            series={multiSeries}
            metrics={metrics}
            normalizedChart={normalizedChart}
            drawdownChart={drawdownChart}
            correlationMatrix={correlationMatrix}
          />
        ) : activeTab === 'relative' ? (
          <RelativeValuePanel
            symbolA={symbolA}
            setSymbolA={setSymbolA}
            symbolB={symbolB}
            setSymbolB={setSymbolB}
            zWindow={zWindow}
            setZWindow={setZWindow}
            stockOptions={stockOptions}
            loading={relativeLoading}
            error={relativeError}
            load={loadRelative}
            result={relativeResult}
            series={relativeSeries}
          />
        ) : (
          <FactorAnalysisPanel
            symbols={factorSymbols}
            input={factorInput}
            setInput={setFactorInput}
            addSymbols={addFactorSymbols}
            removeSymbol={removeFactorSymbol}
            weights={factorWeights}
            setWeights={setFactorWeights}
            stockPoolLoading={stockPoolLoading}
            rollingWindow={factorWindow}
            setRollingWindow={setFactorWindow}
            loading={factorLoading}
            error={factorError}
            load={loadFactor}
            result={factorResult}
          />
        )}
      </div>
      <datalist id="portfolio-stock-options">
        {stockOptions.map(option => (
          <option key={option.symbol} value={option.symbol}>{option.name}</option>
        ))}
      </datalist>
    </main>
  );
}

function DateField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
      <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">
        <CalendarDays size={11} /> {label}
      </span>
      <input
        type="date"
        value={value}
        onChange={event => onChange(event.target.value)}
        className="mt-1 bg-transparent text-sm font-semibold outline-none [color-scheme:dark]"
      />
    </label>
  );
}

function TabButton({
  active,
  icon,
  title,
  subtitle,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`min-w-[220px] rounded-xl px-4 py-3 text-left transition-all ${
        active
          ? 'bg-[#102a2a] text-white shadow-lg'
          : 'text-slate-600 hover:bg-white hover:text-slate-900'
      }`}
    >
      <span className="flex items-center gap-2 text-sm font-bold">{icon}{title}</span>
      <span className={`mt-1 block text-[11px] ${active ? 'text-slate-300' : 'text-slate-400'}`}>{subtitle}</span>
    </button>
  );
}

type MultiPanelProps = {
  symbols: string[];
  setSymbols: React.Dispatch<React.SetStateAction<string[]>>;
  input: string;
  setInput: (value: string) => void;
  addSymbols: () => void;
  stockOptions: Array<{ symbol: string; name: string }>;
  stockPoolLoading: boolean;
  benchmark: string;
  setBenchmark: (value: string) => void;
  loading: boolean;
  error: string;
  load: () => void;
  series: AssetSeries[];
  metrics: AssetMetrics[];
  normalizedChart: Array<Record<string, string | number | null>>;
  drawdownChart: Array<Record<string, string | number | null>>;
  correlationMatrix: Array<Array<number | null>>;
};

function MultiAssetPanel(props: MultiPanelProps) {
  const {
    symbols, setSymbols, input, setInput, addSymbols, stockOptions, stockPoolLoading,
    benchmark, setBenchmark, loading, error, load, series, metrics,
    normalizedChart, drawdownChart, correlationMatrix,
  } = props;

  return (
    <section className="mt-6 space-y-6">
      <div className="grid gap-5 xl:grid-cols-[1fr_300px]">
        <div className="rounded-3xl border border-slate-900/10 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
            <div className="flex-1">
              <div className="flex items-center justify-between">
                <label className="text-xs font-black uppercase tracking-widest text-slate-500">分析标的</label>
                <span className="text-[11px] text-slate-400">最多6个，支持空格或逗号批量输入</span>
              </div>
              <div className="mt-2 flex gap-2">
                <input
                  value={input}
                  onChange={event => setInput(event.target.value)}
                  onKeyDown={event => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      addSymbols();
                    }
                  }}
                  list="portfolio-stock-options"
                  placeholder="例如 0700.HK、AAPL、^HSI"
                  className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-[#faf8f3] px-4 py-2.5 text-sm outline-none transition focus:border-teal-700 focus:ring-2 focus:ring-teal-700/10"
                />
                <button onClick={addSymbols} className="flex items-center gap-1 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-bold text-white hover:bg-slate-700">
                  <Plus size={15} /> 加入
                </button>
              </div>
              <div className="mt-3 flex min-h-8 flex-wrap gap-2">
                {symbols.map((symbol, index) => (
                  <span key={symbol} className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold shadow-sm">
                    <i className="h-2 w-2 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }} />
                    {symbol}
                    <button
                      onClick={() => setSymbols(current => current.filter(item => item !== symbol))}
                      className="text-slate-400 hover:text-rose-600"
                      aria-label={`移除 ${symbol}`}
                    >
                      <X size={13} />
                    </button>
                  </span>
                ))}
                {!symbols.length && <span className="text-xs text-rose-600">尚未选择标的</span>}
              </div>
            </div>

            <label className="min-w-[190px]">
              <span className="text-xs font-black uppercase tracking-widest text-slate-500">回归基准</span>
              <select
                value={benchmark}
                onChange={event => setBenchmark(event.target.value)}
                className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold outline-none focus:border-teal-700"
              >
                {symbols.map(symbol => <option key={symbol}>{symbol}</option>)}
              </select>
            </label>
            <button
              onClick={load}
              disabled={loading || !symbols.length}
              className="flex h-[43px] items-center justify-center gap-2 rounded-xl bg-[#d95f2b] px-5 text-sm font-black text-white shadow-sm transition hover:bg-[#b94b1d] disabled:opacity-50"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
              运行分析
            </button>
          </div>
          <p className="mt-3 text-[11px] text-slate-400">
            {stockPoolLoading ? '股票池联想加载中；仍可直接输入代码。' : `股票池可联想 ${stockOptions.length} 个标的；指数、ETF和外汇也可直接输入Yahoo代码。`}
          </p>
        </div>

        <div className="rounded-3xl border border-[#d95f2b]/20 bg-[#fff4e8] p-5">
          <div className="flex items-center gap-2 font-serif text-lg font-semibold text-[#8d3517]">
            <Gauge size={18} /> 口径说明
          </div>
          <p className="mt-3 text-xs leading-6 text-[#8d5b45]">
            收益使用复权收盘价；年化按252个交易日；相关性和回归只使用共同交易日；VaR为日收益历史5%分位，不代表最大可能损失。
          </p>
        </div>
      </div>

      {error && <ErrorBanner message={error} />}

      <div className="grid gap-6 xl:grid-cols-2">
        <ChartCard title="标准化净值曲线" subtitle="起点统一为100，比较不同计价单位资产的相对表现">
          <MultiLineChart data={normalizedChart} symbols={series.map(item => item.symbol)} percent={false} />
        </ChartCard>
        <ChartCard title="历史回撤曲线" subtitle="从各自历史高点计算的跌幅">
          <MultiLineChart data={drawdownChart} symbols={series.map(item => item.symbol)} percent />
        </ChartCard>
      </div>

      <div className="rounded-3xl border border-slate-900/10 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="font-serif text-xl font-semibold">统计指标总览</h2>
            <p className="mt-1 text-xs text-slate-500">Beta与Alpha相对于所选基准计算</p>
          </div>
          <Activity className="text-teal-700" size={20} />
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[1120px] w-full text-sm">
            <thead className="bg-[#f8f5ee] text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 text-left">标的</th>
                <th className="px-4 py-3 text-right">样本数</th>
                <th className="px-4 py-3 text-right">累计收益</th>
                <th className="px-4 py-3 text-right">年化收益</th>
                <th className="px-4 py-3 text-right">年化波动</th>
                <th className="px-4 py-3 text-right">夏普</th>
                <th className="px-4 py-3 text-right">最大回撤</th>
                <th className="px-4 py-3 text-right">日VaR 95%</th>
                <th className="px-4 py-3 text-right">偏度</th>
                <th className="px-4 py-3 text-right">超额峰度</th>
                <th className="px-4 py-3 text-right">Beta</th>
                <th className="px-4 py-3 text-right">年化Alpha</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {metrics.map((metric, index) => (
                <tr key={metric.symbol} className="hover:bg-teal-50/40">
                  <td className="px-4 py-3 font-black">
                    <span className="mr-2 inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }} />
                    {metric.symbol}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-slate-500">{metric.observations}</td>
                  <MetricCell value={metric.totalReturn} percent />
                  <MetricCell value={metric.annualizedReturn} percent />
                  <MetricCell value={metric.annualizedVolatility} percent neutral />
                  <MetricCell value={metric.sharpe} />
                  <MetricCell value={metric.maxDrawdown} percent />
                  <MetricCell value={metric.historicalVar95} percent />
                  <MetricCell value={metric.skewness} />
                  <MetricCell value={metric.excessKurtosis} />
                  <MetricCell value={metric.beta} neutral />
                  <MetricCell value={metric.alphaAnnualized} percent />
                </tr>
              ))}
              {!metrics.length && (
                <tr><td colSpan={12} className="px-4 py-12 text-center text-slate-400">运行分析后展示指标</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <CorrelationMatrix symbols={series.map(item => item.symbol)} matrix={correlationMatrix} />
    </section>
  );
}

function MetricCell({ value, percent = false, neutral = false }: { value: number | null; percent?: boolean; neutral?: boolean }) {
  const color = neutral || value === null
    ? 'text-slate-700'
    : value > 0
      ? 'text-emerald-700'
      : value < 0
        ? 'text-rose-700'
        : 'text-slate-500';
  return (
    <td className={`whitespace-nowrap px-4 py-3 text-right font-mono font-semibold ${color}`}>
      {percent ? formatPercent(value) : formatNumber(value)}
    </td>
  );
}

function ChartCard({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="rounded-3xl border border-slate-900/10 bg-white p-5 shadow-sm">
      <h2 className="font-serif text-xl font-semibold">{title}</h2>
      <p className="mt-1 text-xs text-slate-500">{subtitle}</p>
      <div className="mt-5 h-[330px]">{children}</div>
    </div>
  );
}

function MultiLineChart({
  data,
  symbols,
  percent,
}: {
  data: Array<Record<string, string | number | null>>;
  symbols: string[];
  percent: boolean;
}) {
  if (!data.length) return <EmptyChart />;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 18, left: 4, bottom: 4 }}>
        <CartesianGrid stroke="#e7e2d8" strokeDasharray="3 5" vertical={false} />
        <XAxis dataKey="date" minTickGap={42} tickFormatter={compactDate} tick={{ fontSize: 10, fill: '#64748b' }} />
        <YAxis
          width={58}
          tick={{ fontSize: 10, fill: '#64748b' }}
          tickFormatter={value => percent ? `${Number(value).toFixed(0)}%` : Number(value).toFixed(0)}
        />
        <Tooltip
          labelFormatter={formatTooltipDate}
          formatter={(value: any, name: any) => [
            percent ? `${Number(value).toFixed(2)}%` : Number(value).toFixed(2),
            name,
          ]}
          contentStyle={{ borderRadius: 14, borderColor: '#d8d2c6', boxShadow: '0 12px 30px rgba(15,23,42,.12)' }}
        />
        <Legend />
        {symbols.map((symbol, index) => (
          <Line
            key={symbol}
            type="monotone"
            dataKey={symbol}
            stroke={COLORS[index % COLORS.length]}
            strokeWidth={2}
            dot={false}
            connectNulls={false}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

function CorrelationMatrix({ symbols, matrix }: { symbols: string[]; matrix: Array<Array<number | null>> }) {
  return (
    <div className="rounded-3xl border border-slate-900/10 bg-[#102a2a] p-5 text-white shadow-sm">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="font-serif text-xl font-semibold">日收益相关性矩阵</h2>
          <p className="mt-1 text-xs text-slate-400">绿色代表正相关，橙红代表负相关；按共同交易日计算</p>
        </div>
        <span className="text-[11px] text-slate-400">相关性不等于稳定的长期关系</span>
      </div>
      <div className="mt-5 overflow-x-auto">
        {symbols.length ? (
          <table className="min-w-[560px] w-full border-separate border-spacing-1 text-sm">
            <thead>
              <tr>
                <th />
                {symbols.map(symbol => <th key={symbol} className="px-3 py-2 text-center text-xs text-slate-300">{symbol}</th>)}
              </tr>
            </thead>
            <tbody>
              {symbols.map((symbol, rowIndex) => (
                <tr key={symbol}>
                  <th className="px-3 py-2 text-left text-xs text-slate-300">{symbol}</th>
                  {symbols.map((column, columnIndex) => {
                    const value = matrix[rowIndex]?.[columnIndex] ?? null;
                    const intensity = value === null ? 0 : Math.min(Math.abs(value), 1);
                    const background = value === null
                      ? 'rgba(255,255,255,.05)'
                      : value >= 0
                        ? `rgba(20,184,166,${0.12 + intensity * 0.68})`
                        : `rgba(234,88,12,${0.12 + intensity * 0.68})`;
                    return (
                      <td key={column} className="rounded-lg px-3 py-4 text-center font-mono font-bold" style={{ background }}>
                        {formatNumber(value)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="py-12 text-center text-slate-400">运行分析后展示相关结构</div>
        )}
      </div>
    </div>
  );
}

type RelativePanelProps = {
  symbolA: string;
  setSymbolA: (value: string) => void;
  symbolB: string;
  setSymbolB: (value: string) => void;
  zWindow: number;
  setZWindow: (value: number) => void;
  stockOptions: Array<{ symbol: string; name: string }>;
  loading: boolean;
  error: string;
  load: () => void;
  result: ReturnType<typeof calculateRelativeValue> | null;
  series: AssetSeries[];
};

function RelativeValuePanel(props: RelativePanelProps) {
  const {
    symbolA, setSymbolA, symbolB, setSymbolB, zWindow, setZWindow,
    loading, error, load, result, series,
  } = props;
  const names = series.map(item => item.symbol);

  return (
    <section className="mt-6 space-y-6">
      <div className="rounded-3xl border border-slate-900/10 bg-white p-5 shadow-sm">
        <div className="grid gap-4 lg:grid-cols-[1fr_auto_1fr_180px_auto] lg:items-end">
          <SymbolField label="标的 A（被解释资产）" value={symbolA} onChange={setSymbolA} />
          <button
            onClick={() => {
              setSymbolA(symbolB);
              setSymbolB(symbolA);
            }}
            className="mx-auto flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 text-slate-500 transition hover:border-orange-500 hover:text-orange-600"
            title="交换标的"
          >
            <ArrowRightLeft size={17} />
          </button>
          <SymbolField label="标的 B（对冲资产）" value={symbolB} onChange={setSymbolB} />
          <label>
            <span className="text-xs font-black uppercase tracking-widest text-slate-500">Z-score窗口</span>
            <select
              value={zWindow}
              onChange={event => setZWindow(Number(event.target.value))}
              className="mt-2 w-full rounded-xl border border-slate-200 bg-[#faf8f3] px-3 py-2.5 text-sm font-semibold outline-none focus:border-teal-700"
            >
              {[20, 40, 60, 120, 252].map(window => <option key={window} value={window}>{window}个共同交易日</option>)}
            </select>
          </label>
          <button
            onClick={load}
            disabled={loading}
            className="flex h-[43px] items-center justify-center gap-2 rounded-xl bg-[#d95f2b] px-5 text-sm font-black text-white transition hover:bg-[#b94b1d] disabled:opacity-50"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
            运行分析
          </button>
        </div>
      </div>

      {error && <ErrorBanner message={error} />}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        <StatCard label="共同样本" value={result ? String(result.observations) : '--'} note="交易日" />
        <StatCard label="收益相关性" value={formatNumber(result?.correlation ?? null)} note="日收益 Pearson" />
        <StatCard label="OLS对冲比率 β" value={formatNumber(result?.hedgeRatio ?? null, 4)} note={`log(${names[0] || 'A'}) ~ log(${names[1] || 'B'})`} />
        <StatCard label="当前Z-score" value={formatNumber(result?.latestZScore ?? null)} note={`窗口 ${zWindow}`} accent={Math.abs(result?.latestZScore || 0) >= 2} />
        <StatCard label="均值回归半衰期" value={result?.halfLife ? result.halfLife.toFixed(1) : '--'} note="共同交易日" />
        <StatCard
          label="ADF近似 t值"
          value={formatNumber(result?.adfTStatistic ?? null)}
          note={result?.adfIndicativeStationary ? '低于-2.86，具有平稳迹象' : '未达到-2.86参考线'}
          positive={Boolean(result?.adfIndicativeStationary)}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <ChartCard title="标准化价格比较" subtitle="共同起点为100；趋势接近不代表价差平稳">
          {result?.chart.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={result.chart} margin={{ top: 8, right: 18, left: 4, bottom: 4 }}>
                <CartesianGrid stroke="#e7e2d8" strokeDasharray="3 5" vertical={false} />
                <XAxis dataKey="date" minTickGap={42} tickFormatter={compactDate} tick={{ fontSize: 10, fill: '#64748b' }} />
                <YAxis width={54} tick={{ fontSize: 10, fill: '#64748b' }} />
                <Tooltip labelFormatter={formatTooltipDate} formatter={(value: any) => Number(value).toFixed(2)} />
                <Legend />
                <Line type="monotone" dataKey="normalizedA" name={names[0] || '标的A'} stroke={COLORS[0]} strokeWidth={2.2} dot={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="normalizedB" name={names[1] || '标的B'} stroke={COLORS[1]} strokeWidth={2.2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : <EmptyChart />}
        </ChartCard>

        <ChartCard title="协整残差价差" subtitle="spread = log(A) - α - β × log(B)">
          {result?.chart.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={result.chart} margin={{ top: 8, right: 18, left: 4, bottom: 4 }}>
                <CartesianGrid stroke="#e7e2d8" strokeDasharray="3 5" vertical={false} />
                <XAxis dataKey="date" minTickGap={42} tickFormatter={compactDate} tick={{ fontSize: 10, fill: '#64748b' }} />
                <YAxis width={60} tick={{ fontSize: 10, fill: '#64748b' }} tickFormatter={value => Number(value).toFixed(2)} />
                <Tooltip labelFormatter={formatTooltipDate} formatter={(value: any) => Number(value).toFixed(4)} />
                <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="4 4" />
                <Line type="monotone" dataKey="spread" name="残差价差" stroke="#0369a1" strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : <EmptyChart />}
        </ChartCard>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.5fr_0.5fr]">
        <ChartCard title="滚动Z-score" subtitle="用于观察当前价差相对近期均值的偏离程度">
          {result?.chart.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={result.chart} margin={{ top: 8, right: 18, left: 4, bottom: 4 }}>
                <CartesianGrid stroke="#e7e2d8" strokeDasharray="3 5" vertical={false} />
                <XAxis dataKey="date" minTickGap={42} tickFormatter={compactDate} tick={{ fontSize: 10, fill: '#64748b' }} />
                <YAxis domain={['auto', 'auto']} width={50} tick={{ fontSize: 10, fill: '#64748b' }} />
                <Tooltip labelFormatter={formatTooltipDate} formatter={(value: any) => Number(value).toFixed(2)} />
                <ReferenceLine y={0} stroke="#64748b" />
                <ReferenceLine y={2} stroke="#be123c" strokeDasharray="5 4" label={{ value: '+2', fill: '#be123c', fontSize: 10 }} />
                <ReferenceLine y={-2} stroke="#0f766e" strokeDasharray="5 4" label={{ value: '-2', fill: '#0f766e', fontSize: 10 }} />
                <Line type="monotone" dataKey="zScore" name="Z-score" stroke="#d95f2b" strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : <EmptyChart />}
        </ChartCard>

        <div className="rounded-3xl border border-slate-900/10 bg-[#102a2a] p-6 text-white shadow-sm">
          <div className="flex items-center gap-2 text-[#f0ad79]">
            <CircleAlert size={17} />
            <span className="text-xs font-black uppercase tracking-widest">研究提示</span>
          </div>
          <h2 className="mt-4 font-serif text-2xl font-semibold">偏离不是交易信号</h2>
          <div className="mt-5 space-y-4 text-sm leading-6 text-slate-300">
            <p>高相关只说明收益同步，不代表两者存在长期均衡关系。</p>
            <p>ADF结果为无滞后项的近似诊断，适合初筛，不应替代完整统计检验。</p>
            <p>对冲比率会随样本区间变化；实际策略还需加入交易费、滑点、做空成本和样本外检验。</p>
          </div>
          <div className="mt-6 rounded-2xl bg-white/5 p-4 text-xs text-slate-400">
            当前模型更适合帮助研究员发现问题，而不是自动发出买卖指令。
          </div>
        </div>
      </div>
    </section>
  );
}

type FactorPanelProps = {
  symbols: string[];
  input: string;
  setInput: (value: string) => void;
  addSymbols: () => void;
  removeSymbol: (symbol: string) => void;
  weights: Record<string, number>;
  setWeights: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  stockPoolLoading: boolean;
  rollingWindow: number;
  setRollingWindow: (value: number) => void;
  loading: boolean;
  error: string;
  load: () => void;
  result: FactorAnalysisResult | null;
};

function FactorAnalysisPanel({
  symbols,
  input,
  setInput,
  addSymbols,
  removeSymbol,
  weights,
  setWeights,
  stockPoolLoading,
  rollingWindow,
  setRollingWindow,
  loading,
  error,
  load,
  result,
}: FactorPanelProps) {
  const weightTotal = symbols.reduce((sum, symbol) => sum + (Number(weights[symbol]) || 0), 0);
  const rollingKeys = FACTOR_DEFINITIONS.map(factor => factor.name);
  const cumulativeKeys = [...rollingKeys, 'Alpha', '特异收益'];

  return (
    <section className="mt-6 space-y-6">
      <div className="grid gap-5 xl:grid-cols-[1fr_320px]">
        <div className="rounded-3xl border border-slate-900/10 bg-white p-5 shadow-sm">
          <div className="space-y-5">
            <div>
              <div className="flex items-center justify-between">
                <label className="text-xs font-black uppercase tracking-widest text-slate-500">分析组合标的</label>
                <span className="text-[11px] text-slate-400">最多 10 个，支持空格或逗号批量输入</span>
              </div>
              <div className="mt-2 flex gap-2">
                <input
                  value={input}
                  onChange={event => setInput(event.target.value)}
                  onKeyDown={event => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      addSymbols();
                    }
                  }}
                  list="portfolio-stock-options"
                  placeholder="例如 0700.HK、AAPL、GLD"
                  className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-[#faf8f3] px-4 py-2.5 text-sm outline-none transition focus:border-teal-700 focus:ring-2 focus:ring-teal-700/10"
                />
                <button
                  onClick={addSymbols}
                  className="flex items-center gap-1 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-bold text-white hover:bg-slate-700"
                >
                  <Plus size={15} /> 加入
                </button>
              </div>
              <p className="mt-2 text-[10px] text-slate-400">
                {stockPoolLoading ? '股票池联想加载中；仍可直接输入 Yahoo 代码。' : '可使用股票池联想，也可直接输入指数、ETF 或其他 Yahoo 代码。'}
              </p>
            </div>

            <div className="flex flex-col gap-5 lg:flex-row lg:items-end">
              <div className="flex-1">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <div className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-slate-500">
                      <SlidersHorizontal size={14} /> 组合权重
                    </div>
                    <p className="mt-1 text-[11px] text-slate-400">
                      本模块独立维护组合标的；输入值会按合计自动归一化。
                    </p>
                  </div>
                  <span className={`mt-2 text-xs font-bold sm:mt-0 ${
                    Math.abs(weightTotal - 100) < 0.01 ? 'text-emerald-700' : 'text-orange-700'
                  }`}>
                    输入合计 {weightTotal.toFixed(2)}%
                  </span>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {symbols.map((symbol, index) => (
                    <div key={symbol} className="relative rounded-2xl border border-slate-200 bg-[#faf8f3] p-3">
                      <span className="flex items-center gap-2 pr-7 text-xs font-black text-slate-700">
                        <i className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }} />
                        <span className="truncate" title={symbol}>{symbol}</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => removeSymbol(symbol)}
                        className="absolute right-2.5 top-2.5 text-slate-400 transition hover:text-rose-600"
                        aria-label={`移除 ${symbol}`}
                      >
                        <X size={14} />
                      </button>
                      <div className="mt-2 flex items-center gap-2">
                        <input
                          type="number"
                          step="1"
                          aria-label={`${symbol} 组合权重`}
                          value={weights[symbol] ?? 0}
                          onChange={event => setWeights(current => ({
                            ...current,
                            [symbol]: Number(event.target.value) || 0,
                          }))}
                          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-sm font-bold outline-none focus:border-teal-700"
                        />
                        <span className="text-xs text-slate-400">%</span>
                      </div>
                    </div>
                  ))}
                </div>
                {!symbols.length && (
                  <div className="mt-4 rounded-2xl border border-dashed border-slate-300 py-8 text-center text-xs text-slate-400">
                    请在上方输入因子分析所需的组合标的。
                  </div>
                )}
              </div>

              <label className="min-w-[180px]">
                <span className="text-xs font-black uppercase tracking-widest text-slate-500">滚动窗口</span>
                <select
                  value={rollingWindow}
                  onChange={event => setRollingWindow(Number(event.target.value))}
                  className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold outline-none focus:border-teal-700"
                >
                  {[40, 60, 120, 252].map(window => (
                    <option key={window} value={window}>{window} 个共同交易日</option>
                  ))}
                </select>
              </label>
              <button
                onClick={load}
                disabled={loading || !symbols.length}
                className="flex h-[43px] items-center justify-center gap-2 rounded-xl bg-[#d95f2b] px-5 text-sm font-black text-white transition hover:bg-[#b94b1d] disabled:opacity-50"
              >
                {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                运行因子分析
              </button>
            </div>
          </div>
        </div>

        <div className="rounded-3xl border border-[#d95f2b]/20 bg-[#fff4e8] p-5">
          <div className="flex items-center gap-2 font-serif text-lg font-semibold text-[#8d3517]">
            <Orbit size={18} /> 因子代理口径
          </div>
          <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-[11px] text-[#8d5b45]">
            {FACTOR_DEFINITIONS.map(factor => (
              <div key={factor.key} className="rounded-lg bg-white/55 px-2.5 py-2">
                <b className="block text-[#6f3019]">{factor.name}</b>
                <span className="font-mono">
                  {factor.longSymbol}{factor.shortSymbol ? ` - ${factor.shortSymbol}` : ''}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[10px] leading-5 text-[#9b6c58]">
            ETF 差值使用日收益率之差。市场因子扣除日化无风险利率，其余代理因子保持自身收益口径。
          </p>
        </div>
      </div>

      {error && <ErrorBanner message={error} />}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="共同样本" value={result ? String(result.observations) : '--'} note="全部资产与因子的共同交易区间" />
        <StatCard label="组合年化收益" value={formatPercent(result?.portfolioAnnualizedReturn ?? null)} note="按日收益复合年化" />
        <StatCard label="年化 Alpha" value={formatPercent(result?.alphaAnnualized ?? null)} note="回归截距 × 252" positive={(result?.alphaAnnualized ?? 0) > 0} />
        <StatCard label="模型解释度 R²" value={formatPercent(result?.rSquared ?? null)} note="因子解释组合波动的比例" />
        <StatCard label="残差年化波动" value={formatPercent(result?.residualVolatility ?? null)} note="未被代理因子解释的波动" />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <ChartCard title="全样本因子暴露" subtitle="Beta 表示组合收益对各代理因子日收益变化的统计敏感度">
          {result?.exposures.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={result.exposures} margin={{ top: 8, right: 18, left: 4, bottom: 12 }}>
                <CartesianGrid stroke="#e7e2d8" strokeDasharray="3 5" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#64748b' }} />
                <YAxis width={52} tick={{ fontSize: 10, fill: '#64748b' }} tickFormatter={value => Number(value).toFixed(1)} />
                <Tooltip formatter={(value: any) => [Number(value).toFixed(4), 'Beta']} />
                <ReferenceLine y={0} stroke="#64748b" />
                <Bar dataKey="beta" name="Beta" fill="#0f766e" radius={[7, 7, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <EmptyChart />}
        </ChartCard>

        <ChartCard title="区间收益归因" subtitle="各因子贡献、Alpha 与特异收益按日算术累计；用于解释而非替代净值复合收益">
          {result?.contributionChart.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={result.contributionChart} margin={{ top: 8, right: 18, left: 4, bottom: 12 }}>
                <CartesianGrid stroke="#e7e2d8" strokeDasharray="3 5" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#64748b' }} />
                <YAxis width={58} tick={{ fontSize: 10, fill: '#64748b' }} tickFormatter={value => `${(Number(value) * 100).toFixed(0)}%`} />
                <Tooltip formatter={(value: any) => [formatPercent(Number(value)), '累计贡献']} />
                <ReferenceLine y={0} stroke="#64748b" />
                <Bar dataKey="value" name="累计贡献" fill="#d95f2b" radius={[7, 7, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <EmptyChart />}
        </ChartCard>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.4fr_0.6fr]">
        <ChartCard title={`${rollingWindow} 日滚动因子暴露`} subtitle="观察组合风格是否随时间漂移；可点击图例显示或隐藏因子">
          {result?.rollingChart.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={result.rollingChart} margin={{ top: 8, right: 18, left: 4, bottom: 4 }}>
                <CartesianGrid stroke="#e7e2d8" strokeDasharray="3 5" vertical={false} />
                <XAxis dataKey="date" minTickGap={42} tickFormatter={compactDate} tick={{ fontSize: 10, fill: '#64748b' }} />
                <YAxis width={55} tick={{ fontSize: 10, fill: '#64748b' }} tickFormatter={value => Number(value).toFixed(1)} />
                <Tooltip labelFormatter={formatTooltipDate} formatter={(value: any, name: any) => [Number(value).toFixed(3), name]} />
                <Legend />
                <ReferenceLine y={0} stroke="#94a3b8" />
                {rollingKeys.map((key, index) => (
                  <Line
                    key={key}
                    type="monotone"
                    dataKey={key}
                    stroke={FACTOR_COLORS[index % FACTOR_COLORS.length]}
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          ) : <EmptyChart />}
        </ChartCard>

        <div className="rounded-3xl border border-slate-900/10 bg-[#102a2a] p-6 text-white shadow-sm">
          <div className="flex items-center gap-2 text-[#f0ad79]">
            <CircleAlert size={17} />
            <span className="text-xs font-black uppercase tracking-widest">解释边界</span>
          </div>
          <h2 className="mt-4 font-serif text-2xl font-semibold">暴露不是持仓标签</h2>
          <div className="mt-5 space-y-4 text-sm leading-6 text-slate-300">
            <p>Beta 是样本期内的统计敏感度；即使组合没有直接持有某类资产，也可能呈现相似收益特征。</p>
            <p>代理 ETF 之间可能相关，因此单个 Beta 不宜脱离其他因子独立解读，滚动变化通常比单点数值更重要。</p>
            <p>第一版使用固定组合权重。若要做严格历史归因，下一阶段应接入每日真实持仓权重与历史汇率。</p>
          </div>
        </div>
      </div>

      <ChartCard title="累计收益来源" subtitle="展示各因子、Alpha 与特异收益的累计算术贡献路径">
        {result?.cumulativeChart.length ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={result.cumulativeChart} margin={{ top: 8, right: 18, left: 4, bottom: 4 }}>
              <CartesianGrid stroke="#e7e2d8" strokeDasharray="3 5" vertical={false} />
              <XAxis dataKey="date" minTickGap={42} tickFormatter={compactDate} tick={{ fontSize: 10, fill: '#64748b' }} />
              <YAxis width={58} tick={{ fontSize: 10, fill: '#64748b' }} tickFormatter={value => `${(Number(value) * 100).toFixed(0)}%`} />
              <Tooltip labelFormatter={formatTooltipDate} formatter={(value: any, name: any) => [formatPercent(Number(value)), name]} />
              <Legend />
              <ReferenceLine y={0} stroke="#94a3b8" />
              {cumulativeKeys.map((key, index) => (
                <Line
                  key={key}
                  type="monotone"
                  dataKey={key}
                  stroke={index < FACTOR_COLORS.length ? FACTOR_COLORS[index] : index === FACTOR_COLORS.length ? '#111827' : '#94a3b8'}
                  strokeWidth={index >= FACTOR_COLORS.length ? 2.4 : 1.8}
                  strokeDasharray={key === '特异收益' ? '5 4' : undefined}
                  dot={false}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        ) : <EmptyChart />}
      </ChartCard>
    </section>
  );
}

function SymbolField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label>
      <span className="text-xs font-black uppercase tracking-widest text-slate-500">{label}</span>
      <input
        value={value}
        onChange={event => onChange(event.target.value.toUpperCase())}
        list="portfolio-stock-options"
        className="mt-2 w-full rounded-xl border border-slate-200 bg-[#faf8f3] px-4 py-2.5 font-mono text-sm font-bold outline-none focus:border-teal-700 focus:ring-2 focus:ring-teal-700/10"
      />
    </label>
  );
}

function StatCard({
  label,
  value,
  note,
  accent = false,
  positive = false,
}: {
  label: string;
  value: string;
  note: string;
  accent?: boolean;
  positive?: boolean;
}) {
  return (
    <div className={`rounded-2xl border p-4 shadow-sm ${
      accent
        ? 'border-orange-300 bg-orange-50'
        : positive
          ? 'border-emerald-200 bg-emerald-50'
          : 'border-slate-900/10 bg-white'
    }`}>
      <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">{label}</div>
      <div className={`mt-2 font-serif text-2xl font-semibold ${accent ? 'text-orange-700' : positive ? 'text-emerald-700' : 'text-slate-900'}`}>{value}</div>
      <div className="mt-1 truncate text-[10px] text-slate-400" title={note}>{note}</div>
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <CircleAlert size={18} className="mt-0.5 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

function EmptyChart() {
  return (
    <div className="flex h-full flex-col items-center justify-center text-slate-400">
      <TrendingUp size={30} strokeWidth={1.4} />
      <span className="mt-2 text-xs">运行分析后展示曲线</span>
    </div>
  );
}
