"use client";

import { useState, FormEvent } from 'react';

// --- 1. 定义多语言字典 ---
const translations = {
  zh: {
    title: 'Spring Stock',
    placeholder: '代码 (如 7203.T 或 AAPL)',
    search: '查询',
    searching: '查询中...',
    newsTitle: '相关新闻',
    approxHKD: '约合 HKD',
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
    errorFetch: 'Search failed, check symbol',
    errorUnknown: 'Unknown error occurred',
    dateFormat: 'en-US'
  }
};

type Language = 'zh' | 'en';

// --- 接口定义 ---
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
  // --- 2. 新增语言状态，默认为 'zh' (中文) ---
  const [lang, setLang] = useState<Language>('zh');
  
  // 获取当前语言的字典
  const t = translations[lang];

  const [inputSymbol, setInputSymbol] = useState<string>('');
  const [stockData, setStockData] = useState<StockData | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');

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

  const formatNumber = (num: number | null | undefined) => {
    if (typeof num === 'number') return num.toFixed(2);
    return '--';
  };

  // 根据当前语言格式化时间
  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp * 1000);
    return date.toLocaleString(t.dateFormat, { 
      hour12: false, 
      month: 'short', 
      day: 'numeric', 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  };

  // 切换语言的函数
  const toggleLanguage = () => {
    setLang(prev => prev === 'zh' ? 'en' : 'zh');
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-start p-10 bg-gray-50 relative">
      
      {/* --- 3. 语言切换按钮 (右上角) --- */}
      <div className="absolute top-5 right-5">
        <button 
          onClick={toggleLanguage}
          className="bg-white border border-gray-300 text-gray-700 px-4 py-1 rounded-full text-sm hover:bg-gray-100 transition-colors shadow-sm"
        >
          {lang === 'zh' ? 'English' : '中文'}
        </button>
      </div>

      <h1 className="text-4xl font-bold mb-8 text-blue-900">{t.title}</h1>

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
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-6 relative">
          {error}
        </div>
      )}

      {stockData && (
        <div className="w-full max-w-2xl animate-fade-in">
          {/* 价格卡片 */}
          <div className="bg-white p-8 rounded-xl shadow-lg text-center mb-6">
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
            <div className="bg-white p-6 rounded-xl shadow-lg">
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
    </main>
  );
}