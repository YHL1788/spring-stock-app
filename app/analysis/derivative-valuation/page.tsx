"use client";

import React, { useState } from 'react';
import { FCNPricer, FCNParams, FCNResult } from '@/app/lib/fcnPricer';

// --- 类型定义 ---

interface UnderlyingRow {
    id: string;
    ticker: string;
    name: string;
    initialPrice: string;
    currentPrice: string; // 选填
    dividendDate: string; // 选填
    dividendAmount: string; // 选填
}

interface DateRow {
    id: string;
    obsDate: string;
    payDate: string;
}

// 示例参数 (用于 Placeholder 提示)
const EXAMPLE_PARAMS: FCNParams = {
    broker_name: "MS",
    market: "HKD",
    total_notional: 2000000,
    denomination: 100000,
    tickers: ['9880.HK', '2050.HK', '6613.HK'],
    ticker_name: ["优必选", "三花", "蓝思"],
    initial_spots: [134.7, 40.06, 35.38],
    current_spots: [], 
    trade_date: "2025-10-10",
    history_start_date: "2025-10-09", 
    obs_dates: ["2025-11-24", "2025-12-24", "2026-01-26"],
    pay_dates: ["2025-11-26", "2025-12-30", "2026-01-28"],
    strike_pct: 0.825,
    trigger_pct: 1.00,
    coupon_rate: 0.2779,
    coupon_freq: 12,
    risk_free_rate: 0.03,
    n_sims: 5000, 
    fx_rate: 1.0,
    seed: 42 
};

