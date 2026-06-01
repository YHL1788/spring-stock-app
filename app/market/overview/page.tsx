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

type FearGreedIndicator = {
  key: string;
  label?: string;
  score: number | null;
  rating: string;
  value?: number | null;
};

type FearGreedData = {
  id: string;
  title: string;
  shortTitle: string;
  source: string;
  sourceUrl: string;
  score: number | null;
  rawValue?: number | null;
  rating: string;
  timestamp: string | number | null;
  previous?: {
    close: number | null;
    oneWeek: number | null;
    oneMonth: number | null;
    oneYear: number | null;
  };
  description?: string;
  higherMeans?: 'greed' | 'fear' | 'neutral';
  indicators: FearGreedIndicator[];
  history: Array<{ date: string | number; score: number; rating: string }>;
  updatedAt: string;
  error?: string;
};

const FEAR_GREED_LABELS: Record<string, string> = {
  market_momentum_sp500: '市场动能',
  stock_price_strength: '股价强度',
  stock_price_breadth: '市场宽度',
  put_call_options: '期权情绪',
  market_volatility_vix: '波动率',
  junk_bond_demand: '垃圾债需求',
  safe_haven_demand: '避险需求',
};

const OVERVIEW_SECTIONS = [
  { id: 'global-indices', label: '全球核心指数', eyebrow: 'Indices' },
  { id: 'forex-matrix', label: '外汇交叉矩阵', eyebrow: 'FX' },
  { id: 'crypto-assets', label: '数字货币', eyebrow: 'Crypto' },
  { id: 'commodities', label: '大宗期货', eyebrow: 'Commodities' },
  { id: 'sentiment-indicators', label: '大行编制指标', eyebrow: 'Sentiment' },
];

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
  const [sentimentMetrics, setSentimentMetrics] = useState<FearGreedData[]>([]);
  const [sentimentError, setSentimentError] = useState('');
  const [selectedSentimentId, setSelectedSentimentId] = useState('cnn-fear-greed');

  // 状态：时间范围控制
  const [cryptoRange, setCryptoRange] = useState<'1d' | '1y'>('1y');
  const [commRange, setCommRange] = useState<'1d' | '1y'>('1y');

  const [filteredData, setFilteredData] = useState<any[]>([]);
  const [selectedRegion, setSelectedRegion] = useState<string>('ALL');
  const [lastUpdated, setLastUpdated] = useState<string>("--:--");
  const [isLoading, setIsLoading] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const [showFearGreedDetail, setShowFearGreedDetail] = useState(false);
  const [activeOverviewSection, setActiveOverviewSection] = useState('global-indices');

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

  const fetchMarketSentiments = useCallback(async () => {
    try {
      setSentimentError('');
      const res = await fetch('/api/market-sentiment');
      if (!res.ok) throw new Error('市场情绪指标数据获取失败');
      const data = await res.json();
      const metrics = Array.isArray(data?.metrics) ? data.metrics : [];
      setSentimentMetrics(metrics);
      if (!metrics.some((item: FearGreedData) => item.id === selectedSentimentId) && metrics[0]?.id) {
        setSelectedSentimentId(metrics[0].id);
      }
    } catch (error: any) {
      setSentimentError(error?.message || '市场情绪指标数据获取失败');
    }
  }, [selectedSentimentId]);

  useEffect(() => {
    setIsMounted(true);
    setIsLoading(true);
    Promise.all([fetchBasics(), fetchCrypto(), fetchCommodities(), fetchMarketSentiments()]).finally(() => setIsLoading(false));
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

  useEffect(() => {
    if (!isMounted) return;
    const observer = new IntersectionObserver(
      entries => {
        const visible = entries
          .filter(entry => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible?.target?.id) setActiveOverviewSection(visible.target.id);
      },
      { rootMargin: '-25% 0px -55% 0px', threshold: [0.1, 0.3, 0.6] }
    );

    OVERVIEW_SECTIONS.forEach(section => {
      const element = document.getElementById(section.id);
      if (element) observer.observe(element);
    });

    return () => observer.disconnect();
  }, [isMounted]);

  const getCrossRate = (base: string, quote: string) => {
    if (!forexData[base] || !forexData[quote]) return '--';
    const rate = forexData[base] / forexData[quote];
    if (rate > 100) return rate.toFixed(2);
    if (rate > 1) return rate.toFixed(4);
    return rate.toFixed(5);
  };

  const handleRefreshAll = () => {
    setIsLoading(true);
    Promise.all([fetchBasics(), fetchCrypto(), fetchCommodities(), fetchMarketSentiments()]).finally(() => setIsLoading(false));
  };

  const scrollToOverviewSection = (sectionId: string) => {
    setActiveOverviewSection(sectionId);
    document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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

  const OverviewSidebar = () => (
    <aside className="lg:sticky lg:top-24 h-fit">
      <div className="rounded-3xl border border-gray-200 bg-white/90 p-3 shadow-sm backdrop-blur">
        <div className="px-3 py-2">
          <div className="text-[11px] font-black uppercase tracking-[0.18em] text-gray-400">Overview</div>
          <div className="mt-1 text-sm font-black text-gray-900">页面目录</div>
        </div>
        <div className="mt-2 flex gap-2 overflow-x-auto lg:flex-col lg:overflow-visible">
          {OVERVIEW_SECTIONS.map((section, index) => {
            const active = activeOverviewSection === section.id;
            return (
              <button
                key={section.id}
                type="button"
                onClick={() => scrollToOverviewSection(section.id)}
                className={`group flex min-w-[150px] items-center gap-3 rounded-2xl px-3 py-3 text-left transition-all lg:min-w-0 ${
                  active
                    ? 'bg-slate-900 text-white shadow-sm'
                    : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900'
                }`}
              >
                <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-black ${
                  active ? 'bg-white text-slate-900' : 'bg-gray-100 text-gray-400 group-hover:bg-white'
                }`}>
                  {index + 1}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-black">{section.label}</span>
                  <span className={`block text-[10px] font-bold uppercase tracking-[0.12em] ${active ? 'text-slate-300' : 'text-gray-300'}`}>
                    {section.eyebrow}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </aside>
  );

  const getFearGreedMeta = (score: number | null) => {
    if (score === null || !Number.isFinite(score)) {
      return {
        label: '暂无数据',
        textClass: 'text-gray-500',
        bgClass: 'bg-gray-100',
        barClass: 'from-gray-300 to-gray-500',
        ringClass: 'ring-gray-200',
      };
    }
    if (score <= 25) {
      return {
        label: 'Extreme Fear',
        textClass: 'text-rose-700',
        bgClass: 'bg-rose-50',
        barClass: 'from-rose-500 to-red-700',
        ringClass: 'ring-rose-200',
      };
    }
    if (score <= 45) {
      return {
        label: 'Fear',
        textClass: 'text-orange-700',
        bgClass: 'bg-orange-50',
        barClass: 'from-orange-400 to-rose-500',
        ringClass: 'ring-orange-200',
      };
    }
    if (score < 55) {
      return {
        label: 'Neutral',
        textClass: 'text-slate-700',
        bgClass: 'bg-slate-100',
        barClass: 'from-slate-400 to-slate-600',
        ringClass: 'ring-slate-200',
      };
    }
    if (score < 75) {
      return {
        label: 'Greed',
        textClass: 'text-emerald-700',
        bgClass: 'bg-emerald-50',
        barClass: 'from-lime-400 to-emerald-600',
        ringClass: 'ring-emerald-200',
      };
    }
    return {
      label: 'Extreme Greed',
      textClass: 'text-green-700',
      bgClass: 'bg-green-50',
      barClass: 'from-emerald-400 to-green-700',
      ringClass: 'ring-green-200',
    };
  };

  const formatFearGreedDate = (value: string | number | null | undefined) => {
    if (!value) return '--';
    const normalizedValue = typeof value === 'number' && value < 10000000000 ? value * 1000 : value;
    const date = new Date(normalizedValue);
    return Number.isNaN(date.getTime()) ? '--' : date.toLocaleString();
  };

  const formatFearGreedRating = (rating: string | undefined, fallback: string) => {
    const normalized = (rating || fallback).toLowerCase();
    if (normalized.includes('extreme fear')) return '极度恐惧';
    if (normalized.includes('fear')) return '恐惧';
    if (normalized.includes('neutral')) return '中性';
    if (normalized.includes('extreme greed')) return '极度贪婪';
    if (normalized.includes('greed')) return '贪婪';
    return fallback;
  };

  const formatFearGreedShortDate = (value: string | number | null | undefined) => {
    if (!value) return '--';
    const normalizedValue = typeof value === 'number' && value < 10000000000 ? value * 1000 : value;
    const date = new Date(normalizedValue);
    return Number.isNaN(date.getTime())
      ? '--'
      : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const FearGreedTrendChart = ({ history }: { history: FearGreedData['history'] }) => {
    const cleanHistory = (history || []).filter(item => Number.isFinite(item.score));
    if (cleanHistory.length < 2) {
      return (
        <div className="h-72 rounded-2xl bg-gray-50 border border-gray-100 flex items-center justify-center text-sm text-gray-400">
          暂无足够历史数据
        </div>
      );
    }

    const width = 760;
    const height = 300;
    const padding = { top: 20, right: 28, bottom: 42, left: 44 };
    const innerWidth = width - padding.left - padding.right;
    const innerHeight = height - padding.top - padding.bottom;
    const xFor = (idx: number) => padding.left + (idx / (cleanHistory.length - 1)) * innerWidth;
    const yFor = (scoreValue: number) => padding.top + (1 - Math.max(0, Math.min(100, scoreValue)) / 100) * innerHeight;
    const points = cleanHistory.map((item, idx) => `${xFor(idx)},${yFor(item.score)}`).join(' ');
    const last = cleanHistory[cleanHistory.length - 1];
    const first = cleanHistory[0];
    const middle = cleanHistory[Math.floor(cleanHistory.length / 2)];
    const bands = [
      { from: 75, to: 100, fill: '#dcfce7', label: 'Extreme Greed' },
      { from: 55, to: 75, fill: '#ecfdf5', label: 'Greed' },
      { from: 45, to: 55, fill: '#f8fafc', label: 'Neutral' },
      { from: 25, to: 45, fill: '#fff7ed', label: 'Fear' },
      { from: 0, to: 25, fill: '#fff1f2', label: 'Extreme Fear' },
    ];
    const yTicks = [0, 25, 50, 75, 100];

    return (
      <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-72" role="img" aria-label="CNN Fear and Greed two year trend">
          {bands.map(band => {
            const yTop = yFor(band.to);
            const yBottom = yFor(band.from);
            return (
              <g key={band.label}>
                <rect x={padding.left} y={yTop} width={innerWidth} height={yBottom - yTop} fill={band.fill} />
                <text x={padding.left + 10} y={yTop + 16} className="fill-slate-400 text-[10px] font-bold">
                  {band.label}
                </text>
              </g>
            );
          })}

          {yTicks.map(tick => (
            <g key={tick}>
              <line x1={padding.left} x2={padding.left + innerWidth} y1={yFor(tick)} y2={yFor(tick)} stroke="#e5e7eb" strokeDasharray="4 4" />
              <text x={padding.left - 12} y={yFor(tick) + 4} textAnchor="end" className="fill-slate-400 text-[11px] font-bold">
                {tick}
              </text>
            </g>
          ))}

          <polyline points={points} fill="none" stroke="#0f172a" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx={xFor(cleanHistory.length - 1)} cy={yFor(last.score)} r="6" fill="#0f172a" />
          <circle cx={xFor(cleanHistory.length - 1)} cy={yFor(last.score)} r="11" fill="#0f172a" opacity="0.12" />
          <text x={xFor(cleanHistory.length - 1) - 8} y={yFor(last.score) - 14} textAnchor="end" className="fill-slate-900 text-[13px] font-black">
            {Math.round(last.score)}
          </text>

          <line x1={padding.left} x2={padding.left + innerWidth} y1={padding.top + innerHeight} y2={padding.top + innerHeight} stroke="#cbd5e1" />
          <text x={padding.left} y={height - 14} textAnchor="start" className="fill-slate-400 text-[11px] font-bold">
            {formatFearGreedShortDate(first.date)}
          </text>
          <text x={padding.left + innerWidth / 2} y={height - 14} textAnchor="middle" className="fill-slate-400 text-[11px] font-bold">
            {formatFearGreedShortDate(middle.date)}
          </text>
          <text x={padding.left + innerWidth} y={height - 14} textAnchor="end" className="fill-slate-400 text-[11px] font-bold">
            {formatFearGreedShortDate(last.date)}
          </text>
        </svg>
      </div>
    );
  };

  const FearGreedModule = () => {
    const cnnFearGreed = sentimentMetrics.find(item => item.id === selectedSentimentId) || sentimentMetrics[0] || null;
    const cnnFearGreedError = sentimentError || cnnFearGreed?.error || '';
    const score = cnnFearGreed?.score ?? null;
    const safeScore = score === null ? 0 : Math.max(0, Math.min(100, score));
    const meta = getFearGreedMeta(score);

    return (
      <div>
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2 mb-4">
          <div>
            <h2 className="text-xl font-bold text-gray-900">5. 大行编制指标</h2>
            <p className="text-sm text-gray-500 mt-1">切换查看不同市场情绪与风险偏好指标。</p>
          </div>
          <a
            href={cnnFearGreed?.sourceUrl || 'https://edition.cnn.com/markets/fear-and-greed'}
            target="_blank"
            rel="noreferrer"
            className="text-xs font-bold text-gray-700 bg-gray-100 hover:bg-gray-200 px-3 py-2 rounded-lg transition-colors"
          >
            查看来源
          </a>
        </div>

        <div className="mb-4 flex gap-2 overflow-x-auto rounded-2xl border border-gray-100 bg-gray-50 p-2">
          {sentimentMetrics.length === 0 ? (
            <div className="px-3 py-2 text-xs font-bold text-gray-400">指标加载中...</div>
          ) : sentimentMetrics.map(metric => (
            <button
              key={metric.id}
              type="button"
              onClick={() => {
                setSelectedSentimentId(metric.id);
                setShowFearGreedDetail(false);
              }}
              className={`shrink-0 rounded-xl px-3 py-2 text-xs font-black transition-all ${
                selectedSentimentId === metric.id
                  ? 'bg-slate-900 text-white shadow-sm'
                  : 'bg-white text-gray-500 hover:text-gray-900'
              }`}
            >
              {metric.shortTitle || metric.title}
            </button>
          ))}
        </div>

        <div className="rounded-2xl border border-gray-200 bg-gradient-to-br from-white via-slate-50 to-white shadow-sm overflow-hidden">
          <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr]">
            <div className="p-6 border-b lg:border-b-0 lg:border-r border-gray-100">
              <div className="flex items-center justify-between gap-3 mb-6">
                <div>
                  <div className="text-xs uppercase tracking-[0.18em] text-gray-400 font-black">{cnnFearGreed?.title || 'Market Sentiment'}</div>
                  <div className="text-sm text-gray-500 mt-1">更新时间：{formatFearGreedDate(cnnFearGreed?.timestamp)}</div>
                </div>
                <span className={`px-3 py-1.5 rounded-full text-xs font-black ring-1 ${meta.bgClass} ${meta.textClass} ${meta.ringClass}`}>
                  {formatFearGreedRating(cnnFearGreed?.rating, meta.label)}
                </span>
              </div>

              {cnnFearGreedError ? (
                <div className="rounded-xl bg-rose-50 text-rose-700 text-sm p-4 border border-rose-100">
                  {cnnFearGreedError}
                </div>
              ) : !cnnFearGreed ? (
                <div className="h-48 rounded-xl bg-gray-100 animate-pulse" />
              ) : (
                <>
                  <div className="flex items-end gap-3 mb-5">
                    <div className={`text-6xl font-black tracking-tight ${meta.textClass}`}>
                      {score === null ? '--' : Math.round(score)}
                    </div>
                    <div className="pb-2 text-gray-400 font-bold">/ 100</div>
                  </div>

                  <div className="h-4 rounded-full bg-gray-100 overflow-hidden ring-1 ring-gray-200">
                    <div
                      className={`h-full rounded-full bg-gradient-to-r ${meta.barClass}`}
                      style={{ width: `${safeScore}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-[10px] text-gray-400 font-bold mt-2">
                    <span>Extreme Fear</span>
                    <span>Neutral</span>
                    <span>Extreme Greed</span>
                  </div>

                  <div className="mt-6">
                    <div className="rounded-xl bg-white border border-gray-100 p-3 text-xs text-gray-500 leading-relaxed">
                      {cnnFearGreed?.description || '解释口径：0 代表极度恐惧，100 代表极度贪婪。它更适合做风险偏好温度计，不建议单独作为买卖信号。'}
                    </div>
                  </div>
                </>
              )}
            </div>

            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="font-black text-gray-900">2年情绪趋势</h3>
                  <p className="text-xs text-gray-500 mt-1">用时间序列观察风险偏好从恐惧到贪婪的切换。</p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowFearGreedDetail(true)}
                  disabled={!cnnFearGreed}
                  className="text-xs font-bold text-gray-700 bg-white border border-gray-200 hover:bg-gray-50 px-3 py-2 rounded-lg transition-colors disabled:opacity-50"
                >
                  子指标拆解
                </button>
              </div>

              {!cnnFearGreed && !cnnFearGreedError ? (
                <div className="h-72 rounded-2xl bg-gray-100 animate-pulse" />
              ) : cnnFearGreedError ? (
                <div className="h-72 rounded-2xl bg-rose-50 border border-rose-100 flex items-center justify-center text-sm text-rose-600">
                  暂无法绘制 CNN Fear & Greed 趋势
                </div>
              ) : (
                <FearGreedTrendChart history={cnnFearGreed?.history || []} />
              )}
            </div>
          </div>
        </div>

        {showFearGreedDetail && cnnFearGreed && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 px-4 py-6">
            <div className="w-full max-w-4xl max-h-[88vh] overflow-y-auto rounded-3xl bg-white shadow-2xl">
              <div className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-gray-100 bg-white/95 px-6 py-4 backdrop-blur">
                <div>
                  <h3 className="text-lg font-black text-gray-900">{cnnFearGreed.title} 子指标拆解</h3>
                  <p className="text-xs text-gray-500 mt-1">查看该指标的组成项、原始读数和情绪分数。</p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowFearGreedDetail(false)}
                  className="rounded-full bg-gray-100 px-3 py-1.5 text-sm font-black text-gray-600 hover:bg-gray-200"
                >
                  关闭
                </button>
              </div>

              <div className="p-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                  {(cnnFearGreed.indicators || []).map(indicator => {
                    const indicatorMeta = getFearGreedMeta(indicator.score);
                    return (
                      <div key={indicator.key} className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="font-black text-gray-900 text-sm">{indicator.label || FEAR_GREED_LABELS[indicator.key] || indicator.key}</div>
                            <div className={`text-xs font-bold mt-1 ${indicatorMeta.textClass}`}>
                              {formatFearGreedRating(indicator.rating, indicatorMeta.label)}
                            </div>
                          </div>
                          <div className={`text-3xl font-black ${indicatorMeta.textClass}`}>{indicator.score === null ? '--' : Math.round(indicator.score)}</div>
                        </div>
                        <div className="mt-4 h-2.5 rounded-full bg-gray-100 overflow-hidden">
                          <div
                            className={`h-full rounded-full bg-gradient-to-r ${indicatorMeta.barClass}`}
                            style={{ width: `${Math.max(0, Math.min(100, indicator.score ?? 0))}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-5 rounded-2xl bg-slate-900 text-slate-100 p-4 text-xs leading-relaxed">
                  子指标只用于解释当前综合分数的来源。实际投资判断里，建议结合宏观流动性、估值位置、盈利预期和组合自身风险暴露一起看。
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

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

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[240px_1fr] lg:items-start">
          <OverviewSidebar />

          <main className="min-w-0">
        {/* 1. Global Indices */}
        <section id="global-indices" className="scroll-mt-28 mb-10">
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

          <div className="rounded-2xl border border-gray-200 bg-gradient-to-br from-white via-slate-50 to-white p-3 shadow-sm">
             {filteredData.length === 0 ? (
                <div className="px-6 py-8 text-center text-gray-400 text-sm">该地区暂无数据</div>
             ) : (
               <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                 {filteredData.map((item, idx) => {
                   const isUp = item.changePercent >= 0;
                   return (
                     <div key={idx} className="group rounded-xl border border-gray-100 bg-white px-4 py-3 shadow-sm hover:-translate-y-0.5 hover:shadow-md transition-all">
                       <div className="flex items-start justify-between gap-3">
                         <div className="min-w-0">
                           <div className="flex items-center gap-2">
                             <span className="text-lg leading-none">{item.flag}</span>
                             <div className="font-black text-gray-900 text-sm truncate">{item.name}</div>
                           </div>
                           <div className="mt-1 text-[10px] text-gray-400 font-mono truncate">{item.ticker}</div>
                         </div>
                         <span className={`shrink-0 px-2 py-1 rounded-full text-[11px] font-black ${isUp ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
                           {isUp ? '+' : ''}{formatNum(item.changePercent)}%
                         </span>
                       </div>

                       <div className="mt-3 flex items-end justify-between gap-3">
                         <div className="font-mono text-lg font-black text-gray-950 leading-none">{formatNum(item.price)}</div>
                         <div className={`h-1.5 w-16 rounded-full ${isUp ? 'bg-emerald-100' : 'bg-rose-100'}`}>
                           <div className={`h-full w-2/3 rounded-full ${isUp ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                         </div>
                       </div>
                     </div>
                   );
                 })}
               </div>
             )}
          </div>
        </section>

        {/* 2. Forex Matrix */}
        <section id="forex-matrix" className="scroll-mt-28 mb-10">
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
        </section>

        {/* 3. Crypto & 4. Commodities */}
        <div className="flex flex-col gap-10">
            
            {/* 3. Crypto */}
            <section id="crypto-assets" className="scroll-mt-28">
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
            </section>

            {/* 4. Commodities */}
            <section id="commodities" className="scroll-mt-28">
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
            </section>

            <section id="sentiment-indicators" className="scroll-mt-28">
              <FearGreedModule />
            </section>

        </div>
          </main>
        </div>

      </div>
    </div>
  );
}
