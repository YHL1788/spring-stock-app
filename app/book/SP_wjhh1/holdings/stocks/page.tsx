'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { 
  Building2, 
  ListOrdered,
  PieChart,
  BarChart as BarChartIcon,
  Loader2, 
  AlertCircle,
  RefreshCw,
  Search,
  Database,
  Save,
  Trash2,
  Info,
  X
} from 'lucide-react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  Cell
} from 'recharts';
import { collection, getDocs, query, onSnapshot, addDoc, deleteDoc, setDoc, doc } from 'firebase/firestore';
import { onAuthStateChanged, signInAnonymously, signInWithCustomToken } from 'firebase/auth';

import { db, auth, APP_ID } from '@/app/lib/stockService';
import { useStockPool } from '@/app/hooks/useStockPool';

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
  amount: number; // 含费金额
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
}

// --- 聚合后的持仓类型 ---
interface StockHolding {
  market: string;
  code: string;
  name: string;
  sector_level_1: string;
  sector_level_2: string;
  quantity: number;
  avgCost: number; // 加权均价 (期初底座 + 增量买入)
  totalCostHKD: number; // 总成本 (HKD)
  currentPrice: number; // 实时现价
  dailyChangePct: number; // 今日涨跌幅
  mktValHKD: number; // 现市值 (HKD)
  unrealizedPnlHKD: number; // 浮动盈亏 (HKD)
  realizedPnlHKD: number; // 已实现盈亏 (HKD)
  pnlRatio: number; // 盈亏比
  accounts: Record<string, number>; // 各账户持仓股数
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
  const [newInit, setNewInit] = useState({ code: '', market: 'HKD', account: '', quantity: 0, costPrice: 0 });
  const [submittingInit, setSubmittingInit] = useState(false);

  // --- 汇率锁定 State ---
  const [baseFxRates, setBaseFxRates] = useState<Record<string, number>>({});
  const [showBaseFxModal, setShowBaseFxModal] = useState(false);
  const [draftBaseFx, setDraftBaseFx] = useState<Record<string, string>>({});

  // 全局状态
  const [isHKDView, setIsHKDView] = useState(false);
  const [globalFxRates, setGlobalFxRates] = useState<Record<string, number>>({});
  const [realTimeQuotes, setRealTimeQuotes] = useState<Record<string, { price: number, changePercent: number }>>({});
  const [isFetchingRealTime, setIsFetchingRealTime] = useState(false);
  const [showFxModal, setShowFxModal] = useState(false);
  
  // 图表切换
  const [chartType, setChartType] = useState<'BEST' | 'WORST'>('BEST');

  // --- 排序与筛选 State ---
  const [tradeSort, setTradeSort] = useState<{key: string, dir: 'asc'|'desc'|null}>({key: 'date', dir: 'desc'});
  const [tradeFilters, setTradeFilters] = useState<Record<string, string>>({});
  const [holdingSort, setHoldingSort] = useState<{key: string, dir: 'asc'|'desc'|null}>({key: 'mktValHKD', dir: 'desc'});
  const [holdingFilters, setHoldingFilters] = useState<Record<string, string>>({});

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

