"use client";

import { useState, useEffect, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { SignedIn, SignedOut, SignInButton, useUser } from '@clerk/nextjs';

// --- 类型定义 ---
interface DashboardData {
  symbol: string;
  name: string; 
  currency: string;
  price: number;
  priceInHKD: number;
  change: number;
  changePercent: number;
  history?: any[]; // 历史数据
  trading: { high52: number; low52: number; volume: number; avgVolume: number; };
  stats: { marketCap: string; peRatio: number | null; dividendYield: number; beta: number | null; epsTrend: any[] };
  profile: { sector: string; industry: string; summary: string; employees: number; website: string };
  financials: { profitMargins: number; roa: number; roe: number; revenueGrowth: string };
  analysis: { recommendation: string | number; targetPrice: number | null; numberOfAnalyst: number };
  news: { uuid: string; title: string; publisher: string; link: string; publishTime: number }[];
}

interface SearchResult {
  symbol: string;
  name: string;
  exchange: string;
  type: string;
}

// --- 组件：图表 ---
const StockChart = ({ data, range, onChangeRange }: { data: any[], range: string, onChangeRange: (r: string) => void }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoverData, setHoverData] = useState<any>(null);

  if (!data || data.length === 0) return (
    <div className="h-72 flex flex-col items-center justify-center text-gray-400 bg-gray-50 rounded-xl border border-dashed border-gray-200">
      <span className="text-2xl mb-2">📊</span>
      <span>暂无图表数据</span>
    </div>
  );

  const isCandle = ['1mo', '6mo', '1y', '2y'].includes(range); 
  
  const minPrice = Math.min(...data.map(d => isCandle ? d.low : d.close));
  const maxPrice = Math.max(...data.map(d => isCandle ? d.high : d.close));
  const priceRange = maxPrice - minPrice;
  const padding = priceRange * 0.1;
  const yMin = minPrice - padding;
  const yMax = maxPrice + padding;
  const yRange = yMax - yMin;

  const width = 800;
  const height = 300;
  const candleWidth = Math.max(1, (width / data.length) * 0.6);

  const linePoints = data.map((d, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((d.close - yMin) / yRange) * height;
    return `${x},${y}`;
  }).join(' ');

  return (
    <div className="w-full">
      <div className="flex justify-between items-center mb-4">
        <div className="flex bg-gray-100 p-1 rounded-lg">
          {['1d', '5d', '1mo', '6mo', '1y', '2y'].map(r => (
            <button
              key={r}
              onClick={() => onChangeRange(r)}
              className={`px-3 py-1 text-xs font-bold rounded-md transition-all ${
                range === r 
                  ? 'bg-white text-blue-600 shadow-sm' 
                  : 'text-gray-500 hover:text-gray-900'
              }`}
            >
              {r.toUpperCase()}
            </button>
          ))}
        </div>
        
        <div className="h-4">
          {hoverData && (
            <div className="flex gap-4 text-xs font-mono text-gray-600">
              <span className="font-bold">{new Date(hoverData.time).toLocaleDateString()}</span>
              <span>O: {hoverData.open?.toFixed(2)}</span>
              <span>H: {hoverData.high?.toFixed(2)}</span>
              <span>L: {hoverData.low?.toFixed(2)}</span>
              <span className={hoverData.close >= hoverData.open ? 'text-green-600 font-bold' : 'text-red-600 font-bold'}>
                C: {hoverData.close?.toFixed(2)}
              </span>
            </div>
          )}
        </div>
      </div>

      <div 
        ref={containerRef}
        className="relative w-full h-72 bg-white border border-gray-100 rounded-xl overflow-hidden cursor-crosshair touch-none"
        onMouseLeave={() => setHoverData(null)}
        onMouseMove={(e) => {
          if (!containerRef.current) return;
          const rect = containerRef.current.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const index = Math.max(0, Math.min(data.length - 1, Math.floor((x / rect.width) * data.length)));
          setHoverData(data[index]);
        }}
      >
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full" preserveAspectRatio="none">
          {[0.2, 0.4, 0.6, 0.8].map(p => (
            <line key={p} x1="0" y1={height * p} x2={width} y2={height * p} stroke="#f3f4f6" strokeWidth="1" strokeDasharray="4 4" />
          ))}

          {isCandle ? (
            data.map((d, i) => {
              const x = (i / data.length) * width;
              const xCenter = x + (width / data.length) / 2;
              
              const yOpen = height - ((d.open - yMin) / yRange) * height;
              const yClose = height - ((d.close - yMin) / yRange) * height;
              const yHigh = height - ((d.high - yMin) / yRange) * height;
              const yLow = height - ((d.low - yMin) / yRange) * height;
              
              const isUp = d.close >= d.open;
              const color = isUp ? '#10b981' : '#ef4444';

              return (
                <g key={i}>
                  <line x1={xCenter} y1={yHigh} x2={xCenter} y2={yLow} stroke={color} strokeWidth="1" />
                  <rect 
                    x={xCenter - candleWidth/2} 
                    y={Math.min(yOpen, yClose)} 
                    width={candleWidth} 
                    height={Math.max(1, Math.abs(yOpen - yClose))} 
                    fill={color} 
                  />
                </g>
              );
            })
          ) : (
            <>
              <defs>
                <linearGradient id="areaGradient" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.3" />
                  <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path 
                d={`M0,${height} ${linePoints} ${width},${height} Z`} 
                fill="url(#areaGradient)" 
              />
              <polyline 
                points={linePoints} 
                fill="none" 
                stroke="#2563eb" 
                strokeWidth="2" 
                strokeLinecap="round" 
                strokeLinejoin="round" 
              />
            </>
          )}

          {hoverData && (() => {
             const index = data.indexOf(hoverData);
             const x = ((index + 0.5) / data.length) * width;
             return (
               <line x1={x} y1="0" x2={x} y2={height} stroke="#94a3b8" strokeWidth="1" strokeDasharray="5 5" />
             );
          })()}
        </svg>

        <div className="absolute right-0 top-0 h-full flex flex-col justify-between text-[10px] text-gray-400 p-1 pointer-events-none select-none">
           <span>{yMax.toFixed(2)}</span>
           <span>{yMin.toFixed(2)}</span>
        </div>
      </div>
    </div>
  );
};

