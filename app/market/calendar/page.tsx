'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { getStockDetail, getLevel1Sectors } from '@/app/lib/stockService'; 
import { useStockPool } from '@/app/hooks/useStockPool'; // <--- 修改 1: 引入 Hook，替代原来的 static import

// --- 配置 ---
const API_TOKEN = '692ff0e71412a4.89947654'; 

// --- 图标组件 (保持不变) ---
const ChevronLeft = ({ className }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="m15 18-6-6 6-6"/></svg>
);
const ChevronRight = ({ className }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="m9 18 6-6-6-6"/></svg>
);
const Filter = ({ className }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
);
const Loader2 = ({ className }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
);
const ExternalLink = ({ className }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" x2="21" y1="14" y2="3"/></svg>
);
const X = ({ className }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="M18 6 6 18"/><path d="m6 6 18 18"/></svg>
);
const Building = ({ className }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><rect width="16" height="20" x="4" y="2" rx="2" ry="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01"/><path d="M16 6h.01"/><path d="M8 10h.01"/><path d="M16 10h.01"/><path d="M8 14h.01"/><path d="M16 14h.01"/></svg>
);
const Globe = ({ className }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>
);


// --- 类型定义 ---
interface CalendarEvent {
  type: string;        
  date: string;        
  
  country?: string;
  impact?: string;

  code?: string;
  stockName?: string;
  sectorL1?: string;
  sectorL2?: string;
  epsEstimate?: number | null; 
  dividendValue?: number | null; 
  currencySymbol?: string;
}

const MACRO_COUNTRIES = [
  { code: 'US', label: 'United States', flag: '🇺🇸' },
  { code: 'CN', label: 'China', flag: '🇨🇳' },
  { code: 'JP', label: 'Japan', flag: '🇯🇵' },
  { code: 'EU', label: 'Euro Zone', flag: '🇪🇺' },
  { code: 'GB', label: 'United Kingdom', flag: '🇬🇧' },
  { code: 'BR', label: 'Brazil', flag: '🇧🇷' },
  { code: 'AU', label: 'Australia', flag: '🇦🇺' },
  { code: 'CA', label: 'Canada', flag: '🇨🇦' },
];

type ViewMode = 'macro' | 'stock';

