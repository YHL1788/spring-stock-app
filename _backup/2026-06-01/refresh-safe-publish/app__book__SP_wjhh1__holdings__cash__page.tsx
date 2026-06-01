'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { 
  Building2, 
  Database,
  Save,
  Trash2,
  RefreshCw,
  Loader2, 
  AlertCircle,
  X,
  Info,
  Clock,
  FileJson,
  BarChart,
  PieChart,
  ListOrdered
} from 'lucide-react';
import { 
  collection, 
  addDoc, 
  deleteDoc, 
  setDoc, 
  doc, 
  onSnapshot, 
  query, 
  getDocs,
  updateDoc
} from 'firebase/firestore';
import { onAuthStateChanged, signInAnonymously, signInWithCustomToken } from 'firebase/auth';

import { db, auth, APP_ID } from '@/app/lib/stockService';

// --- 时间辅助函数 ---
const getTime = (val: any) => {
    if (!val) return 0;
    if (val.toMillis && typeof val.toMillis === 'function') return val.toMillis();
    if (val.seconds) return val.seconds * 1000;
    return new Date(val).getTime() || 0;
};

const formatTime = (val: any) => {
    if (!val) return null;
    if (val.toDate && typeof val.toDate === 'function') return val.toDate().toLocaleString();
    if (val.seconds) return new Date(val.seconds * 1000).toLocaleString();
    return new Date(val).toLocaleString();
};

// --- 类型定义 ---
interface InitialCash {
  id: string;
  currency: string;
  account: string;
  amount: number;
}

interface CashTrade {
  id: string;
  date: string;
  account: string;
  currency: string;
  amount: number; 
  type: string;
  fxGroupId?: string;
}

interface SummaryMatrix {
  accounts: string[];
  markets: string[];
  rawMatrix: Record<string, Record<string, number>>;
}

const CURRENCIES = ['USD', 'CNY', 'HKD', 'JPY'];

