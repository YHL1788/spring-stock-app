"use client";

import { useState, useEffect, useRef } from 'react';
import { useUser, SignedIn, SignedOut, RedirectToSignIn } from '@clerk/nextjs';
import { supabase } from '@/lib/supabaseClient';
import Link from 'next/link';

// --- 类型定义 ---
interface Watchlist {
  id: string;
  title: string;
  is_public: boolean;
  created_at: string;
}

interface WatchlistItem {
  id: string;
  symbol: string;
}

interface SearchResult {
  symbol: string;
  name: string;
  exchange: string;
  type: string;
}

// --- 子组件：单行股票 ---
const StockRow = ({ item, onDelete, refreshTrigger }: { item: WatchlistItem, onDelete: (id: string) => void, refreshTrigger: number }) => {
  const [priceData, setPriceData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchPrice = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/quote?symbol=${item.symbol}&t=${Date.now()}`);
        const data = await res.json();
        if (res.ok) setPriceData(data);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    fetchPrice();
  }, [item.symbol, refreshTrigger]);

  const fmt = (n: number) => n?.toFixed(2) || '--';

  return (
    <tr className="border-b hover:bg-gray-50 transition group">
      <td className="p-3">
        <Link 
          href={`/market/quote?symbol=${item.symbol}`}
          className="font-bold text-gray-800 hover:text-blue-600 hover:underline flex items-center gap-1"
        >
          {item.symbol}
          <span className="text-gray-300 text-xs font-normal group-hover:text-blue-400">↗</span>
        </Link>
      </td>
      <td className="p-3">
        {loading ? <span className="text-gray-400 text-xs animate-pulse">刷新中...</span> : (
          priceData ? (
            <div className="flex items-center gap-2">
              <span className="text-gray-500 text-xs">{priceData.currency}</span>
              <span className="font-mono font-bold">{fmt(priceData.price)}</span>
            </div>
          ) : <span className="text-red-400 text-sm">获取失败</span>
        )}
      </td>
      <td className="p-3">
        {loading ? '--' : (
          priceData && (
            <span className={`font-mono font-bold ${priceData.changePercent >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {priceData.changePercent >= 0 ? '+' : ''}{fmt(priceData.changePercent)}%
            </span>
          )
        )}
      </td>
      <td className="p-3 text-right">
        <button 
          onClick={() => onDelete(item.id)}
          className="text-gray-400 hover:text-red-600 text-sm transition"
        >
          移除
        </button>
      </td>
    </tr>
  );
};

