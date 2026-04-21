'use client';

import React, { useState, useEffect } from 'react';
import { 
  Plus, 
  Trash2, 
  Save, 
  Loader2, 
  AlertCircle,
  Calculator,
  XCircle,
  Edit2, 
  X      
} from 'lucide-react';
import { 
  collection, 
  addDoc, 
  deleteDoc,
  updateDoc, 
  doc, 
  onSnapshot, 
  query, 
  orderBy, 
  serverTimestamp 
} from 'firebase/firestore';
import { onAuthStateChanged, signInAnonymously, signInWithCustomToken } from 'firebase/auth';

// 引入统一的 Firebase 实例和工具
import { db, auth, APP_ID } from '@/app/lib/stockService';

// --- 类型定义 ---
interface CBBCTrade {
  id?: string;
  date: string;
  account: string;
  futuresCode: string; // 期货简码
  futuresName: string; // 期货名称
  market: string;
  executor: string;
  direction: 'BUY' | 'SELL';
  quantity: number;
  price_excl_fee: number;
  amount_excl_fee: number;
  fee: number;
  amount_incl_fee: number;
  avg_price_incl_fee: number;
  createdAt?: any;
}

// 获取初始表单状态（动态获取当前日期）
const getInitialFormState = (): CBBCTrade => ({
  date: new Date().toISOString().split('T')[0],
  account: '',
  futuresCode: '',
  futuresName: '',
  market: 'USD', // 默认值改为 USD，与 PE Trade 保持一致
  executor: '',
  direction: 'BUY',
  quantity: 0,
  price_excl_fee: 0,
  amount_excl_fee: 0,
  fee: 0,
  amount_incl_fee: 0,
  avg_price_incl_fee: 0
});

