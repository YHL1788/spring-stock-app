'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, signInAnonymously, signInWithCustomToken } from 'firebase/auth';
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc } from 'firebase/firestore';
import {
  CartesianGrid,
  LabelList,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Database, Loader2, Plus, RefreshCw, Save, Trash2, TrendingUp, X } from 'lucide-react';

import { auth, db, APP_ID } from '@/app/lib/stockService';
import {
  START_ASSETS,
  buildCapitalFlowsFromCashTrades,
  buildInitialPortfolioState,
  calculateNavSeries,
  calculatePerformanceStats,
  type CapitalFlow,
  type CashTradeRecord,
  type InitialPortfolioState,
  type NavPoint,
  type PortfolioSnapshot,
  type StartAssetId,
  type StartConfig,
  type StartRecord,
} from '@/app/book/SP_wjhh1/lib/portfolioNavEngine';

const NAV_CONFIG_COLLECTION = 'sip_holding_summary_nav_config';
const SNAPSHOT_COLLECTION = 'sip_holding_summary_snapshots';
const CASH_TRADE_COLLECTION = 'sip_trade_cash';
const SHARPE_SETTINGS_KEY = 'sip_summary_sharpe_settings';
const BENCHMARK_COLORS = ['#0f766e', '#7c3aed', '#ea580c', '#0891b2', '#65a30d', '#be123c'];

type SnapshotWithExposure = PortfolioSnapshot & {
  totalExposureMarketValueHKD?: number;
  exposureRatio?: number | null;
  exposureCalculatedAt?: string;
  exposureConstituentCount?: number;
  exposureMissingQuoteCount?: number;
  snapshotSchemaVersion?: number;
};

type ChartView = 'nav' | 'exposure' | 'profit';
type LedgerView = 'snapshots' | 'flows' | 'initial';
type ProfitChartMode = 'hkd' | 'percent';

type BenchmarkPoint = {
  date: string;
  close: number;
};

type BenchmarkSeriesMap = Record<string, BenchmarkPoint[]>;