// --- 主页面组件 ---
export default function PoolsPage() {
  const { user, isLoaded } = useUser();
  const [pools, setPools] = useState<Watchlist[]>([]);
  const [selectedPool, setSelectedPool] = useState<Watchlist | null>(null);
  const [poolItems, setPoolItems] = useState<WatchlistItem[]>([]);
  
  // 状态管理
  const [newPoolTitle, setNewPoolTitle] = useState('');
  const [isPublic, setIsPublic] = useState(false); 
  
  // 编辑状态
  const [editingPoolId, setEditingPoolId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editIsPublic, setEditIsPublic] = useState(false); 

  // 添加股票相关状态
  const [newSymbol, setNewSymbol] = useState('');
  const [addingStock, setAddingStock] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [warningMsg, setWarningMsg] = useState('');

  // ★ 新增：模糊搜索相关状态
  const [suggestions, setSuggestions] = useState<SearchResult[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const searchContainerRef = useRef<HTMLFormElement>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => { if (user) fetchPools(); }, [user]);
  useEffect(() => { if (selectedPool) fetchPoolItems(selectedPool.id); }, [selectedPool]);

  // ★ 新增：点击外部关闭下拉菜单
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const fetchPools = async () => {
    if (!user) return;
    const { data } = await supabase.from('watchlists').select('*').eq('user_id', user.id).order('created_at', { ascending: false });
    setPools(data || []);
  };

  const fetchPoolItems = async (poolId: string) => {
    const { data } = await supabase.from('watchlist_items').select('*').eq('watchlist_id', poolId).order('created_at', { ascending: false });
    setPoolItems(data || []);
  };

  const handleCreatePool = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPoolTitle.trim() || !user) return;
    
    const { error } = await supabase
      .from('watchlists')
      .insert([{ 
        user_id: user.id, 
        title: newPoolTitle,
        is_public: isPublic 
      }]);

    if (!error) { 
      setNewPoolTitle(''); 
      setIsPublic(false); 
      fetchPools(); 
    }
  };

  const startEditing = (pool: Watchlist) => { 
    setEditingPoolId(pool.id); 
    setEditTitle(pool.title);
    setEditIsPublic(pool.is_public);
  };

  const saveEditing = async () => {
    if (!editTitle.trim()) return;
    await supabase
      .from('watchlists')
      .update({ title: editTitle, is_public: editIsPublic })
      .eq('id', editingPoolId);
      
    setEditingPoolId(null); 
    fetchPools();
    
    if (selectedPool?.id === editingPoolId) {
        setSelectedPool(prev => prev ? ({...prev, title: editTitle, is_public: editIsPublic}) : null);
    }
  };

  const handleDeletePool = async (id: string) => {
    if (!confirm('确定删除吗？')) return;
    await supabase.from('watchlists').delete().eq('id', id);
    if (selectedPool?.id === id) setSelectedPool(null);
    fetchPools();
  };

  // ★ 新增：处理输入变化并触发搜索
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setNewSymbol(val.toUpperCase());

    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (val.trim().length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(val)}`);
        if (res.ok) {
          const results = await res.json();
          setSuggestions(results);
          setShowSuggestions(true);
        }
      } catch (e) {
        console.error("Search error", e);
      }
    }, 300);
  };

  // ★ 新增：选择建议
  const handleSelectSuggestion = (symbol: string) => {
    setNewSymbol(symbol);
    setSuggestions([]);
    setShowSuggestions(false);
  };

  const handleAddStock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSymbol.trim() || !selectedPool) return;
    
    const cleanSymbol = newSymbol.toUpperCase().trim();

    if (poolItems.some(item => item.symbol === cleanSymbol)) {
        setWarningMsg('该股票已经添加'); 
        setTimeout(() => {
            setWarningMsg('');
        }, 5000);
        return; 
    }

    setAddingStock(true);
    const { error } = await supabase.from('watchlist_items').insert([{ watchlist_id: selectedPool.id, symbol: cleanSymbol }]);
    if (error) { 
        alert('添加失败: ' + error.message); 
    } else { 
        setNewSymbol(''); 
        fetchPoolItems(selectedPool.id); 
    }
    setAddingStock(false);
    setShowSuggestions(false); // 确保提交后关闭下拉
  };

  const handleRemoveStock = async (itemId: string) => {
    if (!confirm('从列表中移除该股票？')) return;
    await supabase.from('watchlist_items').delete().eq('id', itemId);
    if (selectedPool) fetchPoolItems(selectedPool.id);
  };

  const handleRefreshAll = () => {
    setRefreshTrigger(prev => prev + 1);
  };

  if (!isLoaded) return <div className="p-10 text-center">加载中...</div>;

  return (
    <div className="min-h-screen bg-gray-50 p-6 md:p-10 relative">
      <SignedOut><RedirectToSignIn /></SignedOut>
      <SignedIn>
        {/* ★ 警示弹框 (Toast) */}
        {warningMsg && (
            <div className="fixed top-24 left-1/2 transform -translate-x-1/2 bg-gray-900/90 backdrop-blur text-white px-6 py-3 rounded-full shadow-xl z-50 flex items-center gap-2 animate-bounce-in transition-all">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-yellow-400" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                <span className="font-medium text-sm">{warningMsg}</span>
            </div>
        )}

        <div className="max-w-6xl mx-auto flex flex-col md:flex-row gap-8">
          
          {/* 左侧：股票池列表 */}
          <div className="w-full md:w-1/3 flex flex-col gap-6">
            <div className="flex justify-between items-center">
              <h1 className="text-2xl font-bold text-gray-800">我的股票池</h1>
              <Link href="/" className="text-blue-600 text-sm hover:underline">回首页</Link>
            </div>
            
            <form onSubmit={handleCreatePool} className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex flex-col gap-3">
              <div className="flex gap-2">
                <input 
                  type="text" 
                  value={newPoolTitle} 
                  onChange={(e) => setNewPoolTitle(e.target.value)} 
                  placeholder="新建池子名称..." 
                  className="flex-1 border p-2 rounded text-sm focus:border-blue-500 outline-none" 
                />
                <button disabled={!newPoolTitle} className="bg-blue-600 text-white px-3 rounded text-sm disabled:bg-gray-300">+</button>
              </div>
              
              <div className="flex items-center gap-2">
                <input 
                  type="checkbox" 
                  id="publicCheck" 
                  checked={isPublic} 
                  onChange={e => setIsPublic(e.target.checked)}
                  className="w-4 h-4 cursor-pointer"
                />
                <label htmlFor="publicCheck" className="text-xs text-gray-500 cursor-pointer select-none">
                  设为公开 (其他人可见)
                </label>
              </div>
            </form>

            <div className="bg-white rounded-xl shadow-sm overflow-hidden border border-gray-100">
              {pools.length === 0 && <p className="p-4 text-gray-400 text-sm text-center">暂无股票池</p>}
              {pools.map(pool => (
                <div key={pool.id} onClick={() => setSelectedPool(pool)} className={`p-4 border-b last:border-0 cursor-pointer transition flex justify-between items-center group ${selectedPool?.id === pool.id ? 'bg-blue-50 border-l-4 border-l-blue-600' : 'hover:bg-gray-50'}`}>
                  {editingPoolId === pool.id ? (
                    <div className="flex flex-col gap-2 flex-1" onClick={e => e.stopPropagation()}>
                        <input 
                            autoFocus
                            value={editTitle}
                            onChange={e => setEditTitle(e.target.value)}
                            className="border rounded px-2 py-1 text-sm w-full focus:border-blue-500 outline-none"
                        />
                        <div className="flex justify-between items-center">
                            <label className="flex items-center gap-1 text-xs text-gray-500 cursor-pointer select-none">
                                <input 
                                    type="checkbox"
                                    checked={editIsPublic}
                                    onChange={e => setEditIsPublic(e.target.checked)}
                                />
                                公开
                            </label>
                            <button onClick={saveEditing} className="bg-green-50 text-green-600 px-2 py-0.5 rounded text-xs font-bold border border-green-200 hover:bg-green-100">保存</button>
                        </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                        <span className={`font-medium ${selectedPool?.id === pool.id ? 'text-blue-900' : 'text-gray-700'}`}>{pool.title}</span>
                        {pool.is_public && <span className="text-[10px] bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded border border-yellow-200">公开</span>}
                    </div>
                  )}
                  <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition" onClick={e => e.stopPropagation()}>{editingPoolId !== pool.id && (<button onClick={() => startEditing(pool)} className="text-gray-400 hover:text-blue-600">✎</button>)}<button onClick={() => handleDeletePool(pool.id)} className="text-gray-400 hover:text-red-600">×</button></div>
                </div>
              ))}
            </div>
          </div>

          {/* 右侧：详情区域 */}
          <div className="w-full md:w-2/3">
            {selectedPool ? (
              <div className="bg-white rounded-xl shadow-md border border-gray-100 p-6 animate-fade-in">
                <div className="flex justify-between items-center mb-6 border-b pb-4">
                  <div className="flex items-center gap-3">
                    <h2 className="text-2xl font-bold text-gray-800">{selectedPool.title}</h2>
                    {selectedPool.is_public && <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-1 rounded-full">公开池</span>}
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded">{poolItems.length} 只股票</div>
                    <button 
                      onClick={handleRefreshAll}
                      className="flex items-center gap-1 text-gray-500 hover:text-blue-600 text-sm font-medium transition active:scale-95"
                      title="获取最新价格"
                    >
                      <span className="text-lg leading-none">↻</span> 刷新行情
                    </button>
                  </div>
                </div>

                {/* ★ 修改：添加股票表单 (包含模糊搜索下拉) */}
                <form ref={searchContainerRef} onSubmit={handleAddStock} className="flex gap-3 mb-6 bg-gray-50 p-4 rounded-lg relative">
                    <div className="flex-1 relative">
                        <input 
                            type="text" 
                            value={newSymbol} 
                            onChange={handleSearchChange}
                            onFocus={() => { if (suggestions.length > 0) setShowSuggestions(true); }}
                            placeholder="输入代码 (如 0700.HK, AAPL)..." 
                            className="w-full border p-2 rounded focus:border-blue-500 outline-none font-mono uppercase" 
                            autoComplete="off"
                        />
                        {/* 搜索建议下拉框 */}
                        {showSuggestions && suggestions.length > 0 && (
                            <div className="absolute top-full left-0 w-full bg-white mt-1 rounded-lg shadow-xl border border-gray-100 max-h-60 overflow-y-auto z-20">
                                {suggestions.map((item) => (
                                    <div 
                                        key={item.symbol} 
                                        onClick={() => handleSelectSuggestion(item.symbol)} 
                                        className="px-4 py-2 hover:bg-gray-50 cursor-pointer border-b last:border-0 flex justify-between items-center"
                                    >
                                        <div>
                                            <div className="font-bold text-gray-800">{item.symbol}</div>
                                            <div className="text-xs text-gray-500 truncate max-w-[200px]">{item.name}</div>
                                        </div>
                                        <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">{item.exchange}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                    <button disabled={addingStock || !newSymbol} className="bg-green-600 hover:bg-green-700 text-white px-6 py-2 rounded font-medium disabled:opacity-50 whitespace-nowrap">{addingStock ? '...' : '添加'}</button>
                </form>

                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="text-gray-400 text-sm border-b">
                                <th className="p-3 font-normal">代码</th>
                                <th className="p-3 font-normal">最新价</th>
                                <th className="p-3 font-normal">今日涨跌</th>
                                <th className="p-3 text-right font-normal">操作</th>
                            </tr>
                        </thead>
                        <tbody>
                            {poolItems.length === 0 ? (
                                <tr><td colSpan={4} className="p-8 text-center text-gray-400">池子里还是空的，快去添加几只关注的股票吧！</td></tr>
                            ) : (
                                poolItems.map(item => (
                                    <StockRow key={item.id} item={item} onDelete={handleRemoveStock} refreshTrigger={refreshTrigger} />
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-gray-400 bg-white rounded-xl border border-dashed border-gray-300 p-10 min-h-[400px]">
                <span className="text-6xl mb-4">👈</span>
                <p>请在左侧选择一个股票池</p>
              </div>
            )}
          </div>
        </div>
      </SignedIn>
    </div>
  );
}