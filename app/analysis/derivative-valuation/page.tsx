"use client";

import React, { useState } from 'react';
import { FCNPricer, FCNParams, FCNResult } from '@/app/lib/fcnPricer';

// 默认 Vontobel 参数 (作为初始状态)
const DEFAULT_PARAMS: FCNParams = {
    broker_name: "MS",
    market: "HKD",
    total_notional: 2000000,
    denomination: 100000,
    tickers: ['9880.HK', '2050.HK', '6613.HK'],
    ticker_name: ["优必选", "三花", "蓝思"],
    initial_spots: [134.7, 40.06, 35.38],
    current_spots: [], 
    trade_date: "2025-10-10",
    
    // 历史数据回溯配置
    history_start_date: "2025-10-09", // 默认为交易日前一天

    obs_dates: [
        "2025-11-24", "2025-12-24", "2026-01-26"
    ],
    pay_dates: [
        "2025-11-26", "2025-12-30", "2026-01-28"
    ],
    strike_pct: 0.825,
    trigger_pct: 1.00,
    coupon_rate: 0.2779,
    coupon_freq: 12,
    risk_free_rate: 0.03,
    n_sims: 5000, 
    fx_rate: NaN,
    seed: undefined // 默认未定义，即随机
};

// 定义分红行接口
interface DividendRow {
    ticker: string;
    date: string;
    amount: string;
}

