'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  Building2, ListOrdered, PieChart, BarChart as BarChartIcon,
  Loader2, AlertCircle, RefreshCw, Search, Database, Save,
  Trash2, Info, Clock, X, FileJson, Edit2, ClipboardList, Settings2
} from 'lucide-react';
import { collection, getDocs, getDoc, query, onSnapshot, addDoc, deleteDoc, setDoc, doc, updateDoc, writeBatch } from 'firebase/firestore';
import { onAuthStateChanged, signInAnonymously, signInWithCustomToken } from 'firebase/auth';
import { db, auth, APP_ID } from '@/app/lib/stockService';
import { publishLatestSummarySafely } from '@/app/book/SP_wjhh1/lib/refreshSafePublish';
import { calculateAverageCostHoldings } from '@/app/book/SP_wjhh1/lib/averageCostEngine';
import { useStockPool } from '@/app/hooks/useStockPool';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell
} from 'recharts';

// --- 统一的流水数据类型 ---
interface UnifiedTrade {
  id: string;
  source: 'SPOT' | 'FCN' | 'DQ/AQ' | 'OPTION_CALL' | 'OPTION_PUT';
  date: string;
  account: string;
  market: string;
  code: string;
  name: string;
  direction: 'BUY' | 'SELL';
  quantity: number; // 买正卖负
  price: number; // 含费均价
  amount: number; // 含费总额（严格数学符号：买入净流入为正，卖出净回笼为负）
  fee: number;
  updatedAt: number;
  executor: string;
}

// --- 期初持仓类型 ---
interface InitialHolding {
  id: string;
  code: string;
  market: string;
  account: string;
  quantity: number;
  costPrice: number;
  updatedAt?: any;
  createdAt?: any;
}

interface StockMktStats {
  accounts: string[];
  markets: string[];
  rawMatrix: Record<string, Record<string, number>>;
  updatedAt?: any;
  createdAt?: any;
}

interface StockPlStats {
  markets: string[];
  rawMatrix: Record<string, { realized: number; unrealized: number; total: number }>;
  updatedAt?: any;
  createdAt?: any;
}

// --- 聚合后的持仓类型 ---
interface StockHolding {
  market: string;
  code: string;
  name: string;
  sector_level_1: string;
  sector_level_2: string;
  quantity: number;
  avgCost: number; 
  totalCostHKD: number; 
  currentPrice: number; 
  hasValidQuote: boolean;
  dailyChangePct: number; 
  mktValHKD: number; 
  unrealizedPnlHKD: number; 
  realizedPnlHKD: number; 
  unrealizedPnlLocal: number; 
  realizedPnlLocal: number; 
  pnlRatio: number; 
  accounts: Record<string, number>; 
}

// --- 辅助函数：统一币种映射 (数据清洗) ---
const mapMarket = (m: string | undefined, defaultVal: string) => {
    if (!m) return defaultVal;
    const up = m.toUpperCase();
    if (up === 'US') return 'USD';
    if (up === 'HK') return 'HKD';
    if (up === 'CH' || up === 'CN') return 'CNY';
    if (up === 'JP') return 'JPY';
    if (['USD', 'HKD', 'CNY', 'JPY'].includes(up)) return up;
    return defaultVal;
};

const normalizeSearchText = (value: string) => value.toLowerCase().replace(/[\s._\-\/]+/g, '');

const fuzzyIncludes = (value: string, keyword: string) => {
    const normalizedKeyword = normalizeSearchText(keyword);
    if (!normalizedKeyword) return true;
    return normalizeSearchText(value).includes(normalizedKeyword);
};

// --- 时间辅助函数 ---
const getTime = (val: any) => {
    if (!val) return 0;
    if (val.toMillis && typeof val.toMillis === 'function') return val.toMillis();
    if (val.seconds) return val.seconds * 1000;
    return new Date(val).getTime() || 0;
};

const formatTime = (val: number) => {
    if (!val) return 'N/A';
    return new Date(val).toLocaleString('zh-CN', { hour12: false });
};

const STOCK_MARKET_CACHE_KEY = `sip:${APP_ID}:holdings:stocks:market-cache:v1`;

type StockMarketCache = {
    savedAt?: string;
    fxRates?: Record<string, number>;
    quotes?: Record<string, { price: number; changePercent: number }>;
};

type StockDisplayCachePayload = {
    calculatedAt?: any;
    data?: {
        currentMktStats?: StockMktStats;
        currentPlStats?: StockPlStats;
        quoteStatus?: {
            fxRates?: Record<string, number>;
            quotes?: Record<string, { price: number; changePercent: number }>;
        };
    };
};

