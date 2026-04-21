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
  DollarSign,
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

// --- 统一的交易数据类型 ---
interface UnifiedCBBCTrade {
  id: string;
  date: string;
  account: string;
  market: string;
  futuresCode: string;
  futuresName: string;
  direction: 'BUY' | 'SELL';
  quantity: number;
  price: number; 
  amount: number; 
  fee: number;
  updatedAt: number;
  executor: string;
}

// --- 期初持仓（底座）数据类型 ---
interface InitialCBBCHolding {
  id: string;
  futuresCode: string;
  futuresName: string;
  market: string;
  account: string;
  quantity: number;
  costPrice: number;
}

// --- 手动价格数据类型 ---
interface CBBCPriceRecord {
  price: number;
  updatedAt: string;
}

// --- 聚合后的持仓数据类型 ---
interface CBBCHolding {
  market: string;
  futuresCode: string;
  futuresName: string;
  quantity: number;
  avgCost: number; 
  totalCostHKD: number; 
  currentPrice: number; 
  mktValHKD: number; 
  unrealizedPnlHKD: number; 
  realizedPnlHKD: number; 
  pnlRatio: number;
  accounts: Record<string, number>; 
}

// --- 时间辅助函数 ---
const getTime = (val: any) => {
    if (!val) return 0;
    if (val.toMillis && typeof val.toMillis === 'function') return val.toMillis();
    if (val.seconds) return val.seconds * 1000;
    return new Date(val).getTime() || 0;
};

const formatTime = (val: number | string) => {
    if (!val) return 'N/A';
    return new Date(val).toLocaleString('zh-CN', { hour12: false });
};

// --- 可排序筛选的表头组件 ---
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

