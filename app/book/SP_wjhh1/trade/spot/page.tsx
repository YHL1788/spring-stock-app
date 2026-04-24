'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { 
  Plus, 
  Trash2, 
  Save, 
  Loader2, 
  AlertCircle,
  Calculator,
  XCircle,
  Edit2,
  X,
  ClipboardList,
  Play,
  Search
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
  serverTimestamp,
  writeBatch,
  getDocs
} from 'firebase/firestore';
import { onAuthStateChanged, signInAnonymously, signInWithCustomToken } from 'firebase/auth';

// 引入统一的 Firebase 实例和工具
import { db, auth, APP_ID } from '@/app/lib/stockService';
import { useStockPool } from '@/app/hooks/useStockPool';

// --- 日期格式规范化辅助函数 (清洗 Excel 各种斜杠、不补零格式) ---
const normalizeDateStr = (dateStr: string) => {
    if (!dateStr) return '';
    let formatted = dateStr.replace(/\//g, '-');
    const parts = formatted.split('-');
    if (parts.length === 3) {
        const y = parts[0];
        const m = parts[1].padStart(2, '0');
        const d = parts[2].padStart(2, '0');
        formatted = `${y}-${m}-${d}`;
    }
    return formatted;
};

// --- 可排序筛选表头组件 ---
const Th = ({ label, sortKey, filterKey, currentSort, onSort, currentFilter, onFilter, align='left', width }: any) => {
    const justifyClass = align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : 'justify-start';
    const textClass = align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left';
    
    return (
        <th className={`px-3 py-2 whitespace-nowrap align-top group sticky top-0 shadow-[0_1px_0_0_#e5e7eb] ${textClass} ${sortKey ? 'bg-gray-50' : 'bg-inherit'}`} style={{ width }}>
            <div 
                className={`flex items-center ${justifyClass} gap-1 select-none ${sortKey ? 'cursor-pointer hover:text-gray-800' : ''}`}
                onClick={() => sortKey && onSort && onSort(sortKey)}
            >
                {label}
                {sortKey && currentSort?.key === sortKey && (
                    <span className="text-blue-500 text-[10px] ml-1">
                        {currentSort.dir === 'asc' ? '▲' : '▼'}
                    </span>
                )}
                {sortKey && currentSort?.key !== sortKey && onSort && (
                    <span className="text-gray-300 text-[10px] opacity-0 group-hover:opacity-100 transition-opacity ml-1">▲</span>
                )}
            </div>
            {filterKey && onFilter && (
                <div className="mt-1 relative">
                    <input 
                        type="text" 
                        placeholder="筛选" 
                        value={currentFilter?.[filterKey] || ''}
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

// --- 类型定义 ---
interface SpotTrade {
  id?: string;
  date: string;
  account: string;
  market: string;
  executor: string;
  type: string;
  direction: 'BUY' | 'SELL';
  code: string;
  name: string;
  quantity: number;
  price_excl_fee: number;
  amount_excl_fee: number;
  fee: number;
  amount_incl_fee: number;
  avg_price_incl_fee: number;
  createdAt?: any;
}

const initialFormState: SpotTrade = {
  date: new Date().toISOString().split('T')[0],
  account: '',
  market: 'HKD',
  executor: '',
  type: '普通股票',
  direction: 'BUY',
  code: '',
  name: '',
  quantity: 0,
  price_excl_fee: 0,
  amount_excl_fee: 0,
  fee: 0,
  amount_incl_fee: 0,
  avg_price_incl_fee: 0
};

export default function SpotTradePage() {
  // --- State ---
  const { stocks } = useStockPool();
  const [transactions, setTransactions] = useState<SpotTrade[]>([]);
  // 修复：SSR 时初始给空日期，避免服务端和客户端 Hydration 差异报错
  const [formData, setFormData] = useState<SpotTrade>({ ...initialFormState, date: '' });
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  // 编辑模式状态
  const [isEditing, setIsEditing] = useState(false);
  const [currentEditId, setCurrentEditId] = useState<string | null>(null);

  // --- 批量导入 (Clipboard Paste) State ---
  const [showPasteModal, setShowPasteModal] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [parsedPasteData, setParsedPasteData] = useState<any[]>([]);
  const [isBulkProcessing, setIsBulkProcessing] = useState(false);

  // --- 交易流水排序与筛选状态 ---
  const [tradeSort, setTradeSort] = useState<{key: string, dir: 'asc'|'desc'|null}>({key: 'date', dir: 'desc'});
  const [tradeFilters, setTradeFilters] = useState<Record<string, string>>({});

  const toggleTradeSort = (key: string) => {
      setTradeSort(prev => {
          if (prev.key === key) {
              if (prev.dir === 'asc') return { key, dir: 'desc' };
              if (prev.dir === 'desc') return { key: '', dir: null };
          }
          return { key, dir: 'asc' };
      });
  };

  const updateTradeFilter = (key: string, val: string) => {
      setTradeFilters(prev => ({ ...prev, [key]: val }));
  };

  // --- Auth & Data Subscription ---
  useEffect(() => {
    // 修复：客户端组件挂载后，安全地填充今天的日期
    setFormData(prev => ({ ...prev, date: new Date().toISOString().split('T')[0] }));

    let unsubscribeSnapshot: (() => void) | undefined;

    const initAuthAndData = async () => {
      try {
        // 1. 确保用户已登录
        if (!auth.currentUser) {
           // @ts-ignore: 处理 Canvas 环境特殊的 Token 注入
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
              collection(db, 'artifacts', APP_ID, 'public', 'data', 'sip_spot_trade')
            );

            unsubscribeSnapshot = onSnapshot(q, (snapshot) => {
              const data = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
              })) as SpotTrade[];
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
  }, []); // 仅组件挂载时执行

  // --- 交易数据渲染前的筛选与排序 ---
  const displayTransactions = useMemo(() => {
      let result = [...transactions];

      Object.keys(tradeFilters).forEach(key => {
          const filterValue = tradeFilters[key]?.toLowerCase();
          if (filterValue) {
              if (key === 'codeOrName') {
                   result = result.filter(item =>
                       String(item.code || '').toLowerCase().includes(filterValue) ||
                       String(item.name || '').toLowerCase().includes(filterValue)
                   );
              } else {
                  result = result.filter(item => {
                      const itemVal = (item as any)[key];
                      if (itemVal == null) return false;
                      return String(itemVal).toLowerCase().includes(filterValue);
                  });
              }
          }
      });

      // 默认排序或者按选择的列排序
      result.sort((a, b) => {
          if (tradeSort.dir && tradeSort.key) {
              let aVal = (a as any)[tradeSort.key];
              let bVal = (b as any)[tradeSort.key];

              const isAEmpty = aVal === null || aVal === undefined || aVal === '';
              const isBEmpty = bVal === null || bVal === undefined || bVal === '';

              if (isAEmpty && isBEmpty) return 0;
              if (isAEmpty) return 1;
              if (isBEmpty) return -1;

              if (typeof aVal === 'string' && typeof bVal === 'string') return tradeSort.dir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
              if (aVal < bVal) return tradeSort.dir === 'asc' ? -1 : 1;
              if (aVal > bVal) return tradeSort.dir === 'asc' ? 1 : -1;
              return 0;
          } else {
              // 默认按照日期和创建时间降序
              const timeA = new Date(a.date).getTime();
              const timeB = new Date(b.date).getTime();
              if (timeA !== timeB) return timeB - timeA;
              const createdA = a.createdAt?.toMillis ? a.createdAt.toMillis() : (a.createdAt?.seconds ? a.createdAt.seconds * 1000 : 0);
              const createdB = b.createdAt?.toMillis ? b.createdAt.toMillis() : (b.createdAt?.seconds ? b.createdAt.seconds * 1000 : 0);
              return createdB - createdA;
          }
      });

      return result;
  }, [transactions, tradeSort, tradeFilters]);


  // --- 自动填充股票名称 ---
  useEffect(() => {
    // 仅在新增模式或手动修改code时触发，避免编辑回填时覆盖
    if (!formData.code || !stocks || stocks.length === 0) return;
    
    const targetCode = formData.code.trim().toUpperCase();
    const match = stocks.find((s: any) => s.symbol === targetCode);
    if (match && match.name && !isEditing) {
      setFormData(prev => ({ ...prev, name: match.name }));
    }
  }, [formData.code, stocks, isEditing]);

  // --- 自动计算逻辑 (单条录入表单) ---
  useEffect(() => {
    const { quantity, price_excl_fee, fee, direction } = formData;
    const amtExcl = quantity * price_excl_fee;
    let amtIncl = 0;
    if (direction === 'BUY') {
      amtIncl = amtExcl + fee;
    } else {
      amtIncl = amtExcl - fee;
    }
    // 修复：针对 SELL 时数量为负的情况，防止分母为 0
    const avgPriceIncl = quantity !== 0 ? amtIncl / Math.abs(quantity) : 0;

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
  const handleEditClick = (trade: SpotTrade) => {
    setIsEditing(true);
    setCurrentEditId(trade.id || null);
    setFormData({ ...trade });
    // 滚动到顶部
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // 取消修改
  const handleCancelEdit = () => {
    setIsEditing(false);
    setCurrentEditId(null);
    setFormData({ ...initialFormState, date: new Date().toISOString().split('T')[0] });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      setError("用户未登录，无法提交");
      return;
    }

    // 强校验正负号规则
    if (formData.direction === 'BUY' && formData.quantity <= 0) {
      setError("买入 (BUY) 方向的数量必须大于 0！");
      return;
    }
    if (formData.direction === 'SELL' && formData.quantity >= 0) {
      setError("卖出 (SELL) 方向的数量必须小于 0！（请在数量前添加负号）");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      if (isEditing && currentEditId) {
        // --- 更新逻辑 ---
        const docRef = doc(db, 'artifacts', APP_ID, 'public', 'data', 'sip_spot_trade', currentEditId);
        // 不更新 createdAt
        const { id, createdAt, ...updateData } = formData; 
        await updateDoc(docRef, updateData);
        
        // 重置状态
        setIsEditing(false);
        setCurrentEditId(null);
      } else {
        // --- 新增逻辑 ---
        await addDoc(collection(db, 'artifacts', APP_ID, 'public', 'data', 'sip_spot_trade'), {
          ...formData,
          createdAt: serverTimestamp()
        });
      }

      // 重置表单，保留部分偏好设置（如日期、账户）
      setFormData({
        ...initialFormState,
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
      await deleteDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'sip_spot_trade', id));
      // 如果正在编辑被删除的项，退出编辑模式
      if (isEditing && currentEditId === id) {
        handleCancelEdit();
      }
    } catch (err: any) {
      console.error("Error deleting document: ", err);
      setError(`删除失败: ${err.message}`);
    }
  };

  // --- 一键清空现货交易库 ---
  const handleClearAll = async () => {
    if (!user) return;
    if (!confirm('警告：您确定要永久清空现货交易库中的所有数据吗？此操作不可撤销！')) return;
    if (!confirm('再次确认：清空操作将删除该库的所有记录，请确认您知道自己在做什么！')) return;

    setLoading(true);
    try {
      const q = query(collection(db, 'artifacts', APP_ID, 'public', 'data', 'sip_spot_trade'));
      const snap = await getDocs(q);
      const batch = writeBatch(db);
      snap.docs.forEach(d => batch.delete(d.ref));
      await batch.commit();
      alert(`成功清空了 ${snap.size} 条现货交易记录！`);
    } catch(err: any) {
      setError(`清空失败: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // ==========================================
  // --- 批量导入 (Clipboard Paste) 解析与执行逻辑 ---
  // ==========================================
  const handlePasteTextChange = (e: any) => {
      const text = e.target.value;
      setPasteText(text);
      
      const rows = text.split('\n').map((r: string) => r.trim()).filter(Boolean);
      
      const parsed = rows.map((row: string) => {
          const cols = row.split('\t');
          const rawDirection = cols[5]?.trim().toUpperCase() || 'BUY';
          const isSell = rawDirection.includes('SELL') || rawDirection.includes('卖');
          const direction = isSell ? 'SELL' : 'BUY';
          
          // 自动判断并清洗出正确的正负号数量
          const rawQuantity = parseFloat(cols[8]?.replace(/,/g, '')) || 0;
          const absQty = Math.abs(rawQuantity);
          const quantity = direction === 'SELL' ? -absQty : absQty;
          
          const price_excl_fee = parseFloat(cols[9]?.replace(/,/g, '')) || 0;
          const fee = parseFloat(cols[10]?.replace(/,/g, '')) || 0;

          const amount_excl_fee = Math.abs(quantity) * price_excl_fee;
          const amount_incl_fee = direction === 'BUY' ? amount_excl_fee + fee : amount_excl_fee - fee;
          const avg_price_incl_fee = quantity !== 0 ? amount_incl_fee / Math.abs(quantity) : 0;

          let code = cols[6]?.trim().toUpperCase() || '';
          let name = cols[7]?.trim() || '';

          // 尝试自动匹配股票名称
          if (code && !name && stocks.length > 0) {
              const match = stocks.find((s: any) => s.symbol === code);
              if (match) name = match.name;
          }

          return {
              account: cols[0]?.trim() || '',
              executor: cols[1]?.trim() || '',
              date: normalizeDateStr(cols[2]?.trim() || ''),
              market: cols[3]?.trim().toUpperCase() || 'HKD',
              type: cols[4]?.trim() || '普通股票',
              direction: direction,
              code: code,
              name: name,
              quantity: quantity,
              price_excl_fee: price_excl_fee,
              amount_excl_fee: Number(amount_excl_fee.toFixed(2)),
              fee: fee,
              amount_incl_fee: Number(amount_incl_fee.toFixed(2)),
              avg_price_incl_fee: Number(avg_price_incl_fee.toFixed(4)),
          };
      }).filter((item: any) => item.code && item.account && item.date); 
      
      setParsedPasteData(parsed);
  };

  // --- 修改校验区数据的事件处理器 ---
  const handleParsedDataChange = (index: number, field: string, value: any) => {
      const newData = [...parsedPasteData];
      const row = { ...newData[index] };

      // 处理修改方向或数量时，自动同步正负号
      if (field === 'direction') {
          row.direction = value;
          const absQty = Math.abs(row.quantity);
          row.quantity = value === 'SELL' ? -absQty : absQty;
      } else if (field === 'quantity') {
          const val = parseFloat(value) || 0;
          row.quantity = row.direction === 'SELL' ? -Math.abs(val) : Math.abs(val);
      } else {
          row[field] = value;
      }

      // 当财务字段发生变化时，实时重新计算总额和均价
      if (['quantity', 'price_excl_fee', 'fee', 'direction'].includes(field)) {
          const qty = Number(row.quantity) || 0;
          const price = Number(row.price_excl_fee) || 0;
          const fee = Number(row.fee) || 0;
          
          const amount_excl_fee = Math.abs(qty) * price;
          const amount_incl_fee = row.direction === 'BUY' ? amount_excl_fee + fee : amount_excl_fee - fee;
          const avg_price_incl_fee = qty !== 0 ? amount_incl_fee / Math.abs(qty) : 0;

          row.amount_excl_fee = Number(amount_excl_fee.toFixed(2));
          row.amount_incl_fee = Number(amount_incl_fee.toFixed(2));
          row.avg_price_incl_fee = Number(avg_price_incl_fee.toFixed(4));
      }

      newData[index] = row;
      setParsedPasteData(newData);
  };

  const processBulkImport = async () => {
      if (parsedPasteData.length === 0) return alert('没有解析到有效的数据！');
      
      setIsBulkProcessing(true);
      let successCount = 0;
      let failedCount = 0;
      const failedRecords: any[] = []; 

      for (let i = 0; i < parsedPasteData.length; i++) {
          const item = parsedPasteData[i];
          try {
              await addDoc(collection(db, 'artifacts', APP_ID, 'public', 'data', 'sip_spot_trade'), {
                  ...item,
                  createdAt: serverTimestamp()
              });
              successCount++;
          } catch (e: any) {
              console.error(`Batch import error at row ${i+1}:`, e);
              failedCount++;
              failedRecords.push(item);
          }
      }
      
      setIsBulkProcessing(false);
      
      if (failedCount > 0) {
          setParsedPasteData(failedRecords);
          alert(`⚠️ 批量导入部分完成。\n\n✅ 成功入库: ${successCount} 笔\n❌ 录入失败: ${failedCount} 笔\n\n失败的记录已保留在校验区，您可以直接修改后再次提交。`);
      } else {
          setShowPasteModal(false);
          setPasteText('');
          setParsedPasteData([]);
          alert(`✅ 成功批量导入 ${successCount} 笔现货交易记录！`);
      }
  };

  return (
    <div className="space-y-6 pb-10">
      <div className="border-b border-gray-200 pb-4 flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Spot Trade (现货交易录入)</h1>
          <p className="mt-1 text-sm text-gray-500">
            录入股票、ETF等现货交易数据。支持自动计算成本、税费，以及批量数据的高效清洗流转。
          </p>
        </div>
        <div className="flex items-center gap-4">
            <div className="text-sm text-gray-400">
              {loading ? '连接数据库...' : `共 ${transactions.length} 条记录`}
            </div>
            <button
                onClick={handleClearAll}
                className="px-4 py-2 bg-red-50 text-red-600 hover:bg-red-100 rounded text-sm font-bold transition-colors shadow-sm flex items-center gap-2"
            >
                <Trash2 size={16}/> 一键清空库
            </button>
            <button
                onClick={() => {
                    setPasteText('');
                    setParsedPasteData([]);
                    setShowPasteModal(true);
                }}
                className="px-4 py-2 bg-blue-100 text-blue-700 hover:bg-blue-200 rounded text-sm font-bold transition-colors shadow-sm flex items-center gap-2"
            >
                <ClipboardList size={16}/> 从 Excel 批量测算与导入
            </button>
        </div>
      </div>

      {/* --- 错误提示区域 --- */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3 animate-in fade-in slide-in-from-top-2">
          <XCircle className="text-red-500 flex-shrink-0 mt-0.5" size={18} />
          <div className="flex-1">
            <h3 className="text-sm font-bold text-red-800">发生错误</h3>
            <p className="text-sm text-red-700 mt-1 break-all font-mono">{error}</p>
            {error.includes('requires an index') && (
              <p className="text-xs text-red-600 mt-2">
                提示: Firestore 需要建立索引。请复制错误信息中的 URL 在浏览器打开以创建索引。
              </p>
            )}
          </div>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600">
            <span className="sr-only">关闭</span>
            <XCircle size={20} />
          </button>
        </div>
      )}

      {/* --- 单条录入表单 --- */}
      <div className={`bg-white p-6 rounded-xl shadow-sm border transition-all duration-300 ${isEditing ? 'border-blue-400 ring-1 ring-blue-100' : 'border-gray-200'}`}>
        <div className="flex justify-between items-center mb-4">
          <h2 className={`text-sm font-bold flex items-center gap-2 ${isEditing ? 'text-blue-600' : 'text-gray-700'}`}>
            {isEditing ? (
              <>
                <Edit2 size={16} />
                修改交易记录
              </>
            ) : (
              <>
                <Plus size={16} className="text-blue-600" />
                新增单笔交易
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
            
            {/* 第一行：基础信息 */}
            <div className="col-span-1">
              <label className="block text-xs font-medium text-gray-500 mb-1">日期</label>
              <input type="date" name="date" required value={formData.date} onChange={handleInputChange} className="w-full p-2 border rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
            <div className="col-span-1">
              <label className="block text-xs font-medium text-gray-500 mb-1">账户</label>
              <input type="text" name="account" placeholder="输入账户名称" required value={formData.account} onChange={handleInputChange} className="w-full p-2 border rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
            <div className="col-span-1">
              <label className="block text-xs font-medium text-gray-500 mb-1">市场</label>
              <select name="market" value={formData.market} onChange={handleInputChange} className="w-full p-2 border rounded text-sm outline-none">
                <option value="USD">USD</option>
                <option value="CNY">CNY</option>
                <option value="HKD">HKD</option>
                <option value="JPY">JPY</option>
              </select>
            </div>
            <div className="col-span-1">
              <label className="block text-xs font-medium text-gray-500 mb-1">执行人</label>
              <input type="text" name="executor" placeholder="Trader Name" value={formData.executor} onChange={handleInputChange} className="w-full p-2 border rounded text-sm outline-none" />
            </div>
            <div className="col-span-1">
              <label className="block text-xs font-medium text-gray-500 mb-1">交易类型</label>
              <select name="type" value={formData.type} onChange={handleInputChange} className="w-full p-2 border rounded text-sm outline-none">
                <option value="普通股票">普通股票</option>
                <option value="ETF">ETF</option>
                <option value="REITs">REITs</option>
              </select>
            </div>

            {/* 第二行：标的与方向 */}
            <div className="col-span-1">
              <label className="block text-xs font-medium text-gray-500 mb-1">交易方向</label>
              <select name="direction" value={formData.direction} onChange={handleInputChange} className={`w-full p-2 border rounded text-sm font-bold outline-none ${formData.direction === 'BUY' ? 'text-red-600 bg-red-50' : 'text-green-600 bg-green-50'}`}>
                <option value="BUY">买入 (BUY)</option>
                <option value="SELL">卖出 (SELL)</option>
              </select>
            </div>
            <div className="col-span-1">
              <label className="block text-xs font-medium text-gray-500 mb-1">代码</label>
              <input type="text" name="code" placeholder="e.g. 700.HK" required value={formData.code} onChange={handleInputChange} className="w-full p-2 border rounded text-sm outline-none font-mono" />
            </div>
            <div className="col-span-3">
              <label className="block text-xs font-medium text-gray-500 mb-1">名称</label>
              <input type="text" name="name" placeholder="e.g. 腾讯控股" required value={formData.name} onChange={handleInputChange} className="w-full p-2 border rounded text-sm outline-none" />
            </div>

            {/* 第三行：价格与计算 */}
            <div className="col-span-1 bg-gray-50 p-2 rounded border border-gray-100">
              <label className="block text-xs font-medium text-gray-500 mb-1 flex justify-between">
                <span>数量</span>
                <span className="text-[10px] text-blue-500">Buy&gt;0, Sell&lt;0</span>
              </label>
              <input type="number" name="quantity" required value={formData.quantity || ''} onChange={handleInputChange} className="w-full p-1.5 border rounded text-sm outline-none" />
            </div>
            <div className="col-span-1 bg-gray-50 p-2 rounded border border-gray-100">
              <label className="block text-xs font-medium text-gray-500 mb-1">均价(不含费)</label>
              <input type="number" name="price_excl_fee" min="0" step="0.0001" required value={formData.price_excl_fee || ''} onChange={handleInputChange} className="w-full p-1.5 border rounded text-sm outline-none" />
            </div>
            <div className="col-span-1 bg-gray-50 p-2 rounded border border-gray-100">
              <label className="block text-xs font-medium text-gray-500 mb-1">手续费</label>
              <input type="number" name="fee" min="0" step="0.01" value={formData.fee || ''} onChange={handleInputChange} className="w-full p-1.5 border rounded text-sm outline-none" />
            </div>
            <div className="col-span-2 flex items-center gap-4 bg-blue-50 p-2 rounded border border-blue-100">
               <Calculator size={20} className="text-blue-400" />
               <div className="flex-1">
                 <div className="flex justify-between text-xs text-blue-800 mb-1">
                   <span>金额(不含费):</span>
                   <span className="font-mono">{formData.amount_excl_fee.toLocaleString()}</span>
                 </div>
                 <div className="flex justify-between text-sm font-bold text-blue-900">
                   <span>金额(含费):</span>
                   <span className="font-mono">{formData.amount_incl_fee.toLocaleString()}</span>
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
                ? 'bg-blue-600 hover:bg-blue-700 shadow-blue-200' 
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
              {submitting ? '提交中...' : isEditing ? '保存修改' : '提交单笔交易'}
            </button>
          </div>
        </form>
      </div>

      {/* --- 数据表格 --- */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto max-h-[450px] overflow-y-auto relative scrollbar-thin">
          <table className="min-w-full text-sm text-left">
            <thead className="bg-gray-50 text-gray-500 font-medium border-b border-gray-200 sticky top-0 z-10 shadow-sm [&>tr>th]:bg-gray-50">
              <tr>
                <Th label="日期" sortKey="date" filterKey="date" currentSort={tradeSort} onSort={toggleTradeSort} currentFilter={tradeFilters} onFilter={updateTradeFilter} width="110px"/>
                <Th label="代码/名称" filterKey="codeOrName" currentSort={tradeSort} onSort={toggleTradeSort} currentFilter={tradeFilters} onFilter={updateTradeFilter} width="160px"/>
                <Th label="方向" align="center" />
                <Th label="数量" align="right" />
                <Th label="均价(不含费)" align="right" />
                <Th label="手续费" align="right" />
                <Th label="金额(含费)" align="right" />
                <Th label="成交均价" align="right" />
                <Th label="操作" align="center" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-gray-400">
                    <div className="flex justify-center items-center gap-2">
                      <Loader2 className="animate-spin" size={16} /> 加载数据中...
                    </div>
                  </td>
                </tr>
              ) : displayTransactions.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-gray-400 flex flex-col items-center">
                    <AlertCircle size={24} className="mb-2 opacity-50" />
                    暂无匹配交易记录
                  </td>
                </tr>
              ) : (
                displayTransactions.map((t) => (
                  <tr 
                    key={t.id} 
                    className={`hover:bg-gray-50 transition-colors group ${currentEditId === t.id ? 'bg-blue-50/50' : ''}`}
                  >
                    <td className="px-3 py-2 whitespace-nowrap text-gray-600">{t.date}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <div className="font-medium text-gray-900">{t.code}</div>
                      <div className="text-xs text-gray-500">{t.name}</div>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-center">
                      <span className={`px-2 py-0.5 rounded text-xs font-bold ${t.direction === 'BUY' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                        {t.direction === 'BUY' ? '买入' : '卖出'}
                      </span>
                    </td>
                    <td className={`px-3 py-2 text-right font-mono ${t.quantity < 0 ? 'text-green-600' : 'text-red-600'}`}>{t.quantity.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right font-mono text-gray-600">{t.price_excl_fee.toFixed(3)}</td>
                    <td className="px-3 py-2 text-right font-mono text-gray-400">{t.fee.toFixed(2)}</td>
                    <td className="px-3 py-2 text-right font-mono font-medium text-gray-900">{t.amount_incl_fee.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right font-mono text-blue-600 bg-blue-50/30">{t.avg_price_incl_fee.toFixed(4)}</td>
                    <td className="px-3 py-2 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <button 
                          onClick={() => handleEditClick(t)}
                          className="text-gray-400 hover:text-blue-600 p-1 rounded hover:bg-blue-50 transition-colors"
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

      {/* --- 批量导入 (Clipboard Paste) 弹窗 --- */}
      {showPasteModal && (
          <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
              <div className="bg-white rounded-xl shadow-2xl w-full max-w-7xl max-h-[95vh] flex flex-col overflow-hidden">
                  <div className="px-6 py-4 border-b flex justify-between items-center bg-gray-50 flex-shrink-0">
                      <div>
                          <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                              <ClipboardList className="text-blue-600" size={20} /> 
                              批量测算与导入 (从 Excel 粘贴)
                          </h3>
                          <p className="text-xs text-gray-500 mt-1">系统将自动为每条记录结算财务金额，并自动为交易数量分配正确的正负号。</p>
                      </div>
                      {!isBulkProcessing && (
                          <button onClick={() => setShowPasteModal(false)} className="text-gray-400 hover:text-gray-600 transition-colors">
                              <X size={20}/>
                          </button>
                      )}
                  </div>
                  
                  <div className="flex-1 overflow-y-auto p-6 space-y-6 flex flex-col lg:flex-row gap-6 relative">
                      {/* 遮罩层 (处理中) */}
                      {isBulkProcessing && (
                          <div className="absolute inset-0 bg-white/80 backdrop-blur-sm z-20 flex flex-col items-center justify-center rounded-b-xl">
                              <Loader2 className="animate-spin text-blue-600 mb-4" size={48} />
                              <h2 className="text-xl font-bold text-gray-800 mb-2">正在执行批量入库...</h2>
                              <p className="text-gray-600 font-mono text-sm">请耐心等待</p>
                          </div>
                      )}

                      {/* 左侧：粘贴区 */}
                      <div className="flex-1 flex flex-col max-w-[280px]">
                          <label className="block text-sm font-bold text-gray-700 mb-2">
                              1. 请在下方粘贴数据 <span className="text-xs font-normal text-gray-500">(严格按 11 列对齐)</span>
                          </label>
                          <div className="bg-blue-50 border border-blue-200 text-blue-800 text-[10px] p-3 rounded-lg mb-3">
                              <span className="font-mono mt-1 block">账户 | 执行人 | 交易日 | 市场币种 | 资产大类 | 买卖方向 | 标的代码 | 标的名称 | 成交数量 | 成交均价(不含费) | 手续费</span>
                          </div>
                          <textarea 
                              className="flex-1 w-full border border-gray-300 rounded-lg p-3 text-[10px] font-mono focus:ring-2 focus:ring-blue-500 outline-none resize-none min-h-[300px] whitespace-pre bg-gray-50"
                              placeholder="在此处粘贴 Excel / Google Sheets 复制的数据... 数量允许输入绝对值"
                              value={pasteText}
                              onChange={handlePasteTextChange}
                              disabled={isBulkProcessing}
                          />
                      </div>

                      {/* 右侧：结构化可编辑预览区 */}
                      <div className="flex-[3] flex flex-col">
                          <label className="block text-sm font-bold text-gray-700 mb-2 flex justify-between items-end">
                              <span>2. 结构化校验与财务结算区</span>
                              <span className="text-xs font-normal text-gray-500">共识别 {parsedPasteData.length} 笔</span>
                          </label>
                          <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 text-[10px] p-2 rounded-md mb-2 flex items-center gap-2">
                              <AlertCircle size={14}/>
                              <span>提示：您可以在下方表格中<b>直接修改错误的数据（如手续费、方向）</b>，数量的正负号与含费金额将会实时重新校正测算。</span>
                          </div>
                          <div className="flex-1 border border-gray-200 rounded-lg overflow-x-auto overflow-y-auto bg-gray-50 max-h-[600px] relative scrollbar-thin">
                              {parsedPasteData.length === 0 ? (
                                  <div className="flex items-center justify-center h-full text-gray-400 text-sm py-10">等待粘贴数据...</div>
                              ) : (
                                  <table className="min-w-full text-xs text-left whitespace-nowrap">
                                      <thead className="bg-gray-100 text-gray-600 sticky top-0 shadow-sm z-10 [&>tr>th]:bg-gray-100">
                                          <tr>
                                              <th className="px-2 py-2 font-medium">账户/执行人</th>
                                              <th className="px-2 py-2 font-medium">交易日期</th>
                                              <th className="px-2 py-2 font-medium text-center">市场</th>
                                              <th className="px-2 py-2 font-medium text-center">方向</th>
                                              <th className="px-2 py-2 font-medium">标的</th>
                                              <th className="px-2 py-2 font-medium text-right">数量(系统自动加减号)</th>
                                              <th className="px-2 py-2 font-medium text-right">均价(不含费)</th>
                                              <th className="px-2 py-2 font-medium text-right">手续费</th>
                                              <th className="px-2 py-2 font-medium text-right text-blue-700 bg-blue-50/50">含费总额(自动)</th>
                                              <th className="px-2 py-2 font-medium text-right text-blue-700 bg-blue-50/50">含费均价(自动)</th>
                                              <th className="px-2 py-2 font-medium text-center">操作</th>
                                          </tr>
                                      </thead>
                                      <tbody className="divide-y divide-gray-200 bg-white">
                                          {parsedPasteData.map((item, idx) => (
                                              <tr key={idx} className="hover:bg-blue-50/30 transition-colors">
                                                  <td className="px-2 py-1.5 flex flex-col gap-1">
                                                      <input type="text" value={item.account} onChange={(e) => handleParsedDataChange(idx, 'account', e.target.value)} className="w-16 p-1 border border-gray-200 rounded text-xs outline-none focus:border-blue-400" />
                                                      <input type="text" value={item.executor} onChange={(e) => handleParsedDataChange(idx, 'executor', e.target.value)} className="w-16 p-1 border border-gray-200 rounded text-[10px] text-gray-500 outline-none focus:border-blue-400" placeholder="执行人" />
                                                  </td>
                                                  <td className="px-2 py-1.5">
                                                      <input type="text" value={item.date} onChange={(e) => handleParsedDataChange(idx, 'date', e.target.value)} className="w-20 p-1 border border-gray-200 rounded text-xs font-mono outline-none focus:border-blue-400" placeholder="YYYY-MM-DD" />
                                                  </td>
                                                  <td className="px-2 py-1.5 text-center">
                                                      <select value={item.market} onChange={(e) => handleParsedDataChange(idx, 'market', e.target.value)} className="w-14 p-1 border border-gray-200 rounded text-xs outline-none focus:border-blue-400 bg-white">
                                                          <option value="USD">USD</option>
                                                          <option value="HKD">HKD</option>
                                                          <option value="CNY">CNY</option>
                                                          <option value="JPY">JPY</option>
                                                      </select>
                                                  </td>
                                                  <td className="px-2 py-1.5 text-center">
                                                      <select value={item.direction} onChange={(e) => handleParsedDataChange(idx, 'direction', e.target.value)} className={`w-14 p-1 border border-gray-200 rounded text-[10px] font-bold outline-none focus:border-blue-400 bg-white ${item.direction === 'BUY' ? 'text-red-700' : 'text-green-700'}`}>
                                                          <option value="BUY">BUY</option>
                                                          <option value="SELL">SELL</option>
                                                      </select>
                                                  </td>
                                                  <td className="px-2 py-1.5 flex flex-col gap-1">
                                                      <input type="text" value={item.code} onChange={(e) => handleParsedDataChange(idx, 'code', e.target.value.toUpperCase())} className="w-20 p-1 border border-gray-200 rounded text-xs font-bold outline-none focus:border-blue-400 font-mono" placeholder="代码" />
                                                      <input type="text" value={item.name} onChange={(e) => handleParsedDataChange(idx, 'name', e.target.value)} className="w-20 p-1 border border-gray-200 rounded text-[10px] text-gray-500 outline-none focus:border-blue-400" placeholder="名称" />
                                                  </td>
                                                  <td className="px-2 py-1.5 text-right">
                                                      {/* 这里显示绝对值，但颜色跟随正负，且输入时直接按绝对值输入 */}
                                                      <input 
                                                          type="number" 
                                                          value={Math.abs(item.quantity)} 
                                                          onChange={(e) => handleParsedDataChange(idx, 'quantity', e.target.value)} 
                                                          className={`w-20 text-right p-1 border border-gray-200 rounded text-xs font-mono font-bold outline-none focus:border-blue-400 ${item.quantity < 0 ? 'text-green-600 bg-green-50/50' : 'text-red-600 bg-red-50/50'}`} 
                                                      />
                                                  </td>
                                                  <td className="px-2 py-1.5 text-right">
                                                      <input type="number" value={item.price_excl_fee} onChange={(e) => handleParsedDataChange(idx, 'price_excl_fee', parseFloat(e.target.value) || 0)} className="w-16 text-right p-1 border border-gray-200 rounded text-xs font-mono outline-none focus:border-blue-400" />
                                                  </td>
                                                  <td className="px-2 py-1.5 text-right">
                                                      <input type="number" value={item.fee} onChange={(e) => handleParsedDataChange(idx, 'fee', parseFloat(e.target.value) || 0)} className="w-14 text-right p-1 border border-gray-200 rounded text-xs font-mono outline-none focus:border-blue-400 text-gray-500" />
                                                  </td>
                                                  <td className="px-2 py-1.5 text-right font-mono font-bold text-blue-800 bg-blue-50/20">
                                                      {item.amount_incl_fee.toLocaleString()}
                                                  </td>
                                                  <td className="px-2 py-1.5 text-right font-mono font-bold text-blue-600 bg-blue-50/20">
                                                      {item.avg_price_incl_fee.toFixed(4)}
                                                  </td>
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
                      <button onClick={() => setShowPasteModal(false)} disabled={isBulkProcessing} className="px-5 py-2.5 bg-gray-200 text-gray-700 text-sm font-bold rounded shadow-sm hover:bg-gray-300 transition-colors disabled:opacity-50">
                          取消
                      </button>
                      <button 
                          onClick={processBulkImport} 
                          disabled={parsedPasteData.length === 0 || isBulkProcessing}
                          className="px-6 py-2.5 bg-blue-600 text-white text-sm font-bold rounded shadow-sm hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center gap-2"
                      >
                          {isBulkProcessing ? <Loader2 size={16} className="animate-spin"/> : <Play size={16}/>}
                          确认无误并批量入库
                      </button>
                  </div>
              </div>
          </div>
      )}

    </div>
  );
}