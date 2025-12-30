"use client";

import { useState } from "react";
import { DQAQValuator, Period, BasicInfo, UnderlyingInfo, SimulationParams, ValuationResult, calculateVolatility } from "@/app/lib/DQ-AQPricer";

// Default Periods from Python
const DEFAULT_PERIODS: Period[] = [
    { period_id: 1, obs_start: "2025-10-09", obs_end: "2025-10-22", settle_date: "2025-10-23", trading_days: 10 },
    { period_id: 2, obs_start: "2025-10-23", obs_end: "2025-11-05", settle_date: "2025-11-06", trading_days: 10 },
    { period_id: 3, obs_start: "2025-11-06", obs_end: "2025-11-19", settle_date: "2025-11-20", trading_days: 10 },
    { period_id: 4, obs_start: "2025-11-20", obs_end: "2025-12-03", settle_date: "2025-12-04", trading_days: 10 },
    { period_id: 5, obs_start: "2025-12-04", obs_end: "2025-12-17", settle_date: "2025-12-18", trading_days: 10 },
    { period_id: 6, obs_start: "2025-12-18", obs_end: "2025-12-31", settle_date: "2026-01-02", trading_days: 9 },
    { period_id: 7, obs_start: "2026-01-02", obs_end: "2026-01-14", settle_date: "2026-01-15", trading_days: 10 },
    { period_id: 8, obs_start: "2026-01-15", obs_end: "2026-01-28", settle_date: "2026-01-29", trading_days: 10 },
    { period_id: 9, obs_start: "2026-01-29", obs_end: "2026-02-11", settle_date: "2026-02-12", trading_days: 10 },
    { period_id: 10, obs_start: "2026-02-12", obs_end: "2026-02-25", settle_date: "2026-02-26", trading_days: 9 },
    { period_id: 11, obs_start: "2026-02-26", obs_end: "2026-03-11", settle_date: "2026-03-12", trading_days: 10 },
    { period_id: 12, obs_start: "2026-03-12", obs_end: "2026-03-25", settle_date: "2026-03-26", trading_days: 10 },
    { period_id: 13, obs_start: "2026-03-26", obs_end: "2026-04-08", settle_date: "2026-04-09", trading_days: 9 },
];

