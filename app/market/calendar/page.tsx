'use client';

import React, { useState, useEffect, useMemo } from 'react';
// 使用相对路径引用，确保兼容性
import { getStockDetail, getLevel1Sectors } from '../../lib/stockService'; 

// --- 图标组件 ---
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
  type: string;        // 事件类型/名称
  country?: string;    // 国家代码 (宏观用)
  code?: string;       // 股票代码 (个股用)
  date: string;        // 日期
  
  // 扩展字段 (个股日历用)
  stockName?: string;
  sectorL1?: string;
  sectorL2?: string;
}

// 宏观 - 支持的国家列表
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

// 视图模式
type ViewMode = 'macro' | 'stock';

export default function CalendarPage() {
  // --- 全局状态 ---
  const [currentDate, setCurrentDate] = useState(new Date()); 
  const [viewMode, setViewMode] = useState<ViewMode>('macro'); // 默认宏观视图
  const [loading, setLoading] = useState(false);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [showJin10, setShowJin10] = useState(false);

  // --- 筛选器状态 ---
  const [selectedCountries, setSelectedCountries] = useState<string[]>(['US', 'CN']);
  const [sectorList, setSectorList] = useState<string[]>([]);
  const [selectedSector, setSelectedSector] = useState<string>('全部'); 

  // 临时日期输入状态
  const [inputYear, setInputYear] = useState(currentDate.getFullYear());
  const [inputMonth, setInputMonth] = useState(currentDate.getMonth() + 1);

  // 初始化：获取一级行业列表
  useEffect(() => {
    try {
      const sectors = getLevel1Sectors();
      setSectorList(['全部', ...sectors]);
    } catch (e) {
      console.warn("Failed to load sectors", e);
      setSectorList(['全部']);
    }
  }, []);

  // 同步日期输入框
  useEffect(() => {
    setInputYear(currentDate.getFullYear());
    setInputMonth(currentDate.getMonth() + 1);
  }, [currentDate]);

  // --- 核心：数据获取 ---
  useEffect(() => {
    let isMounted = true;

    const fetchData = async () => {
      setLoading(true);
      setEvents([]); // 切换时先清空
      try {
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth() + 1;
        const firstDay = `${year}-${String(month).padStart(2, '0')}-01`;
        const lastDayDate = new Date(year, month, 0);
        const lastDay = `${year}-${String(month).padStart(2, '0')}-${lastDayDate.getDate()}`;

        // 视图模式决定请求类型
        const apiType = viewMode === 'macro' ? 'economics' : 'earnings';

        const params = new URLSearchParams({
          type: apiType, 
          from: firstDay,
          to: lastDay
        });

        const response = await fetch(`/api/eod?${params.toString()}`);
        
        if (isMounted && response.ok) {
          const rawData = await response.json();
          // 确保是数组，防止 API 返回错误格式
          const dataArray = Array.isArray(rawData) ? rawData : [];
          
          let processedData: CalendarEvent[] = [];

          if (viewMode === 'macro') {
            // --- 宏观数据处理 ---
            // 修复：增加 item && 检查，防止空指针异常
            processedData = dataArray
              .filter((item: any) => item && item.type && item.date && item.country)
              .map((item: any) => ({
                type: item.type,
                country: item.country,
                date: item.date
              }));

          } else {
            // --- 个股数据处理 (漏斗筛选) ---
            processedData = dataArray.reduce((acc: CalendarEvent[], item: any) => {
              // 1. 基础检查：增加 item 存在性检查
              if (!item || !item.code || !item.date) return acc;

              // 确保 code 是字符串，防止数字类型导致 toUpperCase 报错
              const upperCode = String(item.code).toUpperCase();

              // -----------------------------------------------------------
              // [关键修改] 个股日历特有的过滤规则：
              // 剔除后缀为 .SS, .SZ, .T 的股票
              // -----------------------------------------------------------
              const forbiddenSuffixes = ['.SS', '.SZ', '.T'];
              if (forbiddenSuffixes.some(suffix => upperCode.endsWith(suffix))) {
                return acc;
              }

              // 2. 查池子 (调用纯净的 stockService)
              const validStock = getStockDetail(upperCode);

              if (validStock) {
                // 3. 数据增强
                acc.push({
                  type: 'Q3 财报发布', // 示例，具体看API返回
                  code: item.code,
                  date: item.date,
                  stockName: validStock.name,
                  sectorL1: validStock.sector_level_1,
                  sectorL2: validStock.sector_level_2,
                });
              }
              return acc;
            }, []);
          }
          
          setEvents(processedData);
        }
      } catch (error) {
        console.error("Failed to fetch data", error);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    fetchData();

    return () => { isMounted = false; };
  }, [currentDate, viewMode]); 

  // --- 数据展示过滤 (UI层过滤) ---
  const displayEvents = useMemo(() => {
    if (!events) return []; // 防御性检查

    let filtered = events;

    if (viewMode === 'macro') {
      filtered = events.filter(e => e.country && selectedCountries.includes(e.country));
    } else {
      if (selectedSector !== '全部') {
        filtered = events.filter(e => e.sectorL1 === selectedSector);
      }
    }
    
    // 按日期排序
    return filtered.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [events, viewMode, selectedCountries, selectedSector]);

  // --- 辅助函数 ---
  const formatListDate = (dateStr: string) => {
    try {
      const date = new Date(dateStr);
      const m = (date.getMonth() + 1).toString().padStart(2, '0');
      const d = date.getDate().toString().padStart(2, '0');
      const w = date.toLocaleDateString('zh-CN', { weekday: 'short' });
      return `${m}-${d} (${w})`;
    } catch { return dateStr; }
  };

  const jumpToDate = (year: number, month: number) => {
    setCurrentDate(new Date(year, month - 1, 1));
  };

  // --- 交互 Handler ---
  const toggleCountry = (code: string) => {
    setSelectedCountries(prev => prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code]);
  };

  // 颜色映射
  const getBadgeColor = (key: string) => {
    const colors = [
      'bg-blue-50 text-blue-700 border-blue-200',
      'bg-red-50 text-red-700 border-red-200',
      'bg-green-50 text-green-700 border-green-200',
      'bg-purple-50 text-purple-700 border-purple-200',
      'bg-orange-50 text-orange-700 border-orange-200',
      'bg-indigo-50 text-indigo-700 border-indigo-200',
    ];
    let hash = 0;
    for (let i = 0; i < key.length; i++) hash = key.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans flex flex-col">
      
      {/* --- 顶部控制区 --- */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-20 shadow-sm">
        <div className="px-6 py-4">
          
          {/* 第一行：标题、视图切换、时间控制 */}
          <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 mb-4">
            
            <div className="flex flex-col gap-3">
              <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
                <span className="bg-slate-900 text-white p-1 rounded">
                  {viewMode === 'macro' ? 'M' : 'S'}
                </span> 
                {viewMode === 'macro' ? '宏观经济日历' : '个股大事日历'}
              </h1>

              {/* 视图切换 Segmented Control */}
              <div className="flex bg-slate-100 p-1 rounded-lg self-start">
                <button
                  onClick={() => setViewMode('macro')}
                  className={`flex items-center gap-2 px-4 py-1.5 text-sm font-medium rounded-md transition-all ${
                    viewMode === 'macro' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  <Globe className="h-4 w-4" />
                  宏观
                </button>
                <button
                  onClick={() => setViewMode('stock')}
                  className={`flex items-center gap-2 px-4 py-1.5 text-sm font-medium rounded-md transition-all ${
                    viewMode === 'stock' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  <Building className="h-4 w-4" />
                  个股
                </button>
              </div>
            </div>

            {/* 右侧控制 */}
            <div className="flex flex-col items-end gap-2 w-full md:w-auto">
              {/* 年月选择 */}
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

              {/* 金十按钮 */}
              <button onClick={() => setShowJin10(!showJin10)} className={`flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded transition-colors ${showJin10 ? 'bg-blue-600 text-white' : 'bg-white border border-slate-200'}`}>
                <ExternalLink className="h-3 w-3" />
                {showJin10 ? '关闭金十' : '金十数据'}
              </button>
            </div>
          </div>

          {/* 第二行：动态筛选器 */}
          <div className="flex flex-wrap gap-2 items-center min-h-[32px]">
            <div className="flex items-center text-xs text-slate-500 mr-2 shrink-0">
              <Filter className="h-3 w-3 mr-1" />
              {viewMode === 'macro' ? '筛选国家:' : '筛选一级行业:'}
            </div>

            {viewMode === 'macro' ? (
              // 宏观 - 国家筛选
              MACRO_COUNTRIES.map((country) => (
                <button
                  key={country.code}
                  onClick={() => toggleCountry(country.code)}
                  className={`px-3 py-1 rounded-full text-xs font-medium border transition-all flex items-center gap-1.5 ${
                    selectedCountries.includes(country.code) ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <span>{country.flag}</span> {country.code}
                </button>
              ))
            ) : (
              // 个股 - 行业筛选 (横向滚动)
              <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1 flex-1 mask-right">
                {sectorList.map((sector) => (
                  <button
                    key={sector}
                    onClick={() => setSelectedSector(sector)}
                    className={`px-3 py-1 rounded-full text-xs font-medium border transition-all whitespace-nowrap ${
                      selectedSector === sector ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-500 border-slate-200 hover:border-blue-300 hover:text-blue-600'
                    }`}
                  >
                    {sector}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* --- 金十 Iframe --- */}
      {showJin10 && (
        <div className="border-b border-slate-200 bg-slate-100 relative">
          <button onClick={() => setShowJin10(false)} className="absolute top-2 right-2 p-1 bg-white rounded-full shadow z-10"><X className="h-4 w-4 text-slate-500" /></button>
          <div className="w-full h-[600px] bg-white">
            <iframe src="https://rili.jin10.com/" className="w-full h-full border-none" title="金十" />
          </div>
        </div>
      )}

      {/* --- 表格主体 --- */}
      <div className="flex-1 p-6 max-w-5xl mx-auto w-full">
        {loading ? (
          <div className="flex flex-col items-center justify-center h-64 text-slate-400">
            <Loader2 className="h-8 w-8 animate-spin mb-2" />
            <p>正在加载{viewMode === 'macro' ? '宏观' : '个股'}数据...</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-200">
                <tr>
                  <th className="px-6 py-4 w-48 whitespace-nowrap">时间</th>
                  <th className="px-6 py-4">{viewMode === 'macro' ? '国家 / 地区' : '股票 / 行业'}</th>
                  <th className="px-6 py-4">事件详情</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {displayEvents.length > 0 ? (
                  displayEvents.map((event, idx) => (
                    <tr key={idx} className="hover:bg-slate-50 transition-colors group">
                      {/* 时间 */}
                      <td className="px-6 py-4 text-slate-600 font-mono font-medium whitespace-nowrap align-top">
                        {formatListDate(event.date)}
                      </td>
                      
                      {/* 标签列 (国家 或 股票信息) */}
                      <td className="px-6 py-4 align-top">
                        {viewMode === 'macro' ? (
                          <span className={`px-2 py-0.5 rounded text-[11px] font-bold border uppercase ${getBadgeColor(event.country || 'UN')}`}>
                            {event.country}
                          </span>
                        ) : (
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-slate-800">{event.code}</span>
                              <span className="text-xs text-slate-500">{event.stockName}</span>
                            </div>
                            <div className="flex gap-1">
                              <span className={`px-1.5 py-0.5 rounded text-[10px] border ${getBadgeColor(event.sectorL1 || '其他')}`}>
                                {event.sectorL1}
                              </span>
                              <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-100 text-slate-500 border border-slate-200">
                                {event.sectorL2}
                              </span>
                            </div>
                          </div>
                        )}
                      </td>

                      {/* 事件详情列 */}
                      <td className="px-6 py-4 align-top">
                        <span className="text-slate-900 font-medium group-hover:text-blue-700 transition-colors block">
                          {event.type}
                        </span>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={3} className="px-6 py-16 text-center text-slate-400 bg-slate-50/50">
                      <div className="flex flex-col items-center">
                        <Filter className="h-8 w-8 mb-2 opacity-20" />
                        <p>{viewMode === 'macro' ? '暂无相关宏观数据' : '您的股票池中今日无大事'}</p>
                        {viewMode === 'stock' && <p className="text-xs mt-2 opacity-60">已自动过滤掉 .SS, .SZ, .T 后缀的股票</p>}
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        
        <div className="mt-6 text-xs text-slate-400 text-center">
           {viewMode === 'stock' ? '数据仅包含您股票池中的标的。' : '显示的均为当地时间或 UTC 时间。'}
        </div>
      </div>
    </div>
  );
}