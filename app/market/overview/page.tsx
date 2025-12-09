"use client";

import React, { useState, useEffect } from 'react';

// --- 1. 定义需要关注的全球指数列表 ---
const MARKET_INDICES = [
  { region: 'USA', ticker: '^GSPC', name: 'S&P 500', country: '美国', flag: '🇺🇸' },
  { region: 'USA', ticker: '^IXIC', name: '纳斯达克', country: '美国', flag: '🇺🇸' },
  { region: 'CHN', ticker: '000001.SS', name: '上证指数', country: '中国大陆', flag: '🇨🇳' },
  { region: 'CHN', ticker: '000688.SS', name: '科创50', country: '中国大陆', flag: '🇨🇳' },
  { region: 'HKG', ticker: '^HSI', name: '恒生指数', country: '香港', flag: '🇭🇰' },
  { region: 'HKG', ticker: 'HSTECH.HK', name: '恒生科技', country: '香港', flag: '🇭🇰' },
  { region: 'JPN', ticker: '^N225', name: '日经225', country: '日本', flag: '🇯🇵' },
  { region: 'KOR', ticker: '^KS11', name: 'KOSPI', country: '韩国', flag: '🇰🇷' },
  { region: 'GBR', ticker: '^FTSE', name: '富时100', country: '英国', flag: '🇬🇧' },
  { region: 'DEU', ticker: '^GDAXI', name: 'DAX', country: '德国', flag: '🇩🇪' },
  { region: 'CAN', ticker: '^GSPTSE', name: 'TSX综指', country: '加拿大', flag: '🇨🇦' },
  { region: 'IND', ticker: '^BSESN', name: 'SENSEX', country: '印度', flag: '🇮🇳' },
];

// 提取唯一的国家列表用于筛选按钮
const COUNTRIES = Array.from(new Set(MARKET_INDICES.map(i => JSON.stringify({ name: i.country, region: i.region, flag: i.flag }))))
  .map(s => JSON.parse(s));

