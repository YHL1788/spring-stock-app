"use client";

import React, { useState, useEffect, useCallback } from 'react';

// --- 1. 配置常量 ---

const MARKET_INDICES = [
  { region: 'USA', ticker: '^GSPC', name: 'S&P 500', country: '美国', flag: '🇺🇸' },
  { region: 'USA', ticker: '^IXIC', name: '纳斯达克', country: '美国', flag: '🇺🇸' },
  { region: 'CHN', ticker: '000001.SS', name: '上证指数', country: '中国大陆', flag: '🇨🇳' },
  { region: 'CHN', ticker: '000688.SS', name: '科创50', country: '中国大陆', flag: '🇨🇳' },
  { region: 'HKG', ticker: '^HSI', name: '恒生指数', country: '香港', flag: '🇭🇰' },
  { region: 'HKG', ticker: 'HSTECH.HK', name: '恒生科技', country: '香港', flag: '🇭🇰' },
  { region: 'JPN', ticker: '^N225', name: '日经225', country: '日本', flag: '🇯🇵' },
  { region: 'KOR', ticker: '^KS11', name: 'KOSPI', country: '韩国', flag: '🇰🇷' },
  { region: 'GBR', ticker: '^FTSE', name: '富时100', country: '英国', flag: '🇬🇧' },
  { region: 'DEU', ticker: '^GDAXI', name: 'DAX', country: '德国', flag: '🇩🇪' },
  { region: 'CAN', ticker: '^GSPTSE', name: 'TSX综指', country: '加拿大', flag: '🇨🇦' },
  { region: 'IND', ticker: '^BSESN', name: 'SENSEX', country: '印度', flag: '🇮🇳' },
];

const FOREX_TICKERS = [
  { pair: 'EURUSD', ticker: 'EURUSD=X', isInverse: true },
  { pair: 'USDJPY', ticker: 'USDJPY=X', isInverse: false },
  { pair: 'USDCNY', ticker: 'USDCNY=X', isInverse: false },
  { pair: 'USDHKD', ticker: 'USDHKD=X', isInverse: false },
  { pair: 'USDCHF', ticker: 'USDCHF=X', isInverse: false },
];

// 🔵 3. 数字货币 (Crypto) - 更新名称
const CRYPTO_ASSETS = [
  { id: 'btc', ticker: 'BTC-USD', name: 'Bitcoin', symbol: '比特币', icon: '₿', color: 'text-orange-500', bg: 'bg-orange-50' },
  { id: 'eth', ticker: 'ETH-USD', name: 'Ethereum', symbol: '以太坊', icon: 'Ξ', color: 'text-indigo-500', bg: 'bg-indigo-50' },
  { id: 'sol', ticker: 'SOL-USD', name: 'Solana', symbol: '索拉纳', icon: '◎', color: 'text-purple-500', bg: 'bg-purple-50' },
  { id: 'usdt', ticker: 'USDT-USD', name: 'Tether', symbol: '泰达币', icon: '₮', color: 'text-emerald-500', bg: 'bg-emerald-50' },
];

// 🟤 4. 大宗期货 (Commodities)
const COMMODITY_ASSETS = [
  { id: 'gold', ticker: 'GC=F', name: 'Gold', symbol: '黄金', icon: '🥇', color: 'text-yellow-600', bg: 'bg-yellow-50' },
  { id: 'silver', ticker: 'SI=F', name: 'Silver', symbol: '白银', icon: '🥈', color: 'text-slate-500', bg: 'bg-slate-100' },
  { id: 'copper', ticker: 'HG=F', name: 'Copper', symbol: '铜', icon: '🥉', color: 'text-orange-700', bg: 'bg-orange-50' },
  { id: 'aluminum', ticker: 'ALI=F', name: 'Aluminum', symbol: '铝', icon: '🏗️', color: 'text-gray-400', bg: 'bg-gray-100' },
  { id: 'oil', ticker: 'CL=F', name: 'Crude Oil', symbol: '原油', icon: '🛢️', color: 'text-rose-600', bg: 'bg-rose-50' },
  { id: 'coal', ticker: 'MTF=F', name: 'Coal', symbol: '煤炭', icon: '⚫', color: 'text-gray-800', bg: 'bg-gray-200' },
  { id: 'sugar', ticker: 'SB=F', name: 'Sugar', symbol: '白糖', icon: '🍬', color: 'text-pink-400', bg: 'bg-pink-50' },
  { id: 'meal', ticker: 'ZM=F', name: 'Soybean Meal', symbol: '豆粕', icon: '🌱', color: 'text-green-600', bg: 'bg-green-50' },
];

