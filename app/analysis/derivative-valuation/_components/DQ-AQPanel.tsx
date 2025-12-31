//"use client";

import { useState } from "react";
// Change the import path to be relative to fix the resolution error
import { DQAQValuator, Period, BasicInfo, UnderlyingInfo, SimulationParams, ValuationResult, calculateVolatility } from "../../../lib/DQ-AQPricer";

// 默认观察期配置
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

// 默认参数常量
const DEFAULTS = {
    ticker: "AMD",
    stockName: "AMD",
    spotPrice: 212.92,
    broker: "EFGL",
    account: "EFG",
    executor: "Team",
    currency: "USD",
    tradeDate: "2025-10-08",
    dailyShares: -6.0,
    maxGlobalShares: -1488.0,
    kiPct: 1.2835,
    koPct: 0.93,
    leverage: 2.0,
    simCount: 5000,
    randomSeed: 42,
    riskFree: 0.045,
    fxRate: 7.8
};

export default function DQAQPanel() {
  // 1. 标的资产状态
  const [ticker, setTicker] = useState("");
  const [stockName, setStockName] = useState("");
  const [spotPrice, setSpotPrice] = useState<string>(""); 
  const [currentMktPrice, setCurrentMktPrice] = useState<string>(""); 
  const [loadingMarket, setLoadingMarket] = useState(false);

  // 2. 合约基本信息
  const [contractType, setContractType] = useState<'DQ' | 'AQ'>('DQ');
  const [broker, setBroker] = useState("");
  const [account, setAccount] = useState("");
  const [executor, setExecutor] = useState("");
  const [currency, setCurrency] = useState("");
  const [tradeDate, setTradeDate] = useState("");
  const [dailyShares, setDailyShares] = useState<string>(""); 
  const [maxGlobalShares, setMaxGlobalShares] = useState<string>(""); 
  const [kiPct, setKiPct] = useState<string>("");
  const [koPct, setKoPct] = useState<string>("");
  const [leverage, setLeverage] = useState<string>("");

  // 3. 模拟参数
  const [simCount, setSimCount] = useState<string>("");
  const [randomSeed, setRandomSeed] = useState<string>("");
  const [riskFreeInput, setRiskFreeInput] = useState<string>(""); 
  const [fxRateInput, setFxRateInput] = useState<string>(""); 
  const [historyStartInput, setHistoryStartInput] = useState<string>(""); 

  // 4. 观察期 (初始为空)
  const [periods, setPeriods] = useState<Period[]>([]);

  // UI与结果状态
  const [calculating, setCalculating] = useState(false);
  const [result, setResult] = useState<ValuationResult | null>(null);
  const [historyRecords, setHistoryRecords] = useState<any[]>([]); 
  const [errors, setErrors] = useState<Record<string, string>>({});

  // ================= 逻辑处理 =================

  // 观察期管理
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

  // 计算参数接口
  interface CalcParams {
      ticker: string; stockName: string; spotPrice: number; currentMktPriceStr: string;
      broker: string; account: string; executor: string; currency: string;
      tradeDate: string; dailyShares: number; maxGlobalShares: number;
      kiPct: number; koPct: number; leverage: number;
      simCount: number; randomSeed: number; 
      riskFreeInputStr: string; fxRateInputStr: string; historyStartStr: string;
      contractType: 'DQ' | 'AQ';
      periodsToUse: Period[];
  }

  // 核心计算流程
  const performCalculation = async (params: CalcParams) => {
    if (params.periodsToUse.length === 0) { 
        setErrors(prev => ({...prev, periods: "！，请至少添加一个观察期"}));
        return; 
    }

    setCalculating(true);
    setResult(null);
    setHistoryRecords([]);
    
    await new Promise(r => setTimeout(r, 100)); // UI 刷新

    try {
        // 无风险利率 (优先输入值，否则尝试抓取 TNX)
        let r = DEFAULTS.riskFree; 
        if (params.riskFreeInputStr === "") {
            try {
                const tnx = await fetchQuotePrice("^TNX");
                if (tnx !== null) r = tnx / 100;
            } catch(e) {}
        } else {
            r = parseFloat(params.riskFreeInputStr);
        }

        // 汇率 (优先输入值，否则尝试抓取 HKD=X)
        let fx = DEFAULTS.fxRate;
        if (params.fxRateInputStr === "") {
            try {
                const fxP = await fetchQuotePrice("HKD=X");
                if (fxP !== null) fx = fxP;
            } catch(e) {}
        } else {
            fx = parseFloat(params.fxRateInputStr);
        }

        // 历史数据起始日 (默认 T-28)
        let hStart = params.historyStartStr;
        if (hStart === "") {
            const d = new Date(params.tradeDate);
            d.setDate(d.getDate() - 28); 
            hStart = d.toISOString().split('T')[0];
        }

        // 获取历史价格数据
        let historyPrices: number[] = [];
        let historyDates: string[] = [];
        try {
            const histRes = await fetch(`/api/history?symbol=${params.ticker}&from=${hStart}`);
            if (histRes.ok) {
                const histData = await histRes.json();
                let rawList: any[] = [];
                if (histData.data && Array.isArray(histData.data)) rawList = histData.data;
                else if (Array.isArray(histData)) rawList = histData;
                
                rawList.forEach((item: any) => {
                    const price = item.close || item.adjClose || item.price;
                    const date = item.date; 
                    if (typeof price === 'number' && !isNaN(price) && date) {
                        historyPrices.push(price);
                        historyDates.push(date);
                    }
                });
            }
        } catch(e) {
            console.warn("History fetch error:", e);
        }

        const sigma = calculateVolatility(historyPrices);

        // 确定当前市价 (MTM)
        let finalMktPrice = params.spotPrice; 
        if (params.currentMktPriceStr !== "") {
            finalMktPrice = parseFloat(params.currentMktPriceStr);
        } else {
            const p = await fetchQuotePrice(params.ticker);
            if (p !== null) {
                finalMktPrice = p;
                setCurrentMktPrice(p.toString());
            } else if (historyPrices.length > 0) {
                finalMktPrice = historyPrices[historyPrices.length - 1];
            }
        }

        // 构造计算对象
        const basic: BasicInfo = {
            contract_type: params.contractType,
            broker: params.broker,
            account: params.account,
            executor: params.executor,
            currency: params.currency,
            trade_date: params.tradeDate,
            daily_shares: params.dailyShares,
            max_global_shares: params.maxGlobalShares,
            ki_barrier_pct: params.kiPct,
            ko_barrier_pct: params.koPct,
            leverage: params.leverage
        };
        const underlying: UnderlyingInfo = { 
            ticker: params.ticker, 
            stock_name: params.stockName, 
            spot_price: params.spotPrice 
        };
        const sim: SimulationParams = {
            sim_count: params.simCount,
            random_seed: params.randomSeed,
            risk_free_rate: r,
            sim_fx_rate: fx,
            history_start_date: hStart
        };

        const valuator = new DQAQValuator(basic, underlying, sim, params.periodsToUse, sigma);
        const valDt = new Date().toISOString().split('T')[0]; 
        
        const res = valuator.generate_report(finalMktPrice, historyPrices, historyDates, valDt, fx);
        
        setResult(res);
        if (res.history_records) setHistoryRecords(res.history_records);

    } catch (e: any) {
        alert("计算错误: " + e.message || e);
    } finally {
        setCalculating(false);
    }
  };

  // --- 1. 普通运行：带校验 ---
  const handleRunValuation = () => {
      const newErrors: Record<string, string> = {};
      
      // 校验必填项
      if (!ticker) newErrors["ticker"] = "！，请输入数据";
      if (!spotPrice) newErrors["spotPrice"] = "！，请输入数据";
      if (!tradeDate) newErrors["tradeDate"] = "！，请输入数据";
      if (!dailyShares) newErrors["dailyShares"] = "！，请输入数据";
      if (!maxGlobalShares) newErrors["maxGlobalShares"] = "！，请输入数据";
      if (!kiPct) newErrors["kiPct"] = "！，请输入数据";
      if (!koPct) newErrors["koPct"] = "！，请输入数据";
      if (!leverage) newErrors["leverage"] = "！，请输入数据";
      if (!simCount) newErrors["simCount"] = "！，请输入数据";
      if (!randomSeed) newErrors["randomSeed"] = "！，请输入数据";

      if (periods.length === 0) newErrors["periods"] = "！，请至少添加一个观察期";

      if (Object.keys(newErrors).length > 0) {
          setErrors(newErrors);
          return;
      }

      setErrors({});
      performCalculation({
          ticker, 
          stockName: stockName || "",
          spotPrice: Number(spotPrice),
          currentMktPriceStr: currentMktPrice,
          broker: broker || "",
          account: account || "",
          executor: executor || "",
          currency: currency || "",
          tradeDate,
          dailyShares: Number(dailyShares),
          maxGlobalShares: Number(maxGlobalShares),
          kiPct: Number(kiPct),
          koPct: Number(koPct),
          leverage: Number(leverage),
          simCount: Number(simCount),
          randomSeed: Number(randomSeed),
          riskFreeInputStr: riskFreeInput,
          fxRateInputStr: fxRateInput,
          historyStartStr: historyStartInput,
          contractType,
          periodsToUse: periods
      });
  };

  // --- 2. 示例运行：使用默认值 ---
  const handleExampleRun = () => {
      setTicker(DEFAULTS.ticker);
      setStockName(DEFAULTS.stockName);
      setSpotPrice(String(DEFAULTS.spotPrice));
      setBroker(DEFAULTS.broker);
      setAccount(DEFAULTS.account);
      setExecutor(DEFAULTS.executor);
      setCurrency(DEFAULTS.currency);
      setTradeDate(DEFAULTS.tradeDate);
      setDailyShares(String(DEFAULTS.dailyShares));
      setMaxGlobalShares(String(DEFAULTS.maxGlobalShares));
      setKiPct(String(DEFAULTS.kiPct));
      setKoPct(String(DEFAULTS.koPct));
      setLeverage(String(DEFAULTS.leverage));
      setSimCount(String(DEFAULTS.simCount));
      setRandomSeed(String(DEFAULTS.randomSeed));
      setContractType('DQ');
      setPeriods(DEFAULT_PERIODS);
      
      setErrors({});

      performCalculation({
          ticker: DEFAULTS.ticker,
          stockName: DEFAULTS.stockName,
          spotPrice: DEFAULTS.spotPrice,
          currentMktPriceStr: "", // 自动获取
          broker: DEFAULTS.broker,
          account: DEFAULTS.account,
          executor: DEFAULTS.executor,
          currency: DEFAULTS.currency,
          tradeDate: DEFAULTS.tradeDate,
          dailyShares: DEFAULTS.dailyShares,
          maxGlobalShares: DEFAULTS.maxGlobalShares,
          kiPct: DEFAULTS.kiPct,
          koPct: DEFAULTS.koPct,
          leverage: DEFAULTS.leverage,
          simCount: DEFAULTS.simCount,
          randomSeed: DEFAULTS.randomSeed,
          riskFreeInputStr: "",
          fxRateInputStr: "",
          historyStartStr: "",
          contractType: 'DQ',
          periodsToUse: DEFAULT_PERIODS
      });
  };

  // --- 3. 清空输入 ---
  const handleReset = () => {
      setTicker("");
      setStockName("");
      setSpotPrice("");
      setCurrentMktPrice("");
      setContractType('DQ');
      setBroker("");
      setAccount("");
      setExecutor("");
      setCurrency("");
      setTradeDate("");
      setDailyShares("");
      setMaxGlobalShares("");
      setKiPct("");
      setKoPct("");
      setLeverage("");
      setSimCount("");
      setRandomSeed("");
      setRiskFreeInput("");
      setFxRateInput("");
      setHistoryStartInput("");
      setPeriods([]);
      setResult(null);
      setHistoryRecords([]);
      setErrors({});
  };

  const uiSpot = spotPrice ? Number(spotPrice) : 0;
  const uiKiPct = kiPct ? Number(kiPct) : 0;
  const uiKoPct = koPct ? Number(koPct) : 0;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* 左侧：输入参数 */}
        <div className="lg:col-span-6 space-y-6">
            
            {/* 1. 标的资产 */}
            <div className="bg-white p-4 shadow rounded border border-gray-200">
                <h3 className="font-bold text-gray-700 border-b pb-2 mb-3">1. 标的资产 (Underlying Info)</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                    <div className="col-span-1 sm:col-span-2">
                        <label className="block text-gray-500 text-xs">标的代码 (Ticker) <span className="text-red-500">*</span></label>
                        <input 
                            className={`border w-full p-1 rounded ${errors.ticker ? 'border-red-500 bg-red-50' : ''}`}
                            value={ticker} 
                            placeholder={DEFAULTS.ticker}
                            onChange={e => setTicker(e.target.value)} 
                        />
                        {errors.ticker && <p className="text-red-500 text-[10px] mt-0.5">{errors.ticker}</p>}
                    </div>
                    <div>
                        <label className="block text-gray-500 text-xs">标的名称 (Stock Name)</label>
                        <input className="border w-full p-1 rounded" value={stockName} placeholder={DEFAULTS.stockName} onChange={e=>setStockName(e.target.value)} />
                    </div>
                    <div>
                        <label className="block text-gray-500 text-xs">初始价格 (S0) <span className="text-red-500">*</span></label>
                        <input type="number" className={`border w-full p-1 rounded ${errors.spotPrice ? 'border-red-500 bg-red-50' : ''}`} value={spotPrice} placeholder={String(DEFAULTS.spotPrice)} onChange={e=>setSpotPrice(e.target.value)} />
                        {errors.spotPrice && <p className="text-red-500 text-[10px] mt-0.5">{errors.spotPrice}</p>}
                    </div>
                    <div className="col-span-1 sm:col-span-2">
                        <label className="block text-gray-500 text-xs">当前市价 (MTM Price)</label>
                        <input type="number" placeholder="留白自动获取" className="border w-full p-1 rounded" value={currentMktPrice} onChange={e=>setCurrentMktPrice(e.target.value)} />
                    </div>
                </div>
            </div>

            {/* 2. 合约条款 */}
            <div className="bg-white p-4 shadow rounded border border-gray-200">
                <h3 className="font-bold text-gray-700 border-b pb-2 mb-3">2. 合约基本条款 (Basic Info)</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                    <div>
                        <label className="block text-gray-500 text-xs">券商 (Broker)</label>
                        <input className="border w-full p-1 rounded" value={broker} placeholder={DEFAULTS.broker} onChange={e=>setBroker(e.target.value)} />
                    </div>
                    <div>
                        <label className="block text-gray-500 text-xs">账户 (Account)</label>
                        <input className="border w-full p-1 rounded" value={account} placeholder={DEFAULTS.account} onChange={e=>setAccount(e.target.value)} />
                    </div>
                    <div>
                        <label className="block text-gray-500 text-xs">执行人 (Executor)</label>
                        <input className="border w-full p-1 rounded" value={executor} placeholder={DEFAULTS.executor} onChange={e=>setExecutor(e.target.value)} />
                    </div>
                    <div>
                        <label className="block text-gray-500 text-xs">币种 (Currency)</label>
                        <input className="border w-full p-1 rounded" value={currency} placeholder={DEFAULTS.currency} onChange={e=>setCurrency(e.target.value)} />
                    </div>
                    <div className="col-span-1 sm:col-span-2">
                        <label className="block text-gray-500 text-xs">交易日期 (Trade Date) <span className="text-red-500">*</span></label>
                        <input type="date" className={`border w-full p-1 rounded text-gray-700 ${errors.tradeDate ? 'border-red-500 bg-red-50' : ''}`} value={tradeDate} onChange={e=>setTradeDate(e.target.value)} />
                        {errors.tradeDate && <p className="text-red-500 text-[10px] mt-0.5">{errors.tradeDate}</p>}
                    </div>
                    <div>
                        <label className="block text-gray-500 text-xs">合约类型 (Type)</label>
                        <select className="border w-full p-1 rounded" value={contractType} onChange={(e:any)=>setContractType(e.target.value)}>
                            <option value="DQ">DQ</option>
                            <option value="AQ">AQ</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-gray-500 text-xs">杠杆 (Leverage) <span className="text-red-500">*</span></label>
                        <input type="number" className={`border w-full p-1 rounded ${errors.leverage ? 'border-red-500 bg-red-50' : ''}`} value={leverage} placeholder={String(DEFAULTS.leverage)} onChange={e=>setLeverage(e.target.value)} />
                        {errors.leverage && <p className="text-red-500 text-[10px] mt-0.5">{errors.leverage}</p>}
                    </div>
                    <div>
                        <label className="block text-gray-500 text-xs">每日股数 (Daily) <span className="text-red-500">*</span></label>
                        <input type="number" className={`border w-full p-1 rounded ${errors.dailyShares ? 'border-red-500 bg-red-50' : ''}`} value={dailyShares} placeholder={String(DEFAULTS.dailyShares)} onChange={e=>setDailyShares(e.target.value)} />
                        {errors.dailyShares && <p className="text-red-500 text-[10px] mt-0.5">{errors.dailyShares}</p>}
                        <span className="text-[9px] text-gray-400">DQ负</span>
                    </div>
                    <div>
                        <label className="block text-gray-500 text-xs">最大股数 (Max) <span className="text-red-500">*</span></label>
                        <input type="number" className={`border w-full p-1 rounded ${errors.maxGlobalShares ? 'border-red-500 bg-red-50' : ''}`} value={maxGlobalShares} placeholder={String(DEFAULTS.maxGlobalShares)} onChange={e=>setMaxGlobalShares(e.target.value)} />
                        {errors.maxGlobalShares && <p className="text-red-500 text-[10px] mt-0.5">{errors.maxGlobalShares}</p>}
                        <span className="text-[9px] text-gray-400">DQ负</span>
                    </div>
                    <div>
                        <label className="block text-gray-500 text-xs">敲入 (KI %) <span className="text-red-500">*</span></label>
                        <input type="number" className={`border w-full p-1 rounded ${errors.kiPct ? 'border-red-500 bg-red-50' : ''}`} value={kiPct} placeholder={String(DEFAULTS.kiPct)} onChange={e=>setKiPct(e.target.value)} step={0.0001}/>
                        {errors.kiPct && <p className="text-red-500 text-[10px] mt-0.5">{errors.kiPct}</p>}
                        <span className="text-[9px] text-gray-400">{(uiSpot * uiKiPct).toFixed(2)}</span>
                    </div>
                    <div>
                        <label className="block text-gray-500 text-xs">敲出 (KO %) <span className="text-red-500">*</span></label>
                        <input type="number" className={`border w-full p-1 rounded ${errors.koPct ? 'border-red-500 bg-red-50' : ''}`} value={koPct} placeholder={String(DEFAULTS.koPct)} onChange={e=>setKoPct(e.target.value)} step={0.01}/>
                        {errors.koPct && <p className="text-red-500 text-[10px] mt-0.5">{errors.koPct}</p>}
                        <span className="text-[9px] text-gray-400">{(uiSpot * uiKoPct).toFixed(2)}</span>
                    </div>
                </div>
            </div>

            {/* 3. 模拟参数 */}
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
                        <span className="text-[9px] text-gray-400">留白T-28</span>
                    </div>
                    <div>
                        <label className="block text-gray-500 text-xs">模拟路径 (Paths) <span className="text-red-500">*</span></label>
                        <input type="number" className={`border w-full p-1 rounded ${errors.simCount ? 'border-red-500 bg-red-50' : ''}`} value={simCount} placeholder={String(DEFAULTS.simCount)} onChange={e=>setSimCount(e.target.value)} />
                        {errors.simCount && <p className="text-red-500 text-[10px] mt-0.5">{errors.simCount}</p>}
                    </div>
                    <div>
                        <label className="block text-gray-500 text-xs">种子 (Seed) <span className="text-red-500">*</span></label>
                        <input type="number" className={`border w-full p-1 rounded ${errors.randomSeed ? 'border-red-500 bg-red-50' : ''}`} value={randomSeed} placeholder={String(DEFAULTS.randomSeed)} onChange={e=>setRandomSeed(e.target.value)} />
                        {errors.randomSeed && <p className="text-red-500 text-[10px] mt-0.5">{errors.randomSeed}</p>}
                    </div>
                    <div className="col-span-1 sm:col-span-2">
                        <label className="block text-gray-500 text-xs">汇率 (To HKD)</label>
                        <input className="border w-full p-1 rounded" placeholder="留白读取Yahoo" value={fxRateInput} onChange={e=>setFxRateInput(e.target.value)} />
                    </div>
                </div>
            </div>

            {/* 4. 观察期 */}
            <div className="bg-white p-4 shadow rounded border border-gray-200">
                <div className="flex justify-between border-b pb-2 mb-3">
                    <h3 className="font-bold text-gray-700">4. 观察期 (Periods)</h3>
                    <div className="space-x-1">
                        <button onClick={addPeriod} className="text-[10px] bg-green-50 text-green-600 px-2 py-1 rounded">+行</button>
                    </div>
                </div>
                {errors.periods && <p className="text-red-500 text-[10px] mb-2">{errors.periods}</p>}
                
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
                    {periods.length === 0 && (
                         <div className="text-center py-4 text-gray-400 border border-dashed rounded mt-2">
                             无数据，请点击右上角 "+行" 或使用 "示例运行"
                         </div>
                    )}
                </div>
            </div>

            {/* 按钮区域 */}
            <div className="flex space-x-3">
                <button 
                    onClick={handleRunValuation}
                    className="flex-1 bg-blue-600 text-white font-bold py-3 rounded shadow hover:bg-blue-700 disabled:opacity-50 transition-colors"
                    disabled={calculating}
                >
                    {calculating ? "计算中..." : "开始估值 (Run)"}
                </button>
                <button 
                    onClick={handleExampleRun}
                    className="w-1/4 bg-gray-100 text-gray-600 font-medium py-3 rounded shadow hover:bg-gray-200 disabled:opacity-50 border border-gray-300 transition-colors text-xs sm:text-sm"
                    disabled={calculating}
                >
                    示例运行
                </button>
                <button 
                    onClick={handleReset}
                    className="w-1/4 bg-red-50 text-red-600 font-medium py-3 rounded shadow hover:bg-red-100 disabled:opacity-50 border border-red-200 transition-colors text-xs sm:text-sm"
                    disabled={calculating}
                >
                    清空输入
                </button>
            </div>

        </div>

        {/* 右侧：结果展示 */}
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

                    {/* 历史结算记录 */}
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
                        <p className="text-xs mt-2 text-gray-300">或点击“示例运行”查看效果</p>
                    </div>
                </div>
            )}
        </div>
    </div>
  );
}