// --- 2. 辅助函数 ---
const formatNum = (num: number) => {
  if (num === undefined || num === null) return '--';
  return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const getChangeColorClass = (change: number) => {
    if (change > 0) return 'text-emerald-600';
    if (change < 0) return 'text-rose-600';
    return 'text-gray-500';
};

// --- 3. 页面组件 ---

export default function MarketOverviewPage() {
  const [marketData, setMarketData] = useState<any[]>([]); 
  const [filteredData, setFilteredData] = useState<any[]>([]);
  const [selectedRegion, setSelectedRegion] = useState<string>('ALL'); // 当前选中的地区
  const [lastUpdated, setLastUpdated] = useState<string>("--:--");
  const [isLoading, setIsLoading] = useState(false);
  const [isMounted, setIsMounted] = useState(false);

  // 核心数据获取逻辑
  const fetchAllMarketData = async () => {
    setIsLoading(true);
    try {
      const promises = MARKET_INDICES.map(async (item) => {
        try {
          const res = await fetch(`/api/quote?symbol=${encodeURIComponent(item.ticker)}`);
          if (!res.ok) throw new Error('Fetch failed');
          const data = await res.json();
          return {
            ...item,
            price: data.price,
            change: data.change,
            changePercent: data.changePercent,
            currency: data.currency
          };
        } catch (error) {
          console.warn(`Failed to fetch ${item.ticker}`, error);
          return { ...item, price: 0, change: 0, changePercent: 0, error: true };
        }
      });

      const results = await Promise.all(promises);
      setMarketData(results);
      setLastUpdated(new Date().toLocaleTimeString());
    } catch (error) {
      console.error("Global Market Fetch Error:", error);
    } finally {
      setIsLoading(false);
    }
  };

  // 初始化加载
  useEffect(() => {
    setIsMounted(true);
    fetchAllMarketData();
  }, []);

  // 筛选逻辑
  useEffect(() => {
    if (selectedRegion === 'ALL') {
      setFilteredData(marketData);
    } else {
      setFilteredData(marketData.filter(item => item.region === selectedRegion));
    }
  }, [selectedRegion, marketData]);

  if (!isMounted) return <div className="min-h-screen bg-white pt-24 px-6">加载中...</div>;

  return (
    <div className="min-h-screen bg-white pt-24 px-6 pb-12">
      <div className="max-w-7xl mx-auto">
        
        {/* 顶部标题栏 */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-black text-gray-900 flex items-center gap-3">
              全球市场概览
            </h1>
            <p className="text-gray-500 mt-2 text-sm">
              实时追踪全球核心指数资金流向与市场热度。
            </p>
          </div>
          
          <div className="flex items-center gap-4">
            <button 
              onClick={fetchAllMarketData}
              disabled={isLoading}
              className={`flex items-center gap-2 px-6 py-2.5 rounded-full font-bold text-sm text-white transition-all shadow-lg 
                ${isLoading 
                  ? 'bg-gray-400 cursor-not-allowed' 
                  : 'bg-indigo-600 hover:bg-indigo-700 hover:shadow-indigo-200 active:scale-95'
                }`}
            >
              {isLoading ? (
                <>
                  <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  刷新中...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  刷新行情
                </>
              )}
            </button>
            <div className="hidden md:flex flex-col items-end text-xs text-gray-400">
              <span>上次更新: {lastUpdated}</span>
            </div>
          </div>
        </div>

        {/* --- 地区选择器 (Tabs) --- */}
        <div className="flex flex-wrap gap-2 mb-6">
          <button
            onClick={() => setSelectedRegion('ALL')}
            className={`px-4 py-2 rounded-full text-sm font-bold transition-all border ${
              selectedRegion === 'ALL' 
                ? 'bg-gray-900 text-white border-gray-900 shadow-md' 
                : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
            }`}
          >
            🌍 全部
          </button>
          {COUNTRIES.map((c: any) => (
            <button
              key={c.region}
              onClick={() => setSelectedRegion(c.region)}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-all border flex items-center gap-2 ${
                selectedRegion === c.region 
                  ? 'bg-white text-blue-600 border-blue-600 shadow-md ring-1 ring-blue-600' 
                  : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
              }`}
            >
              <span>{c.flag}</span>
              {c.name}
            </button>
          ))}
        </div>

        {/* --- 核心表格：全球指数列表 --- */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden min-h-[300px]">
            <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                            <th className="px-6 py-4">地区 / 国家</th>
                            <th className="px-6 py-4">指数名称</th>
                            <th className="px-6 py-4 text-right">最新价</th>
                            <th className="px-6 py-4 text-right">涨跌额</th>
                            <th className="px-6 py-4 text-right">涨跌幅 %</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {isLoading && marketData.length === 0 ? (
                            <tr><td colSpan={5} className="p-8 text-center text-gray-400">正在获取全球数据...</td></tr>
                        ) : filteredData.length === 0 ? (
                            <tr><td colSpan={5} className="p-8 text-center text-gray-400">暂无数据</td></tr>
                        ) : (
                            filteredData.map((item, index) => (
                                <tr key={index} className="hover:bg-gray-50 transition-colors group">
                                    <td className="px-6 py-4">
                                        <div className="flex items-center gap-3">
                                            <span className="text-xl">{item.flag}</span>
                                            <div className="flex flex-col">
                                              <span className="font-medium text-gray-900">{item.country}</span>
                                              <span className="text-[10px] text-gray-400 font-mono">{item.region}</span>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="flex flex-col">
                                            <span className="font-bold text-gray-800">{item.name}</span>
                                            <span className="text-xs text-gray-400 font-mono">{item.ticker}</span>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 text-right font-mono font-medium text-gray-900">
                                        {formatNum(item.price)}
                                    </td>
                                    <td className={`px-6 py-4 text-right font-mono font-medium ${getChangeColorClass(item.change)}`}>
                                        {item.change > 0 ? '+' : ''}{formatNum(item.change)}
                                    </td>
                                    <td className="px-6 py-4 text-right">
                                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold ${
                                            item.changePercent > 0 ? 'bg-emerald-100 text-emerald-800' : 
                                            item.changePercent < 0 ? 'bg-rose-100 text-rose-800' : 'bg-gray-100 text-gray-800'
                                        }`}>
                                            {item.changePercent > 0 ? '+' : ''}{formatNum(item.changePercent)}%
                                        </span>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>

        {/* 底部占位：外汇与加密货币 (Next Steps) */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mt-8 opacity-50 grayscale hover:grayscale-0 transition-all duration-500">
            <div className="h-48 bg-white rounded-2xl border-2 border-dashed border-gray-200 flex flex-col items-center justify-center">
                <span className="text-3xl mb-2">💱</span>
                <span className="text-gray-400 font-medium">外汇汇率矩阵 (下一步)</span>
            </div>
            <div className="h-48 bg-white rounded-2xl border-2 border-dashed border-gray-200 flex flex-col items-center justify-center">
                <span className="text-3xl mb-2">🪙</span>
                <span className="text-gray-400 font-medium">避险与加密资产 (下一步)</span>
            </div>
        </div>

      </div>
    </div>
  );
}