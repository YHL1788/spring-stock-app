'use client';

import { useEffect, useMemo, useState } from 'react';
import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, writeBatch } from 'firebase/firestore';
import { signInAnonymously } from 'firebase/auth';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Database,
  Play,
  RefreshCw,
  Save,
  Shield,
  SlidersHorizontal,
} from 'lucide-react';
import {
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
import { auth, db, APP_ID } from '@/app/lib/stockService';
import { useStockPool } from '@/app/hooks/useStockPool';
import {
  MarketQuote,
  PchipContestConfig,
  PriceCurrency,
  PriceTargetPoint,
  ResearcherView,
  SimulationTradeLedger,
  VoiceWeight,
  buildAccountSnapshots,
  buildVoiceWeights,
  businessDaysBetween,
  generateDailyTrades,
  hasNonMonotonicValue,
  normalizePoints,
  rebuildPositions,
  selectEffectiveViews,
  symbolKey,
  targetValueForPrice,
} from './pchipContest';

const CONFIG_COLLECTION = 'pchip_contest_config';
const VIEWS_COLLECTION = 'pchip_researcher_views';
const RUNS_COLLECTION = 'pchip_simulation_runs';
const TRADES_COLLECTION = 'pchip_simulation_trades';
const REAFFIRM_COLLECTION = 'pchip_reaffirm_logs';

const DEFAULT_CONFIG: PchipContestConfig = {
  startDate: todayInput(),
  maxCapitalHKD: 10_000_000,
  tradingCostRate: 0.001,
  minTradeValueHKD: 10_000,
  weightPnlToleranceRatio: 0.001,
  reaffirmCycleDays: 20,
  halfLifeTradingDays: 20,
  targetCurrency: 'HKD',
};

const EMPTY_VIEW: ResearcherView = {
  id: '',
  researcherName: '',
  symbol: '',
  market: 'HKD',
  stockName: '',
  priceCurrency: 'HKD',
  effectiveDate: todayInput(),
  versionNo: 1,
  allowNonMonotonic: false,
  status: 'active',
  note: '',
  points: [
    { price: 10, targetValueHKD: 5_000_000 },
    { price: 15, targetValueHKD: 3_000_000 },
    { price: 20, targetValueHKD: 1_000_000 },
  ],
  createdAt: '',
  updatedAt: '',
  lastConfidenceAt: '',
};

const LINE_COLORS = ['#0f766e', '#ea580c', '#2563eb', '#be123c', '#7c3aed', '#0f172a'];

type SimulationRunRecord = {
  id: string;
  runDate: string;
  status?: string;
  createdAt?: string;
  tradeCount?: number;
  activeViewCount?: number;
};

type RunReport = {
  startedAt: string;
  finishedAt?: string;
  fromDate: string;
  toDate: string;
  requestedDays: number;
  successDays: Array<{ date: string; tradeCount: number }>;
  skippedDays: Array<{ date: string; reason: string }>;
  missingQuotes: Array<{ date: string; symbols: string[] }>;
  marketHolidays: Array<{ date: string; market: string; symbols: string[] }>;
  fxFallbacks: Array<{ date: string; currency: string }>;
  generatedTradeCount: number;
};

export default function PchipContestPage() {
  const { stocks: stockPool } = useStockPool();
  const [config, setConfig] = useState<PchipContestConfig>(DEFAULT_CONFIG);
  const [views, setViews] = useState<ResearcherView[]>([]);
  const [trades, setTrades] = useState<SimulationTradeLedger[]>([]);
  const [runs, setRuns] = useState<SimulationRunRecord[]>([]);
  const [quotes, setQuotes] = useState<Record<string, MarketQuote>>({});
  const [viewForm, setViewForm] = useState<ResearcherView>(EMPTY_VIEW);
  const [runDate, setRunDate] = useState(todayInput());
  const [selectedSymbol, setSelectedSymbol] = useState('');
  const [symbolSearch, setSymbolSearch] = useState('');
  const [historyGroupKey, setHistoryGroupKey] = useState('');
  const [showImportModal, setShowImportModal] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [runReport, setRunReport] = useState<RunReport | null>(null);
  const [showRunReportModal, setShowRunReportModal] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState('');
  const [tradeSort, setTradeSort] = useState<{ key: string; dir: 'asc' | 'desc' | null }>({ key: 'date', dir: 'desc' });
  const [tradeFilters, setTradeFilters] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkProgress, setBulkProgress] = useState('');
  const [resetting, setResetting] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    void loadAll();
  }, []);

  useEffect(() => {
    if (!selectedSymbol && views.length > 0) setSelectedSymbol(symbolKey(views[0].symbol, views[0].market));
  }, [selectedSymbol, views]);

  const positions = useMemo(() => rebuildPositions(trades, quotes), [trades, quotes]);
  const accounts = useMemo(() => buildAccountSnapshots(positions, config.maxCapitalHKD, trades), [positions, config.maxCapitalHKD, trades]);
  const activeViews = useMemo(() => views.filter((view) => view.status === 'active'), [views]);
  const effectiveViews = useMemo(() => selectEffectiveViews(views, runDate), [views, runDate]);
  const voiceWeights = useMemo(() => buildVoiceWeights(effectiveViews, positions, runDate, config), [effectiveViews, positions, runDate, config]);
  const symbols = useMemo(() => {
    const map = new Map<string, { key: string; symbol: string; market: string; stockName: string }>();
    views.forEach((view) => map.set(symbolKey(view.symbol, view.market), {
      key: symbolKey(view.symbol, view.market),
      symbol: view.symbol,
      market: view.market,
      stockName: view.stockName,
    }));
    return Array.from(map.values()).sort((a, b) => a.symbol.localeCompare(b.symbol));
  }, [views]);

  const selectedViews = useMemo(() => effectiveViews.filter((view) => symbolKey(view.symbol, view.market) === selectedSymbol), [effectiveViews, selectedSymbol]);
  const selectedQuote = selectedViews[0] ? quotes[symbolKey(selectedViews[0].symbol, selectedViews[0].market)] : undefined;
  const selectedWeights = useMemo(() => voiceWeights.filter((weight) => symbolKey(weight.symbol, weight.market) === selectedSymbol), [voiceWeights, selectedSymbol]);
  const chartData = useMemo(() => buildCurveChartData(selectedViews, selectedWeights, selectedQuote), [selectedViews, selectedWeights, selectedQuote]);
  const displayTrades = useMemo(() => filterAndSortTrades(trades, tradeFilters, tradeSort), [trades, tradeFilters, tradeSort]);
  const reminders = useMemo(() => activeViews.map((view) => {
    const staleDays = businessDaysBetween(view.lastConfidenceAt || view.effectiveDate || view.updatedAt, todayInput());
    return { view, staleDays, needReaffirm: staleDays >= config.reaffirmCycleDays };
  }).filter((item) => item.needReaffirm), [activeViews, config.reaffirmCycleDays]);
  const selectedMasterTarget = useMemo(() => {
    if (!selectedQuote) return 0;
    return selectedViews.reduce((sum, view) => {
      const weight = selectedWeights.find((item) => item.researcherName === view.researcherName)?.weight || 0;
      return sum + weight * targetValueForPrice(view.points, selectedQuote.close, selectedQuote.fxToHKD);
    }, 0);
  }, [selectedQuote, selectedViews, selectedWeights]);
  const lastRunDate = useMemo(() => runs.map((run) => run.runDate).filter(Boolean).sort().at(-1) || '--', [runs]);
  const contestBusinessDays = useMemo(() => businessDaysBetween(config.startDate, todayInput()) + 1, [config.startDate]);
  const filteredSymbols = useMemo(() => {
    const needle = symbolSearch.trim().toLowerCase();
    if (!needle) return symbols;
    return symbols.filter((item) => `${item.symbol} ${item.stockName} ${item.market}`.toLowerCase().includes(needle));
  }, [symbols, symbolSearch]);

  async function ensureAuth() {
    if (!auth.currentUser) await signInAnonymously(auth);
  }

  async function loadAll() {
    setLoading(true);
    setError('');
    try {
      await ensureAuth();
      const [configSnap, viewSnap, tradeSnap, runSnap] = await Promise.all([
        getDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', CONFIG_COLLECTION, 'global')),
        getDocs(query(collection(db, 'artifacts', APP_ID, 'public', 'data', VIEWS_COLLECTION))),
        getDocs(query(collection(db, 'artifacts', APP_ID, 'public', 'data', TRADES_COLLECTION))),
        getDocs(query(collection(db, 'artifacts', APP_ID, 'public', 'data', RUNS_COLLECTION))),
      ]);
      const loadedViews = viewSnap.docs.map((item) => normalizeLoadedView({ id: item.id, ...item.data() } as ResearcherView));
      const loadedTrades = tradeSnap.docs.map((item) => ({ id: item.id, ...item.data() } as SimulationTradeLedger));
      const loadedRuns = runSnap.docs.map((item) => ({ id: item.id, ...item.data() } as SimulationRunRecord));
      setConfig(configSnap.exists() ? { ...DEFAULT_CONFIG, ...configSnap.data() } as PchipContestConfig : DEFAULT_CONFIG);
      setViews(loadedViews.sort((a, b) => `${a.symbol}-${a.researcherName}`.localeCompare(`${b.symbol}-${b.researcherName}`)));
      setTrades(loadedTrades.sort((a, b) => `${a.date}-${a.createdAt}`.localeCompare(`${b.date}-${b.createdAt}`)));
      setRuns(loadedRuns.sort((a, b) => String(b.runDate || '').localeCompare(String(a.runDate || ''))));
      await refreshQuotes(loadedViews);
    } catch (err: any) {
      setError(err?.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }

  async function refreshQuotes(sourceViews = views) {
    const unique = Array.from(new Map(sourceViews.map((view) => [symbolKey(view.symbol, view.market), view])).values());
    const entries = await Promise.all(unique.map(async (view) => {
      const quote = await fetchQuote(view);
      return quote ? [symbolKey(view.symbol, view.market), quote] as const : null;
    }));
    const nextQuotes: Record<string, MarketQuote> = {};
    entries.forEach((entry) => {
      if (entry) nextQuotes[entry[0]] = entry[1];
    });
    setQuotes((prev) => ({ ...prev, ...nextQuotes }));
    return nextQuotes;
  }

  async function fetchQuote(view: Pick<ResearcherView, 'symbol' | 'market' | 'priceCurrency' | 'stockName'>): Promise<MarketQuote | null> {
    if (!view.symbol.trim()) return null;
    try {
      const res = await fetch(`/api/quote?symbol=${encodeURIComponent(view.symbol.trim())}&t=${Date.now()}`);
      if (!res.ok) throw new Error('quote failed');
      const data = await res.json();
      const currency = normalizeCurrency(data.currency || view.priceCurrency || view.market);
      return {
        symbol: view.symbol.trim().toUpperCase(),
        close: Number(data.price || 0),
        priceCurrency: currency,
        fxToHKD: Number(data.fxRateUsed || (currency === 'HKD' ? 1 : 0)) || 1,
        name: data.name || view.stockName,
      };
    } catch {
      return null;
    }
  }

  async function saveConfig() {
    setSaving(true);
    setError('');
    try {
      await ensureAuth();
      await setDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', CONFIG_COLLECTION, 'global'), config, { merge: true });
      setMessage('全局参数已保存');
    } catch (err: any) {
      setError(err?.message || '保存参数失败');
    } finally {
      setSaving(false);
    }
  }

  async function saveView() {
    const points = normalizePoints(viewForm.points);
    if (!viewForm.researcherName.trim() || !viewForm.symbol.trim() || points.length < 2) {
      setError('请至少填写研究员、股票代码，并输入两个有效价格点。');
      return;
    }
    if (!viewForm.allowNonMonotonic && hasNonMonotonicValue(points)) {
      setError('当前曲线不是单调递减。如确认为右侧/区间策略，请勾选“允许非单调曲线”。');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await ensureAuth();
      const now = new Date().toISOString();
      const id = viewForm.id || `${viewForm.researcherName.trim()}_${viewForm.symbol.trim()}_${Date.now()}`.replace(/[^\w.-]+/g, '_');
      const existingVersions = views.filter((item) => (
        item.id !== viewForm.id &&
        item.researcherName.trim() === viewForm.researcherName.trim() &&
        item.symbol.trim().toUpperCase() === viewForm.symbol.trim().toUpperCase() &&
        item.market.trim().toUpperCase() === (viewForm.market.trim().toUpperCase() || viewForm.priceCurrency)
      ));
      const nextVersionNo = viewForm.id ? viewForm.versionNo || 1 : Math.max(0, ...existingVersions.map((item) => item.versionNo || 1)) + 1;
      const payload: ResearcherView = {
        ...viewForm,
        id,
        researcherName: viewForm.researcherName.trim(),
        symbol: viewForm.symbol.trim().toUpperCase(),
        market: viewForm.market.trim().toUpperCase() || viewForm.priceCurrency,
        stockName: viewForm.stockName.trim() || viewForm.symbol.trim().toUpperCase(),
        effectiveDate: viewForm.effectiveDate || runDate,
        versionNo: nextVersionNo,
        points,
        createdAt: viewForm.createdAt || now,
        updatedAt: now,
        lastConfidenceAt: viewForm.id ? now.slice(0, 10) : (viewForm.effectiveDate || runDate),
      };
      await setDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', VIEWS_COLLECTION, id), payload, { merge: true });
      setViews((prev) => [payload, ...prev.filter((item) => item.id !== id)].sort((a, b) => `${a.symbol}-${a.researcherName}`.localeCompare(`${b.symbol}-${b.researcherName}`)));
      setViewForm({ ...EMPTY_VIEW, effectiveDate: runDate });
      setSelectedSymbol(symbolKey(payload.symbol, payload.market));
      await refreshQuotes([payload]);
      setMessage('研究员观点已保存');
    } catch (err: any) {
      setError(err?.message || '保存观点失败');
    } finally {
      setSaving(false);
    }
  }

  async function reaffirmView(view: ResearcherView) {
    const today = runDate || todayInput();
    const payload = { reaffirmedAt: today, lastConfidenceAt: today };
    setSaving(true);
    setError('');
    try {
      await ensureAuth();
      await setDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', VIEWS_COLLECTION, view.id), payload, { merge: true });
      await setDoc(doc(collection(db, 'artifacts', APP_ID, 'public', 'data', REAFFIRM_COLLECTION)), {
        viewId: view.id,
        researcherName: view.researcherName,
        symbol: view.symbol,
        market: view.market,
        reaffirmedAt: today,
        createdAt: new Date().toISOString(),
      });
      setViews((prev) => prev.map((item) => item.id === view.id ? { ...item, ...payload } : item));
      setMessage(`${view.researcherName} 对 ${view.symbol} 的观点已重申`);
    } catch (err: any) {
      setError(err?.message || '重申失败');
    } finally {
      setSaving(false);
    }
  }

  async function toggleViewStatus(view: ResearcherView) {
    const status = view.status === 'active' ? 'paused' : 'active';
    setSaving(true);
    try {
      await ensureAuth();
      await setDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', VIEWS_COLLECTION, view.id), { status }, { merge: true });
      setViews((prev) => prev.map((item) => item.id === view.id ? { ...item, status } : item));
    } finally {
      setSaving(false);
    }
  }

  async function deleteView(view: ResearcherView) {
    const confirmed = window.confirm(`确定删除 ${view.researcherName} 对 ${view.symbol} 的 v${view.versionNo || 1} 观点吗？历史交易流水不会被删除。`);
    if (!confirmed) return;

    setSaving(true);
    setError('');
    try {
      await ensureAuth();
      await deleteDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', VIEWS_COLLECTION, view.id));
      setViews((prev) => prev.filter((item) => item.id !== view.id));
      setMessage(`已删除 ${view.researcherName} / ${view.symbol} 的 v${view.versionNo || 1} 观点。`);
    } catch (err: any) {
      setError(err?.message || '删除观点失败');
    } finally {
      setSaving(false);
    }
  }

  async function runSimulation() {
    if (runs.some((run) => run.runDate === runDate)) {
      setError(`${runDate} 已经运行过。为了保持流水可追溯，第一版暂不允许重复运行同一天。`);
      return;
    }
    if (activeViews.length === 0) {
      setError('暂无有效研究员观点，无法模拟运行。');
      return;
    }
    setRunning(true);
    setError('');
    setMessage('');
    try {
      await ensureAuth();
      const freshQuotes = await refreshQuotes(activeViews);
      const mergedQuotes = { ...quotes, ...freshQuotes };
      const missing = activeViews.filter((view) => !mergedQuotes[symbolKey(view.symbol, view.market)]);
      if (missing.length > 0) throw new Error(`以下股票缺少行情，无法运行：${missing.map((item) => item.symbol).join(', ')}`);
      const viewsForRun = selectEffectiveViews(activeViews, runDate);
      if (viewsForRun.length === 0) throw new Error('当前运行日没有已生效的研究员观点。');

      const runId = `run_${runDate}_${Date.now()}`;
      const previousPositions = rebuildPositions(trades.filter((trade) => trade.date < runDate), mergedQuotes);
      const generated = generateDailyTrades({ runId, runDate, config, views: viewsForRun, previousPositions, quotes: mergedQuotes });
      if (generated.length === 0) throw new Error('本次没有生成任何模拟交易记录，请检查观点和行情。');

      const now = new Date().toISOString();
      const batch = writeBatch(db);
      const persistedTrades: SimulationTradeLedger[] = generated.map((trade) => {
        const ref = doc(collection(db, 'artifacts', APP_ID, 'public', 'data', TRADES_COLLECTION));
        const payload = { ...trade, id: ref.id, createdAt: now };
        batch.set(ref, payload);
        return payload;
      });
      const runPayload: SimulationRunRecord & {
        tradingCostRate: number;
        minTradeValueHKD: number;
        maxCapitalHKD: number;
      } = {
        id: runId,
        runDate,
        status: 'success',
        createdAt: now,
        tradingCostRate: config.tradingCostRate,
        minTradeValueHKD: config.minTradeValueHKD,
        maxCapitalHKD: config.maxCapitalHKD,
        tradeCount: persistedTrades.length,
        activeViewCount: activeViews.length,
      };
      batch.set(doc(db, 'artifacts', APP_ID, 'public', 'data', RUNS_COLLECTION, runId), runPayload);
      await batch.commit();

      setTrades((prev) => [...prev, ...persistedTrades].sort((a, b) => `${a.date}-${a.createdAt}`.localeCompare(`${b.date}-${b.createdAt}`)));
      setRuns((prev) => [runPayload, ...prev]);
      setMessage(`模拟运行完成：生成 ${persistedTrades.length} 条日频交易流水。`);
    } catch (err: any) {
      setError(err?.message || '模拟运行失败');
    } finally {
      setRunning(false);
    }
  }

  async function runSimulationToToday() {
    const today = todayInput();
    const runDates = getPendingRunDates(config.startDate, today, runs.map((run) => run.runDate));
    if (runDates.length === 0) {
      setMessage('没有需要补跑的交易日。');
      return;
    }
    const confirmed = window.confirm(`将从 ${runDates[0]} 一键模拟至 ${runDates[runDates.length - 1]}，共 ${runDates.length} 个工作日。历史股票价格使用日线收盘价；历史汇率缺失时会使用当前汇率替代。是否继续？`);
    if (!confirmed) return;

      setBulkRunning(true);
      setError('');
      setMessage('');
      setRunReport(null);
      setBulkProgress('正在获取历史行情...');
    try {
      await ensureAuth();
      const historyMap = await fetchHistoricalQuoteMap(activeViews, runDates[0], runDates[runDates.length - 1]);
      const existingRunDates = new Set(runs.map((run) => run.runDate));
      const newRuns: SimulationRunRecord[] = [];
      const newTrades: SimulationTradeLedger[] = [];
      let accumulatedTrades = [...trades];
      let skippedDays = 0;
      const report: RunReport = {
        startedAt: new Date().toISOString(),
        fromDate: runDates[0],
        toDate: runDates[runDates.length - 1],
        requestedDays: runDates.length,
        successDays: [],
        skippedDays: [],
        missingQuotes: [],
        marketHolidays: [],
        fxFallbacks: [],
        generatedTradeCount: 0,
      };

      for (let index = 0; index < runDates.length; index += 1) {
        const date = runDates[index];
        setBulkProgress(`正在模拟 ${date} (${index + 1}/${runDates.length})`);
        if (existingRunDates.has(date)) continue;

        const viewsForRun = selectEffectiveViews(activeViews, date);
        const quoteStatus = buildQuotesForDateWithReport(viewsForRun, historyMap, date);
        const quotesForRun = quoteStatus.quotes;
        quoteStatus.marketHolidays.forEach((item) => report.marketHolidays.push(item));
        quoteStatus.missingQuotes.forEach((item) => report.missingQuotes.push(item));
        if (Object.keys(quotesForRun).length === 0) {
          skippedDays += 1;
          report.skippedDays.push({ date, reason: quoteStatus.marketHolidays.length ? '全部有效市场休市或无行情' : '缺少全部历史行情或无有效观点' });
          continue;
        }

        const runId = `run_${date}_${Date.now()}_${index}`;
        const previousPositions = rebuildPositions(accumulatedTrades.filter((trade) => trade.date < date), quotesForRun);
        const generated = generateDailyTrades({ runId, runDate: date, config, views: viewsForRun, previousPositions, quotes: quotesForRun });
        if (generated.length === 0) {
          skippedDays += 1;
          report.skippedDays.push({ date, reason: '无有效观点或无交易记录生成' });
          continue;
        }

        const now = new Date().toISOString();
        const persistedTrades: SimulationTradeLedger[] = generated.map((trade, tradeIndex) => ({
          ...trade,
          id: `pending_${runId}_${tradeIndex}`,
          createdAt: now,
        }));
        const runPayload: SimulationRunRecord & {
          tradingCostRate: number;
          minTradeValueHKD: number;
          maxCapitalHKD: number;
        } = {
          id: runId,
          runDate: date,
          status: 'success',
          createdAt: now,
          tradingCostRate: config.tradingCostRate,
          minTradeValueHKD: config.minTradeValueHKD,
          maxCapitalHKD: config.maxCapitalHKD,
          tradeCount: persistedTrades.length,
          activeViewCount: viewsForRun.length,
        };
        newTrades.push(...persistedTrades);
        newRuns.push(runPayload);
        report.successDays.push({ date, tradeCount: persistedTrades.length });
        report.generatedTradeCount += persistedTrades.length;
        accumulatedTrades = [...accumulatedTrades, ...persistedTrades];
      }

      if (newTrades.length === 0) {
        report.finishedAt = new Date().toISOString();
        setRunReport(report);
        setMessage(`一键模拟结束，但没有生成新流水。跳过 ${skippedDays} 个缺少行情或无有效观点的日期。`);
        return;
      }

      const persisted = await persistBulkRunsAndTrades(newRuns, newTrades);
      report.finishedAt = new Date().toISOString();
      setRunReport(report);
      setTrades((prev) => [...prev, ...persisted.trades].sort((a, b) => `${a.date}-${a.createdAt}`.localeCompare(`${b.date}-${b.createdAt}`)));
      setRuns((prev) => [...persisted.runs, ...prev].sort((a, b) => b.runDate.localeCompare(a.runDate)));
      setMessage(`一键模拟完成：新增 ${persisted.runs.length} 个运行日、${persisted.trades.length} 条交易流水。${skippedDays ? `跳过 ${skippedDays} 日。` : ''}`);
    } catch (err: any) {
      setError(err?.message || '一键模拟至今失败');
    } finally {
      setBulkRunning(false);
      setBulkProgress('');
    }
  }

  async function persistBulkRunsAndTrades(runsToPersist: SimulationRunRecord[], tradesToPersist: SimulationTradeLedger[]) {
    const finalRuns = runsToPersist;
    const finalTrades: SimulationTradeLedger[] = [];
    const writes: Array<{ path: string; id: string; data: any; collectionName: string }> = [];

    runsToPersist.forEach((run) => {
      writes.push({ path: RUNS_COLLECTION, id: run.id, data: run, collectionName: RUNS_COLLECTION });
    });
    tradesToPersist.forEach((trade) => {
      const ref = doc(collection(db, 'artifacts', APP_ID, 'public', 'data', TRADES_COLLECTION));
      const payload = { ...trade, id: ref.id };
      finalTrades.push(payload);
      writes.push({ path: TRADES_COLLECTION, id: ref.id, data: payload, collectionName: TRADES_COLLECTION });
    });

    for (let i = 0; i < writes.length; i += 430) {
      const batch = writeBatch(db);
      writes.slice(i, i + 430).forEach((item) => {
        batch.set(doc(db, 'artifacts', APP_ID, 'public', 'data', item.collectionName, item.id), item.data);
      });
      await batch.commit();
    }

    return { runs: finalRuns, trades: finalTrades };
  }

  async function resetContest() {
    const confirmed = window.confirm('确定要重置比赛吗？这会删除所有模拟运行记录、交易流水和重申日志，但会保留研究员观点与全局参数。');
    if (!confirmed) return;

    setResetting(true);
    setError('');
    setMessage('');
    try {
      await ensureAuth();
      const [tradeSnap, runSnap, reaffirmSnap] = await Promise.all([
        getDocs(query(collection(db, 'artifacts', APP_ID, 'public', 'data', TRADES_COLLECTION))),
        getDocs(query(collection(db, 'artifacts', APP_ID, 'public', 'data', RUNS_COLLECTION))),
        getDocs(query(collection(db, 'artifacts', APP_ID, 'public', 'data', REAFFIRM_COLLECTION))),
      ]);
      const refs = [
        ...tradeSnap.docs.map((item) => item.ref),
        ...runSnap.docs.map((item) => item.ref),
        ...reaffirmSnap.docs.map((item) => item.ref),
      ];

      for (let i = 0; i < refs.length; i += 450) {
        const batch = writeBatch(db);
        refs.slice(i, i + 450).forEach((ref) => batch.delete(ref));
        await batch.commit();
      }

      setTrades([]);
      setRuns([]);
      setMessage(`比赛已重置：删除 ${refs.length} 条模拟相关记录，研究员观点已保留。`);
    } catch (err: any) {
      setError(err?.message || '重置比赛失败');
    } finally {
      setResetting(false);
    }
  }

  function applyStockSuggestion(symbol: string) {
    const normalized = symbol.trim().toUpperCase();
    const stock = stockPool.find((item: any) => String(item.symbol || '').toUpperCase() === normalized || String(item.yahoo || '').toUpperCase() === normalized);
    setViewForm((prev) => ({
      ...prev,
      symbol: normalized,
      stockName: stock?.name || stock?.stockName || stock?.company_name || prev.stockName,
      market: normalizeCurrency(stock?.currency || prev.market),
      priceCurrency: normalizeCurrency(stock?.currency || prev.priceCurrency),
    }));
  }

  function updatePoint(index: number, point: PriceTargetPoint) {
    setViewForm((prev) => ({ ...prev, points: prev.points.map((item, i) => i === index ? point : item) }));
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#f4f1ea] px-6 py-10 text-slate-900">
        <div className="mx-auto flex max-w-6xl items-center gap-3 rounded-[2rem] border border-stone-200 bg-white p-8 shadow-sm">
          <RefreshCw className="h-5 w-5 animate-spin text-teal-700" />
          <span className="font-medium">正在读取 PCHIP 模拟大赛数据...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f4f1ea] px-4 py-6 text-slate-950 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="overflow-hidden rounded-[2.2rem] border border-stone-200 bg-[#10231f] text-white shadow-xl shadow-stone-300/40">
          <div className="relative grid gap-8 p-7 lg:grid-cols-[1.35fr_0.65fr] lg:p-9">
            <div className="absolute -right-20 -top-24 h-72 w-72 rounded-full bg-teal-300/20 blur-3xl" />
            <div className="relative">
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm text-teal-50">
                <Activity className="h-4 w-4" />
                模拟交易大赛模式
              </div>
              <h1 className="text-3xl font-black tracking-tight sm:text-5xl">日频PCHIP插值策略</h1>
              <p className="mt-4 max-w-3xl text-sm leading-7 text-teal-50/85 sm:text-base">
                研究员用价格-目标市值曲线表达观点；系统每日按收盘价运行模拟，资金不足时等比例砍仓，并用单股票净绝对PnL与观点新鲜度生成话语权。
              </p>
            </div>
            <div className="relative rounded-[1.7rem] border border-white/15 bg-white/10 p-5 backdrop-blur">
              <div className="text-sm text-teal-50/75">比赛状态</div>
              <div className="mt-3 text-3xl font-black">{formatHKD(config.maxCapitalHKD)}</div>
              <div className="mt-1 text-sm text-teal-50/70">初始资金 / 每位研究员</div>
              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <MiniStat label="上一次模拟" value={lastRunDate} />
                <MiniStat label="比赛工作日" value={`${contestBusinessDays} 日`} />
              </div>
            </div>
          </div>
        </header>

        {(message || error) && (
          <div className={`rounded-3xl border px-5 py-4 text-sm ${error ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
            {error || message}
          </div>
        )}

        <section className="grid gap-5 lg:grid-cols-[1fr_1.1fr_0.9fr]">
          <Panel title="全局比赛参数" icon={<SlidersHorizontal className="h-5 w-5" />}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="起始日"><input className="input" type="date" value={config.startDate} onChange={(e) => setConfig({ ...config, startDate: e.target.value })} /></Field>
              <Field label="模拟运行日"><input className="input" type="date" value={runDate} onChange={(e) => setRunDate(e.target.value)} /></Field>
              <Field label="可使用最大资金 HKD"><input className="input" type="number" value={config.maxCapitalHKD} onChange={(e) => setConfig({ ...config, maxCapitalHKD: Number(e.target.value) || 0 })} /></Field>
              <Field label="单边交易成本率 %"><input className="input" type="number" step="0.01" value={config.tradingCostRate * 100} onChange={(e) => setConfig({ ...config, tradingCostRate: (Number(e.target.value) || 0) / 100 })} /></Field>
              <Field label="最低交易额 HKD"><input className="input" type="number" value={config.minTradeValueHKD} onChange={(e) => setConfig({ ...config, minTradeValueHKD: Number(e.target.value) || 0 })} /></Field>
              <Field label="权重PnL容忍比例 %"><input className="input" type="number" step="0.01" value={(config.weightPnlToleranceRatio || 0) * 100} onChange={(e) => setConfig({ ...config, weightPnlToleranceRatio: (Number(e.target.value) || 0) / 100 })} /></Field>
              <Field label="维护周期 工作日"><input className="input" type="number" value={config.reaffirmCycleDays} onChange={(e) => setConfig({ ...config, reaffirmCycleDays: Number(e.target.value) || 1 })} /></Field>
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              <button className="btn-secondary" onClick={saveConfig} disabled={saving}><Save className="h-4 w-4" /> 保存参数</button>
              <button className="btn-primary" onClick={runSimulation} disabled={running || saving}><Play className="h-4 w-4" /> {running ? '运行中...' : '模拟运行'}</button>
              <button className="btn-secondary" onClick={runSimulationToToday} disabled={running || saving || bulkRunning}>
                <RefreshCw className={`h-4 w-4 ${bulkRunning ? 'animate-spin' : ''}`} /> {bulkRunning ? '补跑中...' : '一键模拟至今'}
              </button>
              <button className="btn-danger" onClick={resetContest} disabled={running || saving || resetting}>
                <RefreshCw className="h-4 w-4" /> {resetting ? '重置中...' : '重置比赛'}
              </button>
            </div>
            {bulkProgress && <div className="mt-3 rounded-2xl bg-teal-50 px-4 py-2 text-sm font-bold text-teal-700">{bulkProgress}</div>}
            {runReport && <RunReportPanel report={runReport} openDetails={() => setShowRunReportModal(true)} />}
          </Panel>

          <Panel title="研究员账户排名" icon={<Shield className="h-5 w-5" />}>
            <div className="grid gap-3 sm:grid-cols-3">
              {accounts.length === 0 ? <EmptyHint text="暂无账户流水。先录入观点并运行一次模拟。" /> : accounts.slice(0, 3).map((account, index) => (
                <div key={account.researcherName} className="rounded-3xl border border-stone-200 bg-gradient-to-br from-white to-stone-50 p-4">
                  <div className="flex items-center justify-between text-xs text-slate-500"><span>#{index + 1}</span><span>{account.stockCount} 股票</span></div>
                  <div className="mt-2 text-lg font-black">{account.researcherName}</div>
                  <div className={`mt-2 text-xl font-black ${account.totalPnlHKD >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{formatHKD(account.totalPnlHKD)}</div>
                  <div className="mt-2 text-xs text-slate-500">市值 {formatHKD(account.grossMarketValueHKD)}</div>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="待重申提醒" icon={<Clock3 className="h-5 w-5" />}>
            {reminders.length === 0 ? (
              <div className="flex items-center gap-2 rounded-3xl bg-emerald-50 p-4 text-sm text-emerald-700"><CheckCircle2 className="h-5 w-5" /> 当前没有超过维护周期的观点。</div>
            ) : (
              <div className="space-y-3">
                {reminders.slice(0, 4).map(({ view, staleDays }) => (
                  <div key={view.id} className="rounded-3xl border border-amber-200 bg-amber-50 p-4 text-sm">
                    <div className="flex items-start gap-2 font-bold text-amber-800"><AlertTriangle className="mt-0.5 h-4 w-4" /> {view.researcherName} / {view.symbol}</div>
                    <div className="mt-1 text-amber-700">观点已持续 {staleDays} 个工作日。</div>
                    <button className="mt-3 rounded-full bg-amber-900 px-3 py-1.5 text-xs font-bold text-white" onClick={() => reaffirmView(view)}>重申观点</button>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </section>

        <section className="grid gap-5 lg:grid-cols-[0.95fr_1.05fr]">
          <Panel title="股票话语权" icon={<Database className="h-5 w-5" />}>
            <div className="mb-4 grid gap-3 sm:grid-cols-[1fr_1.1fr]">
              <input
                className="input"
                value={symbolSearch}
                onChange={(event) => setSymbolSearch(event.target.value)}
                placeholder="搜索股票代码 / 名称 / 市场"
              />
              <select className="input" value={selectedSymbol} onChange={(event) => setSelectedSymbol(event.target.value)}>
                <option value="">选择股票</option>
                {filteredSymbols.map((item) => (
                  <option key={item.key} value={item.key}>{item.symbol} · {item.stockName || item.market}</option>
                ))}
              </select>
              <div className="text-xs text-slate-500 sm:col-span-2">
                当前容忍金额：{formatHKD(config.maxCapitalHKD * (config.weightPnlToleranceRatio || 0))}。轻微亏损不会直接让话语权归零。
              </div>
            </div>
            <SimpleWeightTable weights={selectedWeights} />
          </Panel>

          <Panel title="PCHIP观点曲线与合成线" icon={<Activity className="h-5 w-5" />}>
            <div className="mb-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-3xl bg-slate-950 p-4 text-white">
                <div className="text-xs text-slate-300">当前合成建议</div>
                <div className="mt-2 text-2xl font-black">{formatHKD(selectedMasterTarget)}</div>
              </div>
              <div className="rounded-3xl bg-stone-100 p-4">
                <div className="text-xs text-slate-500">当前价格</div>
                <div className="mt-2 text-xl font-black">{selectedQuote ? `${formatNumber(selectedQuote.close, 3)} ${selectedQuote.priceCurrency}` : '--'}</div>
              </div>
              <div className="rounded-3xl bg-stone-100 p-4">
                <div className="text-xs text-slate-500">参与曲线</div>
                <div className="mt-2 text-xl font-black">{selectedViews.length} 条</div>
              </div>
            </div>
            <div className="h-[360px]">
              {chartData.length === 0 ? <EmptyHint text="录入观点并获取行情后，这里会展示研究员曲线和合成曲线。" /> : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 12, right: 24, left: 0, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
                    <XAxis
                      dataKey="price"
                      type="number"
                      domain={['dataMin', 'dataMax']}
                      tickCount={9}
                      tickFormatter={(value) => formatAxisPrice(Number(value))}
                      stroke="#78716c"
                      tick={{ fontSize: 12, fill: '#57534e' }}
                      label={{ value: `股价 (${selectedQuote?.priceCurrency || '本币'})`, position: 'insideBottom', offset: -2, fill: '#57534e', fontSize: 12 }}
                    />
                    <YAxis
                      domain={[0, (dataMax: number) => Math.max(dataMax * 1.12, 1)]}
                      tickCount={7}
                      width={92}
                      tickFormatter={(value) => compactHKD(Number(value))}
                      stroke="#78716c"
                      tick={{ fontSize: 12, fill: '#57534e' }}
                      label={{ value: '目标市值 (HKD)', angle: -90, position: 'insideLeft', fill: '#57534e', fontSize: 12 }}
                    />
                    <Tooltip
                      formatter={(value: any, name: any) => [formatHKD(Number(value)), String(name)]}
                      labelFormatter={(label) => `股价 ${formatFullPrice(Number(label), selectedQuote?.priceCurrency)}`}
                      contentStyle={{ borderRadius: 16, borderColor: '#e7e5e4', boxShadow: '0 12px 28px rgba(15,23,42,.12)' }}
                    />
                    <Legend />
                    {selectedQuote && <ReferenceLine x={selectedQuote.close} stroke="#0f172a" strokeDasharray="4 4" label="当前价" />}
                    <Line type="monotone" dataKey="合成曲线" stroke="#111827" strokeWidth={4} dot={false} />
                    {selectedViews.map((view, index) => (
                      <Line key={view.id} type="monotone" dataKey={view.researcherName} stroke={LINE_COLORS[index % LINE_COLORS.length]} strokeWidth={2} dot={false} opacity={0.82} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </Panel>
        </section>

        <section className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
          <Panel title={viewForm.id ? '编辑研究员观点' : '新增研究员观点'} icon={<Save className="h-5 w-5" />}>
            <ViewEditor
              stockPool={stockPool}
              viewForm={viewForm}
              setViewForm={setViewForm}
              applyStockSuggestion={applyStockSuggestion}
              updatePoint={updatePoint}
              saveView={saveView}
              saving={saving}
              openImport={() => setShowImportModal(true)}
              openExport={() => setShowExportModal(true)}
            />
          </Panel>
          <Panel title="观点清单" icon={<Database className="h-5 w-5" />}>
            <ViewsTable
              views={views}
              runDate={runDate}
              setSelectedSymbol={setSelectedSymbol}
              setViewForm={setViewForm}
              reaffirmView={reaffirmView}
              toggleViewStatus={toggleViewStatus}
              deleteView={deleteView}
              openHistory={setHistoryGroupKey}
            />
          </Panel>
        </section>

        <section>
          <Panel title="账户概览" icon={<Activity className="h-5 w-5" />}>
            <AccountOverview accounts={accounts} openAccount={setSelectedAccount} />
          </Panel>
        </section>

        <section>
          <Panel title="交易流水" icon={<Database className="h-5 w-5" />}>
            <TradesTable
              trades={displayTrades}
              tradeSort={tradeSort}
              setTradeSort={setTradeSort}
              tradeFilters={tradeFilters}
              setTradeFilters={setTradeFilters}
            />
          </Panel>
        </section>
      </div>

      {historyGroupKey && (
        <VersionHistoryModal
          groupKey={historyGroupKey}
          views={views}
          runDate={runDate}
          close={() => setHistoryGroupKey('')}
          setSelectedSymbol={setSelectedSymbol}
          editView={(view) => {
            setViewForm(view);
            setHistoryGroupKey('');
          }}
          reaffirmView={reaffirmView}
          toggleViewStatus={toggleViewStatus}
          deleteView={deleteView}
        />
      )}

      {selectedAccount && (
        <AccountPositionModal
          researcherName={selectedAccount}
          positions={positions}
          account={accounts.find((item) => item.researcherName === selectedAccount)}
          config={config}
          close={() => setSelectedAccount('')}
        />
      )}

      {showImportModal && (
        <ExcelImportModal
          close={() => setShowImportModal(false)}
          stockPool={stockPool}
          existingViews={views}
          runDate={runDate}
          ensureAuth={ensureAuth}
          onImported={(importedViews) => {
            setViews((prev) => [...importedViews, ...prev].sort((a, b) => `${a.symbol}-${a.researcherName}`.localeCompare(`${b.symbol}-${b.researcherName}`)));
            if (importedViews[0]) setSelectedSymbol(symbolKey(importedViews[0].symbol, importedViews[0].market));
            void refreshQuotes(importedViews);
            setMessage(`已导入 ${importedViews.length} 条研究员观点。`);
          }}
        />
      )}

      {showExportModal && (
        <ViewExportModal
          close={() => setShowExportModal(false)}
          views={views}
        />
      )}

      {runReport && showRunReportModal && (
        <RunReportModal report={runReport} close={() => setShowRunReportModal(false)} />
      )}

      <style jsx global>{`
        .input { width: 100%; border-radius: 1rem; border: 1px solid #e7e5e4; background: #fff; padding: 0.7rem 0.9rem; color: #0f172a; outline: none; transition: border-color .15s ease, box-shadow .15s ease; }
        .input:focus { border-color: #0f766e; box-shadow: 0 0 0 3px rgba(15, 118, 110, .14); }
        .btn-primary { display: inline-flex; align-items: center; gap: .45rem; border-radius: 999px; background: #10231f; padding: .72rem 1.05rem; font-size: .875rem; font-weight: 800; color: #fff; box-shadow: 0 10px 22px rgba(16, 35, 31, .18); }
        .btn-primary:disabled { opacity: .55; cursor: not-allowed; }
        .btn-secondary { display: inline-flex; align-items: center; gap: .45rem; border-radius: 999px; border: 1px solid #d6d3d1; background: #fff; padding: .72rem 1.05rem; font-size: .875rem; font-weight: 800; color: #334155; }
        .btn-danger { display: inline-flex; align-items: center; gap: .45rem; border-radius: 999px; border: 1px solid #fecdd3; background: #fff1f2; padding: .72rem 1.05rem; font-size: .875rem; font-weight: 800; color: #be123c; }
        .btn-danger:disabled { opacity: .55; cursor: not-allowed; }
        .table-btn { border-radius: 999px; border: 1px solid #e7e5e4; background: #fff; padding: .35rem .7rem; font-size: .75rem; font-weight: 800; color: #475569; }
        .table-btn:hover { border-color: #0f766e; color: #0f766e; }
        .table-btn-danger { border-radius: 999px; border: 1px solid #fecdd3; background: #fff1f2; padding: .35rem .7rem; font-size: .75rem; font-weight: 800; color: #be123c; }
        .table-btn-danger:hover { border-color: #fb7185; color: #9f1239; }
      `}</style>
    </div>
  );
}

function ViewEditor(props: {
  stockPool: any[];
  viewForm: ResearcherView;
  setViewForm: (view: ResearcherView) => void;
  applyStockSuggestion: (symbol: string) => void;
  updatePoint: (index: number, point: PriceTargetPoint) => void;
  saveView: () => void;
  saving: boolean;
  openImport: () => void;
  openExport: () => void;
}) {
  const { stockPool, viewForm, setViewForm, applyStockSuggestion, updatePoint, saveView, saving, openImport, openExport } = props;
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="研究员"><input className="input" value={viewForm.researcherName} onChange={(e) => setViewForm({ ...viewForm, researcherName: e.target.value })} placeholder="例如 张三" /></Field>
        <Field label="股票代码">
          <input className="input" list="pchip-stock-pool" value={viewForm.symbol} onChange={(e) => applyStockSuggestion(e.target.value)} placeholder="例如 0175.HK" />
          <datalist id="pchip-stock-pool">
            {stockPool.map((stock: any) => <option key={stock.symbol} value={stock.symbol}>{stock.name || stock.stockName || stock.symbol}</option>)}
          </datalist>
        </Field>
        <Field label="股票名称"><input className="input" value={viewForm.stockName} onChange={(e) => setViewForm({ ...viewForm, stockName: e.target.value })} /></Field>
        <Field label="价格币种/市场">
          <select className="input" value={viewForm.priceCurrency} onChange={(e) => setViewForm({ ...viewForm, priceCurrency: e.target.value as PriceCurrency, market: e.target.value })}>
            <option value="HKD">HKD</option>
            <option value="USD">USD</option>
            <option value="CNY">CNY</option>
            <option value="JPY">JPY</option>
          </select>
        </Field>
        <Field label="观点生效日">
          <input className="input" type="date" value={viewForm.effectiveDate || todayInput()} onChange={(e) => setViewForm({ ...viewForm, effectiveDate: e.target.value })} />
        </Field>
        <Field label="版本号">
          <input className="input" type="number" value={viewForm.versionNo || 1} disabled />
        </Field>
      </div>
      <label className="mt-4 flex items-center gap-2 text-sm font-bold text-slate-700">
        <input type="checkbox" checked={viewForm.allowNonMonotonic} onChange={(e) => setViewForm({ ...viewForm, allowNonMonotonic: e.target.checked })} />
        允许非单调曲线
      </label>
      <div className="mt-4 space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-sm font-black text-slate-700">价格-目标市值点</div>
          <button className="rounded-full border border-stone-200 px-3 py-1.5 text-xs font-bold" onClick={() => setViewForm({ ...viewForm, points: [...viewForm.points, { price: 0, targetValueHKD: 0 }] })}>新增点</button>
        </div>
        {viewForm.points.map((point, index) => (
          <div key={index} className="grid grid-cols-[1fr_1fr_auto] gap-2">
            <input className="input" type="number" value={point.price} onChange={(e) => updatePoint(index, { ...point, price: Number(e.target.value) })} placeholder="价格" />
            <input className="input" type="number" value={point.targetValueHKD} onChange={(e) => updatePoint(index, { ...point, targetValueHKD: Number(e.target.value) })} placeholder="目标市值HKD" />
            <button className="rounded-2xl border border-rose-100 bg-rose-50 px-3 text-sm font-bold text-rose-700" onClick={() => setViewForm({ ...viewForm, points: viewForm.points.filter((_, i) => i !== index) })}>删</button>
          </div>
        ))}
      </div>
      <Field label="备注" className="mt-4">
        <textarea className="input min-h-24" value={viewForm.note} onChange={(e) => setViewForm({ ...viewForm, note: e.target.value })} placeholder="记录这条曲线背后的投资假设" />
      </Field>
      <div className="mt-4 flex flex-wrap gap-3">
        <button className="btn-primary" onClick={saveView} disabled={saving}><Save className="h-4 w-4" /> 保存观点</button>
        <button className="btn-secondary" onClick={openImport} disabled={saving}><Database className="h-4 w-4" /> Excel导入</button>
        <button className="btn-secondary" onClick={openExport} disabled={saving}><Database className="h-4 w-4" /> 一键导出</button>
        {viewForm.id && <button className="btn-secondary" onClick={() => setViewForm(EMPTY_VIEW)}>取消编辑</button>}
      </div>
    </>
  );
}

function ViewsTable(props: {
  views: ResearcherView[];
  runDate: string;
  setSelectedSymbol: (symbol: string) => void;
  setViewForm: (view: ResearcherView) => void;
  reaffirmView: (view: ResearcherView) => void;
  toggleViewStatus: (view: ResearcherView) => void;
  deleteView: (view: ResearcherView) => void;
  openHistory: (groupKey: string) => void;
}) {
  const { views, runDate, setSelectedSymbol, setViewForm, reaffirmView, toggleViewStatus, deleteView, openHistory } = props;
  const groups = useMemo(() => groupViewsByResearcherStock(views, runDate), [views, runDate]);
  return (
    <div className="overflow-auto rounded-3xl border border-stone-200">
      <table className="min-w-[820px] w-full text-sm">
        <thead className="bg-stone-100 text-left text-xs uppercase tracking-wide text-slate-500">
          <tr><th className="px-4 py-3">研究员</th><th className="px-4 py-3">股票</th><th className="px-4 py-3">版本</th><th className="px-4 py-3">生效日</th><th className="px-4 py-3">信心日</th><th className="px-4 py-3">状态</th><th className="px-4 py-3 text-right">操作</th></tr>
        </thead>
        <tbody className="divide-y divide-stone-100 bg-white">
          {groups.length === 0 ? <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-500">暂无观点。</td></tr> : groups.map((group) => {
            const view = group.currentView;
            const staleDays = businessDaysBetween(view.lastConfidenceAt || view.updatedAt, runDate);
            return (
              <tr key={group.groupKey}>
                <td className="px-4 py-3 font-bold">{view.researcherName}</td>
                <td className="px-4 py-3"><button className="font-bold text-teal-700" onClick={() => setSelectedSymbol(symbolKey(view.symbol, view.market))}>{view.symbol}</button><div className="text-xs text-slate-500">{view.stockName}</div></td>
                <td className="px-4 py-3">v{view.versionNo || 1}<div className="text-xs text-slate-400">{group.versions.length} 个版本</div></td>
                <td className="px-4 py-3">{view.effectiveDate || '--'}</td>
                <td className="px-4 py-3">{view.lastConfidenceAt}<div className="text-xs text-slate-400">{staleDays} 工作日</div></td>
                <td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-xs font-bold ${view.status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-stone-100 text-stone-500'}`}>{view.status === 'active' ? '有效' : '暂停'}</span></td>
                <td className="px-4 py-3 text-right"><div className="flex justify-end gap-2"><button className="table-btn" onClick={() => openHistory(group.groupKey)}>历史版本</button><button className="table-btn" onClick={() => setViewForm(view)}>编辑当前</button><button className="table-btn" onClick={() => reaffirmView(view)}>重申</button><button className="table-btn" onClick={() => toggleViewStatus(view)}>{view.status === 'active' ? '暂停' : '启用'}</button><button className="table-btn-danger" onClick={() => deleteView(view)}>删除</button></div></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SimpleWeightTable({ weights }: { weights: VoiceWeight[] }) {
  return (
    <div className="overflow-hidden rounded-3xl border border-stone-200">
      <table className="w-full text-sm">
        <thead className="bg-stone-100 text-left text-xs uppercase tracking-wide text-slate-500">
          <tr><th className="px-4 py-3">研究员</th><th className="px-4 py-3 text-right">总PnL</th><th className="px-4 py-3 text-right">新鲜度</th><th className="px-4 py-3 text-right">话语权</th></tr>
        </thead>
        <tbody className="divide-y divide-stone-100 bg-white">
          {weights.length === 0 ? <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-500">选择一只已有观点的股票查看话语权。</td></tr> : weights.map((weight) => (
            <tr key={`${weight.researcherName}-${weight.symbol}`}>
              <td className="px-4 py-3 font-bold">{weight.researcherName}</td>
              <td className={`px-4 py-3 text-right font-bold ${weight.totalPnlHKD >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{formatHKD(weight.totalPnlHKD)}</td>
              <td className="px-4 py-3 text-right">{formatPercent(weight.freshnessDecay)}<div className="text-xs text-slate-400">{weight.daysSinceLastConfidence}日</div></td>
              <td className="px-4 py-3 text-right text-lg font-black">{formatPercent(weight.weight)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TradesTable(props: {
  trades: SimulationTradeLedger[];
  tradeSort: { key: string; dir: 'asc' | 'desc' | null };
  setTradeSort: React.Dispatch<React.SetStateAction<{ key: string; dir: 'asc' | 'desc' | null }>>;
  tradeFilters: Record<string, string>;
  setTradeFilters: React.Dispatch<React.SetStateAction<Record<string, string>>>;
}) {
  const { trades, tradeSort, setTradeSort, tradeFilters, setTradeFilters } = props;
  const toggleSort = (key: string) => {
    setTradeSort((prev) => {
      if (prev.key === key) {
        if (prev.dir === 'asc') return { key, dir: 'desc' };
        if (prev.dir === 'desc') return { key: '', dir: null };
      }
      return { key, dir: 'asc' };
    });
  };
  const updateFilter = (key: string, value: string) => setTradeFilters((prev) => ({ ...prev, [key]: value }));

  return (
    <div className="max-h-[560px] overflow-auto rounded-3xl border border-stone-200">
      <table className="min-w-[980px] w-full text-sm">
        <thead className="sticky top-0 z-10 bg-stone-100 text-left text-xs uppercase tracking-wide text-slate-500 shadow-[0_1px_0_0_#e7e5e4]">
          <tr>
            <TradeTh label="交易日期" sortKey="date" filterKey="date" tradeSort={tradeSort} toggleSort={toggleSort} filters={tradeFilters} updateFilter={updateFilter} />
            <TradeTh label="账户" sortKey="account" filterKey="account" tradeSort={tradeSort} toggleSort={toggleSort} filters={tradeFilters} updateFilter={updateFilter} align="center" />
            <TradeTh label="名称/代码" sortKey="code" filterKey="code" tradeSort={tradeSort} toggleSort={toggleSort} filters={tradeFilters} updateFilter={updateFilter} />
            <TradeTh label="币种" sortKey="market" filterKey="market" tradeSort={tradeSort} toggleSort={toggleSort} filters={tradeFilters} updateFilter={updateFilter} align="center" />
            <TradeTh label="方向" sortKey="direction" filterKey="direction" tradeSort={tradeSort} toggleSort={toggleSort} filters={tradeFilters} updateFilter={updateFilter} align="center" />
            <TradeTh label="数量" sortKey="quantity" tradeSort={tradeSort} toggleSort={toggleSort} filters={tradeFilters} updateFilter={updateFilter} align="right" />
            <TradeTh label="均价(含费)" sortKey="price" tradeSort={tradeSort} toggleSort={toggleSort} filters={tradeFilters} updateFilter={updateFilter} align="right" />
            <TradeTh label="金额(含费HKD)" sortKey="amount" tradeSort={tradeSort} toggleSort={toggleSort} filters={tradeFilters} updateFilter={updateFilter} align="right" />
            <TradeTh label="原始目标" sortKey="rawTargetValueHKD" tradeSort={tradeSort} toggleSort={toggleSort} filters={tradeFilters} updateFilter={updateFilter} align="right" />
            <TradeTh label="缩放" sortKey="scaleRatio" tradeSort={tradeSort} toggleSort={toggleSort} filters={tradeFilters} updateFilter={updateFilter} align="right" />
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100 bg-white">
          {trades.length === 0 ? <tr><td colSpan={10} className="px-4 py-8 text-center text-slate-500">暂无交易流水。</td></tr> : trades.map((trade) => (
            <tr key={trade.id}>
              <td className="px-4 py-3">{trade.date}</td>
              <td className="px-4 py-3 text-center font-bold">{trade.account || trade.researcherName}</td>
              <td className="px-4 py-3"><div className="font-bold">{trade.name || trade.stockName}</div><div className="text-xs text-slate-400">{trade.code || trade.symbol}</div></td>
              <td className="px-4 py-3 text-center font-mono">{trade.market}</td>
              <td className="px-4 py-3 text-center"><span className={`rounded-full px-2 py-1 text-xs font-bold ${trade.direction === 'BUY' ? 'bg-rose-50 text-rose-700' : trade.direction === 'SELL' ? 'bg-emerald-50 text-emerald-700' : 'bg-stone-100 text-stone-500'}`}>{trade.direction || trade.side}</span></td>
              <td className={`px-4 py-3 text-right font-mono font-bold ${trade.quantity >= 0 ? 'text-rose-700' : 'text-emerald-700'}`}>{trade.quantity > 0 ? '+' : ''}{formatNumber(trade.quantity || trade.tradeShares, 4)}</td>
              <td className="px-4 py-3 text-right font-mono">{formatNumber(trade.price || trade.tradePrice, 4)}</td>
              <td className={`px-4 py-3 text-right font-mono font-bold ${trade.amount >= 0 ? 'text-rose-700' : 'text-emerald-700'}`}>{trade.amount > 0 ? '+' : ''}{formatHKD(trade.amount ?? trade.tradeValueHKD)}</td>
              <td className="px-4 py-3 text-right">{formatHKD(trade.rawTargetValueHKD)}</td>
              <td className="px-4 py-3 text-right">{formatPercent(trade.scaleRatio)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TradeTh(props: {
  label: string;
  sortKey: string;
  filterKey?: string;
  tradeSort: { key: string; dir: 'asc' | 'desc' | null };
  toggleSort: (key: string) => void;
  filters: Record<string, string>;
  updateFilter: (key: string, value: string) => void;
  align?: 'left' | 'center' | 'right';
}) {
  const { label, sortKey, filterKey, tradeSort, toggleSort, filters, updateFilter, align = 'left' } = props;
  const textClass = align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left';
  const justifyClass = align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : 'justify-start';
  const marker = tradeSort.key === sortKey ? (tradeSort.dir === 'asc' ? '▲' : tradeSort.dir === 'desc' ? '▼' : '') : '';
  return (
    <th className={`px-3 py-2 align-top ${textClass}`}>
      <button className={`flex w-full items-center gap-1 ${justifyClass} font-bold hover:text-slate-900`} onClick={() => toggleSort(sortKey)}>
        {label}<span className="text-[10px] text-teal-700">{marker}</span>
      </button>
      {filterKey && (
        <input
          className={`mt-1 w-full rounded border border-stone-300 px-2 py-1 text-[11px] font-normal text-slate-700 outline-none focus:border-teal-600 ${textClass}`}
          value={filters[filterKey] || ''}
          onChange={(event) => updateFilter(filterKey, event.target.value)}
          placeholder="筛选"
          onClick={(event) => event.stopPropagation()}
        />
      )}
    </th>
  );
}

function VersionHistoryModal(props: {
  groupKey: string;
  views: ResearcherView[];
  runDate: string;
  close: () => void;
  setSelectedSymbol: (symbol: string) => void;
  editView: (view: ResearcherView) => void;
  reaffirmView: (view: ResearcherView) => void;
  toggleViewStatus: (view: ResearcherView) => void;
  deleteView: (view: ResearcherView) => void;
}) {
  const { groupKey, views, runDate, close, setSelectedSymbol, editView, reaffirmView, toggleViewStatus, deleteView } = props;
  const group = groupViewsByResearcherStock(views, runDate).find((item) => item.groupKey === groupKey);
  if (!group) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4 py-6 backdrop-blur-sm">
      <div className="max-h-[88vh] w-full max-w-5xl overflow-hidden rounded-[2rem] bg-white shadow-2xl">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-stone-200 bg-stone-50 px-6 py-5">
          <div>
            <div className="text-xs font-black uppercase tracking-wide text-slate-500">历史版本</div>
            <h3 className="mt-1 text-2xl font-black text-slate-900">{group.currentView.researcherName} / {group.currentView.symbol}</h3>
            <p className="mt-1 text-sm text-slate-500">{group.currentView.stockName} · 当前运行日有效版本为 v{group.currentView.versionNo || 1}</p>
          </div>
          <button className="rounded-full border border-stone-300 bg-white px-4 py-2 text-sm font-bold text-slate-700" onClick={close}>关闭</button>
        </div>
        <div className="max-h-[68vh] overflow-auto p-6">
          <div className="overflow-hidden rounded-3xl border border-stone-200">
            <table className="min-w-[920px] w-full text-sm">
              <thead className="bg-stone-100 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">版本</th>
                  <th className="px-4 py-3">生效日</th>
                  <th className="px-4 py-3">信心日</th>
                  <th className="px-4 py-3">点数</th>
                  <th className="px-4 py-3">状态</th>
                  <th className="px-4 py-3">备注</th>
                  <th className="px-4 py-3 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100 bg-white">
                {group.versions.map((view) => {
                  const staleDays = businessDaysBetween(view.lastConfidenceAt || view.updatedAt, runDate);
                  const isCurrent = view.id === group.currentView.id;
                  return (
                    <tr key={view.id} className={isCurrent ? 'bg-emerald-50/50' : ''}>
                      <td className="px-4 py-3 font-black">v{view.versionNo || 1}{isCurrent ? <div className="text-xs text-emerald-700">当前有效</div> : null}</td>
                      <td className="px-4 py-3">{view.effectiveDate || '--'}</td>
                      <td className="px-4 py-3">{view.lastConfidenceAt}<div className="text-xs text-slate-400">{staleDays} 工作日</div></td>
                      <td className="px-4 py-3">{normalizePoints(view.points).length}</td>
                      <td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-xs font-bold ${view.status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-stone-100 text-stone-500'}`}>{view.status === 'active' ? '有效' : '暂停'}</span></td>
                      <td className="max-w-[220px] truncate px-4 py-3 text-slate-500">{view.note || '--'}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-2">
                          <button className="table-btn" onClick={() => { setSelectedSymbol(symbolKey(view.symbol, view.market)); editView(view); }}>编辑</button>
                          <button className="table-btn" onClick={() => reaffirmView(view)}>重申</button>
                          <button className="table-btn" onClick={() => toggleViewStatus(view)}>{view.status === 'active' ? '暂停' : '启用'}</button>
                          <button className="table-btn-danger" onClick={() => deleteView(view)}>删除</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

type ParsedImportRow = {
  rowNo: number;
  researcherName: string;
  symbol: string;
  effectiveDate: string;
  pointText: string;
  valueText: string;
  note: string;
  points: PriceTargetPoint[];
  stockName: string;
  market: string;
  priceCurrency: PriceCurrency;
  versionNo: number;
  errors: string[];
  warnings: string[];
};

function ExcelImportModal(props: {
  close: () => void;
  stockPool: any[];
  existingViews: ResearcherView[];
  runDate: string;
  ensureAuth: () => Promise<void>;
  onImported: (views: ResearcherView[]) => void;
}) {
  const { close, stockPool, existingViews, runDate, ensureAuth, onImported } = props;
  const [pasteText, setPasteText] = useState('');
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const parsedRows = useMemo(() => parseExcelImportRows(pasteText, stockPool, existingViews, runDate), [pasteText, stockPool, existingViews, runDate]);
  const errorCount = parsedRows.reduce((sum, row) => sum + row.errors.length, 0);
  const validRows = parsedRows.filter((row) => row.errors.length === 0);

  async function importRows() {
    if (validRows.length === 0 || errorCount > 0) return;
    setImporting(true);
    setError('');
    try {
      await ensureAuth();
      const now = new Date().toISOString();
      const batch = writeBatch(db);
      const importedViews: ResearcherView[] = validRows.map((row) => {
        const id = `${row.researcherName}_${row.symbol}_${row.effectiveDate}_v${row.versionNo}_${Date.now()}_${row.rowNo}`.replace(/[^\w.-]+/g, '_');
        const view: ResearcherView = {
          id,
          researcherName: row.researcherName,
          symbol: row.symbol,
          market: row.market,
          stockName: row.stockName,
          priceCurrency: row.priceCurrency,
          effectiveDate: row.effectiveDate,
          versionNo: row.versionNo,
          allowNonMonotonic: true,
          status: 'active',
          note: row.note,
          points: row.points,
          createdAt: now,
          updatedAt: now,
          lastConfidenceAt: row.effectiveDate,
        };
        batch.set(doc(db, 'artifacts', APP_ID, 'public', 'data', VIEWS_COLLECTION, id), view);
        return view;
      });
      await batch.commit();
      onImported(importedViews);
      close();
    } catch (err: any) {
      setError(err?.message || '导入失败');
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4 py-6 backdrop-blur-sm">
      <div className="max-h-[90vh] w-full max-w-7xl overflow-hidden rounded-[2rem] bg-white shadow-2xl">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-stone-200 bg-stone-50 px-6 py-5">
          <div>
            <div className="text-xs font-black uppercase tracking-wide text-slate-500">批量导入</div>
            <h3 className="mt-1 text-2xl font-black text-slate-900">Excel一键导入研究员观点</h3>
            <p className="mt-1 text-sm text-slate-500">列顺序：研究员 / 股票代码 / 观点生效日 / 价格点 / 目标市值点 / 备注</p>
          </div>
          <button className="rounded-full border border-stone-300 bg-white px-4 py-2 text-sm font-bold text-slate-700" onClick={close}>关闭</button>
        </div>
        <div className="grid max-h-[72vh] gap-5 overflow-auto p-6 lg:grid-cols-[0.85fr_1.15fr]">
          <div>
            <textarea
              className="min-h-[420px] w-full rounded-3xl border border-stone-200 bg-stone-50 p-4 font-mono text-sm outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100"
              value={pasteText}
              onChange={(event) => setPasteText(event.target.value)}
              placeholder={'从Excel复制后粘贴，例如：\n张三\\t0175.HK\\t2026-04-01\\t[10,12,15,20]\\t[8000000,6000000,3000000,1000000]\\t吉利估值区间'}
            />
            <div className="mt-3 rounded-2xl bg-stone-100 p-4 text-xs leading-6 text-slate-600">
              <div className="font-black text-slate-800">格式说明</div>
              <div>价格点和目标市值点必须使用英文逗号，并且元素个数一致。</div>
              <div>备注是普通文本，不参与数量校验。</div>
            </div>
            {error && <div className="mt-3 rounded-2xl bg-rose-50 p-3 text-sm font-bold text-rose-700">{error}</div>}
          </div>
          <div>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm font-black text-slate-800">预览：{validRows.length} 条可导入 / {errorCount} 个错误</div>
              <button className="btn-primary" onClick={importRows} disabled={importing || validRows.length === 0 || errorCount > 0}>
                <Save className="h-4 w-4" /> {importing ? '导入中...' : '确认导入'}
              </button>
            </div>
            <div className="max-h-[560px] overflow-auto rounded-3xl border border-stone-200">
              <table className="min-w-[980px] w-full text-sm">
                <thead className="sticky top-0 z-10 bg-stone-100 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3">行</th>
                    <th className="px-4 py-3">研究员</th>
                    <th className="px-4 py-3">股票</th>
                    <th className="px-4 py-3">名称/币种</th>
                    <th className="px-4 py-3">生效日</th>
                    <th className="px-4 py-3">版本</th>
                    <th className="px-4 py-3">点数</th>
                    <th className="px-4 py-3">备注</th>
                    <th className="px-4 py-3">状态</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100 bg-white">
                  {parsedRows.length === 0 ? (
                    <tr><td colSpan={9} className="px-4 py-8 text-center text-slate-500">粘贴Excel内容后显示预览。</td></tr>
                  ) : parsedRows.map((row) => (
                    <tr key={row.rowNo} className={row.errors.length ? 'bg-rose-50/50' : row.warnings.length ? 'bg-amber-50/50' : ''}>
                      <td className="px-4 py-3 font-mono">{row.rowNo}</td>
                      <td className="px-4 py-3 font-bold">{row.researcherName || '--'}</td>
                      <td className="px-4 py-3 font-mono">{row.symbol || '--'}</td>
                      <td className="px-4 py-3"><div className="font-bold">{row.stockName || '--'}</div><div className="text-xs text-slate-400">{row.priceCurrency}</div></td>
                      <td className="px-4 py-3">{row.effectiveDate || '--'}</td>
                      <td className="px-4 py-3">v{row.versionNo || '--'}</td>
                      <td className="px-4 py-3">{row.points.length}</td>
                      <td className="max-w-[220px] truncate px-4 py-3 text-slate-500">{row.note || '--'}</td>
                      <td className="px-4 py-3">
                        {row.errors.length ? <span className="text-xs font-bold text-rose-700">{row.errors.join('；')}</span> : row.warnings.length ? <span className="text-xs font-bold text-amber-700">{row.warnings.join('；')}</span> : <span className="text-xs font-bold text-emerald-700">可导入</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ViewExportModal({ views, close }: { views: ResearcherView[]; close: () => void }) {
  const exportText = useMemo(() => buildViewsExportText(views), [views]);
  const [copied, setCopied] = useState(false);

  async function copyText() {
    try {
      await navigator.clipboard.writeText(exportText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4 py-6 backdrop-blur-sm">
      <div className="max-h-[88vh] w-full max-w-5xl overflow-hidden rounded-[2rem] bg-white shadow-2xl">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-stone-200 bg-stone-50 px-6 py-5">
          <div>
            <div className="text-xs font-black uppercase tracking-wide text-slate-500">一键导出</div>
            <h3 className="mt-1 text-2xl font-black text-slate-900">研究员观点导出</h3>
            <p className="mt-1 text-sm text-slate-500">可直接复制到 Excel，也可作为日后恢复比赛的输入文件。</p>
          </div>
          <button className="rounded-full border border-stone-300 bg-white px-4 py-2 text-sm font-bold text-slate-700" onClick={close}>关闭</button>
        </div>
        <div className="p-6">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm font-black text-slate-800">共 {views.length} 条观点版本</div>
            <button className="btn-primary" onClick={copyText}><Save className="h-4 w-4" /> {copied ? '已复制' : '复制到剪贴板'}</button>
          </div>
          <textarea className="min-h-[520px] w-full rounded-3xl border border-stone-200 bg-stone-50 p-4 font-mono text-xs outline-none focus:border-teal-600" value={exportText} readOnly />
        </div>
      </div>
    </div>
  );
}

function RunReportPanel({ report, openDetails }: { report: RunReport; openDetails: () => void }) {
  return (
    <div className="mt-4 rounded-3xl border border-teal-100 bg-teal-50/80 p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="font-black text-teal-900">运行报告：{report.fromDate} 至 {report.toDate}</div>
        <div className="flex items-center gap-3">
          <div className="text-xs font-bold text-teal-700">成功 {report.successDays.length}/{report.requestedDays} 日 · 流水 {report.generatedTradeCount} 条</div>
          <button className="rounded-full bg-teal-900 px-3 py-1.5 text-xs font-black text-white" onClick={openDetails}>查看明细</button>
        </div>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <ReportMini label="成功日期" value={`${report.successDays.length} 日`} />
        <ReportMini label="跳过日期" value={`${report.skippedDays.length} 日`} tone={report.skippedDays.length ? 'warn' : 'normal'} />
        <ReportMini label="市场休市" value={`${report.marketHolidays.length} 条`} tone={report.marketHolidays.length ? 'warn' : 'normal'} />
        <ReportMini label="缺行情提示" value={`${report.missingQuotes.length} 条`} tone={report.missingQuotes.length ? 'warn' : 'normal'} />
      </div>
    </div>
  );
}

function RunReportModal({ report, close }: { report: RunReport; close: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4 py-6 backdrop-blur-sm">
      <div className="max-h-[88vh] w-full max-w-5xl overflow-hidden rounded-[2rem] bg-white shadow-2xl">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-stone-200 bg-stone-50 px-6 py-5">
          <div>
            <div className="text-xs font-black uppercase tracking-wide text-slate-500">运行报告明细</div>
            <h3 className="mt-1 text-2xl font-black text-slate-900">{report.fromDate} 至 {report.toDate}</h3>
            <p className="mt-1 text-sm text-slate-500">成功 {report.successDays.length}/{report.requestedDays} 日，生成 {report.generatedTradeCount} 条流水。</p>
          </div>
          <button className="rounded-full border border-stone-300 bg-white px-4 py-2 text-sm font-bold text-slate-700" onClick={close}>关闭</button>
        </div>
        <div className="grid max-h-[68vh] gap-5 overflow-auto p-6 lg:grid-cols-4">
          <ReportList title="成功日期" emptyText="无成功日期" items={report.successDays.map((item) => `${item.date}：${item.tradeCount} 条流水`)} />
          <ReportList title="跳过日期" emptyText="无跳过日期" items={report.skippedDays.map((item) => `${item.date}：${item.reason}`)} />
          <ReportList title="市场休市" emptyText="无市场休市提示" items={report.marketHolidays.map((item) => `${item.date} ${item.market}：${item.symbols.join(', ')}`)} />
          <ReportList title="缺少历史行情" emptyText="无缺行情提示" items={report.missingQuotes.map((item) => `${item.date}：${item.symbols.join(', ')}`)} />
        </div>
      </div>
    </div>
  );
}

function ReportList({ title, items, emptyText }: { title: string; items: string[]; emptyText: string }) {
  return (
    <div className="rounded-3xl border border-stone-200 bg-stone-50 p-4">
      <div className="mb-3 font-black text-slate-800">{title}</div>
      <div className="max-h-[480px] space-y-2 overflow-auto text-sm text-slate-600">
        {items.length === 0 ? <div className="text-slate-400">{emptyText}</div> : items.map((item, index) => <div key={`${item}-${index}`} className="rounded-2xl bg-white px-3 py-2">{item}</div>)}
      </div>
    </div>
  );
}

function ReportMini({ label, value, tone = 'normal' }: { label: string; value: string; tone?: 'normal' | 'warn' }) {
  return <div className={`rounded-2xl p-3 ${tone === 'warn' ? 'bg-amber-50 text-amber-800' : 'bg-white/75 text-teal-900'}`}><div className="text-xs opacity-75">{label}</div><div className="mt-1 font-black">{value}</div></div>;
}

function AccountOverview({ accounts, openAccount }: {
  accounts: ReturnType<typeof buildAccountSnapshots>;
  openAccount: (researcherName: string) => void;
}) {
  if (accounts.length === 0) return <EmptyHint text="运行模拟后展示研究员账户市值、现金与盈亏。" />;

  return (
    <div className="space-y-3">
      {accounts.map((account) => (
        <button
          key={account.researcherName}
          className="w-full rounded-3xl border border-stone-200 bg-gradient-to-br from-white to-stone-50 p-4 text-left transition hover:-translate-y-0.5 hover:border-teal-300 hover:shadow-md"
          onClick={() => openAccount(account.researcherName)}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-lg font-black text-slate-900">{account.researcherName}</div>
              <div className="mt-1 text-xs text-slate-500">{account.stockCount} 只持仓/有盈亏股票</div>
            </div>
            <div className={`text-right text-xl font-black ${account.totalPnlHKD >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
              {formatHKD(account.totalPnlHKD)}
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            <AccountMetric label="持仓市值" value={formatHKD(account.grossMarketValueHKD)} />
            <AccountMetric label="现金余额" value={formatHKD(account.cashHKD)} tone={account.cashHKD >= 0 ? 'normal' : 'danger'} />
            <AccountMetric label="已实现盈亏" value={formatHKD(account.realizedPnlHKD)} tone={account.realizedPnlHKD >= 0 ? 'good' : 'danger'} />
            <AccountMetric label="未实现盈亏" value={formatHKD(account.unrealizedPnlHKD)} tone={account.unrealizedPnlHKD >= 0 ? 'good' : 'danger'} />
          </div>
        </button>
      ))}
    </div>
  );
}

function AccountMetric({ label, value, tone = 'normal' }: { label: string; value: string; tone?: 'normal' | 'good' | 'danger' }) {
  const toneClass = tone === 'good' ? 'text-emerald-700' : tone === 'danger' ? 'text-rose-700' : 'text-slate-900';
  return (
    <div className="rounded-2xl bg-stone-100/70 p-3">
      <div className="text-slate-500">{label}</div>
      <div className={`mt-1 font-black ${toneClass}`}>{value}</div>
    </div>
  );
}

function AccountPositionModal(props: {
  researcherName: string;
  positions: ReturnType<typeof rebuildPositions>;
  account?: ReturnType<typeof buildAccountSnapshots>[number];
  config: PchipContestConfig;
  close: () => void;
}) {
  const { researcherName, positions, account, config, close } = props;
  const accountPositions = positions
    .filter((position) => position.researcherName === researcherName && (position.shares > 1e-9 || Math.abs(position.totalPnlHKD) > 0.01))
    .sort((a, b) => b.marketValueHKD - a.marketValueHKD);
  const grossMarketValue = accountPositions.reduce((sum, item) => sum + item.marketValueHKD, 0);
  const realizedPnl = accountPositions.reduce((sum, item) => sum + item.realizedPnlHKD, 0);
  const unrealizedPnl = accountPositions.reduce((sum, item) => sum + item.unrealizedPnlHKD, 0);
  const totalPnl = realizedPnl + unrealizedPnl;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4 py-6 backdrop-blur-sm">
      <div className="max-h-[88vh] w-full max-w-6xl overflow-hidden rounded-[2rem] bg-white shadow-2xl">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-stone-200 bg-stone-50 px-6 py-5">
          <div>
            <div className="text-xs font-black uppercase tracking-wide text-slate-500">账户持仓明细</div>
            <h3 className="mt-1 text-2xl font-black text-slate-900">{researcherName}</h3>
            <p className="mt-1 text-sm text-slate-500">当前持仓由历史模拟交易流水推导。</p>
          </div>
          <button className="rounded-full border border-stone-300 bg-white px-4 py-2 text-sm font-bold text-slate-700" onClick={close}>关闭</button>
        </div>
        <div className="grid gap-3 border-b border-stone-100 p-6 sm:grid-cols-5">
          <AccountMetric label="持仓市值" value={formatHKD(grossMarketValue)} />
          <AccountMetric label="现金余额" value={formatHKD(account?.cashHKD ?? config.maxCapitalHKD)} tone={(account?.cashHKD ?? config.maxCapitalHKD) >= 0 ? 'normal' : 'danger'} />
          <AccountMetric label="已实现盈亏" value={formatHKD(realizedPnl)} tone={realizedPnl >= 0 ? 'good' : 'danger'} />
          <AccountMetric label="未实现盈亏" value={formatHKD(unrealizedPnl)} tone={unrealizedPnl >= 0 ? 'good' : 'danger'} />
          <AccountMetric label="总盈亏" value={formatHKD(totalPnl)} tone={totalPnl >= 0 ? 'good' : 'danger'} />
        </div>
        <div className="max-h-[58vh] overflow-auto p-6">
          <div className="overflow-hidden rounded-3xl border border-stone-200">
            <table className="min-w-[980px] w-full text-sm">
              <thead className="bg-stone-100 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">股票</th>
                  <th className="px-4 py-3">市场</th>
                  <th className="px-4 py-3 text-right">持仓股数</th>
                  <th className="px-4 py-3 text-right">平均成本HKD/股</th>
                  <th className="px-4 py-3 text-right">当前价格</th>
                  <th className="px-4 py-3 text-right">持仓市值</th>
                  <th className="px-4 py-3 text-right">已实现盈亏</th>
                  <th className="px-4 py-3 text-right">未实现盈亏</th>
                  <th className="px-4 py-3 text-right">总盈亏</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100 bg-white">
                {accountPositions.length === 0 ? (
                  <tr><td colSpan={9} className="px-4 py-8 text-center text-slate-500">该账户暂无持仓。</td></tr>
                ) : accountPositions.map((position) => (
                  <tr key={`${position.researcherName}-${position.symbol}-${position.market}`}>
                    <td className="px-4 py-3"><div className="font-bold">{position.stockName}</div><div className="text-xs text-slate-400">{position.symbol}</div></td>
                    <td className="px-4 py-3">{position.market}</td>
                    <td className="px-4 py-3 text-right font-mono">{formatNumber(position.shares, 4)}</td>
                    <td className="px-4 py-3 text-right font-mono">{formatNumber(position.averageCostHKD, 4)}</td>
                    <td className="px-4 py-3 text-right font-mono">{formatNumber(position.lastClose, 4)}</td>
                    <td className="px-4 py-3 text-right font-bold">{formatHKD(position.marketValueHKD)}</td>
                    <td className={`px-4 py-3 text-right font-bold ${position.realizedPnlHKD >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{formatHKD(position.realizedPnlHKD)}</td>
                    <td className={`px-4 py-3 text-right font-bold ${position.unrealizedPnlHKD >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{formatHKD(position.unrealizedPnlHKD)}</td>
                    <td className={`px-4 py-3 text-right font-black ${position.totalPnlHKD >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{formatHKD(position.totalPnlHKD)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function Panel({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return <div className="rounded-[2rem] border border-stone-200 bg-white/90 p-5 shadow-sm shadow-stone-200/70 backdrop-blur"><div className="mb-4 flex items-center gap-2 text-lg font-black text-slate-900"><span className="rounded-2xl bg-stone-100 p-2 text-teal-700">{icon}</span>{title}</div>{children}</div>;
}

function Field({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return <label className={`block ${className}`}><span className="mb-1.5 block text-xs font-black uppercase tracking-wide text-slate-500">{label}</span>{children}</label>;
}

function EmptyHint({ text }: { text: string }) {
  return <div className="flex min-h-32 items-center justify-center rounded-3xl border border-dashed border-stone-300 bg-stone-50 px-4 text-center text-sm text-slate-500">{text}</div>;
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return <div className="rounded-2xl bg-white/10 p-3"><div className="text-teal-50/70">{label}</div><div className="mt-1 font-bold">{value}</div></div>;
}

function buildCurveChartData(views: ResearcherView[], weights: VoiceWeight[], quote?: MarketQuote) {
  if (!quote || views.length === 0) return [];
  const allPrices = views.flatMap((view) => normalizePoints(view.points).map((point) => point.price));
  allPrices.push(quote.close);
  const min = Math.min(...allPrices);
  const max = Math.max(...allPrices);
  const padding = Math.max((max - min) * 0.12, Math.max(quote.close, 1) * 0.06);
  const from = Math.max(0.01, min - padding);
  const to = max + padding;
  const prices = Array.from({ length: 110 }, (_, index) => from + ((to - from) * index) / 109);
  return prices.map((price, index) => {
    const row: Record<string, number> = { price };
    let master = 0;
    views.forEach((view) => {
      const target = targetValueForPrice(view.points, price, quote.fxToHKD);
      row[view.researcherName] = target;
      master += target * (weights.find((item) => item.researcherName === view.researcherName)?.weight || 0);
    });
    row['合成曲线'] = master;
    return row;
  });
}

type HistoricalQuoteMap = Record<string, Record<string, MarketQuote>>;

async function fetchHistoricalQuoteMap(views: ResearcherView[], startDate: string, endDate: string): Promise<HistoricalQuoteMap> {
  const uniqueViews = Array.from(new Map(views.map((view) => [symbolKey(view.symbol, view.market), view])).values());
  const range = chooseYahooRange(startDate, endDate);
  const currencyCache = new Map<PriceCurrency, Promise<Record<string, number>>>();
  const result: HistoricalQuoteMap = {};

  await Promise.all(uniqueViews.map(async (view) => {
    try {
      const res = await fetch(`/api/quote?symbol=${encodeURIComponent(view.symbol)}&range=${range}&t=${Date.now()}`);
      if (!res.ok) return;
      const data = await res.json();
      const currency = normalizeCurrency(data.currency || view.priceCurrency || view.market);
      if (!currencyCache.has(currency)) {
        currencyCache.set(currency, fetchHistoricalFxMap(currency, range));
      }
      const fxMap = await currencyCache.get(currency)!;
      const fallbackFx = Number(data.fxRateUsed || fxMap.__fallback || (currency === 'HKD' ? 1 : 0)) || 1;
      const key = symbolKey(view.symbol, view.market);
      const rows: Record<string, MarketQuote> = {};
      (Array.isArray(data.history) ? data.history : []).forEach((item: any) => {
        const close = Number(item.close);
        if (!Number.isFinite(close) || close <= 0) return;
        const date = dateFromYahooTime(item.time);
        if (!date || date < startDate || date > endDate) return;
        rows[date] = {
          symbol: view.symbol,
          close,
          priceCurrency: currency,
          fxToHKD: fxMap[date] || fallbackFx,
          name: data.name || view.stockName,
        };
      });
      result[key] = rows;
    } catch {
      // 单个标的历史行情失败时跳过，批量模拟会在具体日期层面继续处理其他标的。
    }
  }));

  return result;
}

async function fetchHistoricalFxMap(currency: PriceCurrency, range: string): Promise<Record<string, number>> {
  if (currency === 'HKD') return { __fallback: 1 };
  const fallback = await fetchCurrentFx(currency);
  try {
    const res = await fetch(`/api/quote?symbol=${encodeURIComponent(`${currency}HKD=X`)}&range=${range}&t=${Date.now()}`);
    if (!res.ok) return { __fallback: fallback };
    const data = await res.json();
    const map: Record<string, number> = { __fallback: fallback };
    (Array.isArray(data.history) ? data.history : []).forEach((item: any) => {
      const rate = Number(item.close);
      const date = dateFromYahooTime(item.time);
      if (date && Number.isFinite(rate) && rate > 0) map[date] = rate;
    });
    return map;
  } catch {
    return { __fallback: fallback };
  }
}

async function fetchCurrentFx(currency: PriceCurrency): Promise<number> {
  if (currency === 'HKD') return 1;
  try {
    const res = await fetch(`/api/quote?currency=${encodeURIComponent(currency)}&t=${Date.now()}`);
    if (!res.ok) return fallbackFx(currency);
    const data = await res.json();
    return Number(data.rate) || fallbackFx(currency);
  } catch {
    return fallbackFx(currency);
  }
}

function buildQuotesForDate(views: ResearcherView[], historyMap: HistoricalQuoteMap, date: string): Record<string, MarketQuote> {
  const quotes: Record<string, MarketQuote> = {};
  views.forEach((view) => {
    const key = symbolKey(view.symbol, view.market);
    const quote = historyMap[key]?.[date];
    if (quote) quotes[key] = quote;
  });
  return quotes;
}

function buildQuotesForDateWithReport(views: ResearcherView[], historyMap: HistoricalQuoteMap, date: string): {
  quotes: Record<string, MarketQuote>;
  missingQuotes: Array<{ date: string; symbols: string[] }>;
  marketHolidays: Array<{ date: string; market: string; symbols: string[] }>;
} {
  const quotes: Record<string, MarketQuote> = {};
  const missingQuotes: Array<{ date: string; symbols: string[] }> = [];
  const marketHolidays: Array<{ date: string; market: string; symbols: string[] }> = [];
  const byMarket = new Map<string, ResearcherView[]>();

  views.forEach((view) => byMarket.set(view.market, [...(byMarket.get(view.market) || []), view]));
  byMarket.forEach((marketViews, market) => {
    const present: string[] = [];
    const missing: string[] = [];
    marketViews.forEach((view) => {
      const key = symbolKey(view.symbol, view.market);
      const quote = historyMap[key]?.[date];
      if (quote) {
        quotes[key] = quote;
        present.push(view.symbol);
      } else {
        missing.push(view.symbol);
      }
    });

    if (present.length === 0 && missing.length > 0) {
      marketHolidays.push({ date, market, symbols: Array.from(new Set(missing)) });
      return;
    }
    if (missing.length > 0) {
      missingQuotes.push({ date, symbols: Array.from(new Set(missing)) });
    }
  });

  return { quotes, missingQuotes, marketHolidays };
}

function getPendingRunDates(startDate: string, endDate: string, existingRunDates: string[]) {
  const existing = new Set(existingRunDates);
  const sortedExisting = existingRunDates.filter(Boolean).sort();
  const latestRunDate = sortedExisting[sortedExisting.length - 1];
  const from = latestRunDate && latestRunDate >= startDate ? nextBusinessDate(latestRunDate) : startDate;
  const dates: string[] = [];
  let cursor = new Date(`${from}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  while (cursor <= end) {
    const date = cursor.toISOString().slice(0, 10);
    const day = cursor.getDay();
    if (day !== 0 && day !== 6 && !existing.has(date)) dates.push(date);
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

function nextBusinessDate(date: string) {
  const cursor = new Date(`${date}T00:00:00`);
  do {
    cursor.setDate(cursor.getDate() + 1);
  } while (cursor.getDay() === 0 || cursor.getDay() === 6);
  return cursor.toISOString().slice(0, 10);
}

function chooseYahooRange(startDate: string, endDate: string) {
  const days = Math.max(1, Math.ceil((new Date(`${endDate}T00:00:00`).getTime() - new Date(`${startDate}T00:00:00`).getTime()) / 86_400_000));
  if (days <= 31) return '1mo';
  if (days <= 95) return '3mo';
  if (days <= 370) return '1y';
  return '5y';
}

function dateFromYahooTime(time: any) {
  const timestamp = Number(time);
  if (!Number.isFinite(timestamp)) return '';
  return new Date(timestamp).toISOString().slice(0, 10);
}

function fallbackFx(currency: PriceCurrency) {
  if (currency === 'USD') return 7.78;
  if (currency === 'JPY') return 0.052;
  if (currency === 'CNY') return 1.08;
  return 1;
}

function parseExcelImportRows(text: string, stockPool: any[], existingViews: ResearcherView[], runDate: string): ParsedImportRow[] {
  const versionCounter = new Map<string, number>();
  existingViews.forEach((view) => {
    const key = `${view.researcherName.trim()}__${symbolKey(view.symbol, view.market)}`;
    versionCounter.set(key, Math.max(versionCounter.get(key) || 0, view.versionNo || 1));
  });

  return text
    .split(/\r?\n/)
    .map((line, index) => ({ line, rowNo: index + 1 }))
    .filter(({ line }) => line.trim().length > 0)
    .map(({ line, rowNo }) => {
      const cells = line.split('\t');
      const [researcherRaw = '', symbolRaw = '', effectiveDateRaw = '', pointText = '', valueText = '', ...noteCells] = cells;
      const researcherName = researcherRaw.trim();
      const symbol = symbolRaw.trim().toUpperCase();
      const effectiveDate = normalizeImportDate(effectiveDateRaw.trim()) || runDate;
      const note = noteCells.join('\t').trim();
      const errors: string[] = [];
      const warnings: string[] = [];

      if (cells.length < 5) errors.push('列数不足');
      if (!researcherName) errors.push('研究员为空');
      if (!symbol) errors.push('股票代码为空');
      if (!effectiveDateRaw.trim()) warnings.push('未填生效日，使用当前模拟日');
      if (!isValidDate(effectiveDate)) errors.push('生效日无效');

      const prices = parseNumberArray(pointText);
      const values = parseNumberArray(valueText);
      if (prices.error) errors.push(`价格点${prices.error}`);
      if (values.error) errors.push(`目标市值点${values.error}`);
      if (prices.values.length !== values.values.length) errors.push(`价格点${prices.values.length}个，目标市值点${values.values.length}个`);
      if (prices.values.length < 2) errors.push('至少需要2个点');
      if (prices.values.some((value) => value <= 0)) errors.push('价格点必须大于0');
      if (values.values.some((value) => value < 0)) errors.push('目标市值不能为负');

      const stock = findStockInPool(stockPool, symbol);
      if (!stock) warnings.push('股票池未匹配，默认HKD');
      const priceCurrency = normalizeCurrency(stock?.currency || stock?.market || 'HKD');
      const market = priceCurrency;
      const stockName = stock?.name || stock?.stockName || stock?.company_name || symbol;
      const versionKey = `${researcherName}__${symbolKey(symbol || 'UNKNOWN', market)}`;
      const versionNo = (versionCounter.get(versionKey) || 0) + 1;
      versionCounter.set(versionKey, versionNo);

      const points = prices.values.map((price, index) => ({
        price,
        targetValueHKD: values.values[index] ?? 0,
      }));

      return {
        rowNo,
        researcherName,
        symbol,
        effectiveDate,
        pointText,
        valueText,
        note,
        points,
        stockName,
        market,
        priceCurrency,
        versionNo,
        errors,
        warnings,
      };
    });
}

function buildViewsExportText(views: ResearcherView[]) {
  const header = ['研究员', '股票代码', '观点生效日', '价格点', '目标市值点', '备注', '股票名称', '币种', '版本号', '状态'].join('\t');
  const rows = [...views]
    .sort((a, b) => `${a.researcherName}-${a.symbol}-${a.effectiveDate}`.localeCompare(`${b.researcherName}-${b.symbol}-${b.effectiveDate}`))
    .map((view) => {
      const points = normalizePoints(view.points);
      const priceText = `[${points.map((point) => trimZeros(point.price, 4)).join(',')}]`;
      const valueText = `[${points.map((point) => trimZeros(point.targetValueHKD, 2)).join(',')}]`;
      return [
        view.researcherName,
        view.symbol,
        view.effectiveDate,
        priceText,
        valueText,
        sanitizeTsvCell(view.note || ''),
        sanitizeTsvCell(view.stockName || ''),
        view.priceCurrency,
        `v${view.versionNo || 1}`,
        view.status,
      ].join('\t');
    });
  return [header, ...rows].join('\n');
}

function sanitizeTsvCell(value: string) {
  return String(value).replace(/\t/g, ' ').replace(/\r?\n/g, ' ');
}

function parseNumberArray(raw: string): { values: number[]; error?: string } {
  const text = raw.trim();
  if (!text.startsWith('[') || !text.endsWith(']')) return { values: [], error: '必须为[P1,P2,...]格式' };
  const body = text.slice(1, -1).trim();
  if (!body) return { values: [], error: '为空' };
  const values = body.split(',').map((part) => Number(part.trim().replace(/,/g, '')));
  if (values.some((value) => !Number.isFinite(value))) return { values, error: '包含非数字' };
  return { values };
}

function normalizeImportDate(raw: string) {
  const text = raw.trim();
  if (!text) return '';
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(text)) {
    const [year, month, day] = text.split('-');
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(text)) {
    const [year, month, day] = text.split('/');
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return text;
  return parsed.toISOString().slice(0, 10);
}

function isValidDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00`).getTime());
}

function findStockInPool(stockPool: any[], symbol: string) {
  const target = symbol.toUpperCase();
  return stockPool.find((stock: any) => {
    const candidates = [stock.symbol, stock.yahoo, stock.code, stock.ticker].filter(Boolean).map((item: any) => String(item).toUpperCase());
    return candidates.includes(target) || candidates.includes(target.split('.')[0]);
  });
}

function groupViewsByResearcherStock(views: ResearcherView[], runDate: string) {
  const map = new Map<string, ResearcherView[]>();
  views.forEach((view) => {
    const key = `${view.researcherName.trim()}__${symbolKey(view.symbol, view.market)}`;
    map.set(key, [...(map.get(key) || []), view]);
  });

  return Array.from(map.entries()).map(([groupKey, groupViews]) => {
    const versions = [...groupViews].sort((a, b) => {
      const dateCompare = String(b.effectiveDate || '').localeCompare(String(a.effectiveDate || ''));
      if (dateCompare !== 0) return dateCompare;
      return (b.versionNo || 1) - (a.versionNo || 1);
    });
    const effective = versions.find((view) => view.status === 'active' && (!view.effectiveDate || view.effectiveDate <= runDate));
    return {
      groupKey,
      versions,
      currentView: effective || versions[0],
    };
  }).sort((a, b) => `${a.currentView.symbol}-${a.currentView.researcherName}`.localeCompare(`${b.currentView.symbol}-${b.currentView.researcherName}`));
}

function filterAndSortTrades(
  trades: SimulationTradeLedger[],
  filters: Record<string, string>,
  sort: { key: string; dir: 'asc' | 'desc' | null },
) {
  let result = trades.filter((trade) => Math.abs(trade.quantity || trade.tradeShares || 0) > 1e-9);
  Object.entries(filters).forEach(([key, value]) => {
    const needle = value.trim().toLowerCase();
    if (!needle) return;
    result = result.filter((trade) => String(getTradeField(trade, key)).toLowerCase().includes(needle));
  });

  if (sort.dir && sort.key) {
    result.sort((a, b) => {
      const aValue = getTradeField(a, sort.key);
      const bValue = getTradeField(b, sort.key);
      if (typeof aValue === 'number' && typeof bValue === 'number') {
        return sort.dir === 'asc' ? aValue - bValue : bValue - aValue;
      }
      return sort.dir === 'asc'
        ? String(aValue).localeCompare(String(bValue))
        : String(bValue).localeCompare(String(aValue));
    });
  }

  return result;
}

function getTradeField(trade: SimulationTradeLedger, key: string): string | number {
  const anyTrade = trade as any;
  if (key in anyTrade && anyTrade[key] !== undefined && anyTrade[key] !== null) return anyTrade[key];
  if (key === 'account') return trade.account || trade.researcherName;
  if (key === 'code') return `${trade.code || trade.symbol} ${trade.name || trade.stockName}`;
  if (key === 'direction') return trade.direction || trade.side;
  if (key === 'source') return trade.source || 'PCHIP';
  if (key === 'executor') return trade.executor || 'PCHIP模拟引擎';
  return '';
}

function normalizeCurrency(value: any): PriceCurrency {
  const currency = String(value || 'HKD').toUpperCase();
  if (currency === 'USD' || currency === 'CNY' || currency === 'JPY' || currency === 'HKD') return currency;
  return 'HKD';
}

function normalizeLoadedView(view: ResearcherView): ResearcherView {
  const fallbackDate = (view.updatedAt || view.createdAt || todayInput()).slice(0, 10);
  return {
    ...view,
    effectiveDate: view.effectiveDate || fallbackDate,
    versionNo: view.versionNo || 1,
    lastConfidenceAt: view.lastConfidenceAt || fallbackDate,
  };
}

function todayInput() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

function formatHKD(value: number) {
  const abs = Math.abs(value || 0);
  if (abs >= 100_000_000) return `${value < 0 ? '-' : ''}HK$${(abs / 100_000_000).toFixed(2)}亿`;
  if (abs >= 10_000) return `${value < 0 ? '-' : ''}HK$${(abs / 10_000).toFixed(1)}万`;
  return `${value < 0 ? '-' : ''}HK$${abs.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function compactHKD(value: number) {
  const abs = Math.abs(value || 0);
  const sign = value < 0 ? '-' : '';
  if (abs >= 100_000_000) return `${sign}HK$${trimZeros(abs / 100_000_000, 1)}亿`;
  if (abs >= 10_000_000) return `${sign}HK$${trimZeros(abs / 10_000, 0)}万`;
  if (abs >= 10_000) return `${sign}HK$${trimZeros(abs / 10_000, 1)}万`;
  return `${sign}HK$${trimZeros(abs, 0)}`;
}

function formatAxisPrice(value: number) {
  const abs = Math.abs(value || 0);
  if (abs >= 1000) return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (abs >= 100) return trimZeros(value, 1);
  if (abs >= 10) return trimZeros(value, 2);
  return trimZeros(value, 3);
}

function formatFullPrice(value: number, currency?: string) {
  return `${currency ? `${currency} ` : ''}${value.toLocaleString(undefined, { maximumFractionDigits: 4 })}`;
}

function formatNumber(value: number, digits = 2) {
  return Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: digits });
}

function formatPercent(value: number) {
  return `${((value || 0) * 100).toFixed(1)}%`;
}

function trimZeros(value: number, digits: number) {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
}
