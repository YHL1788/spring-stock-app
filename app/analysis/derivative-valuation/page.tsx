"use client";

import React, { useState, useEffect } from 'react';
import { FCNPricer, FCNParams, FCNResult } from '@/app/lib/fcnPricer';

// ... existing code ... (UnderlyingRow, DateRow interfaces, EXAMPLE_PARAMS, etc.)
// ... (basicParams state, underlyingRows state, dateRows state, etc.)

// --- 类型定义 ---
interface UnderlyingRow {
    id: string;
    ticker: string;
    name: string;
    initialPrice: string;
    currentPrice: string;
    dividendDate: string;
    dividendAmount: string;
}

interface DateRow {
    id: string;
    obsDate: string;
    payDate: string;
}

interface TransactionRecord {
    date: string;
    account: string;
    market: string;
    executor: string;
    type: string;
    stockCode: string;
    stockName: string;
    direction: string;
    quantity: number;
    priceNoFee: number;
    amountNoFee: number;
    fee: number;
    amountWithFee: number;
    priceWithFee: number;
    hkdAmount: number;
}

// 示例参数 (用于 Placeholder 提示)
const EXAMPLE_PARAMS: FCNParams & { executor?: string } = {
    // ... same as before
    broker_name: "MS",
    account_name: "FUTU",
    executor: "Jerry", 
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
  
  // ... (Existing states for basicParams, underlyingRows, dateRows, fcnResult, loading, fetchStatus, isHKDView)
  const [basicParams, setBasicParams] = useState({
      broker_name: '',
      account_name: '', 
      executor: '', 
      market: 'HKD',
      total_notional: '' as number | string,
      denomination: '' as number | string,
      trade_date: '',
      strike_pct: '' as number | string,
      trigger_pct: '' as number | string,
      coupon_rate: '' as number | string,
      coupon_freq: '' as number | string,
      risk_free_rate: '' as number | string,
      fx_rate: '' as number | string, 
      history_start_date: '',
      n_sims: '' as number | string,
      seed: '' as number | string 
  });
  
  const [underlyingRows, setUnderlyingRows] = useState<UnderlyingRow[]>([{
      id: 'init_1',
      ticker: '',
      name: '',
      initialPrice: '',
      currentPrice: '',
      dividendDate: '',
      dividendAmount: ''
  }]);

  const [dateRows, setDateRows] = useState<DateRow[]>([{
      id: 'init_d1',
      obsDate: '',
      payDate: ''
  }]);

  const [fcnResult, setFcnResult] = useState<FCNResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchStatus, setFetchStatus] = useState<string>('');
  const [isHKDView, setIsHKDView] = useState(false);

  // New state for Transaction Record
  const [txRecord, setTxRecord] = useState<TransactionRecord | null>(null);
  const [isEditingTx, setIsEditingTx] = useState(false);

  // ... (Existing handlers: handleBasicChange, handlePercentChange, add/remove/update Rows, fetchQuotePrice, handleCalculate)
  // ... (Formatters: fmtPct, getDisplayCurrency, etc.)

  const handleBasicChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      const { name, value } = e.target;
      if (value === '') { setBasicParams(prev => ({ ...prev, [name]: '' })); return; }
      let parsedValue: any = value;
      if (['total_notional', 'denomination', 'coupon_freq', 'n_sims', 'fx_rate', 'seed'].includes(name)) {
          const floatVal = parseFloat(value);
          parsedValue = isNaN(floatVal) ? '' : floatVal;
      }
      setBasicParams(prev => ({ ...prev, [name]: parsedValue }));
  };

  const handlePercentChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const { name, value } = e.target;
      if (value === '') { setBasicParams(prev => ({ ...prev, [name]: '' })); return; }
      const floatVal = parseFloat(value);
      setBasicParams(prev => ({ ...prev, [name]: isNaN(floatVal) ? '' : floatVal / 100 }));
  };

  const addUnderlyingRow = () => {
      setUnderlyingRows([...underlyingRows, { id: Math.random().toString(36).substr(2, 9), ticker: '', name: '', initialPrice: '', currentPrice: '', dividendDate: '', dividendAmount: '' }]);
  };
  const removeUnderlyingRow = (id: string) => { setUnderlyingRows(underlyingRows.filter(r => r.id !== id)); };
  const updateUnderlyingRow = (id: string, field: keyof UnderlyingRow, value: string) => {
      setUnderlyingRows(underlyingRows.map(r => r.id === id ? { ...r, [field]: value } : r));
  };

  const addDateRow = () => { setDateRows([...dateRows, { id: Math.random().toString(36).substr(2, 9), obsDate: '', payDate: '' }]); };
  const removeDateRow = (id: string) => { setDateRows(dateRows.filter(r => r.id !== id)); };
  const updateDateRow = (id: string, field: keyof DateRow, value: string) => { setDateRows(dateRows.map(r => r.id === id ? { ...r, [field]: value } : r)); };

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

  const handleCalculate = async () => {
    setLoading(true);
    setFetchStatus('参数解析中...');

    setTimeout(async () => {
        try {
            // ... (Parameter construction and validation logic same as before)
            if (!basicParams.total_notional) throw new Error("请输入总名义本金");
            if (!basicParams.denomination) throw new Error("请输入单张面值");
            if (!basicParams.trade_date) throw new Error("请选择交易日期");
            if (basicParams.strike_pct === '') throw new Error("请输入敲入界限");
            if (basicParams.trigger_pct === '') throw new Error("请输入敲出界限");
            if (basicParams.coupon_rate === '') throw new Error("请输入年化票息");

            const tickers: string[] = [];
            const ticker_names: string[] = [];
            const initial_spots: number[] = [];
            const current_spots_manual: (number | null)[] = [];
            const discrete_dividends: { [key: string]: [string, number][] } = {};
            const processedTickers = new Set<string>();
            
            for (const row of underlyingRows) {
                if (!row.ticker) continue;
                const divAmt = parseFloat(row.dividendAmount);
                if (row.dividendDate && row.dividendAmount && !isNaN(divAmt)) {
                    if (!discrete_dividends[row.ticker]) discrete_dividends[row.ticker] = [];
                    discrete_dividends[row.ticker].push([row.dividendDate, divAmt]);
                }
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
                fx_rate: basicParams.fx_rate === '' ? undefined : (basicParams.fx_rate as number),
                seed: basicParams.seed === '' ? undefined : (basicParams.seed as number),
                n_sims: basicParams.n_sims === '' ? 5000 : (basicParams.n_sims as number),
                coupon_freq: basicParams.coupon_freq === '' ? 12 : (basicParams.coupon_freq as number),
                risk_free_rate: basicParams.risk_free_rate === '' ? 0.03 : (basicParams.risk_free_rate as number),
                total_notional: Number(basicParams.total_notional),
                denomination: Number(basicParams.denomination),
                strike_pct: Number(basicParams.strike_pct),
                trigger_pct: Number(basicParams.trigger_pct),
                coupon_rate: Number(basicParams.coupon_rate),
            } as FCNParams;

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

            setUnderlyingRows(prevRows => prevRows.map(row => {
                const tIdx = tickers.indexOf(row.ticker);
                if (tIdx !== -1 && fetchedSpots[tIdx] !== undefined) {
                    if (!row.currentPrice) {
                        return { ...row, currentPrice: fetchedSpots[tIdx].toString() };
                    }
                }
                return row;
            }));

            if (calcParams.market !== 'HKD' && (!calcParams.fx_rate || isNaN(calcParams.fx_rate))) {
                setFetchStatus(`正在获取 ${calcParams.market}/HKD 汇率...`);
                const fxSymbol = `${calcParams.market}HKD=X`;
                const rate = await fetchQuotePrice(fxSymbol);
                calcParams.fx_rate = rate !== null ? rate : 1.0;
                setBasicParams(prev => ({ ...prev, fx_rate: calcParams.fx_rate || '' })); 
            } else if (calcParams.market === 'HKD') {
                calcParams.fx_rate = 1.0;
            }

            setFetchStatus('正在进行蒙特卡洛模拟...');
            setTimeout(() => {
                try {
                    const pricer = new FCNPricer(calcParams);
                    const res = pricer.simulate_price();
                    setFcnResult(res);

                    // Initialize Transaction Record if status is Terminated_Delivery
                    if (res.status === 'Terminated_Delivery') {
                        // Find the worst performing asset (the one delivered)
                        // In fcnPricer, loss_attribution is set to 1.0 for the worst asset in Terminated_Delivery
                        const worstIdx = res.loss_attribution.findIndex(val => val === 1.0);
                        if (worstIdx !== -1) {
                            const ticker = calcParams.tickers[worstIdx];
                            const name = calcParams.ticker_name?.[worstIdx] || ticker;
                            const initial = calcParams.initial_spots[worstIdx];
                            const strikePct = calcParams.strike_pct;
                            const strikePrice = initial * strikePct;
                            const totalNotional = calcParams.total_notional;
                            
                            const quantity = totalNotional / strikePrice;
                            const amountNoFee = strikePrice * quantity; // Should equal total_notional roughly
                            const fee = 0;
                            const amountWithFee = amountNoFee + fee;
                            const priceWithFee = amountWithFee / quantity;
                            const hkdAmount = amountWithFee * (calcParams.fx_rate || 1.0);

                            // Market mapping
                            let marketCode = "HK";
                            if (calcParams.market === 'USD') marketCode = "US";
                            else if (calcParams.market === 'JPY') marketCode = "JP";
                            else if (calcParams.market === 'CNY') marketCode = "CH";

                            setTxRecord({
                                date: calcParams.pay_dates[calcParams.pay_dates.length - 1], // Last payment date
                                account: basicParams.account_name,
                                market: marketCode,
                                executor: basicParams.executor,
                                type: "FCN接货",
                                stockCode: ticker,
                                stockName: name,
                                direction: "Buy",
                                quantity: Math.round(quantity), // usually round to int
                                priceNoFee: strikePrice,
                                amountNoFee: amountNoFee,
                                fee: fee,
                                amountWithFee: amountWithFee,
                                priceWithFee: priceWithFee,
                                hkdAmount: hkdAmount
                            });
                        }
                    } else {
                        setTxRecord(null);
                    }

                } catch (calcError) {
                    console.error(calcError);
                    alert("计算错误，请检查参数");
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
  const getUniqueTickersForDisplay = () => {
      const seen = new Set();
      return underlyingRows.filter(row => {
          const duplicate = seen.has(row.ticker);
          if (row.ticker) seen.add(row.ticker);
          return !duplicate && row.ticker; 
      });
  };
  const pctToInput = (val: number | string) => {
      if (val === '' || val === undefined) return '';
      return parseFloat((Number(val) * 100).toFixed(4)).toString();
  };
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
  const shouldShowTotalPL = (status: FCNResult['status']) => !status.startsWith('Terminated');
  const shouldShowRiskAttribution = (res: FCNResult) => {
      if (res.status === 'Settling_Delivery') return true;
      if (res.status === 'Active' && res.loss_prob > 0) return true;
      return false;
  };

  // Transaction Record Handlers
  const handleTxChange = (field: keyof TransactionRecord, value: any) => {
      if (!txRecord) return;
      let newRecord = { ...txRecord, [field]: value };
      
      // Auto-recalculate dependent fields if necessary
      if (field === 'quantity' || field === 'priceNoFee' || field === 'fee') {
          const qty = field === 'quantity' ? parseFloat(value) : txRecord.quantity;
          const price = field === 'priceNoFee' ? parseFloat(value) : txRecord.priceNoFee;
          const fee = field === 'fee' ? parseFloat(value) : txRecord.fee;
          
          if (!isNaN(qty) && !isNaN(price) && !isNaN(fee)) {
             newRecord.amountNoFee = qty * price;
             newRecord.amountWithFee = newRecord.amountNoFee + fee;
             newRecord.priceWithFee = qty > 0 ? newRecord.amountWithFee / qty : 0;
             newRecord.hkdAmount = newRecord.amountWithFee * (basicParams.fx_rate as number || 1.0);
          }
      }

      setTxRecord(newRecord);
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* ... (Header) ... */}
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
          {/* Left Side: Parameters (Same as before) */}
          <div className="lg:col-span-1 bg-white shadow rounded-lg p-5 max-h-[1200px] overflow-y-auto space-y-6">
             {activeTab === 'FCN' ? (
                 <>
                    {/* ... (Inputs logic from previous version) ... */}
                    {/* Just re-rendering the inputs here for completeness of file context */}
                     <div>
                         <h3 className="text-sm font-bold text-gray-800 border-l-4 border-blue-500 pl-2 mb-3">1. 基础信息</h3>
                         <div className="grid grid-cols-2 gap-3 text-xs">
                             <div>
                                 <label className="block text-gray-600 mb-1">券商 (Broker)</label>
                                 <input type="text" name="broker_name" value={basicParams.broker_name} onChange={handleBasicChange} placeholder={EXAMPLE_PARAMS.broker_name} className="w-full border-gray-300 rounded shadow-sm border p-1.5" />
                             </div>
                             <div>
                                 <label className="block text-gray-600 mb-1">账户 (Account)</label>
                                 <input type="text" name="account_name" value={basicParams.account_name} onChange={handleBasicChange} placeholder={EXAMPLE_PARAMS.account_name} className="w-full border-gray-300 rounded shadow-sm border p-1.5" />
                             </div>
                             <div>
                                 <label className="block text-gray-600 mb-1">执行人 (Executor)</label>
                                 <select name="executor" value={basicParams.executor} onChange={handleBasicChange} className="w-full border-gray-300 rounded shadow-sm border p-1.5">
                                     <option value="">请选择</option>
                                     <option value="Jerry">Jerry</option>
                                     <option value="Hugh">Hugh</option>
                                     <option value="Kelvin">Kelvin</option>
                                     <option value="Team">Team</option>
                                 </select>
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

                     <div>
                         <div className="flex justify-between items-center mb-2">
                             <h3 className="text-sm font-bold text-gray-800 border-l-4 border-blue-500 pl-2">2. 标的信息</h3>
                             <button onClick={addUnderlyingRow} className="text-xs text-blue-600 hover:text-blue-800">+ 添加标的</button>
                         </div>
                         <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                             {underlyingRows.map((row, idx) => (
                                 <div key={row.id} className="bg-gray-50 p-2 rounded border border-gray-200 text-xs">
                                     <div className="grid grid-cols-2 gap-2 mb-2">
                                         <input placeholder="代码" value={row.ticker} onChange={(e) => updateUnderlyingRow(row.id, 'ticker', e.target.value)} className="border-gray-300 rounded p-1" />
                                         <input placeholder="名称" value={row.name} onChange={(e) => updateUnderlyingRow(row.id, 'name', e.target.value)} className="border-gray-300 rounded p-1" />
                                     </div>
                                     <div className="grid grid-cols-2 gap-2 mb-2">
                                         <input type="number" placeholder="初始价" value={row.initialPrice} onChange={(e) => updateUnderlyingRow(row.id, 'initialPrice', e.target.value)} className="border-gray-300 rounded p-1" />
                                         <input type="number" placeholder="当前价" value={row.currentPrice} onChange={(e) => updateUnderlyingRow(row.id, 'currentPrice', e.target.value)} className="border-gray-300 rounded p-1 bg-blue-50" />
                                     </div>
                                     <div className="grid grid-cols-5 gap-2 items-center">
                                         <div className="col-span-2"><input type="date" placeholder="分红日期" value={row.dividendDate} onChange={(e) => updateUnderlyingRow(row.id, 'dividendDate', e.target.value)} className="w-full border-gray-300 rounded p-1" /></div>
                                         <div className="col-span-2"><input type="number" step="0.01" placeholder="分红金额" value={row.dividendAmount} onChange={(e) => updateUnderlyingRow(row.id, 'dividendAmount', e.target.value)} className="w-full border-gray-300 rounded p-1" /></div>
                                         <button onClick={() => removeUnderlyingRow(row.id)} className="text-red-500 hover:text-red-700 text-center">删</button>
                                     </div>
                                 </div>
                             ))}
                         </div>
                     </div>

                     <div>
                         <div className="flex justify-between items-center mb-2">
                             <h3 className="text-sm font-bold text-gray-800 border-l-4 border-blue-500 pl-2">3. 日期信息</h3>
                             <button onClick={addDateRow} className="text-xs text-blue-600 hover:text-blue-800">+ 添加日期</button>
                         </div>
                         <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
                             {dateRows.map((row, idx) => (
                                 <div key={row.id} className="grid grid-cols-7 gap-1 items-center">
                                     <input type="date" value={row.obsDate} onChange={(e) => updateDateRow(row.id, 'obsDate', e.target.value)} className="col-span-3 text-xs border-gray-300 rounded p-1" />
                                     <input type="date" value={row.payDate} onChange={(e) => updateDateRow(row.id, 'payDate', e.target.value)} className="col-span-3 text-xs border-gray-300 rounded p-1" />
                                     <button onClick={() => removeDateRow(row.id)} className="col-span-1 text-red-500 hover:text-red-700 text-xs text-center">删</button>
                                 </div>
                             ))}
                         </div>
                     </div>

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
                        {loading && <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>}
                        {loading ? (fetchStatus || '测算中...') : '开始测算'}
                     </button>
                 </>
             ) : (
                 <div className="text-center text-gray-400 py-10">DQ/AQ 引擎开发中...</div>
             )}
          </div>

          {/* === 右侧：结果展示 === */}
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

                     {/* Valuation & P&L Cards */}
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

                     {/* Probabilities */}
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

                     {/* Autocall Distribution */}
                     {fcnResult.early_redemption_prob > 0 && (
                         <div>
                             <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-3">提前敲出分布</h3>
                             <div className="overflow-x-auto"><table className="min-w-full divide-y divide-gray-200 text-sm"><thead><tr><th className="px-3 py-2 text-left font-medium text-gray-500">期数</th><th className="px-3 py-2 text-left font-medium text-gray-500">观察日</th><th className="px-3 py-2 text-right font-medium text-gray-500">概率</th></tr></thead><tbody className="divide-y divide-gray-200">{fcnResult.autocall_attribution.map((prob, idx) => { if (prob <= 0.0001) return null; const today = new Date(); today.setHours(0,0,0,0); const futureDates = fcnResult.status === 'Active' ? dateRows.map(r => r.obsDate).filter(d => new Date(d) > today) : []; const dateStr = futureDates[idx] || `Future Obs ${idx+1}`; return (<tr key={idx}><td className="px-3 py-2 text-gray-900">未来第 {idx + 1} 个观察日</td><td className="px-3 py-2 text-gray-500">{dateStr}</td><td className="px-3 py-2 text-right">{fmtPct(prob)}</td></tr>); })}</tbody></table></div>
                         </div>
                     )}

                     {/* Delivery Risk Attribution */}
                     {shouldShowRiskAttribution(fcnResult) && (
                         <div>
                             <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-3">
                                 {fcnResult.status === 'Settling_Delivery' ? '接货详情 (已确定)' : '接货风险归因 (预期)'}
                             </h3>
                             <div className="overflow-x-auto">
                                 <table className="min-w-full divide-y divide-gray-200 text-sm">
                                     <thead>
                                         <tr>
                                             <th className="px-3 py-2 text-left font-medium text-gray-500">标的</th>
                                             <th className="px-3 py-2 text-right font-medium text-gray-500">归因概率</th>
                                             <th className="px-3 py-2 text-right font-medium text-gray-500">暴露成本价</th>
                                             <th className="px-3 py-2 text-right font-medium text-gray-500">现价</th>
                                             <th className="px-3 py-2 text-right font-medium text-gray-500">暴露股数</th>
                                             <th className="px-3 py-2 text-right font-medium text-gray-500">暴露成本</th>
                                             <th className="px-3 py-2 text-right font-medium text-gray-500">暴露市值</th>
                                             <th className="px-3 py-2 text-right font-medium text-gray-500">暴露盈亏比</th>
                                         </tr>
                                     </thead>
                                     <tbody className="divide-y divide-gray-200">
                                         {getUniqueTickersForDisplay().map((row, idx) => {
                                             const initialP = parseFloat(row.initialPrice) || 0;
                                             const currentP = parseFloat(row.currentPrice) || initialP;
                                             const strikePct = Number(basicParams.strike_pct) || 0;
                                             const strikePrice = initialP * strikePct;
                                             const attributionProb = fcnResult.loss_attribution[idx] || 0;
                                             const factor = Number(basicParams.total_notional) / Number(basicParams.denomination);
                                             const exposureShares = (fcnResult.exposure_shares_avg[idx] || 0) * factor;
                                             const exposureCost = strikePrice * exposureShares;
                                             const exposureMktVal = currentP * exposureShares;
                                             
                                             let pnlDisplay = "-";
                                             let pnlClass = "text-gray-500";
                                             if (exposureCost > 0.0001) {
                                                 const pnlPct = (exposureMktVal / exposureCost) - 1;
                                                 pnlDisplay = fmtPct(pnlPct);
                                                 pnlClass = pnlPct >= 0 ? 'text-green-600' : 'text-red-600';
                                             }

                                             return (
                                                 <tr key={row.ticker} className={attributionProb === 1 ? "bg-red-50" : ""}>
                                                     <td className="px-3 py-2 text-gray-900">{row.name || row.ticker}<span className="block text-xs text-gray-400">{row.ticker}</span></td>
                                                     <td className="px-3 py-2 text-right">{fmtPct(attributionProb)}</td>
                                                     <td className="px-3 py-2 text-right text-gray-600">{strikePrice.toFixed(2)}</td>
                                                     <td className="px-3 py-2 text-right text-gray-600">{currentP.toFixed(2)}</td>
                                                     <td className="px-3 py-2 text-right">{exposureShares.toFixed(0)}</td>
                                                     <td className="px-3 py-2 text-right">{fmtMoney(getDisplayValue(exposureCost))}</td>
                                                     <td className="px-3 py-2 text-right">{fmtMoney(getDisplayValue(exposureMktVal))}</td>
                                                     <td className={`px-3 py-2 text-right font-medium ${pnlClass}`}>{pnlDisplay}</td>
                                                 </tr>
                                             );
                                         })}
                                     </tbody>
                                 </table>
                             </div>
                         </div>
                     )}

                     {/* Price Point Chart */}
                     {(fcnResult.status === 'Active' || fcnResult.status === 'Settling_Delivery' || fcnResult.status === 'Settling_NoDelivery') && (
                        <div className="mt-6">
                            <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-3">股价点位图</h3>
                            <div className="space-y-6">
                                {getUniqueTickersForDisplay().map((row, idx) => {
                                    const initial = parseFloat(row.initialPrice);
                                    const current = parseFloat(row.currentPrice) || initial;
                                    const strike = initial * (Number(basicParams.strike_pct) || 0); 
                                    const ko = initial * (Number(basicParams.trigger_pct) || 0);

                                    const leftPct = (strike / current) - 1;
                                    const rightPct = (ko / current) - 1;
                                    
                                    const values = [strike, current, ko];
                                    const minVal = Math.min(...values) * 0.85; 
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
                                                <div className={`flex flex-col items-center justify-center w-24 h-16 rounded-lg border-2 transition-colors ${leftPct > 0 ? 'bg-red-50 border-red-500 text-red-700' : 'bg-white border-gray-100 text-gray-400'}`}>
                                                    <span className="text-[10px] font-semibold uppercase tracking-wider">距敲入</span>
                                                    <span className="text-lg font-bold">{fmtPct(leftPct)}</span>
                                                </div>

                                                <div className="flex-1 relative h-16 mx-4 select-none">
                                                    <div className="absolute top-1/2 left-0 right-0 h-1.5 bg-gray-100 rounded-full transform -translate-y-1/2"></div>
                                                    
                                                     <div 
                                                        className="absolute top-1/2 h-1.5 bg-blue-50 transform -translate-y-1/2"
                                                        style={{ 
                                                            left: `${getPos(strike)}%`, 
                                                            width: `${getPos(ko) - getPos(strike)}%` 
                                                        }}
                                                    ></div>

                                                    <div className="absolute top-1/2" style={{ left: `${getPos(strike)}%` }}>
                                                        <div className="absolute transform -translate-x-1/2 -translate-y-1/2 w-3 h-3 bg-red-500 border-2 border-white rounded-full shadow z-10"></div>
                                                        <div className="absolute transform -translate-x-1/2 translate-y-3 flex flex-col items-center w-max">
                                                            <span className="text-[10px] text-red-600 font-bold">Strike</span>
                                                            <span className="text-[9px] text-gray-400">{strike.toFixed(2)}</span>
                                                        </div>
                                                    </div>

                                                    <div className="absolute top-1/2" style={{ left: `${getPos(ko)}%` }}>
                                                        <div className="absolute transform -translate-x-1/2 -translate-y-1/2 w-3 h-3 bg-green-500 border-2 border-white rounded-full shadow z-10"></div>
                                                        <div className="absolute transform -translate-x-1/2 translate-y-3 flex flex-col items-center w-max">
                                                            <span className="text-[10px] text-green-600 font-bold">KO</span>
                                                            <span className="text-[9px] text-gray-400">{ko.toFixed(2)}</span>
                                                        </div>
                                                    </div>

                                                     <div className="absolute top-1/2" style={{ left: `${getPos(current)}%` }}>
                                                        <div className="absolute transform -translate-x-1/2 -translate-y-1/2 w-4 h-4 bg-purple-600 border-2 border-white rounded-full shadow-lg z-20 ring-4 ring-purple-100"></div>
                                                        <div className="absolute transform -translate-x-1/2 -translate-y-full -top-3 flex flex-col items-center w-max">
                                                            <span className="bg-purple-600 text-white text-[10px] px-1.5 py-0.5 rounded shadow-sm font-bold">Now</span>
                                                        </div>
                                                    </div>
                                                </div>

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

                     {/* Transaction Record (Only for Terminated_Delivery) */}
                     {txRecord && (
                        <div className="mt-8 border-t border-gray-200 pt-6">
                            <div className="flex justify-between items-center mb-4">
                                <h3 className="text-lg font-bold text-gray-800">交易记录 (自动生成)</h3>
                                <div>
                                    {isEditingTx ? (
                                        <button 
                                            onClick={() => setIsEditingTx(false)} 
                                            className="px-3 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700 transition-colors"
                                        >
                                            保存
                                        </button>
                                    ) : (
                                        <button 
                                            onClick={() => setIsEditingTx(true)} 
                                            className="px-3 py-1 bg-gray-100 text-gray-600 text-xs rounded hover:bg-gray-200 transition-colors"
                                        >
                                            修改
                                        </button>
                                    )}
                                </div>
                            </div>

                            <div className="bg-gray-50 rounded-lg p-4 text-sm overflow-x-auto">
                                <table className="min-w-full divide-y divide-gray-200">
                                    <tbody className="divide-y divide-gray-200">
                                        <tr>
                                            <td className="px-3 py-2 font-medium text-gray-500 w-1/4">日期</td>
                                            <td className="px-3 py-2">
                                                {isEditingTx ? (
                                                    <input 
                                                        type="date" 
                                                        value={txRecord.date} 
                                                        onChange={(e) => handleTxChange('date', e.target.value)}
                                                        className="border rounded p-1 w-full text-xs"
                                                    />
                                                ) : txRecord.date}
                                            </td>
                                            <td className="px-3 py-2 font-medium text-gray-500 w-1/4">账户</td>
                                            <td className="px-3 py-2">
                                                {isEditingTx ? (
                                                    <input value={txRecord.account} onChange={(e) => handleTxChange('account', e.target.value)} className="border rounded p-1 w-full text-xs" />
                                                ) : txRecord.account}
                                            </td>
                                        </tr>
                                        <tr>
                                            <td className="px-3 py-2 font-medium text-gray-500">市场</td>
                                            <td className="px-3 py-2">
                                                {isEditingTx ? (
                                                    <select value={txRecord.market} onChange={(e) => handleTxChange('market', e.target.value)} className="border rounded p-1 w-full text-xs">
                                                        <option value="HK">HK</option>
                                                        <option value="US">US</option>
                                                        <option value="JP">JP</option>
                                                        <option value="CH">CH</option>
                                                    </select>
                                                ) : txRecord.market}
                                            </td>
                                            <td className="px-3 py-2 font-medium text-gray-500">执行人</td>
                                            <td className="px-3 py-2">
                                                {isEditingTx ? (
                                                    <input value={txRecord.executor} onChange={(e) => handleTxChange('executor', e.target.value)} className="border rounded p-1 w-full text-xs" />
                                                ) : txRecord.executor}
                                            </td>
                                        </tr>
                                        <tr>
                                            <td className="px-3 py-2 font-medium text-gray-500">交易类型</td>
                                            <td className="px-3 py-2">{txRecord.type}</td>
                                            <td className="px-3 py-2 font-medium text-gray-500">交易方向</td>
                                            <td className="px-3 py-2 text-green-600 font-medium">{txRecord.direction}</td>
                                        </tr>
                                        <tr>
                                            <td className="px-3 py-2 font-medium text-gray-500">股票代码</td>
                                            <td className="px-3 py-2">
                                                {isEditingTx ? <input value={txRecord.stockCode} onChange={(e) => handleTxChange('stockCode', e.target.value)} className="border rounded p-1 w-full text-xs" /> : txRecord.stockCode}
                                            </td>
                                            <td className="px-3 py-2 font-medium text-gray-500">股票名称</td>
                                            <td className="px-3 py-2">
                                                {isEditingTx ? <input value={txRecord.stockName} onChange={(e) => handleTxChange('stockName', e.target.value)} className="border rounded p-1 w-full text-xs" /> : txRecord.stockName}
                                            </td>
                                        </tr>
                                        <tr>
                                            <td className="px-3 py-2 font-medium text-gray-500">交易数量</td>
                                            <td className="px-3 py-2">
                                                {isEditingTx ? <input type="number" value={txRecord.quantity} onChange={(e) => handleTxChange('quantity', e.target.value)} className="border rounded p-1 w-full text-xs" /> : txRecord.quantity}
                                            </td>
                                            <td className="px-3 py-2 font-medium text-gray-500">成交均价(不含费)</td>
                                            <td className="px-3 py-2">
                                                {isEditingTx ? <input type="number" value={txRecord.priceNoFee} onChange={(e) => handleTxChange('priceNoFee', e.target.value)} className="border rounded p-1 w-full text-xs" /> : fmtMoney(txRecord.priceNoFee)}
                                            </td>
                                        </tr>
                                        <tr>
                                            <td className="px-3 py-2 font-medium text-gray-500">手续费</td>
                                            <td className="px-3 py-2">
                                                {isEditingTx ? <input type="number" value={txRecord.fee} onChange={(e) => handleTxChange('fee', e.target.value)} className="border rounded p-1 w-full text-xs" /> : fmtMoney(txRecord.fee)}
                                            </td>
                                            <td className="px-3 py-2 font-medium text-gray-500">成交金额(不含费)</td>
                                            <td className="px-3 py-2">{fmtMoney(txRecord.amountNoFee)}</td>
                                        </tr>
                                        <tr className="bg-gray-100 font-semibold">
                                            <td className="px-3 py-2 text-gray-700">成交均价(含费)</td>
                                            <td className="px-3 py-2">{fmtMoney(txRecord.priceWithFee)}</td>
                                            <td className="px-3 py-2 text-gray-700">成交金额(含费)</td>
                                            <td className="px-3 py-2">{fmtMoney(txRecord.amountWithFee)}</td>
                                        </tr>
                                        {/* Show HKD equivalent if base currency is NOT HKD */}
                                        {txRecord.market !== 'HK' && (
                                            <tr className="bg-blue-50 text-blue-800 font-bold">
                                                <td className="px-3 py-2" colSpan={2}></td>
                                                <td className="px-3 py-2">成交HKD(含费)</td>
                                                <td className="px-3 py-2">
                                                    HKD {new Intl.NumberFormat('en-US', { style: 'decimal', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(txRecord.hkdAmount)}
                                                </td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
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