export default function DerivativeValuationPage() {
  const [activeTab, setActiveTab] = useState<'FCN' | 'DQ/AQ'>('FCN');
  const [fcnParams, setFcnParams] = useState<FCNParams>(DEFAULT_PARAMS);
  const [fcnResult, setFcnResult] = useState<FCNResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchStatus, setFetchStatus] = useState<string>('');
  const [isHKDView, setIsHKDView] = useState(false); // 控制是否以HKD显示
  
  // 分红数据行状态
  const [dividendRows, setDividendRows] = useState<DividendRow[]>([]);

  // 通用表单状态处理
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    let parsedValue: any = value;

    // 处理普通数字类型
    if (['total_notional', 'denomination', 'coupon_freq', 'n_sims'].includes(name)) {
        parsedValue = parseFloat(value);
    }
    // 特殊处理 fx_rate 和 seed
    if (name === 'fx_rate' || name === 'seed') {
        parsedValue = value === '' ? undefined : parseFloat(value);
    }

    setFcnParams(prev => ({
        ...prev,
        [name]: parsedValue
    }));
  };

  // 专门处理百分比输入 (输入 100 -> 存储 1.0)
  const handlePercentChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const { name, value } = e.target;
      const floatVal = parseFloat(value);
      setFcnParams(prev => ({
          ...prev,
          [name]: isNaN(floatVal) ? 0 : floatVal / 100
      }));
  };

  // 处理数组输入
  const handleArrayChange = (e: React.ChangeEvent<HTMLTextAreaElement>, field: keyof FCNParams, isNumberArray: boolean = false) => {
      const val = e.target.value;
      let arr: any[] = val.split(/[\n,]+/).map(s => s.trim()).filter(s => s !== '');
      
      if (isNumberArray) {
          arr = arr.map(s => parseFloat(s)).filter(n => !isNaN(n));
      }
      
      setFcnParams(prev => ({
          ...prev,
          [field]: arr
      }));
  };

  const getArrayDisplay = (field: keyof FCNParams) => {
      const val = fcnParams[field];
      if (Array.isArray(val)) {
          return val.join(', ');
      }
      return '';
  };

  // --- 分红表格处理函数 ---
  const addDividendRow = () => {
      // 默认选中第一个 ticker
      const defaultTicker = fcnParams.tickers.length > 0 ? fcnParams.tickers[0] : '';
      setDividendRows([...dividendRows, { ticker: defaultTicker, date: '', amount: '' }]);
  };

  const removeDividendRow = (index: number) => {
      const newRows = [...dividendRows];
      newRows.splice(index, 1);
      setDividendRows(newRows);
  };

  const updateDividendRow = (index: number, field: keyof DividendRow, value: string) => {
      const newRows = [...dividendRows];
      newRows[index][field] = value;
      setDividendRows(newRows);
  };

  // 辅助：从 API 获取报价
  const fetchQuotePrice = async (symbol: string): Promise<number | null> => {
      try {
          const apiUrl = `/api/quote?symbol=${symbol}`;
          const response = await fetch(apiUrl);
          if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
          const data = await response.json();
          const price = data.regularMarketPrice || data.price || data.close;
          
          if (typeof price === 'number') return price;
          return null;
      } catch (e) {
          console.error(`Failed to fetch quote for ${symbol}:`, e);
          return null;
      }
  };

  const handleCalculate = async () => {
    setLoading(true);
    setFetchStatus('准备数据...');
    
    setTimeout(async () => {
        try {
            const calcParams = { ...fcnParams };
            let missingDataInfo = [];

            // --- 处理分红输入 (将表格转换为 Map 结构) ---
            if (dividendRows.length > 0) {
                const divMap: { [key: string]: [string, number][] } = {};
                dividendRows.forEach(row => {
                    const amt = parseFloat(row.amount);
                    if (row.ticker && row.date && !isNaN(amt)) {
                        if (!divMap[row.ticker]) divMap[row.ticker] = [];
                        divMap[row.ticker].push([row.date, amt]);
                    }
                });
                calcParams.discrete_dividends = divMap;
            } else {
                calcParams.discrete_dividends = {};
            }

            // --- 校验：历史数据起始日必须早于交易日 ---
            if (calcParams.history_start_date && calcParams.trade_date) {
                if (calcParams.history_start_date >= calcParams.trade_date) {
                    alert("错误：历史数据起始日 (Start Date) 必须早于交易日期 (Trade Date)！");
                    setLoading(false);
                    return;
                }
            }

            // 1. 自动抓取当前价格 (如果为空)
            if (!calcParams.current_spots || calcParams.current_spots.length === 0) {
                setFetchStatus('正在抓取最新股价...');
                const spotPromises = calcParams.tickers.map(t => fetchQuotePrice(t));
                const prices = await Promise.all(spotPromises);
                
                const validPrices: number[] = [];
                prices.forEach((p, idx) => {
                    if (p !== null) {
                        validPrices.push(p);
                    } else {
                        missingDataInfo.push(`无法获取 ${calcParams.tickers[idx]} 价格`);
                        validPrices.push(calcParams.initial_spots[idx]); 
                    }
                });
                calcParams.current_spots = validPrices;
                setFcnParams(prev => ({ ...prev, current_spots: validPrices }));
            } else if (calcParams.current_spots.length !== calcParams.tickers.length) {
                alert(`当前价格数量 (${calcParams.current_spots.length}) 与标的数量 (${calcParams.tickers.length}) 不一致。`);
                setLoading(false);
                return;
            }

            // 2. 自动抓取汇率
            if (calcParams.market !== 'HKD' && (!calcParams.fx_rate || isNaN(calcParams.fx_rate))) {
                setFetchStatus(`正在获取 ${calcParams.market}/HKD 汇率...`);
                const fxSymbol = `${calcParams.market}HKD=X`; 
                const rate = await fetchQuotePrice(fxSymbol);
                
                if (rate !== null) {
                    calcParams.fx_rate = rate;
                    setFcnParams(prev => ({ ...prev, fx_rate: rate })); 
                } else {
                    missingDataInfo.push(`无法获取汇率 ${fxSymbol}`);
                    calcParams.fx_rate = 1.0; 
                }
            } else if (calcParams.market === 'HKD') {
                calcParams.fx_rate = 1.0;
            }

            setFetchStatus('正在进行蒙特卡洛模拟...');
            
            setTimeout(() => {
                try {
                    const pricer = new FCNPricer(calcParams);
                    const res = pricer.simulate_price();
                    setFcnResult(res);
                } catch (calcError) {
                    console.error(calcError);
                    alert("计算错误，请检查参数。");
                } finally {
                    setLoading(false);
                    setFetchStatus('');
                }
            }, 50);

        } catch (e) {
            console.error(e);
            alert("流程出错。");
            setLoading(false);
            setFetchStatus('');
        }
    }, 10);
  };

  // 格式化函数
  const fmtPct = (val: number) => (val * 100).toFixed(2) + '%';
  
  // 动态货币格式化
  const getDisplayCurrency = () => isHKDView ? 'HKD' : (fcnParams.market || 'HKD');
  const getDisplayValue = (val: number) => {
      if (isHKDView && fcnParams.fx_rate) {
          return val * fcnParams.fx_rate;
      }
      return val;
  };

  const fmtMoney = (val: number) => {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: getDisplayCurrency() }).format(val);
  };

  // 计算预期收息期数
  const calcExpectedCouponPeriods = (res: FCNResult) => {
      const total_return = res.hist_coupons_paid + res.pending_coupons_pv + res.future_coupons_pv;
      return res.avg_period_coupon > 0 ? total_return / res.avg_period_coupon : 0;
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mb-8 flex flex-col md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">衍生品测算</h1>
              <p className="mt-2 text-sm text-gray-500">
                结构化产品定价与风险分析模型
              </p>
            </div>
            <div className="mt-4 md:mt-0 flex bg-gray-200 rounded-lg p-1 self-start">
                <button
                    onClick={() => setActiveTab('FCN')}
                    className={`px-4 py-2 text-sm font-medium rounded-md transition-all duration-200 ${
                        activeTab === 'FCN' ? 'bg-white text-gray-900 shadow' : 'text-gray-500 hover:text-gray-700'
                    }`}
                >
                    FCN
                </button>
                <button
                    onClick={() => setActiveTab('DQ/AQ')}
                    className={`px-4 py-2 text-sm font-medium rounded-md transition-all duration-200 ${
                        activeTab === 'DQ/AQ' ? 'bg-white text-gray-900 shadow' : 'text-gray-500 hover:text-gray-700'
                    }`}
                >
                    DQ/AQ
                </button>
            </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1 bg-white shadow rounded-lg p-6 max-h-[1200px] overflow-y-auto">
             <h2 className="text-lg font-semibold text-gray-800 mb-4 border-b pb-2">参数配置</h2>
             
             {activeTab === 'FCN' ? (
                 <div className="space-y-4 text-sm">
                     <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block font-medium text-gray-700">券商 (Broker)</label>
                            <input type="text" name="broker_name" value={fcnParams.broker_name || ''} onChange={handleInputChange} className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm border p-2" />
                        </div>
                        <div>
                            <label className="block font-medium text-gray-700">计价货币</label>
                            <select name="market" value={fcnParams.market} onChange={handleInputChange} className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm border p-2">
                                <option value="HKD">HKD</option>
                                <option value="USD">USD</option>
                                <option value="CNY">CNY</option>
                            </select>
                        </div>
                     </div>

                     <div className="grid grid-cols-2 gap-4">
                        <div>
                             <label className="block font-medium text-gray-700">总名义本金</label>
                             <input type="number" name="total_notional" value={fcnParams.total_notional} onChange={handleInputChange} className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm border p-2" />
                        </div>
                        <div>
                             <label className="block font-medium text-gray-700">单张面值</label>
                             <input type="number" name="denomination" value={fcnParams.denomination} onChange={handleInputChange} className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm border p-2" />
                        </div>
                     </div>

                     <div>
                        <label className="block font-medium text-gray-700">交易日期 (Trade Date)</label>
                        <input type="date" name="trade_date" value={fcnParams.trade_date} onChange={handleInputChange} className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm border p-2" />
                     </div>

                     {/* 历史数据回溯配置 (带最大日期限制) */}
                     <div>
                        <label className="block font-medium text-gray-700">
                            历史数据起始日 (Start Date)
                            <span className="block text-xs font-normal text-gray-400">用于波动率计算及敲出回测</span>
                        </label>
                        <input 
                            type="date" 
                            name="history_start_date" 
                            value={fcnParams.history_start_date || ''} 
                            max={fcnParams.trade_date} 
                            onChange={handleInputChange} 
                            className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm border p-2" 
                        />
                        <p className="text-xs text-red-500 mt-1" style={{display: (fcnParams.history_start_date && fcnParams.trade_date && fcnParams.history_start_date >= fcnParams.trade_date) ? 'block' : 'none'}}>
                            起始日必须早于交易日
                        </p>
                     </div>

                     <div className="border-t pt-4">
                         <label className="block font-medium text-gray-700 text-xs uppercase text-gray-500 mb-2">标的资产 (逗号分隔)</label>
                         
                         <div className="space-y-3">
                             <div>
                                <label className="block text-xs text-gray-600">代码 (Tickers)</label>
                                <textarea rows={2} value={getArrayDisplay('tickers')} onChange={(e) => handleArrayChange(e, 'tickers')} className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-xs border p-2" placeholder="9880.HK, 2050.HK..." />
                             </div>
                             <div>
                                <label className="block text-xs text-gray-600">名称 (Names)</label>
                                <textarea rows={2} value={getArrayDisplay('ticker_name')} onChange={(e) => handleArrayChange(e, 'ticker_name')} className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-xs border p-2" placeholder="优必选, 三花..." />
                             </div>
                             <div>
                                <label className="block text-xs text-gray-600">初始价格 (Initial Spots)</label>
                                <textarea rows={2} value={getArrayDisplay('initial_spots')} onChange={(e) => handleArrayChange(e, 'initial_spots', true)} className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-xs border p-2" placeholder="134.7, 40.06..." />
                             </div>
                             <div>
                                <label className="block text-xs text-blue-600 font-semibold">
                                    当前价格 (选填)
                                    <span className="font-normal text-gray-400 ml-1">- 留空则自动抓取</span>
                                </label>
                                <textarea rows={2} value={getArrayDisplay('current_spots')} onChange={(e) => handleArrayChange(e, 'current_spots', true)} className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-xs border p-2 bg-blue-50" placeholder="留空以自动获取..." />
                             </div>
                         </div>
                     </div>

                     {/* 分红数据 (表单形式) */}
                     <div className="border-t pt-4">
                         <div className="flex justify-between items-center mb-2">
                             <label className="block font-medium text-gray-700 text-xs uppercase text-gray-500">分红数据 (Discrete Dividends)</label>
                             <button onClick={addDividendRow} className="text-xs text-blue-600 hover:text-blue-800 font-medium flex items-center">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                </svg>
                                添加分红
                             </button>
                         </div>
                         
                         {dividendRows.length === 0 ? (
                             <div className="text-xs text-gray-400 italic text-center py-2 border border-dashed rounded bg-gray-50">暂无分红数据</div>
                         ) : (
                             <div className="space-y-2">
                                 {dividendRows.map((row, index) => (
                                     <div key={index} className="flex gap-2 items-center bg-gray-50 p-2 rounded border border-gray-200">
                                         <div className="flex-1">
                                             <select 
                                                className="w-full text-xs border-gray-300 rounded shadow-sm focus:ring-blue-500 focus:border-blue-500 border p-1"
                                                value={row.ticker}
                                                onChange={(e) => updateDividendRow(index, 'ticker', e.target.value)}
                                             >
                                                 <option value="" disabled>选择标的</option>
                                                 {fcnParams.tickers.map(t => (
                                                     <option key={t} value={t}>{t}</option>
                                                 ))}
                                             </select>
                                         </div>
                                         <div className="w-24">
                                             <input 
                                                type="date" 
                                                className="w-full text-xs border-gray-300 rounded shadow-sm focus:ring-blue-500 focus:border-blue-500 border p-1"
                                                value={row.date}
                                                onChange={(e) => updateDividendRow(index, 'date', e.target.value)}
                                                placeholder="日期"
                                             />
                                         </div>
                                         <div className="w-20">
                                             <input 
                                                type="number" 
                                                step="0.01"
                                                className="w-full text-xs border-gray-300 rounded shadow-sm focus:ring-blue-500 focus:border-blue-500 border p-1"
                                                value={row.amount}
                                                onChange={(e) => updateDividendRow(index, 'amount', e.target.value)}
                                                placeholder="金额"
                                             />
                                         </div>
                                         <button onClick={() => removeDividendRow(index)} className="text-red-500 hover:text-red-700">
                                             <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                               <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                             </svg>
                                         </button>
                                     </div>
                                 ))}
                             </div>
                         )}
                     </div>

                     <div className="border-t pt-4 grid grid-cols-2 gap-4">
                        <div>
                             <label className="block font-medium text-gray-700">敲出界限 (%)</label>
                             <input type="number" step="0.01" name="trigger_pct" value={parseFloat((fcnParams.trigger_pct * 100).toFixed(4))} onChange={handlePercentChange} className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm border p-2" />
                        </div>
                        <div>
                             <label className="block font-medium text-gray-700">敲入界限 (%)</label>
                             <input type="number" step="0.001" name="strike_pct" value={parseFloat((fcnParams.strike_pct * 100).toFixed(4))} onChange={handlePercentChange} className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm border p-2" />
                        </div>
                        <div>
                             <label className="block font-medium text-gray-700">年化票息率 (%)</label>
                             <input type="number" step="0.0001" name="coupon_rate" value={parseFloat((fcnParams.coupon_rate * 100).toFixed(4))} onChange={handlePercentChange} className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm border p-2" />
                        </div>
                        <div>
                             <label className="block font-medium text-gray-700">无风险利率 (%)</label>
                             <input type="number" step="0.01" name="risk_free_rate" value={parseFloat((fcnParams.risk_free_rate * 100).toFixed(4))} onChange={handlePercentChange} className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm border p-2" />
                        </div>
                     </div>
                     
                     <div className="border-t pt-4">
                         <label className="block font-medium text-gray-700 text-xs uppercase text-gray-500 mb-2">日期表 (逗号或换行分隔)</label>
                         <div className="space-y-3">
                             <div>
                                <label className="block text-xs text-gray-600">观察日 (Obs Dates)</label>
                                <textarea rows={3} value={getArrayDisplay('obs_dates')} onChange={(e) => handleArrayChange(e, 'obs_dates')} className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-xs border p-2" placeholder="YYYY-MM-DD..." />
                             </div>
                             <div>
                                <label className="block text-xs text-gray-600">支付日 (Pay Dates)</label>
                                <textarea rows={3} value={getArrayDisplay('pay_dates')} onChange={(e) => handleArrayChange(e, 'pay_dates')} className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-xs border p-2" placeholder="YYYY-MM-DD..." />
                             </div>
                         </div>
                     </div>
                     
                     <div className="border-t pt-4 grid grid-cols-2 gap-4">
                        <div>
                             <label className="block font-medium text-gray-700">
                                模拟汇率 (To HKD)
                                <span className="block text-xs font-normal text-gray-400">选填 (留空自动抓取)</span>
                             </label>
                             <input type="number" step="0.0001" name="fx_rate" value={fcnParams.fx_rate === undefined || isNaN(fcnParams.fx_rate) ? '' : fcnParams.fx_rate} onChange={handleInputChange} className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm border p-2" placeholder="自动获取" />
                        </div>
                        <div>
                             <label className="block font-medium text-gray-700">模拟次数</label>
                             <input type="number" name="n_sims" value={fcnParams.n_sims} onChange={handleInputChange} className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm border p-2" />
                        </div>
                        {/* 新增：随机种子输入 */}
                        <div className="col-span-2">
                             <label className="block font-medium text-gray-700">
                                随机种子 (Seed)
                                <span className="block text-xs font-normal text-gray-400">选填 (留空则随机)</span>
                             </label>
                             <input type="number" name="seed" value={fcnParams.seed === undefined ? '' : fcnParams.seed} onChange={handleInputChange} className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm border p-2" placeholder="例如: 42" />
                        </div>
                     </div>

                     <button
                        onClick={handleCalculate}
                        disabled={loading}
                        className={`w-full py-3 px-4 rounded-md text-white font-medium transition-colors shadow-sm mt-4 flex justify-center items-center ${
                            loading ? 'bg-blue-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'
                        }`}
                     >
                        {loading && (
                            <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                        )}
                        {loading ? (fetchStatus || '测算中...') : '开始测算'}
                     </button>
                 </div>
             ) : (
                 <div className="text-center text-gray-400 py-10">
                     <p>DQ/AQ 引擎开发中...</p>
                 </div>
             )}
          </div>

          <div className="lg:col-span-2 bg-white shadow rounded-lg p-6 min-h-[600px]">
             {fcnResult ? (
                 <div className="space-y-6 animate-fadeIn">
                     <div className="border-b border-gray-200 pb-4">
                         <div className="flex justify-between items-start">
                             <div>
                                 <h2 className="text-xl font-bold text-gray-900">FCN 估值报告</h2>
                                 <p className="text-sm text-gray-500 mt-1">{fcnResult.product_name_display}</p>
                             </div>
                             {/* HKD 转换按钮 */}
                             <button
                                 onClick={() => setIsHKDView(!isHKDView)}
                                 className={`px-3 py-1 text-xs font-medium rounded border transition-colors ${
                                     isHKDView 
                                         ? 'bg-blue-600 text-white border-blue-600' 
                                         : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                                 }`}
                             >
                                 {isHKDView ? '已转为 HKD' : 'HKD 转换'}
                             </button>
                         </div>
                         <div className="mt-2 flex items-center space-x-2">
                             <span className={`px-2 py-1 rounded text-xs font-semibold ${
                                 fcnResult.status === 'Active' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                             }`}>
                                 {fcnResult.status === 'Active' ? '存续中' : (
                                     fcnResult.status === 'KnockedOut' ? '已敲出 (Knocked-Out)' : '已到期 (Expired)'
                                 )}
                             </span>
                             <span className="text-xs text-gray-400">
                                 {new Date().toLocaleString()}
                             </span>
                         </div>
                         {fcnResult.status === 'Active' && (
                             <div className="mt-2 text-sm text-gray-600">
                                预期收息期数: <span className="font-semibold">{calcExpectedCouponPeriods(fcnResult).toFixed(2)} 期</span>
                             </div>
                         )}
                     </div>

                     {fcnResult.status !== 'Active' && fcnResult.settlement_info && (
                         <div className="bg-orange-50 border-l-4 border-orange-400 p-4 mb-4">
                             <div className="flex">
                                 <div className="ml-3">
                                     <p className="text-sm text-orange-700">
                                         {fcnResult.settlement_info.desc}
                                     </p>
                                 </div>
                             </div>
                         </div>
                     )}

                     <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                         <div className="bg-gray-50 p-4 rounded-lg">
                             <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-3">单价估值 (Par={fcnParams.denomination})</h3>
                             <div className="space-y-2">
                                 <div className="flex justify-between">
                                     <span className="text-gray-600">全价 (Total Price)</span>
                                     <span className="font-semibold">{fcnResult.dirty_price + fcnResult.hist_coupons_paid > 0 ? (fcnResult.dirty_price + fcnResult.hist_coupons_paid).toFixed(2) : '0.00'}</span>
                                 </div>
                                 <div className="flex justify-between">
                                     <span className="text-gray-600">现值 (Dirty Price)</span>
                                     <span className="font-bold text-blue-600">{fcnResult.dirty_price.toFixed(2)}</span>
                                 </div>
                                 <div className="text-xs text-right text-gray-400">
                                     本金 {(fcnResult.principal_pv).toFixed(2)} + 待付/未来票息 {(fcnResult.pending_coupons_pv + fcnResult.future_coupons_pv).toFixed(2)}
                                 </div>
                             </div>
                         </div>

                         <div className="bg-gray-50 p-4 rounded-lg">
                             <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-3">持仓损益 ({getDisplayCurrency()})</h3>
                             <div className="space-y-2 text-sm">
                                 <div className="flex justify-between">
                                     <span className="text-gray-600">总名义本金</span>
                                     {/* 本金通常固定显示原币种，或者也进行转换 */}
                                     <span>{fmtMoney(fcnParams.total_notional)}</span>
                                 </div>
                                 <div className="flex justify-between">
                                     <span className="text-gray-600">当前市值</span>
                                     <span className="font-semibold">
                                         {fmtMoney(getDisplayValue(fcnResult.dirty_price * (fcnParams.total_notional / fcnParams.denomination)))}
                                     </span>
                                 </div>
                                 <div className="flex justify-between text-gray-600">
                                     <span>已实现票息</span>
                                     <span>
                                         {fmtMoney(getDisplayValue(fcnResult.hist_coupons_paid * (fcnParams.total_notional / fcnParams.denomination)))}
                                     </span>
                                 </div>
                                 
                                 <div className="flex justify-between text-gray-600">
                                     <span>未实现损益</span>
                                     <span>
                                         {fmtMoney(getDisplayValue(((fcnResult.pending_coupons_pv + fcnResult.future_coupons_pv) - fcnResult.implied_loss_pv) * (fcnParams.total_notional / fcnParams.denomination)))}
                                     </span>
                                 </div>
                                 <div className="pl-4 text-xs text-gray-500">
                                     <div className="flex justify-between">
                                         <span>+ 预期票息</span>
                                         <span>{fmtMoney(getDisplayValue((fcnResult.pending_coupons_pv + fcnResult.future_coupons_pv) * (fcnParams.total_notional / fcnParams.denomination)))}</span>
                                     </div>
                                     <div className="flex justify-between">
                                         <span>- 预期亏损 (接货)</span>
                                         <span>{fmtMoney(getDisplayValue(fcnResult.implied_loss_pv * (fcnParams.total_notional / fcnParams.denomination)))}</span>
                                     </div>
                                 </div>

                                 <div className="border-t border-gray-200 my-2 pt-2">
                                    <div className="flex justify-between text-gray-800">
                                        <span>累计总损益</span>
                                        <span className={(fcnResult.dirty_price + fcnResult.hist_coupons_paid - fcnParams.denomination) >= 0 ? 'text-green-600' : 'text-red-600'}>
                                            {fmtMoney(getDisplayValue((fcnResult.dirty_price + fcnResult.hist_coupons_paid - fcnParams.denomination) * (fcnParams.total_notional / fcnParams.denomination)))}
                                        </span>
                                    </div>
                                 </div>
                             </div>
                         </div>
                     </div>

                     <div>
                         <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-3">风险概率</h3>
                         <div className="grid grid-cols-2 gap-4 text-center">
                             <div className="p-3 border rounded-md">
                                 <div className="text-xs text-gray-500">提前赎回概率</div>
                                 <div className="text-lg font-bold text-gray-800">{fmtPct(fcnResult.early_redemption_prob)}</div>
                             </div>
                             <div className="p-3 border rounded-md">
                                 <div className="text-xs text-gray-500">敲入接货概率</div>
                                 <div className="text-lg font-bold text-red-600">{fmtPct(fcnResult.loss_prob)}</div>
                             </div>
                         </div>
                     </div>

                     {fcnResult.early_redemption_prob > 0 && (
                         <div>
                             <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-3">提前敲出分布</h3>
                             <div className="overflow-x-auto">
                                 <table className="min-w-full divide-y divide-gray-200 text-sm">
                                     <thead>
                                         <tr>
                                             <th className="px-3 py-2 text-left font-medium text-gray-500">期数</th>
                                             <th className="px-3 py-2 text-left font-medium text-gray-500">观察日</th>
                                             <th className="px-3 py-2 text-right font-medium text-gray-500">概率</th>
                                         </tr>
                                     </thead>
                                     <tbody className="divide-y divide-gray-200">
                                         {fcnResult.autocall_attribution.map((prob, idx) => {
                                             if (prob <= 0.0001) return null;
                                             // 找到对应的真实观察日 (注意模拟只包含未来的)
                                             const today = new Date();
                                             today.setHours(0,0,0,0);
                                             const futureDates = fcnParams.obs_dates.filter(d => new Date(d) > today);
                                             const dateStr = futureDates[idx] || `Future Obs ${idx+1}`;
                                             
                                             return (
                                                 <tr key={idx}>
                                                     <td className="px-3 py-2 text-gray-900">未来第 {idx + 1} 个观察日</td>
                                                     <td className="px-3 py-2 text-gray-500">{dateStr}</td>
                                                     <td className="px-3 py-2 text-right">{fmtPct(prob)}</td>
                                                 </tr>
                                             );
                                         })}
                                     </tbody>
                                 </table>
                             </div>
                         </div>
                     )}

                     {fcnResult.loss_prob > 0 && (
                         <div>
                             <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-3">接货风险归因</h3>
                             <div className="overflow-x-auto">
                                 <table className="min-w-full divide-y divide-gray-200 text-sm">
                                     <thead>
                                         <tr>
                                             <th className="px-3 py-2 text-left font-medium text-gray-500">标的</th>
                                             <th className="px-3 py-2 text-right font-medium text-gray-500">归因概率</th>
                                             <th className="px-3 py-2 text-right font-medium text-gray-500">接货股数 (Avg)</th>
                                             <th className="px-3 py-2 text-right font-medium text-gray-500">接货市值 (Avg)</th>
                                         </tr>
                                     </thead>
                                     <tbody className="divide-y divide-gray-200">
                                         {fcnParams.tickers.map((ticker, idx) => (
                                             <tr key={ticker}>
                                                 <td className="px-3 py-2 text-gray-900">
                                                     {fcnParams.ticker_name?.[idx] || ticker}
                                                     <span className="block text-xs text-gray-400">{ticker}</span>
                                                 </td>
                                                 <td className="px-3 py-2 text-right">{fmtPct(fcnResult.loss_attribution[idx])}</td>
                                                 <td className="px-3 py-2 text-right">
                                                     {(fcnResult.exposure_shares_avg[idx] * (fcnParams.total_notional / fcnParams.denomination)).toFixed(0)}
                                                 </td>
                                                 <td className="px-3 py-2 text-right">
                                                     {fmtMoney(getDisplayValue(fcnResult.exposure_value_avg[idx] * (fcnParams.total_notional / fcnParams.denomination)))}
                                                 </td>
                                             </tr>
                                         ))}
                                     </tbody>
                                 </table>
                             </div>
                         </div>
                     )}

                 </div>
             ) : (
                 <div className="h-full flex flex-col items-center justify-center text-gray-400">
                    <svg className="w-16 h-16 mb-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <p className="text-lg">请点击左侧 "开始测算" 运行模型</p>
                    <p className="text-sm mt-2">基于 {fcnParams.n_sims} 次蒙特卡洛模拟</p>
                 </div>
             )}
          </div>
        </div>
      </div>
    </div>
  );
}