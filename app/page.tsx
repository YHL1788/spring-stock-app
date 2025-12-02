"use client";

import { useState, FormEvent } from 'react';
import { SignedIn, SignedOut, SignInButton, UserButton, useUser } from '@clerk/nextjs';

// --- 翻译与配置 ---
const translations = {
  zh: {
    title: 'Spring Stock',
    placeholder: '代码 (如 7203.T 或 AAPL)',
    search: '查询',
    searching: '查询中...',
    newsTitle: '相关新闻',
    approxHKD: '约合 HKD',
    welcome: '欢迎使用 Spring Stock',
    subWelcome: '专业的全球股市分析工具',
    login: '立即登录 / 注册',
    // 新增审核相关文案
    pendingTitle: '账号审核中',
    pendingDesc: '为了保证服务质量，新注册用户需要等待管理员审核。',
    pendingAction: '请联系管理员 (你的邮箱@example.com) 进行开通，或耐心等待。',
    logout: '退出登录'
  },
  en: {
    title: 'Spring Stock',
    placeholder: 'Symbol (e.g. 7203.T or AAPL)',
    search: 'Search',
    searching: 'Searching...',
    newsTitle: 'Related News',
    approxHKD: 'Approx. HKD',
    welcome: 'Welcome to Spring Stock',
    subWelcome: 'Professional Global Market Analysis',
    login: 'Sign In / Register',
    pendingTitle: 'Account Under Review',
    pendingDesc: 'New accounts require admin approval.',
    pendingAction: 'Please contact admin or wait for approval.',
    logout: 'Sign Out'
  }
};

type Language = 'zh' | 'en';

// --- 接口定义 ---
interface NewsItem { uuid: string; title: string; publisher: string; link: string; publishTime: number; }
interface StockData { symbol: string; price: number | null; changePercent: number | null; currency: string; priceInHKD: number; news: NewsItem[]; }

export default function Home() {
  const [lang, setLang] = useState<Language>('zh');
  const t = translations[lang];
  
  // ★ 1. 获取当前用户信息
  const { user, isLoaded } = useUser();

  const [inputSymbol, setInputSymbol] = useState<string>('');
  const [stockData, setStockData] = useState<StockData | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');

  const handleSearch = async (e: FormEvent) => {
    e.preventDefault();
    if (!inputSymbol.trim()) return;
    setLoading(true); setError(''); setStockData(null);
    try {
      const response = await fetch(`/api/quote?symbol=${inputSymbol}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Error');
      setStockData(data);
    } catch (err: any) { setError(err.message || 'Unknown Error'); } finally { setLoading(false); }
  };

  const formatNumber = (num: number | null | undefined) => (typeof num === 'number' ? num.toFixed(2) : '--');
  const formatTime = (ts: number) => new Date(ts * 1000).toLocaleDateString();
  const toggleLanguage = () => setLang(prev => prev === 'zh' ? 'en' : 'zh');

  // ★ 2. 检查用户是否已获批准
  // 逻辑：如果 metadata 里没有 approved: true，就视为未批准
  // 注意：publicMetadata 是我们在 Clerk 后台手动添加的
  const isApproved = user?.publicMetadata?.approved === true;

  return (
    <main className="flex min-h-screen flex-col items-center p-10 bg-gray-50 relative">
      
      {/* 语言切换 & 用户头像 */}
      <div className="absolute top-5 right-20">
        <button onClick={toggleLanguage} className="bg-white border border-gray-300 px-4 py-1 rounded-full text-sm hover:bg-gray-100">{lang === 'zh' ? 'English' : '中文'}</button>
      </div>
      <div className="absolute top-5 right-5">
        <SignedIn><UserButton afterSignOutUrl="/" /></SignedIn>
      </div>

      <h1 className="text-4xl font-bold mb-8 text-blue-900 mt-10">{t.title}</h1>

      {/* --- 场景 A：未登录 (显示欢迎页) --- */}
      <SignedOut>
        <div className="text-center mt-10 p-10 bg-white rounded-2xl shadow-xl max-w-md">
          <p className="text-xl text-gray-600 mb-8">{t.subWelcome}</p>
          <div className="bg-blue-600 text-white px-8 py-3 rounded-lg hover:bg-blue-700 transition font-bold text-lg cursor-pointer inline-block">
             <SignInButton mode="modal">{t.login}</SignInButton>
          </div>
        </div>
      </SignedOut>

      {/* --- 场景 B：已登录 --- */}
      <SignedIn>
        {/* B1: 已登录 但 未批准 (显示审核拦截页) */}
        {!isApproved && isLoaded ? (
           <div className="text-center mt-10 p-10 bg-yellow-50 border border-yellow-200 rounded-2xl shadow-lg max-w-lg">
             <div className="text-5xl mb-4">⏳</div>
             <h2 className="text-2xl font-bold text-yellow-800 mb-4">{t.pendingTitle}</h2>
             <p className="text-gray-700 mb-6">{t.pendingDesc}</p>
             <div className="bg-white p-4 rounded border border-gray-200 text-sm text-gray-500">
               {t.pendingAction}
             </div>
           </div>
        ) : (
          /* B2: 已登录 且 已批准 (显示正常的股票查询功能) */
          <>
            <form onSubmit={handleSearch} className="flex gap-3 mb-10">
              <input type="text" placeholder={t.placeholder} value={inputSymbol} onChange={(e) => setInputSymbol(e.target.value.toUpperCase())} className="border-2 border-gray-300 p-3 rounded-lg text-black w-64 shadow-sm" />
              <button type="submit" disabled={loading || !inputSymbol} className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-lg disabled:bg-gray-400 shadow-md">{loading ? t.searching : t.search}</button>
            </form>

            {error && <div className="bg-red-100 text-red-700 px-4 py-3 rounded mb-6">{error}</div>}

            {stockData && (
              <div className="w-full max-w-2xl animate-fade-in">
                <div className="bg-white p-8 rounded-xl shadow-lg text-center mb-6">
                  <h2 className="text-3xl font-bold mb-2 text-gray-800">{stockData.symbol}</h2>
                  <div className="mb-4">
                    <span className="text-2xl font-bold text-gray-500 mr-2 align-top">{stockData.currency}</span>
                    <span className="text-6xl font-extrabold text-blue-900">{formatNumber(stockData.price)}</span>
                  </div>
                  {stockData.currency !== 'HKD' && <div className="mb-4 text-gray-500 bg-gray-100 py-1 px-3 rounded-full text-sm">{t.approxHKD} {formatNumber(stockData.priceInHKD)}</div>}
                  <div className={`text-xl font-semibold flex justify-center gap-1 mt-2 ${(stockData.changePercent || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    <span>{(stockData.changePercent || 0) >= 0 ? '▲' : '▼'}</span><span>{formatNumber(stockData.changePercent)}%</span>
                  </div>
                </div>
                {/* 新闻部分 */}
                {stockData.news && stockData.news.length > 0 && (
                  <div className="bg-white p-6 rounded-xl shadow-lg">
                    <h3 className="text-xl font-bold mb-4 text-gray-800 border-b pb-2">{t.newsTitle}</h3>
                    <div className="space-y-4">
                      {stockData.news.map((item) => (
                        <a key={item.uuid} href={item.link} target="_blank" className="block group">
                          <h4 className="font-semibold text-gray-800 group-hover:text-blue-600">{item.title}</h4>
                          <div className="flex justify-between text-xs text-gray-400 mt-1"><span>{item.publisher}</span><span>{formatTime(item.publishTime)}</span></div>
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </SignedIn>
    </main>
  );
}