export default function CBBCTradePage() {
  // --- State ---
  const [transactions, setTransactions] = useState<CBBCTrade[]>([]);
  // SSR 时初始给空日期，避免服务端和客户端 Hydration 差异报错
  const [formData, setFormData] = useState<CBBCTrade>({ ...getInitialFormState(), date: '' });
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  // 编辑模式状态
  const [isEditing, setIsEditing] = useState(false);
  const [currentEditId, setCurrentEditId] = useState<string | null>(null);

  // --- Auth & Data Subscription ---
  useEffect(() => {
    // 客户端组件挂载后，安全地填充今天的日期
    setFormData(prev => ({ ...prev, date: new Date().toISOString().split('T')[0] }));
    
    let unsubscribeSnapshot: (() => void) | undefined;

    const initAuthAndData = async () => {
      try {
        // 1. 确保用户已登录
        if (!auth.currentUser) {
           // @ts-ignore
           if (typeof window !== 'undefined' && window.__initial_auth_token) {
             // @ts-ignore
             await signInWithCustomToken(auth, window.__initial_auth_token);
           } else {
             await signInAnonymously(auth);
           }
        }

        // 2. 监听 Auth 状态变化
        const unsubscribeAuth = onAuthStateChanged(auth, (currentUser) => {
          setUser(currentUser);
          
          if (currentUser) {
            // 3. 用户登录后，开始监听数据
            const q = query(
              collection(db, 'artifacts', APP_ID, 'public', 'data', 'sip_trade_cbbc'),
              orderBy('date', 'desc')
            );

            unsubscribeSnapshot = onSnapshot(q, (snapshot) => {
              const data = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
              })) as CBBCTrade[];
              setTransactions(data);
              setLoading(false);
              setError(null);
            }, (err) => {
              console.error("Snapshot error:", err);
              setError(`读取数据失败: ${err.message}`);
              setLoading(false);
            });
          }
        });

        return () => {
          unsubscribeAuth();
          if (unsubscribeSnapshot) unsubscribeSnapshot();
        };

      } catch (err: any) {
        console.error("Init error:", err);
        setError(`初始化失败: ${err.message}`);
        setLoading(false);
      }
    };

    initAuthAndData();
  }, []);

  // --- 自动计算逻辑 ---
  useEffect(() => {
    const { quantity, price_excl_fee, fee, direction } = formData;
    const amtExcl = quantity * price_excl_fee;
    let amtIncl = 0;
    
    // 买入：成本 = 不含费金额 + 手续费
    // 卖出：到账 = 不含费金额 - 手续费
    if (direction === 'BUY') {
      amtIncl = amtExcl + fee;
    } else {
      amtIncl = amtExcl - fee;
    }
    
    const avgPriceIncl = quantity > 0 ? amtIncl / quantity : 0;

    // 只有当计算结果与当前值有显著差异时才更新，避免死循环
    if (
      Math.abs(formData.amount_excl_fee - amtExcl) > 0.01 ||
      Math.abs(formData.amount_incl_fee - amtIncl) > 0.01 ||
      Math.abs(formData.avg_price_incl_fee - avgPriceIncl) > 0.0001
    ) {
      setFormData(prev => ({
        ...prev,
        amount_excl_fee: Number(amtExcl.toFixed(2)),
        amount_incl_fee: Number(amtIncl.toFixed(2)),
        avg_price_incl_fee: Number(avgPriceIncl.toFixed(4))
      }));
    }
  }, [formData.quantity, formData.price_excl_fee, formData.fee, formData.direction]);

  // --- Handlers ---
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: (name === 'quantity' || name === 'price_excl_fee' || name === 'fee') 
              ? parseFloat(value) || 0 
              : value
    }));
  };

  // 点击修改按钮
  const handleEditClick = (trade: CBBCTrade) => {
    setIsEditing(true);
    setCurrentEditId(trade.id || null);
    setFormData({ ...trade });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // 取消修改
  const handleCancelEdit = () => {
    setIsEditing(false);
    setCurrentEditId(null);
    setFormData(getInitialFormState());
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      setError("用户未登录，无法提交");
      return;
    }
    setSubmitting(true);
    setError(null);

    try {
      if (isEditing && currentEditId) {
        // --- 更新逻辑 ---
        const docRef = doc(db, 'artifacts', APP_ID, 'public', 'data', 'sip_trade_cbbc', currentEditId);
        // 不更新 createdAt
        const { id, createdAt, ...updateData } = formData; 
        await updateDoc(docRef, updateData);
        
        setIsEditing(false);
        setCurrentEditId(null);
      } else {
        // --- 新增逻辑 ---
        await addDoc(collection(db, 'artifacts', APP_ID, 'public', 'data', 'sip_trade_cbbc'), {
          ...formData,
          createdAt: serverTimestamp()
        });
      }

      // 重置表单，保留部分偏好设置
      setFormData({
        ...getInitialFormState(),
        date: formData.date,
        account: formData.account,
        market: formData.market,
        executor: formData.executor
      });

    } catch (err: any) {
      console.error("Error saving document: ", err);
      setError(`${isEditing ? '更新' : '提交'}失败: ${err.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确认删除这条交易记录吗？')) return;
    if (!user) return;

    try {
      await deleteDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'sip_trade_cbbc', id));
      if (isEditing && currentEditId === id) {
        handleCancelEdit();
      }
    } catch (err: any) {
      console.error("Error deleting document: ", err);
      setError(`删除失败: ${err.message}`);
    }
  };

  return (
    <div className="space-y-6 pb-10 max-w-[1400px] mx-auto">
      <div className="border-b border-gray-200 pb-4 flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">牛熊证/期货交易录入 (CBBC Trade)</h1>
          <p className="mt-1 text-sm text-gray-500">
            录入牛熊证、期货及相关衍生品的交易流水，系统将自动计算含费金额与均价。无需关联股票池代码。
          </p>
        </div>
        <div className="text-sm text-gray-400">
          {loading ? '连接数据库...' : `共 ${transactions.length} 条记录`}
        </div>
      </div>

      {/* --- 错误提示区域 --- */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3 animate-in fade-in slide-in-from-top-2">
          <XCircle className="text-red-500 flex-shrink-0 mt-0.5" size={18} />
          <div className="flex-1">
            <h3 className="text-sm font-bold text-red-800">发生错误</h3>
            <p className="text-sm text-red-700 mt-1 break-all font-mono">{error}</p>
          </div>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600">
            <XCircle size={20} />
          </button>
        </div>
      )}

      {/* --- 录入表单 --- */}
      <div className={`bg-white p-6 rounded-lg shadow-sm border transition-all duration-300 ${isEditing ? 'border-purple-400 ring-1 ring-purple-100' : 'border-gray-200'}`}>
        <div className="flex justify-between items-center mb-4">
          <h2 className={`text-sm font-bold flex items-center gap-2 ${isEditing ? 'text-purple-600' : 'text-gray-700'}`}>
            {isEditing ? (
              <><Edit2 size={16} />修改交易记录</>
            ) : (
              <><Plus size={16} className="text-purple-600" />新增牛熊证/期货交易</>
            )}
          </h2>
          {isEditing && (
            <button 
              onClick={handleCancelEdit}
              className="text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-100 px-2 py-1 rounded flex items-center gap-1 transition-colors"
            >
              <X size={14} />取消修改
            </button>
          )}
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            
            {/* 第一行：基础信息 */}
            <div className="col-span-1">
              <label className="block text-xs font-medium text-gray-500 mb-1">日期</label>
              <input type="date" name="date" required value={formData.date} onChange={handleInputChange} className="w-full p-2 border rounded text-sm focus:ring-2 focus:ring-purple-500 outline-none" />
            </div>
            <div className="col-span-1">
              <label className="block text-xs font-medium text-gray-500 mb-1">账户</label>
              <input type="text" name="account" placeholder="输入账户" required value={formData.account} onChange={handleInputChange} className="w-full p-2 border rounded text-sm focus:ring-2 focus:ring-purple-500 outline-none" />
            </div>
            <div className="col-span-1">
              <label className="block text-xs font-medium text-gray-500 mb-1">市场 (币种)</label>
              <select name="market" value={formData.market} onChange={handleInputChange} className="w-full p-2 border rounded text-sm outline-none focus:ring-2 focus:ring-purple-500">
                <option value="USD">USD</option>
                <option value="CNY">CNY</option>
                <option value="HKD">HKD</option>
                <option value="JPY">JPY</option>
              </select>
            </div>
            <div className="col-span-1">
              <label className="block text-xs font-medium text-gray-500 mb-1">执行人</label>
              <input type="text" name="executor" placeholder="Trader Name" value={formData.executor} onChange={handleInputChange} className="w-full p-2 border rounded text-sm focus:ring-2 focus:ring-purple-500 outline-none" />
            </div>
            <div className="col-span-1">
              <label className="block text-xs font-medium text-gray-500 mb-1">交易方向</label>
              <select name="direction" value={formData.direction} onChange={handleInputChange} className={`w-full p-2 border rounded text-sm font-bold outline-none ${formData.direction === 'BUY' ? 'text-red-600 bg-red-50' : 'text-green-600 bg-green-50'}`}>
                <option value="BUY">买入 / 开仓 (BUY)</option>
                <option value="SELL">卖出 / 平仓 (SELL)</option>
              </select>
            </div>

            {/* 第二行：标的信息与数值 */}
            <div className="col-span-1">
              <label className="block text-xs font-medium text-gray-500 mb-1">标的简码</label>
              <input type="text" name="futuresCode" placeholder="e.g. 50012.HK" required value={formData.futuresCode} onChange={handleInputChange} className="w-full p-2 border rounded text-sm outline-none font-mono focus:ring-2 focus:ring-purple-500" />
            </div>
            <div className="col-span-1 md:col-span-2">
              <label className="block text-xs font-medium text-gray-500 mb-1">标的名称</label>
              <input type="text" name="futuresName" placeholder="输入全称 (如 恒指法兴四甲牛G.C)" required value={formData.futuresName} onChange={handleInputChange} className="w-full p-2 border rounded text-sm outline-none focus:ring-2 focus:ring-purple-500" />
            </div>
            <div className="col-span-1">
              <label className="block text-xs font-medium text-gray-500 mb-1">份额数量</label>
              <input type="number" name="quantity" min="0" step="0.0001" required value={formData.quantity || ''} onChange={handleInputChange} className="w-full p-2 border rounded text-sm outline-none focus:ring-2 focus:ring-purple-500 font-mono" />
            </div>
            <div className="col-span-1">
              <label className="block text-xs font-medium text-gray-500 mb-1">均价 (不含费)</label>
              <input type="number" name="price_excl_fee" min="0" step="0.0001" required value={formData.price_excl_fee || ''} onChange={handleInputChange} className="w-full p-2 border rounded text-sm outline-none focus:ring-2 focus:ring-purple-500 font-mono" />
            </div>

            {/* 第三行：费用与计算展示 */}
            <div className="col-span-1">
              <label className="block text-xs font-medium text-gray-500 mb-1">手续费</label>
              <input type="number" name="fee" min="0" step="0.01" value={formData.fee || ''} onChange={handleInputChange} className="w-full p-2 border rounded text-sm outline-none focus:ring-2 focus:ring-purple-500 font-mono" />
            </div>
            <div className="col-span-2 md:col-span-4 flex items-center gap-4 bg-purple-50 p-2 rounded border border-purple-100">
               <Calculator size={20} className="text-purple-400" />
               <div className="flex-1 grid grid-cols-2 gap-4">
                 <div className="flex justify-between items-center text-xs text-purple-800">
                   <span>金额 (不含费):</span>
                   <span className="font-mono">{formData.amount_excl_fee.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
                 </div>
                 <div className="flex justify-between items-center text-sm font-bold text-purple-900 border-l border-purple-200 pl-4">
                   <span>金额 (含费):</span>
                   <span className="font-mono">{formData.amount_incl_fee.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
                 </div>
               </div>
            </div>
          </div>
          
          <div className="pt-2 flex justify-end gap-3">
            {isEditing && (
              <button
                type="button"
                onClick={handleCancelEdit}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 bg-gray-100 hover:bg-gray-200 rounded transition-colors"
              >
                取消
              </button>
            )}
            <button 
              type="submit" 
              disabled={submitting}
              className={`flex items-center gap-2 text-white px-6 py-2 rounded disabled:opacity-50 transition-colors shadow-sm ${
                isEditing 
                ? 'bg-purple-600 hover:bg-purple-700 shadow-purple-200' 
                : 'bg-green-600 hover:bg-green-700 shadow-green-200'
              }`}
            >
              {submitting ? (
                <Loader2 className="animate-spin" size={16} />
              ) : isEditing ? (
                <Save size={16} />
              ) : (
                <Plus size={16} />
              )}
              {submitting ? '提交中...' : isEditing ? '保存修改' : '提交交易'}
            </button>
          </div>
        </form>
      </div>

      {/* --- 数据表格 --- */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-gray-50 text-gray-500 font-medium border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 whitespace-nowrap">日期</th>
                <th className="px-4 py-3 whitespace-nowrap">标的名称/简码</th>
                <th className="px-4 py-3 whitespace-nowrap">账户</th>
                <th className="px-4 py-3 whitespace-nowrap text-center">市场</th>
                <th className="px-4 py-3 whitespace-nowrap text-center">方向</th>
                <th className="px-4 py-3 text-right whitespace-nowrap">数量</th>
                <th className="px-4 py-3 text-right whitespace-nowrap">均价(不含费)</th>
                <th className="px-4 py-3 text-right whitespace-nowrap">手续费</th>
                <th className="px-4 py-3 text-right whitespace-nowrap">金额(含费)</th>
                <th className="px-4 py-3 text-center whitespace-nowrap">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td colSpan={10} className="px-4 py-8 text-center text-gray-400">
                    <div className="flex justify-center items-center gap-2">
                      <Loader2 className="animate-spin" size={16} /> 加载数据中...
                    </div>
                  </td>
                </tr>
              ) : transactions.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-8 text-center text-gray-400 flex flex-col items-center">
                    <AlertCircle size={24} className="mb-2 opacity-50" />
                    暂无交易记录
                  </td>
                </tr>
              ) : (
                transactions.map((t) => (
                  <tr 
                    key={t.id} 
                    className={`hover:bg-gray-50 transition-colors group ${currentEditId === t.id ? 'bg-purple-50/50' : ''}`}
                  >
                    <td className="px-4 py-3 whitespace-nowrap text-gray-600">{t.date}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="font-medium text-gray-900">{t.futuresName}</div>
                      <div className="text-xs text-gray-500 font-mono">{t.futuresCode}</div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-gray-600">
                      <div>{t.account}</div>
                      <div className="text-[10px] text-gray-400">{t.executor}</div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-center font-mono text-gray-500">{t.market}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-center">
                      <span className={`px-2 py-0.5 rounded text-xs font-bold ${t.direction === 'BUY' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                        {t.direction === 'BUY' ? '买入' : '卖出'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-gray-700">{t.quantity.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 4})}</td>
                    <td className="px-4 py-3 text-right font-mono text-gray-600">{t.price_excl_fee.toFixed(4)}</td>
                    <td className="px-4 py-3 text-right font-mono text-gray-400">{t.fee.toFixed(2)}</td>
                    <td className="px-4 py-3 text-right font-mono font-medium text-purple-700 bg-purple-50/30">{t.amount_incl_fee.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <button 
                          onClick={() => handleEditClick(t)}
                          className="text-gray-400 hover:text-purple-600 p-1 rounded hover:bg-purple-50 transition-colors"
                          title="修改"
                        >
                          <Edit2 size={16} />
                        </button>
                        <button 
                          onClick={() => handleDelete(t.id!)}
                          className="text-gray-400 hover:text-red-600 p-1 rounded hover:bg-red-50 transition-colors"
                          title="删除"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}