export default function CashHoldingsPage() {
  const [user, setUser] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // --- 数据源 (并发读取 7 个 DB) ---
  const [initialCashList, setInitialCashList] = useState<InitialCash[]>([]);
  const [cashTrades, setCashTrades] = useState<CashTrade[]>([]);
  const [baseDate, setBaseDate] = useState<string>('');
  
  const [spotSummary, setSpotSummary] = useState<SummaryMatrix | null>(null);
  const [peSummary, setPeSummary] = useState<SummaryMatrix | null>(null);
  const [cbbcSummary, setCbbcSummary] = useState<SummaryMatrix | null>(null);
  const [optionSummary, setOptionSummary] = useState<SummaryMatrix | null>(null);
  const [fcnSummary, setFcnSummary] = useState<SummaryMatrix | null>(null);

  // --- 汇率与视图状态 ---
  const [baseFxRates, setBaseFxRates] = useState<Record<string, number>>({});
  const [globalFxRates, setGlobalFxRates] = useState<Record<string, number>>({});
  const [isFetchingFx, setIsFetchingFx] = useState(false);
  const [showBaseFxModal, setShowBaseFxModal] = useState(false);
  const [draftBaseFx, setDraftBaseFx] = useState<Record<string, string>>({});
  const [showFxModal, setShowFxModal] = useState(false);
  const [isHKDView, setIsHKDView] = useState(false);

  // --- 录入表单状态 ---
  const [newInit, setNewInit] = useState({ currency: 'USD', account: '', amount: 0 });
  const [submittingInit, setSubmittingInit] = useState(false);

  // --- 保存状态 ---
  const [lastMktValSavedTime, setLastMktValSavedTime] = useState<string>('未获取');
  const [isSavingMktVal, setIsSavingMktVal] = useState(false);

  const [lastPlSavedTime, setLastPlSavedTime] = useState<string>('未获取');
  const [isSavingPl, setIsSavingPl] = useState(false);

  // --- 数据库管理模块状态 ---
  const [activeDbTab, setActiveDbTab] = useState('sip_trade_cash');
  const [dbRecords, setDbRecords] = useState<any[]>([]);
  const [loadingDb, setLoadingDb] = useState(false);
  const [editRecordModal, setEditRecordModal] = useState<{show: boolean, record: any, rawJson: string} | null>(null);

  // --- 数据订阅 (实时同步) ---
  useEffect(() => {
    let unsubs: (() => void)[] = [];

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

        onAuthStateChanged(auth, (currentUser) => {
          setUser(currentUser);
          if (currentUser) {
            // 1. 期初现金数据库
            unsubs.push(onSnapshot(collection(db, 'artifacts', APP_ID, 'public', 'data', 'sip_holding_cash_start'), (snapshot) => {
                const starts: InitialCash[] = [];
                let bDate = '';
                let bFx: Record<string, number> = {};
                snapshot.forEach(docSnap => {
                    if (docSnap.id === '_global_config') {
                        bDate = docSnap.data().baseDate || '';
                        bFx = docSnap.data().baseFxRates || {};
                    } else {
                        starts.push({ id: docSnap.id, ...docSnap.data() } as InitialCash);
                    }
                });
                setBaseDate(bDate);
                setBaseFxRates(bFx);
                setInitialCashList(starts);
            }));

            // 2. 资金流水数据库
            unsubs.push(onSnapshot(collection(db, 'artifacts', APP_ID, 'public', 'data', 'sip_trade_cash'), (snapshot) => {
                const trades: CashTrade[] = [];
                snapshot.forEach(docSnap => {
                    trades.push({ id: docSnap.id, ...docSnap.data() } as CashTrade);
                });
                setCashTrades(trades);
            }));

            // 3-7. 各业务线的最新净买入总结
            const summaries = [
                { path: 'sip_holding_cash_stock', setter: setSpotSummary }, 
                { path: 'sip_holding_cash_pe', setter: setPeSummary },
                { path: 'sip_holding_cash_cbbc', setter: setCbbcSummary },
                { path: 'sip_holding_cash_option', setter: setOptionSummary },
                { path: 'sip_holding_cash_fcn', setter: setFcnSummary },
            ];

            summaries.forEach(({ path, setter }) => {
                unsubs.push(onSnapshot(doc(db, 'artifacts', APP_ID, 'public', 'data', path, 'latest_summary'), (docSnap) => {
                    if (docSnap.exists()) setter(docSnap.data() as SummaryMatrix);
                    else setter(null);
                }));
            });

            // 8. 最新保存时间的获取 (mktvalue 和 pl)
            unsubs.push(onSnapshot(doc(db, 'artifacts', APP_ID, 'public', 'data', 'sip_holding_cash_mktvalue', 'latest_summary'), (docSnap) => {
                if (docSnap.exists()) {
                    const data = docSnap.data();
                    if (data.updatedAt) setLastMktValSavedTime(new Date(data.updatedAt).toLocaleString('zh-CN', { hour12: false }));
                }
            }));
            unsubs.push(onSnapshot(doc(db, 'artifacts', APP_ID, 'public', 'data', 'sip_holding_cash_pl', 'latest_summary'), (docSnap) => {
                if (docSnap.exists()) {
                    const data = docSnap.data();
                    if (data.updatedAt) setLastPlSavedTime(new Date(data.updatedAt).toLocaleString('zh-CN', { hour12: false }));
                }
            }));

            setLoading(false);
          }
        });
      } catch (err: any) {
        setError(`初始化失败: ${err.message}`);
        setLoading(false);
      }
    };

    initData();
    return () => { unsubs.forEach(unsub => unsub()); };
  }, []);

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
             const timeA = a.date ? new Date(a.date).getTime() : (getTime(a.updatedAt) || getTime(a.createdAt));
             const timeB = b.date ? new Date(b.date).getTime() : (getTime(b.updatedAt) || getTime(b.createdAt));
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
      } catch(e: any) {
          alert("修改失败 (请检查 JSON 格式是否正确): \n" + e.message);
      }
  };

  const getRecordSummary = (r: any, tab: string) => {
      try {
          if (tab === 'sip_trade_cash') {
              return `[${r.type}] ${r.amount > 0 ? '+' : ''}${r.amount} ${r.currency} | ${r.account}`;
          }
          if (tab === 'sip_holding_cash_start') {
              if (r.id === '_global_config') return `全局基准配置`;
              return `[期初] ${r.amount} ${r.currency} | ${r.account}`;
          }
          if (tab.includes('mktvalue') || tab.includes('pl') || tab.includes('cash_')) {
              const time = formatTime(r.updatedAt) || formatTime(r.createdAt) || 'N/A';
              return `全盘大盘统计快照 (更新于: ${time})`;
          }
          return JSON.stringify(r).substring(0, 100) + '...';
      } catch (e) {
          return '解析失败...';
      }
  };

  // --- 根据基准日过滤后的有效资金流水 ---
  const activeCashTrades = useMemo(() => {
      return cashTrades.filter(t => !baseDate || t.date > baseDate);
  }, [cashTrades, baseDate]);

  // --- 实时汇率获取 ---
  const fetchFxRates = async () => {
    setIsFetchingFx(true);
    try {
      const newRates: Record<string, number> = { 'HKD': 1.0 };
      await Promise.all(CURRENCIES.filter(c => c !== 'HKD').map(async (currency) => {
          try {
              const res = await fetch(`/api/quote?currency=${currency}`);
              if (res.ok) {
                  const data = await res.json();
                  if (data && data.rate) newRates[currency] = data.rate;
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
      fetchFxRates();
  }, []);

  // --- 核心计算 1：当前现金市值二维统计矩阵 ---
  const currentCashStats = useMemo(() => {
      const allAccounts = new Set<string>();
      const allCurrencies = new Set<string>();

      initialCashList.forEach(i => { allAccounts.add(i.account); allCurrencies.add(i.currency); });
      activeCashTrades.forEach(t => { allAccounts.add(t.account); allCurrencies.add(t.currency); });
      
      const subMods = [spotSummary, peSummary, cbbcSummary, optionSummary, fcnSummary];
      subMods.forEach(mod => {
          if (!mod) return;
          (mod.accounts || []).forEach(a => allAccounts.add(a));
          (mod.markets || []).forEach(m => allCurrencies.add(m));
      });

      const accounts = Array.from(allAccounts).sort();
      const markets = Array.from(allCurrencies).sort();
      
      const rawMatrix: Record<string, Record<string, number>> = {};
      markets.forEach(m => {
          rawMatrix[m] = {};
          accounts.forEach(a => rawMatrix[m][a] = 0);
      });

      // 1. 期初现金
      initialCashList.forEach(i => {
          if (i.currency && i.account) rawMatrix[i.currency][i.account] += i.amount;
      });

      // 2. 中央资金流水 (含出入金、红利、费用、换汇等)
      activeCashTrades.forEach(t => {
          if (t.currency && t.account) rawMatrix[t.currency][t.account] += t.amount;
      });

      // 3. 减去各业务线的资金占用
      subMods.forEach(mod => {
          if (!mod || !mod.rawMatrix) return;
          (mod.markets || []).forEach(m => {
              (mod.accounts || []).forEach(a => {
                  if (rawMatrix[m] && rawMatrix[m][a] !== undefined) {
                      rawMatrix[m][a] -= (mod.rawMatrix[m][a] || 0);
                  }
              });
          });
      });

      return { accounts, markets, rawMatrix };
  }, [initialCashList, activeCashTrades, spotSummary, peSummary, cbbcSummary, optionSummary, fcnSummary]);

  // --- 核心计算 2：现金流业绩归因 (红利/费用/利息/换汇) ---
  const cashBreakdownStats = useMemo(() => {
      // 结构: breakdowns[currency] = { DIVIDEND, FEE, INTEREST, FX, TOTAL }
      const breakdowns: Record<string, { DIVIDEND: number, FEE: number, INTEREST: number, FX: number, TOTAL: number }> = {};
      const initMkt = (c: string) => {
          if (!breakdowns[c]) breakdowns[c] = { DIVIDEND: 0, FEE: 0, INTEREST: 0, FX: 0, TOTAL: 0 };
      };

      // 处理单边非交易流水
      activeCashTrades.forEach(t => {
          if (['DIVIDEND', 'FEE', 'INTEREST'].includes(t.type)) {
              initMkt(t.currency);
              breakdowns[t.currency][t.type as 'DIVIDEND'|'FEE'|'INTEREST'] += t.amount;
              breakdowns[t.currency].TOTAL += t.amount;
          }
      });

      // 处理 FX 外汇机会成本追踪
      const fxGroups: Record<string, { out: CashTrade | null, in: CashTrade | null }> = {};
      activeCashTrades.filter(t => t.type === 'FX' && t.fxGroupId).forEach(t => {
          if (!fxGroups[t.fxGroupId!]) fxGroups[t.fxGroupId!] = { out: null, in: null };
          if (t.amount < 0) fxGroups[t.fxGroupId!].out = t;
          if (t.amount > 0) fxGroups[t.fxGroupId!].in = t;
      });

      Object.values(fxGroups).forEach(group => {
          if (group.out && group.in) {
              const outCcy = group.out.currency;
              const inCcy = group.in.currency;
              const rateOut = globalFxRates[outCcy] || 1;
              const rateIn = globalFxRates[inCcy] || 1;

              // 公式: 实际拿到买入币种金额 - 预期可换得的买入币种金额
              if (rateIn > 0) {
                  const expectedInAmount = Math.abs(group.out.amount) * (rateOut / rateIn);
                  const fxPnl = group.in.amount - expectedInAmount;
                  initMkt(inCcy); // 挂载在买入流入币种上
                  breakdowns[inCcy].FX += fxPnl;
                  breakdowns[inCcy].TOTAL += fxPnl;
              }
          }
      });

      const currencies = Object.keys(breakdowns).sort();
      return { currencies, breakdowns };
  }, [activeCashTrades, globalFxRates]);

  // 包装为标准 `currentPlStats` 以供大盘入库
  const currentPlStats = useMemo(() => {
      const rawMatrix: Record<string, { realized: number, unrealized: number, total: number }> = {};
      cashBreakdownStats.currencies.forEach(c => {
          rawMatrix[c] = {
              realized: cashBreakdownStats.breakdowns[c].TOTAL, // 全部为已实现
              unrealized: 0, // 现金盈亏的未实现恒定为 0
              total: cashBreakdownStats.breakdowns[c].TOTAL
          };
      });
      return { markets: cashBreakdownStats.currencies, rawMatrix };
  }, [cashBreakdownStats]);

  // --- 期初现金本金的统计 ---
  const initialCashStats = useMemo(() => {
      const accountsSet = new Set<string>();
      const marketsSet = new Set<string>();
      initialCashList.forEach(i => { accountsSet.add(i.account); marketsSet.add(i.currency); });
      const accounts = Array.from(accountsSet).sort();
      const markets = Array.from(marketsSet).sort();
      
      const rawMatrix: Record<string, Record<string, number>> = {};
      markets.forEach(m => {
          rawMatrix[m] = {};
          accounts.forEach(a => rawMatrix[m][a] = 0);
      });
      initialCashList.forEach(i => { rawMatrix[i.currency][i.account] += i.amount; });
      return { accounts, markets, rawMatrix };
  }, [initialCashList]);

  // --- 入库逻辑 ---
  const handleSaveMktValStats = async (isAuto = false) => {
      // 移除 currentCashStats.accounts.length === 0 判断，允许空矩阵入库
      if (!user) return;
      if (!isAuto) setIsSavingMktVal(true);
      try {
          const payload = {
              accounts: currentCashStats.accounts,
              markets: currentCashStats.markets,
              rawMatrix: currentCashStats.rawMatrix,
              updatedAt: new Date().toISOString()
          };
          await setDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'sip_holding_cash_mktvalue', 'latest_summary'), payload);
          if (!isAuto) setLastMktValSavedTime(new Date().toLocaleString('zh-CN', { hour12: false }));
      } catch (e) {
          console.error("保存现金市值失败", e);
      } finally {
          if (!isAuto) setIsSavingMktVal(false);
      }
  };

  const handleSavePlStats = async (isAuto = false) => {
      // 移除 currentPlStats.markets.length === 0 判断，允许空矩阵入库
      if (!user) return;
      if (!isAuto) setIsSavingPl(true);
      try {
          const payload = {
              markets: currentPlStats.markets,
              rawMatrix: currentPlStats.rawMatrix,
              updatedAt: new Date().toISOString()
          };
          await setDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'sip_holding_cash_pl', 'latest_summary'), payload);
          if (!isAuto) setLastPlSavedTime(new Date().toLocaleString('zh-CN', { hour12: false }));
      } catch (e) {
          console.error("保存收益统计失败:", e);
      } finally {
          if (!isAuto) setIsSavingPl(false);
      }
  };

  // 每分钟静默后台保存与刷新
  useEffect(() => {
      if (!user) return;
      const intervalId = setInterval(() => {
          fetchFxRates(); 
          handleSaveMktValStats(true); 
          handleSavePlStats(true); 
      }, 60000); 
      return () => clearInterval(intervalId);
  }, [user, currentCashStats, currentPlStats]);

  // --- 期初数据管理 ---
  const handleUpdateBaseDate = async (newDate: string) => {
      setBaseDate(newDate);
      try {
          await setDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'sip_holding_cash_start', '_global_config'), { baseDate: newDate }, { merge: true });
      } catch (e) { console.error("日期更新失败", e); }
  };

  const handleAddInitial = async () => {
      if (!newInit.currency || !newInit.account) {
          alert('请正确填写币种和账户');
          return;
      }
      setSubmittingInit(true);
      try {
          await addDoc(collection(db, 'artifacts', APP_ID, 'public', 'data', 'sip_holding_cash_start'), newInit);
          setNewInit({ currency: 'USD', account: '', amount: 0 });
      } catch (e) { alert('添加期初现金记录失败'); } 
      finally { setSubmittingInit(false); }
  };

  const handleDeleteInitial = async (id: string) => {
      if (!confirm('确认删除这条期初现金记录吗？')) return;
      try { await deleteDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'sip_holding_cash_start', id)); } 
      catch (e) { console.error("删除失败", e); }
  };

  const formatMoney = (val: number) => val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const formatMoneyWithSign = (val: number) => {
      const sign = val > 0 ? '+' : '';
      return `${sign}${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="animate-spin text-blue-600" size={40}/></div>;

  return (
    <div className="space-y-8 pb-10 max-w-[1500px] mx-auto px-4">
        {/* === Header === */}
        <div className="border-b border-gray-200 pb-4 pt-4 flex justify-between items-end">
            <div>
                <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                    <Database className="text-emerald-600" />
                    Cash Holding (中央现金总账)
                </h1>
                <p className="mt-1 text-sm text-gray-500">
                    全局资金池的实时汇总。统合计算期初资金、纯资金流水以及全业务线的资金占用。
                </p>
            </div>
            <div className="flex gap-2">
                 <button 
                    onClick={() => setShowFxModal(true)} 
                    className="px-3 py-2 text-sm rounded border bg-white hover:bg-gray-50 text-gray-600 transition-colors shadow-sm flex items-center gap-1"
                >
                    <Info size={16} className="text-emerald-500" />
                    汇率详情
                </button>
                 <button 
                    onClick={() => fetchFxRates()} 
                    disabled={isFetchingFx}
                    className="px-4 py-2 text-sm rounded border bg-white hover:bg-gray-50 flex items-center gap-2 text-gray-600 transition-colors shadow-sm"
                >
                    <RefreshCw size={16} className={isFetchingFx ? 'animate-spin' : ''} />
                    更新
                </button>
            </div>
        </div>

        {error && (
            <div className="bg-red-50 p-4 rounded text-red-700 flex items-center gap-2">
                <AlertCircle size={20}/> {error}
            </div>
        )}

        {/* === 模块 1：当前现金市值 2D 统计表 === */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="bg-emerald-50 border-b border-emerald-100 p-5">
                <div className="flex justify-between items-center mb-3">
                    <h3 className="font-bold text-emerald-800 text-sm flex items-center gap-2">
                        <PieChart size={18} />
                        当前现金二维统计表 (市值 MktVal)
                    </h3>
                    <div className="flex items-center gap-4">
                        <span className="text-xs text-emerald-600">可用现金 = 期初本金 + 资金流出入 - 各业务线净买入</span>
                        <button 
                            onClick={() => setIsHKDView(!isHKDView)}
                            className={`text-xs font-bold px-3 py-1.5 rounded transition-colors border ${isHKDView ? 'bg-emerald-600 text-white border-emerald-600 shadow-inner' : 'bg-white text-emerald-700 border-emerald-200 hover:bg-emerald-100 shadow-sm'}`}
                        >
                            {isHKDView ? '恢复原始币种' : 'TO HKD (一键折算)'}
                        </button>
                    </div>
                </div>
                
                <div className="overflow-x-auto rounded border border-emerald-200 bg-white">
                    <table className="min-w-full text-xs text-right">
                        <thead className="bg-emerald-100/50 text-emerald-900 font-medium">
                            <tr>
                                <th className="px-3 py-3 text-center border-b border-r border-emerald-100 bg-emerald-50/50">币种 \ 账户</th>
                                {currentCashStats.accounts.map(acc => (
                                    <th key={acc} className="px-3 py-3 border-b border-emerald-100">{acc}</th>
                                ))}
                                <th className="px-3 py-3 border-b border-l border-emerald-100 bg-emerald-50/50">SUM {isHKDView ? '(HKD)' : '(原币种)'}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-emerald-50">
                            {currentCashStats.markets.map(mkt => {
                                const rate = isHKDView ? (globalFxRates[mkt] || 1) : 1;
                                let rowSum = 0;
                                return (
                                    <tr key={mkt} className="hover:bg-emerald-50/30">
                                        <td className="px-3 py-3 text-center font-bold text-gray-700 border-r border-emerald-50 bg-emerald-50/20">{mkt}</td>
                                        {currentCashStats.accounts.map(acc => {
                                            const rawVal = currentCashStats.rawMatrix[mkt][acc] || 0;
                                            const displayVal = rawVal * rate;
                                            rowSum += displayVal;
                                            return (
                                                <td key={acc} className={`px-3 py-3 font-mono ${displayVal > 0 ? 'text-gray-900' : displayVal < 0 ? 'text-red-600' : 'text-gray-400'}`}>
                                                    {displayVal === 0 ? '-' : formatMoney(displayVal)}
                                                </td>
                                            );
                                        })}
                                        <td className={`px-3 py-3 font-mono font-bold border-l border-emerald-50 bg-emerald-50/20 ${rowSum > 0 ? 'text-emerald-900' : rowSum < 0 ? 'text-red-700' : 'text-gray-500'}`}>
                                            {rowSum === 0 ? '-' : formatMoney(rowSum)}
                                        </td>
                                    </tr>
                                );
                            })}
                            {currentCashStats.markets.length === 0 && (
                                <tr><td colSpan={currentCashStats.accounts.length + 2} className="px-3 py-6 text-center text-gray-400">暂无数据</td></tr>
                            )}
                        </tbody>
                        {currentCashStats.markets.length > 0 && (
                            <tfoot className="bg-emerald-100 text-emerald-900 border-t-2 border-emerald-200 shadow-inner">
                                <tr>
                                    <td className="px-3 py-4 text-center font-bold border-r border-emerald-200">
                                        {isHKDView ? 'SUM (HKD)' : 'SUM (无效)'}
                                    </td>
                                    {currentCashStats.accounts.map(acc => {
                                        if (!isHKDView) return <td key={acc} className="px-3 py-4 text-center font-mono text-gray-400">-</td>;
                                        
                                        let colSumHKD = 0;
                                        currentCashStats.markets.forEach(mkt => {
                                            const rawVal = currentCashStats.rawMatrix[mkt][acc] || 0;
                                            colSumHKD += rawVal * (globalFxRates[mkt] || 1);
                                        });
                                        return (
                                            <td key={acc} className={`px-3 py-4 font-mono font-bold ${colSumHKD > 0 ? 'text-emerald-900' : colSumHKD < 0 ? 'text-red-700' : 'text-gray-500'}`}>
                                                {colSumHKD === 0 ? '-' : formatMoney(colSumHKD)}
                                            </td>
                                        );
                                    })}
                                    <td className="px-3 py-4 font-mono font-bold text-sm border-l border-emerald-200 bg-emerald-200/50 text-emerald-900">
                                        {!isHKDView ? <span className="text-gray-400">-</span> : (
                                            formatMoney(
                                                currentCashStats.markets.reduce((sum, mkt) => {
                                                    let rSum = 0;
                                                    currentCashStats.accounts.forEach(a => rSum += currentCashStats.rawMatrix[mkt][a] || 0);
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

            <div className="px-6 py-4 bg-white border-t border-gray-100 flex items-center justify-between">
                <div className="flex items-center gap-4 text-xs text-gray-500">
                    <span className="flex items-center gap-1.5"><Clock size={15} className="text-emerald-500" /> 最后入库时间: <span className="font-mono font-medium text-gray-700">{lastMktValSavedTime}</span></span>
                    <span className="text-[10px] bg-emerald-50 text-emerald-600 px-2 py-1 rounded border border-emerald-100">※每分钟自动刷新入库</span>
                </div>
                <div className="flex items-center gap-3">
                    <button 
                        onClick={() => fetchFxRates()} disabled={isFetchingFx}
                        className="flex items-center gap-2 px-6 py-2 bg-white border border-emerald-600 text-emerald-600 hover:bg-emerald-50 text-sm font-bold rounded-lg shadow-sm transition-colors disabled:opacity-50"
                    >
                        <RefreshCw size={16} className={isFetchingFx ? 'animate-spin' : ''} /> 手动刷新
                    </button>
                    <button 
                        onClick={() => handleSaveMktValStats(false)} disabled={isSavingMktVal}
                        className="flex items-center gap-2 px-6 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold rounded-lg shadow-sm transition-colors disabled:opacity-50"
                    >
                        {isSavingMktVal ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} 手动保存入库
                    </button>
                </div>
            </div>
        </div>

        {/* === 模块 2：双重视野收益表 === */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* 左侧：标准的收益入库矩阵 */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden flex flex-col">
                <div className="bg-rose-50 border-b border-rose-100 p-5">
                    <div className="flex justify-between items-center mb-3">
                        <h3 className="font-bold text-rose-800 text-sm flex items-center gap-2">
                            <BarChart size={18} /> 当前收益统计表 (入库标准件)
                        </h3>
                        <button 
                            onClick={() => setIsHKDView(!isHKDView)}
                            disabled={isFetchingFx}
                            className={`text-xs font-bold px-3 py-1.5 rounded transition-colors border ${isHKDView ? 'bg-rose-600 text-white border-rose-600 shadow-inner' : 'bg-white text-rose-700 border-rose-200 hover:bg-rose-100 shadow-sm'}`}
                        >
                            {isFetchingFx && <Loader2 size={12} className="animate-spin inline mr-1" />}
                            {isHKDView ? '恢复原始币种' : 'TO HKD (一键折算)'}
                        </button>
                    </div>
                    <p className="text-[10px] text-rose-600 mb-3">出入金不计盈亏。现金资产无“未实现浮盈”，所有利息、红利及外汇机会成本均计入“已实现”。</p>
                    
                    <div className="overflow-x-auto rounded border border-rose-200 bg-white">
                        <table className="min-w-full text-xs text-right">
                            <thead className="bg-rose-100/50 text-rose-900 font-medium">
                                <tr>
                                    <th className="px-3 py-2 text-center border-b border-r border-rose-100 bg-rose-50/50">币种</th>
                                    <th className="px-3 py-2 border-b border-rose-100">已实现盈亏 (内生与换汇)</th>
                                    <th className="px-3 py-2 border-b border-rose-100 text-gray-400">浮动盈亏 (恒定为 0)</th>
                                    <th className="px-3 py-2 border-b border-l border-rose-100 bg-rose-50/50">总盈亏 {isHKDView ? '(HKD)' : '(原币种)'}</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-rose-50">
                                {currentPlStats.markets.map(mkt => {
                                    const rate = isHKDView ? (globalFxRates[mkt] || 1) : 1;
                                    const data = currentPlStats.rawMatrix[mkt];
                                    const displayRealized = data.realized * rate;
                                    const displayTotal = data.total * rate;
                                    return (
                                        <tr key={mkt} className="hover:bg-rose-50/30">
                                            <td className="px-3 py-2 text-center font-bold text-gray-700 border-r border-rose-50 bg-rose-50/20">{mkt}</td>
                                            <td className={`px-3 py-3 font-mono font-bold ${displayRealized > 0 ? 'text-red-600' : displayRealized < 0 ? 'text-green-600' : 'text-gray-400'}`}>
                                                {displayRealized === 0 ? '-' : formatMoneyWithSign(displayRealized)}
                                            </td>
                                            <td className="px-3 py-3 font-mono text-gray-300">-</td>
                                            <td className={`px-3 py-3 font-mono font-bold border-l border-rose-50 bg-rose-50/20 ${displayTotal > 0 ? 'text-red-700' : displayTotal < 0 ? 'text-green-700' : 'text-gray-500'}`}>
                                                {displayTotal === 0 ? '-' : formatMoneyWithSign(displayTotal)}
                                            </td>
                                        </tr>
                                    );
                                })}
                                {currentPlStats.markets.length === 0 && (
                                    <tr><td colSpan={4} className="px-3 py-6 text-center text-gray-400">暂无收益数据</td></tr>
                                )}
                            </tbody>
                            {currentPlStats.markets.length > 0 && (
                                <tfoot className="bg-rose-100 text-rose-900 border-t-2 border-rose-200 shadow-inner">
                                    <tr>
                                        <td className="px-3 py-4 text-center font-bold border-r border-rose-200">
                                            {isHKDView ? 'SUM (HKD)' : 'SUM (无效)'}
                                        </td>
                                        <td className={`px-3 py-4 font-mono font-bold ${!isHKDView ? 'text-gray-400' : 'text-indigo-900'}`}>
                                            {!isHKDView ? '-' : formatMoneyWithSign(
                                                currentPlStats.markets.reduce((s, m) => s + (currentPlStats.rawMatrix[m].realized * (globalFxRates[m]||1)), 0)
                                            )}
                                        </td>
                                        <td className="px-3 py-4 font-mono font-bold text-gray-400">-</td>
                                        <td className="px-3 py-4 font-mono font-bold text-sm border-l border-rose-200 bg-rose-200/50 text-rose-900">
                                            {!isHKDView ? <span className="text-gray-400">-</span> : (
                                                formatMoneyWithSign(
                                                    currentPlStats.markets.reduce((s, m) => s + (currentPlStats.rawMatrix[m].total * (globalFxRates[m]||1)), 0)
                                                ) + ' HKD'
                                            )}
                                        </td>
                                    </tr>
                                </tfoot>
                            )}
                        </table>
                    </div>
                </div>
                <div className="px-5 py-3 mt-auto bg-white border-t border-gray-100 flex items-center justify-between">
                    <div className="flex items-center gap-4 text-xs text-gray-500">
                        <span className="flex items-center gap-1.5"><Clock size={12}/> 最后入库时间: <span className="font-mono font-medium text-gray-700">{lastPlSavedTime}</span></span>
                        <span className="text-[10px] bg-rose-50 text-rose-600 px-2 py-0.5 rounded border border-rose-100">※每分钟自动入库</span>
                    </div>
                    <div className="flex items-center gap-3">
                        <button 
                            onClick={() => fetchFxRates()} disabled={isFetchingFx}
                            className="flex items-center gap-1.5 px-4 py-1.5 bg-white border border-rose-600 text-rose-600 hover:bg-rose-50 text-xs font-bold rounded shadow-sm transition-colors disabled:opacity-50"
                        >
                            <RefreshCw size={12} className={isFetchingFx ? 'animate-spin' : ''} /> 手动刷新
                        </button>
                        <button 
                            onClick={() => handleSavePlStats(false)} disabled={isSavingPl}
                            className="flex items-center gap-1.5 px-4 py-1.5 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded shadow-sm transition-colors disabled:opacity-50"
                        >
                            {isSavingPl ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} 手动入库
                        </button>
                    </div>
                </div>
            </div>

            {/* 右侧：收益分类明细归因表 (仅供预览) */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden flex flex-col">
                <div className="bg-amber-50 border-b border-amber-100 p-5 flex-1">
                    <div className="flex justify-between items-center mb-3">
                        <h3 className="font-bold text-amber-800 text-sm flex items-center gap-2">
                            <ListOrdered size={18} /> 收益分类明细归因 (仅供预览 拒绝入库)
                        </h3>
                    </div>
                    <p className="text-[10px] text-amber-700 mb-3">将各项内生收益与外汇交易(FX)的超额损益进行精准拆解与呈现。联动左侧的 TO HKD 按钮。</p>
                    
                    <div className="overflow-x-auto rounded border border-amber-200 bg-white">
                        <table className="min-w-full text-xs text-right">
                            <thead className="bg-amber-100/50 text-amber-900 font-medium">
                                <tr>
                                    <th className="px-3 py-2 text-center border-b border-r border-amber-100 bg-amber-50/50">币种</th>
                                    <th className="px-3 py-2 border-b border-amber-100">标的红利</th>
                                    <th className="px-3 py-2 border-b border-amber-100">利息收支</th>
                                    <th className="px-3 py-2 border-b border-amber-100">手续费</th>
                                    <th className="px-3 py-2 border-b border-amber-100">换汇汇差(FX)</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-amber-50">
                                {cashBreakdownStats.currencies.map(mkt => {
                                    const rate = isHKDView ? (globalFxRates[mkt] || 1) : 1;
                                    const bd = cashBreakdownStats.breakdowns[mkt];
                                    return (
                                        <tr key={mkt} className="hover:bg-amber-50/30">
                                            <td className="px-3 py-2 text-center font-bold text-gray-700 border-r border-amber-50 bg-amber-50/20">{mkt}</td>
                                            <td className={`px-3 py-2 font-mono ${bd.DIVIDEND > 0 ? 'text-red-600' : 'text-gray-400'}`}>
                                                {bd.DIVIDEND === 0 ? '-' : formatMoneyWithSign(bd.DIVIDEND * rate)}
                                            </td>
                                            <td className={`px-3 py-2 font-mono ${bd.INTEREST > 0 ? 'text-red-600' : bd.INTEREST < 0 ? 'text-green-600' : 'text-gray-400'}`}>
                                                {bd.INTEREST === 0 ? '-' : formatMoneyWithSign(bd.INTEREST * rate)}
                                            </td>
                                            <td className={`px-3 py-2 font-mono ${bd.FEE < 0 ? 'text-green-600' : 'text-gray-400'}`}>
                                                {bd.FEE === 0 ? '-' : formatMoneyWithSign(bd.FEE * rate)}
                                            </td>
                                            <td className={`px-3 py-2 font-mono font-bold ${bd.FX > 0 ? 'text-red-600' : bd.FX < 0 ? 'text-green-600' : 'text-gray-400'}`}>
                                                {bd.FX === 0 ? '-' : formatMoneyWithSign(bd.FX * rate)}
                                            </td>
                                        </tr>
                                    );
                                })}
                                {cashBreakdownStats.currencies.length === 0 && (
                                    <tr><td colSpan={5} className="px-3 py-6 text-center text-gray-400">暂无收益明细</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>

        {/* === 模块 3：初始现金（期初建账底座） === */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-200 flex justify-between items-center bg-gray-50">
                <h2 className="text-base font-bold text-gray-800 flex items-center gap-2">
                    <Database size={18} className="text-purple-500" />
                    初始现金（期初建账底座）
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
                            initialCashList.forEach(h => { if(h.currency && h.currency !== 'HKD') mkts.add(h.currency); });
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
                            <th className="px-4 py-3 text-center whitespace-nowrap">币种</th>
                            <th className="px-4 py-3 whitespace-nowrap">账户</th>
                            <th className="px-4 py-3 text-right whitespace-nowrap">期初现金金额</th>
                            <th className="px-4 py-3 text-center whitespace-nowrap">操作</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {initialCashList.map(h => (
                            <tr key={h.id} className="hover:bg-purple-50/30 transition-colors">
                                <td className="px-4 py-3 text-center font-mono font-bold text-gray-700">{h.currency}</td>
                                <td className="px-4 py-3 text-gray-800 font-medium">{h.account}</td>
                                <td className="px-4 py-3 text-right font-mono font-bold text-gray-900">{formatMoney(h.amount)}</td>
                                <td className="px-4 py-3 text-center">
                                    <button onClick={() => handleDeleteInitial(h.id)} className="text-gray-400 hover:text-red-600 p-1.5 rounded transition-colors">
                                        <Trash2 size={16} />
                                    </button>
                                </td>
                            </tr>
                        ))}
                        
                        {/* 录入行 */}
                        <tr className="bg-purple-50/50 border-t-2 border-purple-100">
                            <td className="px-4 py-3">
                                <select value={newInit.currency} onChange={e => setNewInit({...newInit, currency: e.target.value})} className="w-full p-2 border border-purple-200 rounded text-sm font-bold outline-none focus:ring-2 focus:ring-purple-400 bg-white">
                                    {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                                </select>
                            </td>
                            <td className="px-4 py-3">
                                <input type="text" placeholder="账户名 (例: 华泰证券)" value={newInit.account} onChange={e => setNewInit({...newInit, account: e.target.value.trim()})} className="w-full p-2 border border-purple-200 rounded text-sm outline-none focus:ring-2 focus:ring-purple-400" />
                            </td>
                            <td className="px-4 py-3">
                                <input type="number" step="0.01" placeholder="金额 (支持正负)" value={newInit.amount === 0 ? '' : newInit.amount} onChange={e => setNewInit({...newInit, amount: Number(e.target.value)})} className="w-full p-2 border border-purple-200 rounded text-base text-right font-mono font-bold outline-none focus:ring-2 focus:ring-purple-400" />
                            </td>
                            <td className="px-4 py-3 text-center">
                                <button onClick={handleAddInitial} disabled={submittingInit} className="text-white bg-purple-600 hover:bg-purple-700 px-4 py-2 rounded shadow-sm flex items-center justify-center gap-1 mx-auto transition-colors">
                                    {submittingInit ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} 保存
                                </button>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>

            {/* 期初现金二维统计矩阵 */}
            <div className="mt-6 bg-purple-50 border-t border-purple-100 p-5 rounded-lg">
                <div className="flex justify-between items-center mb-3">
                    <h3 className="font-bold text-purple-800 text-sm">期初现金二维统计矩阵</h3>
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
                                <th className="px-3 py-3 text-center border-b border-r border-purple-100 bg-purple-50/50">币种 \ 账户</th>
                                {initialCashStats.accounts.map(acc => (
                                    <th key={acc} className="px-3 py-3 border-b border-purple-100">{acc}</th>
                                ))}
                                <th className="px-3 py-3 border-b border-l border-purple-100 bg-purple-50/50">SUM {isHKDView ? '(HKD)' : '(原币种)'}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-purple-50">
                            {initialCashStats.markets.map(mkt => {
                                const rate = isHKDView ? (baseFxRates[mkt] || globalFxRates[mkt] || 1) : 1;
                                let rowSum = 0;
                                return (
                                    <tr key={mkt} className="hover:bg-purple-50/30">
                                        <td className="px-3 py-3 text-center font-bold text-gray-700 border-r border-purple-50 bg-purple-50/20">{mkt}</td>
                                        {initialCashStats.accounts.map(acc => {
                                            const rawVal = initialCashStats.rawMatrix[mkt][acc] || 0;
                                            const displayVal = rawVal * rate;
                                            rowSum += displayVal;
                                            return (
                                                <td key={acc} className="px-3 py-3 font-mono text-gray-700">
                                                    {displayVal === 0 ? '-' : formatMoney(displayVal)}
                                                </td>
                                            );
                                        })}
                                        <td className="px-3 py-3 font-mono font-bold text-purple-900 border-l border-purple-50 bg-purple-50/20">
                                            {rowSum === 0 ? '-' : formatMoney(rowSum)}
                                        </td>
                                    </tr>
                                );
                            })}
                            {initialCashStats.markets.length === 0 && (
                                <tr><td colSpan={initialCashStats.accounts.length + 2} className="px-3 py-6 text-center text-gray-400">暂无期初数据</td></tr>
                            )}
                        </tbody>
                        {initialCashStats.markets.length > 0 && (
                            <tfoot className="bg-purple-100 text-purple-900 border-t-2 border-purple-200 shadow-inner">
                                <tr>
                                    <td className="px-3 py-4 text-center font-bold border-r border-purple-200">
                                        {isHKDView ? 'SUM (HKD)' : 'SUM (无效)'}
                                    </td>
                                    {initialCashStats.accounts.map(acc => {
                                        if (!isHKDView) return <td key={acc} className="px-3 py-4 text-center font-mono text-gray-400">-</td>;

                                        let colSumHKD = 0;
                                        initialCashStats.markets.forEach(mkt => {
                                            const rawVal = initialCashStats.rawMatrix[mkt][acc] || 0;
                                            colSumHKD += rawVal * (baseFxRates[mkt] || globalFxRates[mkt] || 1);
                                        });
                                        return (
                                            <td key={acc} className="px-3 py-4 font-mono font-bold text-purple-900">
                                                {colSumHKD === 0 ? '-' : formatMoney(colSumHKD)}
                                            </td>
                                        );
                                    })}
                                    <td className="px-3 py-4 font-mono font-bold text-sm border-l border-purple-200 bg-purple-200/50 text-purple-900">
                                        {!isHKDView ? <span className="text-gray-400">-</span> : (
                                            formatMoney(
                                                initialCashStats.markets.reduce((sum, mkt) => {
                                                    let rSum = 0;
                                                    initialCashStats.accounts.forEach(a => rSum += initialCashStats.rawMatrix[mkt][a] || 0);
                                                    return sum + rSum * (baseFxRates[mkt] || globalFxRates[mkt] || 1);
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

        {/* === 模块 4：后台库管理模块 === */}
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
                    'sip_trade_cash',
                    'sip_holding_cash_start',
                    'sip_holding_cash_mktvalue',
                    'sip_holding_cash_pl',
                    'sip_holding_cash_stock',
                    'sip_holding_cash_pe',
                    'sip_holding_cash_cbbc',
                    'sip_holding_cash_option',
                    'sip_holding_cash_fcn'
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
                            await setDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'sip_holding_cash_start', '_global_config'), { baseFxRates: parsed }, { merge: true });
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
                            <Info className="text-emerald-500" size={18} /> 全局汇率 (对 HKD)
                        </h3>
                        <button onClick={() => setShowFxModal(false)} className="text-gray-400 hover:text-gray-600 transition-colors">
                            <X size={20}/>
                        </button>
                    </div>
                    <div className="p-5">
                        {Object.keys(globalFxRates).length === 0 ? (
                            <p className="text-sm text-gray-500 text-center py-4">暂无已缓存的汇率数据，请点击右上角的“更新”按钮。</p>
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
                        <button onClick={() => setShowFxModal(false)} className="px-4 py-2 bg-emerald-600 text-white text-sm font-bold rounded shadow-sm hover:bg-emerald-700 transition-colors">
                            关闭
                        </button>
                    </div>
                </div>
            </div>
        )}

        {/* 修改 Raw JSON 弹窗 */}
        {editRecordModal && (
            <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
                <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-5xl flex flex-col h-[85vh]">
                    <div className="flex justify-between items-center mb-4 border-b pb-4">
                        <h3 className="font-bold text-lg flex items-center gap-2 text-purple-700"><FileJson size={20}/> 进阶修改记录 - {editRecordModal.record?.id}</h3>
                        <button onClick={() => setEditRecordModal(null)} className="text-gray-400 hover:text-gray-600"><X size={20}/></button>
                    </div>
                    <p className="text-xs text-gray-500 mb-2 border-l-2 border-orange-400 pl-2">
                        警告：直接修改 Raw JSON 属于高阶操作，请确保 JSON 格式合法且结构正确，否则可能会导致页面崩溃或逻辑错误。
                    </p>
                    <textarea className="flex-1 w-full border border-gray-300 rounded-md p-3 text-xs font-mono mb-4 focus:ring-2 focus:ring-purple-500 outline-none resize-none" value={editRecordModal.rawJson} onChange={(e) => setEditRecordModal(prev => prev ? {...prev, rawJson: e.target.value} : null)} />
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