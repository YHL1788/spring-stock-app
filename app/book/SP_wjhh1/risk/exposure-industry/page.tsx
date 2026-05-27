'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Loader2, RefreshCw, X } from 'lucide-react';
import { doc, getDoc } from 'firebase/firestore';
import { onAuthStateChanged, signInAnonymously, signInWithCustomToken } from 'firebase/auth';
import { ResponsiveContainer, Tooltip, Treemap } from 'recharts';
import { db, auth, APP_ID } from '@/app/lib/stockService';
import { useStockPool } from '@/app/hooks/useStockPool';

type ExposureSourceKey = 'dqaq' | 'fcn' | 'option' | 'spot';
type IndustryLevel = 'level1' | 'level2';

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

interface QuoteInfo {
  price: number;
  changePercent: number;
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
  dailyChangePct: number | null;
  totalCostHKD: number;
  totalMktValHKD: number | null;
  totalPnlHKD: number | null;
  sectorLevel1: string;
  sectorLevel2: string;
  bySource: Record<ExposureSourceKey, SourceBreakdown>;
}

interface IndustryGroup {
  key: string;
  groupKey: string;
  name: string;
  sectorLevel1: string;
  sectorLevel2?: string;
  size: number;
  netMktValHKD: number;
  totalCostHKD: number;
  totalPnlHKD: number;
  weightedDailyChange: number | null;
  symbolsCount: number;
  rows: UnderlyingExposureRow[];
}

interface SourceStatus {
  label: string;
  updatedAt: string | null;
  count: number;
  error?: string;
}

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

const getChangeColor = (value: number | null | undefined) => {
  if (value === null || value === undefined) return '#9ca3af';
  if (value >= 0.03) return '#047857';
  if (value >= 0.01) return '#10b981';
  if (value > 0) return '#86efac';
  if (value <= -0.03) return '#be123c';
  if (value <= -0.01) return '#f43f5e';
  if (value < 0) return '#fda4af';
  return '#94a3b8';
};

const getPnlClass = (value: number | null) => {
  if (value === null) return 'text-gray-400';
  if (value > 0) return 'text-emerald-600';
  if (value < 0) return 'text-rose-600';
  return 'text-gray-500';
};

function IndustryTile(props: any) {
  const { x, y, width, height, name, groupKey, weightedDailyChange, netMktValHKD, symbolsCount, onSelect } = props;
  if (width < 8 || height < 8) return null;

  const minSide = Math.min(width, height);
  const titleSize = Math.max(12, Math.min(28, minSide * 0.24, width * 0.14));
  const valueSize = Math.max(11, Math.min(20, titleSize * 0.78));
  const metaSize = Math.max(10, Math.min(16, titleSize * 0.66));
  const tiny = width < 68 || height < 34;
  const compact = width < 145 || height < 82;
  const centerX = x + width / 2;
  const centerY = y + height / 2;
  const lineGap = Math.max(4, titleSize * 0.28);
  const titleOnly = height < 50 || width < 95;
  const blockHeight = titleOnly
    ? titleSize
    : compact
      ? titleSize + lineGap + valueSize
      : titleSize + lineGap + valueSize + lineGap + metaSize + lineGap + metaSize;
  const startY = centerY - blockHeight / 2 + titleSize * 0.78;

  return (
    <g onClick={() => onSelect?.(groupKey)} className="cursor-pointer">
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={4}
        ry={4}
        fill={getChangeColor(weightedDailyChange)}
        stroke="#ffffff"
        strokeWidth={2}
      />
      {!tiny && (
        <>
          <text x={centerX} y={startY} fill="#ffffff" fontSize={titleSize} fontWeight={900} textAnchor="middle">
            {name}
          </text>
          {!titleOnly && (
            <>
              <text x={centerX} y={startY + titleSize + lineGap} fill="#ffffff" fontSize={valueSize} fontWeight={800} textAnchor="middle">
                {formatNumber(netMktValHKD, 0)} HKD
              </text>
              {!compact && (
                <>
                  <text x={centerX} y={startY + titleSize + lineGap + valueSize + lineGap} fill="#ffffff" fontSize={metaSize} fontWeight={900} textAnchor="middle">
                    {formatPercent(weightedDailyChange)}
                  </text>
                  <text x={centerX} y={startY + titleSize + lineGap + valueSize + lineGap + metaSize + lineGap} fill="#ffffff" fontSize={metaSize} textAnchor="middle">
                    {symbolsCount} 个标的
                  </text>
                </>
              )}
            </>
          )}
        </>
      )}
    </g>
  );
}

function IndustryTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const data = payload[0]?.payload;
  if (!data) return null;

  return (
    <div className="rounded-xl border border-slate-200 bg-white/95 p-3 text-xs shadow-xl shadow-slate-200/70 backdrop-blur">
      <div className="mb-2 font-bold text-gray-900">{data.name}</div>
      <div className="space-y-1 text-gray-600">
        <div>暴露市值：<span className="font-mono text-gray-900">{formatNumber(data.netMktValHKD)} HKD</span></div>
        <div>加权当日涨跌：<span className={`font-mono ${getPnlClass(data.weightedDailyChange)}`}>{formatPercent(data.weightedDailyChange)}</span></div>
        <div>标的数量：<span className="font-mono text-gray-900">{data.symbolsCount}</span></div>
      </div>
    </div>
  );
}

export default function ExposureIndustryPage() {
  const { stocks: stockPool, loading: stockPoolLoading } = useStockPool();
  const [userReady, setUserReady] = useState(false);
  const [level, setLevel] = useState<IndustryLevel>('level1');
  const [exposures, setExposures] = useState<NormalizedExposure[]>([]);
  const [sourceStatuses, setSourceStatuses] = useState<SourceStatus[]>([]);
  const [quotes, setQuotes] = useState<Record<string, QuoteInfo>>({});
  const [fxRates, setFxRates] = useState<Record<string, number>>({ HKD: 1 });
  const [loading, setLoading] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [selectedMarket, setSelectedMarket] = useState('ALL');
  const [detailOpen, setDetailOpen] = useState(false);

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

  const fetchQuote = async (symbol: string): Promise<QuoteInfo | null> => {
    const candidates = symbol.endsWith('.US') ? [symbol, symbol.replace(/\.US$/, '')] : [symbol];

    for (const candidate of candidates) {
      try {
        const res = await fetch(`/api/quote?symbol=${encodeURIComponent(candidate)}`);
        if (!res.ok) continue;
        const data = await res.json();
        const price = data.regularMarketPrice || data.price || data.close;
        if (!price) continue;

        const rawChange = data.changePercent ?? data.regularMarketChangePercent ?? 0;
        const changePercent = Number(rawChange) / 100;
        return { price: Number(price), changePercent };
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
      setQuotes(Object.fromEntries(quotePairs.filter(([, quote]) => quote !== null)) as Record<string, QuoteInfo>);
      setFxRates({ HKD: 1, ...Object.fromEntries(ratePairs) });
      setLastRefreshed(new Date().toLocaleString('zh-CN', { hour12: false }));
    } finally {
      setLoading(false);
    }
  }, [userReady]);

  useEffect(() => {
    refreshData();
  }, [refreshData]);

  const underlyingRows = useMemo<UnderlyingExposureRow[]>(() => {
    const stockMap = new Map<string, any>();
    stockPool.forEach((stock) => {
      if (stock.symbol) stockMap.set(normalizeSymbol(stock.symbol), stock);
    });

    const grouped = new Map<string, UnderlyingExposureRow & { totalCostLocal: number }>();

    exposures.forEach((item) => {
      const key = `${item.symbol}|${item.market}`;
      const stockInfo = stockMap.get(item.symbol) || stockMap.get(item.symbol.replace(/\.US$/, ''));

      if (!grouped.has(key)) {
        grouped.set(key, {
          key,
          symbol: item.symbol,
          market: item.market,
          name: stockInfo?.name || item.symbol,
          totalShares: 0,
          avgCost: null,
          currentPrice: null,
          dailyChangePct: null,
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
      const quote = quotes[row.symbol] || null;
      const fxRate = fxRates[row.market] || 1;
      const avgCost = Math.abs(row.totalShares) > 0.00001 ? row.totalCostLocal / row.totalShares : null;
      const currentPrice = quote?.price ?? null;
      const totalCostHKD = row.totalCostLocal * fxRate;
      const totalMktValHKD = currentPrice !== null ? row.totalShares * currentPrice * fxRate : null;
      const totalPnlHKD = totalMktValHKD !== null ? totalMktValHKD - totalCostHKD : null;

      return {
        ...row,
        avgCost,
        currentPrice,
        dailyChangePct: quote?.changePercent ?? null,
        totalCostHKD,
        totalMktValHKD,
        totalPnlHKD,
      };
    });
  }, [exposures, fxRates, quotes, stockPool]);

  const marketOptions = useMemo(() => {
    return ['ALL', ...Array.from(new Set(underlyingRows.map((row) => row.market))).sort()];
  }, [underlyingRows]);

  const filteredUnderlyingRows = useMemo(() => {
    if (selectedMarket === 'ALL') return underlyingRows;
    return underlyingRows.filter((row) => row.market === selectedMarket);
  }, [selectedMarket, underlyingRows]);

  const industryGroups = useMemo<IndustryGroup[]>(() => {
    const map = new Map<string, IndustryGroup & { weightedSum: number; weightSum: number; symbols: Set<string> }>();

    filteredUnderlyingRows.forEach((row) => {
      const industryName = level === 'level1' ? row.sectorLevel1 : row.sectorLevel2;
      const key = level === 'level1' ? row.sectorLevel1 : `${row.sectorLevel1}|${row.sectorLevel2}`;
      const size = Math.abs(row.totalMktValHKD || 0);

      if (!map.has(key)) {
        map.set(key, {
          key,
          groupKey: key,
          name: industryName || '未知',
          sectorLevel1: row.sectorLevel1,
          sectorLevel2: level === 'level2' ? row.sectorLevel2 : undefined,
          size: 0,
          netMktValHKD: 0,
          totalCostHKD: 0,
          totalPnlHKD: 0,
          weightedDailyChange: null,
          symbolsCount: 0,
          rows: [],
          weightedSum: 0,
          weightSum: 0,
          symbols: new Set<string>(),
        });
      }

      const group = map.get(key)!;
      group.size += size;
      group.netMktValHKD += row.totalMktValHKD || 0;
      group.totalCostHKD += row.totalCostHKD;
      group.totalPnlHKD += row.totalPnlHKD || 0;
      group.rows.push(row);
      group.symbols.add(row.symbol);

      if (row.dailyChangePct !== null && size > 0) {
        group.weightedSum += row.dailyChangePct * size;
        group.weightSum += size;
      }
    });

    return Array.from(map.values()).map((group) => ({
      ...group,
      symbolsCount: group.symbols.size,
      weightedDailyChange: group.weightSum > 0 ? group.weightedSum / group.weightSum : null,
    })).sort((a, b) => b.size - a.size);
  }, [filteredUnderlyingRows, level]);

  useEffect(() => {
    if (!industryGroups.length) {
      setSelectedKey(null);
      setDetailOpen(false);
      return;
    }
    if (selectedKey && !industryGroups.some((group) => group.key === selectedKey)) {
      setSelectedKey(null);
      setDetailOpen(false);
    }
  }, [industryGroups, selectedKey]);

  const selectedGroup = industryGroups.find((group) => group.key === selectedKey) || null;

  const openIndustryDetail = (groupKey: string) => {
    setSelectedKey(groupKey);
    setDetailOpen(true);
  };

  const summary = useMemo(() => {
    const grossMktValHKD = industryGroups.reduce((sum, group) => sum + group.size, 0);
    const netMktValHKD = industryGroups.reduce((sum, group) => sum + group.netMktValHKD, 0);
    const weightedSum = industryGroups.reduce((sum, group) => (
      group.weightedDailyChange === null ? sum : sum + group.weightedDailyChange * group.size
    ), 0);
    const weightedChange = grossMktValHKD > 0 ? weightedSum / grossMktValHKD : null;

    return {
      groupsCount: industryGroups.length,
      grossMktValHKD,
      netMktValHKD,
      weightedChange,
      largestGroup: industryGroups[0]?.name || '-',
    };
  }, [industryGroups]);

  return (
    <div className="space-y-6 rounded-2xl bg-gradient-to-br from-slate-50 via-white to-emerald-50/50 p-1">
      <div className="rounded-2xl border border-white/80 bg-white/75 p-6 shadow-sm backdrop-blur">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="mb-3 inline-flex rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700 ring-1 ring-emerald-100">Industry Heatmap</div>
          <h1 className="text-3xl font-black tracking-tight text-slate-950">行业暴露情况</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
            参考行业热力图展示组合暴露：面积代表暴露市值，颜色代表加权当日涨跌幅。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={selectedMarket}
            onChange={(event) => setSelectedMarket(event.target.value)}
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-bold text-gray-700 shadow-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          >
            {marketOptions.map((market) => (
              <option key={market} value={market}>
                {market === 'ALL' ? '全部币种' : market}
              </option>
            ))}
          </select>
          <div className="rounded-xl bg-slate-200/80 p-1 shadow-inner">
            <button
              onClick={() => setLevel('level1')}
              className={`rounded px-3 py-1.5 text-xs font-bold transition-colors ${level === 'level1' ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-900'}`}
            >
              一级行业
            </button>
            <button
              onClick={() => setLevel('level2')}
              className={`rounded px-3 py-1.5 text-xs font-bold transition-colors ${level === 'level2' ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-900'}`}
            >
              二级行业
            </button>
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
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-slate-200/70 bg-white/90 p-5 shadow-sm shadow-slate-100">
          <div className="text-xs font-bold text-gray-400">行业数量</div>
          <div className="mt-2 text-3xl font-black text-slate-950">{summary.groupsCount}</div>
        </div>
        <div className="rounded-2xl border border-slate-200/70 bg-white/90 p-5 shadow-sm shadow-slate-100">
          <div className="text-xs font-bold text-gray-400">总暴露市值 HKD</div>
          <div className="mt-2 text-3xl font-black text-slate-950">{formatNumber(summary.grossMktValHKD)}</div>
        </div>
        <div className="rounded-2xl border border-slate-200/70 bg-white/90 p-5 shadow-sm shadow-slate-100">
          <div className="text-xs font-bold text-gray-400">组合加权当日涨跌</div>
          <div className={`mt-2 text-3xl font-black ${getPnlClass(summary.weightedChange)}`}>{formatPercent(summary.weightedChange)}</div>
        </div>
        <div className="rounded-2xl border border-emerald-100 bg-gradient-to-br from-emerald-600 to-slate-950 p-5 text-white shadow-lg shadow-emerald-100">
          <div className="text-xs font-bold text-gray-400">最大行业暴露</div>
          <div className="mt-2 text-3xl font-black">{summary.largestGroup}</div>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white/95 shadow-xl shadow-slate-200/60">
        <div className="border-b border-slate-200 bg-slate-50/80 px-5 py-4">
          <h2 className="font-bold text-gray-900">{level === 'level1' ? '一级行业热力图' : '二级行业热力图'}</h2>
          <p className="mt-1 text-xs text-gray-500">
            {lastRefreshed ? `最后刷新：${lastRefreshed}` : '等待首次刷新'}
            {stockPoolLoading ? '；股票池加载中' : ''}
          </p>
        </div>
        <div className="h-[640px] bg-slate-950/5 p-3">
          {loading ? (
            <div className="flex h-full flex-col items-center justify-center text-gray-500">
              <Loader2 size={32} className="mb-3 animate-spin text-blue-600" />
              正在拉取行业暴露、行情与汇率...
            </div>
          ) : industryGroups.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-gray-400">
              <AlertCircle size={32} className="mb-3 text-amber-500" />
              暂无可展示的行业暴露数据
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <Treemap
                data={industryGroups as any[]}
                dataKey="size"
                nameKey="name"
                isAnimationActive={false}
                content={<IndustryTile onSelect={openIndustryDetail} />}
              >
                <Tooltip content={<IndustryTooltip />} />
              </Treemap>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {detailOpen && selectedGroup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
          <div className="flex max-h-[88vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl shadow-slate-950/30">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 bg-gradient-to-r from-slate-50 to-blue-50 px-6 py-5">
              <div>
                <h2 className="text-xl font-black text-gray-900">{selectedGroup.name}</h2>
                <p className="mt-1 text-sm text-gray-500">
                  暴露市值 {formatNumber(selectedGroup.netMktValHKD)} HKD，
                  {selectedGroup.symbolsCount} 个标的，加权当日涨跌 {formatPercent(selectedGroup.weightedDailyChange)}
                </p>
              </div>
              <button
                onClick={() => setDetailOpen(false)}
                className="rounded-full p-2 text-gray-400 transition-colors hover:bg-gray-200 hover:text-gray-700"
              >
                <X size={20} />
              </button>
            </div>

            <div className="overflow-auto">
              <table className="min-w-full whitespace-nowrap text-left text-sm">
                <thead className="sticky top-0 z-10 bg-slate-100 text-xs font-bold text-slate-500 shadow-[0_1px_0_0_#e5e7eb]">
                  <tr>
                    <th className="px-4 py-3">代码</th>
                    <th className="px-4 py-3">名称</th>
                    <th className="px-4 py-3">市场</th>
                    <th className="px-4 py-3 text-right">暴露股数</th>
                    <th className="px-4 py-3 text-right">现价</th>
                    <th className="px-4 py-3 text-right">当日涨跌</th>
                    <th className="px-4 py-3 text-right">市值HKD</th>
                    <th className="px-4 py-3 text-right">盈亏HKD</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {[...selectedGroup.rows].sort((a, b) => Math.abs(b.totalMktValHKD || 0) - Math.abs(a.totalMktValHKD || 0)).map((row) => (
                    <tr key={row.key} className="transition-colors odd:bg-white even:bg-slate-50/40 hover:bg-blue-50">
                      <td className="px-4 py-3 font-mono font-bold text-blue-700">{row.symbol}</td>
                      <td className="px-4 py-3 font-medium text-gray-800">{row.name}</td>
                      <td className="px-4 py-3 font-mono text-gray-500">{row.market}</td>
                      <td className="px-4 py-3 text-right font-mono">{formatNumber(row.totalShares)}</td>
                      <td className="px-4 py-3 text-right font-mono">{formatNumber(row.currentPrice)}</td>
                      <td className={`px-4 py-3 text-right font-mono font-bold ${getPnlClass(row.dailyChangePct)}`}>{formatPercent(row.dailyChangePct)}</td>
                      <td className="px-4 py-3 text-right font-mono font-bold text-gray-900">{formatNumber(row.totalMktValHKD)}</td>
                      <td className={`px-4 py-3 text-right font-mono font-bold ${getPnlClass(row.totalPnlHKD)}`}>{formatNumber(row.totalPnlHKD)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white/95 shadow-xl shadow-slate-200/60">
        <div className="border-b border-slate-200 bg-slate-50/80 px-5 py-4">
          <h2 className="font-bold text-gray-900">行业汇总表</h2>
        </div>
        <div className="overflow-auto">
          <table className="min-w-full whitespace-nowrap text-left text-sm">
            <thead className="bg-gray-50 text-xs font-bold text-gray-500">
              <tr>
                <th className="px-3 py-3">行业</th>
                {level === 'level2' && <th className="px-3 py-3">一级行业</th>}
                <th className="px-3 py-3 text-right">标的数量</th>
                <th className="px-3 py-3 text-right">暴露成本HKD</th>
                <th className="px-3 py-3 text-right">暴露市值HKD</th>
                <th className="px-3 py-3 text-right">暴露盈亏HKD</th>
                <th className="px-3 py-3 text-right">加权当日涨跌</th>
                <th className="px-3 py-3 text-right">权重%</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {industryGroups.map((group) => (
                <tr
                  key={group.key}
                  onClick={() => setSelectedKey(group.key)}
                  className={`cursor-pointer transition-colors odd:bg-white even:bg-slate-50/40 hover:bg-blue-50 ${selectedGroup?.key === group.key ? 'bg-blue-50' : ''}`}
                >
                  <td className="px-3 py-3 font-bold text-gray-900">{group.name}</td>
                  {level === 'level2' && <td className="px-3 py-3 text-gray-600">{group.sectorLevel1}</td>}
                  <td className="px-3 py-3 text-right font-mono">{group.symbolsCount}</td>
                  <td className="px-3 py-3 text-right font-mono">{formatNumber(group.totalCostHKD)}</td>
                  <td className="px-3 py-3 text-right font-mono font-bold">{formatNumber(group.netMktValHKD)}</td>
                  <td className={`px-3 py-3 text-right font-mono font-bold ${getPnlClass(group.totalPnlHKD)}`}>{formatNumber(group.totalPnlHKD)}</td>
                  <td className={`px-3 py-3 text-right font-mono font-bold ${getPnlClass(group.weightedDailyChange)}`}>{formatPercent(group.weightedDailyChange)}</td>
                  <td className="px-3 py-3 text-right font-mono">{formatPercent(summary.grossMktValHKD > 0 ? group.size / summary.grossMktValHKD : null)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="border-t border-slate-100 bg-slate-50 px-5 py-3 text-xs text-slate-500">
          面积按绝对暴露市值计算，颜色按个股当日涨跌幅以绝对市值加权。绿涨红跌，和现有持仓页口径保持一致。
        </div>
      </div>
    </div>
  );
}