export default function PerformanceHistoryTab() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshingInitial, setRefreshingInitial] = useState(false);
  const [savingInitial, setSavingInitial] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [chartView, setChartView] = useState<ChartView>('nav');
  const [profitChartMode, setProfitChartMode] = useState<ProfitChartMode>('hkd');
  const [ledgerView, setLedgerView] = useState<LedgerView>('snapshots');
  const [riskFreeRate, setRiskFreeRate] = useState(0);
  const [annualizationFactor, setAnnualizationFactor] = useState(252);
  const [showBenchmark, setShowBenchmark] = useState(false);
  const [benchmarkInput, setBenchmarkInput] = useState('');
  const [benchmarkSymbols, setBenchmarkSymbols] = useState<string[]>(['SPY']);
  const [benchmarkSeriesMap, setBenchmarkSeriesMap] = useState<BenchmarkSeriesMap>({});
  const [benchmarkLoading, setBenchmarkLoading] = useState(false);
  const [benchmarkError, setBenchmarkError] = useState('');

  const [initialState, setInitialState] = useState<InitialPortfolioState | null>(null);
  const [snapshots, setSnapshots] = useState<SnapshotWithExposure[]>([]);
  const [flows, setFlows] = useState<CapitalFlow[]>([]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const saved = JSON.parse(window.localStorage.getItem(SHARPE_SETTINGS_KEY) || '{}');
      if (Number.isFinite(Number(saved.riskFreeRate))) setRiskFreeRate(Number(saved.riskFreeRate));
      if (Number(saved.annualizationFactor) > 0) setAnnualizationFactor(Number(saved.annualizationFactor));
    } catch {
      // Invalid local settings fall back to the defaults.
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(SHARPE_SETTINGS_KEY, JSON.stringify({
      riskFreeRate,
      annualizationFactor,
    }));
  }, [riskFreeRate, annualizationFactor]);

  useEffect(() => {
    let mounted = true;
    let unsubscribe: (() => void) | undefined;

    async function init() {
      try {
        if (!auth.currentUser) {
          // @ts-ignore
          if (typeof window !== 'undefined' && window.__initial_auth_token) await signInWithCustomToken(auth, window.__initial_auth_token);
          else await signInAnonymously(auth);
        }
        unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
          if (!mounted) return;
          setUser(currentUser);
          if (currentUser) await loadAll();
        });
      } catch (err: any) {
        setError(err?.message || '初始化失败');
        setLoading(false);
      }
    }

    void init();
    return () => {
      mounted = false;
      unsubscribe?.();
    };
  }, []);

  async function loadAll() {
    setLoading(true);
    setError('');
    try {
      const [configSnap, snapshotSnap, cashTradeSnap] = await Promise.all([
        getDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', NAV_CONFIG_COLLECTION, 'global')),
        getDocs(collection(db, 'artifacts', APP_ID, 'public', 'data', SNAPSHOT_COLLECTION)),
        getDocs(collection(db, 'artifacts', APP_ID, 'public', 'data', CASH_TRADE_COLLECTION)),
      ]);
      const savedInitialState = configSnap.exists() ? configSnap.data() as InitialPortfolioState : null;
      const cashTrades = cashTradeSnap.docs.map((item) => ({ id: item.id, ...item.data() } as CashTradeRecord));
      setInitialState(savedInitialState);
      setSnapshots(snapshotSnap.docs
        .map((item) => ({ id: item.id, ...item.data() } as SnapshotWithExposure))
        .sort((a, b) => a.snapshotAt.localeCompare(b.snapshotAt)));
      setFlows(await buildCapitalFlowsFromCashTrades(cashTrades, savedInitialState?.fxRates || { HKD: 1 }));
    } catch (err: any) {
      setError(err?.message || '读取净值数据失败');
    } finally {
      setLoading(false);
    }
  }

  async function rebuildInitialStateFromStarts() {
    setRefreshingInitial(true);
    setError('');
    setMessage('');
    try {
      const configs = {} as Record<StartAssetId, StartConfig>;
      const records = {} as Record<StartAssetId, StartRecord[]>;
      await Promise.all(START_ASSETS.map(async (asset) => {
        const [configSnap, recordsSnap] = await Promise.all([
          getDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', asset.collection, '_global_config')),
          getDocs(collection(db, 'artifacts', APP_ID, 'public', 'data', asset.collection)),
        ]);
        configs[asset.id] = configSnap.exists() ? configSnap.data() as StartConfig : {};
        records[asset.id] = recordsSnap.docs
          .filter((item) => item.id !== '_global_config' && item.id !== 'latest_summary')
          .map((item) => ({ id: item.id, ...item.data() } as StartRecord));
      }));
      const nextInitialState = buildInitialPortfolioState({ configs, records });
      setInitialState(nextInitialState);
      setMessage('已读取四个期初库并生成候选净值起点。');
    } catch (err: any) {
      setError(err?.message || '读取期初数据失败');
    } finally {
      setRefreshingInitial(false);
    }
  }

  async function saveInitialState() {
    if (!initialState) return;
    setSavingInitial(true);
    setError('');
    try {
      await setDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', NAV_CONFIG_COLLECTION, 'global'), {
        ...initialState,
        updatedAt: new Date().toISOString(),
      });
      setMessage('已保存为净值曲线起点。');
    } catch (err: any) {
      setError(err?.message || '保存净值起点失败');
    } finally {
      setSavingInitial(false);
    }
  }

  async function deleteSnapshot(snapshot: SnapshotWithExposure) {
    if (!snapshot.id) return;
    if (!window.confirm(`确认删除 ${formatSnapshotTime(snapshot.snapshotAt)} 的快照吗？`)) return;
    await deleteDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', SNAPSHOT_COLLECTION, snapshot.id));
    setSnapshots((prev) => prev.filter((item) => item.id !== snapshot.id));
  }

  function addBenchmarkSymbol() {
    const symbol = benchmarkInput.trim().toUpperCase();
    if (!symbol) return;
    setBenchmarkSymbols((prev) => Array.from(new Set([...prev, symbol])));
    setBenchmarkInput('');
    setBenchmarkSeriesMap({});
    setBenchmarkError('');
  }

  function removeBenchmarkSymbol(symbol: string) {
    setBenchmarkSymbols((prev) => prev.filter((item) => item !== symbol));
    setBenchmarkSeriesMap((prev) => {
      const next = { ...prev };
      delete next[symbol];
      return next;
    });
    setBenchmarkError('');
  }

  async function loadBenchmarkSeries() {
    const symbols = benchmarkSymbols;

    if (!symbols.length) {
      setBenchmarkError('请先用 + 添加至少一个可比指数代码。');
      return;
    }
    if (!chartData.length) {
      setBenchmarkError('暂无净值曲线日期，无法对齐指数。');
      return;
    }

    setBenchmarkLoading(true);
    setBenchmarkError('');
    try {
      const from = chartData[0].date;
      const to = chartData[chartData.length - 1].date;
      const results = await Promise.allSettled(symbols.map(async (symbol) => {
        const response = await fetch(`/api/history?symbol=${encodeURIComponent(symbol)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, {
          cache: 'no-store',
        });
        const payload = await response.json();
        if (!response.ok || !Array.isArray(payload?.data)) {
          throw new Error(`${symbol}: ${payload?.error || '历史行情读取失败'}`);
        }

        const points = payload.data
          .map((item: any) => ({
            date: String(item.date).slice(0, 10),
            close: Number(item.adjClose ?? item.close),
          }))
          .filter((item: BenchmarkPoint) => item.date && Number.isFinite(item.close) && item.close > 0)
          .sort((a: BenchmarkPoint, b: BenchmarkPoint) => a.date.localeCompare(b.date));

        if (!points.length) throw new Error(`${symbol}: 没有获得有效指数行情`);
        return {
          symbol: String(payload.symbol || symbol).toUpperCase(),
          points,
        };
      }));

      const successful = results
        .filter((result): result is PromiseFulfilledResult<{ symbol: string; points: BenchmarkPoint[] }> => result.status === 'fulfilled')
        .map((result) => result.value);
      const failed = results
        .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
        .map((result) => result.reason instanceof Error ? result.reason.message : String(result.reason));

      if (!successful.length) throw new Error(failed.join('；') || '没有获得有效指数行情。');
      setBenchmarkSeriesMap(Object.fromEntries(successful.map((item) => [item.symbol, item.points])));
      setBenchmarkSymbols(successful.map((item) => item.symbol));
      setBenchmarkError(failed.length ? `部分指数读取失败：${failed.join('；')}` : '');
    } catch (err: any) {
      setBenchmarkSeriesMap({});
      setBenchmarkError(err?.message || '可比指数读取失败');
    } finally {
      setBenchmarkLoading(false);
    }
  }

  const navSeries = useMemo(() => calculateNavSeries(initialState, snapshots, flows), [initialState, snapshots, flows]);
  const performanceStats = useMemo(() => calculatePerformanceStats(navSeries), [navSeries]);
  const sharpeRatio = useMemo(
    () => calculateSharpeRatio(navSeries, riskFreeRate, annualizationFactor),
    [navSeries, riskFreeRate, annualizationFactor],
  );

  const chartData = useMemo(() => {
    const snapshotMap = new Map(snapshots.map((snapshot) => [snapshot.snapshotAt, snapshot]));
    const initialExposureMarketValueHKD = initialState
      ? (initialState.initialByAssetHKD.stock || 0)
        + (initialState.initialByAssetHKD.pe || 0)
        + (initialState.initialByAssetHKD.cbbc || 0)
      : null;
    const initialExposureRatio = initialState && initialExposureMarketValueHKD !== null && initialState.initialCapitalHKD !== 0
      ? initialExposureMarketValueHKD / initialState.initialCapitalHKD
      : null;

    return navSeries.map((point, index) => {
      const snapshot = snapshotMap.get(point.snapshotAt);
      const exposureMarketValueHKD = index === 0
        ? initialExposureMarketValueHKD
        : snapshot?.totalExposureMarketValueHKD ?? null;
      const exposureRatio = index === 0
        ? initialExposureRatio
        : snapshot?.exposureRatio
          ?? (exposureMarketValueHKD !== null && point.totalMarketValueHKD !== 0
            ? exposureMarketValueHKD / point.totalMarketValueHKD
            : null);
      const attributionPnlHKD = index === 0 ? 0 : point.totalPnlHKD;
      const initialCapitalHKD = initialState?.initialCapitalHKD || 0;

      return {
        date: point.date,
        snapshotAt: point.snapshotAt,
        unitNav: point.unitNav,
        totalMarketValueHKD: point.totalMarketValueHKD,
        totalExposureMarketValueHKD: exposureMarketValueHKD,
        exposureRatio,
        navPnlHKD: point.cumulativeProfitHKD,
        attributionPnlHKD,
        navPnlPct: point.unitNav - 1,
        attributionPnlPct: initialCapitalHKD !== 0 ? attributionPnlHKD / initialCapitalHKD : null,
      };
    });
  }, [initialState, navSeries, snapshots]);

  const chartDataWithBenchmark = useMemo(() => {
    const symbols = Object.keys(benchmarkSeriesMap);
    if (!showBenchmark || !symbols.length) return chartData;

    const trackers = Object.fromEntries(symbols.map((symbol) => [
      symbol,
      {
        cursor: 0,
        latestClose: null as number | null,
        baseClose: null as number | null,
      },
    ]));

    return chartData.map((point) => {
      const nextPoint: Record<string, any> = { ...point };

      symbols.forEach((symbol) => {
        const series = benchmarkSeriesMap[symbol] || [];
        const tracker = trackers[symbol];
        while (tracker.cursor < series.length && series[tracker.cursor].date <= point.date) {
          tracker.latestClose = series[tracker.cursor].close;
          tracker.cursor += 1;
        }

        const fieldKey = benchmarkFieldKey(symbol);
        if (tracker.latestClose === null) {
          nextPoint[fieldKey] = null;
          return;
        }
        if (tracker.baseClose === null) tracker.baseClose = tracker.latestClose;
        nextPoint[fieldKey] = tracker.baseClose !== 0 ? tracker.latestClose / tracker.baseClose - 1 : null;
      });

      return nextPoint;
    });
  }, [benchmarkSeriesMap, chartData, showBenchmark]);

  const exposurePointCount = chartData.filter((point) => point.totalExposureMarketValueHKD !== null).length;

  if (loading) {
    return <div className="flex min-h-[420px] items-center justify-center"><Loader2 className="animate-spin text-indigo-600" size={36} /></div>;
  }

  return (
    <div className="mx-auto max-w-[1500px] space-y-6 pb-10">
      <header className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div>
            <div className="flex items-center gap-2 text-sm font-black uppercase tracking-wide text-indigo-500">
              <TrendingUp size={18} /> Portfolio Performance
            </div>
            <h1 className="mt-2 text-2xl font-black text-slate-900">净值历史表现</h1>
            <p className="mt-1 text-sm text-slate-500">用期初状态、历史快照和中央资金流水，统一观察净值、暴露与收益变化。</p>
          </div>
          <div className="flex flex-wrap items-end justify-end gap-3">
            <label className="text-xs font-bold text-slate-500">
              无风险利率（年化%）
              <input
                type="number"
                step="0.1"
                value={riskFreeRate}
                onChange={(event) => setRiskFreeRate(Number(event.target.value) || 0)}
                className="mt-1 block w-32 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-right font-mono text-sm text-slate-800 outline-none focus:border-indigo-400"
              />
            </label>
            <label className="text-xs font-bold text-slate-500">
              年化系数
              <input
                type="number"
                min="1"
                step="1"
                value={annualizationFactor}
                onChange={(event) => setAnnualizationFactor(Math.max(1, Number(event.target.value) || 252))}
                className="mt-1 block w-28 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-right font-mono text-sm text-slate-800 outline-none focus:border-indigo-400"
              />
            </label>
            <button onClick={loadAll} className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm hover:bg-slate-50">
              <RefreshCw className="mr-2 inline h-4 w-4" /> 刷新数据
            </button>
          </div>
        </div>
        {error && <div className="mt-4 whitespace-pre-line rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">{error}</div>}
        {message && <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700">{message}</div>}
      </header>

      <section className="grid gap-4 md:grid-cols-4">
        <MetricCard label="最新单位净值" value={formatNumber(performanceStats.latestNav, 4)} />
        <MetricCard label="累计年化收益率" value={formatPercent(performanceStats.annualizedReturn)} tone={performanceStats.annualizedReturn >= 0 ? 'good' : 'bad'} />
        <MetricCard
          label="夏普比例"
          value={sharpeRatio === null ? '--' : formatNumber(sharpeRatio, 3)}
          meta={`Rf ${formatPercent(riskFreeRate / 100)} / ${annualizationFactor}日`}
          tone={sharpeRatio !== null && sharpeRatio >= 0 ? 'good' : sharpeRatio === null ? 'normal' : 'bad'}
        />
        <MetricCard label="最大回撤" value={formatPercent(performanceStats.maxDrawdown)} tone="bad" />
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-black text-slate-900">历史曲线</h2>
            <p className="mt-1 text-xs text-slate-500">选择观察维度；主图与副图上下排布并共享同一时间范围。</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <ViewCard active={chartView === 'nav'} label="净值曲线" note="净资产 / 单位净值" onClick={() => setChartView('nav')} />
            <ViewCard active={chartView === 'exposure'} label="暴露曲线" note="暴露市值 / 暴露比例" onClick={() => setChartView('exposure')} />
            <ViewCard active={chartView === 'profit'} label="收益曲线" note="净值盈亏 / 归因盈亏" onClick={() => setChartView('profit')} />
          </div>
        </div>

        {chartData.length <= 1 ? (
          <div className="mt-5 flex h-[360px] items-center justify-center rounded-2xl bg-slate-50 text-sm text-slate-400">
            保存至少一条 Summary 快照后展示历史曲线。
          </div>
        ) : chartView === 'nav' ? (
          <div className="mt-5 space-y-4">
            <HistoryLineChart
              title="净资产曲线"
              data={chartData}
              lines={[{ key: 'totalMarketValueHKD', label: '净资产HKD', color: '#0f766e' }]}
              valueType="hkd"
            />
            <HistoryLineChart
              title="单位净值曲线"
              data={chartData}
              lines={[{ key: 'unitNav', label: '单位净值', color: '#4f46e5' }]}
              valueType="nav"
              compact
            />
          </div>
        ) : chartView === 'exposure' ? (
          <div className="mt-5 space-y-4">
            {exposurePointCount <= 1 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-bold text-amber-700">
                旧快照不含暴露字段；保存新的 Summary 快照后，暴露历史曲线会逐步形成。期初点采用“期初非现金资产”口径。
              </div>
            )}
            <HistoryLineChart
              title="暴露市值 HKD 曲线"
              data={chartData}
              lines={[{ key: 'totalExposureMarketValueHKD', label: '暴露市值HKD', color: '#0891b2' }]}
              valueType="hkd"
            />
            <HistoryLineChart
              title="暴露比例曲线"
              data={chartData}
              lines={[{ key: 'exposureRatio', label: '暴露比例', color: '#f59e0b' }]}
              valueType="percent"
              compact
            />
          </div>
        ) : (
          <div className="mt-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
              <div>
                <div className="text-sm font-black text-slate-800">收益曲线显示口径</div>
                <div className="mt-1 text-xs text-slate-500">
                  百分比模式下，净值收益率=单位净值-1；归因收益率=归因盈亏HKD/期初净资产。
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                {profitChartMode === 'percent' && (
                  <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-blue-100 bg-white px-3 py-2 shadow-sm">
                    <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-black text-slate-600">
                      <input
                        type="checkbox"
                        checked={showBenchmark}
                        onChange={(event) => setShowBenchmark(event.target.checked)}
                        className="h-4 w-4 rounded border-slate-300 text-blue-600"
                      />
                      可比指数
                    </label>
                    {showBenchmark && (
                      <div className="flex max-w-[520px] flex-wrap items-center gap-2">
                        <div className="flex items-center gap-1">
                          <input
                            value={benchmarkInput}
                            onChange={(event) => setBenchmarkInput(event.target.value.toUpperCase())}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                event.preventDefault();
                                addBenchmarkSymbol();
                              }
                            }}
                            placeholder="SPY / QQQ / ^HSI"
                            className="h-8 w-36 rounded-xl border border-slate-200 bg-slate-50 px-3 font-mono text-xs font-bold text-slate-800 outline-none focus:border-blue-400"
                          />
                          <button
                            type="button"
                            onClick={addBenchmarkSymbol}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-blue-200 bg-blue-50 text-blue-700 transition-colors hover:bg-blue-100"
                            title="添加指数"
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <div className="flex max-w-[260px] flex-wrap items-center gap-1">
                          {benchmarkSymbols.map((symbol) => (
                            <span key={symbol} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 font-mono text-[11px] font-black text-slate-700">
                              {symbol}
                              <button
                                type="button"
                                onClick={() => removeBenchmarkSymbol(symbol)}
                                className="text-slate-400 hover:text-rose-600"
                                title={`删除 ${symbol}`}
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </span>
                          ))}
                        </div>
                        <button
                          type="button"
                          onClick={() => void loadBenchmarkSeries()}
                          disabled={benchmarkLoading || benchmarkSymbols.length === 0}
                          className="inline-flex h-8 items-center gap-1 rounded-xl bg-blue-600 px-3 text-xs font-black text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
                        >
                          {benchmarkLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                          加载
                        </button>
                      </div>
                    )}
                  </div>
                )}
                <div className="inline-flex rounded-2xl border border-slate-200 bg-white p-1 shadow-sm">
                  <button
                    type="button"
                    onClick={() => setProfitChartMode('hkd')}
                    className={`rounded-xl px-3 py-2 text-xs font-black transition-colors ${
                      profitChartMode === 'hkd'
                        ? 'bg-slate-950 text-white'
                        : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900'
                    }`}
                  >
                    金额HKD
                  </button>
                  <button
                    type="button"
                    onClick={() => setProfitChartMode('percent')}
                    className={`rounded-xl px-3 py-2 text-xs font-black transition-colors ${
                      profitChartMode === 'percent'
                        ? 'bg-slate-950 text-white'
                        : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900'
                    }`}
                  >
                    百分比%
                  </button>
                </div>
              </div>
            </div>
            {profitChartMode === 'percent' && showBenchmark && benchmarkError && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-bold text-amber-700">
                {benchmarkError}
              </div>
            )}
            <HistoryLineChart
              title={profitChartMode === 'hkd' ? '收益曲线 HKD' : '收益曲线 %'}
              data={profitChartMode === 'percent' ? chartDataWithBenchmark : chartData}
              lines={profitChartMode === 'hkd'
                ? [
                    { key: 'navPnlHKD', label: '净值盈亏HKD', color: '#2563eb' },
                    { key: 'attributionPnlHKD', label: '归因盈亏HKD', color: '#e11d48' },
                  ]
                : [
                    { key: 'navPnlPct', label: '净值收益率', color: '#2563eb' },
                    { key: 'attributionPnlPct', label: '归因收益率', color: '#e11d48' },
                    ...(showBenchmark
                      ? Object.keys(benchmarkSeriesMap).map((symbol, index) => ({
                          key: benchmarkFieldKey(symbol),
                          label: `${symbol}收益率`,
                          color: BENCHMARK_COLORS[index % BENCHMARK_COLORS.length],
                        }))
                      : []),
                  ]}
              valueType={profitChartMode === 'hkd' ? 'hkd' : 'percent'}
              height={390}
            />
          </div>
        )}
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-black text-slate-900">数据底稿</h2>
            <p className="mt-1 text-xs text-slate-500">历史快照、中央资金出入金与期初状态统一放在此处核对。</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <ViewCard active={ledgerView === 'snapshots'} label="历史快照" note={`${snapshots.length} 条`} onClick={() => setLedgerView('snapshots')} />
            <ViewCard active={ledgerView === 'flows'} label="中央资金出入金" note={`${flows.length} 条`} onClick={() => setLedgerView('flows')} />
            <ViewCard active={ledgerView === 'initial'} label="期初状态" note={initialState?.inceptionDate || '未设置'} onClick={() => setLedgerView('initial')} />
          </div>
        </div>

        {ledgerView === 'snapshots' ? (
          <div className="mt-5 max-h-[460px] overflow-auto rounded-2xl border border-slate-200">
            <table className="w-full min-w-[1180px] text-xs">
              <thead className="sticky top-0 bg-slate-50 text-left text-slate-500">
                <tr>
                  <th className="px-3 py-2">时间</th>
                  <th className="px-3 py-2 text-right">总持仓市值HKD</th>
                  <th className="px-3 py-2 text-right">总暴露市值HKD</th>
                  <th className="px-3 py-2 text-right">暴露比例</th>
                  <th className="px-3 py-2 text-right">净值盈亏HKD</th>
                  <th className="px-3 py-2 text-right">归因盈亏HKD</th>
                  <th className="px-3 py-2 text-right">区间出入金</th>
                  <th className="px-3 py-2 text-right">单位净值</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {snapshots.map((snapshot) => {
                  const navPoint = navSeries.find((point) => point.snapshotAt === snapshot.snapshotAt);
                  return (
                    <tr key={snapshot.id || snapshot.snapshotAt}>
                      <td className="px-3 py-2 font-mono">{formatSnapshotTime(snapshot.snapshotAt)}</td>
                      <td className="px-3 py-2 text-right font-mono">{formatHKD(snapshot.totalMarketValueHKD)}</td>
                      <td className="px-3 py-2 text-right font-mono">{formatOptionalHKD(snapshot.totalExposureMarketValueHKD)}</td>
                      <td className="px-3 py-2 text-right font-mono">{formatOptionalPercent(snapshot.exposureRatio)}</td>
                      <td className={`px-3 py-2 text-right font-mono font-bold ${pnlClass(navPoint?.cumulativeProfitHKD)}`}>
                        {navPoint ? formatHKD(navPoint.cumulativeProfitHKD) : '--'}
                      </td>
                      <td className={`px-3 py-2 text-right font-mono font-bold ${pnlClass(snapshot.totalPnlHKD)}`}>{formatHKD(snapshot.totalPnlHKD)}</td>
                      <td className="px-3 py-2 text-right font-mono">{navPoint ? formatHKD(navPoint.periodNetFlowHKD) : '--'}</td>
                      <td className="px-3 py-2 text-right font-mono font-bold">{navPoint ? formatNumber(navPoint.unitNav, 4) : '--'}</td>
                      <td className="px-3 py-2 text-right">
                        <button onClick={() => deleteSnapshot(snapshot)} className="text-rose-600 hover:text-rose-800" title="删除快照"><Trash2 size={14} /></button>
                      </td>
                    </tr>
                  );
                })}
                {snapshots.length === 0 && <tr><td colSpan={9} className="px-3 py-8 text-center text-slate-400">尚未保存 Summary 快照。</td></tr>}
              </tbody>
            </table>
          </div>
        ) : ledgerView === 'flows' ? (
          <div className="mt-5">
            <p className="mb-3 text-xs leading-5 text-slate-500">
              自动读取 <span className="font-mono font-bold">sip_trade_cash</span> 中 <span className="font-mono font-bold">DEPOSIT_WITHDRAW</span> 类型流水。FX、分红、费用和利息不视为外部出入金。
            </p>
            <div className="max-h-[420px] overflow-auto rounded-2xl border border-slate-200">
              <table className="w-full min-w-[860px] text-xs">
                <thead className="sticky top-0 bg-slate-50 text-left text-slate-500">
                  <tr>
                    <th className="px-3 py-2">日期</th>
                    <th className="px-3 py-2">方向</th>
                    <th className="px-3 py-2">账户</th>
                    <th className="px-3 py-2 text-right">原币金额</th>
                    <th className="px-3 py-2 text-right">折算汇率</th>
                    <th className="px-3 py-2 text-right">金额HKD</th>
                    <th className="px-3 py-2">备注</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {flows.map((flow) => (
                    <tr key={flow.id || `${flow.flowDate}_${flow.amountHKD}`}>
                      <td className="px-3 py-2">{flow.flowDate}</td>
                      <td className={`px-3 py-2 font-bold ${flow.direction === 'IN' ? 'text-emerald-700' : 'text-rose-700'}`}>{flow.direction}</td>
                      <td className="px-3 py-2">{flow.account || '--'}</td>
                      <td className={`px-3 py-2 text-right font-mono ${flow.direction === 'IN' ? 'text-emerald-700' : 'text-rose-700'}`}>
                        {formatSignedNumber(flow.originalAmount || 0, 2)} {flow.currency || 'HKD'}
                      </td>
                      <td className="px-3 py-2 text-right font-mono" title={fxRateSourceLabel(flow.fxRateSource)}>{formatNumber(flow.fxRate || 1, 4)}</td>
                      <td className="px-3 py-2 text-right font-mono">{formatHKD(flow.amountHKD)}</td>
                      <td className="px-3 py-2">{flow.note || '--'}</td>
                    </tr>
                  ))}
                  {flows.length === 0 && <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-400">暂无中央资金出入金记录。</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="mt-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs text-slate-500">四个 start 库的 baseDate 必须完全一致，否则拒绝生成净值起点。</p>
                <div className="mt-3 flex flex-wrap gap-3">
                  <SmallInfo label="期初日期" value={initialState?.inceptionDate || '--'} />
                  <SmallInfo label="期初净资产" value={formatHKD(initialState?.initialCapitalHKD || 0)} />
                  <SmallInfo label="明细条数" value={`${initialState?.details.length || 0} 条`} />
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={rebuildInitialStateFromStarts} disabled={refreshingInitial} className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-black text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">
                  {refreshingInitial ? <Loader2 className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}
                  读取期初底稿
                </button>
                <button onClick={saveInitialState} disabled={!initialState || savingInitial} className="inline-flex items-center gap-2 rounded-full bg-indigo-600 px-4 py-2 text-xs font-black text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50">
                  {savingInitial ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  设为净值起点
                </button>
              </div>
            </div>
            <div className="mt-4 max-h-[360px] overflow-auto rounded-2xl border border-slate-200">
              <table className="w-full min-w-[760px] text-xs">
                <thead className="sticky top-0 bg-slate-50 text-left text-slate-500">
                  <tr>
                    <th className="px-3 py-2">资产</th>
                    <th className="px-3 py-2">账户</th>
                    <th className="px-3 py-2">标的</th>
                    <th className="px-3 py-2 text-right">原币金额</th>
                    <th className="px-3 py-2 text-right">汇率</th>
                    <th className="px-3 py-2 text-right">HKD</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(initialState?.details || []).map((detail) => (
                    <tr key={`${detail.assetId}_${detail.id}`}>
                      <td className="px-3 py-2 font-bold uppercase text-slate-700">{detail.assetId}</td>
                      <td className="px-3 py-2">{detail.account}</td>
                      <td className="px-3 py-2">{detail.label}</td>
                      <td className="px-3 py-2 text-right font-mono">{formatNumber(detail.amountLocal, 2)} {detail.currency}</td>
                      <td className="px-3 py-2 text-right font-mono">{formatNumber(detail.fxRate, 4)}</td>
                      <td className="px-3 py-2 text-right font-mono font-bold">{formatHKD(detail.amountHKD)}</td>
                    </tr>
                  ))}
                  {!initialState && <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-400">尚未读取或保存期初状态。</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function MetricCard({
  label,
  value,
  meta,
  tone = 'normal',
}: {
  label: string;
  value: string;
  meta?: string;
  tone?: 'normal' | 'good' | 'bad';
}) {
  const toneClass = tone === 'good' ? 'text-emerald-700' : tone === 'bad' ? 'text-rose-700' : 'text-slate-900';
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-bold text-slate-400">{label}</div>
      <div className={`mt-2 text-2xl font-black ${toneClass}`}>{value}</div>
      {meta && <div className="mt-1 text-[11px] font-bold text-slate-400">{meta}</div>}
    </div>
  );
}

function ViewCard({
  active,
  label,
  note,
  onClick,
}: {
  active: boolean;
  label: string;
  note: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-w-[150px] rounded-2xl border px-4 py-3 text-left transition ${
        active
          ? 'border-indigo-500 bg-indigo-50 shadow-sm'
          : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
      }`}
    >
      <div className={`text-sm font-black ${active ? 'text-indigo-700' : 'text-slate-700'}`}>{label}</div>
      <div className="mt-1 text-[11px] font-medium text-slate-400">{note}</div>
    </button>
  );
}

function HistoryLineChart({
  title,
  data,
  lines,
  valueType,
  compact = false,
  height,
}: {
  title: string;
  data: Record<string, any>[];
  lines: { key: string; label: string; color: string }[];
  valueType: 'hkd' | 'nav' | 'percent';
  compact?: boolean;
  height?: number;
}) {
  const chartHeight = height || (compact ? 230 : 300);
  const [hiddenLineKeys, setHiddenLineKeys] = useState<Set<string>>(() => new Set());
  const visibleLines = useMemo(
    () => lines.filter((line) => !hiddenLineKeys.has(line.key)),
    [hiddenLineKeys, lines],
  );
  const compressedAxis = buildCompressedTimeAxis(data, visibleLines.map((line) => line.key));
  const tailLabelIndexByKey = useMemo(() => {
    const next: Record<string, number> = {};
    visibleLines.forEach((line) => {
      for (let index = compressedAxis.data.length - 1; index >= 0; index -= 1) {
        const value = compressedAxis.data[index]?.[`${line.key}__history`];
        if (value !== null && value !== undefined && Number.isFinite(Number(value))) {
          next[line.key] = index;
          break;
        }
      }
    });
    return next;
  }, [compressedAxis.data, visibleLines]);
  const toggleLine = (key: string) => {
    setHiddenLineKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-black text-slate-700">{title}</h3>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {lines.map((line) => {
            const hidden = hiddenLineKeys.has(line.key);
            return (
              <button
                key={line.key}
                type="button"
                onClick={() => toggleLine(line.key)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-black transition-colors ${
                  hidden
                    ? 'border-slate-200 bg-white text-slate-300 line-through'
                    : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                }`}
                title={hidden ? '点击显示曲线' : '点击隐藏曲线'}
              >
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: hidden ? '#cbd5e1' : line.color }} />
                {line.label}
              </button>
            );
          })}
          {compressedAxis.hasBreak && (
            <div className="text-[10px] font-bold text-slate-400">虚线为期初至首个快照；波浪处压缩时间跨度</div>
          )}
        </div>
      </div>
      <div style={{ height: chartHeight }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={compressedAxis.data} margin={{ top: 8, right: 112, left: 8, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
            <XAxis
              type="number"
              dataKey="xPosition"
              domain={[0, 100]}
              ticks={compressedAxis.ticks}
              tick={
                <CompressedAxisTick
                  breakPosition={compressedAxis.breakPosition}
                  dateByPosition={compressedAxis.dateByPosition}
                />
              }
              tickLine={false}
              axisLine={{ stroke: '#cbd5e1' }}
              height={34}
            />
            <YAxis tickFormatter={(value) => formatAxisValue(Number(value), valueType)} width={76} />
            <Tooltip content={<HistoryTooltip lines={visibleLines} valueType={valueType} />} />
            {visibleLines.map((line, lineIndex) => (
              <React.Fragment key={line.key}>
                <Line
                  type="linear"
                  dataKey={`${line.key}__initial`}
                  name={line.key}
                  stroke={line.color}
                  strokeWidth={2.2}
                  strokeDasharray="7 6"
                  dot={{ r: 3 }}
                  activeDot={false}
                  connectNulls={false}
                />
                <Line
                  type="monotone"
                  dataKey={`${line.key}__history`}
                  name={line.key}
                  stroke={line.color}
                  strokeWidth={2.6}
                  dot={{ r: 3 }}
                  activeDot={{ r: 5 }}
                  connectNulls={false}
                >
                  <LabelList
                    content={(props: any) => (
                      <TailValueLabel
                        {...props}
                        line={line}
                        lineIndex={lineIndex}
                        tailIndex={tailLabelIndexByKey[line.key]}
                        valueType={valueType}
                      />
                    )}
                  />
                </Line>
              </React.Fragment>
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function TailValueLabel({
  x,
  y,
  value,
  index,
  line,
  lineIndex,
  tailIndex,
  valueType,
}: {
  x?: number;
  y?: number;
  value?: number | string;
  index?: number;
  line: { key: string; label: string; color: string };
  lineIndex: number;
  tailIndex?: number;
  valueType: 'hkd' | 'nav' | 'percent';
}) {
  if (tailIndex === undefined || index !== tailIndex) return null;
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || x === undefined || y === undefined) return null;

  const offsetPattern = [-10, 0, 10, 20, -20, 30];
  const yOffset = offsetPattern[lineIndex % offsetPattern.length];
  const label = formatChartValue(numericValue, valueType);

  return (
    <g aria-label={`${line.label} 最新值 ${label}`}>
      <text
        x={Number(x) + 9}
        y={Number(y) + 4 + yOffset}
        fontSize={11}
        fontWeight={900}
        fill={line.color}
        stroke="#ffffff"
        strokeWidth={4}
        paintOrder="stroke"
      >
        {label}
      </text>
      <text
        x={Number(x) + 9}
        y={Number(y) + 4 + yOffset}
        fontSize={11}
        fontWeight={900}
        fill={line.color}
      >
        {label}
      </text>
    </g>
  );
}

function HistoryTooltip({
  active,
  payload,
  lines,
  valueType,
}: {
  active?: boolean;
  payload?: readonly any[];
  lines: { key: string; label: string; color: string }[];
  valueType: 'hkd' | 'nav' | 'percent';
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload as Record<string, any> | undefined;
  if (!point) return null;

  const values = lines.flatMap((line) => {
    const historyValue = point[`${line.key}__history`];
    const initialValue = point[`${line.key}__initial`];
    const value = historyValue ?? initialValue;
    return value === null || value === undefined ? [] : [{ ...line, value: Number(value) }];
  });
  if (values.length === 0) return null;

  return (
    <div className="rounded-xl border border-slate-200 bg-white/95 px-3 py-2 shadow-lg backdrop-blur">
      <div className="mb-1.5 text-xs font-black text-slate-700">{point.date || '--'}</div>
      <div className="space-y-1">
        {values.map((item) => (
          <div key={item.key} className="flex items-center justify-between gap-5 text-xs">
            <span className="inline-flex items-center gap-2 font-bold text-slate-500">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} />
              {item.label}
            </span>
            <span className="font-mono font-black text-slate-800">{formatChartValue(item.value, valueType)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function buildCompressedTimeAxis(data: Record<string, any>[], lineKeys: string[]) {
  const firstSnapshotPosition = 16;
  const breakPosition = firstSnapshotPosition / 2;
  const hasBreak = data.length > 1;
  const firstSnapshotTime = hasBreak ? chartPointTime(data[1]) : 0;
  const lastSnapshotTime = hasBreak ? chartPointTime(data[data.length - 1]) : firstSnapshotTime;

  const plottedData = data.map((point, index) => {
    let xPosition = 0;
    if (index === 1) {
      xPosition = firstSnapshotPosition;
    } else if (index > 1) {
      const currentTime = chartPointTime(point);
      if (lastSnapshotTime > firstSnapshotTime) {
        xPosition = firstSnapshotPosition
          + ((currentTime - firstSnapshotTime) / (lastSnapshotTime - firstSnapshotTime)) * (100 - firstSnapshotPosition);
      } else {
        xPosition = firstSnapshotPosition
          + ((index - 1) / Math.max(1, data.length - 2)) * (100 - firstSnapshotPosition);
      }
    }

    const plottedPoint: Record<string, any> = { ...point, xPosition };
    lineKeys.forEach((key) => {
      plottedPoint[`${key}__initial`] = index <= 1 ? point[key] : null;
      plottedPoint[`${key}__history`] = index >= 1 ? point[key] : null;
    });
    return plottedPoint;
  });

  const dateByPosition = new Map<string, string>();
  plottedData.forEach((point) => {
    dateByPosition.set(axisPositionKey(point.xPosition), String(point.date || ''));
  });

  const datePositions = plottedData.map((point) => Number(point.xPosition));
  const visibleDatePositions = datePositions.length <= 8
    ? datePositions
    : datePositions.filter((_, index) => (
        index === 0
        || index === 1
        || index === datePositions.length - 1
        || index % Math.ceil(datePositions.length / 6) === 0
      ));
  const ticks = Array.from(new Set([
    ...visibleDatePositions.map((value) => Number(value.toFixed(6))),
    ...(hasBreak ? [breakPosition] : []),
  ])).sort((a, b) => a - b);

  return {
    data: plottedData,
    ticks,
    dateByPosition,
    breakPosition,
    hasBreak,
  };
}

function CompressedAxisTick({
  x = 0,
  y = 0,
  payload,
  breakPosition,
  dateByPosition,
}: {
  x?: number;
  y?: number;
  payload?: { value: number };
  breakPosition: number;
  dateByPosition: Map<string, string>;
}) {
  const value = Number(payload?.value || 0);
  if (Math.abs(value - breakPosition) < 0.0001) {
    return (
      <g aria-label="压缩时间轴">
        <path
          d={`M ${x - 10} ${y + 9} Q ${x - 6} ${y + 3} ${x - 2} ${y + 9} T ${x + 6} ${y + 9} T ${x + 14} ${y + 9}`}
          fill="none"
          stroke="#64748b"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
        <path
          d={`M ${x - 10} ${y + 14} Q ${x - 6} ${y + 8} ${x - 2} ${y + 14} T ${x + 6} ${y + 14} T ${x + 14} ${y + 14}`}
          fill="none"
          stroke="#94a3b8"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
      </g>
    );
  }

  const date = dateByPosition.get(axisPositionKey(value));
  if (!date) return <g />;
  return (
    <g transform={`translate(${x},${y})`}>
      <text x={0} y={16} textAnchor="middle" fill="#64748b" fontSize={11}>
        {formatAxisDate(date)}
      </text>
    </g>
  );
}

function chartPointTime(point: Record<string, any>) {
  const value = String(point.snapshotAt || `${point.date || ''}T00:00:00Z`);
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function axisPositionKey(value: number) {
  return Number(value).toFixed(6);
}

function benchmarkFieldKey(symbol: string) {
  return `benchmarkReturnPct_${symbol.replace(/[^A-Z0-9]/gi, '_')}`;
}

function formatAxisDate(value: string) {
  const parts = value.split('-');
  return parts.length === 3 ? `${parts[1]}-${parts[2]}` : value;
}

function formatSnapshotTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date).replace(/\//g, '-');
}

function SmallInfo({ label, value }: { label: string; value: string }) {
  return <div className="min-w-[150px] rounded-2xl bg-slate-50 p-3"><div className="text-xs text-slate-400">{label}</div><div className="mt-1 font-black text-slate-800">{value}</div></div>;
}

function calculateSharpeRatio(points: NavPoint[], riskFreeRatePercent: number, annualizationFactor: number) {
  if (points.length < 3 || annualizationFactor <= 0) return null;

  const normalizedReturns = points.slice(1).map((point, index) => {
    const previous = points[index];
    const days = Math.max(1, daysBetween(previous.date, point.date));
    return Math.pow(Math.max(1 + point.periodReturn, 0.000001), 1 / days) - 1;
  }).filter(Number.isFinite);
  if (normalizedReturns.length < 2) return null;

  const mean = normalizedReturns.reduce((sum, value) => sum + value, 0) / normalizedReturns.length;
  const variance = normalizedReturns.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0)
    / (normalizedReturns.length - 1);
  const standardDeviation = Math.sqrt(Math.max(variance, 0));
  if (standardDeviation <= 0.0000000001) return null;

  const annualRiskFreeRate = Math.max(riskFreeRatePercent / 100, -0.999999);
  const perPeriodRiskFreeRate = Math.pow(1 + annualRiskFreeRate, 1 / annualizationFactor) - 1;
  return ((mean - perPeriodRiskFreeRate) / standardDeviation) * Math.sqrt(annualizationFactor);
}

function daysBetween(from: string, to: string) {
  const fromTime = new Date(`${from}T00:00:00Z`).getTime();
  const toTime = new Date(`${to}T00:00:00Z`).getTime();
  return Math.max(1, Math.round((toTime - fromTime) / 86400000));
}

function fxRateSourceLabel(source?: CapitalFlow['fxRateSource']) {
  if (source === 'history') return '使用出入金日期附近的历史汇率';
  if (source === 'hkd') return 'HKD 本币，固定按 1 折算';
  if (source === 'saved') return '历史汇率不可用，回退到已保存汇率';
  if (source === 'fallback') return '历史汇率和保存汇率均不可用，临时按 1 折算';
  return '汇率来源未知';
}

function formatAxisValue(value: number, type: 'hkd' | 'nav' | 'percent') {
  if (type === 'percent') return `${(value * 100).toFixed(0)}%`;
  if (type === 'nav') return value.toFixed(3);
  const abs = Math.abs(value);
  if (abs >= 100000000) return `${(value / 100000000).toFixed(1)}亿`;
  if (abs >= 10000) return `${(value / 10000).toFixed(0)}万`;
  return value.toFixed(0);
}

function formatChartValue(value: number, type: 'hkd' | 'nav' | 'percent') {
  if (type === 'percent') return formatPercent(value);
  if (type === 'nav') return formatNumber(value, 4);
  return formatHKD(value);
}

function formatHKD(value: number) {
  return `HK$${Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

function formatOptionalHKD(value?: number | null) {
  return value === null || value === undefined ? '--' : formatHKD(value);
}

function formatOptionalPercent(value?: number | null) {
  return value === null || value === undefined ? '--' : formatPercent(value);
}

function formatNumber(value: number, digits = 2) {
  return Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function formatSignedNumber(value: number, digits = 2) {
  const num = Number(value || 0);
  return `${num > 0 ? '+' : ''}${formatNumber(num, digits)}`;
}

function formatPercent(value: number) {
  return `${(Number(value || 0) * 100).toFixed(2)}%`;
}

function pnlClass(value?: number) {
  if (value === undefined) return 'text-slate-400';
  if (value > 0) return 'text-emerald-700';
  if (value < 0) return 'text-rose-700';
  return 'text-slate-600';
}