  // --- 鉴权与数据抓取 (5个库：4个流水 + 1个期初底座) ---
  useEffect(() => {
    let unsubStart: (() => void) | undefined;

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
            // 1. 订阅：期初持仓底座库 (实时监听，方便编辑时立即反映)
            const qStart = query(collection(db, 'artifacts', APP_ID, 'public', 'data', 'sip_holding_spot_start'));
            unsubStart = onSnapshot(qStart, (snapshot) => {
                const starts: InitialHolding[] = [];
                let bDate = '';
                let bFx: Record<string, number> = {};
                snapshot.forEach(docSnap => {
                    if (docSnap.id === '_global_config') {
                        bDate = docSnap.data().baseDate || '';
                        bFx = docSnap.data().baseFxRates || {};
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

            // 2. 抓取：四个增量流水库的数据
            try {
               const spotSnap = await getDocs(query(collection(db, 'artifacts', APP_ID, 'public', 'data', 'spot_trades')));
               const fcnSnap = await getDocs(query(collection(db, 'artifacts', APP_ID, 'public', 'data', 'sip_holding_fcn_output_get-stock')));
               const dqaqSnap = await getDocs(query(collection(db, 'artifacts', APP_ID, 'public', 'data', 'sip_holding_dqaq_output_get-stock')));
               const optionSnap = await getDocs(query(collection(db, 'artifacts', APP_ID, 'public', 'data', 'sip_holding_option_output_get-stock')));

               let merged: UnifiedTrade[] = [];

               spotSnap.forEach(doc => {
                 const d = doc.data();
                 const direction = d.direction?.toUpperCase() || 'BUY';
                 const qty = Math.abs(Number(d.quantity));
                 merged.push({
                   id: doc.id, source: 'SPOT', date: d.date, account: d.account || '', 
                   market: mapMarket(d.market, 'HKD'),
                   code: d.code, name: d.name, direction,
                   quantity: direction === 'BUY' ? qty : -qty,
                   price: Number(d.avg_price_incl_fee || d.price_excl_fee || 0),
                   amount: Number(d.amount_incl_fee || d.amount_excl_fee || 0), fee: Number(d.fee || 0),
                   updatedAt: getTime(d.createdAt), executor: d.executor || ''
                 });
               });

               fcnSnap.forEach(doc => {
                 const d = doc.data();
                 const direction = d.direction?.toUpperCase() || 'BUY';
                 const qty = Math.abs(Number(d.quantity));
                 merged.push({
                   id: doc.id, source: 'FCN', date: d.date, account: d.account || '', 
                   market: mapMarket(d.market, 'HKD'),
                   code: d.stockCode, name: d.stockName, direction,
                   quantity: direction === 'BUY' ? qty : -qty,
                   price: Number(d.priceWithFee || d.priceNoFee || 0),
                   amount: Number(d.amountWithFee || d.amountNoFee || 0), fee: Number(d.fee || 0),
                   updatedAt: getTime(d.createdAt), executor: d.executor || ''
                 });
               });

               dqaqSnap.forEach(doc => {
                 const d = doc.data();
                 const direction = d.direction?.toUpperCase() || 'BUY';
                 const qty = Math.abs(Number(d.quantity));
                 merged.push({
                   id: doc.id, source: 'DQ/AQ', date: d.date, account: d.account || '', 
                   market: mapMarket(d.market, 'USD'),
                   code: d.stockCode, name: d.stockName, direction,
                   quantity: direction === 'BUY' ? qty : -qty,
                   price: Number(d.priceNoFee || 0), // 假设 DQ/AQ 无费
                   amount: Number(d.amountNoFee || 0), fee: Number(d.fee || 0),
                   updatedAt: getTime(d.createdAt), executor: d.executor || ''
                 });
               });

               optionSnap.forEach(doc => {
                 const d = doc.data();
                 const direction = d.direction?.toUpperCase() || 'SELL';
                 const qty = Math.abs(Number(d.quantity));
                 const sourceType = (d.type || '').toLowerCase().includes('put') ? 'OPTION_PUT' : 'OPTION_CALL';
                 merged.push({
                   id: doc.id, source: sourceType as any, date: d.date, account: d.account || '', 
                   market: mapMarket(d.market, 'USD'),
                   code: d.stockCode, name: d.stockName, direction,
                   quantity: direction === 'BUY' ? qty : -qty,
                   price: Number(d.priceNoFee || 0), 
                   amount: Math.abs(Number(d.amountNoFee || 0)), fee: Number(d.fee || 0),
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
    };
  }, []);

  // --- 基于全局“基准日期”过滤有效的增量流水 ---
  const activeTrades = useMemo(() => {
      // 核心时间截断：如果设定了基准日期，严格过滤掉该日期（含）之前的流水，只取增量
      return allTrades.filter(t => !baseDate || t.date > baseDate);
  }, [allTrades, baseDate]);

  // --- API 调用：获取汇率与实时行情 ---
  const fetchMarketData = async () => {
    if (activeTrades.length === 0 && initialHoldings.length === 0) return;
    setIsFetchingRealTime(true);
    
    try {
      // 1. 收集所有需要的标准币种和代码 (结合底座和流水)
      const markets = new Set<string>();
      const symbols = new Set<string>();
      
      const collect = (code: string, market: string) => {
          if (market && market !== 'HKD') {
              markets.add(market);
          }
          if (code) symbols.add(code);
      };

      activeTrades.forEach(t => collect(t.code, t.market));
      initialHoldings.forEach(h => collect(h.code, h.market));

      // 2. 并发抓取标准币种汇率
      const newRates: Record<string, number> = { 'HKD': 1.0 };
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
      setGlobalFxRates(newRates);

      // 3. 并发抓取实时行情 (直接读取 API 返回的 changePercent)
      const newQuotes: Record<string, { price: number, changePercent: number }> = {};
      
      await Promise.all(Array.from(symbols).map(async (symbol) => {
           try {
              const res = await fetch(`/api/quote?symbol=${symbol}`);
              if (res.ok) {
                  const data = await res.json();
                  const price = data.regularMarketPrice || data.price || data.close;
                  const rawChangePct = data.changePercent ?? data.regularMarketChangePercent ?? 0;
                  if (price) {
                      newQuotes[symbol] = { price, changePercent: rawChangePct / 100 };
                  }
              }
           } catch(e) {}
      }));
      setRealTimeQuotes(newQuotes);

    } catch (e) {
        console.error("Market data fetch error", e);
    } finally {
        setIsFetchingRealTime(false);
    }
  };

  useEffect(() => {
    if (activeTrades.length > 0 || initialHoldings.length > 0) {
        fetchMarketData();
    }
  }, [activeTrades, initialHoldings]);

  // --- 核心计算 (期初底座 + 先入先出增量) ---
  const calculatedHoldings = useMemo(() => {
      const holdingsMap: Record<string, StockHolding> = {};

      // 步骤 1：铺设“期初底座”
      initialHoldings.forEach(init => {
          const key = init.code;
          if (!holdingsMap[key]) {
              const poolInfo = stockPool.find(s => s.symbol === key) || { sector_level_1: '未知', sector_level_2: '未知', name: key };
              holdingsMap[key] = {
                  market: init.market,
                  code: key,
                  name: poolInfo.name || key,
                  sector_level_1: poolInfo.sector_level_1,
                  sector_level_2: poolInfo.sector_level_2,
                  quantity: 0,
                  avgCost: 0,
                  totalCostHKD: 0,
                  currentPrice: 0,
                  dailyChangePct: 0,
                  mktValHKD: 0,
                  unrealizedPnlHKD: 0,
                  realizedPnlHKD: 0,
                  pnlRatio: 0,
                  accounts: {}
              };
          }
          const h = holdingsMap[key];
          
          if (!h.accounts[init.account]) h.accounts[init.account] = 0;
          h.accounts[init.account] += init.quantity;

          // 合并期初的均价与数量
          const currentTotalCost = h.quantity * h.avgCost;
          const addedCost = init.quantity * init.costPrice;
          h.quantity += init.quantity;
          h.avgCost = h.quantity > 0 ? (currentTotalCost + addedCost) / h.quantity : 0;
      });

      // 步骤 2：按时间正序处理增量流水
      const chronological = [...activeTrades].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

      chronological.forEach(t => {
          const key = t.code;
          if (!holdingsMap[key]) {
              const poolInfo = stockPool.find(s => s.symbol === t.code) || { sector_level_1: '未知', sector_level_2: '未知', name: t.name };
              holdingsMap[key] = {
                  market: t.market,
                  code: t.code,
                  name: poolInfo.name || t.name,
                  sector_level_1: poolInfo.sector_level_1,
                  sector_level_2: poolInfo.sector_level_2,
                  quantity: 0,
                  avgCost: 0,
                  totalCostHKD: 0,
                  currentPrice: 0,
                  dailyChangePct: 0,
                  mktValHKD: 0,
                  unrealizedPnlHKD: 0,
                  realizedPnlHKD: 0, // 注意：已实现盈亏只计算基准日之后的增量部分
                  pnlRatio: 0,
                  accounts: {}
              };
          }

          const h = holdingsMap[key];
          const rate = globalFxRates[t.market] || 1;

          if (!h.accounts[t.account]) h.accounts[t.account] = 0;
          h.accounts[t.account] += t.quantity;

          if (t.direction === 'BUY') {
              const totalCostLocal = (h.avgCost * h.quantity) + t.amount;
              h.quantity += t.quantity;
              h.avgCost = h.quantity > 0 ? totalCostLocal / h.quantity : 0;
          } else if (t.direction === 'SELL') {
              const sellQty = Math.abs(t.quantity);
              const costOfGoodsSold = sellQty * h.avgCost; 
              const sellProceeds = t.amount; 
              const realizedPnlLocal = sellProceeds - costOfGoodsSold;
              h.realizedPnlHKD += (realizedPnlLocal * rate);

              h.quantity -= sellQty;
              if (h.quantity <= 0) {
                  h.quantity = 0;
                  h.avgCost = 0;
              }
          }
      });

      // 步骤 3：结算实时市值数据
      Object.values(holdingsMap).forEach(h => {
          const rate = globalFxRates[h.market] || 1;
          const quote = realTimeQuotes[h.code];
          
          h.currentPrice = quote?.price || h.avgCost; 
          h.dailyChangePct = quote?.changePercent || 0; 
          
          h.totalCostHKD = (h.quantity * h.avgCost) * rate;
          h.mktValHKD = (h.quantity * h.currentPrice) * rate;
          h.unrealizedPnlHKD = h.mktValHKD - h.totalCostHKD;
          h.pnlRatio = h.totalCostHKD > 0 ? (h.mktValHKD / h.totalCostHKD) - 1 : 0;
      });

      return Object.values(holdingsMap).filter(h => h.quantity > 0 || Math.abs(h.realizedPnlHKD) > 0.01);
  }, [activeTrades, initialHoldings, stockPool, globalFxRates, realTimeQuotes]);

  // --- 模块 1: 持仓统计处理 (排序/筛选) ---
  const displayHoldings = useMemo(() => {
      let result = [...calculatedHoldings].filter(h => h.quantity > 0); 
      
      Object.keys(holdingFilters).forEach(key => {
          const val = holdingFilters[key]?.toLowerCase();
          if (val) {
              result = result.filter(item => String((item as any)[key]).toLowerCase().includes(val));
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
          acc.unrealizedPnlHKD += h.unrealizedPnlHKD;
          return acc;
      }, { totalCostHKD: 0, mktValHKD: 0, unrealizedPnlHKD: 0 });
  }, [displayHoldings]);

  const totalUnrealizedPct = holdingSums.totalCostHKD > 0 ? holdingSums.unrealizedPnlHKD / holdingSums.totalCostHKD : 0;

  // --- 【新增】当前市值二维统计数据 ---
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
                  // 计算各账户分配的现市值（原币种）
                  rawMatrix[h.market][acc] += qty * h.currentPrice;
              });
          }
      });
      
      return { accounts, markets, rawMatrix };
  }, [displayHoldings]);

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

  const chartData = useMemo(() => {
      const sorted = [...pnlData].sort((a, b) => b.totalPnl - a.totalPnl);
      if (chartType === 'BEST') {
          return sorted.filter(p => p.totalPnl > 0).slice(0, 10);
      } else {
          return sorted.filter(p => p.totalPnl < 0).slice(-10).reverse(); 
      }
  }, [pnlData, chartType]);

  const pnlSums = useMemo(() => {
      return pnlData.reduce((acc, p) => {
          acc.unrealized += p.unrealized;
          acc.realized += p.realized;
          acc.total += p.totalPnl;
          return acc;
      }, { unrealized: 0, realized: 0, total: 0 });
  }, [pnlData]);

  // --- 模块 3: 交易流水处理 ---
  const displayTrades = useMemo(() => {
      let result = [...activeTrades]; // 注意：这里使用了严格截断后的 activeTrades
      
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
          const signedAmount = t.direction === 'BUY' ? t.amount : -t.amount;
          return sum + (signedAmount * rate);
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
              const signedAmount = t.direction === 'BUY' ? t.amount : -t.amount;
              rawMatrix[t.market][t.account] += signedAmount;
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

  // --- 资金净买入数据入库逻辑 ---
  const handleSaveCashStats = async () => {
      if (!user) return;
      try {
          const payload = {
              accounts: netBuyStats.accounts,
              markets: netBuyStats.markets,
              rawMatrix: netBuyStats.rawMatrix,
              updatedAt: new Date().toISOString()
          };
          // 【更新】金蟬脫殼：將入庫路徑改為 sip_holding_cash_stock，避開幽靈進程的污染
          await setDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'sip_holding_cash_stock', 'latest_summary'), payload);
      } catch (e) {
          console.error("保存资金净买入统计失败:", e);
      }
  };

  // 每分钟自动保存资金统计
  useEffect(() => {
      if (!user) return;
      const intervalId = setInterval(() => {
          handleSaveCashStats();
      }, 60000); 
      return () => clearInterval(intervalId);
  }, [user, netBuyStats]);

  // --- 初始持仓增删改查事件 ---
  const handleUpdateBaseDate = async (newDate: string) => {
      setBaseDate(newDate);
      try {
          await setDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'sip_holding_spot_start', '_global_config'), {
              baseDate: newDate
          });
      } catch (e) { console.error("更新基准日期失败", e); }
  };

  const handleAddInitialHolding = async () => {
      if (!newInit.code || !newInit.market || !newInit.account || newInit.quantity <= 0 || newInit.costPrice < 0) {
          alert('请正确填写代码、账户、数量(>0)和成本价(>=0)');
          return;
      }
      setSubmittingInit(true);
      try {
          await addDoc(collection(db, 'artifacts', APP_ID, 'public', 'data', 'sip_holding_spot_start'), newInit);
          setNewInit({ code: '', market: 'HKD', account: '', quantity: 0, costPrice: 0 });
      } catch (e) {
          alert('添加期初持仓失败');
      } finally {
          setSubmittingInit(false);
      }
  };

  const handleDeleteInitialHolding = async (id: string) => {
      if (!confirm('确认删除这条期初持仓吗？这可能直接改变当前所有持仓市值与成本。')) return;
      try {
          await deleteDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'sip_holding_spot_start', id));
      } catch (e) { console.error("删除失败", e); }
  };

  // --- 辅助渲染 ---
  const formatMoney = (val: number, isHkdContext = false) => {
      const v = isHkdContext ? val : val; 
      return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };
  
  const fmtPct = (val: number) => (val * 100).toFixed(2) + '%';
  
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
        {/* === Header === */}
        <div className="border-b border-gray-200 pb-4 pt-4 flex justify-between items-end">
            <div>
                <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                    <Building2 className="text-blue-600" />
                    Spot Holdings (现货持仓与盈亏分析)
                </h1>
                <p className="mt-1 text-sm text-gray-500">
                    以【期初底座】融合【增量流水】，实时计算先入先出持仓成本与盈亏。
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

        {error && (
            <div className="bg-red-50 p-4 rounded text-red-700 flex items-center gap-2">
                <AlertCircle size={20}/> {error}
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
                    {baseDate && (
                        <span className="text-xs font-medium text-red-600 bg-red-50 px-2 py-0.5 rounded border border-red-100">
                            仅计入 {baseDate} 之后的增量流水
                        </span>
                    )}
                </div>
                <span className="text-xs text-gray-500 bg-white px-2 py-1 border rounded shadow-sm">数值统一为 <b>HKD</b> 且按先入先出算法结算</span>
            </div>
            
            <div className="overflow-x-auto relative">
                <table className="min-w-full text-xs text-left">
                    <thead className="text-gray-500 font-medium bg-gray-50">
                        <tr>
                            <Th label="代码/名称" sortKey="code" filterKey="code" currentSort={holdingSort} onSort={toggleHoldingSort} currentFilter={holdingFilters} onFilter={updateHoldingFilter} width="160px"/>
                            <Th label="币种" sortKey="market" filterKey="market" currentSort={holdingSort} onSort={toggleHoldingSort} currentFilter={holdingFilters} onFilter={updateHoldingFilter} align="center"/>
                            <Th label="行业 (一/二级)" sortKey="sector_level_1" filterKey="sector_level_1" currentSort={holdingSort} onSort={toggleHoldingSort} currentFilter={holdingFilters} onFilter={updateHoldingFilter} />
                            <Th label="持仓数量" sortKey="quantity" filterKey={null} currentSort={holdingSort} onSort={toggleHoldingSort} currentFilter={holdingFilters} onFilter={updateHoldingFilter} align="right" />
                            <Th label="成本均价" sortKey="avgCost" filterKey={null} currentSort={holdingSort} onSort={toggleHoldingSort} currentFilter={holdingFilters} onFilter={updateHoldingFilter} align="right" />
                            <Th label="实时现价" sortKey="currentPrice" filterKey={null} currentSort={holdingSort} onSort={toggleHoldingSort} currentFilter={holdingFilters} onFilter={updateHoldingFilter} align="right" />
                            <Th label="今日涨跌" sortKey="dailyChangePct" filterKey={null} currentSort={holdingSort} onSort={toggleHoldingSort} currentFilter={holdingFilters} onFilter={updateHoldingFilter} align="right" />
                            <Th label="总成本 (HKD)" sortKey="totalCostHKD" filterKey={null} currentSort={holdingSort} onSort={toggleHoldingSort} currentFilter={holdingFilters} onFilter={updateHoldingFilter} align="right" />
                            <Th label="现市值 (HKD)" sortKey="mktValHKD" filterKey={null} currentSort={holdingSort} onSort={toggleHoldingSort} currentFilter={holdingFilters} onFilter={updateHoldingFilter} align="right" />
                            <Th label="浮动盈亏 (HKD)" sortKey="unrealizedPnlHKD" filterKey={null} currentSort={holdingSort} onSort={toggleHoldingSort} currentFilter={holdingFilters} onFilter={updateHoldingFilter} align="right" />
                            <Th label="盈亏比" sortKey="pnlRatio" filterKey={null} currentSort={holdingSort} onSort={toggleHoldingSort} currentFilter={holdingFilters} onFilter={updateHoldingFilter} align="right" />
                            <Th label="市值占比" sortKey={null} filterKey={null} align="right" />
                            <Th label="盈亏贡献率" sortKey={null} filterKey={null} align="right" />
                            <Th label="各账户持仓股数" sortKey={null} filterKey={null} />
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {displayHoldings.length === 0 ? (
                            <tr><td colSpan={13} className="p-8 text-center text-gray-400">当前空仓或无符合条件数据</td></tr>
                        ) : displayHoldings.map(h => {
                            const pctOfTotalMktVal = holdingSums.mktValHKD > 0 ? h.mktValHKD / holdingSums.mktValHKD : 0;
                            const pnlContribution = holdingSums.totalCostHKD > 0 ? h.unrealizedPnlHKD / holdingSums.totalCostHKD : 0;
                            const accountsArr = Object.entries(h.accounts).filter(([_, qty]) => qty > 0).map(([acc, qty]) => `'${acc}': ${qty.toLocaleString()}`);

                            return (
                                <tr key={h.code} className="hover:bg-indigo-50/30 transition-colors">
                                    <td className="px-3 py-2 whitespace-nowrap">
                                        <div className="font-bold text-gray-900 text-sm">{h.code}</div>
                                        <div className="text-[10px] text-gray-500">{h.name}</div>
                                    </td>
                                    <td className="px-3 py-2 text-center font-mono text-gray-500">{h.market}</td>
                                    <td className="px-3 py-2 whitespace-nowrap">
                                        <div className="text-xs text-gray-700 font-medium">{h.sector_level_1}</div>
                                        <div className="text-[10px] text-gray-400">{h.sector_level_2}</div>
                                    </td>
                                    <td className="px-3 py-2 text-right font-mono font-bold text-gray-800">{h.quantity.toLocaleString()}</td>
                                    <td className="px-3 py-2 text-right font-mono text-gray-600">{h.avgCost.toFixed(4)}</td>
                                    <td className="px-3 py-2 text-right font-mono font-medium text-indigo-700 bg-indigo-50/50">{h.currentPrice.toFixed(4)}</td>
                                    <td className={`px-3 py-2 text-right font-mono font-bold ${h.dailyChangePct >= 0 ? 'text-red-600' : 'text-green-600'}`}>
                                        {h.dailyChangePct > 0 ? '+' : ''}{fmtPct(h.dailyChangePct)}
                                    </td>
                                    <td className="px-3 py-2 text-right font-mono text-gray-700">{formatMoney(h.totalCostHKD, true)}</td>
                                    <td className="px-3 py-2 text-right font-mono font-bold text-gray-900">{formatMoney(h.mktValHKD, true)}</td>
                                    <td className={`px-3 py-2 text-right font-mono font-bold ${h.unrealizedPnlHKD >= 0 ? 'text-red-600' : 'text-green-600'}`}>
                                        {h.unrealizedPnlHKD > 0 ? '+' : ''}{formatMoney(h.unrealizedPnlHKD, true)}
                                    </td>
                                    <td className={`px-3 py-2 text-right font-mono font-bold ${h.pnlRatio >= 0 ? 'text-red-600' : 'text-green-600'}`}>
                                        {h.pnlRatio > 0 ? '+' : ''}{fmtPct(h.pnlRatio)}
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
                        <tfoot className="bg-indigo-50 border-t-2 border-indigo-200">
                            <tr>
                                <td colSpan={7} className="px-3 py-3 text-center font-bold text-indigo-900 tracking-widest">SUM</td>
                                <td className="px-3 py-3 text-right font-mono font-bold text-indigo-900">{formatMoney(holdingSums.totalCostHKD, true)}</td>
                                <td className="px-3 py-3 text-right font-mono font-bold text-indigo-900">{formatMoney(holdingSums.mktValHKD, true)}</td>
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

            {/* 当前市值二维统计表 */}
            <div className="bg-indigo-50 border-t border-indigo-100 p-5">
                <div className="flex justify-between items-center mb-3">
                    <h3 className="font-bold text-indigo-800 text-sm">当前市值统计表</h3>
                    <button 
                        onClick={() => setIsHKDView(!isHKDView)}
                        className={`text-xs font-bold px-3 py-1.5 rounded transition-colors border ${isHKDView ? 'bg-indigo-600 text-white border-indigo-600 shadow-inner' : 'bg-white text-indigo-700 border-indigo-200 hover:bg-indigo-100 shadow-sm'}`}
                    >
                        {isHKDView ? '恢复原始币种' : 'TO HKD (一键折算)'}
                    </button>
                </div>
                <div className="overflow-x-auto rounded border border-indigo-200 bg-white">
                    <table className="min-w-full text-xs text-right">
                        <thead className="bg-indigo-100/50 text-indigo-900 font-medium">
                            <tr>
                                <th className="px-3 py-2 text-center border-b border-r border-indigo-100 bg-indigo-50/50">币种 \ 账户</th>
                                {currentMktStats.accounts.map(acc => (
                                    <th key={acc} className="px-3 py-2 border-b border-indigo-100">{acc}</th>
                                ))}
                                <th className="px-3 py-2 border-b border-l border-indigo-100 bg-indigo-50/50">SUM {isHKDView ? '(HKD)' : '(原币种)'}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-indigo-50">
                            {currentMktStats.markets.map(mkt => {
                                const rate = isHKDView ? (globalFxRates[mkt] || 1) : 1;
                                let rowSum = 0;
                                return (
                                    <tr key={mkt} className="hover:bg-indigo-50/30">
                                        <td className="px-3 py-2 text-center font-bold text-gray-700 border-r border-indigo-50 bg-indigo-50/20">{mkt}</td>
                                        {currentMktStats.accounts.map(acc => {
                                            const rawVal = currentMktStats.rawMatrix[mkt][acc] || 0;
                                            const displayVal = rawVal * rate;
                                            rowSum += displayVal;
                                            return (
                                                <td key={acc} className={`px-3 py-3 font-mono ${displayVal > 0 ? 'text-gray-900' : displayVal < 0 ? 'text-red-600' : 'text-gray-400'}`}>
                                                    {displayVal === 0 ? '-' : formatMoney(displayVal)}
                                                </td>
                                            );
                                        })}
                                        <td className={`px-3 py-3 font-mono font-bold border-l border-indigo-50 bg-indigo-50/20 ${rowSum > 0 ? 'text-indigo-900' : rowSum < 0 ? 'text-red-700' : 'text-gray-500'}`}>
                                            {rowSum === 0 ? '-' : formatMoney(rowSum)}
                                        </td>
                                    </tr>
                                );
                            })}
                            {currentMktStats.markets.length === 0 && (
                                <tr><td colSpan={currentMktStats.accounts.length + 2} className="px-3 py-6 text-center text-gray-400">暂无数据</td></tr>
                            )}
                        </tbody>
                        {currentMktStats.markets.length > 0 && (
                            <tfoot className="bg-indigo-100 text-indigo-900 border-t-2 border-indigo-200 shadow-inner">
                                <tr>
                                    <td className="px-3 py-4 text-center font-bold border-r border-indigo-200">
                                        {isHKDView ? 'SUM (HKD)' : 'SUM (无效)'}
                                    </td>
                                    {currentMktStats.accounts.map(acc => {
                                        if (!isHKDView) return <td key={acc} className="px-3 py-4 text-center font-mono text-gray-400">-</td>;
                                        
                                        let colSumHKD = 0;
                                        currentMktStats.markets.forEach(mkt => {
                                            const rawVal = currentMktStats.rawMatrix[mkt][acc] || 0;
                                            colSumHKD += rawVal * (globalFxRates[mkt] || 1);
                                        });
                                        return (
                                            <td key={acc} className={`px-3 py-4 font-mono font-bold ${colSumHKD > 0 ? 'text-indigo-900' : colSumHKD < 0 ? 'text-red-700' : 'text-gray-500'}`}>
                                                {colSumHKD === 0 ? '-' : formatMoney(colSumHKD)}
                                            </td>
                                        );
                                    })}
                                    <td className="px-3 py-4 font-mono font-bold text-sm border-l border-indigo-200 bg-indigo-200/50 text-indigo-900">
                                        {!isHKDView ? <span className="text-gray-400">-</span> : (
                                            formatMoney(
                                                currentMktStats.markets.reduce((sum, mkt) => {
                                                    let rSum = 0;
                                                    currentMktStats.accounts.forEach(a => rSum += currentMktStats.rawMatrix[mkt][a] || 0);
                                                    return sum + rSum * (globalFxRates[mkt] || 1);
                                                }, 0)
                                            ) + ' HKD'
                                        )}
                                    </td>
                                </tr>
                            </tfoot>
                        )}
                    </table>
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

            <div className="grid grid-cols-1 lg:grid-cols-5 divide-y lg:divide-y-0 lg:divide-x divide-gray-200">
                <div className="lg:col-span-3 overflow-y-auto max-h-[500px]">
                    <table className="w-full text-xs text-left">
                        <thead className="text-gray-500 font-medium bg-white sticky top-0 shadow-sm z-10">
                            <tr>
                                <th className="px-4 py-2">标的</th>
                                <th className="px-4 py-2 text-right">浮动盈亏(未实现)</th>
                                <th className="px-4 py-2 text-right">已实现盈亏</th>
                                <th className="px-4 py-2 text-right">总盈亏 (HKD)</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {pnlData.map(p => (
                                <tr key={p.code} className="hover:bg-gray-50">
                                    <td className="px-4 py-2 font-bold text-gray-800">{p.code}</td>
                                    <td className={`px-4 py-2 text-right font-mono ${p.unrealized > 0 ? 'text-red-500' : p.unrealized < 0 ? 'text-green-500' : 'text-gray-400'}`}>{formatMoney(p.unrealized, true)}</td>
                                    <td className={`px-4 py-2 text-right font-mono ${p.realized > 0 ? 'text-red-500' : p.realized < 0 ? 'text-green-500' : 'text-gray-400'}`}>{formatMoney(p.realized, true)}</td>
                                    <td className={`px-4 py-2 text-right font-mono font-bold ${p.totalPnl > 0 ? 'text-red-600' : p.totalPnl < 0 ? 'text-green-600' : 'text-gray-500'}`}>{formatMoney(p.totalPnl, true)}</td>
                                </tr>
                            ))}
                        </tbody>
                        <tfoot className="bg-rose-50 border-t-2 border-rose-200 sticky bottom-0">
                            <tr>
                                <td className="px-4 py-3 font-bold text-rose-900">总计 SUM</td>
                                <td className={`px-4 py-3 text-right font-mono font-bold ${pnlSums.unrealized >= 0 ? 'text-red-600' : 'text-green-600'}`}>{formatMoney(pnlSums.unrealized, true)}</td>
                                <td className={`px-4 py-3 text-right font-mono font-bold ${pnlSums.realized >= 0 ? 'text-red-600' : 'text-green-600'}`}>{formatMoney(pnlSums.realized, true)}</td>
                                <td className={`px-4 py-3 text-right font-mono font-bold text-lg ${pnlSums.total >= 0 ? 'text-red-600' : 'text-green-600'}`}>{formatMoney(pnlSums.total, true)}</td>
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
            </div>
            
            <div className="max-h-[800px] overflow-y-auto relative">
                <table className="min-w-full text-xs text-left">
                    <thead className="text-gray-500 font-medium bg-gray-50">
                        <tr>
                            <Th label="交易日期" sortKey="date" filterKey="date" currentSort={tradeSort} onSort={toggleTradeSort} currentFilter={tradeFilters} onFilter={updateTradeFilter} width="100px" />
                            <Th label="代码/名称" sortKey="code" filterKey="code" currentSort={tradeSort} onSort={toggleTradeSort} currentFilter={tradeFilters} onFilter={updateTradeFilter} width="160px" />
                            <Th label="账户" sortKey="account" filterKey="account" currentSort={tradeSort} onSort={toggleTradeSort} currentFilter={tradeFilters} onFilter={updateTradeFilter} align="center" width="80px"/>
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
                                    <td className="px-3 py-2 whitespace-nowrap">
                                        <div className="font-bold text-gray-800">{t.code}</div>
                                        <div className="text-[10px] text-gray-400">{t.name}</div>
                                    </td>
                                    <td className="px-3 py-2 text-center text-gray-600">{t.account}</td>
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
                                    <td className="px-3 py-2 text-right font-mono text-gray-900 font-medium">{formatMoney(t.amount * rate)}</td>
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
                        className={`text-xs font-bold px-3 py-1.5 rounded transition-colors border ${isHKDView ? 'bg-blue-600 text-white border-blue-600 shadow-inner' : 'bg-white text-blue-700 border-blue-200 hover:bg-blue-100 shadow-sm'}`}
                    >
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
                        className="px-3 py-1.5 bg-purple-100 text-purple-700 hover:bg-purple-200 rounded text-xs font-bold transition-colors border border-purple-200 shadow-sm"
                    >
                        ⚙️ 设置建账汇率
                    </button>
                </div>
            </div>
            
            <div className="overflow-x-auto">
                <table className="min-w-full text-xs text-left">
                    <thead className="bg-gray-50 text-gray-500 font-medium border-b border-gray-200">
                        <tr>
                            <th className="px-4 py-3 whitespace-nowrap">代码 (Code)</th>
                            <th className="px-4 py-3 text-center whitespace-nowrap">币种</th>
                            <th className="px-4 py-3 text-center whitespace-nowrap">账户</th>
                            <th className="px-4 py-3 text-right whitespace-nowrap">期初数量</th>
                            <th className="px-4 py-3 text-right whitespace-nowrap">期初成本均价</th>
                            <th className="px-4 py-3 text-right whitespace-nowrap">期初总投入金额</th>
                            <th className="px-4 py-3 text-center whitespace-nowrap">操作</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {initialHoldings.map(h => {
                            const rate = isHKDView ? (baseFxRates[h.market] || globalFxRates[h.market] || 1) : 1;
                            const amt = h.quantity * h.costPrice * rate;
                            return (
                            <tr key={h.id} className="hover:bg-purple-50/30 transition-colors">
                                <td className="px-4 py-2 font-bold text-gray-800">{h.code}</td>
                                <td className="px-4 py-2 text-center font-mono text-gray-500">{h.market}</td>
                                <td className="px-4 py-2 text-center text-gray-600">{h.account}</td>
                                <td className="px-4 py-2 text-right font-mono text-gray-800">{h.quantity.toLocaleString()}</td>
                                <td className="px-4 py-2 text-right font-mono text-gray-600">{h.costPrice.toFixed(4)}</td>
                                <td className="px-4 py-2 text-right font-mono font-medium">{formatMoney(amt, isHKDView)}</td>
                                <td className="px-4 py-2 text-center">
                                    <button onClick={() => handleDeleteInitialHolding(h.id)} className="text-gray-400 hover:text-red-600 p-1 rounded">
                                        <Trash2 size={16} />
                                    </button>
                                </td>
                            </tr>
                        )})}
                        
                        {/* 录入空行 */}
                        <tr className="bg-purple-50/50 border-t-2 border-purple-100">
                            <td className="px-4 py-2">
                                <input type="text" placeholder="如 AAPL" value={newInit.code} onChange={e => setNewInit({...newInit, code: e.target.value.toUpperCase().trim()})} className="w-full p-1.5 border border-purple-200 rounded text-xs outline-none focus:ring-1 focus:ring-purple-400" />
                            </td>
                            <td className="px-4 py-2">
                                <select value={newInit.market} onChange={e => setNewInit({...newInit, market: e.target.value})} className="w-full p-1.5 border border-purple-200 rounded text-xs outline-none focus:ring-1 focus:ring-purple-400 bg-white">
                                    <option value="USD">USD</option>
                                    <option value="CNY">CNY</option>
                                    <option value="HKD">HKD</option>
                                    <option value="JPY">JPY</option>
                                </select>
                            </td>
                            <td className="px-4 py-2">
                                <input type="text" placeholder="账户名称" value={newInit.account} onChange={e => setNewInit({...newInit, account: e.target.value.trim()})} className="w-full p-1.5 border border-purple-200 rounded text-xs outline-none focus:ring-1 focus:ring-purple-400" />
                            </td>
                            <td className="px-4 py-2">
                                <input type="number" min="0" placeholder="数量" value={newInit.quantity || ''} onChange={e => setNewInit({...newInit, quantity: parseFloat(e.target.value)||0})} className="w-full p-1.5 border border-purple-200 rounded text-xs outline-none text-right focus:ring-1 focus:ring-purple-400" />
                            </td>
                            <td className="px-4 py-2">
                                <input type="number" min="0" step="0.0001" placeholder="成本均价" value={newInit.costPrice || ''} onChange={e => setNewInit({...newInit, costPrice: parseFloat(e.target.value)||0})} className="w-full p-1.5 border border-purple-200 rounded text-xs outline-none text-right focus:ring-1 focus:ring-purple-400" />
                            </td>
                            <td className="px-4 py-2 text-right text-purple-400 text-xs font-medium">自动计算...</td>
                            <td className="px-4 py-2 text-center">
                                <button onClick={handleAddInitialHolding} disabled={submittingInit} className="text-white bg-purple-600 hover:bg-purple-700 px-3 py-1.5 rounded shadow-sm flex items-center justify-center gap-1 mx-auto transition-colors">
                                    {submittingInit ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} 保存
                                </button>
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
                        className={`text-xs font-bold px-3 py-1.5 rounded transition-colors border ${isHKDView ? 'bg-purple-600 text-white border-purple-600 shadow-inner' : 'bg-white text-purple-700 border-purple-200 hover:bg-purple-100 shadow-sm'}`}
                    >
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
            </div>
        </div>

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
                            <p className="text-sm text-gray-500 text-center py-4">暂无已缓存的汇率数据，请点击右上角“更新汇率”。</p>
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

    </div>
  );
}