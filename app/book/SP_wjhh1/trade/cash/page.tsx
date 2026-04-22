'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { 
  Landmark,
  Wallet,
  ArrowRightLeft,
  Gift,
  Receipt,
  PiggyBank,
  Plus, 
  Trash2, 
  Save, 
  Loader2, 
  AlertCircle,
  XCircle,
  Edit2, 
  X,
  ListOrdered
} from 'lucide-react';
import { 
  collection, 
  addDoc, 
  deleteDoc,
  updateDoc, 
  doc, 
  onSnapshot, 
  query, 
  serverTimestamp,
  where,
  getDocs,
  writeBatch
} from 'firebase/firestore';
import { onAuthStateChanged, signInAnonymously, signInWithCustomToken } from 'firebase/auth';

import { db, auth, APP_ID } from '@/app/lib/stockService';

// --- 类型定义 ---
type CashTradeType = 'DEPOSIT_WITHDRAW' | 'FX' | 'DIVIDEND' | 'FEE' | 'INTEREST';

interface CashTrade {
  id?: string;
  date: string;
  account: string;
  currency: string;
  amount: number; // 严格正负号：正=流入，负=流出
  type: CashTradeType;
  executor: string;
  remark: string;
  
  // 特有业务字段
  relatedSymbol?: string; // 分红关联标的
  feeCategory?: string;   // 费用类别
  fxGroupId?: string;     // FX 双边流水绑定ID
  
  createdAt?: any;
}

// 统一的币种选项
const CURRENCIES = ['USD', 'CNY', 'HKD', 'JPY'];