export default function DQAQPanel() {
  // State: 1. Underlying
  const [ticker, setTicker] = useState("AMD");
  const [stockName, setStockName] = useState("AMD");
  const [spotPrice, setSpotPrice] = useState<number>(212.92); // S0
  const [currentMktPrice, setCurrentMktPrice] = useState<string>(""); // MTM (Optional, if empty use quote)
  const [loadingMarket, setLoadingMarket] = useState(false);

  // State: 2. Basic
  const [contractType, setContractType] = useState<'DQ' | 'AQ'>('DQ');
  const [broker, setBroker] = useState("EFGL");
  const [account, setAccount] = useState("EFG");
  const [executor, setExecutor] = useState("Team");
  const [currency, setCurrency] = useState("USD");
  const [tradeDate, setTradeDate] = useState("2025-10-08");
  const [dailyShares, setDailyShares] = useState(-6.0); // 默认负数
  const [maxGlobalShares, setMaxGlobalShares] = useState(-1488.0); // 默认负数
  const [kiPct, setKiPct] = useState(1.2835);
  const [koPct, setKoPct] = useState(0.93);
  const [leverage, setLeverage] = useState(2.0);

  // State: 3. Sim
  const [simCount, setSimCount] = useState(5000);
  const [randomSeed, setRandomSeed] = useState(42);
  const [riskFreeInput, setRiskFreeInput] = useState<string>("0.045"); 
  const [fxRateInput, setFxRateInput] = useState<string>(""); 
  const [historyStartInput, setHistoryStartInput] = useState<string>(""); 

  // State: 4. Periods
  const [periods, setPeriods] = useState<Period[]>(DEFAULT_PERIODS);

  // UI State
  const [calculating, setCalculating] = useState(false);
  const [result, setResult] = useState<ValuationResult | null>(null);
  const [historyRecords, setHistoryRecords] = useState<any[]>([]); // 新增: 历史结算记录

  // ================= 逻辑函数 =================

  // Period 操作
  const addPeriod = () => {
    const last = periods[periods.length - 1];
    const newId = last ? last.period_id + 1 : 1;
    let nextStart = "";
    if (last && last.obs_end) {
        const d = new Date(last.obs_end);
        d.setDate(d.getDate() + 1);
        nextStart = d.toISOString().split('T')[0];
    }
    setPeriods([...periods, { period_id: newId, obs_start: nextStart, obs_end: "", settle_date: "", trading_days: 10 }]);
  };
  const removePeriod = (idx: number) => {
    const p = [...periods];
    p.splice(idx, 1);
    const reindexed = p.map((item, i) => ({...item, period_id: i + 1}));
    setPeriods(reindexed);
  };
  const updatePeriod = (idx: number, field: keyof Period, val: any) => {
    const p = [...periods];
    p[idx] = { ...p[idx], [field]: val };
    setPeriods(p);
  };
  const resetPeriods = () => setPeriods(DEFAULT_PERIODS);
  const generatePeriods = () => {
    const list: Period[] = [];
    let currentDate = new Date(tradeDate);
    currentDate.setDate(currentDate.getDate() + 1);
    for (let i = 1; i <= 12; i++) {
        const start = new Date(currentDate);
        const end = new Date(currentDate);
        end.setDate(end.getDate() + 13);
        const settle = new Date(end);
        settle.setDate(settle.getDate() + 1);
        list.push({ period_id: i, obs_start: start.toISOString().split('T')[0], obs_end: end.toISOString().split('T')[0], settle_date: settle.toISOString().split('T')[0], trading_days: 10 });
        currentDate = new Date(settle);
    }
    setPeriods(list);
  };

  // 辅助函数: 获取报价 (参考用户提供)
  const fetchQuotePrice = async (symbol: string): Promise<number | null> => {
      try {
          const apiUrl = `/api/quote?symbol=${symbol}`; // 注意路径
          const response = await fetch(apiUrl);
          if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
          const data = await response.json();
          // 适配不同的 API 返回格式
          const price = data.regularMarketPrice || data.price || data.close;
          return typeof price === 'number' ? price : null;
      } catch (e) {
          console.error(`Failed to fetch quote for ${symbol}:`, e);
          return null;
      }
  };

  // --- 核心计算 (复刻 Python Main Logic) ---
  const handleCalculate = async () => {
    if (periods.length === 0) { alert("请添加观察期"); return; }
    setCalculating(true);
    setResult(null);
    setHistoryRecords([]);
    
    await new Promise(r => setTimeout(r, 100)); // UI flush

    try {
        // 1. 准备参数 (自动填充逻辑)
        // Risk Free
        let r = 0.045; 
        if (riskFreeInput === "") {
            const tnx = await fetchQuotePrice("^TNX");
            if (tnx !== null) r = tnx / 100;
        } else r = parseFloat(riskFreeInput);

        // FX Rate
        let fx = 7.8;
        if (fxRateInput === "") {
            const fxP = await fetchQuotePrice("HKD=X");
            if (fxP !== null) fx = fxP;
        } else fx = parseFloat(fxRateInput);

        // History Start
        let hStart = historyStartInput;
        if (hStart === "") {
            const d = new Date(tradeDate);
            d.setDate(d.getDate() - 28); // Python example defaults to T-20 (approx)
            hStart = d.toISOString().split('T')[0];
        }

        // 2. 获取历史数据 (History API) & 计算 Sigma
        let historyPrices: number[] = [];
        let historyDates: string[] = [];
        
        try {
            // 使用 /api/history 获取数据
            const histRes = await fetch(`/api/history?symbol=${ticker}&from=${hStart}`);
            if (histRes.ok) {
                const histData = await histRes.json();
                
                // 适配 API 返回结构 { symbol, currency, data: [{date, close...}] }
                let rawList: any[] = [];
                if (histData.data && Array.isArray(histData.data)) {
                    rawList = histData.data;
                } else if (Array.isArray(histData)) {
                    rawList = histData;
                }

                // 提取收盘价
                rawList.forEach((item: any) => {
                    const price = item.close || item.adjClose || item.price;
                    const date = item.date; // Expecting YYYY-MM-DD from API
                    if (typeof price === 'number' && !isNaN(price) && date) {
                        historyPrices.push(price);
                        historyDates.push(date);
                    }
                });
            }
        } catch(e) {
            console.warn("History fetch error:", e);
        }

        // 计算波动率
        const sigma = calculateVolatility(historyPrices);

        // 3. 确定当前市价 (MTM)
        // 如果输入框为空，则实时获取，如果还是空，则尝试使用历史数据最后一位
        let finalMktPrice = spotPrice; 
        if (currentMktPrice !== "") {
            finalMktPrice = parseFloat(currentMktPrice);
        } else {
            const p = await fetchQuotePrice(ticker);
            if (p !== null) {
                finalMktPrice = p;
                setCurrentMktPrice(p.toString()); // 更新 UI
            } else if (historyPrices.length > 0) {
                finalMktPrice = historyPrices[historyPrices.length - 1];
            }
        }

        // 4. 构造对象 (Data Classes)
        const basic: BasicInfo = {
            contract_type: contractType,
            broker, account, executor, currency,
            trade_date: tradeDate,
            daily_shares: Number(dailyShares),
            max_global_shares: Number(maxGlobalShares),
            ki_barrier_pct: Number(kiPct),
            ko_barrier_pct: Number(koPct),
            leverage: Number(leverage)
        };
        const underlying: UnderlyingInfo = { ticker, stock_name: stockName, spot_price: Number(spotPrice) };
        const sim: SimulationParams = {
            sim_count: Number(simCount),
            random_seed: Number(randomSeed),
            risk_free_rate: r,
            sim_fx_rate: fx,
            history_start_date: hStart
        };

        // 5. 实例化 Valuator 并运行
        const valuator = new DQAQValuator(basic, underlying, sim, periods, sigma);
        const valDt = new Date().toISOString().split('T')[0]; // 今天作为估值日
        
        // 这里我们在 DQ-AQPricer.ts 中添加了 history_dates 参数支持
        const res = valuator.generate_report(finalMktPrice, historyPrices, historyDates, valDt, fx);
        
        setResult(res);
        if (res.history_records) setHistoryRecords(res.history_records);

    } catch (e: any) {
        alert("计算错误: " + e.message || e);
    } finally {
        setCalculating(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Column: Inputs (1:1 with Right => col-span-6) */}
        <div className="lg:col-span-6 space-y-6">
            
            {/* 1. Underlying */}
            <div className="bg-white p-4 shadow rounded border border-gray-200">
                <h3 className="font-bold text-gray-700 border-b pb-2 mb-3">1. 标的资产 (Underlying Info)</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                    <div className="col-span-1 sm:col-span-2">
                        <label className="block text-gray-500 text-xs">标的代码 (Ticker)</label>
                        <input 
                            className="border w-full p-1 rounded" 
                            value={ticker} 
                            onChange={e => setTicker(e.target.value)} 
                        />
                    </div>
                    <div>
                        <label className="block text-gray-500 text-xs">标的名称 (Stock Name)</label>
                        <input className="border w-full p-1 rounded" value={stockName} onChange={e=>setStockName(e.target.value)} />
                    </div>
                    <div>
                        <label className="block text-gray-500 text-xs">初始价格 (S0)</label>
                        <input type="number" className="border w-full p-1 rounded" value={spotPrice} onChange={e=>setSpotPrice(Number(e.target.value))} />
                    </div>
                    <div className="col-span-1 sm:col-span-2">
                        <label className="block text-gray-500 text-xs">当前市价 (MTM Price)</label>
                        <input type="number" placeholder="留白自动获取" className="border w-full p-1 rounded" value={currentMktPrice} onChange={e=>setCurrentMktPrice(e.target.value)} />
                    </div>
                </div>
            </div>

            {/* 2. Basic */}
            <div className="bg-white p-4 shadow rounded border border-gray-200">
                <h3 className="font-bold text-gray-700 border-b pb-2 mb-3">2. 合约基本条款 (Basic Info)</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                    <div>
                        <label className="block text-gray-500 text-xs">券商 (Broker)</label>
                        <input className="border w-full p-1 rounded" value={broker} onChange={e=>setBroker(e.target.value)} />
                    </div>
                    <div>
                        <label className="block text-gray-500 text-xs">账户 (Account)</label>
                        <input className="border w-full p-1 rounded" value={account} onChange={e=>setAccount(e.target.value)} />
                    </div>
                    <div>
                        <label className="block text-gray-500 text-xs">执行人 (Executor)</label>
                        <input className="border w-full p-1 rounded" value={executor} onChange={e=>setExecutor(e.target.value)} />
                    </div>
                    <div>
                        <label className="block text-gray-500 text-xs">币种 (Currency)</label>
                        <input className="border w-full p-1 rounded" value={currency} onChange={e=>setCurrency(e.target.value)} />
                    </div>
                    <div className="col-span-1 sm:col-span-2">
                        <label className="block text-gray-500 text-xs">交易日期 (Trade Date)</label>
                        <input type="date" className="border w-full p-1 rounded" value={tradeDate} onChange={e=>setTradeDate(e.target.value)} />
                    </div>
                    <div>
                        <label className="block text-gray-500 text-xs">合约类型 (Type)</label>
                        <select className="border w-full p-1 rounded" value={contractType} onChange={(e:any)=>setContractType(e.target.value)}>
                            <option value="DQ">DQ</option>
                            <option value="AQ">AQ</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-gray-500 text-xs">杠杆 (Leverage)</label>
                        <input type="number" className="border w-full p-1 rounded" value={leverage} onChange={e=>setLeverage(Number(e.target.value))} />
                    </div>
                    <div>
                        <label className="block text-gray-500 text-xs">每日股数 (Daily)</label>
                        <input type="number" className="border w-full p-1 rounded" value={dailyShares} onChange={e=>setDailyShares(Number(e.target.value))} />
                        <span className="text-[9px] text-gray-400">DQ负</span>
                    </div>
                    <div>
                        <label className="block text-gray-500 text-xs">最大股数 (Max)</label>
                        <input type="number" className="border w-full p-1 rounded" value={maxGlobalShares} onChange={e=>setMaxGlobalShares(Number(e.target.value))} />
                        <span className="text-[9px] text-gray-400">DQ负</span>
                    </div>
                    <div>
                        <label className="block text-gray-500 text-xs">敲入 (KI %)</label>
                        <input type="number" className="border w-full p-1 rounded" value={kiPct} onChange={e=>setKiPct(Number(e.target.value))} step={0.0001}/>
                        <span className="text-[9px] text-gray-400">{(spotPrice * kiPct).toFixed(2)}</span>
                    </div>
                    <div>
                        <label className="block text-gray-500 text-xs">敲出 (KO %)</label>
                        <input type="number" className="border w-full p-1 rounded" value={koPct} onChange={e=>setKoPct(Number(e.target.value))} step={0.01}/>
                        <span className="text-[9px] text-gray-400">{(spotPrice * koPct).toFixed(2)}</span>
                    </div>
                </div>
            </div>

            {/* 3. Sim Params */}
            <div className="bg-white p-4 shadow rounded border border-gray-200">
                <h3 className="font-bold text-gray-700 border-b pb-2 mb-3">3. 模拟参数 (Simulation Params)</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                    <div>
                        <label className="block text-gray-500 text-xs">无风险利率 (r)</label>
                        <input className="border w-full p-1 rounded" placeholder="留白读取Yahoo" value={riskFreeInput} onChange={e=>setRiskFreeInput(e.target.value)} />
                    </div>
                    <div>
                        <label className="block text-gray-500 text-xs">历史起始日 (Start)</label>
                        <input type="date" className="border w-full p-1 rounded" value={historyStartInput} onChange={e=>setHistoryStartInput(e.target.value)} />
                        <span className="text-[9px] text-gray-400">留白T-20</span>
                    </div>
                    <div>
                        <label className="block text-gray-500 text-xs">模拟路径 (Paths)</label>
                        <input type="number" className="border w-full p-1 rounded" value={simCount} onChange={e=>setSimCount(Number(e.target.value))} />
                    </div>
                    <div>
                        <label className="block text-gray-500 text-xs">种子 (Seed)</label>
                        <input type="number" className="border w-full p-1 rounded" value={randomSeed} onChange={e=>setRandomSeed(Number(e.target.value))} />
                    </div>
                    <div className="col-span-1 sm:col-span-2">
                        <label className="block text-gray-500 text-xs">汇率 (To HKD)</label>
                        <input className="border w-full p-1 rounded" placeholder="留白读取Yahoo" value={fxRateInput} onChange={e=>setFxRateInput(e.target.value)} />
                    </div>
                </div>
            </div>

            {/* 4. Periods */}
            <div className="bg-white p-4 shadow rounded border border-gray-200">
                <div className="flex justify-between border-b pb-2 mb-3">
                    <h3 className="font-bold text-gray-700">4. 观察期 (Periods)</h3>
                    <div className="space-x-1">
                        <button onClick={addPeriod} className="text-[10px] bg-green-50 text-green-600 px-2 py-1 rounded">+行</button>
                        <button onClick={generatePeriods} className="text-[10px] bg-blue-50 text-blue-600 px-2 py-1 rounded">自动</button>
                        <button onClick={resetPeriods} className="text-[10px] bg-gray-100 text-gray-600 px-2 py-1 rounded">重置</button>
                    </div>
                </div>
                <div className="overflow-x-auto max-h-60">
                    <table className="w-full text-xs text-center border-collapse">
                        <thead className="bg-gray-50 sticky top-0">
                            <tr>
                                <th className="border p-1">ID</th>
                                <th className="border p-1">Start</th>
                                <th className="border p-1">End</th>
                                <th className="border p-1">Settle</th>
                                <th className="border p-1">Days</th>
                                <th className="border p-1"></th>
                            </tr>
                        </thead>
                        <tbody>
                            {periods.map((p, idx) => (
                                <tr key={idx}>
                                    <td className="border p-1">{p.period_id}</td>
                                    <td className="border p-0"><input type="date" className="w-full p-1 text-center" value={p.obs_start} onChange={e=>updatePeriod(idx, 'obs_start', e.target.value)}/></td>
                                    <td className="border p-0"><input type="date" className="w-full p-1 text-center" value={p.obs_end} onChange={e=>updatePeriod(idx, 'obs_end', e.target.value)}/></td>
                                    <td className="border p-0"><input type="date" className="w-full p-1 text-center" value={p.settle_date} onChange={e=>updatePeriod(idx, 'settle_date', e.target.value)}/></td>
                                    <td className="border p-0"><input type="number" className="w-full p-1 text-center" value={p.trading_days} onChange={e=>updatePeriod(idx, 'trading_days', Number(e.target.value))}/></td>
                                    <td className="border p-1"><button onClick={()=>removePeriod(idx)} className="text-red-500">×</button></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Calculate Button (Left Bottom) */}
            <button 
                onClick={handleCalculate}
                className="w-full bg-blue-600 text-white font-bold py-3 rounded shadow hover:bg-blue-700 disabled:opacity-50"
                disabled={calculating}
            >
                {calculating ? "计算中..." : "开始估值 (Run Valuation)"}
            </button>

        </div>

        {/* Right Column: Output (1:1 with Left => col-span-6) */}
        <div className="lg:col-span-6 space-y-6">
            
            {result ? (
                <div className="bg-white p-6 rounded shadow border border-blue-200 space-y-6 text-sm sticky top-6">
                    <div className="flex justify-between items-center border-b pb-4">
                        <h4 className="font-bold text-xl text-gray-800">估值结果 (Mark-to-Market)</h4>
                        <span className={`px-3 py-1 rounded text-sm font-bold ${result.status_msg.includes('提前敲出') || result.status_msg.includes('Expired') ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                            {result.status_msg}
                        </span>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-6">
                        <div className="bg-gray-50 p-4 rounded border border-gray-100">
                            <p className="text-gray-500 text-xs mb-1">期望总股数 (Expected Shares)</p>
                            <p className="font-bold text-2xl text-gray-900">{result.expected_shares.toFixed(2)}</p>
                        </div>
                        <div className="bg-blue-50 p-4 rounded border border-blue-100">
                            <p className="text-blue-500 text-xs mb-1">预期完成率 (Completion Rate)</p>
                            <p className="font-bold text-2xl text-blue-700">{(result.exp_completion_rate * 100).toFixed(2)}%</p>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="bg-gray-50 p-4 rounded border border-gray-200">
                            <p className="text-gray-600 text-sm font-medium mb-2">【全价 Full Price】(含历史)</p>
                            <div className="flex items-baseline space-x-2">
                                <p className="font-bold text-2xl">{result.val_full_usd.toFixed(2)} <span className="text-sm font-normal text-gray-500">USD</span></p>
                            </div>
                            <p className="text-gray-400 text-xs mt-1">≈ {result.val_full_hkd.toFixed(2)} HKD</p>
                        </div>

                        <div className="bg-green-50 p-4 rounded border border-green-200">
                            <p className="text-green-800 text-sm font-medium mb-2">【净价 Net Price】(转手价)</p>
                            <div className="flex items-baseline space-x-2">
                                <p className="font-bold text-2xl text-green-700">{result.val_net_usd.toFixed(2)} <span className="text-sm font-normal text-green-600">USD</span></p>
                            </div>
                            <p className="text-green-600 text-xs mt-1">≈ {result.val_net_hkd.toFixed(2)} HKD</p>
                        </div>
                    </div>

                    <div className="bg-gray-50 rounded p-4 text-xs text-gray-600 space-y-2">
                        <h5 className="font-bold text-gray-700 mb-2">详细数据 (Details)</h5>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <div>
                                <span className="block text-gray-400">已结算入袋</span>
                                <span className="font-mono text-sm font-medium">{result.shares_settled_paid.toFixed(2)}</span>
                            </div>
                            <div>
                                <span className="block text-gray-400">已锁定未付</span>
                                <span className="font-mono text-sm font-medium">{result.shares_locked_unpaid.toFixed(2)}</span>
                            </div>
                            <div>
                                <span className="block text-gray-400">未来期望</span>
                                <span className="font-mono text-sm font-medium">{result.shares_future.toFixed(2)}</span>
                            </div>
                            <div>
                                <span className="block text-gray-400">KO 概率</span>
                                <span className="font-mono text-sm font-medium">{(result.ko_probability * 100).toFixed(2)}%</span>
                            </div>
                        </div>
                        <div className="pt-2 mt-2 border-t border-gray-200 flex justify-between">
                            <span>计算波动率 (Sigma): {(result.calc_sigma * 100).toFixed(2)}%</span>
                            <span>汇率: {result.final_fx_rate}</span>
                        </div>
                    </div>

                    {/* 历史结算记录表格 (参考 Python 输出) */}
                    {(historyRecords && historyRecords.length > 0) && (
                        <div className="bg-gray-50 rounded p-4 text-xs text-gray-600 space-y-2 mt-4">
                            <h5 className="font-bold text-gray-700 mb-2">历史结算记录 (Historical Transactions)</h5>
                            <div className="overflow-x-auto">
                                <table className="w-full text-center border-collapse">
                                    <thead className="bg-gray-100 text-gray-600">
                                        <tr>
                                            <th className="p-1 border">Period</th>
                                            <th className="p-1 border">Settle Date</th>
                                            <th className="p-1 border">Shares</th>
                                            <th className="p-1 border">Status</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {historyRecords.map((rec: any, idx: number) => (
                                            <tr key={idx} className="bg-white">
                                                <td className="p-1 border">{rec.period_id}</td>
                                                <td className="p-1 border">{rec.settle_date}</td>
                                                <td className="p-1 border">{rec.shares.toFixed(2)}</td>
                                                <td className={`p-1 border ${rec.status === 'Knocked Out' ? 'text-red-500 font-bold' : ''}`}>
                                                    {rec.status}
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
                <div className="h-full min-h-[400px] flex items-center justify-center bg-gray-50 border-2 border-dashed border-gray-200 rounded text-gray-400 sticky top-6">
                    <div className="text-center">
                        <svg className="w-16 h-16 mx-auto mb-4 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        <p className="text-lg">请配置左侧参数并开始估值</p>
                    </div>
                </div>
            )}
        </div>
    </div>
  );
}