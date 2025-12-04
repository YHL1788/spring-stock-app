"use client";

import { useState, FormEvent, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { SignedIn, SignedOut, SignInButton, useUser } from '@clerk/nextjs';

const translations = {
  zh: {
    title: '个股行情中心',
    placeholder: '代码 (如 7203.T, 0700.HK, AAPL)',
    search: '查询',
    searching: '加载中...',
    newsTitle: '相关资讯',
    approxHKD: '约合 HKD',
    subWelcome: '专业的全球股市分析工具',
    login: '立即登录 / 注册',
    pendingTitle: '账号审核中',
    pendingDesc: '为了保证服务质量，新注册用户需要等待管理员审核。',
    pendingAction: '请联系管理员进行开通，或耐心等待。',
    errorFetch: '查询出错，请检查代码',
    errorUnknown: '发生未知错误',
    dateFormat: 'zh-CN',
    
    // 板块
    cardTrading: '交易概览',
    cardStats: '核心指标',
    cardProfile: '公司概况',
    cardFinancials: '财务健康',
    cardAnalysis: '机构评级',
    cardNews: '市场消息',
    
    // 字段
    range52: '52周范围',
    mktCap: '总市值',
    pe: '市盈率',
    divYield: '股息率',
    beta: 'Beta',
    epsTitle: 'EPS 业绩趋势 (实际 vs 预测)',
    margins: '净利率',
    roe: 'ROE',
    roa: 'ROA',
    revenue: '年营收 (TTM)',
    targetPrice: '目标价',
    rating: '综合评级',
    
    loginReq: '请先登录以查看深度数据',
    loginBtn: '登录 / 注册'
  },
  en: {
    title: 'Stock Quote Center',
    placeholder: 'Symbol (e.g. 7203.T, 0700.HK, AAPL)',
    search: 'Search',
    searching: 'Loading...',
    newsTitle: 'Latest News',
    approxHKD: 'Approx. HKD',
    subWelcome: 'Professional Global Market Analysis',
    login: 'Sign In / Register',
    pendingTitle: 'Account Under Review',
    pendingDesc: 'New accounts require admin approval.',
    pendingAction: 'Please contact admin or wait for approval.',
    errorFetch: 'Search failed, check symbol',
    errorUnknown: 'Unknown error',
    dateFormat: 'en-US',
    cardTrading: 'Trading Data',
    cardStats: 'Key Statistics',
    cardProfile: 'Company Profile',
    cardFinancials: 'Financial Health',
    cardAnalysis: 'Analyst Rating',
    cardNews: 'Market News',
    range52: '52W Range',
    mktCap: 'Market Cap',
    pe: 'PE Ratio',
    divYield: 'Div Yield',
    beta: 'Beta',
    epsTitle: 'EPS Trend (Actual vs Est)',
    margins: 'Net Margin',
    roe: 'ROE',
    roa: 'ROA',
    revenue: 'Revenue (TTM)',
    targetPrice: 'Target Price',
    rating: 'Consensus Rating',
    loginReq: 'Login required for deep data',
    loginBtn: 'Sign In / Register'
  }
};

type Language = 'zh' | 'en';

interface DashboardData {
  symbol: string;
  currency: string;
  price: number;
  priceInHKD: number;
  change: number;
  changePercent: number;
  trading: { high52: number; low52: number; volume: number; avgVolume: number; };
  stats: { marketCap: string; peRatio: number | null; dividendYield: number; beta: number | null; epsTrend: any[] };
  profile: { sector: string; industry: string; summary: string; employees: number; website: string };
  financials: { profitMargins: number; roa: number; roe: number; revenueGrowth: string }; // 注意 revenueGrowth 这里改成了 string 用于展示营收额
  analysis: { recommendation: string; targetPrice: number | null; numberOfAnalyst: number };
  news: { uuid: string; title: string; publisher: string; link: string; publishTime: number }[];
}

function MainContent() {
  const lang: Language = 'zh'; 
  const t = translations[lang];
  const { user, isLoaded } = useUser();
  const searchParams = useSearchParams();

  const [inputSymbol, setInputSymbol] = useState('');
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

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

  const fmtNum = (n: number | null) => n != null ? n.toFixed(2) : '--';
  const fmtPct = (n: number | null) => n != null ? `${n > 0 ? '+' : ''}${n.toFixed(2)}%` : '--';
  const fmtDate = (ts: number) => new Date(ts * 1000).toLocaleDateString();

  const RangeBar = ({ low, high, current }: { low: number, high: number, current: number }) => {
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

  // EPS 柱状图组件
  const EPSChart = ({ trend }: { trend: any[] }) => {
    if (!trend || trend.length === 0) return <div className="text-xs text-gray-400 mt-2">暂无 EPS 数据</div>;
    return (
      <div className="mt-3 flex justify-between h-12 items-end gap-1">
        {trend.map((item, i) => (
          <div key={i} className="flex flex-col items-center flex-1">
            {/* 简易柱状图：实际值 vs 预测值，这里只画实际值示意，实际项目可用 Recharts */}
            <div 
               className={`w-4 rounded-t ${item.actual > item.estimate ? 'bg-green-400' : 'bg-yellow-400'}`}
               style={{ height: '70%' }} 
               title={`Actual: ${item.actual}, Est: ${item.estimate}`}
            ></div>
            <span className="text-[9px] text-gray-400 mt-1">{item.date}</span>
          </div>
        ))}
      </div>
    );
  };

  const isApproved = user?.publicMetadata?.approved === true;

  return (
    <div className="w-full max-w-7xl mx-auto p-6 animate-fade-in">
      {/* 搜索栏 */}
      <div className="flex flex-col md:flex-row justify-between items-center mb-8 gap-4">
        <h1 className="text-2xl font-bold text-gray-900">{t.title}</h1>
        <form onSubmit={handleSearch} className="relative w-full md:w-96">
          <input 
            type="text" 
            value={inputSymbol}
            onChange={(e) => setInputSymbol(e.target.value.toUpperCase())}
            placeholder={t.placeholder}
            className="w-full bg-white border border-gray-300 text-gray-900 text-sm rounded-full focus:ring-blue-500 focus:border-blue-500 block pl-5 p-3 shadow-sm outline-none"
          />
          <button type="submit" disabled={loading} className="absolute right-2 top-1.5 bg-blue-600 text-white px-4 py-1.5 rounded-full text-xs font-bold hover:bg-blue-700 disabled:bg-gray-400 transition">
            {loading ? '...' : t.search}
          </button>
        </form>
      </div>

      <SignedOut>
        <div className="text-center py-20 bg-white rounded-2xl border border-gray-100 shadow-sm">
          <h2 className="text-xl font-bold text-gray-800 mb-2">{t.loginReq}</h2>
          <SignInButton mode="modal">
            <button className="bg-black text-white px-8 py-3 rounded-full font-bold hover:bg-gray-800 transition">{t.loginBtn}</button>
          </SignInButton>
        </div>
      </SignedOut>

      <SignedIn>
        {!isApproved && isLoaded ? (
           <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-6 text-center">
             <p className="text-yellow-800 font-bold">⏳ {t.pendingTitle}</p>
             <p className="text-yellow-600 text-sm mt-1">{t.pendingAction}</p>
           </div>
        ) : (
          <>
            {error && <div className="bg-red-50 text-red-600 p-4 rounded-xl mb-6 text-sm">{error}</div>}

            {data && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                
                {/* 1. 交易概览 */}
                <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition">
                  <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4">{t.cardTrading}</h3>
                  <div className="flex justify-between items-end mb-4">
                    <div>
                      <div className="text-3xl font-black text-gray-900">{data.symbol}</div>
                      <div className="text-xs text-gray-500 font-medium">{data.currency}</div>
                    </div>
                    <div className={`text-right ${data.change >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      <div className="text-3xl font-bold">{fmtNum(data.price)}</div>
                      <div className="text-sm font-bold">{fmtNum(data.change)} ({fmtPct(data.changePercent)})</div>
                    </div>
                  </div>
                  <div className="pt-4 border-t border-gray-50">
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-gray-500">{t.range52}</span>
                    </div>
                    <RangeBar low={data.trading.low52} high={data.trading.high52} current={data.price} />
                    <div className="mt-4 flex justify-between text-xs">
                      <span className="text-gray-400">{t.approxHKD}</span>
                      <span className="font-mono font-medium text-gray-700">{fmtNum(data.priceInHKD)}</span>
                    </div>
                  </div>
                </div>

                {/* 2. 核心指标 */}
                <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition">
                  <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4">{t.cardStats}</h3>
                  <div className="grid grid-cols-2 gap-y-6 gap-x-4">
                    <div><p className="text-[10px] text-gray-400 uppercase">{t.mktCap}</p><p className="font-bold text-lg text-gray-800">{data.stats.marketCap}</p></div>
                    <div><p className="text-[10px] text-gray-400 uppercase">{t.pe}</p><p className="font-bold text-lg text-gray-800">{fmtNum(data.stats.peRatio)}</p></div>
                    <div><p className="text-[10px] text-gray-400 uppercase">{t.divYield}</p><p className="font-bold text-lg text-gray-800">{fmtNum(data.stats.dividendYield)}%</p></div>
                    <div><p className="text-[10px] text-gray-400 uppercase">{t.beta}</p><p className="font-bold text-lg text-gray-800">{fmtNum(data.stats.beta)}</p></div>
                  </div>
                  <div className="mt-4 pt-4 border-t border-gray-50">
                    <p className="text-[10px] text-gray-400 uppercase">{t.epsTitle}</p>
                    <EPSChart trend={data.stats.epsTrend} />
                  </div>
                </div>

                {/* 3. 公司概况 */}
                <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition">
                  <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4">{t.cardProfile}</h3>
                  <div className="space-y-4">
                    <div className="flex gap-2 flex-wrap">
                      <span className="bg-blue-50 text-blue-700 px-2 py-1 rounded text-xs font-bold">{data.profile.sector}</span>
                      <span className="bg-gray-50 text-gray-600 px-2 py-1 rounded text-xs font-medium">{data.profile.industry}</span>
                    </div>
                    <p className="text-sm text-gray-600 leading-relaxed line-clamp-4 text-justify">
                      {data.profile.summary}
                    </p>
                    {data.profile.website && (
                      <a href={data.profile.website} target="_blank" className="text-xs font-bold text-blue-600 hover:text-blue-800 flex items-center gap-1 mt-2">
                        访问官网 ↗
                      </a>
                    )}
                  </div>
                </div>

                {/* 4. 财务健康 (EOD 数据已接入) */}
                <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition">
                  <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4">{t.cardFinancials}</h3>
                  <div className="grid grid-cols-1 gap-4">
                    {[
                      { label: t.margins, val: data.financials.profitMargins, color: 'blue' },
                      { label: t.roe, val: data.financials.roe, color: 'purple' },
                      { label: t.roa, val: data.financials.roa, color: 'indigo' },
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
                    {/* 营收额单独展示 */}
                    <div className="flex justify-between items-center pt-2 border-t border-gray-50">
                        <span className="text-sm text-gray-600">{t.revenue}</span>
                        <span className="font-bold text-gray-900">{data.financials.revenueGrowth}</span>
                    </div>
                  </div>
                </div>

                {/* 5. 机构评级 (EOD 数据已接入) */}
                <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition">
                  <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4">{t.cardAnalysis}</h3>
                  <div className="flex flex-col items-center justify-center h-40">
                    {/* 评级大字 */}
                    <div className="text-center mb-6">
                        <span className={`text-2xl font-black px-4 py-2 rounded-lg uppercase ${
                            data.analysis.recommendation?.toLowerCase().includes('buy') ? 'text-green-600 bg-green-50' : 
                            data.analysis.recommendation?.toLowerCase().includes('sell') ? 'text-red-600 bg-red-50' : 'text-yellow-600 bg-yellow-50'
                        }`}>
                            {data.analysis.recommendation || 'N/A'}
                        </span>
                        <p className="text-xs text-gray-400 mt-2">{t.rating}</p>
                    </div>
                    {/* 目标价 */}
                    <div className="w-full flex justify-between items-center bg-gray-50 p-4 rounded-xl">
                        <span className="text-sm text-gray-500 font-medium">{t.targetPrice}</span>
                        <span className="text-xl font-bold text-gray-900">{fmtNum(data.analysis.targetPrice)}</span>
                    </div>
                  </div>
                </div>

                {/* 6. 最新资讯 */}
                <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition flex flex-col h-[320px]">
                  <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4">{t.cardNews}</h3>
                  <div className="flex-1 overflow-y-auto space-y-4 pr-1 custom-scrollbar">
                    {data.news.map((item) => (
                      <a key={item.uuid} href={item.link} target="_blank" className="block group">
                        <h4 className="text-sm font-bold text-gray-800 group-hover:text-blue-600 leading-snug mb-1 transition line-clamp-2">{item.title}</h4>
                        <div className="flex justify-between text-[10px] text-gray-400 font-medium">
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