export default function CashTradePage() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [transactions, setTransactions] = useState<CashTrade[]>([]);
  
  // UI 状态
  const [activeTab, setActiveTab] = useState<CashTradeType>('DEPOSIT_WITHDRAW');
  
  // 通用表单 State
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [account, setAccount] = useState('');
  const [executor, setExecutor] = useState('');
  const [remark, setRemark] = useState('');

  // 模块专属 State
  const [currency, setCurrency] = useState('USD');
  const [amount, setAmount] = useState<number | ''>(''); // 用于出入金、红利、费用、利息
  const [relatedSymbol, setRelatedSymbol] = useState(''); // 用于红利
  const [feeCategory, setFeeCategory] = useState('账户管理费'); // 用于费用
  
  // FX 专属 State (双腿分录)
  const [outCurrency, setOutCurrency] = useState('USD');
  const [outAmount, setOutAmount] = useState<number | ''>(''); // 必须为负数
  const [inCurrency, setInCurrency] = useState('HKD');
  const [inAmount, setInAmount] = useState<number | ''>(''); // 必须为正数

  // --- Auth & Data Subscription ---
  useEffect(() => {
    let unsubscribeSnapshot: (() => void) | undefined;

    const initAuthAndData = async () => {
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
            // 修复索引报错：移除 Firestore 层面的 orderBy，改为简单的 collection 查询
            const q = query(
              collection(db, 'artifacts', APP_ID, 'public', 'data', 'sip_trade_cash')
            );
            unsubscribeSnapshot = onSnapshot(q, (snapshot) => {
              const data = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
              })) as CashTrade[];

              // 在内存中进行排序（先按日期降序，同日期按创建时间降序），完美避开复合索引需求
              data.sort((a, b) => {
                const timeA = new Date(a.date).getTime();
                const timeB = new Date(b.date).getTime();
                if (timeA !== timeB) return timeB - timeA;
                
                const createdA = a.createdAt?.toMillis ? a.createdAt.toMillis() : (a.createdAt?.seconds ? a.createdAt.seconds * 1000 : 0);
                const createdB = b.createdAt?.toMillis ? b.createdAt.toMillis() : (b.createdAt?.seconds ? b.createdAt.seconds * 1000 : 0);
                return createdB - createdA;
              });

              setTransactions(data);
              setLoading(false);
            }, (err) => {
              console.error("Snapshot error:", err);
              setError(`读取数据失败: ${err.message}`);
              setLoading(false);
            });
          }
        });
      } catch (err: any) {
        setError(`初始化失败: ${err.message}`);
        setLoading(false);
      }
    };

    initAuthAndData();
    return () => { if (unsubscribeSnapshot) unsubscribeSnapshot(); };
  }, []);

  // --- 提交处理 ---
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return setError("用户未登录");
    
    setSubmitting(true);
    setError(null);

    try {
      const baseData = {
        date,
        account,
        executor,
        remark,
        createdAt: serverTimestamp()
      };

      if (activeTab === 'FX') {
        // FX 双腿强制校验
        if (outCurrency === inCurrency) throw new Error("卖出和买入不能是同一币种");
        if (Number(outAmount) >= 0) throw new Error("【卖出金额】必须是严格 < 0 的负数！(请敲击减号)");
        if (Number(inAmount) <= 0) throw new Error("【买入金额】必须是严格 > 0 的正数！");

        const fxGroupId = `FX_${Date.now()}`;
        const batch = writeBatch(db);
        
        const outRef = doc(collection(db, 'artifacts', APP_ID, 'public', 'data', 'sip_trade_cash'));
        batch.set(outRef, {
            ...baseData, type: 'FX', fxGroupId,
            currency: outCurrency, amount: Number(outAmount)
        });

        const inRef = doc(collection(db, 'artifacts', APP_ID, 'public', 'data', 'sip_trade_cash'));
        batch.set(inRef, {
            ...baseData, type: 'FX', fxGroupId,
            currency: inCurrency, amount: Number(inAmount)
        });

        await batch.commit();

      } else {
        // 单腿强制校验
        const val = Number(amount);
        if (val === 0) throw new Error("金额不能为 0");
        if (activeTab === 'DIVIDEND' && val < 0) throw new Error("红利收入必须是 > 0 的正数！");
        if (activeTab === 'FEE' && val > 0) throw new Error("手续费必须是 < 0 的负数！(请敲击减号)");

        let payload: any = { ...baseData, type: activeTab, currency, amount: val };
        if (activeTab === 'DIVIDEND') {
            if (!relatedSymbol) throw new Error("请填写红利关联的标的代码");
            payload.relatedSymbol = relatedSymbol;
        }
        if (activeTab === 'FEE') payload.feeCategory = feeCategory;

        await addDoc(collection(db, 'artifacts', APP_ID, 'public', 'data', 'sip_trade_cash'), payload);
      }

      // 提交成功，清空数值但保留用户习惯
      setAmount('');
      setOutAmount('');
      setInAmount('');
      setRemark('');

    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  // --- 删除处理 (级联删除 FX) ---
  const handleDelete = async (t: CashTrade) => {
    if (!confirm('确认删除这条资金流水吗？')) return;
    try {
      if (t.type === 'FX' && t.fxGroupId) {
          // FX 需要删掉绑定的两条记录
          const q = query(collection(db, 'artifacts', APP_ID, 'public', 'data', 'sip_trade_cash'), where('fxGroupId', '==', t.fxGroupId));
          const snaps = await getDocs(q);
          const batch = writeBatch(db);
          snaps.forEach(docSnap => batch.delete(docSnap.ref));
          await batch.commit();
      } else {
          // 普通删除
          await deleteDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'sip_trade_cash', t.id!));
      }
    } catch (err: any) {
      setError(`删除失败: ${err.message}`);
    }
  };

  // --- 辅助渲染 ---
  const formatMoney = (val: number) => val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  
  const TABS = [
      { id: 'DEPOSIT_WITHDRAW', icon: Wallet, label: '出/入金' },
      { id: 'FX', icon: ArrowRightLeft, label: '货币兑换' },
      { id: 'DIVIDEND', icon: Gift, label: '标的红利' },
      { id: 'FEE', icon: Receipt, label: '手续费' },
      { id: 'INTEREST', icon: PiggyBank, label: '利息收支' },
  ] as const;

  if (loading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="animate-spin text-blue-600" size={40}/></div>;

  return (
    <div className="space-y-6 pb-10 max-w-[1400px] mx-auto px-4">
      {/* === Header === */}
      <div className="border-b border-gray-200 pb-4 pt-4 flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Landmark className="text-indigo-600" />
            Cash Trade (中央资金流水)
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            处理所有不涉及底层资产买卖的纯现金流变动。采用严格的正负号记账法（正 = 流入，负 = 流出）。
          </p>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
          <XCircle className="text-red-500 flex-shrink-0 mt-0.5" size={18} />
          <div className="flex-1">
            <h3 className="text-sm font-bold text-red-800">发生错误</h3>
            <p className="text-sm text-red-700 mt-1">{error}</p>
          </div>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600"><X size={20} /></button>
        </div>
      )}

      {/* === 录入表单 === */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
         {/* Tabs */}
         <div className="flex border-b border-gray-200 bg-gray-50/50 overflow-x-auto">
            {TABS.map(tab => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;
                return (
                    <button
                        key={tab.id}
                        onClick={() => { setError(null); setActiveTab(tab.id as CashTradeType); }}
                        className={`flex items-center gap-2 px-6 py-3 text-sm font-bold border-b-2 transition-colors whitespace-nowrap ${
                            isActive ? 'border-indigo-600 text-indigo-700 bg-white' : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-100'
                        }`}
                    >
                        <Icon size={16} className={isActive ? 'text-indigo-600' : 'text-gray-400'} />
                        {tab.label}
                    </button>
                );
            })}
         </div>

         <form onSubmit={handleSubmit} className="p-6 space-y-6">
            {/* 通用基础信息 */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 bg-gray-50 p-4 rounded-lg border border-gray-100">
                <div>
                    <label className="block text-xs font-bold text-gray-600 mb-1">发生日期</label>
                    <input type="date" required value={date} onChange={e => setDate(e.target.value)} className="w-full p-2 border rounded text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
                </div>
                <div>
                    <label className="block text-xs font-bold text-gray-600 mb-1">资金账户</label>
                    <input type="text" required placeholder="如: 华泰证券" value={account} onChange={e => setAccount(e.target.value.trim())} className="w-full p-2 border rounded text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
                </div>
                <div>
                    <label className="block text-xs font-bold text-gray-600 mb-1">执行人</label>
                    <input type="text" placeholder="操作员姓名" value={executor} onChange={e => setExecutor(e.target.value.trim())} className="w-full p-2 border rounded text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
                </div>
                <div>
                    <label className="block text-xs font-bold text-gray-600 mb-1">流水备注</label>
                    <input type="text" placeholder="选填..." value={remark} onChange={e => setRemark(e.target.value)} className="w-full p-2 border rounded text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
                </div>
            </div>

            {/* 动态表单区域 */}
            <div className="bg-indigo-50/30 p-6 rounded-lg border border-indigo-100/50">
                {activeTab !== 'FX' ? (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-end">
                        <div className="col-span-1">
                            <label className="block text-xs font-bold text-indigo-900 mb-1">结算币种</label>
                            <select value={currency} onChange={e => setCurrency(e.target.value)} className="w-full p-2.5 border rounded-lg text-sm outline-none font-bold text-indigo-900 bg-white">
                                {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                        </div>
                        <div className="col-span-1 relative">
                            <label className="block text-xs font-bold text-indigo-900 mb-1 flex items-center gap-2">
                                流水金额
                                {activeTab === 'DEPOSIT_WITHDRAW' && <span className="text-[10px] font-normal text-indigo-500">入金敲正数，出金敲负号(-)</span>}
                                {activeTab === 'INTEREST' && <span className="text-[10px] font-normal text-indigo-500">收入敲正数，支出敲负号(-)</span>}
                                {activeTab === 'DIVIDEND' && <span className="text-[10px] font-bold text-red-500">必须严格 ＞ 0</span>}
                                {activeTab === 'FEE' && <span className="text-[10px] font-bold text-green-600">必须严格 ＜ 0 (需敲减号)</span>}
                            </label>
                            <input 
                                type="number" step="0.01" required 
                                value={amount} 
                                onChange={e => setAmount(e.target.value === '' ? '' : Number(e.target.value))} 
                                placeholder={activeTab === 'FEE' ? "-50.00" : "0.00"}
                                className={`w-full p-2.5 border rounded-lg text-lg font-mono font-bold outline-none focus:ring-2 focus:ring-indigo-500 ${Number(amount) > 0 ? 'text-red-600 bg-red-50/50 border-red-200' : Number(amount) < 0 ? 'text-green-600 bg-green-50/50 border-green-200' : 'text-gray-900'}`} 
                            />
                        </div>

                        {/* 特有字段 */}
                        {activeTab === 'DIVIDEND' && (
                            <div className="col-span-1">
                                <label className="block text-xs font-bold text-indigo-900 mb-1">关联资产代码</label>
                                <input type="text" required placeholder="如 AAPL" value={relatedSymbol} onChange={e => setRelatedSymbol(e.target.value.toUpperCase().trim())} className="w-full p-2.5 border border-indigo-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none font-mono" />
                            </div>
                        )}
                        {activeTab === 'FEE' && (
                            <div className="col-span-1">
                                <label className="block text-xs font-bold text-indigo-900 mb-1">费用细项类别</label>
                                <select value={feeCategory} onChange={e => setFeeCategory(e.target.value)} className="w-full p-2.5 border border-indigo-200 rounded-lg text-sm outline-none bg-white">
                                    <option value="账户管理费">账户管理/托管费</option>
                                    <option value="行情资讯费">行情资讯费</option>
                                    <option value="印花税/滞纳金">印花税/滞纳金</option>
                                    <option value="其他杂项">其他杂项</option>
                                </select>
                            </div>
                        )}
                    </div>
                ) : (
                    /* FX 双腿分录专属布局 */
                    <div className="grid grid-cols-1 md:grid-cols-5 gap-4 items-center">
                        <div className="col-span-2 bg-green-50 border border-green-200 p-4 rounded-lg">
                            <label className="block text-xs font-bold text-green-800 mb-3">➖ 卖出流出 (Amount 必须 ＜ 0)</label>
                            <div className="flex gap-2">
                                <select value={outCurrency} onChange={e => setOutCurrency(e.target.value)} className="w-1/3 p-2 border border-green-200 rounded text-sm font-bold outline-none bg-white text-green-900">
                                    {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                                </select>
                                <input type="number" step="0.01" required placeholder="-1000.00" value={outAmount} onChange={e => setOutAmount(e.target.value === '' ? '' : Number(e.target.value))} className="w-2/3 p-2 border border-green-200 rounded text-right text-base font-mono font-bold outline-none text-green-700 focus:ring-2 focus:ring-green-500 bg-white" />
                            </div>
                        </div>
                        <div className="col-span-1 flex justify-center">
                            <div className="bg-indigo-100 p-3 rounded-full shadow-inner"><ArrowRightLeft className="text-indigo-600" /></div>
                        </div>
                        <div className="col-span-2 bg-red-50 border border-red-200 p-4 rounded-lg">
                            <label className="block text-xs font-bold text-red-800 mb-3">➕ 买入流入 (Amount 必须 ＞ 0)</label>
                            <div className="flex gap-2">
                                <select value={inCurrency} onChange={e => setInCurrency(e.target.value)} className="w-1/3 p-2 border border-red-200 rounded text-sm font-bold outline-none bg-white text-red-900">
                                    {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                                </select>
                                <input type="number" step="0.01" required placeholder="7800.00" value={inAmount} onChange={e => setInAmount(e.target.value === '' ? '' : Number(e.target.value))} className="w-2/3 p-2 border border-red-200 rounded text-right text-base font-mono font-bold outline-none text-red-700 focus:ring-2 focus:ring-red-500 bg-white" />
                            </div>
                        </div>
                        {/* 隐含汇率计算 */}
                        {outAmount !== '' && inAmount !== '' && Number(outAmount) !== 0 && (
                            <div className="col-span-5 text-center mt-2 text-xs font-mono text-gray-500 bg-white border rounded py-1">
                                隐含折算汇率: 1 {outCurrency} = <span className="font-bold text-indigo-600">{Math.abs(Number(inAmount) / Number(outAmount)).toFixed(6)}</span> {inCurrency}
                            </div>
                        )}
                    </div>
                )}
            </div>

            <div className="flex justify-end">
                <button 
                  type="submit" 
                  disabled={submitting}
                  className="flex items-center gap-2 bg-indigo-600 text-white px-8 py-3 rounded-lg font-bold shadow hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                >
                  {submitting ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
                  确认入库
                </button>
            </div>
         </form>
      </div>

      {/* === 数据表格 === */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
         <div className="px-5 py-4 border-b border-gray-200 flex justify-between items-center bg-gray-50">
            <h2 className="text-base font-bold text-gray-800 flex items-center gap-2">
                <ListOrdered size={18} className="text-gray-500" /> 历史中央资金流水明细
            </h2>
            <span className="text-xs font-mono text-gray-400">Total: {transactions.length} 笔记录</span>
         </div>
         <div className="overflow-x-auto max-h-[800px] relative">
            <table className="min-w-full text-sm text-left">
                <thead className="bg-gray-50 text-gray-500 font-medium sticky top-0 shadow-sm z-10 border-b border-gray-200">
                    <tr>
                        <th className="px-4 py-3 whitespace-nowrap">日期</th>
                        <th className="px-4 py-3 whitespace-nowrap">账户</th>
                        <th className="px-4 py-3 text-center whitespace-nowrap">大类</th>
                        <th className="px-4 py-3 text-center whitespace-nowrap">币种</th>
                        <th className="px-4 py-3 text-right whitespace-nowrap">记账金额</th>
                        <th className="px-4 py-3 whitespace-nowrap">详情/备注</th>
                        <th className="px-4 py-3 text-center whitespace-nowrap">操作人</th>
                        <th className="px-4 py-3 text-center whitespace-nowrap">管理</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                    {transactions.length === 0 ? (
                        <tr><td colSpan={8} className="p-10 text-center text-gray-400">暂无资金流水记录</td></tr>
                    ) : transactions.map(t => {
                        const isFX = t.type === 'FX';
                        const isIncome = t.amount > 0;
                        const labelObj = TABS.find(x => x.id === t.type);
                        
                        // 强制显式声明 displayLabel 为 string 类型，解决 TS 报错
                        let displayLabel: string = labelObj ? labelObj.label : t.type;
                        if (t.type === 'DEPOSIT_WITHDRAW') {
                            displayLabel = isIncome ? '入金' : '出金';
                        }

                        return (
                            <tr key={t.id} className="hover:bg-gray-50 transition-colors">
                                <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{t.date}</td>
                                <td className="px-4 py-3 font-medium text-gray-800">{t.account}</td>
                                <td className="px-4 py-3 text-center">
                                    <span className="text-[10px] bg-gray-100 text-gray-600 px-2 py-1 rounded font-bold">
                                        {displayLabel}
                                    </span>
                                </td>
                                <td className="px-4 py-3 text-center font-mono font-bold text-gray-500">{t.currency}</td>
                                <td className={`px-4 py-3 text-right font-mono font-bold ${isIncome ? 'text-red-600' : 'text-green-600'}`}>
                                    {isIncome ? '+' : ''}{formatMoney(t.amount)}
                                </td>
                                <td className="px-4 py-3">
                                    {t.relatedSymbol && <span className="text-xs bg-red-50 text-red-600 border border-red-100 px-1.5 py-0.5 rounded font-mono mr-2">标的: {t.relatedSymbol}</span>}
                                    {t.feeCategory && <span className="text-xs text-gray-500 mr-2">[{t.feeCategory}]</span>}
                                    {isFX && <span className="text-[10px] text-indigo-400 font-mono mr-2">🔗 换汇单号: {t.fxGroupId?.split('_')[1]}</span>}
                                    <span className="text-xs text-gray-400">{t.remark}</span>
                                </td>
                                <td className="px-4 py-3 text-center text-xs text-gray-400">{t.executor}</td>
                                <td className="px-4 py-3 text-center">
                                    <button 
                                        onClick={() => handleDelete(t)}
                                        className="text-gray-400 hover:text-red-600 p-1.5 rounded hover:bg-red-50 transition-colors"
                                        title={isFX ? "删除此条将连带删除对应的买/卖对侧流水" : "删除"}
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
         </div>
      </div>
    </div>
  );
}