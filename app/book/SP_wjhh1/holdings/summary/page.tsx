'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { 
  LineChart, 
  Loader2, 
  AlertCircle,
  PieChart as PieChartIcon,
  BarChart as BarChartIcon,
  Building2,
  RefreshCw,
  Info
} from 'lucide-react';
import { onAuthStateChanged, signInAnonymously, signInWithCustomToken } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { 
  PieChart, Pie, Cell, 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend 
} from 'recharts';

import { auth, db, APP_ID } from '@/app/lib/stockService';

// --- 常量与映射字典 ---
const ASSET_TYPES = [
  { id: 'cash', label: '现金 (Cash)', color: '#10b981' }, // emerald-500
  { id: 'stock', label: '现货 (Spot)', color: '#3b82f6' }, // blue-500
  { id: 'pe', label: '私募 (PE)', color: '#8b5cf6' }, // violet-500
  { id: 'cbbc', label: '牛熊/期货 (CBBC)', color: '#ec4899' }, // rose-500
  { id: 'option', label: '期权 (Option)', color: '#f59e0b' }, // amber-500
  { id: 'fcn', label: 'FCN', color: '#06b6d4' }, // sky-500
  { id: 'dqaq', label: 'DQ-AQ', color: '#6366f1' }, // indigo-500
];

const ASSET_IDS = ASSET_TYPES.map(a => a.id);

// --- 类型定义 ---
interface MatrixData {
  accounts?: string[];
  markets: string[];
  rawMatrix: any; // Record<string, Record<string, number>> or Record<string, {realized, unrealized, total}>
  updatedAt?: string;
}