export default function CBBCHoldingsPage() {
  const [user, setUser] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingInitial, setLoadingInitial] = useState(true);
  
  // --- 数据源 ---
  const [allTrades, setAllTrades] = useState<UnifiedCBBCTrade[]>([]);
  const [initialHoldings, setInitialHoldings] = useState<InitialCBBCHolding[]>([]);
  const [baseDate, setBaseDate] = useState<string>('');
  const [cbbcPrices, setCbbcPrices] = useState<Record<string, CBBCPriceRecord>>({});
  
  // --- 新增期初记录 State ---
  const [newInit, setNewInit] = useState({ futuresCode: '', futuresName: '', market: 'USD', account: '', quantity: 0, costPrice: 0 });
  const [submittingInit, setSubmittingInit] = useState(false);
  const [draftPrices, setDraftPrices] = useState<Record<string, string>>({}); 

  // --- 汇率锁定 State ---
  const [baseFxRates, setBaseFxRates] = useState<Record<string, number>>({});
  const [showBaseFxModal, setShowBaseFxModal] = useState(false);
  const [draftBaseFx, setDraftBaseFx] = useState<Record<string, string>>({});

  // --- 全局状态 ---
  const [isHKDView, setIsHKDView] = useState(false);
  const [globalFxRates, setGlobalFxRates] = useState<Record<string, number>>({});
  const [isFetchingFx, setIsFetchingFx] = useState(false);
  const [showFxModal, setShowFxModal] = useState(false);
  
  // --- 图表切换 ---
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

  // --- 权限验证与数据拉取 ---
  useEffect(() => {
    let unsubStart: (() => void) | undefined;
    let unsubTrades: (() => void) | undefined;
    let unsubPrices: (() => void) | undefined;

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
            // 1. 监听期初持仓
            const qStart = query(collection(db, 'artifacts', APP_ID, 'public', 'data', 'sip_holding_cbbc_start'));
            unsubStart = onSnapshot(qStart, (snapshot) => {
                const starts: InitialCBBCHolding[] = [];
                let bDate = '';
                let bFx: Record<string, number> = {};
                snapshot.forEach(docSnap => {
                    if (docSnap.id === '_global_config') {
                        bDate = docSnap.data().baseDate || '';
                        bFx = docSnap.data().baseFxRates || {};
                    } else {
                        starts.push({ id: docSnap.id, ...docSnap.data() } as InitialCBBCHolding);
                    }
                });
                setBaseDate(bDate);
                setBaseFxRates(bFx);
                setInitialHoldings(starts);
            });

            // 2. 监听交易流水
            const qTrades = query(collection(db, 'artifacts', APP_ID, 'public', 'data', 'sip_trade_cbbc'));
            unsubTrades = onSnapshot(qTrades, (snapshot) => {
                const merged: UnifiedCBBCTrade[] = [];
                snapshot.forEach(docSnap => {
                    const d = docSnap.data();
                    const direction = d.direction?.toUpperCase() || 'BUY';
                    const qty = Math.abs(Number(d.quantity));
                    merged.push({
                        id: docSnap.id, 
                        date: d.date, 
                        account: d.account || '', 
                        market: d.market || 'HKD',
                        futuresCode: d.futuresCode, 
                        futuresName: d.futuresName, 
                        direction,
                        quantity: direction === 'BUY' ? qty : -qty,
                        price: Number(d.avg_price_incl_fee || d.price_excl_fee || 0),
                        amount: Number(d.amount_incl_fee || d.amount_excl_fee || 0), 
                        fee: Number(d.fee || 0),
                        updatedAt: getTime(d.createdAt), 
                        executor: d.executor || ''
                    });
                });
                merged.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
                setAllTrades(merged);
            });

            // 3. 监听手动维护的最新价格
            const qPrices = query(collection(db, 'artifacts', APP_ID, 'public', 'data', 'sip_holding_cbbc_lastprice'));
            unsubPrices = onSnapshot(qPrices, (snapshot) => {
                const priceMap: Record<string, CBBCPriceRecord> = {};
                snapshot.forEach(docSnap => {
                    const data = docSnap.data();
                    priceMap[docSnap.id] = { price: Number(data.price), updatedAt: data.updatedAt };
                });
                setCbbcPrices(priceMap);
                setLoadingInitial(false);
            });
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
        if (unsubTrades) unsubTrades();
        if (unsubPrices) unsubPrices();
    };
  }, []);

  // --- 有效的增量交易 (基准日过滤) ---
  const activeTrades = useMemo(() => {
      return allTrades.filter(t => !baseDate || t.date > baseDate);
  }, [allTrades, baseDate]);

  // --- API拉取：最新汇率 ---
  const fetchFxRates = async () => {
    if (activeTrades.length === 0 && initialHoldings.length === 0) return;
    setIsFetchingFx(true);
    
    try {
      const markets = new Set<string>();
      activeTrades.forEach(t => { if (t.market && t.market !== 'HKD') markets.add(t.market); });
      initialHoldings.forEach(h => { if (h.market && h.market !== 'HKD') markets.add(h.market); });

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
    } catch (e) {
        console.error("FX fetch error", e);
    } finally {
        setIsFetchingFx(false);
    }
  };

  useEffect(() => {
    if (activeTrades.length > 0 || initialHoldings.length > 0) {
        fetchFxRates();
    }
  }, [activeTrades, initialHoldings]);

  // --- 核心计算逻辑 (期初底座 + FIFO 增量) ---
  const calculatedHoldings = useMemo(() => {
      const holdingsMap: Record<string, CBBCHolding> = {};

      // 1. 期初底座铺设
      initialHoldings.forEach(init => {
          const key = init.futuresCode;
          if (!holdingsMap[key]) {
              holdingsMap[key] = {
                  market: init.market,
                  futuresCode: key,
                  futuresName: init.futuresName || key,
                  quantity: 0,
                  avgCost: 0,
                  totalCostHKD: 0,
                  currentPrice: 0,
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

          const currentTotalCost = h.quantity * h.avgCost;
          const addedCost = init.quantity * init.costPrice;
          h.quantity += init.quantity;
          h.avgCost = h.quantity > 0 ? (currentTotalCost + addedCost) / h.quantity : 0;
      });

      // 2. 按时间正序处理流水
      const chronological = [...activeTrades].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

      chronological.forEach(t => {
          const key = t.futuresCode;
          if (!holdingsMap[key]) {
              holdingsMap[key] = {
                  market: t.market,
                  futuresCode: t.futuresCode,
                  futuresName: t.futuresName || t.futuresCode,
                  quantity: 0,
                  avgCost: 0,
                  totalCostHKD: 0,
                  currentPrice: 0,
                  mktValHKD: 0,
                  unrealizedPnlHKD: 0,
                  realizedPnlHKD: 0,
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

      // 3. 市值重估 (如果没有手动输入价格，则默认原价)
      Object.values(holdingsMap).forEach(h => {
          const rate = globalFxRates[h.market] || 1;
          h.currentPrice = cbbcPrices[h.futuresCode]?.price ?? h.avgCost; 
          
          h.totalCostHKD = (h.quantity * h.avgCost) * rate;
          h.mktValHKD = (h.quantity * h.currentPrice) * rate;
          h.unrealizedPnlHKD = h.mktValHKD - h.totalCostHKD;
          h.pnlRatio = h.totalCostHKD > 0 ? (h.mktValHKD / h.totalCostHKD) - 1 : 0;
      });

      return Object.values(holdingsMap).filter(h => h.quantity > 0 || Math.abs(h.realizedPnlHKD) > 0.01);
  }, [activeTrades, initialHoldings, globalFxRates, cbbcPrices]);

  // --- 模块 1: 当前持仓过滤与排序 ---
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

  // --- 当前市值的二维统计矩阵 ---
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

  // --- 模块 2: 损益分析图表数据 ---
  const pnlData = useMemo(() => {
      return calculatedHoldings.map(h => {
          return {
              name: h.futuresName,
              code: h.futuresCode,
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

  // --- 模块 4: 资金净买入二维统计 ---
  const cashStats = useMemo(() => {
      const accountsSet = new Set<string>();
      const marketsSet = new Set<string>();
      
      initialHoldings.forEach(h => {
          if (h.account) accountsSet.add(h.account);
          if (h.market) marketsSet.add(h.market);
      });
      activeTrades.forEach(t => {
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
      
      // 累加期初投入
      initialHoldings.forEach(h => {
          if (h.market && h.account) {
              rawMatrix[h.market][h.account] += h.quantity * h.costPrice;
          }
      });
      // 累加流水净申购
      activeTrades.forEach(t => {
          if (t.market && t.account) {
              const signedAmount = t.direction === 'BUY' ? t.amount : -t.amount;
              rawMatrix[t.market][t.account] += signedAmount;
          }
      });
      
      return { accounts, markets, rawMatrix };
  }, [initialHoldings, activeTrades]);

  const totalCashNetBuyHKD = useMemo(() => {
      let total = 0;
      cashStats.markets.forEach(mkt => {
          const rate = globalFxRates[mkt] || 1;
          cashStats.accounts.forEach(acc => {
              total += (cashStats.rawMatrix[mkt][acc] || 0) * rate;
          });
      });
      return total;
  }, [cashStats, globalFxRates]);

  const handleSaveCashStats = async () => {
      if (!user) return;
      try {
          const payload = {
              accounts: cashStats.accounts,
              markets: cashStats.markets,
              rawMatrix: cashStats.rawMatrix,
              updatedAt: new Date().toISOString()
          };
          await setDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'sip_holding_cash_cbbc', 'latest_summary'), payload);
      } catch (e) { console.error("保存资金净买入统计失败:", e); }
  };

  useEffect(() => {
      if (!user) return;
      const intervalId = setInterval(handleSaveCashStats, 60000); 
      return () => clearInterval(intervalId);
  }, [user, cashStats]);

  // --- 模块 5: 手动价格录入 ---
  const uniqueFutures = useMemo(() => {
      const map = new Map<string, { futuresCode: string, futuresName: string, market: string }>();
      initialHoldings.forEach(h => {
          if (h.futuresCode) map.set(h.futuresCode, { futuresCode: h.futuresCode, futuresName: h.futuresName, market: h.market });
      });
      allTrades.forEach(t => {
          if (t.futuresCode) map.set(t.futuresCode, { futuresCode: t.futuresCode, futuresName: t.futuresName, market: t.market });
      });
      return Array.from(map.values()).sort((a, b) => a.futuresCode.localeCompare(b.futuresCode));
  }, [initialHoldings, allTrades]);

  const handleSavePrice = async (futuresCode: string, market: string, futuresName: string) => {
      const priceVal = parseFloat(draftPrices[futuresCode]);
      if (isNaN(priceVal) || priceVal < 0) {
          alert('请输入有效的价格 (≥0)');
          return;
      }
      try {
          await setDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'sip_holding_cbbc_lastprice', futuresCode), {
              futuresCode,
              futuresName,
              market,
              price: priceVal,
              updatedAt: new Date().toISOString()
          });
          // 成功后清空草稿
          setDraftPrices(prev => { const next = {...prev}; delete next[futuresCode]; return next; });
      } catch (e) {
          alert("保存价格失败");
      }
  };

  const handleDeletePrice = async (futuresCode: string) => {
      if (!confirm(`确定要删除 [${futuresCode}] 的手动估值吗？删除后系统将恢复使用历史平均成本价计算市值。`)) return;
      try {
          await deleteDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'sip_holding_cbbc_lastprice', futuresCode));
          setDraftPrices(prev => { const next = {...prev}; delete next[futuresCode]; return next; });
      } catch (e) {
          alert("删除估值失败");
      }
  };

  // --- 期初投入二维统计数据 (必须放在 early return 前面！) ---
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

  // --- 模块 6: 期初持仓设置 ---
  const handleUpdateBaseDate = async (newDate: string) => {
      setBaseDate(newDate);
      try {
          await setDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'sip_holding_cbbc_start', '_global_config'), { baseDate: newDate }, { merge: true });
      } catch (e) { console.error("更新基准日期失败", e); }
  };

  const handleAddInitialHolding = async () => {
      if (!newInit.futuresCode || !newInit.market || !newInit.account || newInit.quantity <= 0 || newInit.costPrice < 0) {
          alert('请正确填写代码、账户、数量(>0)和成本价(>=0)');
          return;
      }
      setSubmittingInit(true);
      try {
          await addDoc(collection(db, 'artifacts', APP_ID, 'public', 'data', 'sip_holding_cbbc_start'), newInit);
          setNewInit({ futuresCode: '', futuresName: '', market: 'USD', account: '', quantity: 0, costPrice: 0 });
      } catch (e) { alert('添加期初持仓失败'); } 
      finally { setSubmittingInit(false); }
  };

  const handleDeleteInitialHolding = async (id: string) => {
      if (!confirm('确认删除这条期初持仓吗？这可能会直接改变当前所有持仓市值与成本。')) return;
      try { await deleteDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'sip_holding_cbbc_start', id)); } 
      catch (e) { console.error("删除失败", e); }
  };

  // --- 渲染辅助 ---
  const formatMoneyStr = (val: number, isHkdContext = false) => {
      const v = isHkdContext ? val : val; 
      return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };
  const fmtPct = (val: number) => (val * 100).toFixed(2) + '%';

  // 【重要】所有 Hooks 必须在此之前声明
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
                    CBBC Holdings (牛熊证/期货持仓分析)
                </h1>
                <p className="mt-1 text-sm text-gray-500">
                    针对场外/非标衍生品的专属盯市。采用【期初底座】+【增量流水】计算 FIFO 成本，通过【内部现价录入】重估市值。
                </p>
            </div>
            <div className="flex gap-2">
                 <button 
                    onClick={() => setShowFxModal(true)} 
                    className="px-3 py-2 text-sm rounded border bg-white hover:bg-gray-50 text-gray-600 transition-colors shadow-sm flex items-center gap-1"
                    title="查看当前汇率"
                >
                    <Info size={16} className="text-blue-500" />
                    汇率详情
                </button>
                 <button 
                    onClick={() => fetchFxRates()} 
                    disabled={isFetchingFx}
                    className="px-4 py-2 text-sm rounded border bg-white hover:bg-gray-50 flex items-center gap-2 text-gray-600 transition-colors shadow-sm"
                >
                    <RefreshCw size={16} className={isFetchingFx ? 'animate-spin' : ''} />
                    更新汇率
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
                        当前牛熊证/期货持仓统计表 ({displayHoldings.length} 只标的)
                    </h2>
                    {baseDate && (
                        <span className="text-xs font-medium text-red-600 bg-red-50 px-2 py-0.5 rounded border border-red-100">
                            仅计入 {baseDate} 之后的增量流水
                        </span>
                    )}
                </div>
                <span className="text-xs text-gray-500 bg-white px-2 py-1 border rounded shadow-sm">数值统一为 <b>HKD</b> 且按 FIFO 算法结算</span>
            </div>
            
            <div className="overflow-x-auto relative">
                <table className="min-w-full text-xs text-left">
                    <thead className="text-gray-500 font-medium bg-gray-50">
                        <tr>
                            <Th label="标的名称/简码" sortKey="futuresCode" filterKey="futuresCode" currentSort={holdingSort} onSort={toggleHoldingSort} currentFilter={holdingFilters} onFilter={updateHoldingFilter} width="160px"/>
                            <Th label="币种" sortKey="market" filterKey="market" currentSort={holdingSort} onSort={toggleHoldingSort} currentFilter={holdingFilters} onFilter={updateHoldingFilter} align="center"/>
                            <Th label="持仓数量" sortKey="quantity" filterKey={null} currentSort={holdingSort} onSort={toggleHoldingSort} currentFilter={holdingFilters} onFilter={updateHoldingFilter} align="right" />
                            <Th label="成本均价" sortKey="avgCost" filterKey={null} currentSort={holdingSort} onSort={toggleHoldingSort} currentFilter={holdingFilters} onFilter={updateHoldingFilter} align="right" />
                            <Th label="手动实时现价" sortKey="currentPrice" filterKey={null} currentSort={holdingSort} onSort={toggleHoldingSort} currentFilter={holdingFilters} onFilter={updateHoldingFilter} align="right" />
                            <Th label="总成本 (HKD)" sortKey="totalCostHKD" filterKey={null} currentSort={holdingSort} onSort={toggleHoldingSort} currentFilter={holdingFilters} onFilter={updateHoldingFilter} align="right" />
                            <Th label="现市值 (HKD)" sortKey="mktValHKD" filterKey={null} currentSort={holdingSort} onSort={toggleHoldingSort} currentFilter={holdingFilters} onFilter={updateHoldingFilter} align="right" />
                            <Th label="浮动盈亏 (HKD)" sortKey="unrealizedPnlHKD" filterKey={null} currentSort={holdingSort} onSort={toggleHoldingSort} currentFilter={holdingFilters} onFilter={updateHoldingFilter} align="right" />
                            <Th label="盈亏比" sortKey="pnlRatio" filterKey={null} currentSort={holdingSort} onSort={toggleHoldingSort} currentFilter={holdingFilters} onFilter={updateHoldingFilter} align="right" />
                            <Th label="市值占比" sortKey={null} filterKey={null} align="right" />
                            <Th label="盈亏贡献率" sortKey={null} filterKey={null} align="right" />
                            <Th label="各账户持仓数量" sortKey={null} filterKey={null} />
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {displayHoldings.length === 0 ? (
                            <tr><td colSpan={12} className="p-8 text-center text-gray-400">当前空仓或无符合条件数据</td></tr>
                        ) : displayHoldings.map(h => {
                            const pctOfTotalMktVal = holdingSums.mktValHKD > 0 ? h.mktValHKD / holdingSums.mktValHKD : 0;
                            const pnlContribution = holdingSums.totalCostHKD > 0 ? h.unrealizedPnlHKD / holdingSums.totalCostHKD : 0;
                            const accountsArr = Object.entries(h.accounts).filter(([_, qty]) => qty > 0).map(([acc, qty]) => `'${acc}': ${qty.toLocaleString()}`);

                            return (
                                <tr key={h.futuresCode} className="hover:bg-indigo-50/30 transition-colors">
                                    <td className="px-3 py-2 whitespace-nowrap">
                                        <div className="font-bold text-gray-900 text-sm">{h.futuresName}</div>
                                        <div className="text-[10px] text-gray-500 font-mono">{h.futuresCode}</div>
                                    </td>
                                    <td className="px-3 py-2 text-center font-mono text-gray-500">{h.market}</td>
                                    <td className="px-3 py-2 text-right font-mono font-bold text-gray-800">{h.quantity.toLocaleString(undefined, {maximumFractionDigits:4})}</td>
                                    <td className="px-3 py-2 text-right font-mono text-gray-600">{h.avgCost.toFixed(4)}</td>
                                    <td className="px-3 py-2 text-right font-mono font-medium text-indigo-700 bg-indigo-50/50">
                                        {h.currentPrice.toFixed(4)}
                                        {(cbbcPrices[h.futuresCode]?.price === undefined) && <span className="ml-1 text-[10px] text-gray-400" title="未录入现价，使用成本价">(未定)</span>}
                                    </td>
                                    <td className="px-3 py-2 text-right font-mono text-gray-700">{formatMoneyStr(h.totalCostHKD, true)}</td>
                                    <td className="px-3 py-2 text-right font-mono font-bold text-gray-900">{formatMoneyStr(h.mktValHKD, true)}</td>
                                    <td className={`px-3 py-2 text-right font-mono font-bold ${h.unrealizedPnlHKD > 0 ? 'text-red-600' : h.unrealizedPnlHKD < 0 ? 'text-green-600' : 'text-gray-400'}`}>
                                        {h.unrealizedPnlHKD > 0 ? '+' : ''}{h.unrealizedPnlHKD === 0 ? '-' : formatMoneyStr(h.unrealizedPnlHKD, true)}
                                    </td>
                                    <td className={`px-3 py-2 text-right font-mono font-bold ${h.pnlRatio > 0 ? 'text-red-600' : h.pnlRatio < 0 ? 'text-green-600' : 'text-gray-400'}`}>
                                        {h.pnlRatio > 0 ? '+' : ''}{h.pnlRatio === 0 ? '-' : fmtPct(h.pnlRatio)}
                                    </td>
                                    <td className="px-3 py-2 text-right font-mono text-gray-500">{fmtPct(pctOfTotalMktVal)}</td>
                                    <td className={`px-3 py-2 text-right font-mono ${pnlContribution > 0 ? 'text-red-500' : pnlContribution < 0 ? 'text-green-500' : 'text-gray-400'}`}>
                                        {pnlContribution > 0 ? '+' : ''}{pnlContribution === 0 ? '-' : fmtPct(pnlContribution)}
                                    </td>
                                    <td className="px-3 py-2 whitespace-nowrap">
                                        <span className="text-[10px] text-gray-500 font-mono tracking-tighter max-w-[200px] truncate block" title={`[${accountsArr.join(', ')}]`}>
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
                                <td colSpan={5} className="px-3 py-3 text-center font-bold text-indigo-900 tracking-widest">SUM</td>
                                <td className="px-3 py-3 text-right font-mono font-bold text-indigo-900">{formatMoneyStr(holdingSums.totalCostHKD, true)}</td>
                                <td className="px-3 py-3 text-right font-mono font-bold text-indigo-900">{formatMoneyStr(holdingSums.mktValHKD, true)}</td>
                                <td className={`px-3 py-3 text-right font-mono font-bold text-lg ${holdingSums.unrealizedPnlHKD > 0 ? 'text-red-600' : holdingSums.unrealizedPnlHKD < 0 ? 'text-green-600' : 'text-indigo-900'}`}>
                                    {holdingSums.unrealizedPnlHKD > 0 ? '+' : ''}{holdingSums.unrealizedPnlHKD === 0 ? '-' : formatMoneyStr(holdingSums.unrealizedPnlHKD, true)}
                                </td>
                                <td className={`px-3 py-3 text-right font-mono font-bold text-lg ${totalUnrealizedPct > 0 ? 'text-red-600' : totalUnrealizedPct < 0 ? 'text-green-600' : 'text-indigo-900'}`}>
                                    {totalUnrealizedPct > 0 ? '+' : ''}{totalUnrealizedPct === 0 ? '-' : fmtPct(totalUnrealizedPct)}
                                </td>
                                <td colSpan={1} className="px-3 py-3 text-right font-mono font-bold text-indigo-600">100.00%</td>
                                <td className={`px-3 py-3 text-right font-mono font-bold ${totalUnrealizedPct > 0 ? 'text-red-600' : totalUnrealizedPct < 0 ? 'text-green-600' : 'text-indigo-900'}`}>
                                    {totalUnrealizedPct > 0 ? '+' : ''}{totalUnrealizedPct === 0 ? '-' : fmtPct(totalUnrealizedPct)}
                                </td>
                                <td></td>
                            </tr>
                        </tfoot>
                    )}
                </table>
            </div>

            {/* 当前市值二维统计 */}
            <div className="bg-indigo-50 border-t border-indigo-100 p-5">
                <div className="flex justify-between items-center mb-3">
                    <h3 className="font-bold text-indigo-800 text-sm">当前市值二维统计矩阵</h3>
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
                                <th className="px-3 py-2 border-b border-l border-indigo-100 bg-indigo-50/50">SUM (HKD)</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-indigo-50">
                            {currentMktStats.markets.map(mkt => {
                                const rate = isHKDView ? (globalFxRates[mkt] || 1) : 1;
                                const actualRate = globalFxRates[mkt] || 1;
                                let rawRowSum = 0;
                                return (
                                    <tr key={mkt} className="hover:bg-indigo-50/30">
                                        <td className="px-3 py-2 text-center font-bold text-gray-700 border-r border-indigo-50 bg-indigo-50/20">{mkt}</td>
                                        {currentMktStats.accounts.map(acc => {
                                            const rawVal = currentMktStats.rawMatrix[mkt][acc] || 0;
                                            rawRowSum += rawVal;
                                            const displayVal = rawVal * rate;
                                            return (
                                                <td key={acc} className="px-3 py-2 font-mono text-gray-700">
                                                    {displayVal === 0 ? '-' : formatMoneyStr(displayVal, isHKDView)}
                                                </td>
                                            );
                                        })}
                                        <td className="px-3 py-2 font-mono font-bold text-indigo-900 border-l border-indigo-50 bg-indigo-50/20">
                                            {rawRowSum * actualRate === 0 ? '-' : formatMoneyStr(rawRowSum * actualRate, true)}
                                        </td>
                                    </tr>
                                );
                            })}
                            {currentMktStats.markets.length === 0 && (
                                <tr><td colSpan={currentMktStats.accounts.length + 2} className="px-3 py-4 text-center text-gray-400">暂无数据</td></tr>
                            )}
                        </tbody>
                        {currentMktStats.markets.length > 0 && (
                            <tfoot className="bg-indigo-100 text-indigo-900 border-t-2 border-indigo-200 shadow-inner">
                                <tr>
                                    <td className="px-3 py-3 text-center font-bold border-r border-indigo-200">SUM (HKD)</td>
                                    {currentMktStats.accounts.map(acc => {
                                        let colSumHKD = 0;
                                        currentMktStats.markets.forEach(mkt => {
                                            const rawVal = currentMktStats.rawMatrix[mkt][acc] || 0;
                                            colSumHKD += rawVal * (globalFxRates[mkt] || 1);
                                        });
                                        return (
                                            <td key={acc} className="px-3 py-3 font-mono font-bold text-indigo-900">
                                                {colSumHKD === 0 ? '-' : formatMoneyStr(colSumHKD, true)}
                                            </td>
                                        );
                                    })}
                                    <td className="px-3 py-3 font-mono font-bold text-sm border-l border-indigo-200 text-indigo-900">
                                        {formatMoneyStr(holdingSums.mktValHKD, true)} HKD
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
                                <th className="px-4 py-2">标的名称/简码</th>
                                <th className="px-4 py-2 text-right">未实现浮盈 (HKD)</th>
                                <th className="px-4 py-2 text-right">已实现盈亏 (HKD)</th>
                                <th className="px-4 py-2 text-right">总盈亏 (HKD)</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {pnlData.map(p => (
                                <tr key={p.code} className="hover:bg-gray-50">
                                    <td className="px-4 py-2">
                                        <div className="font-bold text-gray-800">{p.name}</div>
                                        <div className="text-[10px] text-gray-500 font-mono">{p.code}</div>
                                    </td>
                                    <td className={`px-4 py-2 text-right font-mono ${p.unrealized > 0 ? 'text-red-500' : p.unrealized < 0 ? 'text-green-500' : 'text-gray-400'}`}>
                                        {formatMoneyStr(p.unrealized, true)}
                                    </td>
                                    <td className={`px-4 py-2 text-right font-mono ${p.realized > 0 ? 'text-red-500' : p.realized < 0 ? 'text-green-500' : 'text-gray-400'}`}>
                                        {formatMoneyStr(p.realized, true)}
                                    </td>
                                    <td className={`px-4 py-2 text-right font-mono font-bold ${p.totalPnl > 0 ? 'text-red-600' : p.totalPnl < 0 ? 'text-green-600' : 'text-gray-500'}`}>
                                        {formatMoneyStr(p.totalPnl, true)}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                        <tfoot className="bg-rose-50 border-t-2 border-rose-200 sticky bottom-0">
                            <tr>
                                <td className="px-4 py-3 font-bold text-rose-900">总计 SUM</td>
                                <td className={`px-4 py-3 text-right font-mono font-bold ${pnlSums.unrealized > 0 ? 'text-red-600' : pnlSums.unrealized < 0 ? 'text-green-600' : 'text-gray-500'}`}>
                                    {formatMoneyStr(pnlSums.unrealized, true)}
                                </td>
                                <td className={`px-4 py-3 text-right font-mono font-bold ${pnlSums.realized > 0 ? 'text-red-600' : pnlSums.realized < 0 ? 'text-green-600' : 'text-gray-500'}`}>
                                    {formatMoneyStr(pnlSums.realized, true)}
                                </td>
                                <td className={`px-4 py-3 text-right font-mono font-bold text-lg ${pnlSums.total > 0 ? 'text-red-600' : pnlSums.total < 0 ? 'text-green-600' : 'text-gray-500'}`}>
                                    {formatMoneyStr(pnlSums.total, true)}
                                </td>
                            </tr>
                        </tfoot>
                    </table>
                </div>

                <div className="lg:col-span-2 p-6 flex flex-col justify-center bg-gray-50/50">
                    <h3 className="text-center font-bold text-gray-700 mb-6">
                        {chartType === 'BEST' ? '🏅 净值表现最好 Top 10' : '⚠️ 净值回撤最差 Top 10'}
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
                                        formatter={(value: any) => [formatMoneyStr(Number(value) || 0, true) + ' HKD', '总盈亏']}
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
                            <Th label="日期" sortKey="date" filterKey="date" currentSort={tradeSort} onSort={toggleTradeSort} currentFilter={tradeFilters} onFilter={updateTradeFilter} width="100px" />
                            <Th label="标的名称/简码" sortKey="futuresCode" filterKey="futuresCode" currentSort={tradeSort} onSort={toggleTradeSort} currentFilter={tradeFilters} onFilter={updateTradeFilter} width="160px" />
                            <Th label="账户" sortKey="account" filterKey="account" currentSort={tradeSort} onSort={toggleTradeSort} currentFilter={tradeFilters} onFilter={updateTradeFilter} align="center" width="80px"/>
                            <Th label="币种" sortKey="market" filterKey="market" currentSort={tradeSort} onSort={toggleTradeSort} currentFilter={tradeFilters} onFilter={updateTradeFilter} align="center" width="70px" />
                            <Th label="方向" sortKey="direction" filterKey="direction" currentSort={tradeSort} onSort={toggleTradeSort} currentFilter={tradeFilters} onFilter={updateTradeFilter} align="center" width="80px" />
                            <Th label="数量" sortKey="quantity" filterKey={null} currentSort={tradeSort} onSort={toggleTradeSort} currentFilter={tradeFilters} onFilter={updateTradeFilter} align="right" width="100px"/>
                            <Th label={`均价(含费) ${isHKDView?'HKD':''}`} sortKey="price" filterKey={null} currentSort={tradeSort} onSort={toggleTradeSort} currentFilter={tradeFilters} onFilter={updateTradeFilter} align="right" width="120px" />
                            <Th label={`总额(含费) ${isHKDView?'HKD':''}`} sortKey="amount" filterKey={null} currentSort={tradeSort} onSort={toggleTradeSort} currentFilter={tradeFilters} onFilter={updateTradeFilter} align="right" width="120px" />
                            <Th label="确认时间" sortKey="updatedAt" filterKey={null} currentSort={tradeSort} onSort={toggleTradeSort} currentFilter={tradeFilters} onFilter={updateTradeFilter} align="center" width="140px"/>
                            <Th label="执行人" sortKey="executor" filterKey="executor" currentSort={tradeSort} onSort={toggleTradeSort} currentFilter={tradeFilters} onFilter={updateTradeFilter} align="center" />
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {displayTrades.length === 0 ? (
                            <tr><td colSpan={10} className="p-8 text-center text-gray-400">无匹配数据 或 已被基准日期过滤</td></tr>
                        ) : displayTrades.map(t => {
                            const rate = isHKDView ? (globalFxRates[t.market] || 1) : 1;
                            const displayCurrency = isHKDView ? 'HKD' : t.market;
                            return (
                                <tr key={t.id} className="hover:bg-blue-50/30 transition-colors">
                                    <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{t.date}</td>
                                    <td className="px-3 py-2 whitespace-nowrap">
                                        <div className="font-bold text-gray-800">{t.futuresName}</div>
                                        <div className="text-[10px] text-gray-400 font-mono">{t.futuresCode}</div>
                                    </td>
                                    <td className="px-3 py-2 text-center text-gray-600">{t.account}</td>
                                    <td className="px-3 py-2 text-center font-mono text-gray-500">{displayCurrency}</td>
                                    <td className="px-3 py-2 text-center">
                                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${t.direction === 'BUY' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>{t.direction === 'BUY' ? '买入' : '卖出'}</span>
                                    </td>
                                    <td className={`px-3 py-2 text-right font-mono font-bold ${t.quantity > 0 ? 'text-red-600' : 'text-green-600'}`}>
                                        {t.quantity > 0 ? '+' : ''}{t.quantity.toLocaleString(undefined, {maximumFractionDigits: 4})}
                                    </td>
                                    <td className="px-3 py-2 text-right font-mono text-gray-600">{(t.price * rate).toFixed(4)}</td>
                                    <td className="px-3 py-2 text-right font-mono text-gray-900 font-medium">{formatMoneyStr(t.amount * rate)}</td>
                                    <td className="px-3 py-2 text-center text-gray-400 text-[10px] whitespace-nowrap">{formatTime(t.updatedAt)}</td>
                                    <td className="px-3 py-2 text-center text-gray-500 text-[10px]">{t.executor}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>

        {/* === 模块 4：资金净买入二维统计表 === */}
        <div className="bg-teal-50 border border-teal-200 p-6 rounded-xl shadow-sm">
            <div className="flex justify-between items-center mb-4">
                <h3 className="font-bold text-teal-800 flex items-center gap-2 text-base">
                    <Database size={18}/> 资金净买入二维统计表
                </h3>
                <div className="flex items-center gap-4">
                    <span className="text-xs text-teal-600 font-medium">净买入 = 初始投入金额 + 买入金额 - 卖出金额 (自动入库)</span>
                    <button 
                        onClick={() => setIsHKDView(!isHKDView)}
                        className={`text-xs font-bold px-3 py-1.5 rounded transition-colors border ${isHKDView ? 'bg-teal-600 text-white border-teal-600 shadow-inner' : 'bg-white text-teal-700 border-teal-200 hover:bg-teal-100 shadow-sm'}`}
                    >
                        {isHKDView ? '恢复原始币种' : 'TO HKD (一键折算)'}
                    </button>
                </div>
            </div>
            <div className="overflow-x-auto rounded border border-teal-200 bg-white">
                <table className="min-w-full text-xs text-right">
                    <thead className="bg-teal-100/50 text-teal-900 font-medium">
                        <tr>
                            <th className="px-3 py-2 text-center border-b border-r border-teal-100 bg-teal-50/50">币种 \ 账户</th>
                            {cashStats.accounts.map(acc => (
                                <th key={acc} className="px-3 py-2 border-b border-teal-100">{acc}</th>
                            ))}
                            <th className="px-3 py-2 border-b border-l border-teal-100 bg-teal-50/50">SUM (HKD)</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-teal-50">
                        {cashStats.markets.map(mkt => {
                            const rate = isHKDView ? (globalFxRates[mkt] || 1) : 1;
                            const actualRate = globalFxRates[mkt] || 1;
                            let rawRowSum = 0;
                            return (
                                <tr key={mkt} className="hover:bg-teal-50/30">
                                    <td className="px-3 py-2 text-center font-bold text-gray-700 border-r border-teal-50 bg-teal-50/20">{mkt}</td>
                                    {cashStats.accounts.map(acc => {
                                        const rawVal = cashStats.rawMatrix[mkt][acc] || 0;
                                        rawRowSum += rawVal;
                                        const displayVal = rawVal * rate;
                                        return (
                                            <td key={acc} className={`px-3 py-2 font-mono ${displayVal > 0 ? 'text-red-600' : displayVal < 0 ? 'text-green-600' : 'text-gray-400'}`}>
                                                {displayVal > 0 ? '+' : ''}{displayVal === 0 ? '-' : formatMoneyStr(displayVal, isHKDView)}
                                            </td>
                                        );
                                    })}
                                    <td className={`px-3 py-2 font-mono font-bold border-l border-teal-50 bg-teal-50/20 ${rawRowSum * actualRate > 0 ? 'text-red-600' : rawRowSum * actualRate < 0 ? 'text-green-600' : 'text-gray-500'}`}>
                                        {rawRowSum * actualRate > 0 ? '+' : ''}{rawRowSum === 0 ? '-' : formatMoneyStr(rawRowSum * actualRate, true)}
                                    </td>
                                </tr>
                            );
                        })}
                        {cashStats.markets.length === 0 && (
                            <tr><td colSpan={cashStats.accounts.length + 2} className="px-3 py-4 text-center text-gray-400">暂无数据</td></tr>
                        )}
                    </tbody>
                    {cashStats.markets.length > 0 && (
                        <tfoot className="bg-teal-100 text-teal-900 border-t-2 border-teal-200 shadow-inner">
                            <tr>
                                <td className="px-3 py-3 text-center font-bold border-r border-teal-200">SUM (HKD)</td>
                                {cashStats.accounts.map(acc => {
                                    let colSumHKD = 0;
                                    cashStats.markets.forEach(mkt => {
                                        const rawVal = cashStats.rawMatrix[mkt][acc] || 0;
                                        colSumHKD += rawVal * (globalFxRates[mkt] || 1);
                                    });
                                    return (
                                        <td key={acc} className={`px-3 py-3 font-mono font-bold ${colSumHKD > 0 ? 'text-red-600' : colSumHKD < 0 ? 'text-green-600' : 'text-teal-900'}`}>
                                            {colSumHKD > 0 ? '+' : ''}{colSumHKD === 0 ? '-' : formatMoneyStr(colSumHKD, true)}
                                        </td>
                                    );
                                })}
                                <td className={`px-3 py-3 font-mono font-bold text-sm border-l border-teal-200 ${totalCashNetBuyHKD > 0 ? 'text-red-600' : totalCashNetBuyHKD < 0 ? 'text-green-600' : 'text-teal-900'}`}>
                                    {totalCashNetBuyHKD > 0 ? '+' : ''}{formatMoneyStr(totalCashNetBuyHKD, true)} HKD
                                </td>
                            </tr>
                        </tfoot>
                    )}
                </table>
            </div>
        </div>

        {/* === 模块 5：手动价格录入 === */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-200 flex justify-between items-center bg-gray-50">
                <div>
                    <h2 className="text-base font-bold text-gray-800 flex items-center gap-2">
                        <DollarSign size={18} className="text-emerald-500" />
                        输入标的当前价格 (手动估值校准)
                    </h2>
                    <p className="text-xs text-gray-500 mt-1">
                        系统自动提取持仓出现过的牛熊证和期货。请在此处更新最新市价，更新后上方总表将实时重估市值。
                    </p>
                </div>
            </div>
            <div className="overflow-x-auto">
                <table className="min-w-full text-xs text-left">
                    <thead className="bg-emerald-50 text-emerald-800 font-medium">
                        <tr>
                            <th className="px-4 py-3 whitespace-nowrap">【标的名称/简码】</th>
                            <th className="px-4 py-3 text-center whitespace-nowrap">【市场】</th>
                            <th className="px-4 py-3 text-right whitespace-nowrap">【当前价格】</th>
                            <th className="px-4 py-3 text-center whitespace-nowrap">【最后校准时间】</th>
                            <th className="px-4 py-3 text-center whitespace-nowrap">【操作】</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {uniqueFutures.length === 0 ? (
                            <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">系统未检测到任何持仓记录</td></tr>
                        ) : uniqueFutures.map(fund => {
                            const lastRec = cbbcPrices[fund.futuresCode];
                            const draftPrice = draftPrices[fund.futuresCode] ?? (lastRec?.price?.toString() || '');
                            const isChanged = draftPrice !== (lastRec?.price?.toString() || '');

                            return (
                                <tr key={fund.futuresCode} className="hover:bg-emerald-50/20 transition-colors">
                                    <td className="px-4 py-3">
                                        <div className="font-bold text-gray-800">{fund.futuresName}</div>
                                        <div className="text-[10px] text-gray-500 font-mono">{fund.futuresCode}</div>
                                    </td>
                                    <td className="px-4 py-3 text-center font-mono text-gray-500">{fund.market}</td>
                                    <td className="px-4 py-3 text-right">
                                        <input 
                                            type="number" 
                                            min="0"
                                            step="0.0001"
                                            value={draftPrice}
                                            onChange={e => setDraftPrices({...draftPrices, [fund.futuresCode]: e.target.value})}
                                            className={`w-28 p-1.5 border rounded text-right outline-none text-xs font-mono focus:ring-1 focus:ring-emerald-400 ${isChanged ? 'bg-yellow-50 border-yellow-300 text-yellow-800' : 'bg-white border-gray-200'}`}
                                            placeholder="如: 1.0500"
                                        />
                                    </td>
                                    <td className="px-4 py-3 text-center text-gray-500 font-mono">
                                        {lastRec ? formatTime(lastRec.updatedAt) : <span className="text-gray-300">尚未录入</span>}
                                    </td>
                                    <td className="px-4 py-3 text-center">
                                        <div className="flex items-center justify-center gap-2">
                                            <button 
                                                onClick={() => handleSavePrice(fund.futuresCode, fund.market, fund.futuresName)}
                                                disabled={!isChanged}
                                                className={`px-3 py-1.5 rounded font-bold text-xs shadow-sm flex items-center justify-center gap-1 transition-colors ${isChanged ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}
                                            >
                                                <Save size={14} /> 保存净值
                                            </button>
                                            {lastRec && (
                                                <button 
                                                    onClick={() => handleDeletePrice(fund.futuresCode)}
                                                    className="px-2 py-1.5 rounded text-xs shadow-sm flex items-center justify-center gap-1 text-red-500 hover:bg-red-50 hover:text-red-700 transition-colors border border-red-100 bg-white"
                                                    title="删除该估值记录"
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>

        {/* === 模块 6：期初持仓底座 === */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-200 flex justify-between items-center bg-gray-50">
                <h2 className="text-base font-bold text-gray-800 flex items-center gap-2">
                    <Database size={18} className="text-purple-500" />
                    初始标的持仓 (期初建账底座)
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
                            <th className="px-4 py-3 whitespace-nowrap">标的简码 (Code)</th>
                            <th className="px-4 py-3 whitespace-nowrap">名称</th>
                            <th className="px-4 py-3 text-center whitespace-nowrap">币种</th>
                            <th className="px-4 py-3 text-center whitespace-nowrap">账户</th>
                            <th className="px-4 py-3 text-right whitespace-nowrap">期初份额数量</th>
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
                                <td className="px-4 py-2 font-bold text-gray-800 font-mono">{h.futuresCode}</td>
                                <td className="px-4 py-2 text-gray-600">{h.futuresName}</td>
                                <td className="px-4 py-2 text-center font-mono text-gray-500">{h.market}</td>
                                <td className="px-4 py-2 text-center text-gray-600">{h.account}</td>
                                <td className="px-4 py-2 text-right font-mono text-gray-800">{h.quantity.toLocaleString()}</td>
                                <td className="px-4 py-2 text-right font-mono text-gray-600">{h.costPrice.toFixed(4)}</td>
                                <td className="px-4 py-2 text-right font-mono font-medium">{formatMoneyStr(amt, isHKDView)}</td>
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
                                <input type="text" placeholder="如 50012.HK" value={newInit.futuresCode} onChange={e => setNewInit({...newInit, futuresCode: e.target.value.toUpperCase().trim()})} className="w-full p-1.5 border border-purple-200 rounded text-xs font-mono outline-none focus:ring-1 focus:ring-purple-400" />
                            </td>
                            <td className="px-4 py-2">
                                <input type="text" placeholder="输入全称" value={newInit.futuresName} onChange={e => setNewInit({...newInit, futuresName: e.target.value.trim()})} className="w-full p-1.5 border border-purple-200 rounded text-xs outline-none focus:ring-1 focus:ring-purple-400" />
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
                                <input type="number" min="0" placeholder="数量" value={newInit.quantity || ''} onChange={e => setNewInit({...newInit, quantity: parseFloat(e.target.value)||0})} className="w-full p-1.5 border border-purple-200 rounded text-xs outline-none text-right font-mono focus:ring-1 focus:ring-purple-400" />
                            </td>
                            <td className="px-4 py-2">
                                <input type="number" min="0" step="0.0001" placeholder="成本均价" value={newInit.costPrice || ''} onChange={e => setNewInit({...newInit, costPrice: parseFloat(e.target.value)||0})} className="w-full p-1.5 border border-purple-200 rounded text-xs outline-none text-right font-mono focus:ring-1 focus:ring-purple-400" />
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

            {/* 期初投入二维统计矩阵 */}
            <div className="mt-6 bg-purple-50 border-t border-purple-100 p-5 rounded-lg">
                <div className="flex justify-between items-center mb-3">
                    <h3 className="font-bold text-purple-800 text-sm">期初投入二维统计矩阵</h3>
                    <div className="flex items-center gap-4">
                        <span className="text-xs text-purple-600">采用锁定的建账汇率计算，确保历史成本恒定</span>
                        <button 
                            onClick={() => setIsHKDView(!isHKDView)}
                            className={`text-xs font-bold px-3 py-1.5 rounded transition-colors border ${isHKDView ? 'bg-purple-600 text-white border-purple-600 shadow-inner' : 'bg-white text-purple-700 border-purple-200 hover:bg-purple-100 shadow-sm'}`}
                        >
                            {isHKDView ? '恢复原始币种' : 'TO HKD (一键折算)'}
                        </button>
                    </div>
                </div>
                <div className="overflow-x-auto rounded border border-purple-200 bg-white">
                    <table className="min-w-full text-xs text-right">
                        <thead className="bg-purple-100/50 text-purple-900 font-medium">
                            <tr>
                                <th className="px-3 py-2 text-center border-b border-r border-purple-100 bg-purple-50/50">币种 \ 账户</th>
                                {initialStats.accounts.map(acc => (
                                    <th key={acc} className="px-3 py-2 border-b border-purple-100">{acc}</th>
                                ))}
                                <th className="px-3 py-2 border-b border-l border-purple-100 bg-purple-50/50">SUM (HKD)</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-purple-50">
                            {initialStats.markets.map(mkt => {
                                const rate = isHKDView ? (baseFxRates[mkt] || globalFxRates[mkt] || 1) : 1;
                                const actualRate = baseFxRates[mkt] || globalFxRates[mkt] || 1;
                                let rawRowSum = 0;
                                return (
                                    <tr key={mkt} className="hover:bg-purple-50/30">
                                        <td className="px-3 py-2 text-center font-bold text-gray-700 border-r border-purple-50 bg-purple-50/20">{mkt}</td>
                                        {initialStats.accounts.map(acc => {
                                            const rawVal = initialStats.rawMatrix[mkt][acc] || 0;
                                            rawRowSum += rawVal;
                                            const displayVal = rawVal * rate;
                                            return (
                                                <td key={acc} className="px-3 py-2 font-mono text-gray-700">
                                                    {displayVal === 0 ? '-' : formatMoneyStr(displayVal, isHKDView)}
                                                </td>
                                            );
                                        })}
                                        <td className="px-3 py-2 font-mono font-bold text-purple-900 border-l border-purple-50 bg-purple-50/20">
                                            {rawRowSum * actualRate === 0 ? '-' : formatMoneyStr(rawRowSum * actualRate, true)}
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
                                                {colSumHKD === 0 ? '-' : formatMoneyStr(colSumHKD, true)}
                                            </td>
                                        );
                                    })}
                                    <td className="px-3 py-3 font-mono font-bold text-sm border-l border-purple-200 text-purple-900">
                                        {formatMoneyStr(
                                            initialStats.markets.reduce((sum, mkt) => {
                                                let mSum = 0;
                                                initialStats.accounts.forEach(a => mSum += initialStats.rawMatrix[mkt][a] || 0);
                                                return sum + mSum * (baseFxRates[mkt] || globalFxRates[mkt] || 1);
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
                            await setDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'sip_holding_cbbc_start', '_global_config'), { baseFxRates: parsed }, { merge: true });
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