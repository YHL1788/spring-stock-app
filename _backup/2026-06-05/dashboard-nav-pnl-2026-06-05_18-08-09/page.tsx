'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  TrendingUp,
  Briefcase,
  ShieldAlert,
  ArrowRight,
  Wallet,
  Activity,
  AlertTriangle,
  BarChart3,
  Loader2,
} from 'lucide-react';
import { collection, doc, getDocs, onSnapshot } from 'firebase/firestore';
import { onAuthStateChanged, signInAnonymously, signInWithCustomToken } from 'firebase/auth';
import { auth, db, APP_ID } from '@/app/lib/stockService';

const ASSET_TYPES = [
  { id: 'cash', label: '现金' },
  { id: 'stock', label: '现货' },
  { id: 'pe', label: 'PE' },
  { id: 'cbbc', label: 'CBBC' },
  { id: 'option', label: 'Option' },
  { id: 'fcn', label: 'FCN' },
  { id: 'dqaq', label: 'DQ-AQ' },
];

const EXPOSURE_SOURCES = [
  { key: 'dqaq', label: 'DQ-AQ', collection: 'sip_exposure_dqaq' },
  { key: 'fcn', label: 'FCN', collection: 'sip_exposure_fcn' },
  { key: 'option', label: 'Option', collection: 'sip_exposure_option' },
  { key: 'spot', label: 'Spot', collection: 'sip_exposure_spot' },
];

const ACTIVITY_SOURCES = [
  { type: 'trade', action: '新交易录入', label: 'FCN', collection: 'sip_trade_fcn_input_living' },
  { type: 'trade', action: '新交易录入', label: 'DQ-AQ', collection: 'sip_trade_dqaq_input_living' },
  { type: 'trade', action: '新交易录入', label: 'Option', collection: 'sip_trade_option_input_living' },
  { type: 'trade', action: '新交易录入', label: 'Spot', collection: 'sip_spot_trade' },
  { type: 'fund', action: '资金变动', label: 'Cash', collection: 'sip_trade_cash' },
];

type SummaryDoc = {
  markets?: string[];
  accounts?: string[];
  rawMatrix?: Record<string, any>;
  updatedAt?: any;
};

type ExposureItem = {
  symbol: string;
  market: string;
  shares: number;
  cost: number;
};

type ActivityLog = {
  action: string;
  detail: string;
  time: string;
  timestamp: number;
  type: string;
};

const toNumber = (value: any) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};

const normalizeSymbol = (value: string) => value.trim().toUpperCase();

const inferMarket = (symbol: string, fallback = '') => {
  const upperFallback = fallback.trim().toUpperCase();
  if (['HKD', 'USD', 'CNY', 'JPY'].includes(upperFallback)) return upperFallback;
  if (symbol.endsWith('.HK')) return 'HKD';
  if (symbol.endsWith('.SS') || symbol.endsWith('.SZ')) return 'CNY';
  if (symbol.endsWith('.T') || symbol.endsWith('.JP')) return 'JPY';
  return upperFallback || 'USD';
};

const formatMoney = (value: number) => {
  if (!Number.isFinite(value)) return '--';
  const abs = Math.abs(value);
  if (abs >= 100000000) return `${(value / 100000000).toFixed(2)}亿`;
  if (abs >= 10000) return `${(value / 10000).toFixed(2)}万`;
  return value.toLocaleString('en-US', { maximumFractionDigits: 0 });
};

const formatSignedMoney = (value: number) => {
  if (!Number.isFinite(value)) return '--';
  const prefix = value > 0 ? '+' : '';
  return `${prefix}${formatMoney(value)}`;
};

const formatPercent = (value: number | null) => {
  if (value === null || !Number.isFinite(value)) return '--';
  return `${(value * 100).toFixed(1)}%`;
};

const asDate = (value: any): Date | null => {
  if (!value) return null;
  if (typeof value?.toDate === 'function') return value.toDate();
  if (typeof value === 'number') return new Date(value < 10000000000 ? value * 1000 : value);
  if (typeof value === 'string') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
};