const CURRENCIES = ['USD', 'CNY', 'JPY', 'HKD', 'CHF', 'EUR'];

const COUNTRIES = Array.from(new Set(MARKET_INDICES.map(i => JSON.stringify({ name: i.country, region: i.region, flag: i.flag }))))
  .map(s => JSON.parse(s));

// --- 2. 辅助函数 ---

const formatNum = (num: number, digits = 2) => {
  if (num === undefined || num === null) return '--';
  return num.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
};

// 移除 volume 格式化函数，因为不再需要显示
// const formatVolume = ... 

const getChangeColorClass = (change: number) => {
    if (change > 0) return 'text-emerald-600';
    if (change < 0) return 'text-rose-600';
    return 'text-gray-500';
};

// 📈 迷你走势图组件
const Sparkline = ({ data, color, isUp }: { data: any[], color: string, isUp: boolean }) => {
  if (!data || data.length < 2) return <div className="h-16 w-full bg-gray-50 rounded flex items-center justify-center text-xs text-gray-300">No Chart Data</div>;

  const prices = data.map(d => d.close);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min;
  
  if (range === 0) return null;

  const width = 100;
  const height = 40;
  
  const points = prices.map((p, i) => {
    const x = (i / (prices.length - 1)) * width;
    const y = height - ((p - min) / range) * height; 
    return `${x},${y}`;
  }).join(' ');

  const strokeColor = isUp ? '#10b981' : '#f43f5e'; 

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-12 overflow-visible" preserveAspectRatio="none">
      <polyline
        fill="none"
        stroke={strokeColor}
        strokeWidth="2"
        points={points}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};

// --- 3. 页面组件 ---

