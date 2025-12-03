"use client";

import { useState, FormEvent, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { SignedIn, SignedOut, SignInButton, useUser } from '@clerk/nextjs';

// --- 翻译配置 ---
const translations = {
  zh: {
    title: '个股行情中心',
    searchPlaceholder: '输入代码 (如 AAPL, 0700.HK)...',
    searchBtn: '查询',
    searching: '加载中...',
    approxHKD: '约合 HKD',
    
    // 板块标题
    cardTrading: '交易概览',
    cardStats: '核心指标',
    cardProfile: '公司概况',
    cardFinancials: '财务健康',
    cardAnalysis: '机构评级',
    cardNews: '相关资讯',

    // 字段标签
    vol: '成交量',
    avgVol: '平均量',
    range52: '52周范围',
    mktCap: '总市值',
    pe: '市盈率 (TTM)',
    divYield: '股息率',
    beta: 'β系数',
    epsTitle: '每股收益 (EPS) 趋势',
    margins: '净利率',
    roe: 'ROE',
    growth: '营收增长',
    targetPrice: '目标价',
    analystCount: '位分析师',
    
    loginReq: '请先登录以查看深度数据',
    loginBtn: '登录 / 注册',
    errorFetch: '数据获取失败',
    errorUnknown: '未知错误'
  },
  en: {
    title: 'Stock Quote Center',
    searchPlaceholder: 'Enter Symbol (e.g. AAPL)...',
    searchBtn: 'Search',
    searching: 'Loading...',
    approxHKD: 'Approx. HKD',
    cardTrading: 'Trading Data',
    cardStats: 'Key Statistics',
    cardProfile: 'Company Profile',
    cardFinancials: 'Financial Health',
    cardAnalysis: 'Analyst Rating',
    cardNews: 'Latest News',
    vol: 'Vol',
    avgVol: 'Avg Vol',
    range52: '52W Range',
    mktCap: 'Market Cap',
    pe: 'PE (TTM)',
    divYield: 'Div Yield',
    beta: 'Beta',
    epsTitle: 'EPS Trend',
    margins: 'Margins',
    roe: 'ROE',
    growth: 'Rev Growth',
    targetPrice: 'Target Price',
    analystCount: 'Analysts',
    loginReq: 'Login required for deep data',
    loginBtn: 'Sign In / Register',
    errorFetch: 'Fetch failed',
    errorUnknown: 'Unknown error'
  }
};

type Language = 'zh' | 'en';

// --- 类型定义 ---
interface DashboardData {
  symbol: string;
  currency: string;
  price: number;
  priceInHKD: number;
  change: number;
  changePercent: number;
  trading: { high52: number; low52: number; volume: number; avgVolume: number; };
  stats: { marketCap: string; peRatio: number; dividendYield: number; beta: number; epsTrend: {date: string, actual: number}[] };
  profile: { sector: string; industry: string; summary: string; employees: number; website: string };
  financials: { profitMargins: number; roa: number; roe: number; revenueGrowth: number };
  analysis: { recommendation: string; targetPrice: number; numberOfAnalyst: number };
  news: { uuid: string; title: string; publisher: string; link: string; publishTime: number }[];
}

function MainContent() {
  const lang: Language = 'zh'; // 默认中文
  const t = translations[lang];
  const { user, isLoaded } = useUser();
  const searchParams = useSearchParams();

  const [inputSymbol, setInputSymbol] = useState('');
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // 监听 URL 参数自动查询
  useEffect(() => {
    const symbol = searchParams.get('symbol');
    if (symbol) {
      setInputSymbol(symbol.toUpperCase());
      fetchData(symbol);
    }
  }, [searchParams]);

  const fetchData = async (symbol: string) => {
    setLoading(true);
    setError('');
    setData(null);
    try {
      const res = await fetch(`/api/quote?symbol=${symbol}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || t.errorFetch);
      setData(json);
    } catch (err: any) {
      setError(err.message || t.errorUnknown);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (e: FormEvent) => {
    e.preventDefault();
    if (!inputSymbol.trim()) return;
    fetchData(inputSymbol);
  };

  // --- 辅助组件：进度条 ---
  const Range52Bar = ({ low, high, current }: { low: number, high: number, current: number }) => {
    // 计算当前价格在 52周范围内的百分比位置
    const percent = Math.min(Math.max(((current - low) / (high - low)) * 100, 0), 100);
    return (
      <div className="mt-2">
        <div className="flex justify-between text-xs text-gray-500 mb-1">
          <span>L: {low.toFixed(2)}</span>
          <span className="font-bold text-gray-700">当前</span>
          <span>H: {high.toFixed(2)}</span>
        </div>
        <div className="h-2 w-full bg-gray-200 rounded-full overflow-hidden relative">
          <div className="absolute h-full bg-blue-500 rounded-full" style={{ width: `${percent}%` }}></div>
        </div>
      </div>
    );
  };

  // --- 辅助组件：EPS 迷你柱状图 ---
  const EPSChart = ({ trend }: { trend: {date: string, actual: number}[] }) => {
    if (!trend || trend.length === 0) return <div className="text-xs text-gray-400 mt-2">暂无 EPS 数据</div>;
    const maxVal = Math.max(...trend.map(t => Math.abs(t.actual)));
    return (
      <div className="mt-3 flex items-end justify-between h-16 gap-1">
        {trend.slice(-4).map((item, i) => (
          <div key={i} className="flex flex-col items-center flex-1 group">
            <div 
              className={`w-full rounded-t ${item.actual >= 0 ? 'bg-blue-200 group-hover:bg-blue-300' : 'bg-red-200 group-hover:bg-red-300'}`}
              style={{ height: `${(Math.abs(item.actual) / maxVal) * 100}%` }}
            ></div>
            <span className="text-[10px] text-gray-400 mt-1 truncate w-full text-center">{item.date}</span>
          </div>
        ))}
      </div>
    );
  };

  // --- 辅助函数：格式化 ---
  const fmtNum = (n: number | null, decimals = 2) => n != null ? n.toFixed(decimals) : '--';
  const fmtPct = (n: number | null) => n != null ? `${n > 0 ? '+' : ''}${n.toFixed(2)}%` : '--';
  const fmtDate = (ts: number) => new Date(ts * 1000).toLocaleDateString();

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      {/* 顶部搜索栏 - 常驻 */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10 px-6 py-4 shadow-sm">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-800 hidden md:block">{t.title}</h1>
          <form onSubmit={handleSearch} className="flex w-full md:w-auto gap-2">
            <input 
              type="text" 
              value={inputSymbol} 
              onChange={(e) => setInputSymbol(e.target.value.toUpperCase())}
              placeholder={t.searchPlaceholder}
              className="border border-gray-300 rounded-lg px-4 py-2 text-sm w-full md:w-80 focus:border-blue-500 outline-none transition"
            />
            <button disabled={loading} className="bg-blue-600 text-white px-5 py-2 rounded-lg text-sm font-bold hover:bg-blue-700 transition disabled:opacity-50">
              {loading ? t.searching : t.searchBtn}
            </button>
          </form>
        </div>
      </div>

      {/* 内容区域 */}
      <div className="max-w-7xl mx-auto px-6 py-8">
        <SignedOut>
          <div className="flex flex-col items-center justify-center py-20 bg-white rounded-2xl shadow-sm">
            <p className="text-gray-500 mb-4">{t.loginReq}</p>
            <SignInButton mode="modal">
              <button className="bg-blue-600 text-white px-6 py-2 rounded-full font-bold">{t.loginBtn}</button>
            </SignInButton>
          </div>
        </SignedOut>

        <SignedIn>
          {error && <div className="bg-red-100 text-red-700 p-4 rounded-lg mb-6 border border-red-200">{error}</div>}
          
          {data && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-fade-in-up">
              
              {/* 板块 1: 交易数据 */}
              <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wide mb-4">{t.cardTrading}</h3>
                <div className="flex justify-between items-end mb-4">
                  <div>
                    <h2 className="text-3xl font-extrabold text-gray-900">{data.symbol}</h2>
                    <p className="text-xs text-gray-500">{data.currency}</p>
                  </div>
                  <div className={`text-right ${data.change >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    <div className="text-3xl font-bold">{fmtNum(data.price)}</div>
                    <div className="text-sm font-medium">{fmtNum(data.change)} ({fmtPct(data.changePercent)})</div>
                  </div>
                </div>
                {/* 52周进度条 */}
                <div className="mb-4">
                  <p className="text-xs font-bold text-gray-500 mb-1">{t.range52}</p>
                  <Range52Bar low={data.trading.low52} high={data.trading.high52} current={data.price} />
                </div>
                {/* 汇率与成交量 */}
                <div className="grid grid-cols-2 gap-4 mt-4 pt-4 border-t border-gray-100">
                  <div>
                    <p className="text-xs text-gray-400">{t.approxHKD}</p>
                    <p className="font-mono font-medium">{fmtNum(data.priceInHKD)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400">{t.vol} / {t.avgVol}</p>
                    <p className="font-mono text-xs">{(data.trading.volume / 1000000).toFixed(1)}M / {(data.trading.avgVolume / 1000000).toFixed(1)}M</p>
                  </div>
                </div>
              </div>

              {/* 板块 2: 核心基本面 */}
              <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wide mb-4">{t.cardStats}</h3>
                <div className="grid grid-cols-2 gap-y-4 gap-x-2 mb-4">
                  <div><p className="text-xs text-gray-400">{t.mktCap}</p><p className="font-bold">{data.stats.marketCap}</p></div>
                  <div><p className="text-xs text-gray-400">{t.pe}</p><p className="font-bold">{fmtNum(data.stats.peRatio)}</p></div>
                  <div><p className="text-xs text-gray-400">{t.divYield}</p><p className="font-bold">{fmtNum(data.stats.dividendYield)}%</p></div>
                  <div><p className="text-xs text-gray-400">{t.beta}</p><p className="font-bold">{fmtNum(data.stats.beta)}</p></div>
                </div>
                {/* EPS 趋势图 */}
                <div className="pt-2 border-t border-gray-100">
                  <p className="text-xs font-bold text-gray-500">{t.epsTitle}</p>
                  <EPSChart trend={data.stats.epsTrend} />
                </div>
              </div>

              {/* 板块 3: 公司概况 */}
              <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wide mb-4">{t.cardProfile}</h3>
                <div className="flex gap-2 mb-3 flex-wrap">
                  <span className="bg-blue-50 text-blue-700 px-2 py-1 rounded text-xs font-medium">{data.profile.sector}</span>
                  <span className="bg-gray-100 text-gray-600 px-2 py-1 rounded text-xs">{data.profile.industry}</span>
                </div>
                <p className="text-sm text-gray-600 leading-relaxed h-32 overflow-hidden relative">
                  {data.profile.summary}
                  <div className="absolute bottom-0 w-full h-8 bg-gradient-to-t from-white to-transparent"></div>
                </p>
                <div className="mt-3 text-xs text-gray-400 flex justify-between items-center">
                  <span>{data.profile.employees?.toLocaleString()} 员工</span>
                  {data.profile.website && (
                    <a href={data.profile.website} target="_blank" className="text-blue-500 hover:underline">官网 ↗</a>
                  )}
                </div>
              </div>

              {/* 板块 4: 财务健康 */}
              <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wide mb-4">{t.cardFinancials}</h3>
                <div className="space-y-4">
                  {[
                    { label: t.margins, val: data.financials.profitMargins, color: 'blue' },
                    { label: t.roe, val: data.financials.roe, color: 'purple' },
                    { label: t.roa, val: data.financials.roa, color: 'indigo' },
                    { label: t.growth, val: data.financials.revenueGrowth, color: 'green' },
                  ].map((item, i) => (
                    <div key={i}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-gray-600">{item.label}</span>
                        <span className="font-bold">{fmtPct(item.val)}</span>
                      </div>
                      <div className="h-1.5 w-full bg-gray-100 rounded-full overflow-hidden">
                        <div 
                          className={`h-full bg-${item.color}-500 rounded-full`} 
                          style={{ width: `${Math.min(Math.max(item.val || 0, 0), 100)}%` }}
                        ></div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* 板块 5: 机构评级 */}
              <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wide mb-4">{t.cardAnalysis}</h3>
                <div className="flex flex-col items-center justify-center h-40">
                  <div className="text-center mb-4">
                    <span className={`text-xl font-bold px-4 py-2 rounded-lg uppercase ${
                      data.analysis.recommendation.includes('buy') ? 'bg-green-100 text-green-800' : 
                      data.analysis.recommendation.includes('sell') ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800'
                    }`}>
                      {data.analysis.recommendation.replace('_', ' ')}
                    </span>
                    <p className="text-xs text-gray-400 mt-2">{data.analysis.numberOfAnalyst} {t.analystCount}</p>
                  </div>
                  <div className="w-full flex justify-between items-center bg-gray-50 p-3 rounded-lg">
                    <span className="text-sm text-gray-500">{t.targetPrice}</span>
                    <span className="text-lg font-bold text-gray-900">{fmtNum(data.analysis.targetPrice)}</span>
                  </div>
                </div>
              </div>

              {/* 板块 6: 资讯流 */}
              <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex flex-col h-[300px]">
                <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wide mb-4">{t.cardNews}</h3>
                <div className="flex-1 overflow-y-auto pr-2 space-y-4 custom-scrollbar">
                  {data.news.map((item) => (
                    <a key={item.uuid} href={item.link} target="_blank" className="block group">
                      <h4 className="text-sm font-medium text-gray-800 group-hover:text-blue-600 leading-snug mb-1">{item.title}</h4>
                      <div className="flex justify-between text-[10px] text-gray-400">
                        <span>{item.publisher}</span>
                        <span>{fmtDate(item.publishTime)}</span>
                      </div>
                    </a>
                  ))}
                  {data.news.length === 0 && <p className="text-sm text-gray-400 text-center mt-10">暂无相关新闻</p>}
                </div>
              </div>

            </div>
          )}
        </SignedIn>
      </div>
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