export default function SummaryHoldingsPage() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // --- 数据源 State ---
  const [mktDataMap, setMktDataMap] = useState<Record<string, MatrixData>>({});
  const [plDataMap, setPlDataMap] = useState<Record<string, MatrixData>>({});
  
  // --- 控制面板 State ---
  const [isHKDView, setIsHKDView] = useState(false);
  const [globalFxRates, setGlobalFxRates] = useState<Record<string, number>>({});
  const [isFetchingFx, setIsFetchingFx] = useState(false);
  
  // 模块1 State
  const [mktPctView, setMktPctView] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState<string>('ALL');
  const [mktChartTab, setMktChartTab] = useState<'MARKET' | 'ASSET' | 'ACCOUNT'>('MARKET');

  // 模块2 State
  const [plPctView, setPlPctView] = useState(false);
  const [plViewType, setPlViewType] = useState<'total' | 'realized' | 'unrealized'>('total');

  // --- Auth & 数据监听 ---
  useEffect(() => {
    let unsubs: (() => void)[] = [];

    const initData = async () => {
      try {
        if (!auth.currentUser) {
           // @ts-ignore
           if (typeof window !== 'undefined' && window.__initial_auth_token) await signInWithCustomToken(auth, window.__initial_auth_token);
           else await signInAnonymously(auth);
        }

        onAuthStateChanged(auth, (currentUser) => {
          setUser(currentUser);
          if (currentUser) {
            // 循环挂载 14 个数据源的监听 (7大类 * 2个库)
            ASSET_IDS.forEach(assetId => {
               // 1. MktVal
               unsubs.push(onSnapshot(doc(db, 'artifacts', APP_ID, 'public', 'data', `sip_holding_${assetId}_mktvalue`, 'latest_summary'), (docSnap) => {
                   if (docSnap.exists()) {
                       setMktDataMap(prev => ({ ...prev, [assetId]: docSnap.data() as MatrixData }));
                   }
               }));
               // 2. P&L
               unsubs.push(onSnapshot(doc(db, 'artifacts', APP_ID, 'public', 'data', `sip_holding_${assetId}_pl`, 'latest_summary'), (docSnap) => {
                   if (docSnap.exists()) {
                       setPlDataMap(prev => ({ ...prev, [assetId]: docSnap.data() as MatrixData }));
                   }
               }));
            });
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

  // --- 提取所有不重复的账户和币种 ---
  const allAccounts = useMemo(() => {
      const accSet = new Set<string>();
      Object.values(mktDataMap).forEach(d => {
          if (d.accounts) d.accounts.forEach(a => accSet.add(a));
      });
      return Array.from(accSet).sort();
  }, [mktDataMap]);

  const allCurrencies = useMemo(() => {
      const ccySet = new Set<string>();
      Object.values(mktDataMap).forEach(d => { if (d.markets) d.markets.forEach(m => ccySet.add(m)); });
      Object.values(plDataMap).forEach(d => { if (d.markets) d.markets.forEach(m => ccySet.add(m)); });
      return Array.from(ccySet).sort();
  }, [mktDataMap, plDataMap]);

  // --- 获取汇率 ---
  const fetchFxRates = async () => {
    if (allCurrencies.length === 0) return;
    setIsFetchingFx(true);
    try {
      const newRates: Record<string, number> = { 'HKD': 1.0 };
      await Promise.all(allCurrencies.filter(c => c !== 'HKD').map(async (currency) => {
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
      if (allCurrencies.length > 0) fetchFxRates();
  }, [allCurrencies.join(',')]);

  // =========================================================
  // 模块 1：市值矩阵聚合计算
  // =========================================================
  const mktMatrix = useMemo(() => {
      const rows = allCurrencies;
      const cols = ASSET_TYPES;
      const matrix: Record<string, Record<string, number>> = {}; // matrix[currency][assetId]
      const rowSums: Record<string, number> = {};
      const colSums: Record<string, number> = {};
      let grandTotal = 0;

      rows.forEach(c => { matrix[c] = {}; rowSums[c] = 0; });
      cols.forEach(a => { colSums[a.id] = 0; });

      rows.forEach(ccy => {
          const rate = isHKDView ? (globalFxRates[ccy] || 1) : 1;
          cols.forEach(asset => {
              let cellVal = 0;
              const data = mktDataMap[asset.id];
              if (data && data.rawMatrix && data.rawMatrix[ccy]) {
                  if (selectedAccount === 'ALL') {
                      // 汇总所有账户
                      Object.values(data.rawMatrix[ccy]).forEach((v: any) => cellVal += (v || 0));
                  } else {
                      // 取特定账户
                      cellVal = data.rawMatrix[ccy][selectedAccount] || 0;
                  }
              }
              const displayVal = cellVal * rate;
              matrix[ccy][asset.id] = displayVal;
              rowSums[ccy] += displayVal;
              colSums[asset.id] += displayVal;
              grandTotal += displayVal;
          });
      });

      return { rows, cols, matrix, rowSums, colSums, grandTotal };
  }, [mktDataMap, allCurrencies, selectedAccount, isHKDView, globalFxRates]);

  // MktVal 图表数据生成
  const chartDataMktMarket = useMemo(() => {
      return mktMatrix.rows.map(r => ({ name: r, value: mktMatrix.rowSums[r] > 0 ? mktMatrix.rowSums[r] : 0 })).filter(d => d.value > 0);
  }, [mktMatrix]);

  const chartDataMktAsset = useMemo(() => {
      return mktMatrix.cols.map(c => ({ name: c.label.split(' ')[0], value: mktMatrix.colSums[c.id], fill: c.color }));
  }, [mktMatrix]);

  const chartDataMktAccount = useMemo(() => {
      // 账户分布图不受 selectedAccount 影响，始终展示全局
      const accSums: Record<string, number> = {};
      allAccounts.forEach(a => accSums[a] = 0);
      
      ASSET_IDS.forEach(assetId => {
          const data = mktDataMap[assetId];
          if (data && data.rawMatrix) {
              Object.keys(data.rawMatrix).forEach(ccy => {
                  const rate = isHKDView ? (globalFxRates[ccy] || 1) : 1;
                  Object.entries(data.rawMatrix[ccy]).forEach(([acc, val]: any) => {
                      if (accSums[acc] !== undefined) accSums[acc] += (val * rate);
                  });
              });
          }
      });
      return allAccounts.map(a => ({ name: a, value: accSums[a] })).sort((a,b) => b.value - a.value);
  }, [mktDataMap, allAccounts, isHKDView, globalFxRates]);

  const PIE_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4'];

  // =========================================================
  // 模块 2：收益矩阵聚合计算
  // =========================================================
  const plMatrix = useMemo(() => {
      const rows = allCurrencies;
      const cols = ASSET_TYPES;
      const matrix: Record<string, Record<string, number>> = {};
      const rowSums: Record<string, number> = {};
      const colSums: Record<string, number> = {};
      let grandTotal = 0;

      rows.forEach(c => { matrix[c] = {}; rowSums[c] = 0; });
      cols.forEach(a => { colSums[a.id] = 0; });

      rows.forEach(ccy => {
          const rate = isHKDView ? (globalFxRates[ccy] || 1) : 1;
          cols.forEach(asset => {
              let cellVal = 0;
              const data = plDataMap[asset.id];
              if (data && data.rawMatrix && data.rawMatrix[ccy]) {
                  cellVal = data.rawMatrix[ccy][plViewType] || 0;
              }
              const displayVal = cellVal * rate;
              matrix[ccy][asset.id] = displayVal;
              rowSums[ccy] += displayVal;
              colSums[asset.id] += displayVal;
              grandTotal += displayVal;
          });
      });

      return { rows, cols, matrix, rowSums, colSums, grandTotal };
  }, [plDataMap, allCurrencies, plViewType, isHKDView, globalFxRates]);


  // --- 格式化辅助 ---
  const fmtValue = (val: number, isPct: boolean, total: number) => {
      if (val === 0) return '-';
      if (isPct) {
          if (total === 0) return '0.00%';
          return `${((val / Math.abs(total)) * 100).toFixed(2)}%`;
      }
      return val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };
  const fmtSign = (val: number) => val > 0 ? '+' : '';

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="animate-spin text-indigo-600" size={40} /></div>;
  }

  return (
    <div className="space-y-8 pb-10 max-w-[1500px] mx-auto px-4">
      {/* === Header === */}
      <div className="border-b border-gray-200 pb-4 pt-4 flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <LineChart className="text-indigo-600" />
            Summary Holding (全局大盘总看板)
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            基于单位净值法（NAV）的全局资产概览与真实收益率追踪。聚合全系 7 大底层引擎。
          </p>
        </div>
        <button 
            onClick={fetchFxRates} disabled={isFetchingFx}
            className="px-4 py-2 bg-white border border-gray-300 rounded shadow-sm text-sm font-bold text-gray-700 hover:bg-gray-50 flex items-center gap-2"
        >
            <RefreshCw size={14} className={isFetchingFx ? 'animate-spin' : ''} /> 更新系统汇率
        </button>
      </div>

      {error && (
        <div className="bg-red-50 p-4 rounded text-red-700 flex items-center gap-2">
          <AlertCircle size={20} /> {error}
        </div>
      )}

      {/* === 模块 1：当前持仓市值统计表 === */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
         <div className="bg-indigo-50 border-b border-indigo-100 p-5">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-4">
                <div className="flex items-center gap-4">
                    <h3 className="font-bold text-indigo-900 flex items-center gap-2 text-lg">
                        <PieChartIcon size={20} /> 当前持仓市值分布矩阵
                    </h3>
                    <div className="flex items-center bg-white border border-indigo-200 rounded-lg p-1 shadow-sm">
                        <label className="text-xs font-bold text-indigo-700 px-2">穿透账户:</label>
                        <select 
                            value={selectedAccount} 
                            onChange={(e) => setSelectedAccount(e.target.value)}
                            className="bg-transparent text-sm font-bold text-indigo-900 outline-none cursor-pointer"
                        >
                            <option value="ALL">🌟 全盘合并 (ALL)</option>
                            {allAccounts.map(acc => <option key={acc} value={acc}>{acc}</option>)}
                        </select>
                    </div>
                </div>
                
                <div className="flex items-center gap-2 bg-white p-1 rounded-lg border border-indigo-200 shadow-sm">
                    <button 
                        onClick={() => setIsHKDView(!isHKDView)}
                        className={`px-4 py-1.5 text-xs font-bold rounded transition-colors ${isHKDView ? 'bg-indigo-600 text-white shadow-inner' : 'text-indigo-700 hover:bg-indigo-50'}`}
                    >
                        {isHKDView ? '恢复原币种' : 'TO HKD (汇率折算)'}
                    </button>
                    <div className="w-px h-4 bg-indigo-200 mx-1"></div>
                    <button 
                        onClick={() => setMktPctView(!mktPctView)}
                        className={`px-4 py-1.5 text-xs font-bold rounded transition-colors ${mktPctView ? 'bg-indigo-600 text-white shadow-inner' : 'text-indigo-700 hover:bg-indigo-50'}`}
                    >
                        TO Percentage (%)
                    </button>
                </div>
            </div>

            <div className="overflow-x-auto rounded border border-indigo-200 bg-white mb-6">
                <table className="min-w-full text-xs text-right">
                    <thead className="bg-indigo-100/50 text-indigo-900 font-bold border-b border-indigo-200">
                        <tr>
                            <th className="px-3 py-3 text-center border-r border-indigo-100 bg-indigo-50/80">资产大类 <br/><span className="text-[10px] font-normal">↓ 结算币种 ↓</span></th>
                            {mktMatrix.cols.map(col => (
                                <th key={col.id} className="px-3 py-3" style={{ color: col.color }}>{col.label}</th>
                            ))}
                            <th className="px-3 py-3 border-l border-indigo-100 bg-indigo-50/80">SUM Row <br/><span className="text-[10px] font-normal">{isHKDView ? '(HKD)' : '(原币种)'}</span></th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-indigo-50">
                        {mktMatrix.rows.map(row => (
                            <tr key={row} className="hover:bg-indigo-50/40">
                                <td className="px-3 py-3 text-center font-bold text-gray-700 border-r border-indigo-50 bg-indigo-50/20">{row}</td>
                                {mktMatrix.cols.map(col => {
                                    const val = mktMatrix.matrix[row][col.id];
                                    return (
                                        <td key={col.id} className="px-3 py-3 font-mono text-gray-700">
                                            {fmtValue(val, mktPctView, mktMatrix.grandTotal)}
                                        </td>
                                    );
                                })}
                                <td className="px-3 py-3 font-mono font-bold text-indigo-900 border-l border-indigo-50 bg-indigo-50/20">
                                    {fmtValue(mktMatrix.rowSums[row], mktPctView, mktMatrix.grandTotal)}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                    <tfoot className="bg-indigo-100/80 text-indigo-900 border-t border-indigo-300">
                        <tr>
                            <td className="px-3 py-4 text-center font-black border-r border-indigo-200">SUM Col<br/><span className="text-[10px] font-normal">{isHKDView ? '(HKD)' : '(混合/无效)'}</span></td>
                            {mktMatrix.cols.map(col => (
                                <td key={col.id} className="px-3 py-4 font-mono font-bold">
                                    {isHKDView || mktPctView ? fmtValue(mktMatrix.colSums[col.id], mktPctView, mktMatrix.grandTotal) : <span className="text-gray-400">-</span>}
                                </td>
                            ))}
                            <td className="px-3 py-4 font-mono font-black text-sm border-l border-indigo-200 bg-indigo-200/50 text-indigo-950">
                                {isHKDView || mktPctView ? fmtValue(mktMatrix.grandTotal, mktPctView, mktMatrix.grandTotal) : <span className="text-gray-400">-</span>}
                            </td>
                        </tr>
                    </tfoot>
                </table>
            </div>

            {/* 可视化图表区 */}
            <div className="bg-white rounded-xl border border-indigo-100 p-1">
                <div className="flex border-b border-indigo-50 px-4 pt-3 gap-6">
                    <button onClick={() => setMktChartTab('MARKET')} className={`pb-3 text-sm font-bold flex items-center gap-2 border-b-2 transition-colors ${mktChartTab === 'MARKET' ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-gray-400 hover:text-indigo-400'}`}><PieChartIcon size={16}/> 市场分布 (币种)</button>
                    <button onClick={() => setMktChartTab('ASSET')} className={`pb-3 text-sm font-bold flex items-center gap-2 border-b-2 transition-colors ${mktChartTab === 'ASSET' ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-gray-400 hover:text-indigo-400'}`}><BarChartIcon size={16}/> 资产分布 (品类)</button>
                    <button onClick={() => setMktChartTab('ACCOUNT')} className={`pb-3 text-sm font-bold flex items-center gap-2 border-b-2 transition-colors ${mktChartTab === 'ACCOUNT' ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-gray-400 hover:text-indigo-400'}`}><Building2 size={16}/> 账户分布 (全局券商)</button>
                </div>
                <div className="h-[300px] w-full p-4 relative flex items-center justify-center">
                    {!isHKDView ? (
                        <div className="text-gray-400 font-medium flex items-center gap-2 bg-gray-50 px-6 py-3 rounded-full border border-gray-100">
                            <Info size={18}/> 请在右上角点击「TO HKD」统一计价后，方可查看图表可视化。
                        </div>
                    ) : mktMatrix.grandTotal === 0 ? (
                        <div className="text-gray-400">暂无资产数据</div>
                    ) : (
                        <ResponsiveContainer width="100%" height="100%">
                            {mktChartTab === 'MARKET' ? (
                                <PieChart>
                                    <Pie data={chartDataMktMarket} cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={2} dataKey="value" nameKey="name" label={(entry) => `${entry.name} (${((entry.value/mktMatrix.grandTotal)*100).toFixed(1)}%)`}>
                                        {chartDataMktMarket.map((entry, index) => <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />)}
                                    </Pie>
                                    <Tooltip formatter={(val: any) => [`${Number(val).toLocaleString('en-US', {maximumFractionDigits:0})} HKD`, '市值']} />
                                    <Legend />
                                </PieChart>
                            ) : mktChartTab === 'ASSET' ? (
                                <BarChart data={chartDataMktAsset} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                                    <XAxis dataKey="name" axisLine={false} tickLine={false} />
                                    <YAxis tickFormatter={(val) => `${(val/10000).toFixed(0)}w`} axisLine={false} tickLine={false} />
                                    <Tooltip formatter={(val: any) => [`${Number(val).toLocaleString('en-US', {maximumFractionDigits:0})} HKD`, '市值']} cursor={{fill: '#f3f4f6'}} />
                                    <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={60}>
                                        {chartDataMktAsset.map((entry, index) => <Cell key={`cell-${index}`} fill={entry.fill} />)}
                                    </Bar>
                                </BarChart>
                            ) : (
                                <BarChart data={chartDataMktAccount} layout="vertical" margin={{ top: 5, right: 30, left: 80, bottom: 5 }}>
                                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e5e7eb" />
                                    <XAxis type="number" tickFormatter={(val) => `${(val/10000).toFixed(0)}w`} axisLine={false} tickLine={false} />
                                    <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} tick={{fontSize: 12, fontWeight: 'bold'}} width={80} />
                                    <Tooltip formatter={(val: any) => [`${Number(val).toLocaleString('en-US', {maximumFractionDigits:0})} HKD`, '归集总资产']} cursor={{fill: '#f3f4f6'}} />
                                    <Bar dataKey="value" fill="#8b5cf6" radius={[0, 4, 4, 0]} maxBarSize={40} />
                                </BarChart>
                            )}
                        </ResponsiveContainer>
                    )}
                </div>
            </div>
         </div>
      </div>

      {/* === 模块 2：当前收益统计表 === */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
         <div className="bg-rose-50 border-b border-rose-100 p-5">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-4">
                <div className="flex items-center gap-4">
                    <h3 className="font-bold text-rose-900 flex items-center gap-2 text-lg">
                        <BarChartIcon size={20} /> 当前业绩归因矩阵 (P&L)
                    </h3>
                    {/* 盈亏视角切换 */}
                    <div className="flex bg-white rounded border border-rose-200 p-0.5 shadow-sm">
                        <button onClick={() => setPlViewType('total')} className={`px-4 py-1 text-xs font-bold rounded-sm transition-colors ${plViewType === 'total' ? 'bg-rose-500 text-white' : 'text-gray-500 hover:bg-gray-100'}`}>总盈亏 (Total)</button>
                        <button onClick={() => setPlViewType('realized')} className={`px-4 py-1 text-xs font-bold rounded-sm transition-colors ${plViewType === 'realized' ? 'bg-rose-500 text-white' : 'text-gray-500 hover:bg-gray-100'}`}>已实现 (落袋)</button>
                        <button onClick={() => setPlViewType('unrealized')} className={`px-4 py-1 text-xs font-bold rounded-sm transition-colors ${plViewType === 'unrealized' ? 'bg-rose-500 text-white' : 'text-gray-500 hover:bg-gray-100'}`}>未实现 (浮动)</button>
                    </div>
                </div>
                
                <div className="flex items-center gap-2 bg-white p-1 rounded-lg border border-rose-200 shadow-sm">
                    <button 
                        onClick={() => setIsHKDView(!isHKDView)}
                        className={`px-4 py-1.5 text-xs font-bold rounded transition-colors ${isHKDView ? 'bg-rose-600 text-white shadow-inner' : 'text-rose-700 hover:bg-rose-50'}`}
                    >
                        {isHKDView ? '恢复原币种' : 'TO HKD (汇率折算)'}
                    </button>
                    <div className="w-px h-4 bg-rose-200 mx-1"></div>
                    <button 
                        onClick={() => setPlPctView(!plPctView)}
                        className={`px-4 py-1.5 text-xs font-bold rounded transition-colors ${plPctView ? 'bg-rose-600 text-white shadow-inner' : 'text-rose-700 hover:bg-rose-50'}`}
                        title="查看各项盈亏占全盘总盈亏的绝对值比例"
                    >
                        TO Percentage (%)
                    </button>
                </div>
            </div>

            <div className="overflow-x-auto rounded border border-rose-200 bg-white">
                <table className="min-w-full text-xs text-right">
                    <thead className="bg-rose-100/50 text-rose-900 font-bold border-b border-rose-200">
                        <tr>
                            <th className="px-3 py-3 text-center border-r border-rose-100 bg-rose-50/80">资产大类 <br/><span className="text-[10px] font-normal">↓ 结算币种 ↓</span></th>
                            {plMatrix.cols.map(col => (
                                <th key={col.id} className="px-3 py-3" style={{ color: col.color }}>{col.label}</th>
                            ))}
                            <th className="px-3 py-3 border-l border-rose-100 bg-rose-50/80">SUM Row <br/><span className="text-[10px] font-normal">{isHKDView ? '(HKD)' : '(原币种)'}</span></th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-rose-50">
                        {plMatrix.rows.map(row => (
                            <tr key={row} className="hover:bg-rose-50/40">
                                <td className="px-3 py-3 text-center font-bold text-gray-700 border-r border-rose-50 bg-rose-50/20">{row}</td>
                                {plMatrix.cols.map(col => {
                                    const val = plMatrix.matrix[row][col.id];
                                    return (
                                        <td key={col.id} className={`px-3 py-3 font-mono ${val > 0 ? 'text-red-600' : val < 0 ? 'text-green-600' : 'text-gray-400'}`}>
                                            {fmtSign(val)}{fmtValue(val, plPctView, plMatrix.grandTotal)}
                                        </td>
                                    );
                                })}
                                <td className={`px-3 py-3 font-mono font-bold border-l border-rose-50 bg-rose-50/20 ${plMatrix.rowSums[row] > 0 ? 'text-red-700' : plMatrix.rowSums[row] < 0 ? 'text-green-700' : 'text-gray-500'}`}>
                                    {fmtSign(plMatrix.rowSums[row])}{fmtValue(plMatrix.rowSums[row], plPctView, plMatrix.grandTotal)}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                    <tfoot className="bg-rose-100/80 text-rose-900 border-t border-rose-300">
                        <tr>
                            <td className="px-3 py-4 text-center font-black border-r border-rose-200">SUM Col<br/><span className="text-[10px] font-normal">{isHKDView ? '(HKD)' : '(混合/无效)'}</span></td>
                            {plMatrix.cols.map(col => {
                                const val = plMatrix.colSums[col.id];
                                return (
                                    <td key={col.id} className={`px-3 py-4 font-mono font-bold ${val > 0 ? 'text-red-700' : val < 0 ? 'text-green-700' : 'text-gray-400'}`}>
                                        {isHKDView || plPctView ? `${fmtSign(val)}${fmtValue(val, plPctView, plMatrix.grandTotal)}` : <span className="text-gray-400">-</span>}
                                    </td>
                                );
                            })}
                            <td className={`px-3 py-4 font-mono font-black text-sm border-l border-rose-200 bg-rose-200/50 ${plMatrix.grandTotal > 0 ? 'text-red-700' : plMatrix.grandTotal < 0 ? 'text-green-700' : 'text-rose-950'}`}>
                                {isHKDView || plPctView ? `${fmtSign(plMatrix.grandTotal)}${fmtValue(plMatrix.grandTotal, plPctView, plMatrix.grandTotal)}` : <span className="text-gray-400">-</span>}
                            </td>
                        </tr>
                    </tfoot>
                </table>
            </div>
         </div>
      </div>

    </div>
  );
}