export default function MarketOverviewPage() {
  const [marketData, setMarketData] = useState<any[]>([]); 
  const [forexData, setForexData] = useState<Record<string, number>>({}); 
  const [cryptoData, setCryptoData] = useState<any[]>([]);
  const [commodityData, setCommodityData] = useState<any[]>([]);

  // 状态：时间范围控制
  const [cryptoRange, setCryptoRange] = useState<'1d' | '1y'>('1y');
  const [commRange, setCommRange] = useState<'1d' | '1y'>('1y');

  const [filteredData, setFilteredData] = useState<any[]>([]);
  const [selectedRegion, setSelectedRegion] = useState<string>('ALL');
  const [lastUpdated, setLastUpdated] = useState<string>("--:--");
  const [isLoading, setIsLoading] = useState(false);
  const [isMounted, setIsMounted] = useState(false);

  // 初始化基础数据
  const fetchBasics = async () => {
    try {
      const indexPromises = MARKET_INDICES.map(async (item) => {
        try {
          const res = await fetch(`/api/quote?symbol=${encodeURIComponent(item.ticker)}`);
          if (!res.ok) throw new Error('Fetch failed');
          const data = await res.json();
          return { ...data, ...item };
        } catch (error) {
          return { ...item, price: 0, change: 0, changePercent: 0, error: true };
        }
      });

      const forexPromises = FOREX_TICKERS.map(async (item) => {
        try {
          const res = await fetch(`/api/quote?symbol=${encodeURIComponent(item.ticker)}`);
          const data = await res.json();
          let valInUSD = item.isInverse ? data.price : 1 / data.price;
          return { currency: item.pair.replace('USD',''), val: valInUSD };
        } catch (e) { return null; }
      });

      const [indexRes, forexRes] = await Promise.all([
        Promise.all(indexPromises),
        Promise.all(forexPromises),
      ]);

      setMarketData(indexRes);
      
      const forexMap: Record<string, number> = { 'USD': 1 };
      forexRes.forEach(f => { if (f) forexMap[f.currency] = f.val; });
      setForexData(forexMap);

      setLastUpdated(new Date().toLocaleTimeString());
    } catch (e) { console.error(e); }
  };

  const fetchCrypto = useCallback(async () => {
    const promises = CRYPTO_ASSETS.map(async (item) => {
        try {
          const res = await fetch(`/api/quote?symbol=${encodeURIComponent(item.ticker)}&range=${cryptoRange}`);
          const data = await res.json();
          return { ...data, ...item }; 
        } catch (e) { return { ...item, price: 0, change: 0 }; }
    });
    const res = await Promise.all(promises);
    setCryptoData(res);
  }, [cryptoRange]);

  const fetchCommodities = useCallback(async () => {
    const promises = COMMODITY_ASSETS.map(async (item) => {
        try {
          const res = await fetch(`/api/quote?symbol=${encodeURIComponent(item.ticker)}&range=${commRange}`);
          const data = await res.json();
          return { ...data, ...item };
        } catch (e) { return { ...item, price: 0, change: 0 }; }
    });
    const res = await Promise.all(promises);
    setCommodityData(res);
  }, [commRange]);

  useEffect(() => {
    setIsMounted(true);
    setIsLoading(true);
    Promise.all([fetchBasics(), fetchCrypto(), fetchCommodities()]).finally(() => setIsLoading(false));
  }, []);

  useEffect(() => { if(isMounted) fetchCrypto(); }, [fetchCrypto]);
  useEffect(() => { if(isMounted) fetchCommodities(); }, [fetchCommodities]);

  useEffect(() => {
    if (selectedRegion === 'ALL') {
      setFilteredData(marketData);
    } else {
      setFilteredData(marketData.filter(item => item.region === selectedRegion));
    }
  }, [selectedRegion, marketData]);

  const getCrossRate = (base: string, quote: string) => {
    if (!forexData[base] || !forexData[quote]) return '--';
    const rate = forexData[base] / forexData[quote];
    if (rate > 100) return rate.toFixed(2);
    if (rate > 1) return rate.toFixed(4);
    return rate.toFixed(5);
  };

  const handleRefreshAll = () => {
    setIsLoading(true);
    Promise.all([fetchBasics(), fetchCrypto(), fetchCommodities()]).finally(() => setIsLoading(false));
  };

  // 核心卡片组件：处理动态涨跌幅逻辑
  const AssetCard = ({ item, range }: { item: any, range: '1d' | '1y' }) => {
    let change = item.change;
    let changePercent = item.changePercent;
    let label = "单日涨跌";
    let rangeLabel = "1 Day";

    // 如果选择是 1年，且有历史数据，则重新计算基于一年前的涨跌幅
    if (range === '1y') {
        label = "一年涨跌";
        rangeLabel = "1 Year";
        if (item.history && item.history.length > 0) {
            const startPrice = item.history[0].close;
            // 简单容错：确保 startPrice 有效
            if (startPrice && startPrice > 0) {
                change = item.price - startPrice;
                changePercent = ((change / startPrice) * 100);
            }
        }
    }

    return (
        <div className="bg-white rounded-xl p-5 border border-gray-200 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between">
          <div>
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center text-xl ${item.bg}`}>
                  <span className={item.color}>{item.icon}</span>
                </div>
                <div>
                  <h3 className="font-bold text-gray-900 leading-tight">{item.symbol}</h3>
                  <span className="text-[10px] text-gray-400 font-mono block">{item.name}</span>
                </div>
              </div>
              <div className={`text-right ${getChangeColorClass(change)}`}>
                 <div className="text-xs font-bold bg-gray-50 px-2 py-1 rounded">
                   {changePercent >= 0 ? '+' : ''}{formatNum(changePercent)}%
                 </div>
                 <div className="text-[9px] text-gray-400 mt-0.5 text-right font-medium">{label}</div>
              </div>
            </div>

            {/* Price (Volume Removed) */}
            <div className="mb-4">
               <div>
                 <div className="text-2xl font-black text-gray-900 font-mono tracking-tight">
                   ${formatNum(item.price)}
                 </div>
                 <div className={`text-xs font-medium mt-1 ${getChangeColorClass(change)}`}>
                   {change > 0 ? '+' : ''}{formatNum(change)}
                 </div>
               </div>
            </div>
          </div>

          {/* Sparkline Chart */}
          <div className="pt-2 border-t border-gray-50">
            <div className="h-12 w-full">
               <Sparkline data={item.history} color={item.color} isUp={change >= 0} />
            </div>
            <div className="flex justify-between text-[10px] text-gray-300 mt-1 font-mono">
               <span>Low</span>
               <span className="bg-gray-100 px-1.5 rounded text-gray-500">{rangeLabel}</span>
               <span>High</span>
            </div>
          </div>
        </div>
    );
  };

  const RangeToggle = ({ value, onChange }: { value: string, onChange: (v: '1d' | '1y') => void }) => (
    <div className="flex bg-gray-100 rounded-lg p-0.5 ml-3">
      <button 
        onClick={() => onChange('1d')}
        className={`px-3 py-1 rounded-md text-[10px] font-bold transition-all ${value === '1d' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
      >
        1日分时
      </button>
      <button 
        onClick={() => onChange('1y')}
        className={`px-3 py-1 rounded-md text-[10px] font-bold transition-all ${value === '1y' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
      >
        1年走势
      </button>
    </div>
  );

  if (!isMounted) return <div className="min-h-screen bg-white pt-24 px-6 flex items-center justify-center"><div className="animate-pulse text-gray-400">Loading Markets...</div></div>;

  return (
    <div className="min-h-screen bg-white pt-24 px-6 pb-20">
      <div className="max-w-7xl mx-auto">
        
        {/* Title */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8 border-b border-gray-100 pb-6">
          <div>
            <h1 className="text-3xl font-black text-gray-900 flex items-center gap-3">
              全球市场概览
            </h1>
            <p className="text-gray-500 mt-2 text-sm">
              从宏观指数到加密资产，一站式掌握全球资金流向。
            </p>
          </div>
          <div className="flex items-center gap-4">
             <span className="text-xs text-gray-400 font-mono">上次更新: {lastUpdated}</span>
             <button onClick={handleRefreshAll} disabled={isLoading} className="bg-gray-900 text-white px-5 py-2 rounded-lg text-sm font-bold hover:bg-gray-800 transition-colors disabled:opacity-50">
                {isLoading ? '刷新中...' : '刷新数据'}
             </button>
          </div>
        </div>

        {/* 1. Global Indices */}
        <div className="mb-10">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-4 gap-4">
            <h2 className="text-xl font-bold text-gray-900 shrink-0">1. 全球核心指数</h2>
            
            <div className="flex flex-wrap gap-2 bg-gray-50 p-1.5 rounded-xl border border-gray-100">
              <button 
                onClick={() => setSelectedRegion('ALL')} 
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  selectedRegion === 'ALL' 
                    ? 'bg-white text-gray-900 shadow-sm ring-1 ring-black/5' 
                    : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'
                }`}
              >
                🌍 全部
              </button>
              
              {COUNTRIES.map((country: any) => (
                <button 
                  key={country.region}
                  onClick={() => setSelectedRegion(country.region)} 
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                    selectedRegion === country.region 
                      ? 'bg-white text-blue-600 shadow-sm ring-1 ring-black/5' 
                      : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'
                  }`}
                >
                  <span>{country.flag}</span>
                  {country.name}
                </button>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
             <div className="overflow-x-auto">
               <table className="w-full text-left whitespace-nowrap">
                  <thead className="bg-gray-50 border-b border-gray-200">
                     <tr className="text-xs font-semibold text-gray-500 uppercase">
                        <th className="px-6 py-3">指数名称</th>
                        <th className="px-6 py-3 text-right">最新价</th>
                        <th className="px-6 py-3 text-right">涨跌幅</th>
                     </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                     {filteredData.length === 0 ? (
                        <tr><td colSpan={3} className="px-6 py-8 text-center text-gray-400 text-sm">该地区暂无数据</td></tr>
                     ) : (
                       filteredData.map((item, idx) => (
                          <tr key={idx} className="hover:bg-gray-50 transition-colors">
                             <td className="px-6 py-4">
                                <div className="flex items-center gap-3">
                                   <span className="text-2xl">{item.flag}</span>
                                   <div>
                                      <div className="font-bold text-gray-900 text-sm">{item.name}</div>
                                      <div className="text-xs text-gray-400 font-mono">{item.ticker}</div>
                                   </div>
                                </div>
                             </td>
                             <td className="px-6 py-4 text-right font-mono font-medium text-sm">{formatNum(item.price)}</td>
                             <td className="px-6 py-4 text-right">
                                <span className={`px-2 py-1 rounded text-xs font-bold ${item.changePercent >= 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                                   {item.changePercent >= 0 ? '+' : ''}{formatNum(item.changePercent)}%
                                </span>
                             </td>
                          </tr>
                       ))
                     )}
                  </tbody>
               </table>
             </div>
          </div>
        </div>

        {/* 2. Forex Matrix */}
        <div className="mb-10">
          <h2 className="text-xl font-bold text-gray-900 mb-4">2. 外汇交叉矩阵</h2>
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
             <table className="w-full text-center whitespace-nowrap">
                <thead>
                   <tr className="bg-gray-900 text-white text-xs uppercase">
                      <th className="p-3 border-r border-gray-700 w-32 sticky left-0 bg-gray-900 z-10">Base \ Quote</th>
                      {CURRENCIES.map(c => <th key={c} className="p-3 min-w-[80px]">{c}</th>)}
                   </tr>
                </thead>
                <tbody className="text-sm">
                   {CURRENCIES.map(base => (
                      <tr key={base} className="border-b border-gray-100 hover:bg-gray-50">
                         <td className="p-3 font-bold bg-gray-50 text-gray-900 border-r border-gray-200 sticky left-0 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">{base}</td>
                         {CURRENCIES.map(quote => {
                            const isSame = base === quote;
                            return (
                               <td key={quote} className={`p-3 font-mono ${isSame ? 'bg-gray-50 text-gray-300' : 'text-gray-700'}`}>
                                  {isSame ? '-' : getCrossRate(base, quote)}
                               </td>
                            );
                         })}
                      </tr>
                   ))}
                </tbody>
             </table>
          </div>
        </div>

        {/* 3. Crypto & 4. Commodities */}
        <div className="flex flex-col gap-10">
            
            {/* 3. Crypto */}
            <div>
               <div className="flex items-center mb-4">
                  <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                     3. 数字货币
                  </h2>
                  <RangeToggle value={cryptoRange} onChange={setCryptoRange} />
               </div>
               
               <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {cryptoData.map(item => (
                    <AssetCard 
                      key={item.id} 
                      item={item} 
                      range={cryptoRange}
                    />
                  ))}
               </div>
            </div>

            {/* 4. Commodities */}
            <div>
               <div className="flex items-center mb-4">
                  <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                     4. 大宗期货
                  </h2>
                  <RangeToggle value={commRange} onChange={setCommRange} />
               </div>

               <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {commodityData.map(item => (
                    <AssetCard 
                      key={item.id} 
                      item={item} 
                      range={commRange}
                    />
                  ))}
               </div>
            </div>

        </div>

      </div>
    </div>
  );
}