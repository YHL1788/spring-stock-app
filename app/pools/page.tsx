"use client";

import { useState, useEffect } from 'react';
import { useUser, SignedIn, SignedOut, RedirectToSignIn } from '@clerk/nextjs';
import { supabase } from '@/lib/supabaseClient';
import Link from 'next/link';

interface Watchlist {
  id: string;
  title: string;
  is_public: boolean;
  created_at: string;
}

export default function PoolsPage() {
  const { user, isLoaded } = useUser();
  const [pools, setPools] = useState<Watchlist[]>([]);
  const [newPoolTitle, setNewPoolTitle] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [loading, setLoading] = useState(true);

  // 加载我的股票池
  useEffect(() => {
    if (user) {
      fetchPools();
    }
  }, [user]);

  const fetchPools = async () => {
    if (!user) return;
    setLoading(true);
    
    // 从 Supabase 查询 user_id 等于当前用户的池子
    const { data, error } = await supabase
      .from('watchlists')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching pools:', error);
    } else {
      setPools(data || []);
    }
    setLoading(false);
  };

  // 创建新池子
  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPoolTitle.trim() || !user) return;

    const { error } = await supabase
      .from('watchlists')
      .insert([
        { 
          user_id: user.id, 
          title: newPoolTitle, 
          is_public: isPublic 
        }
      ]);

    if (error) {
      alert('创建失败: ' + error.message);
    } else {
      setNewPoolTitle('');
      fetchPools(); // 刷新列表
    }
  };

  // 删除池子
  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除这个股票池吗？里面的股票也会被清空。')) return;

    const { error } = await supabase
      .from('watchlists')
      .delete()
      .eq('id', id);

    if (error) {
      alert('删除失败');
    } else {
      fetchPools();
    }
  };

  if (!isLoaded) return <div className="p-10 text-center">加载用户信息中...</div>;

  return (
    <div className="min-h-screen bg-gray-50 p-10">
      {/* 只有登录用户才能访问 */}
      <SignedOut>
        <RedirectToSignIn />
      </SignedOut>

      <SignedIn>
        <div className="max-w-4xl mx-auto">
          <div className="flex justify-between items-center mb-8">
            <h1 className="text-3xl font-bold text-gray-800">我的股票池管理</h1>
            <Link href="/" className="text-blue-600 hover:underline">
              ← 返回首页查价
            </Link>
          </div>

          {/* --- 创建区域 --- */}
          <div className="bg-white p-6 rounded-xl shadow-md mb-8">
            <h2 className="text-xl font-bold mb-4 text-gray-700">新建股票池</h2>
            <form onSubmit={handleCreate} className="flex gap-4 items-end">
              <div className="flex-1">
                <label className="block text-sm text-gray-500 mb-1">池子名称 (如: 港股高息)</label>
                <input
                  type="text"
                  value={newPoolTitle}
                  onChange={(e) => setNewPoolTitle(e.target.value)}
                  className="w-full border p-2 rounded focus:border-blue-500 outline-none"
                  placeholder="输入名称..."
                />
              </div>
              
              <div className="flex items-center mb-3">
                <input
                  type="checkbox"
                  id="publicCheck"
                  checked={isPublic}
                  onChange={(e) => setIsPublic(e.target.checked)}
                  className="mr-2 h-4 w-4"
                />
                <label htmlFor="publicCheck" className="text-gray-700 select-none cursor-pointer">
                  设为公开 (其他人可见)
                </label>
              </div>

              <button
                type="submit"
                disabled={!newPoolTitle}
                className="bg-green-600 hover:bg-green-700 text-white px-6 py-2 rounded-lg font-bold disabled:bg-gray-300 transition"
              >
                + 创建
              </button>
            </form>
          </div>

          {/* --- 列表区域 --- */}
          <div className="bg-white p-6 rounded-xl shadow-md">
            <h2 className="text-xl font-bold mb-4 text-gray-700">已建股票池 ({pools.length})</h2>
            
            {loading ? (
              <p>加载数据中...</p>
            ) : pools.length === 0 ? (
              <p className="text-gray-400">你还没有创建任何股票池。</p>
            ) : (
              <div className="grid gap-4">
                {pools.map((pool) => (
                  <div key={pool.id} className="border p-4 rounded-lg flex justify-between items-center hover:bg-gray-50 transition">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-bold text-lg text-blue-900">{pool.title}</h3>
                        {pool.is_public && (
                          <span className="bg-yellow-100 text-yellow-800 text-xs px-2 py-0.5 rounded-full">公开</span>
                        )}
                      </div>
                      <p className="text-xs text-gray-400">创建于: {new Date(pool.created_at).toLocaleDateString()}</p>
                    </div>
                    
                    <div className="flex gap-3">
                      {/* 这里后续会加“管理成分股”的按钮 */}
                      <button className="text-blue-600 hover:underline font-medium">
                        管理成分股
                      </button>
                      <button 
                        onClick={() => handleDelete(pool.id)}
                        className="text-red-500 hover:text-red-700 text-sm"
                      >
                        删除
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </SignedIn>
    </div>
  );
}