// --- 可排序筛选表头组件 ---
const Th = ({ label, sortKey, filterKey, currentSort, onSort, currentFilter, onFilter, align='left', width }: any) => {
    const justifyClass = align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : 'justify-start';
    const textClass = align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left';
    
    return (
        <th className={`px-3 py-2 whitespace-nowrap align-top group sticky top-0 shadow-[0_1px_0_0_#e5e7eb] ${textClass} ${sortKey ? 'bg-gray-50' : 'bg-inherit'}`} style={{ width }}>
            <div 
                className={`flex items-center ${justifyClass} gap-1 select-none ${sortKey ? 'cursor-pointer hover:text-gray-800' : ''}`}
                onClick={() => sortKey && onSort(sortKey)}
            >
                {label}
                {sortKey && currentSort.key === sortKey && (
                    <span className="text-blue-500 text-[10px] ml-1">
                        {currentSort.dir === 'asc' ? '▲' : '▼'}
                    </span>
                )}
                {sortKey && currentSort.key !== sortKey && (
                    <span className="text-gray-300 text-[10px] opacity-0 group-hover:opacity-100 transition-opacity ml-1">▲</span>
                )}
            </div>
            {filterKey && (
                <div className="mt-1 relative">
                    <input 
                        type="text" 
                        placeholder="筛选" 
                        value={currentFilter[filterKey] || ''}
                        onChange={(e) => onFilter(filterKey, e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        className={`w-full min-w-[60px] border border-gray-300 rounded px-1.5 py-0.5 text-[10px] font-normal focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-gray-700 bg-white ${align === 'right' ? 'text-right pr-4' : 'pl-4'}`}
                    />
                    <Search size={10} className={`absolute top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none ${align === 'right' ? 'right-1' : 'left-1'}`} />
                </div>
            )}
        </th>
    );
};

export default function SpotHoldingsPage() {
  const [user, setUser] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingInitial, setLoadingInitial] = useState(true);
  
  // 数据源
  const { stocks: stockPool } = useStockPool();
  const [allTrades, setAllTrades] = useState<UnifiedTrade[]>([]);
  
  // 初始持仓（底座）与基准日期
  const [initialHoldings, setInitialHoldings] = useState<InitialHolding[]>([]);
  const [baseDate, setBaseDate] = useState<string>('');
  
  // 期初底座编辑与筛选 State
  const [newInit, setNewInit] = useState({ code: '', market: 'HKD', account: '', quantity: 0, costPrice: 0 });
  const [submittingInit, setSubmittingInit] = useState(false);
  const [editingInitId, setEditingInitId] = useState<string | null>(null);
  const [initCodeFilter, setInitCodeFilter] = useState('');
  
  // --- 批量导入 (Clipboard Paste) State ---
  const [showPasteModal, setShowPasteModal] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [parsedPasteData, setParsedPasteData] = useState<any[]>([]);
  
  // --- 汇率锁定 State ---
  const [baseFxRates, setBaseFxRates] = useState<Record<string, number>>({});
  const [showBaseFxModal, setShowBaseFxModal] = useState(false);
  const [draftBaseFx, setDraftBaseFx] = useState<Record<string, string>>({});
  
  // 全局状态
  const [isHKDView, setIsHKDView] = useState(false);
  const [globalFxRates, setGlobalFxRates] = useState<Record<string, number>>({});
  const [realTimeQuotes, setRealTimeQuotes] = useState<Record<string, { price: number, changePercent: number }>>({});
  const [isFetchingRealTime, setIsFetchingRealTime] = useState(false);
  const [quoteRefreshAttempted, setQuoteRefreshAttempted] = useState(false);
  const [cachedMarketDataTime, setCachedMarketDataTime] = useState<string>('');
  const [cachedMarketDataSource, setCachedMarketDataSource] = useState<string>('');
  const [cachedMarketDataMillis, setCachedMarketDataMillis] = useState(0);
  const [displayCacheMillis, setDisplayCacheMillis] = useState(0);
  const [displayCacheMktStats, setDisplayCacheMktStats] = useState<StockMktStats | null>(null);
  const [displayCachePlStats, setDisplayCachePlStats] = useState<StockPlStats | null>(null);
  const [publishedMktStats, setPublishedMktStats] = useState<StockMktStats | null>(null);
  const [publishedPlStats, setPublishedPlStats] = useState<StockPlStats | null>(null);
  const quoteRequestIdRef = useRef(0);
  const marketDataMillisRef = useRef(0);
  const [showFxModal, setShowFxModal] = useState(false);
  
  const [isSavingCash, setIsSavingCash] = useState(false);
  const [lastCashSavedTime, setLastCashSavedTime] = useState<string>('未获取');
  
  const [isSavingMktVal, setIsSavingMktVal] = useState(false);
  const [lastMktValSavedTime, setLastMktValSavedTime] = useState<string>('未获取');
  
  const [isSavingPl, setIsSavingPl] = useState(false);
  const [lastPlSavedTime, setLastPlSavedTime] = useState<string>('未获取');

  const [isSavingInitial, setIsSavingInitial] = useState(false);
  const [lastInitialSavedTime, setLastInitialSavedTime] = useState<string>('未获取');

  const [isSavingExposure, setIsSavingExposure] = useState(false);
  const [lastExposureSavedTime, setLastExposureSavedTime] = useState<string>('未获取');
  
  // 图表切换
  const [chartType, setChartType] = useState<'BEST' | 'WORST'>('BEST');
  
  // --- 数据库管理模块状态 ---
  const [activeDbTab, setActiveDbTab] = useState('sip_spot_trade');
  const [dbRecords, setDbRecords] = useState<any[]>([]);
  const [loadingDb, setLoadingDb] = useState(false);
  const [editRecordModal, setEditRecordModal] = useState<{show: boolean, record: any, rawJson: string} | null>(null);
  const [tradeSort, setTradeSort] = useState<{key: string, dir: 'asc'|'desc'|null}>({key: 'date', dir: 'desc'});
  const [tradeFilters, setTradeFilters] = useState<Record<string, string>>({});
  const [holdingSort, setHoldingSort] = useState<{key: string, dir: 'asc'|'desc'|null}>({key: 'mktValHKD', dir: 'desc'});
  const [holdingFilters, setHoldingFilters] = useState<Record<string, string>>({});
  const [selectedHoldingAccount, setSelectedHoldingAccount] = useState('');
  const [showHoldingExcelModal, setShowHoldingExcelModal] = useState(false);
  const [holdingTrialEnabled, setHoldingTrialEnabled] = useState(false);
  const [holdingTrialRatios, setHoldingTrialRatios] = useState<Record<string, string>>({});
  const [pnlSort, setPnlSort] = useState<{key: string, dir: 'asc'|'desc'|null}>({key: 'totalPnl', dir: 'desc'});
  const [pnlFilters, setPnlFilters] = useState<Record<string, string>>({});
  const [expandedTable, setExpandedTable] = useState<'holdings' | 'pnl' | 'trades' | null>(null);

  const toggleSort = (setSort: any) => (key: string) => {
      setSort((prev: any) => {
          if (prev.key === key) {
              if (prev.dir === 'asc') return { key, dir: 'desc' };
              if (prev.dir === 'desc') return { key: '', dir: null };
          }
          return { key, dir: 'asc' };
      });
  };

  const handleFilter = (setFilter: any) => (key: string, val: string) => {
      setFilter((prev: any) => ({ ...prev, [key]: val }));
  };

  const toggleTradeSort = toggleSort(setTradeSort);
  const updateTradeFilter = handleFilter(setTradeFilters);
  const toggleHoldingSort = toggleSort(setHoldingSort);
  const updateHoldingFilter = handleFilter(setHoldingFilters);
  const togglePnlSort = toggleSort(setPnlSort);
  const updatePnlFilter = handleFilter(setPnlFilters);

  const getTableContainerClass = (key: 'holdings' | 'pnl' | 'trades', normalClass: string) => {
      if (expandedTable !== key) return normalClass;
      return 'fixed inset-4 z-50 overflow-auto rounded-2xl border border-gray-200 bg-white p-4 shadow-2xl';
  };

  const renderExpandedTableHeader = (key: 'holdings' | 'pnl' | 'trades', title: string, subtitle: string) => {
      if (expandedTable !== key) return null;
      return (
          <div className="sticky top-0 z-[70] mb-4 flex items-center justify-between rounded-xl border border-gray-200 bg-white/95 px-4 py-3 shadow-sm backdrop-blur">
              <div>
                  <div className="text-base font-bold text-gray-900">{title}</div>
                  <div className="text-xs text-gray-500">{subtitle}</div>
              </div>
              <div className="flex items-center gap-2">
                  {key === 'holdings' && (
                      <>
                          <button
                              onClick={() => setHoldingTrialEnabled(prev => !prev)}
                              className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-bold shadow-sm transition-colors ${
                                  holdingTrialEnabled
                                      ? 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100'
                                      : 'border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100'
                              }`}
                          >
                              <Settings2 size={14} />
                              {holdingTrialEnabled ? '关闭增减仓试算' : '增减仓试算'}
                          </button>
                          <button
                              onClick={() => setShowHoldingExcelModal(true)}
                              className="flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700 shadow-sm transition-colors hover:bg-emerald-100"
                          >
                              <ClipboardList size={14} />
                              {holdingTrialEnabled ? '复制试算到 Excel' : '复制到 Excel'}
                          </button>
                      </>
                  )}
                  <button
                      onClick={() => setExpandedTable(null)}
                      className="flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-bold text-gray-600 shadow-sm transition-colors hover:bg-gray-50"
                  >
                      <X size={14} />
                      关闭弹窗
                  </button>
              </div>
          </div>
      );
  };

  // --- 【新增】安全锁：判定是否有生效的模糊筛选 ---
  const hasActiveFilters = useMemo(() => {
      const holdingFiltered = Object.values(holdingFilters).some(val => val && String(val).trim() !== '');
      const tradeFiltered = Object.values(tradeFilters).some(val => val && String(val).trim() !== '');
      return Boolean(selectedHoldingAccount) || holdingFiltered || tradeFiltered;
  }, [holdingFilters, selectedHoldingAccount, tradeFilters]);

  useEffect(() => {
      if (typeof window === 'undefined') return;
      try {
          const raw = window.localStorage.getItem(STOCK_MARKET_CACHE_KEY);
          if (!raw) return;
          const cache = JSON.parse(raw) as StockMarketCache;
          if (cache.fxRates && Object.keys(cache.fxRates).length > 0) {
              setGlobalFxRates(cache.fxRates);
          }
          if (cache.quotes && Object.keys(cache.quotes).length > 0) {
              setRealTimeQuotes(cache.quotes);
              setQuoteRefreshAttempted(true);
          }
          if (cache.savedAt) {
              const savedMillis = new Date(cache.savedAt).getTime() || 0;
              marketDataMillisRef.current = Math.max(marketDataMillisRef.current, savedMillis);
              setCachedMarketDataMillis(savedMillis);
              setCachedMarketDataTime(new Date(cache.savedAt).toLocaleString('zh-CN', { hour12: false }));
              setCachedMarketDataSource('本地手动刷新缓存');
          }
      } catch (error) {
          console.warn('Failed to load cached stock market data.', error);
      }
  }, []);

  useEffect(() => {
      if (!user) return;
      let cancelled = false;
      const loadBackendDisplayCache = async () => {
          try {
              const cacheRef = doc(db, 'artifacts', APP_ID, 'public', 'data', 'sip_display_cache_current', 'stocks');
              const snapshot = await getDoc(cacheRef);
              if (!snapshot.exists() || cancelled) return;

              const cache = snapshot.data() as StockDisplayCachePayload;
              const calculatedAtValue = cache.calculatedAt?.toDate?.()
                  || (cache.calculatedAt?.seconds ? new Date(cache.calculatedAt.seconds * 1000) : new Date());
              const calculatedAtMillis = calculatedAtValue.getTime();
              setDisplayCacheMillis(calculatedAtMillis);
              setDisplayCacheMktStats(cache.data?.currentMktStats || null);
              setDisplayCachePlStats(cache.data?.currentPlStats || null);

              const fxRates = cache.data?.quoteStatus?.fxRates || {};
              const quotes = cache.data?.quoteStatus?.quotes || {};
              if (
                  Object.keys(fxRates).length === 0
                  && Object.keys(quotes).length === 0
                  && !cache.data?.currentMktStats
                  && !cache.data?.currentPlStats
              ) return;

              const shouldUseBackendMarketCache = calculatedAtMillis >= marketDataMillisRef.current;
              if (shouldUseBackendMarketCache) {
                  marketDataMillisRef.current = calculatedAtMillis;
                  setCachedMarketDataMillis(calculatedAtMillis);
                  const savedAt = calculatedAtValue.toISOString();
                  setCachedMarketDataTime(calculatedAtValue.toLocaleString('zh-CN', { hour12: false }));
                  setCachedMarketDataSource('后端自动刷新缓存');
                  if (typeof window !== 'undefined' && (Object.keys(fxRates).length > 0 || Object.keys(quotes).length > 0)) {
                      window.localStorage.setItem(STOCK_MARKET_CACHE_KEY, JSON.stringify({
                          savedAt,
                          fxRates,
                          quotes,
                      } satisfies StockMarketCache));
                  }
              }

              if (shouldUseBackendMarketCache && Object.keys(fxRates).length > 0) {
                  setGlobalFxRates(fxRates);
              }
              if (shouldUseBackendMarketCache && Object.keys(quotes).length > 0) {
                  setRealTimeQuotes(quotes);
                  setQuoteRefreshAttempted(true);
              }
          } catch (error) {
              console.warn('Failed to load backend stock display cache.', error);
          }
      };

      loadBackendDisplayCache();
      return () => {
          cancelled = true;
      };
  }, [user]);

  // --- 鉴权与数据抓取 (5个库：4个流水 + 1个期初底座) ---
  useEffect(() => {
    let unsubStart: (() => void) | undefined;
    let unsubCashTime: (() => void) | undefined;
    let unsubMktValTime: (() => void) | undefined;
    let unsubPlTime: (() => void) | undefined;
    let unsubInitTime: (() => void) | undefined;
    let unsubExposureTime: (() => void) | undefined;

    const initData = async () => {
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

        onAuthStateChanged(auth, async (currentUser) => {
          setUser(currentUser);
          
          if (currentUser) {
            // 1. 订阅：期初持仓底座库
            const qStart = query(collection(db, 'artifacts', APP_ID, 'public', 'data', 'sip_holding_spot_start'));
            unsubStart = onSnapshot(qStart, (snapshot) => {
                const starts: InitialHolding[] = [];
                let bDate = '';
                let bFx: Record<string, number> = {};
                snapshot.forEach(docSnap => {
                    if (docSnap.id === '_global_config') {
                        bDate = docSnap.data().baseDate || '';
                        bFx = docSnap.data().baseFxRates || {};
                    } else if (docSnap.id === 'latest_summary') {
                        // 忽略聚合数据快照文档
                    } else {
                        const data = docSnap.data();
                        starts.push({ 
                            id: docSnap.id, 
                            ...data,
                            market: mapMarket(data.market, 'HKD') // 标准化币种
                        } as InitialHolding);
                    }
                });
                setBaseDate(bDate);
                setBaseFxRates(bFx);
                setInitialHoldings(starts);
            });

            // 获取各类快照的最后保存时间
            unsubCashTime = onSnapshot(doc(db, 'artifacts', APP_ID, 'public', 'data', 'sip_holding_cash_stock', 'latest_summary'), (docSnap) => {
                if (docSnap.exists() && docSnap.data().updatedAt) setLastCashSavedTime(new Date(docSnap.data().updatedAt).toLocaleString('zh-CN', { hour12: false }));
            });

            unsubMktValTime = onSnapshot(doc(db, 'artifacts', APP_ID, 'public', 'data', 'sip_holding_stock_mktvalue', 'latest_summary'), (docSnap) => {
                if (docSnap.exists()) {
                    const data = docSnap.data() as StockMktStats;
                    setPublishedMktStats(data);
                    if (data.updatedAt) setLastMktValSavedTime(new Date(data.updatedAt).toLocaleString('zh-CN', { hour12: false }));
                } else {
                    setPublishedMktStats(null);
                }
            });

            unsubPlTime = onSnapshot(doc(db, 'artifacts', APP_ID, 'public', 'data', 'sip_holding_stock_pl', 'latest_summary'), (docSnap) => {
                if (docSnap.exists()) {
                    const data = docSnap.data() as StockPlStats;
                    setPublishedPlStats(data);
                    if (data.updatedAt) setLastPlSavedTime(new Date(data.updatedAt).toLocaleString('zh-CN', { hour12: false }));
                } else {
                    setPublishedPlStats(null);
                }
            });

            unsubInitTime = onSnapshot(doc(db, 'artifacts', APP_ID, 'public', 'data', 'sip_holding_spot_start', 'latest_summary'), (docSnap) => {
                if (docSnap.exists() && docSnap.data().updatedAt) setLastInitialSavedTime(new Date(docSnap.data().updatedAt).toLocaleString('zh-CN', { hour12: false }));
            });

            unsubExposureTime = onSnapshot(doc(db, 'artifacts', APP_ID, 'public', 'data', 'sip_exposure_spot', 'latest_summary'), (docSnap) => {
                if (docSnap.exists() && docSnap.data().updatedAt) setLastExposureSavedTime(new Date(docSnap.data().updatedAt).toLocaleString('zh-CN', { hour12: false }));
            });

            // 2. 抓取：四个增量流水库的数据
            try {
               const spotSnap = await getDocs(query(collection(db, 'artifacts', APP_ID, 'public', 'data', 'sip_spot_trade')));
               const fcnSnap = await getDocs(query(collection(db, 'artifacts', APP_ID, 'public', 'data', 'sip_holding_fcn_output_get-stock')));
               const dqaqSnap = await getDocs(query(collection(db, 'artifacts', APP_ID, 'public', 'data', 'sip_holding_dqaq_output_get-stock')));
               const optionSnap = await getDocs(query(collection(db, 'artifacts', APP_ID, 'public', 'data', 'sip_holding_option_output_get-stock')));
               
               let merged: UnifiedTrade[] = [];

               // 【终极修复 1】SPOT 库清洗：完全信任底层传来的数量与金额正负号，取消过度重写
               spotSnap.forEach(doc => {
                 const d = doc.data();
                 const direction = d.direction?.toUpperCase() || 'BUY';
                 const rawAmt = Number(d.amount_incl_fee || d.amount_excl_fee || 0); 
                 merged.push({
                   id: doc.id, source: 'SPOT', date: d.date, account: d.account || '', 
                   market: mapMarket(d.market, 'HKD'),
                   code: d.code, name: d.name, direction,
                   quantity: Number(d.quantity || 0), // 信任底层
                   price: Number(d.avg_price_incl_fee || d.price_excl_fee || 0),
                   amount: rawAmt,
                   fee: Number(d.fee || 0),
                   updatedAt: getTime(d.createdAt), executor: d.executor || ''
                 });
               });

               // FCN 库清洗
               fcnSnap.forEach(doc => {
                 const d = doc.data();
                 const direction = d.direction?.toUpperCase() || 'BUY';
                 const rawAmt = Number(d.amountWithFee || d.amountNoFee || 0); 
                 merged.push({
                   id: doc.id, source: 'FCN', date: d.date, account: d.account || '', 
                   market: mapMarket(d.market, 'HKD'),
                   code: d.stockCode, name: d.stockName, direction,
                   quantity: Number(d.quantity || 0), // 信任底层
                   price: Number(d.priceWithFee || d.priceNoFee || 0),
                   amount: direction === 'BUY' ? rawAmt : -rawAmt, 
                   fee: Number(d.fee || 0),
                   updatedAt: getTime(d.createdAt), executor: d.executor || ''
                 });
               });

               // DQ/AQ 库清洗：信任底层的原生正负号
               dqaqSnap.forEach(doc => {
                 const d = doc.data();
                 const direction = d.direction?.toUpperCase() || 'BUY';
                 const amountNoFee = Number(d.amountNoFee || 0);
                 const fee = Number(d.fee || 0);
                 merged.push({
                   id: doc.id, source: 'DQ/AQ', date: d.date, account: d.account || '', 
                   market: mapMarket(d.market, 'USD'),
                   code: d.stockCode, name: d.stockName, direction,
                   quantity: Number(d.quantity || 0), // 信任底层
                   price: Number(d.priceNoFee || 0), 
                   amount: amountNoFee + fee, 
                   fee,
                   updatedAt: getTime(d.createdAt), executor: d.executor || ''
                 });
               });

               // OPTION 库清洗：信任底层的原生正负号
               optionSnap.forEach(doc => {
                 const d = doc.data();
                 const direction = d.direction?.toUpperCase() || 'SELL';
                 const sourceType = (d.type || '').toLowerCase().includes('put') ? 'OPTION_PUT' : 'OPTION_CALL';
                 const amountNoFee = Number(d.amountNoFee || 0); 
                 const fee = Number(d.fee || 0);
                 merged.push({
                   id: doc.id, source: sourceType as any, date: d.date, account: d.account || '', 
                   market: mapMarket(d.market, 'USD'),
                   code: d.stockCode, name: d.stockName, direction,
                   quantity: Number(d.quantity || 0), // 信任底层
                   price: Number(d.priceNoFee || 0), 
                   amount: amountNoFee + fee, 
                   fee,
                   updatedAt: getTime(d.createdAt), executor: d.executor || ''
                 });
               });

               merged.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
               setAllTrades(merged);

            } catch (err: any) {
               console.error("抓取流水失败", err);
               setError("读取底层数据库失败: " + err.message);
            } finally {
               setLoadingInitial(false);
            }
          }
        });
      } catch (err: any) {
        console.error("Init error:", err);
        setError(`初始化失败: ${err.message}`);
        setLoadingInitial(false);
      }
    };

    initData();

    return () => {
        if (unsubStart) unsubStart();
        if (unsubCashTime) unsubCashTime();
        if (unsubMktValTime) unsubMktValTime();
        if (unsubPlTime) unsubPlTime();
        if (unsubInitTime) unsubInitTime();
        if (unsubExposureTime) unsubExposureTime();
    };
  }, []);

  // --- 基于全局“基准日期”过滤有效的增量流水 ---
  const activeTrades = useMemo(() => {
      return allTrades.filter(t => !baseDate || t.date > baseDate);
  }, [allTrades, baseDate]);

  const holdingAccountOptions = useMemo(() => {
      const accountSet = new Set<string>();
      initialHoldings.forEach(h => {
          if (h.account) accountSet.add(h.account);
      });
      activeTrades.forEach(t => {
          if (t.account) accountSet.add(t.account);
      });
      return Array.from(accountSet).sort();
  }, [activeTrades, initialHoldings]);

  const accountScopedInitialHoldings = useMemo(() => {
      if (!selectedHoldingAccount) return initialHoldings;
      return initialHoldings.filter(h => h.account === selectedHoldingAccount);
  }, [initialHoldings, selectedHoldingAccount]);

  const accountScopedActiveTrades = useMemo(() => {
      if (!selectedHoldingAccount) return activeTrades;
      return activeTrades.filter(t => t.account === selectedHoldingAccount);
  }, [activeTrades, selectedHoldingAccount]);

  // --- 过滤后的初始持仓显示 ---
  const displayInitialHoldings = useMemo(() => {
      if (!initCodeFilter.trim()) return initialHoldings;
      const lowerFilter = initCodeFilter.trim().toLowerCase();
      return initialHoldings.filter(h => h.code.toLowerCase().includes(lowerFilter));
  }, [initialHoldings, initCodeFilter]);

  // --- API 调用：获取汇率与实时行情 ---
  const fetchMarketData = async () => {
    if (activeTrades.length === 0 && initialHoldings.length === 0) return;
    const requestId = ++quoteRequestIdRef.current;
    setIsFetchingRealTime(true);
    setQuoteRefreshAttempted(false);
    
    try {
      const markets = new Set<string>();
      const symbolMarkets = new Map<string, string>();
      
      const collect = (code: string, market: string) => {
          if (market && market !== 'HKD') {
              markets.add(market);
          }
          if (code && !symbolMarkets.has(code)) symbolMarkets.set(code, market);
      };

      activeTrades.forEach(t => collect(t.code, t.market));
      initialHoldings.forEach(h => collect(h.code, h.market));

      const newRates: Record<string, number> = { ...globalFxRates, 'HKD': 1.0 };

      await Promise.all(Array.from(markets).map(async (currency) => {
          try {
              const res = await fetch(`/api/quote?currency=${currency}`);
              if (res.ok) {
                  const data = await res.json();
                  if (data && data.rate) {
                      newRates[currency] = data.rate;
                  }
              }
          } catch(e) {}
      }));
      if (requestId !== quoteRequestIdRef.current) return;
      setGlobalFxRates(newRates);

      const newQuotes: Record<string, { price: number, changePercent: number }> = {};

      // 限制并发，避免大量标的一次性请求导致行情源限流。
      const symbolList = Array.from(symbolMarkets.keys());
      const batchSize = 8;
      for (let index = 0; index < symbolList.length; index += batchSize) {
          if (requestId !== quoteRequestIdRef.current) return;
          await Promise.all(symbolList.slice(index, index + batchSize).map(async (symbol) => {
              try {
                  const res = await fetch(`/api/quote?symbol=${encodeURIComponent(symbol)}&t=${Date.now()}`);
                  if (res.ok) {
                      const data = await res.json();
                      const price = Number(data.regularMarketPrice || data.price || data.close);
                      const rawChangePct = Number(data.changePercent ?? data.regularMarketChangePercent ?? 0);
                      if (Number.isFinite(price) && price > 0) {
                          newQuotes[symbol] = { price, changePercent: rawChangePct / 100 };
                      }
                  }
              } catch (e) {
                  console.warn(`行情获取失败: ${symbol}`, e);
              }
          }));
      }
      if (requestId !== quoteRequestIdRef.current) return;
      setRealTimeQuotes(newQuotes);
      const savedAt = new Date().toISOString();
      const savedMillis = new Date(savedAt).getTime();
      marketDataMillisRef.current = savedMillis;
      setCachedMarketDataMillis(savedMillis);
      setCachedMarketDataTime(new Date(savedAt).toLocaleString('zh-CN', { hour12: false }));
      setCachedMarketDataSource('本页手动刷新缓存');
      if (typeof window !== 'undefined') {
          window.localStorage.setItem(STOCK_MARKET_CACHE_KEY, JSON.stringify({
              savedAt,
              fxRates: newRates,
              quotes: newQuotes,
          } satisfies StockMarketCache));
      }
    } catch (e) {
        console.error("Market data fetch error", e);
    } finally {
        if (requestId === quoteRequestIdRef.current) {
            setQuoteRefreshAttempted(true);
            setIsFetchingRealTime(false);
        }
    }
  };

  // --- 核心计算 (期初底座 + 平均转移成本增量) ---
  const calculatedHoldings = useMemo(() => {
      return calculateAverageCostHoldings({
          initialHoldings: accountScopedInitialHoldings,
          trades: accountScopedActiveTrades,
          quotes: realTimeQuotes,
          fxRates: globalFxRates,
          stockPool,
      }).holdings;
  }, [accountScopedActiveTrades, accountScopedInitialHoldings, stockPool, globalFxRates, realTimeQuotes]);

  const missingQuoteCodes = useMemo(() => {
      return calculatedHoldings
          .filter(h => Math.abs(h.quantity) > 0.000001 && !h.hasValidQuote)
          .map(h => h.code)
          .sort();
  }, [calculatedHoldings]);

  const hasIncompleteQuotes = missingQuoteCodes.length > 0;
  const quoteValidationMessage = isFetchingRealTime
      ? '行情正在刷新，请等待完成后再入库。'
      : hasIncompleteQuotes
          ? `${quoteRefreshAttempted ? '行情刷新后仍' : '当前'}缺少 ${missingQuoteCodes.length} 只持仓的有效行情：${missingQuoteCodes.join('、')}`
          : '';

  const ensureCompleteQuotes = (target: string) => {
      if (isFetchingRealTime) {
          alert(`无法保存${target}：行情仍在刷新，请稍候。`);
          return false;
      }
      if (hasIncompleteQuotes) {
          alert(`无法保存${target}：存在缺失行情。\n${missingQuoteCodes.join('、')}\n\n请先点击“更新行情”，确认全部报价成功后再入库。`);
          return false;
      }
      return true;
  };

  // --- 模块 1: 持仓统计处理 ---
  const displayHoldings = useMemo(() => {
      let result = [...calculatedHoldings].filter(h => Math.abs(h.quantity) > 0.000001); 
      
      Object.keys(holdingFilters).forEach(key => {
          const val = holdingFilters[key]?.toLowerCase();
          if (val) {
              result = result.filter(item => {
                  // 特殊处理 "各账户持仓股数" 对象的模糊匹配
                  if (key === 'accounts') {
                      const accStr = Object.entries(item.accounts)
                          .filter(([_k, qty]) => Math.abs(qty) > 0.000001)
                          .map(([acc, qty]) => `${acc}:${qty}`)
                          .join(' | ')
                          .toLowerCase();
                      return accStr.includes(val);
                  }
                  return String((item as any)[key]).toLowerCase().includes(val);
              });
          }
      });

      if (holdingSort.dir) {
          result.sort((a, b) => {
              let aVal = (a as any)[holdingSort.key];
              let bVal = (b as any)[holdingSort.key];
              if (typeof aVal === 'string') {
                  return holdingSort.dir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
              }
              return holdingSort.dir === 'asc' ? (aVal > bVal ? 1 : -1) : (aVal < bVal ? 1 : -1);
          });
      }
      return result;
  }, [calculatedHoldings, holdingFilters, holdingSort]);

  const holdingSums = useMemo(() => {
      return displayHoldings.reduce((acc, h) => {
          acc.totalCostHKD += h.totalCostHKD;
          acc.mktValHKD += h.mktValHKD;
          acc.grossCostHKD += Math.abs(h.totalCostHKD);
          acc.grossMktValHKD += Math.abs(h.mktValHKD);
          acc.unrealizedPnlHKD += h.unrealizedPnlHKD;
          return acc;
      }, { totalCostHKD: 0, mktValHKD: 0, grossCostHKD: 0, grossMktValHKD: 0, unrealizedPnlHKD: 0 });
  }, [displayHoldings]);

  const totalUnrealizedPct = holdingSums.grossCostHKD > 0 ? holdingSums.unrealizedPnlHKD / holdingSums.grossCostHKD : 0;

  const parseHoldingTrialRatio = (raw: string) => {
      const cleaned = String(raw || '').trim();
      if (!cleaned) return 0;
      const hasPercent = cleaned.includes('%');
      const numeric = Number(cleaned.replace('%', '').replace(/,/g, ''));
      if (!Number.isFinite(numeric)) return 0;
      if (hasPercent) return numeric / 100;
      return Math.abs(numeric) > 1 ? numeric / 100 : numeric;
  };

  const getHoldingTrialKey = (h: StockHolding) => `${h.market}::${h.code}`;

  const holdingTrialSums = useMemo(() => {
      return displayHoldings.reduce((acc, h) => {
          const ratio = parseHoldingTrialRatio(holdingTrialRatios[getHoldingTrialKey(h)] || '');
          acc.adjustedMktValHKD += h.hasValidQuote ? h.mktValHKD * (1 + ratio) : 0;
          return acc;
      }, { adjustedMktValHKD: 0 });
  }, [displayHoldings, holdingTrialRatios]);

  // --- 生成风控暴露汇总数据 (映射 displayHoldings) ---
  const riskExposureSummary = useMemo(() => {
      return displayHoldings.map(h => ({
          code: h.code,
          market: h.market,
          costPrice: h.avgCost,
          shares: h.quantity,
          cost: h.avgCost * h.quantity
      }));
  }, [displayHoldings]);

  // --- 当前市值二维统计矩阵 ---
  const currentMktStats = useMemo(() => {
      const accountsSet = new Set<string>();
      const marketsSet = new Set<string>();
      
      displayHoldings.forEach(h => {
          if (h.market) marketsSet.add(h.market);
          Object.keys(h.accounts).forEach(acc => accountsSet.add(acc));
      });
      
      const accounts = Array.from(accountsSet).sort();
      const markets = Array.from(marketsSet).sort();
      
      const rawMatrix: Record<string, Record<string, number>> = {};
      markets.forEach(m => {
          rawMatrix[m] = {};
          accounts.forEach(a => rawMatrix[m][a] = 0);
      });
      
      displayHoldings.forEach(h => {
          if (h.market) {
              Object.entries(h.accounts).forEach(([acc, qty]) => {
                  rawMatrix[h.market][acc] += qty * h.currentPrice;
              });
          }
      });
      
      return { accounts, markets, rawMatrix };
  }, [displayHoldings]);

  // --- 当前收益统计表数据 ---
  const currentPlStats = useMemo(() => {
      const marketsSet = new Set<string>();
      calculatedHoldings.forEach(h => {
          if (h.market) marketsSet.add(h.market);
      });
      const markets = Array.from(marketsSet).sort();
      
      const rawMatrix: Record<string, { realized: number, unrealized: number, total: number }> = {};
      markets.forEach(m => {
          rawMatrix[m] = { realized: 0, unrealized: 0, total: 0 };
      });
      
      calculatedHoldings.forEach(h => {
          if (h.market) {
              rawMatrix[h.market].realized += (h.realizedPnlLocal || 0);
              rawMatrix[h.market].unrealized += (h.unrealizedPnlLocal || 0);
              rawMatrix[h.market].total += ((h.realizedPnlLocal || 0) + (h.unrealizedPnlLocal || 0));
          }
      });
      
      return { markets, rawMatrix };
  }, [calculatedHoldings]);

  const liveInputLatestMillis = useMemo(() => {
      const tradeMillis = allTrades.reduce((max, trade) => Math.max(max, trade.updatedAt || 0), 0);
      const initMillis = initialHoldings.reduce((max, holding) => Math.max(max, getTime(holding.updatedAt) || getTime(holding.createdAt)), 0);
      return Math.max(tradeMillis, initMillis, cachedMarketDataMillis);
  }, [allTrades, initialHoldings, cachedMarketDataMillis]);

  const effectiveCurrentMktCandidate = useMemo(() => {
      const candidates = [
          { source: 'live', time: liveInputLatestMillis, data: currentMktStats },
          { source: 'display_cache', time: displayCacheMillis || getTime(displayCacheMktStats?.updatedAt) || getTime(displayCacheMktStats?.createdAt), data: displayCacheMktStats },
          { source: 'published_summary', time: getTime(publishedMktStats?.updatedAt) || getTime(publishedMktStats?.createdAt), data: publishedMktStats },
      ].filter(candidate => candidate.data && candidate.time >= 0) as Array<{ source: string; time: number; data: StockMktStats }>;

      return candidates.reduce((best, candidate) => candidate.time >= best.time ? candidate : best, candidates[0] || { source: 'live', time: liveInputLatestMillis, data: currentMktStats });
  }, [currentMktStats, displayCacheMktStats, displayCacheMillis, publishedMktStats, liveInputLatestMillis]);

  const effectiveCurrentPlCandidate = useMemo(() => {
      const candidates = [
          { source: 'live', time: liveInputLatestMillis, data: currentPlStats },
          { source: 'display_cache', time: displayCacheMillis || getTime(displayCachePlStats?.updatedAt) || getTime(displayCachePlStats?.createdAt), data: displayCachePlStats },
          { source: 'published_summary', time: getTime(publishedPlStats?.updatedAt) || getTime(publishedPlStats?.createdAt), data: publishedPlStats },
      ].filter(candidate => candidate.data && candidate.time >= 0) as Array<{ source: string; time: number; data: StockPlStats }>;

      return candidates.reduce((best, candidate) => candidate.time >= best.time ? candidate : best, candidates[0] || { source: 'live', time: liveInputLatestMillis, data: currentPlStats });
  }, [currentPlStats, displayCachePlStats, displayCacheMillis, publishedPlStats, liveInputLatestMillis]);

  const effectiveCurrentMktStats = effectiveCurrentMktCandidate.data;
  const effectiveCurrentPlStats = effectiveCurrentPlCandidate.data;

  // --- 模块 2: 盈亏分析处理 ---
  const pnlData = useMemo(() => {
      return calculatedHoldings.map(h => {
          return {
              name: h.name,
              code: h.code,
              unrealized: h.unrealizedPnlHKD,
              realized: h.realizedPnlHKD,
              totalPnl: h.unrealizedPnlHKD + h.realizedPnlHKD
          };
      });
  }, [calculatedHoldings]);

  const displayPnlData = useMemo(() => {
      let result = [...pnlData];
      const targetFilter = pnlFilters.target || '';

      if (targetFilter.trim()) {
          result = result.filter(p => fuzzyIncludes(`${p.code} ${p.name}`, targetFilter));
      }

      if (pnlSort.dir && pnlSort.key) {
          result.sort((a, b) => {
              const aVal = Number((a as any)[pnlSort.key]) || 0;
              const bVal = Number((b as any)[pnlSort.key]) || 0;
              return pnlSort.dir === 'asc' ? aVal - bVal : bVal - aVal;
          });
      }

      return result;
  }, [pnlData, pnlFilters, pnlSort]);

  const chartData = useMemo(() => {
      const sorted = [...displayPnlData].sort((a, b) => b.totalPnl - a.totalPnl);
      if (chartType === 'BEST') {
          return sorted.filter(p => p.totalPnl > 0).slice(0, 10);
      } else {
          return sorted.filter(p => p.totalPnl < 0).slice(-10).reverse(); 
      }
  }, [displayPnlData, chartType]);

  const pnlSums = useMemo(() => {
      return pnlData.reduce((acc, p) => {
          acc.unrealized += p.unrealized;
          acc.realized += p.realized;
          acc.total += p.totalPnl;
          return acc;
      }, { unrealized: 0, realized: 0, total: 0 });
  }, [pnlData]);

  const displayPnlSums = useMemo(() => {
      return displayPnlData.reduce((acc, p) => {
          acc.unrealized += p.unrealized;
          acc.realized += p.realized;
          acc.total += p.totalPnl;
          return acc;
      }, { unrealized: 0, realized: 0, total: 0 });
  }, [displayPnlData]);

  // --- 模块 3: 交易流水处理 ---
  const displayTrades = useMemo(() => {
      let result = [...activeTrades];
      
      Object.keys(tradeFilters).forEach(key => {
          const val = tradeFilters[key]?.toLowerCase();
          if (val) {
              result = result.filter(item => String((item as any)[key]).toLowerCase().includes(val));
          }
      });

      if (tradeSort.dir) {
          result.sort((a, b) => {
              let aVal = (a as any)[tradeSort.key];
              let bVal = (b as any)[tradeSort.key];
              
              if (isHKDView && ['price', 'amount'].includes(tradeSort.key)) {
                  aVal = aVal * (globalFxRates[a.market] || 1);
                  bVal = bVal * (globalFxRates[b.market] || 1);
              }
              if (typeof aVal === 'string') {
                  return tradeSort.dir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
              }
              return tradeSort.dir === 'asc' ? (aVal > bVal ? 1 : -1) : (aVal < bVal ? 1 : -1);
          });
      }
      return result;
  }, [activeTrades, tradeFilters, tradeSort, isHKDView, globalFxRates]);

  const totalNetBuyHKD = useMemo(() => {
      return displayTrades.reduce((sum, t) => {
          const rate = globalFxRates[t.market] || 1;
          return sum + (t.amount * rate);
      }, 0);
  }, [displayTrades, globalFxRates]);

  const netBuyStats = useMemo(() => {
      const accountsSet = new Set<string>();
      const marketsSet = new Set<string>();
      
      displayTrades.forEach(t => {
          if (t.account) accountsSet.add(t.account);
          if (t.market) marketsSet.add(t.market);
      });
      
      const accounts = Array.from(accountsSet).sort();
      const markets = Array.from(marketsSet).sort();
      
      const rawMatrix: Record<string, Record<string, number>> = {};
      markets.forEach(m => {
          rawMatrix[m] = {};
          accounts.forEach(a => rawMatrix[m][a] = 0);
      });
      
      displayTrades.forEach(t => {
          if (t.market && t.account) {
              rawMatrix[t.market][t.account] += t.amount;
          }
      });
      
      return { accounts, markets, rawMatrix };
  }, [displayTrades]);

  // --- 模块 5: 初始持仓（期初投入）二维统计数据 ---
  const initialStats = useMemo(() => {
      const accountsSet = new Set<string>();
      const marketsSet = new Set<string>();
      
      initialHoldings.forEach(h => {
          if (h.account) accountsSet.add(h.account);
          if (h.market) marketsSet.add(h.market);
      });
      
      const accounts = Array.from(accountsSet).sort();
      const markets = Array.from(marketsSet).sort();
      
      const rawMatrix: Record<string, Record<string, number>> = {};
      markets.forEach(m => {
          rawMatrix[m] = {};
          accounts.forEach(a => rawMatrix[m][a] = 0);
      });
      
      initialHoldings.forEach(h => {
          if (h.market && h.account) {
              rawMatrix[h.market][h.account] += h.quantity * h.costPrice;
          }
      });
      
      return { accounts, markets, rawMatrix };
  }, [initialHoldings]);

  const totalInitialHKD = useMemo(() => {
      return initialHoldings.reduce((sum, h) => {
          const rate = baseFxRates[h.market] || globalFxRates[h.market] || 1;
          return sum + (h.quantity * h.costPrice * rate);
      }, 0);
  }, [initialHoldings, baseFxRates, globalFxRates]);

  // --- 批量导入 (剪贴板) 解析与入库逻辑 ---
  const handlePasteTextChange = (e: any) => {
      const text = e.target.value;
      setPasteText(text);
      
      const rows = text.split('\n').map((r: string) => r.trim()).filter(Boolean);
      const parsed = rows.map((row: string) => {
          const cols = row.split('\t');
          return {
              code: cols[0]?.trim().toUpperCase() || '',
              market: cols[1]?.trim().toUpperCase() || 'HKD',
              account: cols[2]?.trim() || '',
              quantity: parseFloat(cols[3]) || 0,
              costPrice: parseFloat(cols[4]) || 0,
          };
      }).filter((item: any) => item.code); 
      
      setParsedPasteData(parsed);
  };

  const handleConfirmBulkPaste = async () => {
      if (parsedPasteData.length === 0) return alert('没有解析到有效的数据！');
      setSubmittingInit(true);
      try {
          const batch = writeBatch(db);
          parsedPasteData.forEach(item => {
              const docRef = doc(collection(db, 'artifacts', APP_ID, 'public', 'data', 'sip_holding_spot_start'));
              batch.set(docRef, { ...item, createdAt: new Date().toISOString() });
          });
          await batch.commit();
          
          setShowPasteModal(false);
          setPasteText('');
          setParsedPasteData([]);
          alert(`成功批量导入 ${parsedPasteData.length} 条期初数据！`);
      } catch (e: any) {
          alert('批量导入失败: ' + e.message);
      } finally {
          setSubmittingInit(false);
      }
  };

  // --- 数据入库归档逻辑 ---
  const handleSaveCashStats = async () => {
      if (!user) return;
      setIsSavingCash(true);
      try {
          const payload = {
              accounts: netBuyStats.accounts,
              markets: netBuyStats.markets,
              rawMatrix: netBuyStats.rawMatrix,
              updatedAt: new Date().toISOString()
          };
          await publishLatestSummarySafely({ db, collectionName: 'sip_holding_cash_stock', payload, refreshGroup: 'holdings-stocks', sourcePage: '/book/SP_wjhh1/holdings/stocks' });
          setLastCashSavedTime(new Date().toLocaleString('zh-CN', { hour12: false }));
      } catch (e) {
          console.error("保存资金净买入统计失败:", e);
      } finally {
          setIsSavingCash(false);
      }
  };

  const handleSaveMktValStats = async () => {
      if (!user) return;
      if (!ensureCompleteQuotes('当前市值统计')) return;
      setIsSavingMktVal(true);
      try {
          const payload = {
              accounts: currentMktStats.accounts,
              markets: currentMktStats.markets,
              rawMatrix: currentMktStats.rawMatrix,
              updatedAt: new Date().toISOString()
          };
          await publishLatestSummarySafely({ db, collectionName: 'sip_holding_stock_mktvalue', payload, refreshGroup: 'holdings-stocks', sourcePage: '/book/SP_wjhh1/holdings/stocks' });
          setLastMktValSavedTime(new Date().toLocaleString('zh-CN', { hour12: false }));
      } catch (e) {
          console.error("保存当前市值统计失败:", e);
      } finally {
          setIsSavingMktVal(false);
      }
  };

  const handleSavePlStats = async () => {
      if (!user) return;
      if (!ensureCompleteQuotes('当前收益统计')) return;
      setIsSavingPl(true);
      try {
          const payload = {
              markets: currentPlStats.markets,
              rawMatrix: currentPlStats.rawMatrix,
              updatedAt: new Date().toISOString()
          };
          await publishLatestSummarySafely({ db, collectionName: 'sip_holding_stock_pl', payload, refreshGroup: 'holdings-stocks', sourcePage: '/book/SP_wjhh1/holdings/stocks' });
          setLastPlSavedTime(new Date().toLocaleString('zh-CN', { hour12: false }));
      } catch (e) {
          console.error("保存当前收益统计失败:", e);
      } finally {
          setIsSavingPl(false);
      }
  };

  const handleSaveInitialStats = async () => {
      if (!user) return;
      setIsSavingInitial(true);
      try {
          const payload = {
              accounts: initialStats.accounts,
              markets: initialStats.markets,
              rawMatrix: initialStats.rawMatrix,
              updatedAt: new Date().toISOString()
          };
          await publishLatestSummarySafely({ db, collectionName: 'sip_holding_spot_start', payload, refreshGroup: 'holdings-stocks', sourcePage: '/book/SP_wjhh1/holdings/stocks' });
          setLastInitialSavedTime(new Date().toLocaleString('zh-CN', { hour12: false }));
      } catch (e) {
          console.error("保存期初投入统计失败:", e);
      } finally {
          setIsSavingInitial(false);
      }
  };

  const handleSaveExposure = async () => {
      if (!user) return;
      if (!ensureCompleteQuotes('现货风控暴露')) return;
      setIsSavingExposure(true);
      try {
          const payload = {
              data: riskExposureSummary,
              updatedAt: new Date().toISOString()
          };
          await publishLatestSummarySafely({ db, collectionName: 'sip_exposure_spot', payload, refreshGroup: 'holdings-stocks', sourcePage: '/book/SP_wjhh1/holdings/stocks' });
          setLastExposureSavedTime(new Date().toLocaleString('zh-CN', { hour12: false }));
      } catch (e) {
          console.error("保存现货风控暴露失败:", e);
      } finally {
          setIsSavingExposure(false);
      }
  };

  // --- 获取并刷新后台库数据 ---
  const fetchDbRecords = async (collectionName: string) => {
      if (!user) return;
      setLoadingDb(true);
      try {
          const querySnapshot = await getDocs(query(collection(db, 'artifacts', APP_ID, 'public', 'data', collectionName)));
          let records: any[] = [];
          querySnapshot.forEach((docSnap) => {
              const data = docSnap.data();
              delete data.id; 
              records.push({ ...data, id: docSnap.id });
          });
          records.sort((a, b) => {
             const timeA = getTime(a.updatedAt) || getTime(a.createdAt);
             const timeB = getTime(b.updatedAt) || getTime(b.createdAt);
             return timeB - timeA;
          });
          setDbRecords(records);
      } catch(e) {
          console.error("读取数据库失败:", e);
      } finally {
          setLoadingDb(false);
      }
  };

  useEffect(() => {
      if (user) { fetchDbRecords(activeDbTab); }
  }, [activeDbTab, user]);

  // --- 后台库管理 Handlers ---
  const handleDeleteRecord = async (id: string) => {
      if (!confirm("确定要永久删除这条记录吗？不可恢复。")) return;
      try {
          await deleteDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', activeDbTab, id));
          setDbRecords(dbRecords.filter(r => r.id !== id));
      } catch(e: any) { alert("删除失败: " + e.message); }
  };

  const handleSaveRecordEdit = async () => {
      if (!editRecordModal) return;
      try {
          const parsedData = JSON.parse(editRecordModal.rawJson);
          const docId = parsedData.id || editRecordModal.record.id;
          delete parsedData.id; 
          parsedData.updatedAt = new Date().toISOString();
          await updateDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', activeDbTab, docId), parsedData);
          alert("数据修改成功！");
          setEditRecordModal(null);
          fetchDbRecords(activeDbTab); 
      } catch(e:any) { alert("修改失败 (请检查 JSON 格式是否正确): \n" + e.message); }
  };

  const getRecordSummary = (r: any, tab: string) => {
      try {
          if (tab === 'sip_spot_trade') {
              return `[${r.direction}] ${Math.abs(r.quantity)}股 ${r.code} | ${r.account}`;
          }
          if (tab === 'sip_holding_spot_start') {
              if (r.id === '_global_config') return `全局基准配置`;
              if (r.id === 'latest_summary') return `期初投入统计快照`;
              return `[期初] ${r.quantity}股 ${r.code} | ${r.account}`;
          }
          if (tab.includes('get-stock')) {
              return `【交收】${r.account || ''} | ${r.direction || ''} ${Math.abs(r.quantity || 0)}股 ${r.stockName || r.stockCode || ''}`;
          }
          if (tab.includes('exposure')) {
              const time = formatTime(r.updatedAt) || formatTime(r.createdAt) || 'N/A';
              return `按标的合并现货风控暴露快照 (更新于: ${time})`;
          }
          if (tab.includes('mktvalue') || tab.includes('pl') || tab.includes('sum') || tab.includes('cash')) {
              const time = formatTime(r.updatedAt) || formatTime(r.createdAt) || 'N/A';
              return `全局大盘统计快照 (更新于: ${time})`;
          }
          return JSON.stringify(r).substring(0, 100) + '...';
      } catch (e) { return '解析失败...'; }
  };

  // --- 初始持仓增删改查事件 ---
  const handleUpdateBaseDate = async (newDate: string) => {
      setBaseDate(newDate);
      try {
          await setDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'sip_holding_spot_start', '_global_config'), {
              baseDate: newDate
          });
      } catch (e) { console.error("更新基准日期失败", e); }
  };

  const handleSaveInitialHolding = async () => {
      if (!newInit.code || !newInit.market || !newInit.account || newInit.quantity <= 0 || newInit.costPrice < 0) {
          alert('请正确填写代码、账户、数量(>0)和成本价(>=0)');
          return;
      }
      setSubmittingInit(true);
      try {
          if (editingInitId) {
              await updateDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'sip_holding_spot_start', editingInitId), newInit);
              setEditingInitId(null);
          } else {
              await addDoc(collection(db, 'artifacts', APP_ID, 'public', 'data', 'sip_holding_spot_start'), newInit);
          }
          setNewInit({ code: '', market: 'HKD', account: '', quantity: 0, costPrice: 0 });
      } catch (e) {
          alert(editingInitId ? '修改期初持仓失败' : '添加期初持仓失败');
      } finally {
          setSubmittingInit(false);
      }
  };

  const handleEditInitialClick = (h: InitialHolding) => {
      setEditingInitId(h.id);
      setNewInit({
          code: h.code,
          market: h.market,
          account: h.account,
          quantity: h.quantity,
          costPrice: h.costPrice
      });
  };

  const handleCancelEditInit = () => {
      setEditingInitId(null);
      setNewInit({ code: '', market: 'HKD', account: '', quantity: 0, costPrice: 0 });
  };

  const handleDeleteInitialHolding = async (id: string) => {
      if (!confirm('确认删除这条期初持仓吗？这可能直接改变当前所有持仓市值与成本。')) return;
      try {
          await deleteDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'sip_holding_spot_start', id));
          if (editingInitId === id) handleCancelEditInit();
      } catch (e) { console.error("删除失败", e); }
  };

  // --- 辅助渲染 ---
  const formatMoney = (val: number, isHkdContext = false) => {
      const v = isHkdContext ? val : val; 
      return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };
  
  const fmtPct = (val: number) => (val * 100).toFixed(2) + '%';

  const holdingExcelText = useMemo(() => {
      const excelNumber = (value: number, digits = 2) => {
          if (!Number.isFinite(value)) return '';
          return value.toFixed(digits);
      };
      const accountLabel = selectedHoldingAccount || '全部账户';
      const headers = [
          '账户筛选',
          '名称',
          '股票代码',
          '币种',
          '一级行业',
          '二级行业',
          '持仓数量',
          '成本均价',
          '实时现价',
          '今日涨跌%',
          '总成本HKD',
          '现市值HKD',
          '浮动盈亏HKD',
          '盈亏比%',
          '市值占比%',
          '盈亏贡献率%',
          '各账户持仓股数',
      ];
      if (holdingTrialEnabled) {
          headers.splice(12, 0, '增减比例', '增减后市值HKD');
      }
      const rows = displayHoldings.map(h => {
          const pctOfTotalMktVal = holdingSums.grossMktValHKD > 0 ? Math.abs(h.mktValHKD) / holdingSums.grossMktValHKD : 0;
          const pnlContribution = holdingSums.grossCostHKD > 0 ? h.unrealizedPnlHKD / holdingSums.grossCostHKD : 0;
          const trialKey = getHoldingTrialKey(h);
          const trialRatioText = holdingTrialRatios[trialKey] || '';
          const trialRatio = parseHoldingTrialRatio(trialRatioText);
          const adjustedMktVal = h.hasValidQuote ? h.mktValHKD * (1 + trialRatio) : 0;
          const accountsText = Object.entries(h.accounts)
              .filter(([_account, qty]) => Math.abs(qty) > 0.000001)
              .map(([account, qty]) => `${account}:${excelNumber(qty, 6)}`)
              .join(' | ');
          const row = [
              accountLabel,
              h.name,
              h.code,
              h.market,
              h.sector_level_1,
              h.sector_level_2,
              excelNumber(h.quantity, 6),
              excelNumber(h.avgCost, 4),
              h.hasValidQuote ? excelNumber(h.currentPrice, 4) : '',
              h.hasValidQuote ? excelNumber(h.dailyChangePct * 100, 2) : '',
              excelNumber(h.totalCostHKD, 2),
              h.hasValidQuote ? excelNumber(h.mktValHKD, 2) : '',
              h.hasValidQuote ? excelNumber(h.unrealizedPnlHKD, 2) : '',
              h.hasValidQuote ? excelNumber(h.pnlRatio * 100, 2) : '',
              excelNumber(pctOfTotalMktVal * 100, 2),
              excelNumber(pnlContribution * 100, 2),
              accountsText,
          ];
          if (holdingTrialEnabled) {
              row.splice(12, 0, trialRatioText, h.hasValidQuote ? excelNumber(adjustedMktVal, 2) : '');
          }
          return row;
      });

      if (displayHoldings.length > 0) {
          const sumRow = [
              accountLabel,
              'SUM',
              '',
              '',
              '',
              '',
              '',
              '',
              '',
              '',
              excelNumber(holdingSums.totalCostHKD, 2),
              excelNumber(holdingSums.mktValHKD, 2),
              excelNumber(holdingSums.unrealizedPnlHKD, 2),
              excelNumber(totalUnrealizedPct * 100, 2),
              '100.00',
              excelNumber(totalUnrealizedPct * 100, 2),
              '',
          ];
          if (holdingTrialEnabled) {
              sumRow.splice(12, 0, '试算', excelNumber(holdingTrialSums.adjustedMktValHKD, 2));
          }
          rows.push(sumRow);
      }

      return [headers, ...rows].map(row => row.join('\t')).join('\n');
  }, [displayHoldings, holdingSums, holdingTrialEnabled, holdingTrialRatios, holdingTrialSums.adjustedMktValHKD, selectedHoldingAccount, totalUnrealizedPct]);

  const formatStatsSource = (source: string) => {
      if (source === 'published_summary') return '手动入库';
      if (source === 'display_cache') return '后端自动刷新缓存';
      return '当前实时计算';
  };
  
  const getSourceBadge = (source: string) => {
      switch(source) {
          case 'SPOT': return 'bg-blue-100 text-blue-700';
          case 'FCN': return 'bg-purple-100 text-purple-700';
          case 'DQ/AQ': return 'bg-orange-100 text-orange-700';
          case 'OPTION_CALL': return 'bg-pink-100 text-pink-700';
          case 'OPTION_PUT': return 'bg-rose-100 text-rose-700';
          default: return 'bg-gray-100 text-gray-700';
      }
  };

  if (loadingInitial) {
      return <div className="min-h-screen flex items-center justify-center"><Loader2 className="animate-spin text-blue-600" size={40}/></div>;
  }

  return (
    <div className="space-y-8 pb-10 max-w-[1500px] mx-auto px-4">
        {expandedTable && (
            <div
                className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
                onClick={() => setExpandedTable(null)}
            />
        )}
        {/* === Header === */}
        <div className="border-b border-gray-200 pb-4 pt-4 flex justify-between items-end">
            <div>
                <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                    <Building2 className="text-blue-600" />
                    Spot Holdings (现货持仓与盈亏分析)
                </h1>
                <p className="mt-1 text-sm text-gray-500">
                    以【期初底座】融合【增量流水】，实时计算平均转移成本与盈亏。
                </p>
            </div>
            <div className="flex gap-3">
                 <button 
                    onClick={() => setShowFxModal(true)} 
                    className="px-3 py-2 text-sm rounded border bg-white hover:bg-gray-50 text-gray-600 transition-colors shadow-sm flex items-center gap-1"
                    title="查看当前汇率"
                >
                    <Info size={16} className="text-blue-500" />
                    汇率详情
                </button>
                 <button 
                    onClick={() => fetchMarketData()} 
                    disabled={isFetchingRealTime}
                    className="px-4 py-2 text-sm rounded border bg-white hover:bg-gray-50 flex items-center gap-2 text-gray-600 transition-colors shadow-sm"
                >
                    <RefreshCw size={16} className={isFetchingRealTime ? 'animate-spin' : ''} />
                    更新行情
                </button>
            </div>
        </div>

        {cachedMarketDataTime && !isFetchingRealTime && (
            <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-xs text-blue-700">
                已加载{cachedMarketDataSource || '行情缓存'}：{cachedMarketDataTime}。如需最新价格，请点击“更新行情”。
            </div>
        )}

        <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-3 text-xs text-emerald-800">
            统计矩阵采用来源：
            市值矩阵 = {formatStatsSource(effectiveCurrentMktCandidate.source)}
            （{effectiveCurrentMktCandidate.time ? new Date(effectiveCurrentMktCandidate.time).toLocaleString('zh-CN', { hour12: false }) : '--'}）；
            收益表 = {formatStatsSource(effectiveCurrentPlCandidate.source)}
            （{effectiveCurrentPlCandidate.time ? new Date(effectiveCurrentPlCandidate.time).toLocaleString('zh-CN', { hour12: false }) : '--'}）。
        </div>

        {error && (
            <div className="bg-red-50 p-4 rounded text-red-700 flex items-center gap-2">
                <AlertCircle size={20}/> {error}
            </div>
        )}

        {(isFetchingRealTime || hasIncompleteQuotes) && (
            <div className="bg-amber-50 border border-amber-200 p-4 rounded-lg text-amber-800 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div className="flex items-start gap-2 min-w-0">
                    {isFetchingRealTime
                        ? <Loader2 size={20} className="animate-spin mt-0.5 flex-none" />
                        : <AlertCircle size={20} className="mt-0.5 flex-none" />}
                    <div>
                        <div className="font-bold">行情完整性校验未通过</div>
                        <div className="mt-1 text-xs break-all">{quoteValidationMessage}</div>
                        <div className="mt-1 text-[11px] text-amber-700">
                            市值、盈亏和暴露入库已锁定，避免用成本价代替现价写入错误数据。
                        </div>
                    </div>
                </div>
                <button
                    onClick={() => fetchMarketData()}
                    disabled={isFetchingRealTime}
                    className="flex-none inline-flex items-center justify-center gap-2 px-4 py-2 bg-white border border-amber-400 text-amber-800 hover:bg-amber-100 text-xs font-bold rounded shadow-sm disabled:opacity-50"
                >
                    <RefreshCw size={14} className={isFetchingRealTime ? 'animate-spin' : ''} />
                    重新获取行情
                </button>
            </div>
        )}

        {/* === 模块 1：当前持仓统计表 === */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-200 flex justify-between items-center bg-gray-50">
                <div className="flex items-center gap-4">
                    <h2 className="text-base font-bold text-gray-800 flex items-center gap-2">
                        <PieChart size={18} className="text-indigo-500" />
                        当前持仓统计表 ({displayHoldings.length} 只标的)
                    </h2>
                    {selectedHoldingAccount && (
                        <span className="text-xs font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100">
                            账户视角：{selectedHoldingAccount}
                        </span>
                    )}
                    {baseDate && (
                        <span className="text-xs font-medium text-red-600 bg-red-50 px-2 py-0.5 rounded border border-red-100">
                            仅计入 {baseDate} 之后的增量流水
                        </span>
                    )}
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                    <select
                        value={selectedHoldingAccount}
                        onChange={(e) => setSelectedHoldingAccount(e.target.value)}
                        className="h-8 rounded border border-indigo-200 bg-white px-2 text-xs font-bold text-gray-700 shadow-sm outline-none transition-colors hover:border-indigo-300 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                        title="按账户重算当前持仓、成本均价与盈亏"
                    >
                        <option value="">全部账户</option>
                        {holdingAccountOptions.map(account => (
                            <option key={account} value={account}>{account}</option>
                        ))}
                    </select>
                    {selectedHoldingAccount && (
                        <button
                            onClick={() => setSelectedHoldingAccount('')}
                            className="flex items-center gap-1 rounded border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-bold text-gray-500 shadow-sm transition-colors hover:bg-gray-50"
                        >
                            <X size={13} />
                            清空账户
                        </button>
                    )}
                    <button
                        onClick={() => setShowHoldingExcelModal(true)}
                        className="flex items-center gap-1.5 rounded border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700 shadow-sm transition-colors hover:bg-emerald-100"
                    >
                        <ClipboardList size={14} />
                        复制到 Excel
                    </button>
                    <button
                        onClick={() => setExpandedTable('holdings')}
                        className="flex items-center gap-1.5 rounded border border-indigo-200 bg-white px-3 py-1.5 text-xs font-bold text-indigo-700 shadow-sm transition-colors hover:bg-indigo-50"
                    >
                        <FileJson size={14} />
                        弹窗查看全部
                    </button>
                    <span className="text-xs text-gray-500 bg-white px-2 py-1 border rounded shadow-sm">数值统一为 <b>HKD</b> 且按平均转移成本法结算</span>
                </div>
            </div>
            
            <div className={getTableContainerClass('holdings', 'overflow-x-auto overflow-y-auto max-h-[500px] relative scrollbar-thin')}>
                {renderExpandedTableHeader('holdings', '当前持仓统计表', `当前显示 ${displayHoldings.length} 只标的，原页面筛选与排序同步生效。`)}
                {expandedTable === 'holdings' && holdingTrialEnabled && (
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
                        <span>
                            增减比例支持输入 <b>-50%</b>、<b>-50</b> 或 <b>-0.5</b>；增减后市值 = 现市值 × (1 + 增减比例)。
                        </span>
                        <button
                            onClick={() => setHoldingTrialRatios({})}
                            className="rounded border border-amber-300 bg-white px-3 py-1.5 font-bold text-amber-800 shadow-sm transition-colors hover:bg-amber-100"
                        >
                            清空试算
                        </button>
                    </div>
                )}
                <table className="min-w-full text-xs text-left">
                    <thead className="text-gray-500 font-medium bg-gray-50 sticky top-0 z-20 shadow-sm">
                        <tr>
                            <Th label="名称/代码" sortKey="code" filterKey="code" currentSort={holdingSort} onSort={toggleHoldingSort} currentFilter={holdingFilters} onFilter={updateHoldingFilter} width="160px"/>
                            <Th label="币种" sortKey="market" filterKey="market" currentSort={holdingSort} onSort={toggleHoldingSort} currentFilter={holdingFilters} onFilter={updateHoldingFilter} align="center"/>
                            <Th label="行业 (一/二级)" sortKey="sector_level_1" filterKey="sector_level_1" currentSort={holdingSort} onSort={toggleHoldingSort} currentFilter={holdingFilters} onFilter={updateHoldingFilter} />
                            <Th label="持仓数量" sortKey="quantity" filterKey={null} currentSort={holdingSort} onSort={toggleHoldingSort} currentFilter={holdingFilters} onFilter={updateHoldingFilter} align="right" />
                            <Th label="成本均价" sortKey="avgCost" filterKey={null} currentSort={holdingSort} onSort={toggleHoldingSort} currentFilter={holdingFilters} onFilter={updateHoldingFilter} align="right" />
                            <Th label="实时现价" sortKey="currentPrice" filterKey={null} currentSort={holdingSort} onSort={toggleHoldingSort} currentFilter={holdingFilters} onFilter={updateHoldingFilter} align="right" />
                            <Th label="今日涨跌" sortKey="dailyChangePct" filterKey={null} currentSort={holdingSort} onSort={toggleHoldingSort} currentFilter={holdingFilters} onFilter={updateHoldingFilter} align="right" />
                            <Th label="总成本 (HKD)" sortKey="totalCostHKD" filterKey={null} currentSort={holdingSort} onSort={toggleHoldingSort} currentFilter={holdingFilters} onFilter={updateHoldingFilter} align="right" />
                            <Th label="现市值 (HKD)" sortKey="mktValHKD" filterKey={null} currentSort={holdingSort} onSort={toggleHoldingSort} currentFilter={holdingFilters} onFilter={updateHoldingFilter} align="right" />
                            {expandedTable === 'holdings' && holdingTrialEnabled && (
                                <>
                                    <Th label="增减比例" sortKey={null} filterKey={null} align="right" />
                                    <Th label="增减后市值" sortKey={null} filterKey={null} align="right" />
                                </>
                            )}
                            <Th label="浮动盈亏 (HKD)" sortKey="unrealizedPnlHKD" filterKey={null} currentSort={holdingSort} onSort={toggleHoldingSort} currentFilter={holdingFilters} onFilter={updateHoldingFilter} align="right" />
                            <Th label="盈亏比" sortKey="pnlRatio" filterKey={null} currentSort={holdingSort} onSort={toggleHoldingSort} currentFilter={holdingFilters} onFilter={updateHoldingFilter} align="right" />
                            <Th label="市值占比" sortKey={null} filterKey={null} align="right" />
                            <Th label="盈亏贡献率" sortKey={null} filterKey={null} align="right" />
                            <Th label="各账户持仓股数" sortKey={null} filterKey="accounts" currentFilter={holdingFilters} onFilter={updateHoldingFilter} />
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {displayHoldings.length === 0 ? (
                            <tr><td colSpan={expandedTable === 'holdings' && holdingTrialEnabled ? 16 : 14} className="p-8 text-center text-gray-400">当前空仓或无符合条件数据</td></tr>
                        ) : displayHoldings.map(h => {
                            const pctOfTotalMktVal = holdingSums.grossMktValHKD > 0 ? Math.abs(h.mktValHKD) / holdingSums.grossMktValHKD : 0;
                            const pnlContribution = holdingSums.grossCostHKD > 0 ? h.unrealizedPnlHKD / holdingSums.grossCostHKD : 0;
                            const accountsArr = Object.entries(h.accounts).filter(([_k, qty]) => Math.abs(qty) > 0.000001).map(([acc, qty]) => `'${acc}': ${qty.toLocaleString()}`);
                            const trialKey = getHoldingTrialKey(h);
                            const trialRatioText = holdingTrialRatios[trialKey] || '';
                            const trialRatio = parseHoldingTrialRatio(trialRatioText);
                            const adjustedMktVal = h.hasValidQuote ? h.mktValHKD * (1 + trialRatio) : 0;
                            
                            return (
                                <tr key={h.code} className="hover:bg-indigo-50/30 transition-colors">
                                    <td className="px-3 py-2 whitespace-nowrap">
                                        <div className="font-bold text-gray-900 text-sm">{h.name}</div>
                                        <div className="text-[10px] text-gray-500 font-mono">{h.code}</div>
                                    </td>
                                    <td className="px-3 py-2 text-center font-mono text-gray-500">{h.market}</td>
                                    <td className="px-3 py-2 whitespace-nowrap">
                                        <div className="text-xs text-gray-700 font-medium">{h.sector_level_1}</div>
                                        <div className="text-[10px] text-gray-400">{h.sector_level_2}</div>
                                    </td>
                                    <td className="px-3 py-2 text-right font-mono font-bold text-gray-800">{h.quantity.toLocaleString()}</td>
                                    <td className="px-3 py-2 text-right font-mono text-gray-600">{h.avgCost.toFixed(4)}</td>
                                    <td className="px-3 py-2 text-right font-mono font-medium text-indigo-700 bg-indigo-50/50">
                                        {h.hasValidQuote ? h.currentPrice.toFixed(4) : <span className="text-amber-600 font-bold">--</span>}
                                    </td>
                                    <td className={`px-3 py-2 text-right font-mono font-bold ${h.hasValidQuote ? (h.dailyChangePct >= 0 ? 'text-red-600' : 'text-green-600') : 'text-amber-600'}`}>
                                        {h.hasValidQuote ? `${h.dailyChangePct > 0 ? '+' : ''}${fmtPct(h.dailyChangePct)}` : '--'}
                                    </td>
                                    <td className="px-3 py-2 text-right font-mono text-gray-700">{formatMoney(h.totalCostHKD, true)}</td>
                                    <td className="px-3 py-2 text-right font-mono font-bold text-gray-900">
                                        {h.hasValidQuote ? formatMoney(h.mktValHKD, true) : <span className="text-amber-600">--</span>}
                                    </td>
                                    {expandedTable === 'holdings' && holdingTrialEnabled && (
                                        <>
                                            <td className="px-3 py-2 text-right bg-amber-50/50">
                                                <input
                                                    type="text"
                                                    value={trialRatioText}
                                                    onChange={(e) => setHoldingTrialRatios(prev => ({ ...prev, [trialKey]: e.target.value }))}
                                                    placeholder="-50%"
                                                    className="w-20 rounded border border-amber-200 bg-white px-2 py-1 text-right font-mono text-xs font-bold text-amber-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                                                />
                                            </td>
                                            <td className="px-3 py-2 text-right font-mono font-bold text-amber-800 bg-amber-50/50">
                                                {h.hasValidQuote ? formatMoney(adjustedMktVal, true) : '--'}
                                            </td>
                                        </>
                                    )}
                                    <td className={`px-3 py-2 text-right font-mono font-bold ${h.hasValidQuote ? (h.unrealizedPnlHKD >= 0 ? 'text-red-600' : 'text-green-600') : 'text-amber-600'}`}>
                                        {h.hasValidQuote ? `${h.unrealizedPnlHKD > 0 ? '+' : ''}${formatMoney(h.unrealizedPnlHKD, true)}` : '--'}
                                    </td>
                                    <td className={`px-3 py-2 text-right font-mono font-bold ${h.hasValidQuote ? (h.pnlRatio >= 0 ? 'text-red-600' : 'text-green-600') : 'text-amber-600'}`}>
                                        {h.hasValidQuote ? `${h.pnlRatio > 0 ? '+' : ''}${fmtPct(h.pnlRatio)}` : '--'}
                                    </td>
                                    <td className="px-3 py-2 text-right font-mono text-gray-500">{fmtPct(pctOfTotalMktVal)}</td>
                                    <td className={`px-3 py-2 text-right font-mono ${pnlContribution >= 0 ? 'text-red-500' : 'text-green-500'}`}>
                                        {pnlContribution > 0 ? '+' : ''}{fmtPct(pnlContribution)}
                                    </td>
                                    <td className="px-3 py-2 whitespace-nowrap">
                                        <span className="text-[10px] text-gray-500 font-mono tracking-tighter max-w-[150px] truncate block" title={`[${accountsArr.join(', ')}]`}>
                                            [{accountsArr.join(', ')}]
                                        </span>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                    {displayHoldings.length > 0 && (
                        <tfoot className="bg-indigo-50 border-t-2 border-indigo-200 sticky bottom-0 z-20 shadow-[0_-1px_2px_rgba(0,0,0,0.05)]">
                            <tr>
                                <td colSpan={7} className="px-3 py-3 text-center font-bold text-indigo-900 tracking-widest">SUM</td>
                                <td className="px-3 py-3 text-right font-mono font-bold text-indigo-900">{formatMoney(holdingSums.totalCostHKD, true)}</td>
                                <td className="px-3 py-3 text-right font-mono font-bold text-indigo-900">{formatMoney(holdingSums.mktValHKD, true)}</td>
                                {expandedTable === 'holdings' && holdingTrialEnabled && (
                                    <>
                                        <td className="px-3 py-3 text-right font-mono font-bold text-amber-700 bg-amber-50">试算</td>
                                        <td className="px-3 py-3 text-right font-mono font-bold text-amber-800 bg-amber-50">{formatMoney(holdingTrialSums.adjustedMktValHKD, true)}</td>
                                    </>
                                )}
                                <td className={`px-3 py-3 text-right font-mono font-bold text-lg ${holdingSums.unrealizedPnlHKD >= 0 ? 'text-red-600' : 'text-green-600'}`}>
                                    {holdingSums.unrealizedPnlHKD > 0 ? '+' : ''}{formatMoney(holdingSums.unrealizedPnlHKD, true)}
                                </td>
                                <td className={`px-3 py-3 text-right font-mono font-bold text-lg ${totalUnrealizedPct >= 0 ? 'text-red-600' : 'text-green-600'}`}>
                                    {totalUnrealizedPct > 0 ? '+' : ''}{fmtPct(totalUnrealizedPct)}
                                </td>
                                <td colSpan={1} className="px-3 py-3 text-right font-mono font-bold text-indigo-600">100.00%</td>
                                <td className={`px-3 py-3 text-right font-mono font-bold ${totalUnrealizedPct >= 0 ? 'text-red-600' : 'text-green-600'}`}>
                                    {totalUnrealizedPct > 0 ? '+' : ''}{fmtPct(totalUnrealizedPct)}
                                </td>
                                <td></td>
                            </tr>
                        </tfoot>
                    )}
                </table>
            </div>

            {/* 当前持仓风控暴露入库区 (提取底层数据入库) */}
            <div className="mt-4 mx-5 mb-5 flex items-center justify-between bg-white px-4 py-3 rounded border border-indigo-100 shadow-sm">
                <div className="flex items-center gap-4 text-xs text-gray-500">
                    <span className="flex items-center gap-1.5"><Clock size={14} className="text-indigo-500" /> 现货风控暴露最后入库时间: <span className="font-mono font-medium text-gray-700">{lastExposureSavedTime}</span></span>
                    <span className="text-[10px] bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded border border-indigo-100">
                        {(isHKDView || hasActiveFilters) ? '※风控手动入库已在折算或筛选视图下暂停，保护数据纯净' : '※点击手动刷新后更新，点击按钮才入库'}
                    </span>
                </div>
                <div className="flex items-center gap-3">
                    <button onClick={() => fetchMarketData()} disabled={isFetchingRealTime} className="flex items-center gap-2 px-4 py-2 bg-white border border-indigo-600 text-indigo-600 hover:bg-indigo-50 text-xs font-bold rounded shadow-sm transition-colors disabled:opacity-50">
                        <RefreshCw size={14} className={isFetchingRealTime ? 'animate-spin' : ''} /> 刷新风控汇总
                    </button>
                    {(!isHKDView && !hasActiveFilters) && (
                        <button onClick={handleSaveExposure} disabled={isSavingExposure || isFetchingRealTime || hasIncompleteQuotes} title={quoteValidationMessage || undefined} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded shadow-sm transition-colors disabled:opacity-50">
                            {isSavingExposure ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} 暴露汇总手动入库
                        </button>
                    )}
                </div>
            </div>

            {/* 当前市值二维统计表 */}
            <div className="bg-indigo-50 border-t border-indigo-100 p-5">
                <div className="flex justify-between items-center mb-3">
                    <h3 className="font-bold text-indigo-800 text-sm">当前市值二维统计矩阵</h3>
                    <button 
                        onClick={() => setIsHKDView(!isHKDView)}
                        disabled={isFetchingRealTime}
                        className={`text-xs font-bold px-3 py-1.5 rounded transition-colors border ${isHKDView ? 'bg-indigo-600 text-white border-indigo-600 shadow-inner' : 'bg-white text-indigo-700 border-indigo-200 hover:bg-indigo-100 shadow-sm'}`}
                    >
                        {isFetchingRealTime && <Loader2 size={12} className="animate-spin inline mr-1" />}
                        {isHKDView ? '恢复原始币种' : 'TO HKD (一键折算)'}
                    </button>
                </div>
                <div className="overflow-x-auto rounded border border-indigo-200 bg-white">
                    <table className="min-w-full text-xs text-right">
                        <thead className="bg-indigo-100/50 text-indigo-900 font-medium">
                            <tr>
                                <th className="px-3 py-2 text-center border-b border-r border-indigo-100 bg-indigo-50/50">币种 \ 账户</th>
                                {effectiveCurrentMktStats.accounts.map(acc => (
                                    <th key={acc} className="px-3 py-2 border-b border-indigo-100">{acc}</th>
                                ))}
                                <th className="px-3 py-2 border-b border-l border-indigo-100 bg-indigo-50/50">SUM (HKD)</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-indigo-50">
                            {effectiveCurrentMktStats.markets.map(mkt => {
                                const rate = isHKDView ? (globalFxRates[mkt] || 1) : 1;
                                const actualRate = globalFxRates[mkt] || 1;
                                let rawRowSum = 0;
                                return (
                                    <tr key={mkt} className="hover:bg-indigo-50/30">
                                        <td className="px-3 py-2 text-center font-bold text-gray-700 border-r border-indigo-50 bg-indigo-50/20">{mkt}</td>
                                        {effectiveCurrentMktStats.accounts.map(acc => {
                                            const rawVal = effectiveCurrentMktStats.rawMatrix[mkt][acc] || 0;
                                            rawRowSum += rawVal;
                                            const displayVal = rawVal * rate;
                                            return (
                                                <td key={acc} className={`px-3 py-2 font-mono ${displayVal >= 0 ? 'text-gray-700' : 'text-red-600'}`}>
                                                    {displayVal === 0 ? '-' : formatMoney(displayVal, isHKDView)}
                                                </td>
                                            );
                                        })}
                                        <td className={`px-3 py-2 font-mono font-bold border-l border-indigo-50 bg-indigo-50/20 ${rawRowSum * actualRate >= 0 ? 'text-indigo-900' : 'text-red-600'}`}>
                                            {rawRowSum * actualRate === 0 ? '-' : formatMoney(rawRowSum * actualRate, true)}
                                        </td>
                                    </tr>
                                );
                            })}
                            {effectiveCurrentMktStats.markets.length === 0 && (
                                <tr><td colSpan={effectiveCurrentMktStats.accounts.length + 2} className="px-3 py-4 text-center text-gray-400">暂无数据</td></tr>
                            )}
                        </tbody>
                        {effectiveCurrentMktStats.markets.length > 0 && (
                            <tfoot className="bg-indigo-100 text-indigo-900 border-t-2 border-indigo-200 shadow-inner">
                                <tr>
                                    <td className="px-3 py-3 text-center font-bold border-r border-indigo-200">SUM (HKD)</td>
                                    {effectiveCurrentMktStats.accounts.map(acc => {
                                        let colSumHKD = 0;
                                        effectiveCurrentMktStats.markets.forEach(mkt => {
                                            const rawVal = effectiveCurrentMktStats.rawMatrix[mkt][acc] || 0;
                                            colSumHKD += rawVal * (globalFxRates[mkt] || 1);
                                        });
                                        return (
                                            <td key={acc} className={`px-3 py-3 font-mono font-bold ${colSumHKD >= 0 ? 'text-indigo-900' : 'text-red-600'}`}>
                                                {colSumHKD === 0 ? '-' : formatMoney(colSumHKD, true)}
                                            </td>
                                        );
                                    })}
                                    <td className={`px-3 py-3 font-mono font-bold text-sm border-l border-indigo-200 ${holdingSums.mktValHKD >= 0 ? 'text-indigo-900' : 'text-red-600'}`}>
                                        {formatMoney(holdingSums.mktValHKD, true)} HKD
                                    </td>
                                </tr>
                            </tfoot>
                        )}
                    </table>
                </div>
                <div className="mt-4 flex items-center justify-between bg-white px-4 py-3 rounded border border-indigo-100 shadow-sm">
                    <div className="flex items-center gap-4 text-xs text-gray-500">
                        <span className="flex items-center gap-1.5"><Clock size={14} className="text-indigo-500" /> 最后入库时间: <span className="font-mono font-medium text-gray-700">{lastMktValSavedTime}</span></span>
                        <span className="text-[10px] bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded border border-indigo-100">
                            {(isHKDView || hasActiveFilters) ? '※手动入库已在折算或筛选视图下暂停' : '※点击手动刷新后更新，点击按钮才入库'}
                        </span>
                    </div>
                    <div className="flex items-center gap-3">
                        <button onClick={() => fetchMarketData()} disabled={isFetchingRealTime} className="flex items-center gap-2 px-4 py-2 bg-white border border-indigo-600 text-indigo-600 hover:bg-indigo-50 text-xs font-bold rounded shadow-sm transition-colors disabled:opacity-50">
                            <RefreshCw size={14} className={isFetchingRealTime ? 'animate-spin' : ''} /> 手动刷新
                        </button>
                        {(!isHKDView && !hasActiveFilters) && (
                            <button onClick={handleSaveMktValStats} disabled={isSavingMktVal || isFetchingRealTime || hasIncompleteQuotes} title={quoteValidationMessage || undefined} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded shadow-sm transition-colors disabled:opacity-50">
                                {isSavingMktVal ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} 手动保存入库
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>

        {/* === 模块 2：盈亏分析图表 === */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-200 flex justify-between items-center bg-gray-50">
                <h2 className="text-base font-bold text-gray-800 flex items-center gap-2">
                    <BarChartIcon size={18} className="text-rose-500" />
                    盈亏分析明细与图表 (未实现 vs 已实现)
                </h2>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setExpandedTable('pnl')}
                        className="flex items-center gap-1.5 rounded border border-rose-200 bg-white px-3 py-1.5 text-xs font-bold text-rose-700 shadow-sm transition-colors hover:bg-rose-50"
                    >
                        <FileJson size={14} />
                        弹窗查看全部
                    </button>
                    <div className="flex bg-white rounded border border-gray-300 p-0.5 shadow-sm">
                        <button 
                            onClick={() => setChartType('BEST')}
                            className={`px-3 py-1 text-xs font-bold rounded-sm transition-colors ${chartType === 'BEST' ? 'bg-red-500 text-white' : 'text-gray-500 hover:bg-gray-100'}`}
                        >
                            Top 10 最好
                        </button>
                        <button 
                            onClick={() => setChartType('WORST')}
                            className={`px-3 py-1 text-xs font-bold rounded-sm transition-colors ${chartType === 'WORST' ? 'bg-green-500 text-white' : 'text-gray-500 hover:bg-gray-100'}`}
                        >
                            Top 10 最差
                        </button>
                    </div>
                </div>
            </div>
            <div className={getTableContainerClass('pnl', 'grid grid-cols-1 lg:grid-cols-5 divide-y lg:divide-y-0 lg:divide-x divide-gray-200')}>
                {renderExpandedTableHeader('pnl', '盈亏分析明细与图表', `当前显示 ${chartData.length} 只标的，图表模式与原页面同步。`)}
                <div className={expandedTable === 'pnl' ? 'overflow-visible' : 'lg:col-span-3 overflow-y-auto max-h-[500px]'}>
                    <table className="w-full text-xs text-left">
                        <thead className="text-gray-500 font-medium bg-white sticky top-0 shadow-sm z-10">
                            <tr>
                                <Th label="标的" sortKey={null} filterKey="target" currentSort={pnlSort} onSort={togglePnlSort} currentFilter={pnlFilters} onFilter={updatePnlFilter} />
                                <Th label="浮动盈亏(未实现)" sortKey="unrealized" filterKey={null} currentSort={pnlSort} onSort={togglePnlSort} currentFilter={pnlFilters} onFilter={updatePnlFilter} align="right" />
                                <Th label="已实现盈亏" sortKey="realized" filterKey={null} currentSort={pnlSort} onSort={togglePnlSort} currentFilter={pnlFilters} onFilter={updatePnlFilter} align="right" />
                                <Th label="总盈亏 (HKD)" sortKey="totalPnl" filterKey={null} currentSort={pnlSort} onSort={togglePnlSort} currentFilter={pnlFilters} onFilter={updatePnlFilter} align="right" />
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {displayPnlData.length === 0 ? (
                                <tr>
                                    <td colSpan={4} className="px-4 py-8 text-center text-gray-400">无匹配标的，请调整筛选条件</td>
                                </tr>
                            ) : displayPnlData.map(p => (
                                <tr key={p.code} className="hover:bg-gray-50">
                                    <td className="px-4 py-2">
                                        <div className="font-bold text-gray-800">{p.code}</div>
                                        <div className="text-[10px] text-gray-400 truncate max-w-[180px]" title={p.name}>{p.name}</div>
                                    </td>
                                    <td className={`px-4 py-2 text-right font-mono ${p.unrealized > 0 ? 'text-red-500' : p.unrealized < 0 ? 'text-green-500' : 'text-gray-400'}`}>{p.unrealized > 0 ? '+' : ''}{formatMoney(p.unrealized, true)}</td>
                                    <td className={`px-4 py-2 text-right font-mono ${p.realized > 0 ? 'text-red-500' : p.realized < 0 ? 'text-green-500' : 'text-gray-400'}`}>{p.realized > 0 ? '+' : ''}{formatMoney(p.realized, true)}</td>
                                    <td className={`px-4 py-2 text-right font-mono font-bold ${p.totalPnl > 0 ? 'text-red-600' : p.totalPnl < 0 ? 'text-green-600' : 'text-gray-500'}`}>{p.totalPnl > 0 ? '+' : ''}{formatMoney(p.totalPnl, true)}</td>
                                </tr>
                            ))}
                        </tbody>
                        <tfoot className="bg-rose-50 border-t-2 border-rose-200 sticky bottom-0">
                            <tr>
                                <td className="px-4 py-3 font-bold text-rose-900">总计 SUM</td>
                                <td className={`px-4 py-3 text-right font-mono font-bold ${displayPnlSums.unrealized >= 0 ? 'text-red-600' : 'text-green-600'}`}>{displayPnlSums.unrealized > 0 ? '+' : ''}{formatMoney(displayPnlSums.unrealized, true)}</td>
                                <td className={`px-4 py-3 text-right font-mono font-bold ${displayPnlSums.realized >= 0 ? 'text-red-600' : 'text-green-600'}`}>{displayPnlSums.realized > 0 ? '+' : ''}{formatMoney(displayPnlSums.realized, true)}</td>
                                <td className={`px-4 py-3 text-right font-mono font-bold text-lg ${displayPnlSums.total >= 0 ? 'text-red-600' : 'text-green-600'}`}>{displayPnlSums.total > 0 ? '+' : ''}{formatMoney(displayPnlSums.total, true)}</td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
                <div className="lg:col-span-2 p-6 flex flex-col justify-center bg-gray-50/50">
                    <h3 className="text-center font-bold text-gray-700 mb-6">
                        {chartType === 'BEST' ? '🏅 总盈亏贡献 Top 10 (必须盈利)' : '⚠️ 总盈亏拖累 Top 10 (必须亏损)'}
                    </h3>
                    <div className="h-[350px] w-full">
                        {chartData.length === 0 ? (
                            <div className="flex items-center justify-center h-full text-gray-400">暂无符合该分类的盈亏数据</div>
                        ) : (
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                                    <XAxis dataKey="name" tick={{fontSize: 10}} interval={0} angle={-30} textAnchor="end" height={50} />
                                    <YAxis tickFormatter={(val) => `${(val/10000).toFixed(0)}w`} tick={{fontSize: 10}} />
                                    <Tooltip 
                                        formatter={(value: any) => [formatMoney(Number(value) || 0, true) + ' HKD', '总盈亏']}
                                        labelStyle={{fontWeight: 'bold', color: '#374151'}}
                                        contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'}}
                                    />
                                    <Bar dataKey="totalPnl" radius={[4, 4, 0, 0]} maxBarSize={50}>
                                        {chartData.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={entry.totalPnl >= 0 ? '#ef4444' : '#22c55e'} />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        )}
                    </div>
                </div>
            </div>

            {/* 当前收益统计表 */}
            <div className="bg-rose-50 border-t border-rose-100 p-5 rounded-lg">
                <div className="flex justify-between items-center mb-3">
                    <h3 className="font-bold text-rose-800 text-sm">当前收益统计表</h3>
                    <button 
                        onClick={() => setIsHKDView(!isHKDView)}
                        disabled={isFetchingRealTime}
                        className={`text-xs font-bold px-3 py-1.5 rounded transition-colors border ${isHKDView ? 'bg-rose-600 text-white border-rose-600 shadow-inner' : 'bg-white text-rose-700 border-rose-200 hover:bg-rose-100 shadow-sm'}`}
                    >
                        {isFetchingRealTime && <Loader2 size={12} className="animate-spin inline mr-1" />}
                        {isHKDView ? '恢复原始币种' : 'TO HKD (一键折算)'}
                    </button>
                </div>
                <div className="overflow-x-auto rounded border border-rose-200 bg-white">
                    <table className="min-w-full text-xs text-right">
                        <thead className="bg-rose-100/50 text-rose-900 font-medium">
                            <tr>
                                <th className="px-3 py-2 text-center border-b border-r border-rose-100 bg-rose-50/50">币种</th>
                                <th className="px-3 py-2 border-b border-rose-100">已实现盈亏 (票息)</th>
                                <th className="px-3 py-2 border-b border-rose-100">浮动盈亏 (未实现损益)</th>
                                <th className="px-3 py-2 border-b border-l border-rose-100 bg-rose-50/50">总盈亏 {isHKDView ? '(HKD)' : '(原币种)'}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-rose-50">
                            {effectiveCurrentPlStats.markets.map(mkt => {
                                const rate = isHKDView ? (globalFxRates[mkt] || 1) : 1;
                                const data = effectiveCurrentPlStats.rawMatrix[mkt];
                                const displayRealized = data.realized * rate;
                                const displayUnrealized = data.unrealized * rate;
                                const displayTotal = data.total * rate;
                                return (
                                    <tr key={mkt} className="hover:bg-rose-50/30">
                                        <td className="px-3 py-2 text-center font-bold text-gray-700 border-r border-rose-50 bg-rose-50/20">{mkt}</td>
                                        <td className={`px-3 py-3 font-mono ${displayRealized > 0 ? 'text-red-600' : displayRealized < 0 ? 'text-green-600' : 'text-gray-400'}`}>
                                            {displayRealized > 0 ? '+' : ''}{displayRealized === 0 ? '-' : formatMoney(displayRealized, isHKDView)}
                                        </td>
                                        <td className={`px-3 py-3 font-mono ${displayUnrealized > 0 ? 'text-red-600' : displayUnrealized < 0 ? 'text-green-600' : 'text-gray-400'}`}>
                                            {displayUnrealized > 0 ? '+' : ''}{displayUnrealized === 0 ? '-' : formatMoney(displayUnrealized, isHKDView)}
                                        </td>
                                        <td className={`px-3 py-3 font-mono font-bold border-l border-rose-50 bg-rose-50/20 ${displayTotal > 0 ? 'text-red-700' : displayTotal < 0 ? 'text-green-700' : 'text-gray-500'}`}>
                                            {displayTotal > 0 ? '+' : ''}{displayTotal === 0 ? '-' : formatMoney(displayTotal, isHKDView)}
                                        </td>
                                    </tr>
                                );
                            })}
                            {effectiveCurrentPlStats.markets.length === 0 && (
                                <tr><td colSpan={4} className="px-3 py-6 text-center text-gray-400">暂无数据</td></tr>
                            )}
                        </tbody>
                        {effectiveCurrentPlStats.markets.length > 0 && (
                            <tfoot className="bg-rose-100 text-rose-900 border-t-2 border-rose-200 shadow-inner">
                                <tr>
                                    <td className="px-3 py-4 text-center font-bold border-r border-rose-200">
                                        {isHKDView ? 'SUM (HKD)' : 'SUM (无效)'}
                                    </td>
                                    <td className={`px-3 py-4 font-mono font-bold ${!isHKDView ? 'text-gray-400' : (pnlSums.realized > 0 ? 'text-red-600' : pnlSums.realized < 0 ? 'text-green-600' : 'text-gray-500')}`}>
                                        {!isHKDView ? '-' : (pnlSums.realized > 0 ? '+' : '') + (pnlSums.realized === 0 ? '-' : formatMoney(pnlSums.realized, true))}
                                    </td>
                                    <td className={`px-3 py-4 font-mono font-bold ${!isHKDView ? 'text-gray-400' : (pnlSums.unrealized > 0 ? 'text-red-600' : pnlSums.unrealized < 0 ? 'text-green-600' : 'text-gray-500')}`}>
                                        {!isHKDView ? '-' : (pnlSums.unrealized > 0 ? '+' : '') + (pnlSums.unrealized === 0 ? '-' : formatMoney(pnlSums.unrealized, true))}
                                    </td>
                                    <td className="px-3 py-4 font-mono font-bold text-sm border-l border-rose-200 bg-rose-200/50 text-rose-900">
                                        {!isHKDView ? <span className="text-gray-400">-</span> : (
                                            (pnlSums.total > 0 ? '+' : '') + formatMoney(pnlSums.total, true) + ' HKD'
                                        )}
                                    </td>
                                </tr>
                            </tfoot>
                        )}
                    </table>
                </div>
                <div className="mt-4 flex items-center justify-between bg-white px-4 py-3 rounded border border-rose-100 shadow-sm">
                    <div className="flex items-center gap-4 text-xs text-gray-500">
                        <span className="flex items-center gap-1.5"><Clock size={14} className="text-rose-500" /> 最后入库时间: <span className="font-mono font-medium text-gray-700">{lastPlSavedTime}</span></span>
                        <span className="text-[10px] bg-rose-50 text-rose-600 px-2 py-0.5 rounded border border-rose-100">
                            {(isHKDView || hasActiveFilters) ? '※手动入库已在折算或筛选视图下暂停' : '※点击手动刷新后更新，点击按钮才入库'}
                        </span>
                    </div>
                    <div className="flex items-center gap-3">
                        <button onClick={() => fetchMarketData()} disabled={isFetchingRealTime} className="flex items-center gap-2 px-4 py-2 bg-white border border-rose-600 text-rose-600 hover:bg-rose-50 text-xs font-bold rounded shadow-sm transition-colors disabled:opacity-50">
                            <RefreshCw size={14} className={isFetchingRealTime ? 'animate-spin' : ''} /> 手动刷新
                        </button>
                        {(!isHKDView && !hasActiveFilters) && (
                            <button onClick={handleSavePlStats} disabled={isSavingPl || isFetchingRealTime || hasIncompleteQuotes} title={quoteValidationMessage || undefined} className="flex items-center gap-2 px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded shadow-sm transition-colors disabled:opacity-50">
                                {isSavingPl ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} 手动保存入库
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>

        {/* === 模块 3：交易记录流水表 === */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-200 flex justify-between items-center bg-gray-50">
                <div className="flex items-center gap-4">
                    <h2 className="text-base font-bold text-gray-800 flex items-center gap-2">
                        <ListOrdered size={18} className="text-blue-500" />
                        交易记录流水表 ({displayTrades.length} 笔)
                    </h2>
                    {baseDate && (
                        <span className="text-xs font-medium text-red-600 bg-red-50 px-2 py-0.5 rounded border border-red-100">
                            已过滤 {baseDate} 之前的旧数据
                        </span>
                    )}
                </div>
                <button
                    onClick={() => setExpandedTable('trades')}
                    className="flex items-center gap-1.5 rounded border border-blue-200 bg-white px-3 py-1.5 text-xs font-bold text-blue-700 shadow-sm transition-colors hover:bg-blue-50"
                >
                    <FileJson size={14} />
                    弹窗查看全部
                </button>
            </div>
            
            <div className={getTableContainerClass('trades', 'max-h-[800px] overflow-y-auto relative scrollbar-thin')}>
                {renderExpandedTableHeader('trades', '交易记录流水表', `当前显示 ${displayTrades.length} 笔流水，原页面筛选与排序同步生效。`)}
                <table className="min-w-full text-xs text-left">
                    <thead className="text-gray-500 font-medium bg-gray-50">
                        <tr>
                            <Th label="交易日期" sortKey="date" filterKey="date" currentSort={tradeSort} onSort={toggleTradeSort} currentFilter={tradeFilters} onFilter={updateTradeFilter} width="100px" />
                            <Th label="账户" sortKey="account" filterKey="account" currentSort={tradeSort} onSort={toggleTradeSort} currentFilter={tradeFilters} onFilter={updateTradeFilter} align="center" width="100px"/>
                            <Th label="名称/代码" sortKey="code" filterKey="code" currentSort={tradeSort} onSort={toggleTradeSort} currentFilter={tradeFilters} onFilter={updateTradeFilter} width="160px" />
                            <Th label="币种" sortKey="market" filterKey="market" currentSort={tradeSort} onSort={toggleTradeSort} currentFilter={tradeFilters} onFilter={updateTradeFilter} align="center" width="70px" />
                            <Th label="交易类型" sortKey="source" filterKey="source" currentSort={tradeSort} onSort={toggleTradeSort} currentFilter={tradeFilters} onFilter={updateTradeFilter} align="center" width="120px" />
                            <Th label="方向" sortKey="direction" filterKey="direction" currentSort={tradeSort} onSort={toggleTradeSort} currentFilter={tradeFilters} onFilter={updateTradeFilter} align="center" width="80px" />
                            <Th label="数量" sortKey="quantity" filterKey={null} currentSort={tradeSort} onSort={toggleTradeSort} currentFilter={tradeFilters} onFilter={updateTradeFilter} align="right" width="100px"/>
                            <Th label={`均价(含费) ${isHKDView?'HKD':''}`} sortKey="price" filterKey={null} currentSort={tradeSort} onSort={toggleTradeSort} currentFilter={tradeFilters} onFilter={updateTradeFilter} align="right" width="120px" />
                            <Th label={`金额(含费) ${isHKDView?'HKD':''}`} sortKey="amount" filterKey={null} currentSort={tradeSort} onSort={toggleTradeSort} currentFilter={tradeFilters} onFilter={updateTradeFilter} align="right" width="120px" />
                            <Th label="最后修改日期" sortKey="updatedAt" filterKey={null} currentSort={tradeSort} onSort={toggleTradeSort} currentFilter={tradeFilters} onFilter={updateTradeFilter} align="center" width="140px"/>
                            <Th label="执行人" sortKey="executor" filterKey="executor" currentSort={tradeSort} onSort={toggleTradeSort} currentFilter={tradeFilters} onFilter={updateTradeFilter} align="center" />
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {displayTrades.length === 0 ? (
                            <tr><td colSpan={11} className="p-8 text-center text-gray-400">无匹配数据 或 已被基准日期过滤</td></tr>
                        ) : displayTrades.map(t => {
                            const rate = isHKDView ? (globalFxRates[t.market] || 1) : 1;
                            const displayCurrency = isHKDView ? 'HKD' : t.market;
                            return (
                                <tr key={t.id} className="hover:bg-blue-50/30 transition-colors">
                                    <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{t.date}</td>
                                    <td className="px-3 py-2 text-center text-gray-600 whitespace-nowrap">{t.account}</td>
                                    <td className="px-3 py-2 whitespace-nowrap">
                                        <div className="font-bold text-gray-800">{t.name}</div>
                                        <div className="text-[10px] text-gray-400 font-mono">{t.code}</div>
                                    </td>
                                    <td className="px-3 py-2 text-center font-mono text-gray-500">{displayCurrency}</td>
                                    <td className="px-3 py-2 text-center">
                                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${getSourceBadge(t.source)}`}>{t.source}</span>
                                    </td>
                                    <td className="px-3 py-2 text-center">
                                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${t.direction === 'BUY' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>{t.direction}</span>
                                    </td>
                                    <td className={`px-3 py-2 text-right font-mono font-bold ${t.quantity > 0 ? 'text-red-600' : 'text-green-600'}`}>
                                        {t.quantity > 0 ? '+' : ''}{t.quantity.toLocaleString()}
                                    </td>
                                    <td className="px-3 py-2 text-right font-mono text-gray-600">{(t.price * rate).toFixed(4)}</td>
                                    <td className={`px-3 py-2 text-right font-mono font-medium ${t.amount > 0 ? 'text-red-600' : 'text-green-600'}`}>
                                        {t.amount > 0 ? '+' : ''}{formatMoney(t.amount * rate)}
                                    </td>
                                    <td className="px-3 py-2 text-center text-gray-400 text-[10px] whitespace-nowrap">{formatTime(t.updatedAt)}</td>
                                    <td className="px-3 py-2 text-center text-gray-500 text-[10px]">{t.executor}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
            
            <div className="bg-blue-50 border-t border-blue-100 p-5">
                <div className="flex justify-between items-center mb-3">
                    <h3 className="font-bold text-blue-800 text-sm">资金净买入统计表</h3>
                    <button 
                        onClick={() => setIsHKDView(!isHKDView)}
                        disabled={isFetchingRealTime}
                        className={`text-xs font-bold px-3 py-1.5 rounded transition-colors border ${isHKDView ? 'bg-blue-600 text-white border-blue-600 shadow-inner' : 'bg-white text-blue-700 border-blue-200 hover:bg-blue-100 shadow-sm'}`}
                    >
                        {isFetchingRealTime && <Loader2 size={12} className="animate-spin inline mr-1" />}
                        {isHKDView ? '恢复原始币种' : 'TO HKD (一键折算)'}
                    </button>
                </div>
                <div className="overflow-x-auto rounded border border-blue-200 bg-white">
                    <table className="min-w-full text-xs text-right">
                        <thead className="bg-blue-100/50 text-blue-900 font-medium">
                            <tr>
                                <th className="px-3 py-2 text-center border-b border-r border-blue-100 bg-blue-50/50">币种 \ 账户</th>
                                {netBuyStats.accounts.map(acc => (
                                    <th key={acc} className="px-3 py-2 border-b border-blue-100">{acc}</th>
                                ))}
                                <th className="px-3 py-2 border-b border-l border-blue-100 bg-blue-50/50">SUM {isHKDView ? '(HKD)' : '(原币种)'}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-blue-50">
                            {netBuyStats.markets.map(mkt => {
                                const rate = isHKDView ? (globalFxRates[mkt] || 1) : 1;
                                let rowSum = 0;
                                return (
                                    <tr key={mkt} className="hover:bg-blue-50/30">
                                        <td className="px-3 py-2 text-center font-bold text-gray-700 border-r border-blue-50 bg-blue-50/20">{mkt}</td>
                                        {netBuyStats.accounts.map(acc => {
                                            const rawVal = netBuyStats.rawMatrix[mkt][acc] || 0;
                                            const displayVal = rawVal * rate;
                                            rowSum += displayVal;
                                            return (
                                                <td key={acc} className={`px-3 py-2 font-mono ${displayVal > 0 ? 'text-red-600' : displayVal < 0 ? 'text-green-600' : 'text-gray-400'}`}>
                                                    {displayVal > 0 ? '+' : ''}{displayVal === 0 ? '-' : formatMoney(displayVal, isHKDView)}
                                                </td>
                                            );
                                        })}
                                        <td className={`px-3 py-2 font-mono font-bold border-l border-blue-50 bg-blue-50/20 ${rowSum > 0 ? 'text-red-600' : rowSum < 0 ? 'text-green-600' : 'text-gray-500'}`}>
                                            {rowSum > 0 ? '+' : ''}{rowSum === 0 ? '-' : formatMoney(rowSum, isHKDView)}
                                        </td>
                                    </tr>
                                );
                            })}
                            {netBuyStats.markets.length === 0 && (
                                <tr><td colSpan={netBuyStats.accounts.length + 2} className="px-3 py-4 text-center text-gray-400">暂无数据</td></tr>
                            )}
                        </tbody>
                        {netBuyStats.markets.length > 0 && (
                            <tfoot className="bg-blue-100 text-blue-900 border-t-2 border-blue-200 shadow-inner">
                                <tr>
                                    <td className="px-3 py-3 text-center font-bold border-r border-blue-200">SUM (HKD)</td>
                                    {netBuyStats.accounts.map(acc => {
                                        let colSumHKD = 0;
                                        netBuyStats.markets.forEach(mkt => {
                                            const rawVal = netBuyStats.rawMatrix[mkt][acc] || 0;
                                            colSumHKD += rawVal * (globalFxRates[mkt] || 1);
                                        });
                                        return (
                                            <td key={acc} className={`px-3 py-3 font-mono font-bold ${colSumHKD > 0 ? 'text-red-600' : colSumHKD < 0 ? 'text-green-600' : 'text-gray-600'}`}>
                                                {colSumHKD > 0 ? '+' : ''}{colSumHKD === 0 ? '-' : formatMoney(colSumHKD, true)}
                                            </td>
                                        );
                                    })}
                                    <td className={`px-3 py-3 font-mono font-bold text-sm border-l border-blue-200 ${totalNetBuyHKD > 0 ? 'text-red-600' : totalNetBuyHKD < 0 ? 'text-green-600' : 'text-gray-600'}`}>
                                        {totalNetBuyHKD > 0 ? '+' : ''}{formatMoney(totalNetBuyHKD, true)} HKD
                                    </td>
                                </tr>
                            </tfoot>
                        )}
                    </table>
                </div>

                {/* 资金统计底部功能区 */}
                <div className="mt-4 flex items-center justify-between bg-white px-4 py-3 rounded border border-blue-100 shadow-sm">
                    <div className="flex items-center gap-4 text-xs text-gray-500">
                        <span className="flex items-center gap-1.5"><Clock size={14} className="text-blue-500" /> 最后入库时间: <span className="font-mono font-medium text-gray-700">{lastCashSavedTime}</span></span>
                        <span className="text-[10px] bg-blue-50 text-blue-600 px-2 py-0.5 rounded border border-blue-100">
                            {(isHKDView || hasActiveFilters) ? '※手动入库已在折算或筛选视图下暂停' : '※点击手动刷新后更新，点击按钮才入库'}
                        </span>
                    </div>
                    <div className="flex items-center gap-3">
                        <button onClick={() => fetchMarketData()} disabled={isFetchingRealTime} className="flex items-center gap-2 px-4 py-2 bg-white border border-blue-600 text-blue-600 hover:bg-blue-50 text-xs font-bold rounded shadow-sm transition-colors disabled:opacity-50">
                            <RefreshCw size={14} className={isFetchingRealTime ? 'animate-spin' : ''} /> 手动刷新
                        </button>
                        {(!isHKDView && !hasActiveFilters) && (
                            <button onClick={handleSaveCashStats} disabled={isSavingCash} className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded shadow-sm transition-colors disabled:opacity-50">
                                {isSavingCash ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} 手动保存入库
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>

        {/* === 模块 5：初始股票持仓 (期初建账底座) === */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-200 flex justify-between items-center bg-gray-50">
                <h2 className="text-base font-bold text-gray-800 flex items-center gap-2">
                    <Database size={18} className="text-purple-500" />
                    初始股票持仓 (期初建账底座)
                </h2>
                <div className="flex items-center gap-3">
                    <label className="text-sm font-medium text-gray-600">全局基准日期:</label>
                    <input 
                        type="date" 
                        value={baseDate} 
                        onChange={(e) => handleUpdateBaseDate(e.target.value)}
                        className="p-1.5 border border-purple-200 rounded text-sm focus:ring-2 focus:ring-purple-500 outline-none shadow-sm"
                    />
                    <button
                        onClick={() => {
                            const mkts = new Set(['USD', 'CNY', 'JPY']); 
                            initialHoldings.forEach(h => { if(h.market && h.market !== 'HKD') mkts.add(h.market); });
                            const drafts: Record<string, string> = {};
                            mkts.forEach(m => { drafts[m] = baseFxRates[m]?.toString() || ''; });
                            setDraftBaseFx(drafts);
                            setShowBaseFxModal(true);
                        }}
                        className="px-3 py-1.5 bg-purple-100 text-purple-700 hover:bg-purple-200 rounded text-xs font-bold transition-colors border border-purple-200 shadow-sm flex items-center gap-1"
                    >
                        <Settings2 size={14}/> 设置建账汇率
                    </button>
                    <button
                        onClick={() => {
                            setPasteText('');
                            setParsedPasteData([]);
                            setShowPasteModal(true);
                        }}
                        className="px-3 py-1.5 bg-blue-100 text-blue-700 hover:bg-blue-200 rounded text-xs font-bold transition-colors border border-blue-200 shadow-sm flex items-center gap-1"
                    >
                        <ClipboardList size={14}/> 批量粘贴导入
                    </button>
                </div>
            </div>
            
            <div className="overflow-x-auto overflow-y-auto max-h-[500px] relative">
                <table className="min-w-full text-xs text-left">
                    <thead className="bg-gray-50 text-gray-500 font-medium border-b border-gray-200 sticky top-0 z-20 shadow-sm">
                        <tr>
                            <th className="px-4 py-3 whitespace-nowrap align-top">
                                <div className="flex flex-col gap-1">
                                    <span>代码 (Code)</span>
                                    <div className="relative">
                                        <input 
                                            type="text" 
                                            placeholder="模糊筛选..." 
                                            value={initCodeFilter}
                                            onChange={(e) => setInitCodeFilter(e.target.value)}
                                            className="w-full p-1 border border-gray-300 rounded text-[10px] font-normal outline-none focus:ring-1 focus:ring-purple-500 text-gray-700 bg-white"
                                        />
                                        <Search size={10} className="absolute top-1/2 right-2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                                    </div>
                                </div>
                            </th>
                            <th className="px-4 py-3 text-center whitespace-nowrap align-top">币种</th>
                            <th className="px-4 py-3 text-center whitespace-nowrap align-top">账户</th>
                            <th className="px-4 py-3 text-right whitespace-nowrap align-top">期初数量</th>
                            <th className="px-4 py-3 text-right whitespace-nowrap align-top">期初成本均价</th>
                            <th className="px-4 py-3 text-right whitespace-nowrap align-top">期初总投入金额</th>
                            <th className="px-4 py-3 text-center whitespace-nowrap align-top">操作</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {displayInitialHoldings.map(h => {
                            const rate = isHKDView ? (baseFxRates[h.market] || globalFxRates[h.market] || 1) : 1;
                            const amt = h.quantity * h.costPrice * rate;
                            return (
                            <tr key={h.id} className={`transition-colors ${editingInitId === h.id ? 'bg-blue-50 border-l-4 border-blue-500' : 'hover:bg-purple-50/30'}`}>
                                <td className="px-4 py-2 font-bold text-gray-800">{h.code}</td>
                                <td className="px-4 py-2 text-center font-mono text-gray-500">{h.market}</td>
                                <td className="px-4 py-2 text-center text-gray-600">{h.account}</td>
                                <td className="px-4 py-2 text-right font-mono text-gray-800">{h.quantity.toLocaleString()}</td>
                                <td className="px-4 py-2 text-right font-mono text-gray-600">{h.costPrice.toFixed(4)}</td>
                                <td className="px-4 py-2 text-right font-mono font-medium">{formatMoney(amt, isHKDView)}</td>
                                <td className="px-4 py-2 text-center">
                                    <div className="flex justify-center items-center gap-1">
                                        <button onClick={() => handleEditInitialClick(h)} className="text-gray-400 hover:text-blue-600 p-1.5 rounded hover:bg-blue-100 transition-colors" title="修改该条记录">
                                            <Edit2 size={16} />
                                        </button>
                                        <button onClick={() => handleDeleteInitialHolding(h.id)} className="text-gray-400 hover:text-red-600 p-1.5 rounded hover:bg-red-100 transition-colors" title="删除该条记录">
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        )})}
                        
                        {/* 录入/编辑空行 */}
                        <tr className={`${editingInitId ? 'bg-blue-50 border-t-2 border-blue-200 shadow-inner' : 'bg-purple-50 border-t-2 border-purple-100'} sticky bottom-0 z-10 shadow-[0_-1px_2px_rgba(0,0,0,0.05)]`}>
                            <td className="px-4 py-2">
                                <input type="text" placeholder="如 AAPL" value={newInit.code} onChange={e => setNewInit({...newInit, code: e.target.value.toUpperCase().trim()})} className={`w-full p-1.5 border rounded text-xs outline-none focus:ring-1 ${editingInitId ? 'border-blue-300 focus:ring-blue-500' : 'border-purple-200 focus:ring-purple-400'}`} />
                            </td>
                            <td className="px-4 py-2">
                                <select value={newInit.market} onChange={e => setNewInit({...newInit, market: e.target.value})} className={`w-full p-1.5 border rounded text-xs outline-none focus:ring-1 bg-white ${editingInitId ? 'border-blue-300 focus:ring-blue-500' : 'border-purple-200 focus:ring-purple-400'}`}>
                                    <option value="USD">USD</option>
                                    <option value="CNY">CNY</option>
                                    <option value="HKD">HKD</option>
                                    <option value="JPY">JPY</option>
                                </select>
                            </td>
                            <td className="px-4 py-2">
                                <input type="text" placeholder="账户名称" value={newInit.account} onChange={e => setNewInit({...newInit, account: e.target.value.trim()})} className={`w-full p-1.5 border rounded text-xs outline-none focus:ring-1 ${editingInitId ? 'border-blue-300 focus:ring-blue-500' : 'border-purple-200 focus:ring-purple-400'}`} />
                            </td>
                            <td className="px-4 py-2">
                                <input type="number" min="0" placeholder="数量" value={newInit.quantity === 0 ? '' : newInit.quantity} onChange={e => setNewInit({...newInit, quantity: parseFloat(e.target.value)||0})} className={`w-full p-1.5 border rounded text-xs outline-none text-right focus:ring-1 ${editingInitId ? 'border-blue-300 focus:ring-blue-500' : 'border-purple-200 focus:ring-purple-400'}`} />
                            </td>
                            <td className="px-4 py-2">
                                <input type="number" min="0" step="0.0001" placeholder="成本均价" value={newInit.costPrice === 0 ? '' : newInit.costPrice} onChange={e => setNewInit({...newInit, costPrice: parseFloat(e.target.value)||0})} className={`w-full p-1.5 border rounded text-xs outline-none text-right focus:ring-1 ${editingInitId ? 'border-blue-300 focus:ring-blue-500' : 'border-purple-200 focus:ring-purple-400'}`} />
                            </td>
                            <td className={`px-4 py-2 text-right text-xs font-medium ${editingInitId ? 'text-blue-500' : 'text-purple-400'}`}>自动计算...</td>
                            <td className="px-4 py-2 text-center">
                                <div className="flex flex-col gap-1 items-center justify-center">
                                    <button onClick={handleSaveInitialHolding} disabled={submittingInit} className={`text-white px-3 py-1.5 rounded shadow-sm flex items-center justify-center gap-1 w-full transition-colors ${editingInitId ? 'bg-blue-600 hover:bg-blue-700' : 'bg-purple-600 hover:bg-purple-700'}`}>
                                        {submittingInit ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} {editingInitId ? '确认修改' : '保存'}
                                    </button>
                                    {editingInitId && (
                                        <button onClick={handleCancelEditInit} className="text-gray-600 bg-gray-200 hover:bg-gray-300 px-3 py-1 rounded text-xs w-full transition-colors">
                                            取消
                                        </button>
                                    )}
                                </div>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>

            {/* 期初成本二维统计表 */}
            <div className="bg-purple-50 border-t border-purple-100 p-5">
                <div className="flex justify-between items-center mb-3">
                    <h3 className="font-bold text-purple-800 text-sm">期初投入统计表</h3>
                    <button 
                        onClick={() => setIsHKDView(!isHKDView)}
                        disabled={isFetchingRealTime}
                        className={`text-xs font-bold px-3 py-1.5 rounded transition-colors border ${isHKDView ? 'bg-purple-600 text-white border-purple-600 shadow-inner' : 'bg-white text-purple-700 border-purple-200 hover:bg-purple-100 shadow-sm'}`}
                    >
                        {isFetchingRealTime && <Loader2 size={12} className="animate-spin inline mr-1" />}
                        {isHKDView ? '恢复原始币种' : 'TO HKD (一键折算)'}
                    </button>
                </div>
                <div className="overflow-x-auto rounded border border-purple-200 bg-white">
                    <table className="min-w-full text-xs text-right">
                        <thead className="bg-purple-100/50 text-purple-900 font-medium">
                            <tr>
                                <th className="px-3 py-2 text-center border-b border-r border-purple-100 bg-purple-50/50">币种 \ 账户</th>
                                {initialStats.accounts.map(acc => (
                                    <th key={acc} className="px-3 py-2 border-b border-purple-100">{acc}</th>
                                ))}
                                <th className="px-3 py-2 border-b border-l border-purple-100 bg-purple-50/50">SUM {isHKDView ? '(HKD)' : '(原币种)'}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-purple-50">
                            {initialStats.markets.map(mkt => {
                                const rate = isHKDView ? (baseFxRates[mkt] || globalFxRates[mkt] || 1) : 1;
                                let rowSum = 0;
                                return (
                                    <tr key={mkt} className="hover:bg-purple-50/30">
                                        <td className="px-3 py-2 text-center font-bold text-gray-700 border-r border-purple-50 bg-purple-50/20">{mkt}</td>
                                        {initialStats.accounts.map(acc => {
                                            const rawVal = initialStats.rawMatrix[mkt][acc] || 0;
                                            const displayVal = rawVal * rate;
                                            rowSum += displayVal;
                                            return (
                                                <td key={acc} className="px-3 py-2 font-mono text-gray-700">
                                                    {displayVal === 0 ? '-' : formatMoney(displayVal, isHKDView)}
                                                </td>
                                            );
                                        })}
                                        <td className="px-3 py-2 font-mono font-bold text-purple-900 border-l border-purple-50 bg-purple-50/20">
                                            {rowSum === 0 ? '-' : formatMoney(rowSum, isHKDView)}
                                        </td>
                                    </tr>
                                );
                            })}
                            {initialStats.markets.length === 0 && (
                                <tr><td colSpan={initialStats.accounts.length + 2} className="px-3 py-4 text-center text-gray-400">暂无期初数据</td></tr>
                            )}
                        </tbody>
                        {initialStats.markets.length > 0 && (
                            <tfoot className="bg-purple-100 text-purple-900 border-t-2 border-purple-200 shadow-inner">
                                <tr>
                                    <td className="px-3 py-3 text-center font-bold border-r border-purple-200">SUM (HKD)</td>
                                    {initialStats.accounts.map(acc => {
                                        let colSumHKD = 0;
                                        initialStats.markets.forEach(mkt => {
                                            const rawVal = initialStats.rawMatrix[mkt][acc] || 0;
                                            colSumHKD += rawVal * (baseFxRates[mkt] || globalFxRates[mkt] || 1);
                                        });
                                        return (
                                            <td key={acc} className="px-3 py-3 font-mono font-bold text-purple-900">
                                                {colSumHKD === 0 ? '-' : formatMoney(colSumHKD, true)}
                                            </td>
                                        );
                                    })}
                                    <td className="px-3 py-3 font-mono font-bold text-sm border-l border-purple-200 text-purple-900">
                                        {formatMoney(
                                            initialStats.markets.reduce((sum, mkt) => {
                                                let rSum = 0;
                                                initialStats.accounts.forEach(a => rSum += initialStats.rawMatrix[mkt][a] || 0);
                                                return sum + rSum * (baseFxRates[mkt] || globalFxRates[mkt] || 1);
                                            }, 0), true
                                        )} HKD
                                    </td>
                                </tr>
                            </tfoot>
                        )}
                    </table>
                </div>

                {/* 期初统计底部功能区 */}
                <div className="mt-4 flex items-center justify-between bg-white px-4 py-3 rounded border border-purple-100 shadow-sm">
                    <div className="flex items-center gap-4 text-xs text-gray-500">
                        <span className="flex items-center gap-1.5"><Clock size={14} className="text-purple-500" /> 最后入库时间: <span className="font-mono font-medium text-gray-700">{lastInitialSavedTime}</span></span>
                        <span className="text-[10px] bg-purple-50 text-purple-600 px-2 py-0.5 rounded border border-purple-100">
                            {(isHKDView || hasActiveFilters) ? '※手动入库已在折算或筛选视图下暂停，保护原始数据' : '※点击手动刷新后更新，点击按钮才入库'}
                        </span>
                    </div>
                    <div className="flex items-center gap-3">
                        <button onClick={() => fetchMarketData()} disabled={isFetchingRealTime} className="flex items-center gap-2 px-4 py-2 bg-white border border-purple-600 text-purple-600 hover:bg-purple-50 text-xs font-bold rounded shadow-sm transition-colors disabled:opacity-50">
                            <RefreshCw size={14} className={isFetchingRealTime ? 'animate-spin' : ''} /> 手动刷新
                        </button>
                        {(!isHKDView && !hasActiveFilters) && (
                            <button onClick={handleSaveInitialStats} disabled={isSavingInitial} className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold rounded shadow-sm transition-colors disabled:opacity-50">
                                {isSavingInitial ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} 手动保存入库
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>

        {/* === 模块 6：后台库管理模块 === */}
        <div className="bg-white shadow rounded-lg p-6 border border-gray-200 mt-8">
            <div className="flex justify-between items-center mb-4">
                <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                    <FileJson size={20} className="text-purple-600"/> 【后台库管理模块】
                </h2>
                <button onClick={() => fetchDbRecords(activeDbTab)} className="text-sm text-purple-600 hover:text-purple-800 flex items-center gap-1">
                    <RefreshCw size={14}/> 刷新数据
                </button>
            </div>
            <div className="flex gap-2 mb-4 border-b pb-2 overflow-x-auto">
                {[
                    'sip_spot_trade',
                    'sip_holding_spot_start',
                    'sip_holding_fcn_output_get-stock',
                    'sip_holding_dqaq_output_get-stock',
                    'sip_holding_option_output_get-stock',
                    'sip_holding_stock_mktvalue',
                    'sip_holding_stock_pl',
                    'sip_holding_cash_stock',
                    'sip_exposure_spot'
                ].map(tab => (
                    <button 
                        key={tab} 
                        onClick={() => setActiveDbTab(tab)} 
                        className={`px-3 py-1.5 text-xs font-bold rounded whitespace-nowrap transition-colors ${activeDbTab === tab ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                    >
                        {tab.replace('sip_', '').replace(/_/g, '/')}
                    </button>
                ))}
            </div>
            {loadingDb ? (
                <div className="py-10 text-center"><Loader2 className="animate-spin mx-auto text-purple-600 mb-2" size={30}/></div>
            ) : dbRecords.length === 0 ? (
                <div className="py-10 text-center text-gray-400 bg-gray-50 rounded border border-dashed">该库中暂无数据</div>
            ) : (
                <div className="overflow-x-auto border rounded">
                    <table className="min-w-full text-sm text-left divide-y divide-gray-200">
                        <thead className="bg-gray-50 text-gray-500">
                            <tr>
                                <th className="px-3 py-2 whitespace-nowrap">ID / 确切修改时间</th>
                                <th className="px-3 py-2">内容摘要 / 绑定信息</th>
                                <th className="px-3 py-2 text-center whitespace-nowrap">操作</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {dbRecords.map(r => (
                                <tr key={r.id} className="hover:bg-gray-50 transition-colors">
                                    <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap font-mono">
                                        <div className="font-bold text-gray-700">{r.id.substring(0,8)}...</div>
                                        <div className="text-blue-600">
                                            {formatTime(r.updatedAt) || formatTime(r.createdAt) || 'N/A'}
                                        </div>
                                    </td>
                                    <td className="px-3 py-2 text-xs">
                                        <div className="max-w-md xl:max-w-2xl truncate text-gray-700 bg-blue-50/50 px-2 py-1.5 rounded border border-blue-100 font-medium">
                                            {getRecordSummary(r, activeDbTab)}
                                        </div>
                                    </td>
                                    <td className="px-3 py-2 text-center whitespace-nowrap">
                                        <button onClick={() => setEditRecordModal({show: true, record: r, rawJson: JSON.stringify(r, null, 4)})} className="text-blue-600 hover:text-blue-800 mx-1 p-1 hover:bg-blue-50 rounded transition-colors" title="修改 JSON"><FileJson size={16}/></button>
                                        <button onClick={() => handleDeleteRecord(r.id)} className="text-red-600 hover:text-red-800 mx-1 p-1 hover:bg-red-50 rounded transition-colors" title="永久删除"><Trash2 size={16}/></button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>

        {/* --- 当前持仓统计表 Excel 复制弹窗 --- */}
        {showHoldingExcelModal && (
            <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
                <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-6xl flex flex-col h-[78vh]">
                    <div className="flex justify-between items-start gap-4 mb-4 border-b pb-4">
                        <div>
                            <h3 className="font-bold text-lg flex items-center gap-2 text-emerald-700">
                                <ClipboardList size={20} /> 当前持仓统计表 - 复制到 Excel
                            </h3>
                            <p className="mt-1 text-xs text-gray-500">
                                当前账户：{selectedHoldingAccount || '全部账户'}；当前显示 {displayHoldings.length} 只标的；复制内容：{holdingTrialEnabled ? '增减仓试算表' : '当前持仓表'}。内容为制表符分隔，复制后可直接粘贴到 Excel。
                            </p>
                        </div>
                        <button onClick={() => setShowHoldingExcelModal(false)} className="text-gray-400 hover:text-gray-600"><X size={20}/></button>
                    </div>
                    <textarea
                        readOnly
                        value={holdingExcelText}
                        className="flex-1 w-full resize-none rounded-lg border border-emerald-100 bg-emerald-50/40 p-3 font-mono text-xs text-gray-800 outline-none focus:ring-2 focus:ring-emerald-500"
                        onFocus={(e) => e.currentTarget.select()}
                    />
                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
                        <div className="text-xs text-gray-500">
                            提示：如果只想复制某个账户，请先选择账户；如果要复制试算结果，请先在弹窗里开启“增减仓试算”并填写比例。
                        </div>
                        <div className="flex items-center gap-3">
                            <button
                                onClick={() => setShowHoldingExcelModal(false)}
                                className="px-5 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-md text-sm font-medium transition-colors"
                            >
                                关闭
                            </button>
                            <button
                                onClick={async () => {
                                    try {
                                        await navigator.clipboard.writeText(holdingExcelText);
                                        alert('已复制，可直接粘贴到 Excel。');
                                    } catch (error) {
                                        alert('自动复制失败，请手动选中文本复制。');
                                    }
                                }}
                                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-md text-sm font-bold flex items-center gap-2 transition-colors"
                            >
                                <ClipboardList size={16}/> 一键复制
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        )}

        {/* --- 汇率锁定弹窗 --- */}
        {showBaseFxModal && (
            <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
                <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm overflow-hidden">
                    <div className="px-5 py-4 border-b flex justify-between items-center bg-gray-50">
                        <h3 className="font-bold text-gray-800 flex items-center gap-2">
                            ⚙️ 设置期初建账汇率 (对 HKD)
                        </h3>
                        <button onClick={() => setShowBaseFxModal(false)} className="text-gray-400 hover:text-gray-600 transition-colors">
                            <X size={20}/>
                        </button>
                    </div>
                    <div className="p-5 space-y-4">
                        <p className="text-xs text-gray-500">锁定这些汇率后，期初投入的总成本(HKD)将永远固定，不会随每日市场汇率波动。</p>
                        <button
                            onClick={() => {
                                const drafts: Record<string, string> = {};
                                Object.keys(draftBaseFx).forEach(m => {
                                    drafts[m] = globalFxRates[m]?.toString() || draftBaseFx[m];
                                });
                                setDraftBaseFx(drafts);
                            }}
                            className="w-full py-2 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded text-xs font-bold transition-colors border border-blue-200"
                        >
                            ⬇️ 获取当前最新汇率填充
                        </button>
                        <div className="space-y-3">
                            {Object.keys(draftBaseFx).map(mkt => (
                                <div key={mkt} className="flex justify-between items-center">
                                    <span className="font-bold text-gray-700 font-mono w-16">{mkt}</span>
                                    <input
                                        type="number"
                                        step="0.0001"
                                        value={draftBaseFx[mkt]}
                                        onChange={(e) => setDraftBaseFx(prev => ({...prev, [mkt]: e.target.value}))}
                                        className="w-32 p-1.5 border rounded text-right text-sm font-mono outline-none focus:ring-1 focus:ring-purple-500"
                                        placeholder="如: 7.82"
                                    />
                                </div>
                            ))}
                        </div>
                    </div>
                    <div className="bg-gray-50 px-5 py-3 border-t border-gray-100 flex justify-end gap-3">
                        <button onClick={() => setShowBaseFxModal(false)} className="px-4 py-2 bg-gray-200 text-gray-700 text-sm font-bold rounded shadow-sm hover:bg-gray-300 transition-colors">
                            取消
                        </button>
                        <button onClick={async () => {
                            const parsed: Record<string, number> = {};
                            Object.entries(draftBaseFx).forEach(([k, v]) => {
                                const val = parseFloat(v);
                                if (!isNaN(val) && val > 0) parsed[k] = val;
                            });
                            await setDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'sip_holding_spot_start', '_global_config'), { baseFxRates: parsed }, { merge: true });
                            setShowBaseFxModal(false);
                            setBaseFxRates(parsed); 
                        }} className="px-4 py-2 bg-purple-600 text-white text-sm font-bold rounded shadow-sm hover:bg-purple-700 transition-colors">
                            保存锁定
                        </button>
                    </div>
                </div>
            </div>
        )}

        {/* --- 汇率详情弹窗 --- */}
        {showFxModal && (
            <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
                <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm overflow-hidden">
                    <div className="px-5 py-4 border-b flex justify-between items-center bg-gray-50">
                        <h3 className="font-bold text-gray-800 flex items-center gap-2">
                            <Info className="text-blue-500" size={18} /> 全局汇率 (对 HKD)
                        </h3>
                        <button onClick={() => setShowFxModal(false)} className="text-gray-400 hover:text-gray-600 transition-colors">
                            <X size={20}/>
                        </button>
                    </div>
                    <div className="p-5">
                        {Object.keys(globalFxRates).length === 0 ? (
                            <p className="text-sm text-gray-500 text-center py-4">暂无已缓存的汇率数据，请点击右上角的“更新行情”按钮。</p>
                        ) : (
                            <div className="space-y-3">
                                {Object.entries(globalFxRates).map(([currency, rate]) => (
                                    <div key={currency} className="flex justify-between items-center border-b border-gray-100 pb-2 last:border-0 last:pb-0">
                                        <span className="font-bold text-gray-700 font-mono">{currency}</span>
                                        <span className="text-gray-600 font-mono">{Number(rate).toFixed(4)}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                    <div className="bg-gray-50 px-5 py-3 border-t border-gray-100 flex justify-end">
                        <button onClick={() => setShowFxModal(false)} className="px-4 py-2 bg-blue-600 text-white text-sm font-bold rounded shadow-sm hover:bg-blue-700 transition-colors">
                            关闭
                        </button>
                    </div>
                </div>
            </div>
        )}

        {/* --- 批量导入粘贴弹窗 --- */}
        {showPasteModal && (
            <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
                <div className="bg-white rounded-xl shadow-2xl w-full max-w-7xl max-h-[95vh] flex flex-col overflow-hidden">
                    <div className="px-6 py-4 border-b flex justify-between items-center bg-gray-50 flex-shrink-0">
                        <div>
                            <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                                <ClipboardList className="text-blue-600" size={20} /> 
                                批量测算与导入 (从 Excel 粘贴)
                            </h3>
                            <p className="text-xs text-gray-500 mt-1">系统将自动为每条记录结算财务金额，并实时计算含费总额与最终成本价。</p>
                        </div>
                        <button onClick={() => setShowPasteModal(false)} className="text-gray-400 hover:text-gray-600 transition-colors">
                            <X size={20}/>
                        </button>
                    </div>
                    
                    <div className="flex-1 overflow-y-auto p-6 space-y-6 flex flex-col lg:flex-row gap-6 relative">
                        {/* 左侧：粘贴区 */}
                        <div className="flex-1 flex flex-col max-w-[280px]">
                            <label className="block text-sm font-bold text-gray-700 mb-2">
                                1. 请在下方粘贴数据 <span className="text-xs font-normal text-gray-500">(严格按 5 列对齐)</span>
                            </label>
                            <div className="bg-blue-50 border border-blue-200 text-blue-800 text-[10px] p-3 rounded-lg mb-3">
                                <span className="font-mono mt-1 block">标的代码 | 结算币种 | 账户名称 | 数量 | 成本均价</span>
                            </div>
                            <textarea 
                                className="flex-1 w-full border border-gray-300 rounded-lg p-3 text-[10px] font-mono focus:ring-2 focus:ring-blue-500 outline-none resize-none min-h-[300px] whitespace-pre bg-gray-50"
                                placeholder="在此处粘贴 Excel / Google Sheets 复制的数据..."
                                value={pasteText}
                                onChange={handlePasteTextChange}
                                disabled={submittingInit}
                            />
                        </div>
                        {/* 右侧：预览区 */}
                        <div className="flex-[3] flex flex-col">
                            <label className="block text-sm font-bold text-gray-700 mb-2 flex justify-between items-end">
                                <span>2. 数据预览区</span>
                                <span className="text-xs font-normal text-gray-500">共识别 {parsedPasteData.length} 笔</span>
                            </label>
                            <div className="flex-1 border border-gray-200 rounded-lg overflow-x-auto overflow-y-auto bg-gray-50 max-h-[600px] relative scrollbar-thin">
                                {parsedPasteData.length === 0 ? (
                                    <div className="flex items-center justify-center h-full text-gray-400 text-sm py-10">等待粘贴数据...</div>
                                ) : (
                                    <table className="min-w-full text-xs text-left whitespace-nowrap">
                                        <thead className="bg-gray-100 text-gray-600 sticky top-0 shadow-sm z-10 [&>tr>th]:bg-gray-100">
                                            <tr>
                                                <th className="px-2 py-2 font-medium">代码</th>
                                                <th className="px-2 py-2 font-medium text-center">市场</th>
                                                <th className="px-2 py-2 font-medium">账户</th>
                                                <th className="px-2 py-2 font-medium text-right">数量</th>
                                                <th className="px-2 py-2 font-medium text-right">成本均价</th>
                                                <th className="px-2 py-2 font-medium text-center">操作</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-200 bg-white">
                                            {parsedPasteData.map((item, idx) => (
                                                <tr key={idx} className="hover:bg-blue-50/30 transition-colors">
                                                    <td className="px-2 py-1.5 font-bold font-mono">{item.code}</td>
                                                    <td className="px-2 py-1.5 text-center font-mono text-gray-500">{item.market}</td>
                                                    <td className="px-2 py-1.5 text-gray-700">{item.account}</td>
                                                    <td className="px-2 py-1.5 text-right font-mono">{item.quantity}</td>
                                                    <td className="px-2 py-1.5 text-right font-mono">{item.costPrice}</td>
                                                    <td className="px-2 py-1.5 text-center align-middle">
                                                        <button onClick={() => {
                                                            const newData = [...parsedPasteData];
                                                            newData.splice(idx, 1);
                                                            setParsedPasteData(newData);
                                                        }} className="text-gray-400 hover:text-red-500 p-1.5 rounded hover:bg-red-50 transition-colors" title="移除此条">
                                                            <Trash2 size={16}/>
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                )}
                            </div>
                        </div>
                    </div>
                    <div className="bg-gray-50 px-6 py-4 border-t border-gray-200 flex justify-end gap-3 flex-shrink-0">
                        <button onClick={() => setShowPasteModal(false)} disabled={submittingInit} className="px-5 py-2.5 bg-gray-200 text-gray-700 text-sm font-bold rounded shadow-sm hover:bg-gray-300 transition-colors disabled:opacity-50">
                            取消
                        </button>
                        <button 
                            onClick={handleConfirmBulkPaste} 
                            disabled={parsedPasteData.length === 0 || submittingInit}
                            className="px-6 py-2.5 bg-blue-600 text-white text-sm font-bold rounded shadow-sm hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center gap-2"
                        >
                            {submittingInit ? <Loader2 size={16} className="animate-spin"/> : <Save size={16}/>}
                            确认全部入库
                        </button>
                    </div>
                </div>
            </div>
        )}

        {/* 修改 Raw JSON 弹窗 (精简为高阶模式) */}
        {editRecordModal && (
            <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
                <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-5xl flex flex-col h-[85vh]">
                    <div className="flex justify-between items-center mb-4 border-b pb-4">
                        <h3 className="font-bold text-lg flex items-center gap-2 text-purple-700">
                            <FileJson size={20}/> 进阶修改记录 - {editRecordModal.record?.id}
                        </h3>
                        <button onClick={() => setEditRecordModal(null)} className="text-gray-400 hover:text-gray-600"><X size={20}/></button>
                    </div>
                    <p className="text-xs text-gray-500 mb-2 border-l-2 border-orange-400 pl-2">
                        警告：直接修改 Raw JSON 属于高阶操作，请确保 JSON 格式合法且结构正确，否则可能会导致页面崩溃或逻辑错误。
                    </p>
                    <textarea 
                        className="flex-1 w-full border border-gray-300 rounded-md p-3 text-xs font-mono mb-4 focus:ring-2 focus:ring-purple-500 outline-none resize-none bg-gray-50" 
                        value={editRecordModal.rawJson} 
                        onChange={(e) => setEditRecordModal(prev => prev ? {...prev, rawJson: e.target.value} : null)} 
                    />
                    <div className="flex justify-end gap-3 pt-2 border-t">
                        <button onClick={() => setEditRecordModal(null)} className="px-5 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-md text-sm font-medium transition-colors">取消</button>
                        <button onClick={handleSaveRecordEdit} className="px-5 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-md text-sm font-bold flex items-center gap-2 transition-colors"><Save size={16}/> 保存强制覆盖</button>
                    </div>
                </div>
            </div>
        )}
    </div>
  );
}
