'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Loader2, RefreshCw } from 'lucide-react';
import { doc, getDoc } from 'firebase/firestore';
import { onAuthStateChanged, signInAnonymously, signInWithCustomToken } from 'firebase/auth';
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

const EXPOSURE_SOURCES: ExposureSource[] = [
  { key: 'dqaq', label: 'DQ-AQ', collection: 'sip_exposure_dqaq' },
  { key: 'fcn', label: 'FCN', collection: 'sip_exposure_fcn' },
  { key: 'option', label: 'Option', collection: 'sip_exposure_option' },
  { key: 'spot', label: 'Spot', collection: 'sip_exposure_spot' },
];

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

const normalizeSymbol = (symbol: string) => symbol.trim().toUpperCase();

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
  const [sortState, setSortState] = useState<SortState>(null);

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

  const getSortValue = (row: UnderlyingExposureRow, key: SortKey) => {
    const value = row[key];
    return value === null || value === undefined || Number.isNaN(value) ? -Infinity : value;
  };

  const filteredRows = useMemo(() => {
    const searched = rows.filter((row) => (
      (!filters.symbol.trim() || row.symbol.includes(filters.symbol.trim().toUpperCase())) &&
      (!filters.market.trim() || row.market.includes(filters.market.trim().toUpperCase())) &&
      (!filters.name.trim() || row.name.toUpperCase().includes(filters.name.trim().toUpperCase())) &&
      (!filters.sectorLevel1.trim() || row.sectorLevel1.toUpperCase().includes(filters.sectorLevel1.trim().toUpperCase())) &&
      (!filters.sectorLevel2.trim() || row.sectorLevel2.toUpperCase().includes(filters.sectorLevel2.trim().toUpperCase()))
    ));

    if (!sortState) return searched;

    return [...searched].sort((a, b) => {
      const left = getSortValue(a, sortState.key);
      const right = getSortValue(b, sortState.key);
      return sortState.dir === 'asc' ? left - right : right - left;
    });
  }, [filters, rows, sortState]);

  const summary = useMemo(() => {
    const totalCostHKD = rows.reduce((sum, row) => sum + row.totalCostHKD, 0);
    const totalMktValHKD = rows.reduce((sum, row) => sum + (row.totalMktValHKD || 0), 0);
    const largest = rows[0];

    return {
      count: rows.length,
      totalCostHKD,
      totalMktValHKD,
      largestSymbol: largest?.symbol || '-',
      largestCostHKD: largest?.totalCostHKD || 0,
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

  const SortableTh = ({ label, sortKey }: { label: string; sortKey: SortKey }) => (
    <th className="px-3 py-3 text-right">
      <button
        type="button"
        onClick={() => toggleSort(sortKey)}
        className="inline-flex items-center gap-1 font-bold text-gray-500 transition-colors hover:text-gray-900"
      >
        {label}
        <span className={`text-[10px] ${sortState?.key === sortKey ? 'text-blue-600' : 'text-gray-300'}`}>
          {sortState?.key === sortKey ? (sortState.dir === 'asc' ? '▲' : '▼') : '▲'}
        </span>
      </button>
    </th>
  );

  const FilterTh = ({ label, filterKey, align = 'left' }: { label: string; filterKey: TextFilterKey; align?: 'left' | 'center' }) => (
    <th className={`px-3 py-3 align-top ${align === 'center' ? 'text-center' : 'text-left'}`}>
      <div className="font-bold text-gray-500">{label}</div>
      <input
        value={filters[filterKey]}
        onChange={(event) => setFilters((prev) => ({ ...prev, [filterKey]: event.target.value }))}
        placeholder="筛选"
        className={`mt-1 w-full min-w-[72px] rounded border border-gray-300 bg-white px-2 py-1 text-xs font-normal text-gray-700 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 ${align === 'center' ? 'text-center' : ''}`}
      />
    </th>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">标的暴露情况</h1>
          <p className="mt-2 text-sm text-gray-500">
            合并 DQ-AQ、FCN、Option、Spot 四类底层标的暴露，并按实时价格与汇率折算为 HKD。
          </p>
        </div>
        <button
          onClick={refreshData}
          disabled={loading || !userReady}
          className="inline-flex items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
          刷新行情与暴露
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <div className="text-xs font-bold text-gray-400">底层标的数量</div>
          <div className="mt-2 text-2xl font-black text-gray-900">{summary.count}</div>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <div className="text-xs font-bold text-gray-400">总暴露成本 HKD</div>
          <div className="mt-2 text-2xl font-black text-gray-900">{formatNumber(summary.totalCostHKD)}</div>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <div className="text-xs font-bold text-gray-400">总暴露市值 HKD</div>
          <div className="mt-2 text-2xl font-black text-gray-900">{formatNumber(summary.totalMktValHKD)}</div>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <div className="text-xs font-bold text-gray-400">最大单一标的</div>
          <div className="mt-2 text-2xl font-black text-gray-900">{summary.largestSymbol}</div>
          <div className="mt-1 text-xs text-gray-500">{formatNumber(summary.largestCostHKD)} HKD</div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        {EXPOSURE_SOURCES.map((source) => {
          const status = sourceStatuses.find((item) => item.label === source.label);
          return (
            <div key={source.key} className="rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-sm">
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

      <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-gray-200 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="font-bold text-gray-900">综合标的暴露表</h2>
            <p className="mt-1 text-xs text-gray-500">
              {lastRefreshed ? `最后刷新：${lastRefreshed}` : '等待首次刷新'}
              {stockPoolLoading ? '；股票池加载中' : ''}
            </p>
          </div>
          <div className="text-xs text-gray-400">可在表头按代码、市场、名称和行业组合筛选</div>
        </div>

        {loading ? (
          <div className="flex h-64 flex-col items-center justify-center text-gray-500">
            <Loader2 size={32} className="mb-3 animate-spin text-blue-600" />
            正在拉取暴露、行情与汇率...
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center text-gray-400">
            <AlertCircle size={32} className="mb-3 text-amber-500" />
            暂无可展示的标的暴露数据
          </div>
        ) : (
          <div className="max-h-[620px] overflow-auto">
            <table className="min-w-full whitespace-nowrap text-left text-sm">
              <thead className="sticky top-0 z-10 bg-gray-50 text-xs font-bold text-gray-500 shadow-[0_1px_0_0_#e5e7eb]">
                <tr>
                  <FilterTh label="股票代码" filterKey="symbol" />
                  <FilterTh label="市场" filterKey="market" align="center" />
                  <FilterTh label="股票名称" filterKey="name" />
                  <th className="px-3 py-3 text-right">总暴露股数</th>
                  <th className="px-3 py-3 text-right">平均暴露成本</th>
                  <th className="px-3 py-3 text-right">现价</th>
                  <SortableTh label="盈亏比%" sortKey="pnlRatio" />
                  <SortableTh label="总暴露成本HKD" sortKey="totalCostHKD" />
                  <SortableTh label="总暴露市值HKD" sortKey="totalMktValHKD" />
                  <SortableTh label="总暴露盈亏HKD" sortKey="totalPnlHKD" />
                  <FilterTh label="一级行业" filterKey="sectorLevel1" />
                  <FilterTh label="二级行业" filterKey="sectorLevel2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {filteredRows.map((row) => (
                  <tr key={row.key} className="hover:bg-blue-50/30">
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

        <div className="border-t border-gray-100 bg-gray-50 px-4 py-3 text-xs text-gray-500">
          行情来自现有 <span className="font-mono">/api/quote</span>，行业与名称来自 <span className="font-mono">useStockPool()</span>。本页只读展示，不写回数据库。
        </div>
      </div>
    </div>
  );
}