const formatRelativeTime = (timestamp: number) => {
  if (!timestamp) return '--';
  const diffMs = Date.now() - timestamp;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diffMs < minute) return '刚刚';
  if (diffMs < hour) return `${Math.floor(diffMs / minute)}分钟前`;
  if (diffMs < day) return `${Math.floor(diffMs / hour)}小时前`;
  return `${Math.floor(diffMs / day)}天前`;
};

const sumMatrixByFx = (summary: SummaryDoc | undefined, fxRates: Record<string, number>, valueType?: 'total') => {
  if (!summary?.rawMatrix) return 0;
  return Object.entries(summary.rawMatrix).reduce((sum, [market, row]) => {
    const rate = fxRates[market] || 1;
    if (valueType === 'total') return sum + toNumber(row?.total) * rate;
    if (row && typeof row === 'object') {
      return sum + Object.values(row as Record<string, any>).reduce((inner: number, val: any) => inner + toNumber(val), 0) * rate;
    }
    return sum + toNumber(row) * rate;
  }, 0);
};

const pickFirst = (record: any, keys: string[]) => {
  for (const key of keys) {
    if (record?.[key] !== undefined && record?.[key] !== null && String(record[key]).trim() !== '') return record[key];
  }
  return '';
};

export default function SPWjhh1Dashboard() {
  const [mktSummaries, setMktSummaries] = useState<Record<string, SummaryDoc>>({});
  const [plSummaries, setPlSummaries] = useState<Record<string, SummaryDoc>>({});
  const [exposures, setExposures] = useState<ExposureItem[]>([]);
  const [fxRates, setFxRates] = useState<Record<string, number>>({ HKD: 1 });
  const [quotes, setQuotes] = useState<Record<string, number>>({});
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let unsubs: Array<() => void> = [];
    let cancelled = false;

    const init = async () => {
      try {
        if (!auth.currentUser) {
          // @ts-ignore
          if (typeof window !== 'undefined' && window.__initial_auth_token) {
            // @ts-ignore
            await signInWithCustomToken(auth, window.__initial_auth_token);
          } else {
            await signInAnonymously(auth);
          }
        }

        const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
          if (!user || cancelled) return;

          ASSET_TYPES.forEach((asset) => {
            unsubs.push(onSnapshot(doc(db, 'artifacts', APP_ID, 'public', 'data', `sip_holding_${asset.id}_mktvalue`, 'latest_summary'), (snap) => {
              if (snap.exists()) setMktSummaries(prev => ({ ...prev, [asset.id]: snap.data() as SummaryDoc }));
            }));
            unsubs.push(onSnapshot(doc(db, 'artifacts', APP_ID, 'public', 'data', `sip_holding_${asset.id}_pl`, 'latest_summary'), (snap) => {
              if (snap.exists()) setPlSummaries(prev => ({ ...prev, [asset.id]: snap.data() as SummaryDoc }));
            }));
          });

          EXPOSURE_SOURCES.forEach((source) => {
            unsubs.push(onSnapshot(doc(db, 'artifacts', APP_ID, 'public', 'data', source.collection, 'latest_summary'), (snap) => {
              setExposures(prev => {
                const withoutSource = prev.filter(item => (item as any).source !== source.key);
                if (!snap.exists()) return withoutSource;
                const rows = Array.isArray(snap.data()?.data) ? snap.data().data : [];
                const nextRows = rows.map((item: any) => {
                  const rawSymbol = item.ticker || item.code || item.symbol;
                  if (!rawSymbol) return null;
                  const symbol = normalizeSymbol(String(rawSymbol));
                  return {
                    symbol,
                    market: inferMarket(symbol, String(item.market || item.currency || '')),
                    shares: toNumber(item.shares),
                    cost: toNumber(item.cost),
                    source: source.key,
                  };
                }).filter(Boolean) as any[];
                return [...withoutSource, ...nextRows];
              });
            }));
          });

          setLoading(false);
        });

        unsubs.push(unsubscribeAuth);
      } catch (error) {
        console.error('Dashboard init failed:', error);
        setLoading(false);
      }
    };

    init();
    return () => {
      cancelled = true;
      unsubs.forEach(unsub => unsub());
    };
  }, []);

  const allCurrencies = useMemo(() => {
    const set = new Set<string>(['HKD']);
    [...Object.values(mktSummaries), ...Object.values(plSummaries)].forEach(summary => {
      Object.keys(summary?.rawMatrix || {}).forEach(market => set.add(market));
    });
    exposures.forEach(item => set.add(item.market));
    return Array.from(set);
  }, [mktSummaries, plSummaries, exposures]);

  useEffect(() => {
    const fetchFxRates = async () => {
      const pairs = await Promise.all(allCurrencies.map(async (currency) => {
        if (currency === 'HKD') return [currency, 1] as const;
        try {
          const res = await fetch(`/api/quote?currency=${encodeURIComponent(currency)}`);
          if (!res.ok) throw new Error('FX fetch failed');
          const data = await res.json();
          return [currency, toNumber(data.rate) || 1] as const;
        } catch {
          const fallback: Record<string, number> = { USD: 7.78, CNY: 1.08, JPY: 0.052, EUR: 8.5, GBP: 9.8 };
          return [currency, fallback[currency] || 1] as const;
        }
      }));
      setFxRates(Object.fromEntries(pairs));
    };

    fetchFxRates();
  }, [allCurrencies.join(',')]);

  const exposureRows = useMemo(() => {
    const grouped = new Map<string, { symbol: string; market: string; shares: number; cost: number }>();
    exposures.forEach((item) => {
      const key = `${item.symbol}|${item.market}`;
      const existing = grouped.get(key) || { symbol: item.symbol, market: item.market, shares: 0, cost: 0 };
      existing.shares += item.shares;
      existing.cost += item.cost;
      grouped.set(key, existing);
    });
    return Array.from(grouped.values());
  }, [exposures]);

  useEffect(() => {
    const fetchQuotes = async () => {
      const symbols = exposureRows.map(row => row.symbol).filter(Boolean);
      const pairs = await Promise.all(symbols.map(async (symbol) => {
        try {
          const res = await fetch(`/api/quote?symbol=${encodeURIComponent(symbol)}`);
          if (!res.ok) throw new Error('quote failed');
          const data = await res.json();
          return [symbol, toNumber(data.price)] as const;
        } catch {
          return [symbol, 0] as const;
        }
      }));
      setQuotes(Object.fromEntries(pairs.filter(([, price]) => price > 0)));
    };

    if (exposureRows.length) fetchQuotes();
  }, [exposureRows.map(row => row.symbol).join('|')]);

  useEffect(() => {
    const fetchActivities = async () => {
      try {
        const results = await Promise.all(ACTIVITY_SOURCES.map(async (source) => {
          const snap = await getDocs(collection(db, 'artifacts', APP_ID, 'public', 'data', source.collection));
          return snap.docs.map((docSnap) => {
            const data = docSnap.data();
            const date = asDate(pickFirst(data, ['createdAt', 'tradeDate', 'date', 'inputDate', 'updatedAt'])) || new Date(0);
            const symbol = pickFirst(data, ['ticker', 'code', 'symbol', 'underlying', 'stockCode']);
            const currency = pickFirst(data, ['currency', 'market', 'settlementCurrency']);
            const amount = pickFirst(data, ['amount', 'notional', 'totalAmount', 'cashAmount']);
            const detail = source.type === 'fund'
              ? `${source.label}${currency ? ` - ${currency}` : ''}${amount ? ` ${formatMoney(toNumber(amount))}` : ''}`
              : `${source.label}${symbol ? ` - ${symbol}` : ''}`;

            return {
              action: source.action,
              detail,
              time: formatRelativeTime(date.getTime()),
              timestamp: date.getTime(),
              type: source.type,
            };
          });
        }));

        setActivityLogs(results.flat().sort((a, b) => b.timestamp - a.timestamp).slice(0, 5));
      } catch (error) {
        console.error('Activity fetch failed:', error);
      }
    };

    fetchActivities();
  }, []);

  const dashboard = useMemo(() => {
    const totalAum = ASSET_TYPES.reduce((sum, asset) => sum + sumMatrixByFx(mktSummaries[asset.id], fxRates), 0);
    const totalPnl = ASSET_TYPES.reduce((sum, asset) => sum + sumMatrixByFx(plSummaries[asset.id], fxRates, 'total'), 0);

    const enrichedExposure = exposureRows.map((row) => {
      const fxRate = fxRates[row.market] || 1;
      const price = quotes[row.symbol] || 0;
      const marketValueHKD = row.shares * price * fxRate;
      const costHKD = row.cost * fxRate;
      const pnlHKD = marketValueHKD - costHKD;
      const exposureRatio = totalAum > 0 ? Math.abs(marketValueHKD) / totalAum : null;
      const pnlRatio = Math.abs(costHKD) > 0 ? pnlHKD / Math.abs(costHKD) : null;
      return { ...row, marketValueHKD, costHKD, pnlHKD, exposureRatio, pnlRatio };
    });

    const maxExposure = enrichedExposure.reduce<any>((best, row) => {
      if (row.exposureRatio === null) return best;
      return !best || row.exposureRatio > best.exposureRatio ? row : best;
    }, null);

    const maxLoss = enrichedExposure.reduce<any>((best, row) => {
      if (row.pnlRatio === null) return best;
      return !best || row.pnlRatio < best.pnlRatio ? row : best;
    }, null);

    const exposureAlert = maxExposure?.exposureRatio > 0.1 ? 1 : 0;
    const lossAlert = maxLoss?.pnlRatio < -0.1 ? 1 : 0;

    return {
      totalAum,
      totalPnl,
      exposureCount: exposureRows.length,
      warningCount: exposureAlert + lossAlert,
      maxExposure,
      maxLoss,
    };
  }, [mktSummaries, plSummaries, fxRates, exposureRows, quotes]);

  const defaultLogs: ActivityLog[] = [
    { action: '暂无新交易录入', detail: '等待 Firebase 交易流水', time: '--', timestamp: 0, type: 'trade' },
    { action: '暂无资金变动', detail: '等待 Cash 流水', time: '--', timestamp: 0, type: 'fund' },
  ];
  const logsToShow = activityLogs.length ? activityLogs : defaultLogs;

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8 relative">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">春天稳健混合1号基金</h1>
        <p className="mt-2 text-gray-600">
          欢迎回来。以下是今日的投资组合概况与系统状态。
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex flex-col">
          <div className="text-sm text-gray-500 font-medium mb-2 flex items-center gap-2">
            <Wallet size={16} className="text-blue-500" />
            总资产规模(AUM)
          </div>
          <div className="text-2xl font-bold text-gray-900">{loading ? <Loader2 size={22} className="animate-spin" /> : `${formatMoney(dashboard.totalAum)} HKD`}</div>
          <div className="text-xs text-gray-400 mt-2 flex items-center">
            基于各持仓模块 latest_summary
          </div>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex flex-col">
          <div className="text-sm text-gray-500 font-medium mb-2 flex items-center gap-2">
            <Activity size={16} className="text-purple-500" />
            总盈亏 (PnL)
          </div>
          <div className={`text-2xl font-bold ${dashboard.totalPnl >= 0 ? 'text-red-600' : 'text-green-600'}`}>
            {loading ? <Loader2 size={22} className="animate-spin text-gray-400" /> : `${formatSignedMoney(dashboard.totalPnl)} HKD`}
          </div>
          <div className="text-xs text-gray-400 mt-2">已实现与未实现合计</div>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex flex-col">
          <div className="text-sm text-gray-500 font-medium mb-2 flex items-center gap-2">
            <BarChart3 size={16} className="text-indigo-500" />
            暴露头寸数
          </div>
          <div className="text-2xl font-bold text-gray-900">{loading ? <Loader2 size={22} className="animate-spin" /> : dashboard.exposureCount}</div>
          <div className="text-xs text-gray-400 mt-2">DQ-AQ / FCN / Option / Spot 去重合并</div>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex flex-col">
          <div className="text-sm text-gray-500 font-medium mb-2 flex items-center gap-2">
            <AlertTriangle size={16} className="text-red-500" />
            风控警报
          </div>
          <div className="text-2xl font-bold text-red-600">{loading ? <Loader2 size={22} className="animate-spin" /> : dashboard.warningCount}</div>
          <div className="text-xs mt-2 space-y-1">
            <div className={dashboard.maxExposure?.exposureRatio > 0.1 ? 'text-red-500' : 'text-gray-400'}>
              最大暴露：{dashboard.maxExposure ? `${dashboard.maxExposure.symbol} ${formatPercent(dashboard.maxExposure.exposureRatio)} AUM` : '暂无数据'}
            </div>
            <div className={dashboard.maxLoss?.pnlRatio < -0.1 ? 'text-red-500' : 'text-gray-400'}>
              最大亏损：{dashboard.maxLoss ? `${dashboard.maxLoss.symbol} ${formatPercent(dashboard.maxLoss.pnlRatio)}` : '暂无数据'}
            </div>
          </div>
        </div>
      </div>

      <h2 className="text-xl font-bold text-gray-800 pt-4">快速进入模块</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <Link
          href="/book/SP_wjhh1/trade/fcn"
          className="group relative bg-gradient-to-br from-blue-50 to-white p-8 rounded-2xl border border-blue-100 shadow-sm hover:shadow-md transition-all duration-300 hover:-translate-y-1"
        >
          <div className="absolute top-6 right-6 bg-blue-100 p-3 rounded-full text-blue-600 group-hover:bg-blue-600 group-hover:text-white transition-colors">
            <TrendingUp size={24} />
          </div>
          <h3 className="text-xl font-bold text-gray-900 mb-2">交易管理</h3>
          <p className="text-gray-500 text-sm mb-6 h-10">
            录入新的 FCN、Option、Spot 等各类交易指令。
          </p>
          <span className="inline-flex items-center text-blue-600 font-semibold text-sm group-hover:translate-x-1 transition-transform">
            进入交易模块 <ArrowRight size={16} className="ml-1" />
          </span>
        </Link>

        <Link
          href="/book/SP_wjhh1/holdings/summary"
          className="group relative bg-gradient-to-br from-purple-50 to-white p-8 rounded-2xl border border-purple-100 shadow-sm hover:shadow-md transition-all duration-300 hover:-translate-y-1"
        >
          <div className="absolute top-6 right-6 bg-purple-100 p-3 rounded-full text-purple-600 group-hover:bg-purple-600 group-hover:text-white transition-colors">
            <Briefcase size={24} />
          </div>
          <h3 className="text-xl font-bold text-gray-900 mb-2">持仓分析</h3>
          <p className="text-gray-500 text-sm mb-6 h-10">
            查看资金池、FCN、股票等资产的实时持仓与汇总报表。
          </p>
          <span className="inline-flex items-center text-purple-600 font-semibold text-sm group-hover:translate-x-1 transition-transform">
            查看持仓详情 <ArrowRight size={16} className="ml-1" />
          </span>
        </Link>

        <Link
          href="/book/SP_wjhh1/risk/exposure-underlying"
          className="group relative bg-gradient-to-br from-red-50 to-white p-8 rounded-2xl border border-red-100 shadow-sm hover:shadow-md transition-all duration-300 hover:-translate-y-1"
        >
          <div className="absolute top-6 right-6 bg-red-100 p-3 rounded-full text-red-600 group-hover:bg-red-600 group-hover:text-white transition-colors">
            <ShieldAlert size={24} />
          </div>
          <h3 className="text-xl font-bold text-gray-900 mb-2">风控中心</h3>
          <p className="text-gray-500 text-sm mb-6 h-10">
            监控标的暴露与行业集中度，管理潜在风险。
          </p>
          <span className="inline-flex items-center text-red-600 font-semibold text-sm group-hover:translate-x-1 transition-transform">
            前往风控面板 <ArrowRight size={16} className="ml-1" />
          </span>
        </Link>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
          <h3 className="font-semibold text-gray-800">最近活动日志</h3>
        </div>
        <div className="divide-y divide-gray-100">
          {logsToShow.map((log, index) => (
            <div key={`${log.action}-${index}`} className="px-6 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors">
              <div className="flex items-center gap-3">
                <span className={`w-2 h-2 rounded-full ${log.type === 'fund' ? 'bg-emerald-500' : 'bg-blue-500'}`}></span>
                <span className="text-sm font-medium text-gray-700">{log.action}</span>
                <span className="text-sm text-gray-500">- {log.detail}</span>
              </div>
              <span className="text-xs text-gray-400">{log.time}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
