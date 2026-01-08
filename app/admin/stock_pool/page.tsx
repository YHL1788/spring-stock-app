'use client';

import React, { useState } from 'react';
import { useStockPool } from '@/app/hooks/useStockPool'; 
import { db, auth, APP_ID } from '@/app/lib/stockService'; 
import { doc, setDoc, deleteDoc, writeBatch } from 'firebase/firestore';

// 导入本地数据作为“原始数据源”
import { stockPoolData as initialLocalData } from '@/app/data/stock_pool'; 

export default function StockPoolAdmin() {
  // ---------------------------------------------------------
  // 🔐 密码保护逻辑
  // ---------------------------------------------------------
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');

  // ---------------------------------------------------------
  // ⚙️ 原有的 Admin 业务逻辑
  // ---------------------------------------------------------
  const { stocks, loading, refresh } = useStockPool();
  
  const [formData, setFormData] = useState({ symbol: '', name: '', sector_level_1: '', sector_level_2: '' });
  const [isMigrating, setIsMigrating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // 单条保存
  const handleSave = async () => {
    if (!formData.symbol || !formData.name) return alert("代码和名称必填");
    if (!auth.currentUser) return alert("未连接到数据库");

    setIsSaving(true);
    try {
      const docId = formData.symbol.trim().toUpperCase();
      await setDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'stock_pool', docId), {
        ...formData,
        symbol: docId,
        updatedAt: new Date().toISOString()
      });
      setFormData({ symbol: '', name: '', sector_level_1: '', sector_level_2: '' });
      refresh(); 
    } catch (e) {
      console.error(e);
      alert("保存失败");
    } finally {
      setIsSaving(false);
    }
  };

  // 单条删除
  const handleDelete = async (symbol: string) => {
    if (!confirm(`确认删除 ${symbol}?`)) return;
    try {
      await deleteDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'stock_pool', symbol));
      refresh(); 
    } catch (e) {
      console.error(e);
    }
  };

  // 填充编辑表单
  const fillForm = (s: any) => {
    setFormData({
      symbol: s.symbol || '',
      name: s.name || '',
      sector_level_1: s.sector_level_1 || '',
      sector_level_2: s.sector_level_2 || ''
    });
  };

  // 从本地文件批量同步
  const handleMigrate = async () => {
    const count = initialLocalData.length;
    if (!confirm(`准备将本地 stock_pool.ts 中的 ${count} 条数据同步到云端。\n\n注意：这会覆盖云端已存在的同名股票数据。继续吗？`)) return;
    
    setIsMigrating(true);
    try {
      const batch = writeBatch(db);
      initialLocalData.forEach(item => {
        if (!item.symbol) return;
        const docId = item.symbol.trim().toUpperCase();
        const ref = doc(db, 'artifacts', APP_ID, 'public', 'data', 'stock_pool', docId);
        batch.set(ref, {
          ...item,
          updatedAt: new Date().toISOString(),
          isMigrated: true
        });
      });
      await batch.commit();
      alert(`成功同步 ${count} 条数据！`);
      refresh(); 
    } catch (e) {
      console.error("Migration failed:", e);
      alert("同步失败，请检查控制台错误信息。");
    } finally {
      setIsMigrating(false);
    }
  };

  // ---------------------------------------------------------
  // 🚪 拦截渲染：如果没有通过验证，显示密码输入框
  // ---------------------------------------------------------
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-xl shadow-lg border border-slate-200 max-w-sm w-full">
          <div className="text-center mb-6">
            <h1 className="text-xl font-bold text-slate-800">🔒 开发者选项</h1>
            <p className="text-slate-500 text-sm mt-1">请输入管理员密码以继续</p>
          </div>
          <form onSubmit={(e) => {
            e.preventDefault();
            if (passwordInput === '25210228') {
              setIsAuthenticated(true);
            } else {
              alert('访问被拒绝：密码错误');
              setPasswordInput('');
            }
          }}>
            <div className="mb-6">
              <input 
                type="password" 
                className="w-full border border-slate-300 bg-slate-50 p-3 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none transition-all text-center tracking-widest"
                placeholder="• • • • • • • •"
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                autoFocus
              />
            </div>
            <button 
              type="submit"
              className="w-full bg-slate-900 text-white py-3 rounded-lg font-medium hover:bg-slate-800 transition-colors shadow-sm"
            >
              解锁进入
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------
  // 🛠️ 正常的管理界面渲染 (验证通过后显示)
  // ---------------------------------------------------------
  return (
    <div className="p-8 max-w-6xl mx-auto min-h-screen bg-slate-50 text-slate-900">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            股票池管理 (Admin)
            <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full border border-green-200">已授权</span>
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            云端数据: {stocks.length} 条 | 本地文件 (待同步): {initialLocalData.length} 条
          </p>
        </div>
        <div className="flex gap-3">
          <button 
            onClick={handleMigrate} 
            disabled={isMigrating} 
            className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded hover:bg-indigo-700 disabled:opacity-50 transition-colors shadow-sm"
          >
            {isMigrating ? '正在上传数据...' : '📥 从本地文件 stock_pool.ts 批量同步'}
          </button>
          <button 
            onClick={refresh} 
            className="px-4 py-2 bg-white border border-slate-300 text-slate-700 text-sm font-medium rounded hover:bg-slate-50 transition-colors"
          >
            刷新列表
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 左侧：手动添加/编辑表单 */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 h-fit sticky top-6">
          <h2 className="font-bold text-lg mb-4 border-b pb-2">单条修改</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">代码</label>
              <input 
                className="w-full border border-slate-300 p-2 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" 
                placeholder="例如: AAPL" 
                value={formData.symbol} 
                onChange={e => setFormData({...formData, symbol: e.target.value})} 
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">名称</label>
              <input 
                className="w-full border border-slate-300 p-2 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" 
                placeholder="例如: 苹果公司" 
                value={formData.name} 
                onChange={e => setFormData({...formData, name: e.target.value})} 
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">一级行业</label>
                <input 
                  className="w-full border border-slate-300 p-2 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" 
                  value={formData.sector_level_1} 
                  onChange={e => setFormData({...formData, sector_level_1: e.target.value})} 
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">二级行业</label>
                <input 
                  className="w-full border border-slate-300 p-2 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" 
                  value={formData.sector_level_2} 
                  onChange={e => setFormData({...formData, sector_level_2: e.target.value})} 
                />
              </div>
            </div>
            <button 
              onClick={handleSave} 
              disabled={isSaving}
              className="w-full py-2.5 bg-blue-600 text-white font-medium rounded hover:bg-blue-700 transition-colors disabled:opacity-70 mt-2"
            >
              {isSaving ? '保存中...' : '保存'}
            </button>
          </div>
        </div>

        {/* 右侧：云端列表展示 */}
        <div className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col min-h-[500px]">
          {loading ? (
            <div className="flex-1 flex items-center justify-center text-slate-400">
              <svg className="animate-spin h-8 w-8 text-blue-500 mb-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-200">
                  <tr>
                    <th className="px-6 py-3 whitespace-nowrap">代码</th>
                    <th className="px-6 py-3 whitespace-nowrap">名称</th>
                    <th className="px-6 py-3 whitespace-nowrap">行业分类</th>
                    <th className="px-6 py-3 text-right whitespace-nowrap">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {stocks.length > 0 ? stocks.map((s) => (
                    <tr key={s.symbol} className="hover:bg-slate-50 transition-colors">
                      <td className="px-6 py-3 font-mono text-slate-700">{s.symbol}</td>
                      <td className="px-6 py-3 font-medium text-slate-900">{s.name}</td>
                      <td className="px-6 py-3 text-slate-500">
                        <span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-xs border border-slate-200 mr-1">
                          {s.sector_level_1}
                        </span>
                        {s.sector_level_2 && <span className="text-xs text-slate-400">/ {s.sector_level_2}</span>}
                      </td>
                      <td className="px-6 py-3 text-right whitespace-nowrap">
                        <button onClick={() => fillForm(s)} className="text-blue-600 hover:text-blue-800 font-medium mr-4">编辑</button>
                        <button onClick={() => handleDelete(s.symbol)} className="text-red-600 hover:text-red-800 font-medium">删除</button>
                      </td>
                    </tr>
                  )) : (
                    <tr>
                      <td colSpan={4} className="p-12 text-center text-slate-400">
                        云端暂无数据，请点击上方“从本地文件 stock_pool.ts 批量同步”
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}