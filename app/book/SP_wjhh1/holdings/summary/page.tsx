'use client';

import React, { useState, useEffect } from 'react';
import { 
  LineChart, 
  Loader2, 
  AlertCircle 
} from 'lucide-react';
import { onAuthStateChanged, signInAnonymously, signInWithCustomToken } from 'firebase/auth';
import { auth, db, APP_ID } from '@/app/lib/stockService';

export default function SummaryHoldingsPage() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const initAuth = async () => {
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
            // 这里为您预留了后续挂载数据监听的位置
            setLoading(false);
          }
        });
      } catch (err: any) {
        setError(`初始化失败: ${err.message}`);
        setLoading(false);
      }
    };

    initAuth();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="animate-spin text-indigo-600" size={40} />
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-10 max-w-[1500px] mx-auto px-4">
      {/* === Header === */}
      <div className="border-b border-gray-200 pb-4 pt-4 flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <LineChart className="text-indigo-600" />
            Summary Holding (全局大盘总看板)
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            基于单位净值法（NAV）的全局资产概览与真实收益率追踪。
          </p>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 p-4 rounded text-red-700 flex items-center gap-2">
          <AlertCircle size={20} /> {error}
        </div>
      )}

      {/* === 占位区域 === */}
      <div className="bg-white p-12 rounded-xl shadow-sm border border-gray-200 flex flex-col items-center justify-center text-gray-400 min-h-[400px]">
        <LineChart size={48} className="mb-4 text-indigo-200" />
        <p className="text-lg font-medium text-gray-600">空文件初始化完成</p>
        <p className="text-sm mt-2">等待您的下一步指令，随时准备注入底层逻辑...</p>
      </div>
    </div>
  );
}