// --- 组件：核心指标 ---
const KeyStatsSection = ({ data }: { data: DashboardData }) => {
    const trend = data.stats?.epsTrend || [];
    let maxVal = 0;
    let minVal = 0;
    
    // 辅助函数
    const fmtNum = (n: any, decimals = 2) => {
        if (typeof n === 'number') return n.toFixed(decimals);
        const num = parseFloat(n);
        if (!isNaN(num)) return num.toFixed(decimals);
        return '--';
    };

    trend.forEach(item => {
        const est = Number(item.estimate || 0);
        const act = item.actual !== null ? Number(item.actual) : null;
        maxVal = Math.max(maxVal, est);
        minVal = Math.min(minVal, est);
        if (act !== null && act !== 0) {
            maxVal = Math.max(maxVal, act);
            minVal = Math.min(minVal, act);
        }
    });

    const rangeBuffer = (maxVal - minVal) * 0.15 || 0.1;
    maxVal += rangeBuffer;
    if (minVal < 0) minVal -= rangeBuffer;
    if (minVal > 0) minVal = 0;
    const totalRange = maxVal - minVal;
    const safeRange = totalRange === 0 ? 1 : totalRange;
    let zeroLinePct = 100; 
    if (totalRange > 0) {
        zeroLinePct = (maxVal / safeRange) * 100;
    }
    zeroLinePct = Math.min(Math.max(zeroLinePct, 0), 100);

    return (
      <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition">
        <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-6">核心指标</h3>
        <div className="flex flex-wrap gap-8 mb-8 border-b border-gray-50 pb-6">
            <div><p className="text-xs text-gray-500 mb-1">总市值</p><p className="text-xl font-bold text-gray-900">{data.stats?.marketCap || '--'}</p></div>
            <div><p className="text-xs text-gray-500 mb-1">市盈率</p><p className="text-xl font-bold text-gray-900">{fmtNum(data.stats?.peRatio)}</p></div>
            <div><p className="text-xs text-gray-500 mb-1">股息率</p><p className="text-xl font-bold text-gray-900">{fmtNum(data.stats?.dividendYield)}%</p></div>
            <div><p className="text-xs text-gray-500 mb-1">Beta</p><p className="text-xl font-bold text-gray-900">{fmtNum(data.stats?.beta)}</p></div>
        </div>
        <div className="mb-6">
            <div className="flex justify-between items-center mb-4">
                <h4 className="font-bold text-gray-800 text-sm">每股收益 (EPS) 表现</h4>
                <div className="flex gap-4 text-xs">
                    <div className="flex items-center gap-1.5"><span className="w-3 h-3 bg-blue-500 rounded-sm"></span><span className="text-gray-500">实际值</span></div>
                    <div className="flex items-center gap-1.5"><span className="w-3 h-3 bg-gray-200 rounded-sm"></span><span className="text-gray-500">预测值</span></div>
                </div>
            </div>
            <div className="relative h-48 w-full border-b border-gray-200">
                <div className="absolute left-0 w-full border-t border-gray-300 z-0" style={{ top: `${zeroLinePct}%` }} ></div>
                <div className="flex h-full items-end justify-between px-2 md:px-6 relative z-10">
                    {trend.map((item, i) => {
                        const actual = item.actual !== null ? Number(item.actual) : null;
                        const estimate = Number(item.estimate || 0);
                        const getBarStyle = (val: number) => {
                            const heightPct = (Math.abs(val) / safeRange) * 100;
                            const isPositive = val >= 0;
                            if (isPositive) return { height: `${heightPct}%`, bottom: `${100 - zeroLinePct}%` };
                            return { height: `${heightPct}%`, top: `${zeroLinePct}%` };
                        };
                        return (
                            <div key={i} className="flex flex-col items-center flex-1 group relative h-full">
                                <div className="absolute w-full h-full left-0 top-0 pointer-events-none">
                                    <div className="w-full h-full relative flex justify-center gap-1 md:gap-2">
                                        {actual !== null && actual !== 0 && (
                                            <div className="w-2 md:w-4 bg-blue-500 rounded-t-sm transition-all absolute pointer-events-auto hover:opacity-80" style={{ ...getBarStyle(actual), left: '50%', transform: 'translateX(-110%)' }}></div>
                                        )}
                                        <div className="w-2 md:w-4 bg-gray-200 rounded-t-sm transition-all absolute pointer-events-auto hover:opacity-80" style={{ ...getBarStyle(estimate), left: '50%', transform: 'translateX(10%)' }}></div>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
        <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
                <thead><tr className="text-gray-400 text-xs border-b border-gray-100"><th className="py-2 font-medium">日期</th><th className="py-2 font-medium text-right">预测</th><th className="py-2 font-medium text-right">实际</th><th className="py-2 font-medium text-right">差异 (Surprise)</th></tr></thead>
                <tbody className="text-gray-700">
                    {trend.map((item, i) => {
                        const actual = item.actual !== null ? Number(item.actual) : null;
                        const estimate = Number(item.estimate || 0);
                        let surprise = null;
                        let surprisePct = null;
                        const showActual = actual !== null && actual !== 0;
                        if (showActual) {
                            surprise = actual - estimate;
                            surprisePct = Math.abs(estimate) > 0 ? (surprise / Math.abs(estimate)) * 100 : 0;
                        }
                        return (
                            <tr key={i} className="border-b border-gray-50 last:border-0 hover:bg-gray-50 transition-colors">
                                <td className="py-3 font-medium text-gray-900">{item.date}</td>
                                <td className="py-3 text-right font-mono text-gray-500">{estimate.toFixed(2)}</td>
                                <td className="py-3 text-right font-mono font-bold text-gray-900">{showActual ? actual!.toFixed(2) : '-'}</td>
                                <td className="py-3 text-right font-mono">
                                    {showActual ? (<span className={surprise && surprise >= 0 ? 'text-green-600' : 'text-red-500'}>{surprise && surprise > 0 ? '+' : ''}{surprise?.toFixed(2)} <span className="text-[10px] ml-1 opacity-80">({surprisePct?.toFixed(1)}%)</span></span>) : (<span className="text-gray-300">-</span>)}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
      </div>
    );
};

// --- 主页面逻辑 ---
function MainContent() {
  const { user, isLoaded } = useUser();
  const searchParams = useSearchParams();

  const [inputSymbol, setInputSymbol] = useState('');
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  // 图表范围状态
  const [chartRange, setChartRange] = useState('1y');

  // 搜索建议状态
  const [suggestions, setSuggestions] = useState<SearchResult[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const searchContainerRef = useRef<HTMLFormElement>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const symbol = searchParams.get('symbol');
    if (symbol) {
      setInputSymbol(symbol.toUpperCase());
      fetchData(symbol, '1y'); // 默认加载1年数据
    }
  }, [searchParams]);

  // 点击外部关闭下拉菜单
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const fetchData = async (symbol: string, range: string) => {
    setLoading(true);
    setError('');
    
    try {
      const res = await fetch(`/api/quote?symbol=${encodeURIComponent(symbol)}&range=${range}`);
      const contentType = res.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        throw new Error('网络响应异常');
      }
      const json = await res.json();
      if (!res.ok) {
        if (res.status === 404) throw new Error('未找到该股票/指数');
        throw new Error(json.error || '查询出错');
      }
      setData(json);
    } catch (err: any) {
      console.error("Fetch Error:", err);
      setError(err.message || '发生未知错误');
    } finally {
      setLoading(false);
    }
  };

  const handleRangeChange = (newRange: string) => {
    setChartRange(newRange);
    if (data?.symbol) {
      fetchData(data.symbol, newRange);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInputSymbol(val);

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
        console.error("Search suggestion error", e);
      }
    }, 300); 
  };

  const handleSelectSuggestion = (symbol: string) => {
    setInputSymbol(symbol);
    fetchData(symbol, chartRange);
    setShowSuggestions(false);
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputSymbol.trim()) return;
    fetchData(inputSymbol, chartRange);
    setShowSuggestions(false);
  };

  const fmtNum = (n: any, decimals = 2) => {
    if (typeof n === 'number') return n.toFixed(decimals);
    const num = parseFloat(n);
    if (!isNaN(num)) return num.toFixed(decimals);
    return '--';
  };

  const fmtPct = (n: any) => {
    if (typeof n === 'number') return `${n > 0 ? '+' : ''}${n.toFixed(2)}%`;
    const num = parseFloat(n);
    if (!isNaN(num)) return `${num > 0 ? '+' : ''}${num.toFixed(2)}%`;
    return '--';
  };

  const fmtDate = (ts: number) => new Date(ts * 1000).toLocaleDateString('zh-CN');

  const RangeBar = ({ low, high, current }: { low: number, high: number, current: number }) => {
    if (typeof low !== 'number' || typeof high !== 'number' || typeof current !== 'number') return null;
    if (high === low || high === 0) return <div className="mt-2 h-1.5 bg-gray-100 rounded-full"></div>;
    const percent = Math.min(Math.max(((current - low) / (high - low)) * 100, 0), 100);
    return (
      <div className="mt-1">
        <div className="flex justify-between text-[10px] text-gray-400">
          <span>{low.toFixed(2)}</span>
          <span>{high.toFixed(2)}</span>
        </div>
        <div className="h-1.5 w-full bg-gray-100 rounded-full overflow-hidden relative mt-0.5">
          <div className="absolute h-full bg-blue-600 rounded-full" style={{ width: `${percent}%` }}></div>
        </div>
      </div>
    );
  };

  const getRatingString = (rec: any) => {
    if (!rec) return 'N/A';
    return String(rec);
  };

  return (
    <div className="w-full max-w-7xl mx-auto p-6 animate-fade-in pt-24">
      {/* 搜索栏 */}
      <div className="flex flex-col md:flex-row justify-between items-start mb-8 gap-4">
        <h1 className="text-2xl font-bold text-gray-900 mt-2">个股行情中心</h1>
        <form ref={searchContainerRef} onSubmit={handleSearchSubmit} className="relative w-full md:w-96 z-20">
          <input 
            type="text" value={inputSymbol} onChange={handleInputChange} onFocus={() => { if (suggestions.length > 0) setShowSuggestions(true); }}
            placeholder="输入代码 (如 AAPL, ^HSI)..."
            className="w-full bg-white border border-gray-300 text-gray-900 text-sm rounded-full focus:ring-blue-500 block pl-5 p-3 shadow-sm outline-none"
            autoComplete="off"
          />
          <button type="submit" disabled={loading} className="absolute right-2 top-1.5 bg-blue-600 text-white px-4 py-1.5 rounded-full text-xs font-bold hover:bg-blue-700 disabled:bg-gray-400 transition">
            {loading ? '...' : '查询'}
          </button>
          {showSuggestions && suggestions.length > 0 && (
            <div className="absolute top-full left-0 w-full bg-white mt-1 rounded-xl shadow-xl border border-gray-100 max-h-80 overflow-y-auto z-30">
              {suggestions.map((item) => (
                <div key={item.symbol} onClick={() => handleSelectSuggestion(item.symbol)} className="px-4 py-3 hover:bg-gray-50 cursor-pointer border-b last:border-0 flex justify-between">
                  <div><div className="font-bold">{item.symbol}</div><div className="text-xs text-gray-500">{item.name}</div></div>
                  <span className="text-xs bg-gray-100 px-2 py-1 rounded">{item.exchange}</span>
                </div>
              ))}
            </div>
          )}
        </form>
      </div>

      <SignedOut>
        <div className="text-center py-20 bg-white rounded-2xl border border-gray-100 shadow-sm">
          <h2 className="text-xl font-bold text-gray-800 mb-2">请先登录以查看深度数据</h2>
          <SignInButton mode="modal"><button className="bg-black text-white px-8 py-3 rounded-full font-bold hover:bg-gray-800 transition">登录 / 注册</button></SignInButton>
        </div>
      </SignedOut>

      <SignedIn>
        {!user?.publicMetadata?.approved && isLoaded ? (
           <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-6 text-center">
             <p className="text-yellow-800 font-bold">⏳ 账号审核中</p>
             <p className="text-yellow-600 text-sm mt-1">为了保证服务质量，新注册用户需要等待管理员审核。<br/>请联系管理员进行开通，或耐心等待。</p>
           </div>
        ) : (
          <>
            {error && <div className="bg-red-50 border border-red-100 text-red-600 p-4 rounded-xl mb-6 text-sm font-medium flex items-center gap-2"><svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" /></svg>{error}</div>}

            {data && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                
                {/* 1. 概览 & 图表 */}
                <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition">
                  <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4">概览</h3>
                  <div className="flex justify-between items-end mb-4">
                    <div>
                      <div className="text-3xl font-black text-gray-900">{data.symbol}</div>
                      <div className="text-sm font-bold text-gray-600 mt-1 leading-tight">{data.name}</div>
                      <div className="text-xs text-gray-500 font-medium mt-1">{data.currency}</div>
                    </div>
                    <div className={`text-right ${data.change >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      <div className="text-3xl font-bold">{fmtNum(data.price)}</div>
                      <div className="text-sm font-bold">{fmtNum(data.change)} ({fmtPct(data.changePercent)})</div>
                    </div>
                  </div>
                  <div className="pt-4 border-t border-gray-50">
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-gray-500">52周范围</span>
                    </div>
                    <RangeBar low={data.trading?.low52 || 0} high={data.trading?.high52 || 0} current={data.price || 0} />
                    <div className="mt-4 flex justify-between text-xs">
                      <span className="text-gray-400">约合 HKD</span>
                      <span className="font-mono font-medium text-gray-700">{fmtNum(data.priceInHKD)}</span>
                    </div>
                  </div>
                  
                  {/* ★ 新增：图表组件 ★ */}
                  <div className="mt-6 pt-4 border-t border-gray-50">
                     <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4">价格走势</h4>
                     <StockChart data={data.history || []} range={chartRange} onChangeRange={handleRangeChange} />
                  </div>
                </div>

                {/* 2. 核心指标 */}
                <KeyStatsSection data={data} />

                {/* 3. 公司概况 */}
                <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition">
                  <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4">公司概况</h3>
                  <div className="space-y-4">
                    <div className="flex gap-2 flex-wrap">
                      <span className="bg-blue-50 text-blue-700 px-2 py-1 rounded text-xs font-bold">{data.profile?.sector || 'N/A'}</span>
                      <span className="bg-gray-50 text-gray-600 px-2 py-1 rounded text-xs font-medium">{data.profile?.industry || 'N/A'}</span>
                    </div>
                    <p className="text-sm text-gray-600 leading-relaxed line-clamp-4 text-justify">
                      {data.profile?.summary || '暂无描述'}
                    </p>
                    {data.profile?.website && (
                      <a href={data.profile.website} target="_blank" className="text-xs font-bold text-blue-600 hover:text-blue-800 flex items-center gap-1 mt-2">
                        访问官网 ↗
                      </a>
                    )}
                  </div>
                </div>

                {/* 4. 财务健康 */}
                <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition">
                  <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4">财务健康</h3>
                  <div className="grid grid-cols-1 gap-4">
                    {[
                      { label: '净利率', val: data.financials?.profitMargins, color: 'blue' },
                      { label: 'ROE', val: data.financials?.roe, color: 'purple' },
                      { label: 'ROA', val: data.financials?.roa, color: 'indigo' },
                    ].map((item, i) => (
                      <div key={i}>
                        <div className="flex justify-between text-sm mb-1">
                          <span className="text-gray-600">{item.label}</span>
                          <span className="font-bold">{fmtPct(item.val)}</span>
                        </div>
                        <div className="h-1.5 w-full bg-gray-100 rounded-full overflow-hidden">
                          <div className={`h-full bg-${item.color}-500 rounded-full`} style={{ width: `${Math.min(Math.max(item.val || 0, 0), 100)}%` }}></div>
                        </div>
                      </div>
                    ))}
                    <div className="flex justify-between items-center pt-2 border-t border-gray-50">
                        <span className="text-sm text-gray-600">年营收 (TTM)</span>
                        <span className="font-bold text-gray-900">{data.financials?.revenueGrowth || '--'}</span>
                    </div>
                  </div>
                </div>

                {/* 5. 机构评级 */}
                <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition">
                  <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4">机构评级</h3>
                  <div className="flex flex-col items-center justify-center h-40">
                    <div className="text-center mb-6">
                        <span className={`text-2xl font-black px-4 py-2 rounded-lg uppercase ${
                            getRatingString(data.analysis?.recommendation).toLowerCase().includes('buy') ? 'text-green-600 bg-green-50' : 
                            getRatingString(data.analysis?.recommendation).toLowerCase().includes('sell') ? 'text-red-600 bg-red-50' : 'text-gray-600 bg-gray-50'
                        }`}>
                            {data.analysis?.recommendation || 'N/A'}
                        </span>
                        <p className="text-xs text-gray-400 mt-2">综合评级</p>
                    </div>
                    <div className="w-full flex justify-between items-center bg-gray-50 p-4 rounded-xl">
                        <span className="text-sm text-gray-500 font-medium">目标价</span>
                        <span className="text-xl font-bold text-gray-900">{fmtNum(data.analysis?.targetPrice)}</span>
                    </div>
                  </div>
                </div>

                {/* 6. 最新资讯 */}
                <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition flex flex-col h-[320px]">
                  <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4">市场消息</h3>
                  <div className="flex-1 overflow-y-auto space-y-4 pr-1 custom-scrollbar">
                    {data.news?.map((item) => (
                      <a key={item.uuid} href={item.link} target="_blank" className="block group">
                        <h4 className="text-sm font-bold text-gray-800 group-hover:text-blue-600 leading-snug mb-1 transition line-clamp-2">{item.title}</h4>
                        <div className="flex justify-between text-[10px] text-gray-400 font-medium">
                          <span>{item.publisher}</span>
                          <span>{fmtDate(item.publishTime)}</span>
                        </div>
                      </a>
                    ))}
                    {(!data.news || data.news.length === 0) && <p className="text-sm text-gray-400 text-center mt-10">暂无相关新闻</p>}
                  </div>
                </div>

              </div>
            )}
          </>
        )}
      </SignedIn>
    </div>
  );
}

export default function QuotePage() {
  return (
    <Suspense fallback={<div className="p-10 text-center">Loading...</div>}>
      <MainContent />
    </Suspense>
  );
}