export default function CalendarPage() {
  const [currentDate, setCurrentDate] = useState(new Date()); 
  const [viewMode, setViewMode] = useState<ViewMode>('macro');
  const [loading, setLoading] = useState(false);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [showJin10, setShowJin10] = useState(false);

  // --- 修改 2: 使用 Hook 获取动态数据 ---
  const { stocks: stockPool, loading: poolLoading } = useStockPool();

  // 筛选器
  const [selectedCountries, setSelectedCountries] = useState<string[]>(['US', 'CN']);
  const [sectorList, setSectorList] = useState<string[]>([]);
  const [selectedSector, setSelectedSector] = useState<string>('全部'); 

  const [inputYear, setInputYear] = useState(currentDate.getFullYear());
  const [inputMonth, setInputMonth] = useState(currentDate.getMonth() + 1);

  // 初始化行业列表 (修改 3: 依赖 stockPool 变化)
  useEffect(() => {
    try {
      // getLevel1Sectors 现在需要传入 stockPool
      if (stockPool.length > 0) {
        const sectors = getLevel1Sectors(stockPool);
        setSectorList(['全部', ...sectors]);
      } else {
        setSectorList(['全部']);
      }
    } catch (e) {
      console.warn("Failed to load sectors", e);
      setSectorList(['全部']);
    }
  }, [stockPool]);

  // 同步日期输入
  useEffect(() => {
    setInputYear(currentDate.getFullYear());
    setInputMonth(currentDate.getMonth() + 1);
  }, [currentDate]);

  // --- 核心数据获取 ---
  useEffect(() => {
    let isMounted = true;

    const fetchData = async () => {
      // 增加逻辑: 如果在个股模式下且数据还没加载完，先不执行
      if (viewMode === 'stock' && poolLoading) return;

      setLoading(true);
      setEvents([]); 

      try {
        if (viewMode === 'macro') {
          // ========================
          // 宏观逻辑 (API Route)
          // ========================
          const year = currentDate.getFullYear();
          const month = currentDate.getMonth() + 1;
          const firstDay = `${year}-${String(month).padStart(2, '0')}-01`;
          const lastDayDate = new Date(year, month, 0);
          const lastDay = `${year}-${String(month).padStart(2, '0')}-${lastDayDate.getDate()}`;

          const params = new URLSearchParams({
            type: 'economics', 
            from: firstDay,
            to: lastDay
          });

          const response = await fetch(`/api/eod?${params.toString()}`);
          if (isMounted && response.ok) {
            const rawData = await response.json();
            const dataArray = Array.isArray(rawData) ? rawData : [];
            const processedData: CalendarEvent[] = dataArray
              .filter((item: any) => item && item.type && item.date && item.country)
              .map((item: any) => ({
                type: item.type,
                country: item.country,
                date: item.date,
                impact: item.importance || 'Low'
              }));
            setEvents(processedData);
          }

        } else {
          // ========================
          // 个股逻辑 (改进版：分批获取，确保“全部”模式下覆盖所有股票)
          // ========================
          
          // 1. 获取本地股票池 (修改 4: 使用 Hook 返回的 stockPool)
          const safeStockPool = Array.isArray(stockPool) ? stockPool : [];
          if (safeStockPool.length === 0) {
             if (isMounted) setLoading(false);
             return;
          }

          // 2. 根据“一级行业”预筛选
          let targetStocks = safeStockPool;
          if (selectedSector !== '全部') {
            targetStocks = safeStockPool.filter((s: any) => s.sector_level_1 === selectedSector);
          }

          // 3. 提取代码并修正后缀 (如 0700 -> 0700.HK)
          const targetSymbols = targetStocks.map((item: any) => {
            let sym = item.symbol || item.code || '';
            sym = sym.trim().toUpperCase();
            
            // 港股处理：4-5位纯数字 -> 加 .HK
            if (/^\d{4,5}$/.test(sym)) {
              return `${sym}.HK`;
            }
            // 纯字母代码 (如 AAPL) -> 不加后缀 .US，直接使用
            return sym;
          }).filter((sym: string) => {
            const s = sym.toUpperCase();
            // 筛选条件：.US, .HK 或 纯无后缀代码 (默认为美股)
            return s.endsWith('.US') || s.endsWith('.HK') || !s.includes('.');
          });

          if (targetSymbols.length === 0) {
            if (isMounted) setLoading(false);
            return;
          }

          // 4. 构建日期范围 (本月)
          const y = currentDate.getFullYear();
          const m = currentDate.getMonth() + 1;
          const fromDate = `${y}-${String(m).padStart(2, '0')}-01`;
          // 获取当月最后一天
          const lastDayObj = new Date(y, m, 0);
          const toDate = `${y}-${String(m).padStart(2, '0')}-${lastDayObj.getDate()}`;

          // 5. 分批处理请求 (Batch Requests) - 修复逻辑BUG的核心
          // 原来的 slice(0, 40) 会导致排在后面的股票被截断。现在改为每 50 个一组并行请求。
          const BATCH_SIZE = 50; 
          const batches = [];
          for (let i = 0; i < targetSymbols.length; i += BATCH_SIZE) {
            batches.push(targetSymbols.slice(i, i + BATCH_SIZE));
          }

          const foundEvents: CalendarEvent[] = [];

          // 辅助函数：尝试匹配本地信息
          const findLocalInfo = (apiCode: string) => {
            let info = getStockDetail(apiCode, stockPool) || {};
            if (!info.name && apiCode.includes('.')) {
                const shortCode = apiCode.split('.')[0];
                const info2 = getStockDetail(shortCode, stockPool);
                if (info2 && info2.name) return info2;
            }
            return info;
          };

          // 并行执行所有批次的请求
          await Promise.all(batches.map(async (batchSymbols) => {
             const symbolsParam = batchSymbols.join(',');
             const earningsUrl = `https://eodhd.com/api/calendar/earnings?from=${fromDate}&to=${toDate}&symbols=${symbolsParam}&api_token=${API_TOKEN}&fmt=json`;
             const dividendsUrl = `https://eodhd.com/api/calendar/dividends?from=${fromDate}&to=${toDate}&symbols=${symbolsParam}&api_token=${API_TOKEN}&fmt=json`;

             try {
               const [earningsRes, dividendsRes] = await Promise.all([
                 fetch(earningsUrl).catch(() => null),
                 fetch(dividendsUrl).catch(() => null)
               ]);

               // --- A. 处理财报数据 ---
               if (earningsRes && earningsRes.ok) {
                 const eData = await earningsRes.json();
                 if (Array.isArray(eData.earnings)) {
                     eData.earnings.forEach((item: any) => {
                         const localDetail = findLocalInfo(item.code);
                         foundEvents.push({
                             type: '财报发布',
                             date: item.report_date,
                             code: item.code,
                             stockName: localDetail.name || item.code,
                             sectorL1: localDetail.sector_level_1 || '其他',
                             sectorL2: localDetail.sector_level_2 || '',
                             epsEstimate: item.estimate,
                             currencySymbol: item.currency_symbol || '$' 
                         });
                     });
                 }
               }

               // --- B. 处理分红数据 ---
               if (dividendsRes && dividendsRes.ok) {
                 const dData = await dividendsRes.json();
                 if (Array.isArray(dData.data)) {
                     dData.data.forEach((item: any) => {
                         const localDetail = findLocalInfo(item.code);
                         foundEvents.push({
                             type: '除权派息',
                             date: item.date, // Ex-Date
                             code: item.code,
                             stockName: localDetail.name || item.code,
                             sectorL1: localDetail.sector_level_1 || '其他',
                             sectorL2: localDetail.sector_level_2 || '',
                             dividendValue: item.value,
                             currencySymbol: item.currency_symbol || '$'
                         });
                     });
                 }
               }
             } catch (e) {
               console.error("Batch fetch error", e);
             }
          }));
          
          if (isMounted) {
            setEvents(foundEvents);
          }
        }
      } catch (error) {
        console.error("Failed to fetch data", error);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    fetchData();

    return () => { isMounted = false; };
  }, [currentDate, viewMode, selectedSector, poolLoading, stockPool]); // 修改 6: 增加依赖

  // --- UI 数据展示过滤 ---
  const displayEvents = useMemo(() => {
    if (!events) return []; 
    let filtered = events;

    if (viewMode === 'macro') {
      filtered = events.filter(e => e.country && selectedCountries.includes(e.country));
    }
    
    // 按日期排序 (正序)
    return filtered.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [events, viewMode, selectedCountries]);

  const jumpToDate = (year: number, month: number) => {
    setCurrentDate(new Date(year, month - 1, 1));
  };

  const toggleCountry = (code: string) => {
    setSelectedCountries(prev => prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code]);
  };

  const getBadgeColor = (key: string) => {
    const colors = [
      'bg-blue-50 text-blue-700 border-blue-200',
      'bg-red-50 text-red-700 border-red-200',
      'bg-green-50 text-green-700 border-green-200',
      'bg-purple-50 text-purple-700 border-purple-200',
      'bg-orange-50 text-orange-700 border-orange-200',
    ];
    let hash = 0;
    for (let i = 0; i < key.length; i++) hash = key.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
  };

  const formatListDate = (dateStr: string) => {
    try {
      // 简单做法：直接用 dateStr 解析
      const [y, m, d] = dateStr.split('-');
      const dateObj = new Date(parseInt(y), parseInt(m)-1, parseInt(d));
      const w = dateObj.toLocaleDateString('zh-CN', { weekday: 'short' });
      return `${parseInt(m)}-${parseInt(d)} (${w})`;
    } catch { return dateStr; }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans flex flex-col">
      {/* 顶部控制区 */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-20 shadow-sm">
        <div className="px-6 py-4">
          <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 mb-4">
            <div className="flex flex-col gap-3">
              <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
                <span className="bg-slate-900 text-white p-1 rounded">
                  {viewMode === 'macro' ? 'M' : 'S'}
                </span> 
                {viewMode === 'macro' ? '宏观经济日历' : '个股大事日历'}
              </h1>
              <div className="flex bg-slate-100 p-1 rounded-lg self-start">
                <button onClick={() => setViewMode('macro')} className={`flex items-center gap-2 px-4 py-1.5 text-sm font-medium rounded-md transition-all ${viewMode === 'macro' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                  <Globe className="h-4 w-4" /> 宏观
                </button>
                <button onClick={() => setViewMode('stock')} className={`flex items-center gap-2 px-4 py-1.5 text-sm font-medium rounded-md transition-all ${viewMode === 'stock' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                  <Building className="h-4 w-4" /> 个股
                </button>
              </div>
            </div>

            <div className="flex flex-col items-end gap-2 w-full md:w-auto">
              {/* 年月选择器 */}
              <div className="flex items-center bg-slate-100 rounded-lg p-1 gap-1">
                <button onClick={() => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1))} className="p-2 hover:bg-white rounded-md text-slate-600">
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <div className="flex items-center gap-2 px-2 border-x border-slate-200/50">
                  <input type="number" value={inputYear} onChange={(e) => {
                    const val = parseInt(e.target.value); setInputYear(val); if(val>1900 && val<2100) jumpToDate(val, inputMonth);
                  }} className="w-16 bg-transparent text-center font-bold text-slate-800 focus:outline-none" />
                  <span className="text-slate-400">/</span>
                  <select value={inputMonth} onChange={(e) => {
                    const val = parseInt(e.target.value); setInputMonth(val); jumpToDate(inputYear, val);
                  }} className="bg-transparent font-semibold text-slate-700 focus:outline-none cursor-pointer">
                    {Array.from({length:12},(_,i)=>i+1).map(m=><option key={m} value={m}>{m}月</option>)}
                  </select>
                </div>
                <button onClick={() => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1))} className="p-2 hover:bg-white rounded-md text-slate-600">
                  <ChevronRight className="h-5 w-5" />
                </button>
              </div>

              <button onClick={() => setShowJin10(!showJin10)} className={`flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded transition-colors ${showJin10 ? 'bg-blue-600 text-white' : 'bg-white border border-slate-200'}`}>
                <ExternalLink className="h-3 w-3" /> {showJin10 ? '关闭金十' : '金十数据'}
              </button>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 items-center min-h-[32px]">
            <div className="flex items-center text-xs text-slate-500 mr-2 shrink-0">
              <Filter className="h-3 w-3 mr-1" />
              {viewMode === 'macro' ? '筛选国家:' : '筛选一级行业:'}
            </div>

            {viewMode === 'macro' ? (
              MACRO_COUNTRIES.map((country) => (
                <button key={country.code} onClick={() => toggleCountry(country.code)} className={`px-3 py-1 rounded-full text-xs font-medium border transition-all flex items-center gap-1.5 ${selectedCountries.includes(country.code) ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'}`}>
                  <span>{country.flag}</span> {country.code}
                </button>
              ))
            ) : (
              <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1 flex-1 mask-right">
                {poolLoading ? <span className="text-xs text-gray-400">加载行业中...</span> : sectorList.map((sector) => (
                  <button key={sector} onClick={() => setSelectedSector(sector)} className={`px-3 py-1 rounded-full text-xs font-medium border transition-all whitespace-nowrap ${selectedSector === sector ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-500 border-slate-200 hover:border-blue-300 hover:text-blue-600'}`}>
                    {sector}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </header>

      {showJin10 && (
        <div className="border-b border-slate-200 bg-slate-100 relative">
          <button onClick={() => setShowJin10(false)} className="absolute top-2 right-2 p-1 bg-white rounded-full shadow z-10"><X className="h-4 w-4 text-slate-500" /></button>
          <div className="w-full h-[600px] bg-white">
            <iframe src="https://rili.jin10.com/" className="w-full h-full border-none" title="金十" />
          </div>
        </div>
      )}

      <div className="flex-1 p-6 max-w-5xl mx-auto w-full">
        {loading ? (
          <div className="flex flex-col items-center justify-center h-64 text-slate-400">
            <Loader2 className="h-8 w-8 animate-spin mb-2" />
            <p>正在获取 {inputYear}年{inputMonth}月 数据...</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-200">
                <tr>
                  <th className="px-6 py-4 w-48 whitespace-nowrap">时间</th>
                  <th className="px-6 py-4">{viewMode === 'macro' ? '国家 / 地区' : '股票代码 / 名称'}</th>
                  <th className="px-6 py-4">事件内容</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {displayEvents.length > 0 ? (
                  displayEvents.map((event, idx) => (
                    <tr key={idx} className="hover:bg-slate-50 transition-colors group">
                      <td className="px-6 py-4 text-slate-600 font-mono font-medium whitespace-nowrap align-top">
                        {formatListDate(event.date)}
                      </td>
                      <td className="px-6 py-4 align-top">
                        {viewMode === 'macro' ? (
                          <span className={`px-2 py-0.5 rounded text-[11px] font-bold border uppercase ${getBadgeColor(event.country || 'UN')}`}>
                            {event.country}
                          </span>
                        ) : (
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-slate-800 text-lg">{event.code}</span>
                            </div>
                            <span className="text-xs text-slate-500 font-medium">{event.stockName}</span>
                            <div className="flex gap-1 mt-1">
                               <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-100 text-slate-500 border border-slate-200">
                                  {event.sectorL1}
                               </span>
                               {event.sectorL2 && (
                                 <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-50 text-slate-500 border border-slate-200">
                                   {event.sectorL2}
                                 </span>
                               )}
                            </div>
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4 align-top">
                        <div className="flex items-center gap-2 mb-1">
                           <span className={`inline-block w-2 h-2 rounded-full ${event.type === '财报发布' ? 'bg-blue-500' : event.type === '除权派息' ? 'bg-green-500' : 'bg-gray-400'}`}></span>
                           <span className="text-slate-900 font-medium text-base">{event.type}</span>
                        </div>
                        
                        {/* 财报详情 */}
                        {event.type === '财报发布' && (
                          <div className="mt-1 text-xs text-slate-500 bg-slate-50 px-2 py-1 rounded inline-block">
                             预计 EPS: <span className="font-bold text-slate-700">{event.epsEstimate !== undefined && event.epsEstimate !== null ? `${event.currencySymbol}${event.epsEstimate}` : '-'}</span>
                          </div>
                        )}

                        {/* 分红详情 */}
                        {event.type === '除权派息' && (
                          <div className="mt-1 text-xs text-slate-500 bg-slate-50 px-2 py-1 rounded inline-block">
                             派息: <span className="font-bold text-green-700">{event.dividendValue ? `${event.currencySymbol}${event.dividendValue}` : '-'}</span> / 股
                          </div>
                        )}
                        
                        {/* 宏观详情 */}
                        {viewMode === 'macro' && event.impact && (
                           <div className="mt-1">
                              <span className={`text-[10px] px-1.5 py-0.5 rounded border ${event.impact === 'High' ? 'bg-red-50 text-red-600 border-red-100' : 'bg-slate-50 text-slate-500 border-slate-100'}`}>
                                {event.impact} Impact
                              </span>
                           </div>
                        )}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={3} className="px-6 py-16 text-center text-slate-400 bg-slate-50/50">
                      <div className="flex flex-col items-center">
                        <Filter className="h-8 w-8 mb-2 opacity-20" />
                        <p>{viewMode === 'macro' ? '本月暂无宏观数据' : `本月 (${inputMonth}月) 暂无个股重大事件`}</p>
                        {viewMode === 'stock' && events.length === 0 && (
                          <p className="text-xs text-slate-400 mt-2 max-w-xs text-center">
                            请尝试切换到下个月份 (如 2025年3月)。
                          </p>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}