export default function DerivativeValuationPage() {
  const [activeTab, setActiveTab] = useState<'FCN' | 'DQ/AQ'>('FCN');
  
  // 基础 & 模拟 & 结构 参数 (初始化为空)
  // 使用显式类型定义以允许 undefined 或 null，或者统一使用空字符串表示空值
  const [basicParams, setBasicParams] = useState({
      broker_name: '',
      market: 'HKD',
      total_notional: '' as number | string,
      denomination: '' as number | string,
      trade_date: '',
      strike_pct: '' as number | string, // 存储百分比小数 (如 0.825)
      trigger_pct: '' as number | string,
      coupon_rate: '' as number | string,
      coupon_freq: '' as number | string,
      risk_free_rate: '' as number | string,
      fx_rate: '' as number | string, // input value, '' means empty
      history_start_date: '',
      n_sims: '' as number | string,
      seed: '' as number | string 
  });

  // 标的信息表格状态 (初始化1个空行)
  const [underlyingRows, setUnderlyingRows] = useState<UnderlyingRow[]>([{
      id: 'init_1',
      ticker: '',
      name: '',
      initialPrice: '',
      currentPrice: '',
      dividendDate: '',
      dividendAmount: ''
  }]);

  // 日期信息表格状态 (初始化1个空行)
  const [dateRows, setDateRows] = useState<DateRow[]>([{
      id: 'init_d1',
      obsDate: '',
      payDate: ''
  }]);

  const [fcnResult, setFcnResult] = useState<FCNResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchStatus, setFetchStatus] = useState<string>('');
  const [isHKDView, setIsHKDView] = useState(false);

  // --- 事件处理 ---

  // 基础参数变更
  const handleBasicChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      const { name, value } = e.target;
      
      // 如果值为空字符串，直接设置为空字符串
      if (value === '') {
          setBasicParams(prev => ({ ...prev, [name]: '' }));
          return;
      }

      let parsedValue: any = value;

      if (['total_notional', 'denomination', 'coupon_freq', 'n_sims', 'fx_rate', 'seed'].includes(name)) {
          const floatVal = parseFloat(value);
          parsedValue = isNaN(floatVal) ? '' : floatVal;
      }

      setBasicParams(prev => ({ ...prev, [name]: parsedValue }));
  };

  // 百分比参数变更 (输入 82.5 -> 存储 0.825)
  const handlePercentChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const { name, value } = e.target;
      
      if (value === '') {
          setBasicParams(prev => ({ ...prev, [name]: '' }));
          return;
      }

      const floatVal = parseFloat(value);
      setBasicParams(prev => ({
          ...prev,
          [name]: isNaN(floatVal) ? '' : floatVal / 100
      }));
  };

  // 标的表格操作
  const addUnderlyingRow = () => {
      setUnderlyingRows([...underlyingRows, {
          id: Math.random().toString(36).substr(2, 9),
          ticker: '', name: '', initialPrice: '', currentPrice: '', dividendDate: '', dividendAmount: ''
      }]);
  };
  const removeUnderlyingRow = (id: string) => {
      setUnderlyingRows(underlyingRows.filter(r => r.id !== id));
  };
  const updateUnderlyingRow = (id: string, field: keyof UnderlyingRow, value: string) => {
      setUnderlyingRows(underlyingRows.map(r => r.id === id ? { ...r, [field]: value } : r));
  };

  // 日期表格操作
  const addDateRow = () => {
      setDateRows([...dateRows, {
          id: Math.random().toString(36).substr(2, 9),
          obsDate: '', payDate: ''
      }]);
  };
  const removeDateRow = (id: string) => {
      setDateRows(dateRows.filter(r => r.id !== id));
  };
  const updateDateRow = (id: string, field: keyof DateRow, value: string) => {
      setDateRows(dateRows.map(r => r.id === id ? { ...r, [field]: value } : r));
  };

  // API 获取报价
  const fetchQuotePrice = async (symbol: string): Promise<number | null> => {
      try {
          const apiUrl = `/api/quote?symbol=${symbol}`;
          const response = await fetch(apiUrl);
          if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
          const data = await response.json();
          const price = data.regularMarketPrice || data.price || data.close;
          return typeof price === 'number' ? price : null;
      } catch (e) {
          console.error(`Failed to fetch quote for ${symbol}:`, e);
          return null;
      }
  };

  // 计算主逻辑
  const handleCalculate = async () => {
    setLoading(true);
    setFetchStatus('参数解析中...');

    setTimeout(async () => {
        try {
            // 校验必填项
            if (!basicParams.total_notional) throw new Error("请输入总名义本金");
            if (!basicParams.denomination) throw new Error("请输入单张面值");
            if (!basicParams.trade_date) throw new Error("请选择交易日期");
            if (basicParams.strike_pct === '') throw new Error("请输入敲入界限");
            if (basicParams.trigger_pct === '') throw new Error("请输入敲出界限");
            if (basicParams.coupon_rate === '') throw new Error("请输入年化票息");

            // 1. 构建 FCNParams 对象
            const tickers: string[] = [];
            const ticker_names: string[] = [];
            const initial_spots: number[] = [];
            const current_spots_manual: (number | null)[] = [];
            const discrete_dividends: { [key: string]: [string, number][] } = {};

            const processedTickers = new Set<string>();
            
            for (const row of underlyingRows) {
                if (!row.ticker) continue;
                
                // 收集分红
                const divAmt = parseFloat(row.dividendAmount);
                if (row.dividendDate && row.dividendAmount && !isNaN(divAmt)) {
                    if (!discrete_dividends[row.ticker]) discrete_dividends[row.ticker] = [];
                    discrete_dividends[row.ticker].push([row.dividendDate, divAmt]);
                }

                // 收集基础信息
                if (!processedTickers.has(row.ticker)) {
                    processedTickers.add(row.ticker);
                    tickers.push(row.ticker);
                    ticker_names.push(row.name);
                    
                    const initP = parseFloat(row.initialPrice);
                    if (isNaN(initP)) throw new Error(`标的 ${row.ticker} 初始价格无效`);
                    initial_spots.push(initP);
                    
                    const cp = parseFloat(row.currentPrice);
                    current_spots_manual.push(isNaN(cp) ? null : cp);
                }
            }

            const obs_dates = dateRows.map(r => r.obsDate).filter(d => d);
            const pay_dates = dateRows.map(r => r.payDate).filter(d => d);

            // 基础校验
            if (tickers.length === 0) { throw new Error("请至少添加一个标的"); }
            if (obs_dates.length === 0) { throw new Error("请至少添加一个观察日"); }
            if (basicParams.history_start_date && basicParams.trade_date && basicParams.history_start_date >= basicParams.trade_date) {
                throw new Error("历史数据起始日必须早于交易日");
            }

            const calcParams: FCNParams = {
                ...basicParams,
                tickers,
                ticker_name: ticker_names,
                initial_spots,
                current_spots: [], 
                discrete_dividends,
                obs_dates,
                pay_dates,
                // 处理可能为空的数字字段，赋予默认值或保留 undefined
                fx_rate: basicParams.fx_rate === '' ? undefined : (basicParams.fx_rate as number),
                seed: basicParams.seed === '' ? undefined : (basicParams.seed as number),
                n_sims: basicParams.n_sims === '' ? 5000 : (basicParams.n_sims as number), // 默认 5000
                coupon_freq: basicParams.coupon_freq === '' ? 12 : (basicParams.coupon_freq as number),
                risk_free_rate: basicParams.risk_free_rate === '' ? 0.03 : (basicParams.risk_free_rate as number), // 默认 3%
                total_notional: Number(basicParams.total_notional),
                denomination: Number(basicParams.denomination),
                strike_pct: Number(basicParams.strike_pct),
                trigger_pct: Number(basicParams.trigger_pct),
                coupon_rate: Number(basicParams.coupon_rate),
            } as FCNParams;

            // 2. 自动抓取价格
            setFetchStatus('正在检查股价...');
            const spotPromises = tickers.map(async (t, i) => {
                const manual = current_spots_manual[i];
                if (manual !== null) return manual;
                setFetchStatus(`正在获取 ${t} 最新价格...`);
                const p = await fetchQuotePrice(t);
                return p !== null ? p : initial_spots[i]; 
            });

            const fetchedSpots = await Promise.all(spotPromises);
            calcParams.current_spots = fetchedSpots;

            // Update underlyingRows state with fetched prices so UI reflects them
            // Note: We need to map back to rows. Tickers might appear multiple times if dividends are split rows.
            setUnderlyingRows(prevRows => prevRows.map(row => {
                const tIdx = tickers.indexOf(row.ticker);
                if (tIdx !== -1 && fetchedSpots[tIdx] !== undefined) {
                    // Only update if currentPrice was empty (auto-fetch)
                    if (!row.currentPrice) {
                        return { ...row, currentPrice: fetchedSpots[tIdx].toString() };
                    }
                }
                return row;
            }));

            // 3. 自动抓取汇率
            if (calcParams.market !== 'HKD' && (!calcParams.fx_rate || isNaN(calcParams.fx_rate))) {
                setFetchStatus(`正在获取 ${calcParams.market}/HKD 汇率...`);
                const fxSymbol = `${calcParams.market}HKD=X`;
                const rate = await fetchQuotePrice(fxSymbol);
                calcParams.fx_rate = rate !== null ? rate : 1.0;
                setBasicParams(prev => ({ ...prev, fx_rate: calcParams.fx_rate || '' })); // 更新 UI
            } else if (calcParams.market === 'HKD') {
                calcParams.fx_rate = 1.0;
            }

            // 4. 运行模拟
            setFetchStatus('正在进行蒙特卡洛模拟...');
            setTimeout(() => {
                try {
                    const pricer = new FCNPricer(calcParams);
                    const res = pricer.simulate_price();
                    setFcnResult(res);
                } catch (calcError) {
                    console.error(calcError);
                    alert("计算错误，请检查参数 (例如日期格式、矩阵正定性等)");
                } finally {
                    setLoading(false);
                    setFetchStatus('');
                }
            }, 50);

        } catch (e: any) {
            console.error(e);
            alert(e.message || "流程出错");
            setLoading(false);
            setFetchStatus('');
        }
    }, 10);
  };

  // --- 格式化工具 ---
  const fmtPct = (val: number) => (val * 100).toFixed(2) + '%';
  const getDisplayCurrency = () => isHKDView ? 'HKD' : (basicParams.market || 'HKD');
  const getDisplayValue = (val: number) => {
      const rate = typeof basicParams.fx_rate === 'number' ? basicParams.fx_rate : 1.0;
      if (isHKDView) return val * rate;
      return val;
  };
  const fmtMoney = (val: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: getDisplayCurrency() }).format(val);
  const calcExpectedCouponPeriods = (res: FCNResult) => {
      const total_return = res.hist_coupons_paid + res.pending_coupons_pv + res.future_coupons_pv;
      return res.avg_period_coupon > 0 ? total_return / res.avg_period_coupon : 0;
  }

  // 辅助：从 underlyingRows 提取唯一的 ticker 列表用于显示
  const getUniqueTickersForDisplay = () => {
      const seen = new Set();
      return underlyingRows.filter(row => {
          const duplicate = seen.has(row.ticker);
          if (row.ticker) seen.add(row.ticker);
          return !duplicate && row.ticker; 
      });
  };

  // Helper to format percentage for input (0.825 -> "82.5")
  const pctToInput = (val: number | string) => {
      if (val === '' || val === undefined) return '';
      return parseFloat((Number(val) * 100).toFixed(4)).toString();
  };

  // Helper to get status display info (适配新状态类型)
  const getStatusDisplay = (status: FCNResult['status']) => {
      switch (status) {
          case 'Active': return { text: '存续中', color: 'bg-green-100 text-green-800' };
          case 'Settling_NoDelivery': return { text: '结算中 (无接货)', color: 'bg-blue-100 text-blue-800' };
          case 'Settling_Delivery': return { text: '结算中 (有接货)', color: 'bg-orange-100 text-orange-800' };
          case 'Terminated_Early': return { text: '已结束 (提前敲出)', color: 'bg-gray-100 text-gray-800' };
          case 'Terminated_Normal': return { text: '已结束 (自然到期)', color: 'bg-gray-100 text-gray-800' };
          case 'Terminated_Delivery': return { text: '已结束 (已接货)', color: 'bg-gray-100 text-gray-800' };
          default: return { text: status, color: 'bg-gray-100 text-gray-800' };
      }
  };

  // 判断是否应该显示累计总损益
  const shouldShowTotalPL = (status: FCNResult['status']) => {
      // 只要不是以 'Terminated' 开头的状态，都显示
      return !status.startsWith('Terminated');
  };

  // 判断是否应该显示接货风险归因
  const shouldShowRiskAttribution = (res: FCNResult) => {
      // 只有【存续中】才展示【接货风险归因】
      // 即使是 'Settling_Delivery' 或 loss_prob > 0，如果不是 Active 也不展示
      return res.status === 'Active' && res.loss_prob > 0;
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* 顶部标题栏 */}
        <div className="mb-8 flex flex-col md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">衍生品测算</h1>
              <p className="mt-2 text-sm text-gray-500">结构化产品定价与风险分析模型</p>
            </div>
            <div className="mt-4 md:mt-0 flex bg-gray-200 rounded-lg p-1 self-start">
                <button onClick={() => setActiveTab('FCN')} className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${activeTab === 'FCN' ? 'bg-white text-gray-900 shadow' : 'text-gray-500'}`}>FCN</button>
                <button onClick={() => setActiveTab('DQ/AQ')} className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${activeTab === 'DQ/AQ' ? 'bg-white text-gray-900 shadow' : 'text-gray-500'}`}>DQ/AQ</button>
            </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* === 左侧：参数输入表单 === */}
          <div className="lg:col-span-1 bg-white shadow rounded-lg p-5 max-h-[1200px] overflow-y-auto space-y-6">
             
             {activeTab === 'FCN' ? (
                 <>
                     {/* 1. 基础信息 & 结构参数 */}
                     <div>
                         <h3 className="text-sm font-bold text-gray-800 border-l-4 border-blue-500 pl-2 mb-3">1. 基础信息</h3>
                         <div className="grid grid-cols-2 gap-3 text-xs">
                             <div>
                                 <label className="block text-gray-600 mb-1">券商 (Broker)</label>
                                 <input type="text" name="broker_name" value={basicParams.broker_name} onChange={handleBasicChange} placeholder={EXAMPLE_PARAMS.broker_name} className="w-full border-gray-300 rounded shadow-sm border p-1.5" />
                             </div>
                             <div>
                                 <label className="block text-gray-600 mb-1">计价货币</label>
                                 <select name="market" value={basicParams.market} onChange={handleBasicChange} className="w-full border-gray-300 rounded shadow-sm border p-1.5">
                                     <option value="HKD">HKD</option>
                                     <option value="USD">USD</option>
                                     <option value="CNY">CNY</option>
                                 </select>
                             </div>
                             <div>
                                 <label className="block text-gray-600 mb-1">总名义本金</label>
                                 <input type="number" name="total_notional" value={basicParams.total_notional} onChange={handleBasicChange} placeholder={EXAMPLE_PARAMS.total_notional.toString()} className="w-full border-gray-300 rounded shadow-sm border p-1.5" />
                             </div>
                             <div>
                                 <label className="block text-gray-600 mb-1">单张面值</label>
                                 <input type="number" name="denomination" value={basicParams.denomination} onChange={handleBasicChange} placeholder={EXAMPLE_PARAMS.denomination.toString()} className="w-full border-gray-300 rounded shadow-sm border p-1.5" />
                             </div>
                             <div className="col-span-2">
                                 <label className="block text-gray-600 mb-1">交易日期 (Trade Date)</label>
                                 <input type="date" name="trade_date" value={basicParams.trade_date} onChange={handleBasicChange} placeholder={EXAMPLE_PARAMS.trade_date} className="w-full border-gray-300 rounded shadow-sm border p-1.5" />
                             </div>
                             {/* 结构参数紧跟基础信息 */}
                             <div>
                                 <label className="block text-gray-600 mb-1">敲出界限 (%)</label>
                                 <input type="number" step="0.01" name="trigger_pct" value={pctToInput(basicParams.trigger_pct)} onChange={handlePercentChange} placeholder={(EXAMPLE_PARAMS.trigger_pct * 100).toString()} className="w-full border-gray-300 rounded shadow-sm border p-1.5" />
                             </div>
                             <div>
                                 <label className="block text-gray-600 mb-1">敲入界限 (%)</label>
                                 <input type="number" step="0.01" name="strike_pct" value={pctToInput(basicParams.strike_pct)} onChange={handlePercentChange} placeholder={(EXAMPLE_PARAMS.strike_pct * 100).toString()} className="w-full border-gray-300 rounded shadow-sm border p-1.5" />
                             </div>
                             <div>
                                 <label className="block text-gray-600 mb-1">年化票息 (%)</label>
                                 <input type="number" step="0.01" name="coupon_rate" value={pctToInput(basicParams.coupon_rate)} onChange={handlePercentChange} placeholder={(EXAMPLE_PARAMS.coupon_rate * 100).toString()} className="w-full border-gray-300 rounded shadow-sm border p-1.5" />
                             </div>
                         </div>
                     </div>

                     {/* 2. 标的信息 (动态表格) */}
                     <div>
                         <div className="flex justify-between items-center mb-2">
                             <h3 className="text-sm font-bold text-gray-800 border-l-4 border-blue-500 pl-2">2. 标的信息</h3>
                             <button onClick={addUnderlyingRow} className="text-xs text-blue-600 hover:text-blue-800">+ 添加标的</button>
                         </div>
                         <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                             {underlyingRows.map((row, idx) => {
                                 // 为 placeholder 获取示例数据 (如果存在)
                                 const exampleTicker = EXAMPLE_PARAMS.tickers[idx] || '9988.HK';
                                 const exampleName = EXAMPLE_PARAMS.ticker_name?.[idx] || '阿里';
                                 const examplePrice = EXAMPLE_PARAMS.initial_spots[idx] || '100';
                                 
                                 return (
                                     <div key={row.id} className="bg-gray-50 p-2 rounded border border-gray-200 text-xs">
                                         <div className="grid grid-cols-2 gap-2 mb-2">
                                             <input placeholder={`代码 (如 ${exampleTicker})`} value={row.ticker} onChange={(e) => updateUnderlyingRow(row.id, 'ticker', e.target.value)} className="border-gray-300 rounded p-1" />
                                             <input placeholder={`名称 (如 ${exampleName})`} value={row.name} onChange={(e) => updateUnderlyingRow(row.id, 'name', e.target.value)} className="border-gray-300 rounded p-1" />
                                         </div>
                                         <div className="grid grid-cols-2 gap-2 mb-2">
                                             <input type="number" placeholder={`初始价 (${examplePrice})`} value={row.initialPrice} onChange={(e) => updateUnderlyingRow(row.id, 'initialPrice', e.target.value)} className="border-gray-300 rounded p-1" />
                                             <input type="number" placeholder="当前价 (留白自动)" value={row.currentPrice} onChange={(e) => updateUnderlyingRow(row.id, 'currentPrice', e.target.value)} className="border-gray-300 rounded p-1 bg-blue-50" />
                                         </div>
                                         <div className="grid grid-cols-5 gap-2 items-center">
                                             <div className="col-span-2">
                                                <input type="date" placeholder="分红日期" value={row.dividendDate} onChange={(e) => updateUnderlyingRow(row.id, 'dividendDate', e.target.value)} className="w-full border-gray-300 rounded p-1" />
                                             </div>
                                             <div className="col-span-2">
                                                <input type="number" step="0.01" placeholder="分红金额" value={row.dividendAmount} onChange={(e) => updateUnderlyingRow(row.id, 'dividendAmount', e.target.value)} className="w-full border-gray-300 rounded p-1" />
                                             </div>
                                             <button onClick={() => removeUnderlyingRow(row.id)} className="text-red-500 hover:text-red-700 text-center">删</button>
                                         </div>
                                     </div>
                                 );
                             })}
                         </div>
                     </div>

                     {/* 3. 日期信息 (动态表格) */}
                     <div>
                         <div className="flex justify-between items-center mb-2">
                             <h3 className="text-sm font-bold text-gray-800 border-l-4 border-blue-500 pl-2">3. 日期信息</h3>
                             <button onClick={addDateRow} className="text-xs text-blue-600 hover:text-blue-800">+ 添加日期</button>
                         </div>
                         <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
                             <div className="grid grid-cols-7 gap-1 text-xs font-medium text-gray-500 px-1">
                                 <span className="col-span-3">观察日</span>
                                 <span className="col-span-3">支付日</span>
                                 <span className="col-span-1 text-center">操作</span>
                             </div>
                             {dateRows.map((row, idx) => (
                                 <div key={row.id} className="grid grid-cols-7 gap-1 items-center">
                                     <input type="date" value={row.obsDate} onChange={(e) => updateDateRow(row.id, 'obsDate', e.target.value)} className="col-span-3 text-xs border-gray-300 rounded p-1" />
                                     <input type="date" value={row.payDate} onChange={(e) => updateDateRow(row.id, 'payDate', e.target.value)} className="col-span-3 text-xs border-gray-300 rounded p-1" />
                                     <button onClick={() => removeDateRow(row.id)} className="col-span-1 text-red-500 hover:text-red-700 text-xs text-center">删</button>
                                 </div>
                             ))}
                         </div>
                     </div>

                     {/* 4. 模拟信息 */}
                     <div>
                         <h3 className="text-sm font-bold text-gray-800 border-l-4 border-blue-500 pl-2 mb-3">4. 模拟信息</h3>
                         <div className="grid grid-cols-2 gap-3 text-xs">
                             <div>
                                 <label className="block text-gray-600 mb-1">模拟汇率 (To HKD)</label>
                                 <input type="number" step="0.0001" name="fx_rate" value={basicParams.fx_rate} onChange={handleBasicChange} placeholder="自动" className="w-full border-gray-300 rounded shadow-sm border p-1.5" />
                             </div>
                             <div>
                                 <label className="block text-gray-600 mb-1">历史数据起始日</label>
                                 <input type="date" name="history_start_date" value={basicParams.history_start_date} max={basicParams.trade_date} onChange={handleBasicChange} className="w-full border-gray-300 rounded shadow-sm border p-1.5" />
                             </div>
                             <div>
                                 <label className="block text-gray-600 mb-1">模拟次数</label>
                                 <input type="number" name="n_sims" value={basicParams.n_sims} onChange={handleBasicChange} placeholder={EXAMPLE_PARAMS.n_sims.toString()} className="w-full border-gray-300 rounded shadow-sm border p-1.5" />
                             </div>
                             <div>
                                 <label className="block text-gray-600 mb-1">随机种子 (Seed)</label>
                                 <input type="number" name="seed" value={basicParams.seed} onChange={handleBasicChange} placeholder="随机" className="w-full border-gray-300 rounded shadow-sm border p-1.5" />
                             </div>
                             <div>
                                 <label className="block text-gray-600 mb-1">无风险利率 (%)</label>
                                 <input type="number" step="0.01" name="risk_free_rate" value={pctToInput(basicParams.risk_free_rate)} onChange={handlePercentChange} placeholder={(EXAMPLE_PARAMS.risk_free_rate * 100).toString()} className="w-full border-gray-300 rounded shadow-sm border p-1.5" />
                             </div>
                         </div>
                     </div>

                     <button
                        onClick={handleCalculate}
                        disabled={loading}
                        className={`w-full py-3 px-4 rounded-md text-white font-medium transition-colors shadow-sm flex justify-center items-center ${
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
                 </>
             ) : (
                 <div className="text-center text-gray-400 py-10">DQ/AQ 引擎开发中...</div>
             )}
          </div>

          {/* === 右侧：结果展示 (保持不变) === */}
          <div className="lg:col-span-2 bg-white shadow rounded-lg p-6 min-h-[600px]">
             {fcnResult ? (
                 <div className="space-y-6 animate-fadeIn">
                     <div className="border-b border-gray-200 pb-4">
                         <div className="flex justify-between items-start">
                             <div>
                                 <h2 className="text-xl font-bold text-gray-900">FCN 估值报告</h2>
                                 <p className="text-sm text-gray-500 mt-1">{fcnResult.product_name_display}</p>
                             </div>
                             <button onClick={() => setIsHKDView(!isHKDView)} className={`px-3 py-1 text-xs font-medium rounded border transition-colors ${isHKDView ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}>
                                 {isHKDView ? '已转为 HKD' : 'HKD 转换'}
                             </button>
                         </div>
                         <div className="mt-2 flex items-center space-x-2">
                             {/* 状态 Badge */}
                             <span className={`px-2 py-1 rounded text-xs font-semibold ${getStatusDisplay(fcnResult.status).color}`}>
                                 {getStatusDisplay(fcnResult.status).text}
                             </span>
                             <span className="text-xs text-gray-400">{new Date().toLocaleString()}</span>
                         </div>
                         {fcnResult.status === 'Active' && (
                             <div className="mt-2 text-sm text-gray-600">预期收息期数: <span className="font-semibold">{calcExpectedCouponPeriods(fcnResult).toFixed(2)} 期</span></div>
                         )}
                     </div>

                     {fcnResult.status !== 'Active' && fcnResult.settlement_info && (
                         <div className="bg-orange-50 border-l-4 border-orange-400 p-4 mb-4">
                             <p className="text-sm text-orange-700">{fcnResult.settlement_info.desc}</p>
                         </div>
                     )}

                     <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                         <div className="bg-gray-50 p-4 rounded-lg">
                             <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-3">单价估值 (Par={basicParams.denomination})</h3>
                             <div className="space-y-2 text-sm text-gray-700">
                                 <div className="flex justify-between"><span>全价</span><span className="font-semibold">{(fcnResult.dirty_price + fcnResult.hist_coupons_paid).toFixed(2)}</span></div>
                                 <div className="flex justify-between"><span>现值 (Dirty)</span><span className="font-bold text-blue-600">{fcnResult.dirty_price.toFixed(2)}</span></div>
                                 <div className="text-xs text-right text-gray-400">本金 {(fcnResult.principal_pv).toFixed(2)} + 待付/未来票息 {(fcnResult.pending_coupons_pv + fcnResult.future_coupons_pv).toFixed(2)}</div>
                             </div>
                         </div>

                         <div className="bg-gray-50 p-4 rounded-lg">
                             <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-3">持仓损益 ({getDisplayCurrency()})</h3>
                             <div className="space-y-2 text-sm text-gray-700">
                                 <div className="flex justify-between"><span>总名义本金</span><span>{fmtMoney(Number(basicParams.total_notional))}</span></div>
                                 <div className="flex justify-between"><span>当前市值</span><span className="font-semibold">{fmtMoney(getDisplayValue(fcnResult.dirty_price * (Number(basicParams.total_notional) / Number(basicParams.denomination))))}</span></div>
                                 <div className="flex justify-between text-gray-600"><span>已实现票息</span><span>{fmtMoney(getDisplayValue(fcnResult.hist_coupons_paid * (Number(basicParams.total_notional) / Number(basicParams.denomination))))}</span></div>
                                 <div className="flex justify-between text-gray-600"><span>未实现损益</span><span>{fmtMoney(getDisplayValue(((fcnResult.pending_coupons_pv + fcnResult.future_coupons_pv) - fcnResult.implied_loss_pv) * (Number(basicParams.total_notional) / Number(basicParams.denomination))))}</span></div>
                                 
                                 {shouldShowTotalPL(fcnResult.status) && (
                                     <div className="border-t border-gray-200 my-2 pt-2 flex justify-between font-bold"><span>累计总损益</span><span className={(fcnResult.dirty_price + fcnResult.hist_coupons_paid - Number(basicParams.denomination)) >= 0 ? 'text-green-600' : 'text-red-600'}>{fmtMoney(getDisplayValue((fcnResult.dirty_price + fcnResult.hist_coupons_paid - Number(basicParams.denomination)) * (Number(basicParams.total_notional) / Number(basicParams.denomination))))}</span></div>
                                 )}
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
                             <div className="overflow-x-auto"><table className="min-w-full divide-y divide-gray-200 text-sm"><thead><tr><th className="px-3 py-2 text-left font-medium text-gray-500">期数</th><th className="px-3 py-2 text-left font-medium text-gray-500">观察日</th><th className="px-3 py-2 text-right font-medium text-gray-500">概率</th></tr></thead><tbody className="divide-y divide-gray-200">{fcnResult.autocall_attribution.map((prob, idx) => { if (prob <= 0.0001) return null; const today = new Date(); today.setHours(0,0,0,0); const futureDates = fcnResult.status === 'Active' ? dateRows.map(r => r.obsDate).filter(d => new Date(d) > today) : []; const dateStr = futureDates[idx] || `Future Obs ${idx+1}`; return (<tr key={idx}><td className="px-3 py-2 text-gray-900">未来第 {idx + 1} 个观察日</td><td className="px-3 py-2 text-gray-500">{dateStr}</td><td className="px-3 py-2 text-right">{fmtPct(prob)}</td></tr>); })}</tbody></table></div>
                         </div>
                     )}

                     {shouldShowRiskAttribution(fcnResult) && (
                         <div>
                             <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-3">接货风险归因</h3>
                             <div className="overflow-x-auto"><table className="min-w-full divide-y divide-gray-200 text-sm"><thead><tr><th className="px-3 py-2 text-left font-medium text-gray-500">标的</th><th className="px-3 py-2 text-right font-medium text-gray-500">归因概率</th><th className="px-3 py-2 text-right font-medium text-gray-500">接货股数 (Avg)</th><th className="px-3 py-2 text-right font-medium text-gray-500">接货市值 (Avg)</th></tr></thead><tbody className="divide-y divide-gray-200">
                                 {getUniqueTickersForDisplay().map((row, idx) => (
                                     <tr key={row.ticker}>
                                         <td className="px-3 py-2 text-gray-900">{row.name || row.ticker}<span className="block text-xs text-gray-400">{row.ticker}</span></td>
                                         <td className="px-3 py-2 text-right">{fmtPct(fcnResult.loss_attribution[idx])}</td>
                                         <td className="px-3 py-2 text-right">{(fcnResult.exposure_shares_avg[idx] * (Number(basicParams.total_notional) / Number(basicParams.denomination))).toFixed(0)}</td>
                                         <td className="px-3 py-2 text-right">{fmtMoney(getDisplayValue(fcnResult.exposure_value_avg[idx] * (Number(basicParams.total_notional) / Number(basicParams.denomination))))}</td>
                                     </tr>
                                 ))}
                             </tbody></table></div>
                         </div>
                     )}

                     {/* 股价点位图 */}
                     {fcnResult.status === 'Active' && (
                        <div className="mt-6">
                            <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-3">股价点位图</h3>
                            <div className="space-y-6">
                                {getUniqueTickersForDisplay().map((row, idx) => {
                                    // 查找当前标的在计算参数中的索引
                                    const paramIdx = getUniqueTickersForDisplay().indexOf(row);
                                    if (paramIdx === -1) return null;

                                    const initial = parseFloat(row.initialPrice);
                                    const current = parseFloat(row.currentPrice) || initial;
                                    const strike = initial * (Number(basicParams.strike_pct) || 0); 
                                    const ko = initial * (Number(basicParams.trigger_pct) || 0);

                                    // Left: (Strike / Current) - 1. If > 0 (Current < Strike), Red.
                                    const leftPct = (strike / current) - 1;
                                    
                                    // Right: (KO / Current) - 1. If < 0 (Current > KO), Yellow.
                                    const rightPct = (ko / current) - 1;
                                    
                                    // Bar Chart Range
                                    // 动态计算范围，确保所有点都在可视区域内，并留有 buffer
                                    const values = [strike, current, ko];
                                    const minVal = Math.min(...values) * 0.85; // 稍微放宽一点范围
                                    const maxVal = Math.max(...values) * 1.15;
                                    const range = maxVal - minVal;
                                    
                                    const getPos = (val: number) => ((val - minVal) / range) * 100;

                                    return (
                                        <div key={row.ticker} className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm">
                                            <div className="flex justify-between items-end mb-4">
                                                <div>
                                                    <span className="text-lg font-bold text-gray-800 mr-2">{row.name || row.ticker}</span>
                                                    <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">{row.ticker}</span>
                                                </div>
                                                <div className="text-right">
                                                    <span className="text-xs text-gray-500 mr-1">现价</span>
                                                    <span className="text-base font-semibold text-gray-900">{current.toFixed(2)}</span>
                                                </div>
                                            </div>
                                            
                                            <div className="flex items-center gap-4">
                                                {/* Left Indicator (距敲入) */}
                                                <div className={`flex flex-col items-center justify-center w-24 h-16 rounded-lg border-2 transition-colors ${leftPct > 0 ? 'bg-red-50 border-red-500 text-red-700' : 'bg-white border-gray-100 text-gray-400'}`}>
                                                    <span className="text-[10px] font-semibold uppercase tracking-wider">距敲入</span>
                                                    <span className="text-lg font-bold">{fmtPct(leftPct)}</span>
                                                </div>

                                                {/* Bar Chart Container */}
                                                <div className="flex-1 relative h-16 mx-4 select-none">
                                                    {/* Base Line (Track) */}
                                                    <div className="absolute top-1/2 left-0 right-0 h-1.5 bg-gray-100 rounded-full transform -translate-y-1/2"></div>
                                                    
                                                    {/* Active Zone (Strike to KO) */}
                                                     <div 
                                                        className="absolute top-1/2 h-1.5 bg-blue-50 transform -translate-y-1/2"
                                                        style={{ 
                                                            left: `${getPos(strike)}%`, 
                                                            width: `${getPos(ko) - getPos(strike)}%` 
                                                        }}
                                                    ></div>

                                                    {/* Strike Marker */}
                                                    <div className="absolute top-1/2" style={{ left: `${getPos(strike)}%` }}>
                                                        {/* Dot centered on line */}
                                                        <div className="absolute transform -translate-x-1/2 -translate-y-1/2 w-3 h-3 bg-red-500 border-2 border-white rounded-full shadow z-10"></div>
                                                        {/* Label below */}
                                                        <div className="absolute transform -translate-x-1/2 translate-y-3 flex flex-col items-center w-max">
                                                            <span className="text-[10px] text-red-600 font-bold">Strike</span>
                                                            <span className="text-[9px] text-gray-400">{strike.toFixed(2)}</span>
                                                        </div>
                                                    </div>

                                                    {/* KO Marker */}
                                                    <div className="absolute top-1/2" style={{ left: `${getPos(ko)}%` }}>
                                                        {/* Dot centered on line */}
                                                        <div className="absolute transform -translate-x-1/2 -translate-y-1/2 w-3 h-3 bg-green-500 border-2 border-white rounded-full shadow z-10"></div>
                                                        {/* Label below */}
                                                        <div className="absolute transform -translate-x-1/2 translate-y-3 flex flex-col items-center w-max">
                                                            <span className="text-[10px] text-green-600 font-bold">KO</span>
                                                            <span className="text-[9px] text-gray-400">{ko.toFixed(2)}</span>
                                                        </div>
                                                    </div>

                                                    {/* Current Price Marker */}
                                                     <div className="absolute top-1/2" style={{ left: `${getPos(current)}%` }}>
                                                        {/* Dot centered on line */}
                                                        <div className="absolute transform -translate-x-1/2 -translate-y-1/2 w-4 h-4 bg-purple-600 border-2 border-white rounded-full shadow-lg z-20 ring-4 ring-purple-100"></div>
                                                        {/* Label Above */}
                                                        <div className="absolute transform -translate-x-1/2 -translate-y-full -top-3 flex flex-col items-center w-max">
                                                            <span className="bg-purple-600 text-white text-[10px] px-1.5 py-0.5 rounded shadow-sm font-bold">Now</span>
                                                        </div>
                                                    </div>
                                                </div>

                                                {/* Right Indicator (距敲出) */}
                                                <div className={`flex flex-col items-center justify-center w-24 h-16 rounded-lg border-2 transition-colors ${rightPct < 0 ? 'bg-yellow-50 border-yellow-400 text-yellow-700' : 'bg-white border-gray-100 text-gray-400'}`}>
                                                    <span className="text-[10px] font-semibold uppercase tracking-wider">距敲出</span>
                                                    <span className="text-lg font-bold">{fmtPct(rightPct)}</span>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                     )}

                 </div>
             ) : (
                 <div className="h-full flex flex-col items-center justify-center text-gray-400">
                    <svg className="w-16 h-16 mb-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                    <p className="text-lg">请点击左侧 "开始测算" 运行模型</p>
                    <p className="text-sm mt-2">基于 {Number(basicParams.n_sims) || 5000} 次蒙特卡洛模拟</p>
                 </div>
             )}
          </div>
        </div>
      </div>
    </div>
  );
}