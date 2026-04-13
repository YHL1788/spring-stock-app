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

// 引入統一的 Firebase 實例和工具
import { db, auth, APP_ID } from '@/app/lib/stockService';

// --- 類型定義 ---
interface PETrade {
  id?: string;
  date: string;
  account: string;
  fundCode: string;
  fundName: string;
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

// 獲取初始表單狀態（動態獲取當前日期）
const getInitialFormState = (): PETrade => ({
  date: new Date().toISOString().split('T')[0],
  account: '',
  fundCode: '',
  fundName: '',
  market: 'USD',
  executor: '',
  direction: 'BUY',
  quantity: 0,
  price_excl_fee: 0,
  amount_excl_fee: 0,
  fee: 0,
  amount_incl_fee: 0,
  avg_price_incl_fee: 0
});

export default function PETradePage() {
  // --- State ---
  const [transactions, setTransactions] = useState<PETrade[]>([]);
  // SSR 時初始給空日期，避免伺服器端和客戶端 Hydration 差異報錯
  const [formData, setFormData] = useState<PETrade>({ ...getInitialFormState(), date: '' });
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  // 編輯模式狀態
  const [isEditing, setIsEditing] = useState(false);
  const [currentEditId, setCurrentEditId] = useState<string | null>(null);

  // --- Auth & Data Subscription ---
  useEffect(() => {
    // 客戶端組件掛載後，安全地填充今天的日期
    setFormData(prev => ({ ...prev, date: new Date().toISOString().split('T')[0] }));
    
    let unsubscribeSnapshot: (() => void) | undefined;

    const initAuthAndData = async () => {
      try {
        // 1. 確保用戶已登錄
        if (!auth.currentUser) {
           // @ts-ignore
           if (typeof window !== 'undefined' && window.__initial_auth_token) {
             // @ts-ignore
             await signInWithCustomToken(auth, window.__initial_auth_token);
           } else {
             await signInAnonymously(auth);
           }
        }

        // 2. 監聽 Auth 狀態變化
        const unsubscribeAuth = onAuthStateChanged(auth, (currentUser) => {
          setUser(currentUser);
          
          if (currentUser) {
            // 3. 用戶登錄後，開始監聽數據
            const q = query(
              collection(db, 'artifacts', APP_ID, 'public', 'data', 'sip_trade_pe'),
              orderBy('date', 'desc')
            );

            unsubscribeSnapshot = onSnapshot(q, (snapshot) => {
              const data = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
              })) as PETrade[];
              setTransactions(data);
              setLoading(false);
              setError(null);
            }, (err) => {
              console.error("Snapshot error:", err);
              setError(`讀取數據失敗: ${err.message}`);
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
        setError(`初始化失敗: ${err.message}`);
        setLoading(false);
      }
    };

    initAuthAndData();
  }, []);

  // --- 自動計算邏輯 ---
  useEffect(() => {
    const { quantity, price_excl_fee, fee, direction } = formData;
    const amtExcl = quantity * price_excl_fee;
    let amtIncl = 0;
    
    // 買入：成本 = 不含費金額 + 手續費
    // 賣出：到賬 = 不含費金額 - 手續費
    if (direction === 'BUY') {
      amtIncl = amtExcl + fee;
    } else {
      amtIncl = amtExcl - fee;
    }
    
    const avgPriceIncl = quantity > 0 ? amtIncl / quantity : 0;

    // 只有當計算結果與當前值有顯著差異時才更新，避免死循環
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

  // 點擊修改按鈕
  const handleEditClick = (trade: PETrade) => {
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
      setError("用戶未登錄，無法提交");
      return;
    }
    setSubmitting(true);
    setError(null);

    try {
      if (isEditing && currentEditId) {
        // --- 更新邏輯 ---
        const docRef = doc(db, 'artifacts', APP_ID, 'public', 'data', 'sip_trade_pe', currentEditId);
        // 不更新 createdAt
        const { id, createdAt, ...updateData } = formData; 
        await updateDoc(docRef, updateData);
        
        setIsEditing(false);
        setCurrentEditId(null);
      } else {
        // --- 新增邏輯 ---
        await addDoc(collection(db, 'artifacts', APP_ID, 'public', 'data', 'sip_trade_pe'), {
          ...formData,
          createdAt: serverTimestamp()
        });
      }

      // 重置表單，保留部分偏好設置（如日期、賬戶、市場、執行人）
      setFormData({
        ...getInitialFormState(),
        date: formData.date,
        account: formData.account,
        market: formData.market,
        executor: formData.executor
      });

    } catch (err: any) {
      console.error("Error saving document: ", err);
      setError(`${isEditing ? '更新' : '提交'}失敗: ${err.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('確認刪除這條交易記錄嗎？')) return;
    if (!user) return;

    try {
      await deleteDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'sip_trade_pe', id));
      if (isEditing && currentEditId === id) {
        handleCancelEdit();
      }
    } catch (err: any) {
      console.error("Error deleting document: ", err);
      setError(`刪除失敗: ${err.message}`);
    }
  };

  return (
    <div className="space-y-6 pb-10 max-w-[1400px] mx-auto">
      <div className="border-b border-gray-200 pb-4 flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">私募基金交易錄入 (PE Trade)</h1>
          <p className="mt-1 text-sm text-gray-500">
            錄入私募基金產品的申購、贖回等交易流水，系統將自動計算含費金額與均價。
          </p>
        </div>
        <div className="text-sm text-gray-400">
          {loading ? '連接資料庫...' : `共 ${transactions.length} 條記錄`}
        </div>
      </div>

      {/* --- 錯誤提示區域 --- */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3 animate-in fade-in slide-in-from-top-2">
          <XCircle className="text-red-500 flex-shrink-0 mt-0.5" size={18} />
          <div className="flex-1">
            <h3 className="text-sm font-bold text-red-800">發生錯誤</h3>
            <p className="text-sm text-red-700 mt-1 break-all font-mono">{error}</p>
            {error.includes('requires an index') && (
              <p className="text-xs text-red-600 mt-2">
                提示: Firestore 需要建立索引。請複製錯誤資訊中的 URL 在瀏覽器打開以創建索引。
              </p>
            )}
          </div>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600">
            <span className="sr-only">關閉</span>
            <XCircle size={20} />
          </button>
        </div>
      )}

      {/* --- 錄入表單 --- */}
      <div className={`bg-white p-6 rounded-lg shadow-sm border transition-all duration-300 ${isEditing ? 'border-purple-400 ring-1 ring-purple-100' : 'border-gray-200'}`}>
        <div className="flex justify-between items-center mb-4">
          <h2 className={`text-sm font-bold flex items-center gap-2 ${isEditing ? 'text-purple-600' : 'text-gray-700'}`}>
            {isEditing ? (
              <>
                <Edit2 size={16} />
                修改交易記錄
              </>
            ) : (
              <>
                <Plus size={16} className="text-purple-600" />
                新增私募交易
              </>
            )}
          </h2>
          {isEditing && (
            <button 
              onClick={handleCancelEdit}
              className="text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-100 px-2 py-1 rounded flex items-center gap-1 transition-colors"
            >
              <X size={14} />
              取消修改
            </button>
          )}
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            
            {/* 第一行：基礎資訊 */}
            <div className="col-span-1">
              <label className="block text-xs font-medium text-gray-500 mb-1">日期</label>
              <input type="date" name="date" required value={formData.date} onChange={handleInputChange} className="w-full p-2 border rounded text-sm focus:ring-2 focus:ring-purple-500 outline-none" />
            </div>
            <div className="col-span-1">
              <label className="block text-xs font-medium text-gray-500 mb-1">帳戶</label>
              <input type="text" name="account" placeholder="輸入帳戶" required value={formData.account} onChange={handleInputChange} className="w-full p-2 border rounded text-sm focus:ring-2 focus:ring-purple-500 outline-none" />
            </div>
            <div className="col-span-1">
              <label className="block text-xs font-medium text-gray-500 mb-1">市場 (幣種)</label>
              <select name="market" value={formData.market} onChange={handleInputChange} className="w-full p-2 border rounded text-sm outline-none focus:ring-2 focus:ring-purple-500">
                <option value="USD">USD</option>
                <option value="CNY">CNY</option>
                <option value="HKD">HKD</option>
                <option value="JPY">JPY</option>
              </select>
            </div>
            <div className="col-span-1">
              <label className="block text-xs font-medium text-gray-500 mb-1">執行人</label>
              <input type="text" name="executor" placeholder="Trader Name" value={formData.executor} onChange={handleInputChange} className="w-full p-2 border rounded text-sm focus:ring-2 focus:ring-purple-500 outline-none" />
            </div>
            <div className="col-span-1">
              <label className="block text-xs font-medium text-gray-500 mb-1">交易方向</label>
              <select name="direction" value={formData.direction} onChange={handleInputChange} className={`w-full p-2 border rounded text-sm font-bold outline-none ${formData.direction === 'BUY' ? 'text-red-600 bg-red-50' : 'text-green-600 bg-green-50'}`}>
                <option value="BUY">申購 (BUY)</option>
                <option value="SELL">贖回 (SELL)</option>
              </select>
            </div>

            {/* 第二行：基金資訊與數值 */}
            <div className="col-span-1">
              <label className="block text-xs font-medium text-gray-500 mb-1">基金簡碼</label>
              <input type="text" name="fundCode" placeholder="e.g. PE001" required value={formData.fundCode} onChange={handleInputChange} className="w-full p-2 border rounded text-sm outline-none font-mono focus:ring-2 focus:ring-purple-500" />
            </div>
            <div className="col-span-1 md:col-span-2">
              <label className="block text-xs font-medium text-gray-500 mb-1">基金名稱</label>
              <input type="text" name="fundName" placeholder="輸入基金全稱" required value={formData.fundName} onChange={handleInputChange} className="w-full p-2 border rounded text-sm outline-none focus:ring-2 focus:ring-purple-500" />
            </div>
            <div className="col-span-1">
              <label className="block text-xs font-medium text-gray-500 mb-1">份額數量</label>
              <input type="number" name="quantity" min="0" step="0.0001" required value={formData.quantity || ''} onChange={handleInputChange} className="w-full p-2 border rounded text-sm outline-none focus:ring-2 focus:ring-purple-500 font-mono" />
            </div>
            <div className="col-span-1">
              <label className="block text-xs font-medium text-gray-500 mb-1">均價 (不含費)</label>
              <input type="number" name="price_excl_fee" min="0" step="0.0001" required value={formData.price_excl_fee || ''} onChange={handleInputChange} className="w-full p-2 border rounded text-sm outline-none focus:ring-2 focus:ring-purple-500 font-mono" />
            </div>

            {/* 第三行：費用與計算展示 */}
            <div className="col-span-1">
              <label className="block text-xs font-medium text-gray-500 mb-1">手續費</label>
              <input type="number" name="fee" min="0" step="0.01" value={formData.fee || ''} onChange={handleInputChange} className="w-full p-2 border rounded text-sm outline-none focus:ring-2 focus:ring-purple-500 font-mono" />
            </div>
            <div className="col-span-2 md:col-span-4 flex items-center gap-4 bg-purple-50 p-2 rounded border border-purple-100">
               <Calculator size={20} className="text-purple-400" />
               <div className="flex-1 grid grid-cols-2 gap-4">
                 <div className="flex justify-between items-center text-xs text-purple-800">
                   <span>金額 (不含費):</span>
                   <span className="font-mono">{formData.amount_excl_fee.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
                 </div>
                 <div className="flex justify-between items-center text-sm font-bold text-purple-900 border-l border-purple-200 pl-4">
                   <span>金額 (含費):</span>
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

      {/* --- 數據表格 --- */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-gray-50 text-gray-500 font-medium border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 whitespace-nowrap">日期</th>
                <th className="px-4 py-3 whitespace-nowrap">基金名稱/簡碼</th>
                <th className="px-4 py-3 whitespace-nowrap">帳戶</th>
                <th className="px-4 py-3 whitespace-nowrap text-center">市場</th>
                <th className="px-4 py-3 whitespace-nowrap text-center">方向</th>
                <th className="px-4 py-3 text-right whitespace-nowrap">份額數量</th>
                <th className="px-4 py-3 text-right whitespace-nowrap">均價(不含費)</th>
                <th className="px-4 py-3 text-right whitespace-nowrap">手續費</th>
                <th className="px-4 py-3 text-right whitespace-nowrap">金額(含費)</th>
                <th className="px-4 py-3 text-center whitespace-nowrap">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td colSpan={10} className="px-4 py-8 text-center text-gray-400">
                    <div className="flex justify-center items-center gap-2">
                      <Loader2 className="animate-spin" size={16} /> 加載數據中...
                    </div>
                  </td>
                </tr>
              ) : transactions.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-8 text-center text-gray-400 flex flex-col items-center">
                    <AlertCircle size={24} className="mb-2 opacity-50" />
                    暫無私募交易記錄
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
                      <div className="font-medium text-gray-900">{t.fundName}</div>
                      <div className="text-xs text-gray-500 font-mono">{t.fundCode}</div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-gray-600">
                      <div>{t.account}</div>
                      <div className="text-[10px] text-gray-400">{t.executor}</div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-center font-mono text-gray-500">{t.market}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-center">
                      <span className={`px-2 py-0.5 rounded text-xs font-bold ${t.direction === 'BUY' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                        {t.direction === 'BUY' ? '申購' : '贖回'}
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
                          title="刪除"
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