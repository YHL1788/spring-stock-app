"use client";

import { useState, FormEvent, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { SignedIn, SignedOut, SignInButton, useUser } from '@clerk/nextjs';

// --- 1. 修复重点：补全了所有之前缺少的翻译项 ---
const translations = {
  zh: {
    title: '个股行情查询',
    placeholder: '代码 (如 7203.T 或 AAPL)',
    search: '查询',
    searching: '查询中...',
    newsTitle: '相关新闻',
    approxHKD: '约合 HKD',
    // 之前报错就是因为缺了下面这几行：
    subWelcome: '专业的全球股市分析工具',
    login: '立即登录 / 注册',
    pendingTitle: '账号审核中',
    pendingDesc: '为了保证服务质量，新注册用户需要等待管理员审核。',
    pendingAction: '请联系管理员进行开通，或耐心等待。',
    errorFetch: '查询出错，请检查代码',
    errorUnknown: '发生未知错误',
    dateFormat: 'zh-CN',
    
    // 板块标题翻译补全
    cardTrading: '交易概览',
    cardStats: '核心指标',
    cardProfile: '公司概况',
    cardFinancials: '财务健康',
    cardAnalysis: '机构评级',
    cardNews: '相关资讯',
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
    loginBtn: '登录 / 注册'
  },
  en: {
    title: 'Stock Quote Lookup',
    placeholder: 'Symbol (e.g. 7203.T or AAPL)',
    search: 'Search',
    searching: 'Searching...',
    newsTitle: 'Related News',
    approxHKD: 'Approx. HKD',
    // 补全英文对应项：
    subWelcome: 'Professional Global Market Analysis',
    login: 'Sign In / Register',
    pendingTitle: 'Account Under Review',
    pendingDesc: 'New accounts require admin approval.',
    pendingAction: 'Please contact admin or wait for approval.',
    errorFetch: 'Search failed, check symbol',
    errorUnknown: 'Unknown error occurred',
    dateFormat: 'en-US',

    // 板块标题翻译补全
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
    loginBtn: 'Sign In / Register'
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

// --- 主内容组件 ---
function MainContent() {
  const lang: Language = 'zh'; // 暂时固定中文
  const t = translations[lang];
  const { user, isLoaded } = useUser();
  const searchParams = useSearchParams();

  const [inputSymbol, setInputSymbol] = useState<string>('');
  // 这里把 stockData 改名为 data 以匹配新的 DashboardData 结构
  const [data, setData] = useState<DashboardData | null>(null); 
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    const symbolFromUrl = searchParams.get('symbol');
    if (symbolFromUrl) {
      const code = symbolFromUrl.toUpperCase();
      setInputSymbol(code);
      performSearch(code);
    }
  }, [searchParams]);

  const performSearch = async (symbol: string) => {
    setLoading(true);
    setError('');
    setData(null);

    try {
      const response = await fetch(`/api/quote?symbol=${symbol}`);
      const json = await response.json();

      if (!response.ok) {
        throw new Error(json.error || t.errorFetch);
      }
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
    performSearch(inputSymbol);
  };

  // 辅助函数
  const fmtNum = (n: number | null, decimals = 2) => n != null ? n.toFixed(decimals) : '--';
  const fmtPct = (n: number | null) => n != null ? `${n > 0 ? '+' : ''}${n.toFixed(2)}%` : '--';
  const fmtDate = (ts: number) => new Date(ts * 1000).toLocaleDateString();

  // 进度条组件
  const Range52Bar = ({ low, high, current }: { low: number, high: number, current: number }) => {
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

  const isApproved = user?.publicMetadata?.approved === true;

  return (
    <div className="flex flex-col items-center p-6 w-full max-w-7xl mx-auto">
      <h1 className="text-3xl font-bold mb-8 text-blue-900 mt-8">{t.title}</h1>

      <SignedOut>
        <div className="text-center mt-10 p-10 bg-white rounded-2xl shadow-xl max-w-md animate-fade-in">
          <p className="text-xl text-gray-600 mb-8">{t.subWelcome}</p>
          <div className="bg-blue-600 text-white px-8 py-3 rounded-lg hover:bg-blue-700 transition font-bold text-lg cursor-pointer inline-block shadow-md">
             <SignInButton mode="modal">{t.login}</SignInButton>
          </div>
        </div>
      </SignedOut>

      <SignedIn>
        {!isApproved && isLoaded ? (
           <div className="text-center mt-10 p-10 bg-yellow-50 border border-yellow-200 rounded-2xl shadow-lg max-w-lg animate-fade-in">
             <div className="text-5xl mb-4">⏳</div>
             <h2 className="text-2xl font-bold text-yellow-800 mb-4">{t.pendingTitle}</h2>
             <p className="text-gray-700 mb-6">{t.pendingDesc}</p>
             <div className="bg-white p-4 rounded border border-gray-200 text-sm text-gray-500">{t.pendingAction}</div>
           </div>
        ) : (
          <>
            <form onSubmit={handleSearch} className="flex gap-3 mb-10 w-full max-w-lg">
              <input type="text" placeholder={t.placeholder} value={inputSymbol} onChange={(e) => setInputSymbol(e.target.value.toUpperCase())} className="border-2 border-gray-300 p-3 rounded-lg text-black focus:border-blue-500 outline-none w-full shadow-sm" />
              <button type="submit" disabled={loading || !inputSymbol} className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-lg disabled:bg-gray-400 transition-colors shadow-md whitespace-nowrap">{loading ? t.searching : t.search}</button>
            </form>

            {error && <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-6 relative animate-pulse">{error}</div>}

            {data && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 w-full animate-fade-in-up pb-20">
                
                {/* 1. 交易数据 */}
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
                  <div className="mb-4">
                    <p className="text-xs font-bold text-gray-500 mb-1">{t.range52}</p>
                    <Range52Bar low={data.trading.low52} high={data.trading.high52} current={data.price} />
                  </div>
                  <div className="pt-4 border-t border-gray-100">
                    <p className="text-xs text-gray-400">{t.approxHKD}: {fmtNum(data.priceInHKD)}</p>
                  </div>
                </div>

                {/* 2. 核心指标 */}
                <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                  <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wide mb-4">{t.cardStats}</h3>
                  <div className="grid grid-cols-2 gap-y-4 gap-x-2">
                    <div><p className="text-xs text-gray-400">{t.mktCap}</p><p className="font-bold">{data.stats.marketCap}</p></div>
                    <div><p className="text-xs text-gray-400">{t.pe}</p><p className="font-bold">{fmtNum(data.stats.peRatio)}</p></div>
                    <div><p className="text-xs text-gray-400">{t.divYield}</p><p className="font-bold">{fmtNum(data.stats.dividendYield)}%</p></div>
                    <div><p className="text-xs text-gray-400">{t.beta}</p><p className="font-bold">{fmtNum(data.stats.beta)}</p></div>
                  </div>
                </div>

                {/* 3. 公司概况 */}
                <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                  <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wide mb-4">{t.cardProfile}</h3>
                  <div className="flex gap-2 mb-3 flex-wrap">
                    <span className="bg-blue-50 text-blue-700 px-2 py-1 rounded text-xs font-medium">{data.profile.sector}</span>
                    <span className="bg-gray-100 text-gray-600 px-2 py-1 rounded text-xs">{data.profile.industry}</span>
                  </div>
                  <p className="text-sm text-gray-600 leading-relaxed line-clamp-4 mb-2">
                    {data.profile.summary}
                  </p>
                  {data.profile.website && (
                    <a href={data.profile.website} target="_blank" className="text-xs text-blue-500 hover:underline block mt-2">官网 ↗</a>
                  )}
                </div>

                {/* 4. 财务健康 */}
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
                          <div className={`h-full bg-${item.color}-500 rounded-full`} style={{ width: `${Math.min(Math.max(item.val || 0, 0), 100)}%` }}></div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 5. 评级占位 (Finnhub免费版无数据) */}
                <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                  <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wide mb-4">{t.cardAnalysis}</h3>
                  <div className="flex flex-col items-center justify-center h-40 text-gray-400 text-sm bg-gray-50 rounded-lg">
                    <p>分析师评级需升级数据源</p>
                    <p className="text-xs mt-1">(目前使用免费版 API)</p>
                  </div>
                </div>

                {/* 6. 新闻 */}
                <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex flex-col h-[300px]">
                  <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wide mb-4">{t.cardNews}</h3>
                  <div className="flex-1 overflow-y-auto space-y-4 pr-2">
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