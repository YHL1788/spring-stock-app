'use client';

import React, { useState, useEffect, useMemo } from 'react';

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

// --- 类型定义 ---
interface MacroEvent {
  type: string;    // 事件名称
  country: string; // 国家代码
  date: string;    // 日期字符串 "YYYY-MM-DD HH:mm:ss"
}

// 支持的国家列表
const SUPPORTED_COUNTRIES = [
  { code: 'US', label: 'United States', flag: '🇺🇸' },
  { code: 'CN', label: 'China', flag: '🇨🇳' },
  { code: 'JP', label: 'Japan', flag: '🇯🇵' },
  { code: 'EU', label: 'Euro Zone', flag: '🇪🇺' },
  { code: 'GB', label: 'United Kingdom', flag: '🇬🇧' },
  { code: 'BR', label: 'Brazil', flag: '🇧🇷' },
  { code: 'AU', label: 'Australia', flag: '🇦🇺' },
  { code: 'CA', label: 'Canada', flag: '🇨🇦' },
];

export default function MacroCalendarPage() {
  // --- 状态管理 ---
  const [currentDate, setCurrentDate] = useState(new Date()); 
  const [selectedCountries, setSelectedCountries] = useState<string[]>(['US', 'CN']); 
  const [events, setEvents] = useState<MacroEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [showJin10, setShowJin10] = useState(false); // 控制金十数据 Iframe 显示

  // 用于手动输入的临时状态
  const [inputYear, setInputYear] = useState(currentDate.getFullYear());
  const [inputMonth, setInputMonth] = useState(currentDate.getMonth() + 1);

  // 当 currentDate 改变时，同步更新输入框的值
  useEffect(() => {
    setInputYear(currentDate.getFullYear());
    setInputMonth(currentDate.getMonth() + 1);
  }, [currentDate]);

  // --- API 数据获取 ---
  useEffect(() => {
    let isMounted = true;

    const fetchMonthData = async () => {
      setLoading(true);
      try {
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
          
          const cleanData = dataArray.filter((item: any) => 
            item.type && item.date && item.country
          );
          
          setEvents(cleanData);
        }
      } catch (error) {
        console.error("Failed to fetch monthly data", error);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    fetchMonthData();

    return () => { isMounted = false; };
  }, [currentDate]);

  // --- 数据处理逻辑 (列表模式) ---
  
  const sortedFilteredEvents = useMemo(() => {
    // 1. 筛选国家
    const filtered = events.filter(e => selectedCountries.includes(e.country));
    
    // 2. 按日期排序 (旧 -> 新)
    return filtered.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [events, selectedCountries]);

  // 格式化日期：[月-日(周X)]
  const formatListDate = (dateStr: string) => {
    try {
      const date = new Date(dateStr);
      const m = (date.getMonth() + 1).toString().padStart(2, '0');
      const d = date.getDate().toString().padStart(2, '0');
      const w = date.toLocaleDateString('zh-CN', { weekday: 'short' });
      
      return `${m}-${d} (${w})`;
    } catch (e) {
      return dateStr;
    }
  };

  // --- 交互处理 ---

  const toggleCountry = (code: string) => {
    setSelectedCountries(prev => 
      prev.includes(code) 
        ? prev.filter(c => c !== code) 
        : [...prev, code]
    );
  };

  const prevMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  };

  const nextMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
  };

  const jumpToDate = (year: number, month: number) => {
    const newDate = new Date(year, month - 1, 1);
    setCurrentDate(newDate);
  };

  const handleYearChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value);
    setInputYear(val);
    if (!isNaN(val) && val > 1900 && val < 2100) {
      jumpToDate(val, inputMonth);
    }
  };

  const handleMonthChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = parseInt(e.target.value);
    setInputMonth(val);
    jumpToDate(inputYear, val);
  };

  const getCountryColor = (code: string) => {
    switch(code) {
      case 'US': return 'bg-blue-50 text-blue-700 border-blue-200';
      case 'CN': return 'bg-red-50 text-red-700 border-red-200';
      case 'EU': return 'bg-indigo-50 text-indigo-700 border-indigo-200';
      default: return 'bg-slate-50 text-slate-700 border-slate-200';
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans flex flex-col">
      
      {/* --- 顶部控制栏 --- */}
      <header className="border-b border-slate-200 px-6 py-4 bg-white sticky top-0 z-20 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 mb-4">
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2 self-center md:self-start">
            <span className="bg-slate-900 text-white p-1 rounded">M</span> 
            宏观经济日历
          </h1>
          
          {/* 右侧控制区：垂直排列 */}
          <div className="flex flex-col items-end gap-2 w-full md:w-auto">
            
            {/* 1. 年月导航控件 */}
            <div className="flex items-center bg-slate-100 rounded-lg p-1 gap-1">
              <button onClick={prevMonth} className="p-2 hover:bg-white rounded-md transition-shadow shadow-sm text-slate-600">
                <ChevronLeft className="h-5 w-5" />
              </button>
              
              <div className="flex items-center gap-2 px-2 border-x border-slate-200/50">
                <input 
                  type="number" 
                  value={inputYear}
                  onChange={handleYearChange}
                  className="w-16 bg-transparent text-center font-bold text-slate-800 focus:outline-none focus:bg-white rounded hover:bg-white/50 transition-colors"
                  min="2000" max="2100"
                />
                <span className="text-slate-400 font-light">/</span>
                <select 
                  value={inputMonth}
                  onChange={handleMonthChange}
                  className="bg-transparent font-semibold text-slate-700 focus:outline-none focus:bg-white rounded hover:bg-white/50 transition-colors cursor-pointer appearance-none pl-2 pr-1"
                >
                  {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                    <option key={m} value={m}>{m}月</option>
                  ))}
                </select>
              </div>

              <button onClick={nextMonth} className="p-2 hover:bg-white rounded-md transition-shadow shadow-sm text-slate-600">
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>

            {/* 2. 金十数据 Iframe 按钮 (在时间按键下方) */}
            <button 
              onClick={() => setShowJin10(!showJin10)}
              className={`
                flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded transition-colors
                ${showJin10 
                  ? 'bg-blue-600 text-white shadow-md' 
                  : 'bg-white text-slate-600 border border-slate-200 hover:border-slate-300 hover:bg-slate-50'}
              `}
            >
              <ExternalLink className="h-3 w-3" />
              {showJin10 ? '关闭金十数据' : '金十数据'}
            </button>

          </div>
        </div>

        {/* 筛选国家 */}
        <div className="flex flex-wrap gap-2 items-center">
          <div className="flex items-center text-xs text-slate-500 mr-2">
            <Filter className="h-3 w-3 mr-1" />
            筛选国家:
          </div>
          {SUPPORTED_COUNTRIES.map((country) => {
            const isSelected = selectedCountries.includes(country.code);
            return (
              <button
                key={country.code}
                onClick={() => toggleCountry(country.code)}
                className={`
                  px-3 py-1.5 rounded-full text-xs font-medium border transition-all duration-200 flex items-center gap-1.5
                  ${isSelected 
                    ? 'bg-slate-800 text-white border-slate-800 shadow-md transform scale-105' 
                    : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300 hover:bg-slate-50'}
                `}
              >
                <span>{country.flag}</span>
                {country.code}
              </button>
            );
          })}
        </div>
      </header>

      {/* --- 金十数据 Iframe 区域 --- */}
      {showJin10 && (
        <div className="border-b border-slate-200 bg-slate-100 relative">
          <button 
            onClick={() => setShowJin10(false)}
            className="absolute top-2 right-2 p-1 bg-white rounded-full shadow hover:bg-slate-100 z-10"
            title="关闭"
          >
            <X className="h-4 w-4 text-slate-500" />
          </button>
          <div className="w-full h-[600px] bg-white">
            <iframe 
              src="https://rili.jin10.com/" 
              className="w-full h-full border-none"
              title="金十数据财经日历"
              allow="clipboard-write"
            />
          </div>
          <div className="text-[10px] text-center text-slate-400 py-1">
            注：内容来源于金十数据第三方网页，如无法显示请检查网络或浏览器安全设置。
          </div>
        </div>
      )}

      {/* --- 表格主体 --- */}
      <div className="flex-1 p-6 max-w-5xl mx-auto w-full">
        {loading ? (
          <div className="flex flex-col items-center justify-center h-64 text-slate-400">
            <Loader2 className="h-8 w-8 animate-spin mb-2" />
            <p>正在加载数据...</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-200">
                <tr>
                  <th className="px-6 py-4 w-48 whitespace-nowrap">时间</th>
                  <th className="px-6 py-4">事件</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sortedFilteredEvents.length > 0 ? (
                  sortedFilteredEvents.map((event, idx) => (
                    <tr key={idx} className="hover:bg-slate-50 transition-colors group">
                      {/* 时间列 */}
                      <td className="px-6 py-4 text-slate-600 font-mono font-medium whitespace-nowrap">
                        {formatListDate(event.date)}
                      </td>
                      
                      {/* 事件列 */}
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          {/* 国家徽章 */}
                          <span className={`
                            px-2 py-0.5 rounded text-[11px] font-bold border uppercase shrink-0
                            ${getCountryColor(event.country)}
                          `}>
                            {event.country}
                          </span>
                          
                          {/* 事件名称 */}
                          <span className="text-slate-900 font-medium group-hover:text-blue-700 transition-colors">
                            {event.type}
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={2} className="px-6 py-16 text-center text-slate-400 bg-slate-50/50">
                      <div className="flex flex-col items-center">
                        <Filter className="h-8 w-8 mb-2 opacity-20" />
                        <p>该时段内无相关事件</p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        
        <div className="mt-6 text-xs text-slate-400 text-center">
           显示的均为当地时间或 UTC 时间，具体取决于数据源。
        </div>
      </div>
    </div>
  );
}