"use client";

import { useState, FormEvent } from 'react';
import Link from 'next/link'; // 引入 Link 用于跳转
import { SignedIn, SignedOut, SignInButton, UserButton, useUser } from '@clerk/nextjs';

// --- 1. 翻译配置 ---
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
    pendingTitle: '账号审核中',
    pendingDesc: '为了保证服务质量，新注册用户需要等待管理员审核。',
    pendingAction: '请联系管理员进行开通，或耐心等待。',
    managePools: '📂 管理股票池', // 新增翻译
    errorFetch: '查询出错，请检查代码',
    errorUnknown: '发生未知错误',
    dateFormat: 'zh-CN'
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
    managePools: '📂 Manage Pools', // 新增翻译
    errorFetch: 'Search failed, check symbol',
    errorUnknown: 'Unknown error occurred',
    dateFormat: 'en-US'
  }
};

type Language = 'zh' | 'en';

// --- 2. 接口定义 ---
interface NewsItem {
  uuid: string;
  title: string;
  publisher: string;
  link: string;
  publishTime: number;
}

interface StockData {
  symbol: string;
  price: number | null;
  changePercent: number | null;
  currency: string;
  priceInHKD: number;
  news: NewsItem[];
}

export default function Home() {
  // 状态管理
  const [lang, setLang] = useState<Language>('zh');
  const t = translations[lang];
  
  // 获取 Clerk 用户信息
  const { user, isLoaded } = useUser();

  // 查询相关状态
  const [inputSymbol, setInputSymbol] = useState<string>('');
  const [stockData, setStockData] = useState<StockData | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');

  // 搜索处理函数
  const handleSearch = async (e: FormEvent) => {
    e.preventDefault();
    if (!inputSymbol.trim()) return;

    setLoading(true);
    setError('');
    setStockData(null);

    try {
      const response = await fetch(`/api/quote?symbol=${inputSymbol}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || t.errorFetch);
      }

      setStockData(data);
    } catch (err: any) {
      setError(err.message || t.errorUnknown);
    } finally {
      setLoading(false);
    }
  };

  // 辅助函数
  const formatNumber = (num: number | null | undefined) => {
    if (typeof num === 'number') return num.toFixed(2);
    return '--';
  };

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp * 1000);
    return date.toLocaleString(t.dateFormat, { 
      hour12: false, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' 
    });
  };

  const toggleLanguage = () => {
    setLang(prev => prev === 'zh' ? 'en' : 'zh');
  };

  // 检查用户是否已获批准 (metadata logic)
  const isApproved = user?.publicMetadata?.approved === true;

  return (
    <main className="flex min-h-screen flex-col items-center p-10 bg-gray-50 relative">
      
      {/* --- 顶部导航栏 (整合了语言、股票池入口、头像) --- */}
      <div className="absolute top-5 right-5 flex items-center gap-3">
        {/* 1. 语言切换 */}
        <button 
          onClick={toggleLanguage}
          className="bg-white border border-gray-300 text-gray-700 px-3 py-1.5 rounded-full text-sm hover:bg-gray-100 transition shadow-sm"
        >
          {lang === 'zh' ? 'English' : '中文'}
        </button>

        {/* 2. 股票池入口 (仅登录可见) */}
        <SignedIn>
          <Link href="/pools">
            <button className="bg-blue-100 text-blue-700 px-4 py-1.5 rounded-full font-bold hover:bg-blue-200 transition text-sm shadow-sm flex items-center gap-1">
              {t.managePools}
            </button>
          </Link>
        </SignedIn>

        {/* 3. 用户头像 (仅登录可见) */}
        <SignedIn>
          <UserButton afterSignOutUrl="/" />
        </SignedIn>
      </div>

      <h1 className="text-4xl font-bold mb-8 text-blue-900 mt-12">{t.title}</h1>

      {/* --- 场景 A：未登录 (显示欢迎页) --- */}
      <SignedOut>
        <div className="text-center mt-10 p-10 bg-white rounded-2xl shadow-xl max-w-md animate-fade-in">
          <p className="text-xl text-gray-600 mb-8">{t.subWelcome}</p>
          <div className="bg-blue-600 text-white px-8 py-3 rounded-lg hover:bg-blue-700 transition font-bold text-lg cursor-pointer inline-block shadow-md">
             <SignInButton mode="modal">
                {t.login}
             </SignInButton>
          </div>
        </div>
      </SignedOut>

      {/* --- 场景 B：已登录 --- */}
      <SignedIn>
        {/* B1: 已登录 但 未批准 (显示审核拦截页) */}
        {!isApproved && isLoaded ? (
           <div className="text-center mt-10 p-10 bg-yellow-50 border border-yellow-200 rounded-2xl shadow-lg max-w-lg animate-fade-in">
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
              <input
                type="text"
                placeholder={t.placeholder}
                value={inputSymbol}
                onChange={(e) => setInputSymbol(e.target.value.toUpperCase())}
                className="border-2 border-gray-300 p-3 rounded-lg text-black focus:border-blue-500 outline-none w-64 shadow-sm"
              />
              <button
                type="submit"
                disabled={loading || !inputSymbol}
                className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-lg disabled:bg-gray-400 transition-colors shadow-md"
              >
                {loading ? t.searching : t.search}
              </button>
            </form>

            {error && (
              <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-6 relative animate-pulse">
                {error}
              </div>
            )}

            {stockData && (
              <div className="w-full max-w-2xl animate-fade-in">
                {/* 价格卡片 */}
                <div className="bg-white p-8 rounded-xl shadow-lg text-center mb-6 border border-gray-100">
                  <h2 className="text-3xl font-bold mb-2 text-gray-800">{stockData.symbol}</h2>
                  
                  <div className="mb-4">
                    <span className="text-2xl font-bold text-gray-500 mr-2 align-top">
                      {stockData.currency}
                    </span>
                    <span className="text-6xl font-extrabold text-blue-900">
                      {formatNumber(stockData.price)}
                    </span>
                  </div>

                  {stockData.currency !== 'HKD' && (
                    <div className="mb-4 text-gray-500 bg-gray-100 py-1 px-3 rounded-full inline-block text-sm">
                      {t.approxHKD} {formatNumber(stockData.priceInHKD)}
                    </div>
                  )}
                  
                  <div className={`text-xl font-semibold flex items-center justify-center gap-1 mt-2
                    ${(stockData.changePercent || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    <span>{(stockData.changePercent || 0) >= 0 ? '▲' : '▼'}</span>
                    <span>
                      {(stockData.changePercent || 0) > 0 ? '+' : ''}
                      {formatNumber(stockData.changePercent)}%
                    </span>
                  </div>
                </div>

                {/* 新闻列表 */}
                {stockData.news && stockData.news.length > 0 && (
                  <div className="bg-white p-6 rounded-xl shadow-lg border border-gray-100">
                    <h3 className="text-xl font-bold mb-4 text-gray-800 border-b pb-2">{t.newsTitle}</h3>
                    <div className="space-y-4">
                      {stockData.news.map((item) => (
                        <a 
                          key={item.uuid} 
                          href={item.link} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="block group"
                        >
                          <div className="flex flex-col gap-1">
                            <h4 className="font-semibold text-gray-800 group-hover:text-blue-600 transition-colors leading-snug">
                              {item.title}
                            </h4>
                            <div className="flex justify-between text-xs text-gray-400 mt-1">
                              <span>{item.publisher}</span>
                              <span>{formatTime(item.publishTime)}</span>
                            </div>
                          </div>
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