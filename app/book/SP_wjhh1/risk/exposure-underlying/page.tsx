'use client';

import React, { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { AlertCircle, FileSpreadsheet, Loader2, RefreshCw } from 'lucide-react';
import { doc, getDoc } from 'firebase/firestore';
import { onAuthStateChanged, signInAnonymously, signInWithCustomToken } from 'firebase/auth';
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { db, auth, APP_ID } from '@/app/lib/stockService';
import { useStockPool } from '@/app/hooks/useStockPool';

type ExposureSourceKey = 'dqaq' | 'fcn' | 'option' | 'spot';

interface ExposureSource {
  key: ExposureSourceKey;
  label: string;
  collection: string;
}

interface NormalizedExposure {
  symbol: string;
  market: string;
  source: ExposureSourceKey;
  shares: number;
  cost: number;
}

interface SourceBreakdown {
  shares: number;
  cost: number;
}

interface UnderlyingExposureRow {
  key: string;
  symbol: string;
  market: string;
  name: string;
  totalShares: number;
  avgCost: number | null;
  currentPrice: number | null;
  pnlRatio: number | null;
  totalCostHKD: number;
  totalMktValHKD: number | null;
  totalPnlHKD: number | null;
  sectorLevel1: string;
  sectorLevel2: string;
  bySource: Record<ExposureSourceKey, SourceBreakdown>;
}

interface SourceStatus {
  label: string;
  updatedAt: string | null;
  count: number;
  error?: string;
}

type SortKey = 'pnlRatio' | 'totalCostHKD' | 'totalMktValHKD' | 'totalPnlHKD';
type SortState = {
  key: SortKey;
  dir: 'asc' | 'desc';
} | null;

type TextFilterKey = 'symbol' | 'market' | 'name' | 'sectorLevel1' | 'sectorLevel2';
type ExposureChartGroupKey = 'market' | 'sectorLevel1' | 'sectorLevel2';

interface ExposurePieSlice {
  name: string;
  value: number;
  signedValue: number;
  count: number;
}

const EXPOSURE_SOURCES: ExposureSource[] = [
  { key: 'dqaq', label: 'DQ-AQ', collection: 'sip_exposure_dqaq' },
  { key: 'fcn', label: 'FCN', collection: 'sip_exposure_fcn' },
  { key: 'option', label: 'Option', collection: 'sip_exposure_option' },
  { key: 'spot', label: 'Spot', collection: 'sip_exposure_spot' },
];

const EXPOSURE_CHART_GROUPS: Array<{ key: ExposureChartGroupKey; label: string }> = [
  { key: 'market', label: '市场' },
  { key: 'sectorLevel1', label: '一级行业' },
  { key: 'sectorLevel2', label: '二级行业' },
];

const PIE_COLORS = ['#2563eb', '#059669', '#f59e0b', '#dc2626', '#7c3aed', '#0891b2', '#db2777', '#65a30d', '#ea580c', '#475569'];

const emptyBreakdown = (): Record<ExposureSourceKey, SourceBreakdown> => ({
  dqaq: { shares: 0, cost: 0 },
  fcn: { shares: 0, cost: 0 },
  option: { shares: 0, cost: 0 },
  spot: { shares: 0, cost: 0 },
});

const formatNumber = (value: number | null | undefined, digits = 2) => {
  if (value === null || value === undefined || Number.isNaN(value)) return '-';
  return value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
};

const formatPercent = (value: number | null | undefined) => {
  if (value === null || value === undefined || Number.isNaN(value)) return '-';
  return `${(value * 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
};

const excelCell = (value: string | number | null | undefined) => {
  if (value === null || value === undefined) return '';
  const text = String(value).replace(/\t/g, ' ').replace(/\r?\n/g, ' ');
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
};

const buildExcelText = (rows: Array<Array<string | number | null | undefined>>) => (
  rows.map((row) => row.map(excelCell).join('\t')).join('\n')
);

const normalizeSymbol = (symbol: string) => symbol.trim().toUpperCase();

const normalizeFilterText = (value: string) => value
  .toUpperCase()
  .replace(/[\s._\-\/]+/g, '');

const fuzzyMatch = (value: string, keyword: string) => {
  const normalizedKeyword = normalizeFilterText(keyword);
  if (!normalizedKeyword) return true;

  const normalizedValue = normalizeFilterText(value);
  return normalizedValue.includes(normalizedKeyword);
};

const inferMarket = (symbol: string, fallback?: string) => {
  const normalizedFallback = fallback?.trim().toUpperCase();
  if (normalizedFallback) return normalizedFallback;
  if (symbol.endsWith('.HK')) return 'HKD';
  if (symbol.endsWith('.T')) return 'JPY';
  if (symbol.endsWith('.SS') || symbol.endsWith('.SZ')) return 'CNY';
  return 'USD';
};

const displayTime = (value: any) => {
  if (!value) return null;
  if (value.toDate && typeof value.toDate === 'function') {
    return value.toDate().toLocaleString('zh-CN', { hour12: false });
  }
  if (value.seconds) {
    return new Date(value.seconds * 1000).toLocaleString('zh-CN', { hour12: false });
  }
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
};

const SortableTh = ({
  label,
  sortKey,
  sortState,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  sortState: SortState;
  onSort: (key: SortKey) => void;
}) => (
  <th className="px-3 py-3 text-right">
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      className="inline-flex items-center gap-1 font-bold text-gray-500 transition-colors hover:text-gray-900"
    >
      {label}
      <span className={`text-[10px] ${sortState?.key === sortKey ? 'text-blue-600' : 'text-gray-300'}`}>
        {sortState?.key === sortKey ? (sortState.dir === 'asc' ? '▲' : '▼') : '▲'}
      </span>
    </button>
  </th>
);

const FilterTh = ({
  label,
  filterKey,
  filters,
  onFilter,
  align = 'left',
}: {
  label: string;
  filterKey: TextFilterKey;
  filters: Record<TextFilterKey, string>;
  onFilter: (key: TextFilterKey, value: string) => void;
  align?: 'left' | 'center';
}) => (
  <th className={`px-3 py-3 align-top ${align === 'center' ? 'text-center' : 'text-left'}`}>
    <div className="font-bold text-gray-500">{label}</div>
    <input
      value={filters[filterKey]}
      onChange={(event) => onFilter(filterKey, event.target.value)}
      placeholder="筛选"
      className={`mt-1 w-full min-w-[72px] rounded border border-gray-300 bg-white px-2 py-1 text-xs font-normal text-gray-700 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 ${align === 'center' ? 'text-center' : ''}`}
    />
  </th>
);

export default function ExposureUnderlyingPage() {
  const { stocks: stockPool, loading: stockPoolLoading } = useStockPool();
  const [userReady, setUserReady] = useState(false);
  const [exposures, setExposures] = useState<NormalizedExposure[]>([]);
  const [sourceStatuses, setSourceStatuses] = useState<SourceStatus[]>([]);
  const [quotes, setQuotes] = useState<Record<string, number>>({});
  const [fxRates, setFxRates] = useState<Record<string, number>>({ HKD: 1 });
  const [loading, setLoading] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<string | null>(null);
  const [filters, setFilters] = useState<Record<TextFilterKey, string>>({
    symbol: '',
    market: '',
    name: '',
    sectorLevel1: '',
    sectorLevel2: '',
  });
  const deferredFilters = useDeferredValue(filters);
  const [sortState, setSortState] = useState<SortState>(null);
  const [showExportModal, setShowExportModal] = useState(false);
  const [copyStatus, setCopyStatus] = useState('');
  const [chartGroupBy, setChartGroupBy] = useState<ExposureChartGroupKey>('market');

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;

    const initAuth = async () => {
      if (!auth.currentUser) {
        // @ts-ignore
        if (typeof window !== 'undefined' && window.__initial_auth_token) {
          // @ts-ignore
          await signInWithCustomToken(auth, window.__initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      }

      unsubscribe = onAuthStateChanged(auth, (currentUser) => {
        setUserReady(!!currentUser);
      });
    };

    initAuth();
    return () => unsubscribe?.();
  }, []);

  const fetchQuote = async (symbol: string) => {
    const candidates = symbol.endsWith('.US') ? [symbol, symbol.replace(/\.US$/, '')] : [symbol];

    for (const candidate of candidates) {
      try {
        const res = await fetch(`/api/quote?symbol=${encodeURIComponent(candidate)}`);
        if (!res.ok) continue;
        const data = await res.json();
        const price = data.regularMarketPrice || data.price || data.close;
        if (price) return Number(price);
      } catch {
        // Keep trying fallback symbols.
      }
    }

    return null;
  };

  const fetchFxRate = async (market: string) => {
    if (market === 'HKD') return 1;
    try {
      const res = await fetch(`/api/quote?currency=${encodeURIComponent(market)}`);
      if (!res.ok) return 1;
      const data = await res.json();
      return Number(data.rate || 1);
    } catch {
      return 1;
    }
  };

  const refreshData = useCallback(async () => {
    if (!userReady) return;
    setLoading(true);

    try {
      const statuses: SourceStatus[] = [];
      const nextExposures: NormalizedExposure[] = [];

      await Promise.all(EXPOSURE_SOURCES.map(async (source) => {
        try {
          const snap = await getDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', source.collection, 'latest_summary'));
          if (!snap.exists()) {
            statuses.push({ label: source.label, updatedAt: null, count: 0, error: '暂无快照' });
            return;
          }

          const payload = snap.data();
          const rows = Array.isArray(payload.data) ? payload.data : [];

          rows.forEach((item: any) => {
            const rawSymbol = item.ticker || item.code || item.symbol;
            if (!rawSymbol) return;

            const symbol = normalizeSymbol(String(rawSymbol));
            const market = inferMarket(symbol, String(item.market || item.currency || ''));
            nextExposures.push({
              symbol,
              market,
              source: source.key,
              shares: Number(item.shares || 0),
              cost: Number(item.cost || 0),
            });
          });

          statuses.push({
            label: source.label,
            updatedAt: displayTime(payload.updatedAt),
            count: rows.length,
          });
        } catch (error: any) {
          statuses.push({ label: source.label, updatedAt: null, count: 0, error: error?.message || '读取失败' });
        }
      }));

      const symbols = Array.from(new Set(nextExposures.map((item) => item.symbol)));
      const markets = Array.from(new Set(nextExposures.map((item) => item.market)));

      const quotePairs = await Promise.all(symbols.map(async (symbol) => [symbol, await fetchQuote(symbol)] as const));
      const ratePairs = await Promise.all(markets.map(async (market) => [market, await fetchFxRate(market)] as const));

      setExposures(nextExposures);
      setSourceStatuses(statuses.sort((a, b) => EXPOSURE_SOURCES.findIndex(s => s.label === a.label) - EXPOSURE_SOURCES.findIndex(s => s.label === b.label)));
      setQuotes(Object.fromEntries(quotePairs.filter(([, price]) => price !== null)) as Record<string, number>);
      setFxRates({ HKD: 1, ...Object.fromEntries(ratePairs) });
      setLastRefreshed(new Date().toLocaleString('zh-CN', { hour12: false }));
    } finally {
      setLoading(false);
    }
  }, [userReady]);

  useEffect(() => {
    refreshData();
  }, [refreshData]);

  const rows = useMemo<UnderlyingExposureRow[]>(() => {
    const stockMap = new Map<string, any>();
    stockPool.forEach((stock) => {
      if (stock.symbol) stockMap.set(normalizeSymbol(stock.symbol), stock);
    });

    const grouped = new Map<string, UnderlyingExposureRow & { totalCostLocal: number }>();

    exposures.forEach((item) => {
      const key = `${item.symbol}|${item.market}`;
      const stockInfo = stockMap.get(item.symbol) || stockMap.get(item.symbol.replace(/\.US$/, ''));
      const existing = grouped.get(key);

      if (!existing) {
        grouped.set(key, {
          key,
          symbol: item.symbol,
          market: item.market,
          name: stockInfo?.name || item.symbol,
          totalShares: 0,
          avgCost: null,
          currentPrice: null,
          pnlRatio: null,
          totalCostHKD: 0,
          totalMktValHKD: null,
          totalPnlHKD: null,
          sectorLevel1: stockInfo?.sector_level_1 || '未知',
          sectorLevel2: stockInfo?.sector_level_2 || '未知',
          bySource: emptyBreakdown(),
          totalCostLocal: 0,
        });
      }

      const row = grouped.get(key)!;
      row.totalShares += item.shares;
      row.totalCostLocal += item.cost;
      row.bySource[item.source].shares += item.shares;
      row.bySource[item.source].cost += item.cost;
    });

    return Array.from(grouped.values()).map((row) => {
      const fxRate = fxRates[row.market] || 1;
      const currentPrice = quotes[row.symbol] ?? null;
      const avgCost = Math.abs(row.totalShares) > 0.00001 ? row.totalCostLocal / row.totalShares : null;
      const pnlRatio = avgCost && currentPrice !== null ? currentPrice / avgCost - 1 : null;
      const totalMktValHKD = currentPrice !== null ? row.totalShares * currentPrice * fxRate : null;
      const totalCostHKD = row.totalCostLocal * fxRate;
      const totalPnlHKD = totalMktValHKD !== null ? totalMktValHKD - totalCostHKD : null;

      return {
        ...row,
        avgCost,
        currentPrice,
        pnlRatio,
        totalCostHKD,
        totalMktValHKD,
        totalPnlHKD,
      };
    }).sort((a, b) => Math.abs(b.totalCostHKD) - Math.abs(a.totalCostHKD));
  }, [exposures, fxRates, quotes, stockPool]);

  const toggleSort = (key: SortKey) => {
    setSortState((prev) => {
      if (!prev || prev.key !== key) return { key, dir: 'desc' };
      if (prev.dir === 'desc') return { key, dir: 'asc' };
      return null;
    });
  };

  const updateFilter = useCallback((filterKey: TextFilterKey, value: string) => {
    setFilters((prev) => ({ ...prev, [filterKey]: value }));
  }, []);

  const getSortValue = (row: UnderlyingExposureRow, key: SortKey) => {
    const value = row[key];
    return value === null || value === undefined || Number.isNaN(value) ? -Infinity : value;
  };

  const filteredRows = useMemo(() => {
    const searched = rows.filter((row) => (
      fuzzyMatch(row.symbol, deferredFilters.symbol) &&
      fuzzyMatch(row.market, deferredFilters.market) &&
      fuzzyMatch(row.name, deferredFilters.name) &&
      fuzzyMatch(row.sectorLevel1, deferredFilters.sectorLevel1) &&
      fuzzyMatch(row.sectorLevel2, deferredFilters.sectorLevel2)
    ));

    if (!sortState) return searched;

    return [...searched].sort((a, b) => {
      const left = getSortValue(a, sortState.key);
      const right = getSortValue(b, sortState.key);
      return sortState.dir === 'asc' ? left - right : right - left;
    });
  }, [deferredFilters, rows, sortState]);

  const exportTableRows = useMemo(() => {
    const header: Array<string | number | null | undefined> = [
      '股票代码',
      '市场',
      '股票名称',
      '总暴露股数',
      '平均暴露成本',
      '现价',
      '盈亏比%',
      '总暴露成本HKD',
      '总暴露市值HKD',
      '总暴露盈亏HKD',
      '一级行业',
      '二级行业',
    ];

    const body = filteredRows.map((row) => [
      row.symbol,
      row.market,
      row.name,
      row.totalShares,
      row.avgCost === null ? '' : row.avgCost,
      row.currentPrice === null ? '' : row.currentPrice,
      row.pnlRatio === null ? '' : Number((row.pnlRatio * 100).toFixed(4)),
      row.totalCostHKD,
      row.totalMktValHKD === null ? '' : row.totalMktValHKD,
      row.totalPnlHKD === null ? '' : row.totalPnlHKD,
      row.sectorLevel1,
      row.sectorLevel2,
    ]);

    return [header, ...body];
  }, [filteredRows]);

  const exportText = useMemo(() => buildExcelText(exportTableRows), [exportTableRows]);

  const handleExportExcel = useCallback(() => {
    setCopyStatus('');
    setShowExportModal(true);
  }, []);

  const handleCopyExportText = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(exportText);
      setCopyStatus('已复制，可直接粘贴到 Excel');
    } catch {
      setCopyStatus('复制失败，请手动选中文本复制');
    }
  }, [exportText]);

  const exposurePieData = useMemo<ExposurePieSlice[]>(() => {
    const grouped = new Map<string, ExposurePieSlice>();

    filteredRows.forEach((row) => {
      if (row.totalMktValHKD === null || Number.isNaN(row.totalMktValHKD)) return;
      const absoluteExposure = Math.abs(row.totalMktValHKD);
      if (absoluteExposure <= 0) return;

      const name = String(row[chartGroupBy] || '未知');
      const existing = grouped.get(name) || { name, value: 0, signedValue: 0, count: 0 };
      existing.value += absoluteExposure;
      existing.signedValue += row.totalMktValHKD;
      existing.count += 1;
      grouped.set(name, existing);
    });

    const sorted = Array.from(grouped.values()).sort((a, b) => b.value - a.value);
    if (sorted.length <= 10) return sorted;

    const top = sorted.slice(0, 9);
    const other = sorted.slice(9).reduce<ExposurePieSlice>((sum, item) => ({
      name: '其他',
      value: sum.value + item.value,
      signedValue: sum.signedValue + item.signedValue,
      count: sum.count + item.count,
    }), { name: '其他', value: 0, signedValue: 0, count: 0 });

    return [...top, other].filter((item) => item.value > 0);
  }, [chartGroupBy, filteredRows]);

  const exposurePieTotal = useMemo(() => exposurePieData.reduce((sum, item) => sum + item.value, 0), [exposurePieData]);

  const summary = useMemo(() => {
    const totalCostHKD = rows.reduce((sum, row) => sum + row.totalCostHKD, 0);
    const totalMktValHKD = rows.reduce((sum, row) => sum + (row.totalMktValHKD || 0), 0);
    const largest = rows.reduce<UnderlyingExposureRow | null>((current, row) => {
      if (row.totalMktValHKD === null) return current;
      if (!current || current.totalMktValHKD === null) return row;
      return Math.abs(row.totalMktValHKD) > Math.abs(current.totalMktValHKD) ? row : current;
    }, null);

    return {
      count: rows.length,
      totalCostHKD,
      totalMktValHKD,
      largestSymbol: largest?.symbol || '-',
      largestMktValHKD: largest?.totalMktValHKD || 0,
    };
  }, [rows]);

  const sourceMktValHKD = useMemo(() => {
    const totals: Record<ExposureSourceKey, number> = {
      dqaq: 0,
      fcn: 0,
      option: 0,
      spot: 0,
    };

    rows.forEach((row) => {
      if (row.currentPrice === null) return;
      const fxRate = fxRates[row.market] || 1;
      EXPOSURE_SOURCES.forEach((source) => {
        totals[source.key] += row.bySource[source.key].shares * row.currentPrice! * fxRate;
      });
    });

    return totals;
  }, [fxRates, rows]);

  const getPnlClass = (value: number | null) => {
    if (value === null) return 'text-gray-400';
    if (value > 0) return 'text-emerald-600';
    if (value < 0) return 'text-rose-600';
    return 'text-gray-500';
  };

  return (
    <div className="space-y-6 rounded-2xl bg-gradient-to-br from-slate-50 via-white to-blue-50/60 p-1">
      <div className="rounded-2xl border border-white/80 bg-white/75 p-6 shadow-sm backdrop-blur">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="mb-3 inline-flex rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700 ring-1 ring-blue-100">Underlying Exposure</div>
          <h1 className="text-3xl font-black tracking-tight text-slate-950">标的暴露情况</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
            合并 DQ-AQ、FCN、Option、Spot 四类底层标的暴露，并按实时价格与汇率折算为 HKD。
          </p>
        </div>
        <button
          onClick={refreshData}
          disabled={loading || !userReady}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-slate-200 transition-colors hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
          刷新行情与暴露
        </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-slate-200/70 bg-white/90 p-5 shadow-sm shadow-slate-100">
          <div className="text-xs font-bold text-gray-400">底层标的数量</div>
          <div className="mt-2 text-3xl font-black text-slate-950">{summary.count}</div>
        </div>
        <div className="rounded-2xl border border-slate-200/70 bg-white/90 p-5 shadow-sm shadow-slate-100">
          <div className="text-xs font-bold text-gray-400">总暴露成本 HKD</div>
          <div className="mt-2 text-3xl font-black text-slate-950">{formatNumber(summary.totalCostHKD)}</div>
        </div>
        <div className="rounded-2xl border border-slate-200/70 bg-white/90 p-5 shadow-sm shadow-slate-100">
          <div className="text-xs font-bold text-gray-400">总暴露市值 HKD</div>
          <div className="mt-2 text-3xl font-black text-slate-950">{formatNumber(summary.totalMktValHKD)}</div>
        </div>
        <div className="rounded-2xl border border-blue-100 bg-gradient-to-br from-blue-600 to-slate-950 p-5 text-white shadow-lg shadow-blue-100">
          <div className="text-xs font-bold text-gray-400">最大单一标的</div>
          <div className="mt-2 text-3xl font-black">{summary.largestSymbol}</div>
          <div className="mt-1 text-xs text-blue-100">{formatNumber(summary.largestMktValHKD)} HKD</div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        {EXPOSURE_SOURCES.map((source) => {
          const status = sourceStatuses.find((item) => item.label === source.label);
          return (
            <div key={source.key} className="rounded-2xl border border-slate-200/70 bg-white/90 px-5 py-4 shadow-sm shadow-slate-100">
              <div className="flex items-start justify-between gap-3">
                <span className="text-sm font-bold text-gray-800">{source.label}</span>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${status?.error ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>
                  {status?.error || `${status?.count || 0} 条`}
                </span>
              </div>
              <div className="mt-2 text-xl font-black text-gray-900">{formatNumber(sourceMktValHKD[source.key])}</div>
              <div className="mt-0.5 text-[10px] font-bold uppercase tracking-wide text-gray-400">暴露总市值 HKD</div>
              <div className="mt-2 text-xs text-gray-400">{status?.updatedAt || '未获取更新时间'}</div>
            </div>
          );
        })}
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white/95 shadow-xl shadow-slate-200/60">
        <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50/80 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="font-bold text-gray-900">综合标的暴露表</h2>
            <p className="mt-1 text-xs text-gray-500">
              {lastRefreshed ? `最后刷新：${lastRefreshed}` : '等待首次刷新'}
              {stockPoolLoading ? '；股票池加载中' : ''}
            </p>
          </div>
          <div className="flex flex-col gap-2 text-xs text-gray-400 sm:flex-row sm:items-center">
            <button
              type="button"
              onClick={handleExportExcel}
              disabled={filteredRows.length === 0}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700 transition-colors hover:border-emerald-300 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <FileSpreadsheet size={14} />
              导出Excel
            </button>
            <span>可在表头按代码、市场、名称和行业组合筛选</span>
          </div>
        </div>

        {loading ? (
          <div className="flex h-64 flex-col items-center justify-center text-gray-500">
            <Loader2 size={32} className="mb-3 animate-spin text-blue-600" />
            正在拉取暴露、行情与汇率...
          </div>
        ) : (
          <div className="max-h-[620px] overflow-auto">
            <table className="min-w-full whitespace-nowrap text-left text-sm">
              <thead className="sticky top-0 z-10 bg-slate-100 text-xs font-bold text-slate-500 shadow-[0_1px_0_0_#e5e7eb]">
                <tr>
                  <FilterTh label="股票代码" filterKey="symbol" filters={filters} onFilter={updateFilter} />
                  <FilterTh label="市场" filterKey="market" filters={filters} onFilter={updateFilter} align="center" />
                  <FilterTh label="股票名称" filterKey="name" filters={filters} onFilter={updateFilter} />
                  <th className="px-3 py-3 text-right">总暴露股数</th>
                  <th className="px-3 py-3 text-right">平均暴露成本</th>
                  <th className="px-3 py-3 text-right">现价</th>
                  <SortableTh label="盈亏比%" sortKey="pnlRatio" sortState={sortState} onSort={toggleSort} />
                  <SortableTh label="总暴露成本HKD" sortKey="totalCostHKD" sortState={sortState} onSort={toggleSort} />
                  <SortableTh label="总暴露市值HKD" sortKey="totalMktValHKD" sortState={sortState} onSort={toggleSort} />
                  <SortableTh label="总暴露盈亏HKD" sortKey="totalPnlHKD" sortState={sortState} onSort={toggleSort} />
                  <FilterTh label="一级行业" filterKey="sectorLevel1" filters={filters} onFilter={updateFilter} />
                  <FilterTh label="二级行业" filterKey="sectorLevel2" filters={filters} onFilter={updateFilter} />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="px-3 py-12 text-center text-gray-400">
                      <AlertCircle size={28} className="mx-auto mb-3 text-amber-500" />
                      无匹配标的，请调整表头筛选条件
                    </td>
                  </tr>
                ) : filteredRows.map((row) => (
                  <tr key={row.key} className="transition-colors odd:bg-white even:bg-slate-50/40 hover:bg-blue-50">
                    <td className="px-3 py-3 font-mono font-bold text-blue-700">{row.symbol}</td>
                    <td className="px-3 py-3 font-mono text-gray-500">{row.market}</td>
                    <td className="px-3 py-3 font-medium text-gray-800">{row.name}</td>
                    <td className="px-3 py-3 text-right font-mono text-gray-800">{formatNumber(row.totalShares)}</td>
                    <td className="px-3 py-3 text-right font-mono text-gray-800">{formatNumber(row.avgCost)}</td>
                    <td className="px-3 py-3 text-right font-mono text-gray-900">{formatNumber(row.currentPrice)}</td>
                    <td className={`px-3 py-3 text-right font-mono font-bold ${getPnlClass(row.pnlRatio)}`}>
                      {formatPercent(row.pnlRatio)}
                    </td>
                    <td className="px-3 py-3 text-right font-mono text-gray-800">{formatNumber(row.totalCostHKD)}</td>
                    <td className="px-3 py-3 text-right font-mono font-bold text-gray-900">{formatNumber(row.totalMktValHKD)}</td>
                    <td className={`px-3 py-3 text-right font-mono font-bold ${getPnlClass(row.totalPnlHKD)}`}>
                      {formatNumber(row.totalPnlHKD)}
                    </td>
                    <td className="px-3 py-3 text-gray-700">{row.sectorLevel1}</td>
                    <td className="px-3 py-3 text-gray-700">{row.sectorLevel2}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="border-t border-slate-100 bg-white px-5 py-5">
          <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h3 className="text-base font-black text-slate-900">暴露市值占比图</h3>
              <p className="mt-1 text-xs text-slate-500">
                使用当前表格筛选结果，按绝对暴露市值HKD计算占比；类别超过 10 项时会合并为“其他”。
              </p>
            </div>
            <div className="inline-flex rounded-2xl border border-slate-200 bg-slate-50 p-1">
              {EXPOSURE_CHART_GROUPS.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setChartGroupBy(item.key)}
                  className={`rounded-xl px-3 py-2 text-xs font-black transition-colors ${
                    chartGroupBy === item.key
                      ? 'bg-slate-950 text-white shadow-sm'
                      : 'text-slate-500 hover:bg-white hover:text-slate-900'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          {exposurePieData.length === 0 ? (
            <div className="flex h-56 items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 text-sm font-bold text-slate-400">
              暂无可绘制的暴露市值数据
            </div>
          ) : (
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
              <div className="h-[360px] rounded-2xl border border-slate-100 bg-gradient-to-br from-white to-slate-50 p-3">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={exposurePieData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius="48%"
                      outerRadius="76%"
                      paddingAngle={2}
                      labelLine={false}
                      label={(props: any) => {
                        if (!props.percent || props.percent < 0.055) return '';
                        return `${props.name} ${(props.percent * 100).toFixed(1)}%`;
                      }}
                    >
                      {exposurePieData.map((entry, index) => (
                        <Cell key={entry.name} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value: any, _name: any, props: any) => [
                        `${formatNumber(Number(value))} HKD`,
                        props?.payload?.name || '暴露市值',
                      ]}
                      labelFormatter={() => ''}
                    />
                    <Legend verticalAlign="bottom" height={32} />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              <div className="rounded-2xl border border-slate-100 bg-slate-50/80 p-4">
                <div className="mb-3 flex items-center justify-between text-xs font-black text-slate-500">
                  <span>分布明细</span>
                  <span>合计 {formatNumber(exposurePieTotal)} HKD</span>
                </div>
                <div className="max-h-[320px] space-y-2 overflow-auto pr-1">
                  {exposurePieData.map((item, index) => {
                    const ratio = exposurePieTotal > 0 ? item.value / exposurePieTotal : 0;
                    return (
                      <div key={item.name} className="rounded-xl border border-white bg-white px-3 py-2 shadow-sm">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="h-2.5 w-2.5 flex-none rounded-full" style={{ backgroundColor: PIE_COLORS[index % PIE_COLORS.length] }} />
                            <span className="truncate text-sm font-bold text-slate-800">{item.name}</span>
                          </div>
                          <span className="font-mono text-sm font-black text-slate-900">{formatPercent(ratio)}</span>
                        </div>
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                          <div className="h-full rounded-full" style={{ width: `${Math.min(ratio * 100, 100)}%`, backgroundColor: PIE_COLORS[index % PIE_COLORS.length] }} />
                        </div>
                        <div className="mt-1 flex items-center justify-between text-[11px] text-slate-400">
                          <span>{item.count} 个标的</span>
                          <span>{formatNumber(item.value)} HKD</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-slate-100 bg-slate-50 px-5 py-3 text-xs text-slate-500">
          行情来自现有 <span className="font-mono">/api/quote</span>，行业与名称来自 <span className="font-mono">useStockPool()</span>。本页只读展示，不写回数据库。
        </div>
      </div>

      {showExportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-5xl overflow-hidden rounded-3xl border border-white/70 bg-white shadow-2xl shadow-slate-900/20">
            <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50 px-6 py-5 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700 ring-1 ring-emerald-100">
                  <FileSpreadsheet size={14} />
                  Excel Paste
                </div>
                <h3 className="mt-3 text-2xl font-black tracking-tight text-slate-950">导出综合标的暴露表</h3>
                <p className="mt-1 text-sm text-slate-500">
                  以下内容已用 Tab 分隔，复制后可直接粘贴到 Excel。当前共 {filteredRows.length} 条记录。
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowExportModal(false)}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-600 transition-colors hover:bg-slate-100"
              >
                关闭
              </button>
            </div>

            <div className="p-6">
              <textarea
                readOnly
                value={exportText}
                className="h-[420px] w-full resize-none rounded-2xl border border-slate-200 bg-slate-950 p-4 font-mono text-xs leading-5 text-slate-50 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                onFocus={(event) => event.currentTarget.select()}
              />
              <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-xs text-slate-500">
                  {copyStatus || '提示：也可以点击文本框后 Ctrl+A / Ctrl+C 手动复制。'}
                </div>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={handleCopyExportText}
                    className="rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-black text-white shadow-lg shadow-emerald-100 transition-colors hover:bg-emerald-700"
                  >
                    一键复制
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowExportModal(false)}
                    className="rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-bold text-slate-600 transition-colors hover:bg-slate-100"
                  >
                    关闭
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
