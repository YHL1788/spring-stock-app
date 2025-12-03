"use client";

import { useState, FormEvent, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { SignedIn, SignedOut, SignInButton, useUser } from '@clerk/nextjs';
import Link from 'next/link';

// --- 翻譯配置 (保持不變) ---
const translations = {
  zh: {
    // ... (保留原來的翻譯內容)
    title: '個股行情查詢', // 修改標題以適應新頁面
    // ...
    errorFetch: '查詢出錯，請檢查代碼',
    errorUnknown: '發生未知錯誤',
    dateFormat: 'zh-CN'
  },
  en: {
    // ...
    title: 'Stock Quote Lookup',
    // ...
    errorFetch: 'Search failed, check symbol',
    errorUnknown: 'Unknown error occurred',
    dateFormat: 'en-US'
  }
};

type Language = 'zh' | 'en';

// --- 接口定義 (保持不變) ---
interface NewsItem { uuid: string; title: string; publisher: string; link: string; publishTime: number; }
interface StockData { symbol: string; price: number | null; changePercent: number | null; currency: string; priceInHKD: number; news: NewsItem[]; }

function MainContent() {
  // ... (保留原來的狀態和邏輯，但去掉 lang 和 setLang，因為語言狀態要提升到全局)
  // 暫時為了讓頁面能跑，我們先硬編碼語言為中文，後面在 Header 裡解決全局語言問題
  const lang: Language = 'zh';
  const t = translations[lang];
  const { user, isLoaded } = useUser();
  const searchParams = useSearchParams();

  const [inputSymbol, setInputSymbol] = useState<string>('');
  const [stockData, setStockData] = useState<StockData | null>(null);
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
    setStockData(null);

    try {
      const response = await fetch(`/api/quote?symbol=${symbol}`);
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

  const handleSearch = (e: FormEvent) => {
    e.preventDefault();
    if (!inputSymbol.trim()) return;
    performSearch(inputSymbol);
  };

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

  const isApproved = user?.publicMetadata?.approved === true;

  return (
    <div className="flex flex-col items-center p-10">
      <h1 className="text-4xl font-bold mb-8 text-blue-900 mt-12">{t.title}</h1>

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
            <form onSubmit={handleSearch} className="flex gap-3 mb-10">
              <input type="text" placeholder={t.placeholder} value={inputSymbol} onChange={(e) => setInputSymbol(e.target.value.toUpperCase())} className="border-2 border-gray-300 p-3 rounded-lg text-black focus:border-blue-500 outline-none w-64 shadow-sm" />
              <button type="submit" disabled={loading || !inputSymbol} className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-lg disabled:bg-gray-400 transition-colors shadow-md">{loading ? t.searching : t.search}</button>
            </form>

            {error && <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-6 relative animate-pulse">{error}</div>}

            {stockData && (
              <div className="w-full max-w-2xl animate-fade-in">
                <div className="bg-white p-8 rounded-xl shadow-lg text-center mb-6 border border-gray-100">
                  <h2 className="text-3xl font-bold mb-2 text-gray-800">{stockData.symbol}</h2>
                  <div className="mb-4">
                    <span className="text-2xl font-bold text-gray-500 mr-2 align-top">{stockData.currency}</span>
                    <span className="text-6xl font-extrabold text-blue-900">{formatNumber(stockData.price)}</span>
                  </div>
                  {stockData.currency !== 'HKD' && (<div className="mb-4 text-gray-500 bg-gray-100 py-1 px-3 rounded-full inline-block text-sm">{t.approxHKD} {formatNumber(stockData.priceInHKD)}</div>)}
                  <div className={`text-xl font-semibold flex items-center justify-center gap-1 mt-2 ${(stockData.changePercent || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}><span>{(stockData.changePercent || 0) >= 0 ? '▲' : '▼'}</span><span>{(stockData.changePercent || 0) > 0 ? '+' : ''}{formatNumber(stockData.changePercent)}%</span></div>
                </div>

                {stockData.news && stockData.news.length > 0 && (
                  <div className="bg-white p-6 rounded-xl shadow-lg border border-gray-100">
                    <h3 className="text-xl font-bold mb-4 text-gray-800 border-b pb-2">{t.newsTitle}</h3>
                    <div className="space-y-4">
                      {stockData.news.map((item) => (
                        <a key={item.uuid} href={item.link} target="_blank" rel="noopener noreferrer" className="block group">
                          <div className="flex flex-col gap-1">
                            <h4 className="font-semibold text-gray-800 group-hover:text-blue-600 transition-colors leading-snug">{item.title}</h4>
                            <div className="flex justify-between text-xs text-gray-400 mt-1"><span>{item.publisher}</span><span>{formatTime(item.publishTime)}</span></div>
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