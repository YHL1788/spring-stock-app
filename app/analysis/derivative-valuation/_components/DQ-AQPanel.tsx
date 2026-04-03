//"use client";

import React, { useState, useRef, useEffect } from "react";
import { DQAQValuator, Period, BasicInfo, UnderlyingInfo, SimulationParams, ValuationResult, calculateVolatility, PlotData } from "../../../lib/DQ-AQPricer";

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
    guaranteedDays: 0,
    strikePct: 128.35, 
    koPct: 93,
    leverage: 2.0,
    simCount: 5000,
    randomSeed: 42,
    riskFree: 4.5,
    fxRate: 7.8
};

interface TransactionRecord {
    id: string;
    date: string;
    account: string;
    market: string;
    executor: string;
    type: string;
    direction: string;
    stockCode: string;
    stockName: string;
    quantity: number;
    priceNoFee: number;
    fee: number;
    amountNoFee: number;
    hkdAmount: number;
}

const SimulationChart = ({ data }: { data: PlotData }) => {
    const { history_prices, future_paths, spot_price, barrier_strike, barrier_ko, total_days } = data;

    const fullHistory = [spot_price, ...history_prices];
    const historyLen = fullHistory.length;

    let allPrices = [...fullHistory, barrier_strike, barrier_ko];
    future_paths.forEach(path => allPrices.push(...path));
    const minP = Math.min(...allPrices) * 0.95;
    const maxP = Math.max(...allPrices) * 1.05;
    const rangeP = maxP - minP;

    const width = 500;
    const height = 250;
    const padding = 30;
    const plotW = width - padding * 2;
    const plotH = height - padding * 2;

    const getX = (dayIndex: number) => padding + (dayIndex / total_days) * plotW;
    const getY = (price: number) => padding + plotH - ((price - minP) / rangeP) * plotH;

    const makePath = (prices: number[], startDayIdx: number) => {
        return prices.map((p, i) =>
            `${i === 0 ? 'M' : 'L'} ${getX(startDayIdx + i)} ${getY(p)}`
        ).join(' ');
    };

    const historyPathStr = makePath(fullHistory, 0);

    const getPathColor = (index: number, total: number) => {
        const hue = (index * 137.508) % 360;
        const sat = 65 + (index % 3) * 10;
        const light = 50 + (index % 2) * 10;
        return `hsl(${hue}, ${sat}%, ${light}%)`;
    };

    return (
        <div className="bg-white p-4 rounded border border-gray-200 shadow-sm mt-6">
            <h4 className="font-bold text-gray-700 text-sm mb-4">模拟路径预览 (Monte Carlo Paths)</h4>
            <div className="flex justify-center">
                <svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} className="overflow-visible max-w-lg">
                    {/* Grid */}
                    <rect x={padding} y={padding} width={plotW} height={plotH} fill="#fafafa" stroke="#eee" />

                    {/* Strike Line */}
                    <line x1={padding} y1={getY(barrier_strike)} x2={width - padding} y2={getY(barrier_strike)} stroke="#ef4444" strokeWidth="1.5" strokeDasharray="4 4" />
                    <text x={width - padding + 5} y={getY(barrier_strike) + 3} fontSize="10" fill="#ef4444">Strike</text>

                    {/* KO Line */}
                    <line x1={padding} y1={getY(barrier_ko)} x2={width - padding} y2={getY(barrier_ko)} stroke="#10b981" strokeWidth="1.5" strokeDasharray="4 4" />
                    <text x={width - padding + 5} y={getY(barrier_ko) + 3} fontSize="10" fill="#10b981">KO</text>

                    {/* S0 Line */}
                    <line x1={padding} y1={getY(spot_price)} x2={width - padding} y2={getY(spot_price)} stroke="#ddd" strokeWidth="1" />

                    {/* Sim Paths */}
                    {future_paths.map((path, idx) => {
                        const color = getPathColor(idx, future_paths.length);
                        return (
                            <path
                                key={`sim-${idx}`}
                                d={`M ${getX(historyLen - 1)} ${getY(fullHistory[fullHistory.length - 1])} ` + makePath(path, historyLen).substring(1)}
                                fill="none"
                                stroke={color}
                                strokeWidth="0.8"
                                opacity="0.5"
                            />
                        );
                    })}

                    {/* History Path */}
                    <path d={historyPathStr} fill="none" stroke="#1f2937" strokeWidth="2.5" />

                    {/* Current Dot */}
                    <circle cx={getX(historyLen - 1)} cy={getY(fullHistory[fullHistory.length - 1])} r="3" fill="#1f2937" />

                    {/* Labels */}
                    <text x={padding} y={height - 10} fontSize="10" fill="#888">T=0</text>
                    <text x={width - padding} y={height - 10} fontSize="10" fill="#888" textAnchor="end">End</text>
                </svg>
            </div>
            <div className="flex justify-center gap-4 mt-2 text-[10px] text-gray-500">
                <div className="flex items-center"><span className="w-3 h-0.5 bg-gray-800 mr-1"></span>历史路径</div>
                <div className="flex items-center"><span className="w-3 h-0.5 bg-gradient-to-r from-red-400 via-green-400 to-blue-400 mr-1"></span>未来模拟</div>
                <div className="flex items-center"><span className="w-3 h-0.5 border-t border-dashed border-red-500 mr-1"></span>行权界限</div>
                <div className="flex items-center"><span className="w-3 h-0.5 border-t border-dashed border-green-500 mr-1"></span>KO界限</div>
            </div>
        </div>
    );
};

export default function DQAQPanel() {
    // State: 1. Underlying
    const [ticker, setTicker] = useState("");
    const [stockName, setStockName] = useState("");
    const [spotPrice, setSpotPrice] = useState<string>("");
    const [currentMktPrice, setCurrentMktPrice] = useState<string>("");
    const [loadingMarket, setLoadingMarket] = useState(false);

    // State: 2. Basic
    const [contractType, setContractType] = useState<'DQ' | 'AQ'>('DQ');
    const [broker, setBroker] = useState("");
    const [account, setAccount] = useState("");
    const [executor, setExecutor] = useState("");
    const [currency, setCurrency] = useState("USD");
    const [tradeDate, setTradeDate] = useState("");
    const [dailyShares, setDailyShares] = useState<string>("");
    const [maxGlobalShares, setMaxGlobalShares] = useState<string>("");
    const [guaranteedDays, setGuaranteedDays] = useState<string>(""); 
    const [strikePct, setStrikePct] = useState<string>("");
    const [koPct, setKoPct] = useState<string>("");
    const [leverage, setLeverage] = useState<string>("");

    // State: 3. Sim
    const [simCount, setSimCount] = useState<string>("");
    const [randomSeed, setRandomSeed] = useState<string>("");
    const [riskFreeInput, setRiskFreeInput] = useState<string>("");
    const [fxRateInput, setFxRateInput] = useState<string>("");
    const [historyStartInput, setHistoryStartInput] = useState<string>("");

    // State: 4. Periods
    const [periods, setPeriods] = useState<Period[]>([]);

    // UI State
    const [calculating, setCalculating] = useState(false);
    const [result, setResult] = useState<ValuationResult | null>(null);
    const [errors, setErrors] = useState<Record<string, string>>({});

    const [txRecords, setTxRecords] = useState<TransactionRecord[]>([]);
    const [editingTxId, setEditingTxId] = useState<string | null>(null);
    const [isHKDView, setIsHKDView] = useState(false);

    // 逻辑函数
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
        const reindexed = p.map((item, i) => ({ ...item, period_id: i + 1 }));
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

    interface CalcParams {
        ticker: string; stockName: string; spotPrice: number; currentMktPriceStr: string;
        broker: string; account: string; executor: string; currency: string;
        tradeDate: string; dailyShares: number; maxGlobalShares: number; guaranteedDays: number;
        strikePct: number; koPct: number; leverage: number;
        simCount: number; randomSeed: number;
        riskFreeInputStr: string; fxRateInputStr: string; historyStartStr: string;
        contractType: 'DQ' | 'AQ';
        periodsToUse: Period[];
    }

    const performCalculation = async (params: CalcParams) => {
        if (params.periodsToUse.length === 0) {
            setErrors(prev => ({ ...prev, periods: "！，请至少添加一个观察期" }));
            return;
        }

        setCalculating(true);
        setResult(null);
        setTxRecords([]);

        await new Promise(r => setTimeout(r, 100));

        try {
            // 1. 无风险利率（现已改为必填项）
            let r = parseFloat(params.riskFreeInputStr) / 100;
            if (isNaN(r)) {
                throw new Error("无风险利率无效，请重新输入");
            }

            // 2. 汇率抓取及 UI 回填
            let fx = 1.0;
            if (params.currency === 'HKD') {
                fx = 1.0;
                if (params.fxRateInputStr === "") setFxRateInput("1.0");
            } else if (params.fxRateInputStr !== "") {
                fx = parseFloat(params.fxRateInputStr);
            } else {
                try {
                    const res = await fetch(`/api/quote?currency=${params.currency}`);
                    if (res.ok) {
                        const data = await res.json();
                        fx = data?.rate || DEFAULTS.fxRate;
                    } else {
                        fx = DEFAULTS.fxRate;
                    }
                } catch (e) { 
                    fx = DEFAULTS.fxRate;
                }
                setFxRateInput(fx.toFixed(4)); // 自动回填真实使用的汇率
            }

            // 3. 历史数据起点推算及 UI 回填
            let hStart = params.historyStartStr;
            if (hStart === "") {
                const d = new Date(params.tradeDate);
                d.setDate(d.getDate() - 28);
                hStart = d.toISOString().split('T')[0];
                setHistoryStartInput(hStart); // 自动回填推算的日期
            }

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
            } catch (e) {
                console.warn("History fetch error:", e);
            }

            // --- 时序错位安检门 (Security Check) ---
            const valDtStr = new Date().toISOString().split('T')[0];
            for (const p of params.periodsToUse) {
                if (p.obs_end < valDtStr) {
                    const days_in_history = historyDates.filter(d => d >= p.obs_start && d <= p.obs_end).length;
                    if (days_in_history !== p.trading_days) {
                        throw new Error(`[日期错位拦截] 第 ${p.period_id} 期 (${p.obs_start} 至 ${p.obs_end}) 实际拉取到 ${days_in_history} 个有效交易日收盘价，但您输入的交易日数为 ${p.trading_days} 天。请检查该区间是否包含节假日/恶劣天气休市，并修正【日期信息】表格中的天数，以保证估值精准！`);
                    }
                }
            }

            const sigma = calculateVolatility(historyPrices);

            // 4. 当前市价抓取及 UI 回填
            let finalMktPrice = params.spotPrice;
            if (params.currentMktPriceStr !== "") {
                finalMktPrice = parseFloat(params.currentMktPriceStr);
            } else {
                const p = await fetchQuotePrice(params.ticker);
                if (p !== null) {
                    finalMktPrice = p;
                    setCurrentMktPrice(p.toString()); // 自动回填市价
                } else if (historyPrices.length > 0) {
                    finalMktPrice = historyPrices[historyPrices.length - 1];
                    setCurrentMktPrice(finalMktPrice.toString()); // 自动回填最后一个历史收盘价
                } else {
                    setCurrentMktPrice(finalMktPrice.toString()); // 如果都没抓到，用 S0 兜底填入
                }
            }

            const basic: BasicInfo = {
                contract_type: params.contractType,
                broker: params.broker,
                account: params.account,
                executor: params.executor,
                currency: params.currency,
                trade_date: params.tradeDate,
                daily_shares: params.dailyShares,
                max_global_shares: params.maxGlobalShares,
                guaranteed_days: params.guaranteedDays,
                strike_pct: params.strikePct / 100,
                ko_barrier_pct: params.koPct / 100,
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
            
            const res = valuator.generate_report(finalMktPrice, historyPrices, historyDates, valDtStr, fx);
            setResult(res);

            if (res.history_records) {
                const newTxRecords: TransactionRecord[] = [];
                res.history_records.forEach((rec: any, index: number) => {
                    if (rec.status === 'Settled' || rec.status === 'Knocked Out') {
                        const isBuy = params.contractType === 'AQ';
                        const direction = isBuy ? "Buy" : "Sell";
                        let qty = Math.abs(rec.shares);
                        if (direction === 'Sell') qty = -Math.abs(qty);

                        const strikePrice = params.spotPrice * (params.strikePct / 100);
                        const amountNoFee = qty * strikePrice;
                        const fee = 0;
                        const amountWithFee = amountNoFee + fee;

                        let marketCode = "HK";
                        if (params.currency === 'USD') marketCode = "US";
                        else if (params.currency === 'JPY') marketCode = "JP";
                        else if (params.currency === 'CNY') marketCode = "CH";

                        if (Math.abs(qty) > 0.0001) {
                            newTxRecords.push({
                                id: `tx-${index}-${Date.now()}`,
                                date: rec.settle_date, 
                                account: params.account,
                                market: marketCode,
                                executor: params.executor,
                                type: params.contractType,
                                direction: direction,
                                stockCode: params.ticker,
                                stockName: params.stockName || params.ticker,
                                quantity: Number(qty.toFixed(2)),
                                priceNoFee: Number(strikePrice.toFixed(4)),
                                fee: 0,
                                amountNoFee: Number(amountNoFee.toFixed(2)),
                                hkdAmount: Number((amountWithFee * (fx || 1)).toFixed(2))
                            });
                        }
                    }
                });
                setTxRecords(newTxRecords);
            }

        } catch (e: any) {
            alert("计算/数据错误: " + (e.message || e));
        } finally {
            setCalculating(false);
        }
    };

    const handleRunValuation = () => {
        const newErrors: Record<string, string> = {};

        if (!ticker) newErrors["ticker"] = "！，请输入数据";
        if (!spotPrice) newErrors["spotPrice"] = "！，请输入数据";
        if (!tradeDate) newErrors["tradeDate"] = "！，请输入数据";
        if (!dailyShares) newErrors["dailyShares"] = "！，请输入数据";
        if (!maxGlobalShares) newErrors["maxGlobalShares"] = "！，请输入数据";
        if (!strikePct) newErrors["strikePct"] = "！，请输入数据";
        if (!koPct) newErrors["koPct"] = "！，请输入数据";
        if (!leverage) newErrors["leverage"] = "！，请输入数据";
        if (!simCount) newErrors["simCount"] = "！，请输入数据";
        if (!randomSeed) newErrors["randomSeed"] = "！，请输入数据";
        if (guaranteedDays === "") newErrors["guaranteedDays"] = "！，请输入数据";
        if (riskFreeInput === "") newErrors["riskFree"] = "！，请输入数据";

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
            guaranteedDays: Number(guaranteedDays),
            strikePct: Number(strikePct),
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
        setGuaranteedDays(String(DEFAULTS.guaranteedDays));
        setStrikePct(String(DEFAULTS.strikePct));
        setKoPct(String(DEFAULTS.koPct));
        setLeverage(String(DEFAULTS.leverage));
        setSimCount(String(DEFAULTS.simCount));
        setRandomSeed(String(DEFAULTS.randomSeed));
        setRiskFreeInput(String(DEFAULTS.riskFree)); // 回填 UI 的默认无风险利率
        setContractType('DQ');
        setPeriods(DEFAULT_PERIODS);

        setErrors({});

        performCalculation({
            ticker: DEFAULTS.ticker,
            stockName: DEFAULTS.stockName,
            spotPrice: DEFAULTS.spotPrice,
            currentMktPriceStr: "",
            broker: DEFAULTS.broker,
            account: DEFAULTS.account,
            executor: DEFAULTS.executor,
            currency: DEFAULTS.currency,
            tradeDate: DEFAULTS.tradeDate,
            dailyShares: DEFAULTS.dailyShares,
            maxGlobalShares: DEFAULTS.maxGlobalShares,
            guaranteedDays: DEFAULTS.guaranteedDays,
            strikePct: DEFAULTS.strikePct,
            koPct: DEFAULTS.koPct,
            leverage: DEFAULTS.leverage,
            simCount: DEFAULTS.simCount,
            randomSeed: DEFAULTS.randomSeed,
            riskFreeInputStr: String(DEFAULTS.riskFree),
            fxRateInputStr: "",
            historyStartStr: "",
            contractType: 'DQ',
            periodsToUse: DEFAULT_PERIODS
        });
    };

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
        setGuaranteedDays("");
        setStrikePct("");
        setKoPct("");
        setLeverage("");
        setSimCount("");
        setRandomSeed("");
        setRiskFreeInput("");
        setFxRateInput("");
        setHistoryStartInput("");
        setPeriods([]);
        setResult(null);
        setTxRecords([]);
        setErrors({});
    };

    const handleTxChange = (id: string, field: keyof TransactionRecord, value: any) => {
        setTxRecords(prev => prev.map(rec => {
            if (rec.id !== id) return rec;

            const updatedRec = { ...rec, [field]: value };

            if (field === 'quantity' || field === 'priceNoFee' || field === 'fee') {
                const qty = field === 'quantity' ? parseFloat(value) : rec.quantity;
                const price = field === 'priceNoFee' ? parseFloat(value) : rec.priceNoFee;
                const fee = field === 'fee' ? parseFloat(value) : rec.fee;

                if (!isNaN(qty) && !isNaN(price)) {
                    updatedRec.amountNoFee = qty * price;
                    const fx = parseFloat(fxRateInput) || DEFAULTS.fxRate;
                    updatedRec.hkdAmount = (updatedRec.amountNoFee + (isNaN(fee) ? 0 : fee)) * fx;
                }
            }
            else if (field === 'amountNoFee') {
                const amt = parseFloat(value);
                if (!isNaN(amt) && Math.abs(rec.quantity) > 0) {
                    updatedRec.priceNoFee = amt / rec.quantity;
                    const fx = parseFloat(fxRateInput) || DEFAULTS.fxRate;
                    updatedRec.hkdAmount = (amt + rec.fee) * fx;
                }
            }

            return updatedRec;
        }));
    };

    const getAmountWithFee = (rec: TransactionRecord) => rec.amountNoFee + rec.fee;
    const getPriceWithFee = (rec: TransactionRecord) => Math.abs(rec.quantity) > 0 ? (rec.amountNoFee + rec.fee) / rec.quantity : 0;
    const fmtMoney = (val: number, currency: string = "") =>
        new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD' }).format(val);

    const getDisplayCurrency = () => isHKDView ? 'HKD' : (currency || 'USD');
    const getDisplayValue = (val: number) => {
        const rate = result?.final_fx_rate || 1.0;
        if (isHKDView) return val * rate;
        return val;
    };

    const uiSpot = spotPrice ? Number(spotPrice) : 0;
    const uiStrikePct = strikePct ? Number(strikePct) : 0;
    const uiKoPct = koPct ? Number(koPct) : 0;

    return (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

            {/* 左侧：输入参数 */}
            <div className="lg:col-span-6 space-y-6">

                {/* 1. 基础信息 (Basic Info) */}
                <div className="bg-white p-4 shadow rounded border border-gray-200">
                    <h3 className="font-bold text-gray-700 border-b pb-2 mb-3">1. 基础信息 (Basic Info)</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                        <div>
                            <label className="block text-gray-500 text-xs">券商 (Broker)</label>
                            <input className="border w-full p-1 rounded" value={broker} placeholder={DEFAULTS.broker} onChange={e => setBroker(e.target.value)} />
                        </div>
                        <div>
                            <label className="block text-gray-500 text-xs">账户 (Account)</label>
                            <input className="border w-full p-1 rounded" value={account} placeholder={DEFAULTS.account} onChange={e => setAccount(e.target.value)} />
                        </div>
                        <div>
                            <label className="block text-gray-500 text-xs">执行人 (Executor)</label>
                            <input className="border w-full p-1 rounded" value={executor} placeholder={DEFAULTS.executor} onChange={e => setExecutor(e.target.value)} />
                        </div>
                        <div>
                            <label className="block text-gray-500 text-xs">币种 (Currency)</label>
                            <select className="border w-full p-1 rounded" value={currency} onChange={(e: any) => setCurrency(e.target.value)}>
                                <option value="HKD">HKD</option>
                                <option value="USD">USD</option>
                                <option value="CNY">CNY</option>
                                <option value="JPY">JPY</option>
                            </select>
                        </div>
                        <div className="col-span-1 sm:col-span-2">
                            <label className="block text-gray-500 text-xs">交易日期 (Trade Date) <span className="text-red-500">*</span></label>
                            <input type="date" className={`border w-full p-1 rounded text-gray-700 ${errors.tradeDate ? 'border-red-500 bg-red-50' : ''}`} value={tradeDate} onChange={e => setTradeDate(e.target.value)} />
                            {errors.tradeDate && <p className="text-red-500 text-[10px] mt-0.5">{errors.tradeDate}</p>}
                        </div>
                        <div>
                            <label className="block text-gray-500 text-xs">合约类型 (Type)</label>
                            <select className="border w-full p-1 rounded" value={contractType} onChange={(e: any) => setContractType(e.target.value)}>
                                <option value="DQ">DQ (减持)</option>
                                <option value="AQ">AQ (累积)</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-gray-500 text-xs">杠杆 (Leverage) <span className="text-red-500">*</span></label>
                            <input type="number" className={`border w-full p-1 rounded ${errors.leverage ? 'border-red-500 bg-red-50' : ''}`} value={leverage} placeholder={String(DEFAULTS.leverage)} onChange={e => setLeverage(e.target.value)} />
                            {errors.leverage && <p className="text-red-500 text-[10px] mt-0.5">{errors.leverage}</p>}
                        </div>
                        <div>
                            <label className="block text-gray-500 text-xs">每日股数 (Daily) <span className="text-red-500">*</span></label>
                            <input type="number" className={`border w-full p-1 rounded ${errors.dailyShares ? 'border-red-500 bg-red-50' : ''}`} value={dailyShares} placeholder={String(DEFAULTS.dailyShares)} onChange={e => setDailyShares(e.target.value)} />
                            {errors.dailyShares && <p className="text-red-500 text-[10px] mt-0.5">{errors.dailyShares}</p>}
                            <span className="text-[9px] font-bold text-red-500">DQ必须为负，AQ必须为正</span>
                        </div>
                        <div>
                            <label className="block text-gray-500 text-xs">最大股数 (Max) <span className="text-red-500">*</span></label>
                            <input type="number" className={`border w-full p-1 rounded ${errors.maxGlobalShares ? 'border-red-500 bg-red-50' : ''}`} value={maxGlobalShares} placeholder={String(DEFAULTS.maxGlobalShares)} onChange={e => setMaxGlobalShares(e.target.value)} />
                            {errors.maxGlobalShares && <p className="text-red-500 text-[10px] mt-0.5">{errors.maxGlobalShares}</p>}
                            <span className="text-[9px] font-bold text-red-500">DQ必须为负，AQ必须为正</span>
                        </div>
                        <div>
                            <label className="block text-gray-500 text-xs font-bold text-indigo-600">保证天数 (Guaranteed Days) <span className="text-red-500">*</span></label>
                            <input type="number" min="0" className={`border w-full p-1 rounded bg-indigo-50 border-indigo-200 focus:ring-1 focus:ring-indigo-400 ${errors.guaranteedDays ? 'border-red-500' : ''}`} value={guaranteedDays} placeholder={String(DEFAULTS.guaranteedDays)} onChange={e => setGuaranteedDays(e.target.value)} />
                            {errors.guaranteedDays && <p className="text-red-500 text-[10px] mt-0.5">{errors.guaranteedDays}</p>}
                        </div>
                        <div className="hidden sm:block"></div> {/* 占位符 */}
                        <div>
                            <label className="block text-gray-500 text-xs">行权价 (Strike) <span className="text-red-500">*</span></label>
                            <div className="relative">
                                <input type="number" className={`border w-full p-1 pr-5 rounded ${errors.strikePct ? 'border-red-500 bg-red-50' : ''}`} value={strikePct} placeholder={String(DEFAULTS.strikePct)} onChange={e => setStrikePct(e.target.value)} step={0.01} />
                                <span className="absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-400 text-xs pointer-events-none">%</span>
                            </div>
                            {errors.strikePct && <p className="text-red-500 text-[10px] mt-0.5">{errors.strikePct}</p>}
                            <span className="text-[9px] text-gray-400">{(uiSpot * uiStrikePct / 100).toFixed(2)}</span>
                        </div>
                        <div>
                            <label className="block text-gray-500 text-xs">敲出 (KO) <span className="text-red-500">*</span></label>
                            <div className="relative">
                                <input type="number" className={`border w-full p-1 pr-5 rounded ${errors.koPct ? 'border-red-500 bg-red-50' : ''}`} value={koPct} placeholder={String(DEFAULTS.koPct)} onChange={e => setKoPct(e.target.value)} step={0.01} />
                                <span className="absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-400 text-xs pointer-events-none">%</span>
                            </div>
                            {errors.koPct && <p className="text-red-500 text-[10px] mt-0.5">{errors.koPct}</p>}
                            <span className="text-[9px] text-gray-400">{(uiSpot * uiKoPct / 100).toFixed(2)}</span>
                        </div>
                    </div>
                </div>

                {/* 2. 标的信息 (Underlying Info) */}
                <div className="bg-white p-4 shadow rounded border border-gray-200">
                    <h3 className="font-bold text-gray-700 border-b pb-2 mb-3">2. 标的信息 (Underlying Info)</h3>
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
                            <input className="border w-full p-1 rounded" value={stockName} placeholder={DEFAULTS.stockName} onChange={e => setStockName(e.target.value)} />
                        </div>
                        <div>
                            <label className="block text-gray-500 text-xs">初始价格 (S0) <span className="text-red-500">*</span></label>
                            <input type="number" className={`border w-full p-1 rounded ${errors.spotPrice ? 'border-red-500 bg-red-50' : ''}`} value={spotPrice} placeholder={String(DEFAULTS.spotPrice)} onChange={e => setSpotPrice(e.target.value)} />
                            {errors.spotPrice && <p className="text-red-500 text-[10px] mt-0.5">{errors.spotPrice}</p>}
                        </div>
                        <div className="col-span-1 sm:col-span-2">
                            <label className="block text-gray-500 text-xs">当前市价 (MTM Price)</label>
                            <input type="number" placeholder="留白自动获取" className="border w-full p-1 rounded" value={currentMktPrice} onChange={e => setCurrentMktPrice(e.target.value)} />
                        </div>
                    </div>
                </div>

                {/* 3. 日期信息 (Periods) */}
                <div className="bg-white p-4 shadow rounded border border-gray-200">
                    <div className="flex justify-between border-b pb-2 mb-3">
                        <h3 className="font-bold text-gray-700">3. 日期信息 (Periods)</h3>
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
                                        <td className="border p-0"><input type="date" className="w-full p-1 text-center" value={p.obs_start} onChange={e => updatePeriod(idx, 'obs_start', e.target.value)} /></td>
                                        <td className="border p-0"><input type="date" className="w-full p-1 text-center" value={p.obs_end} onChange={e => updatePeriod(idx, 'obs_end', e.target.value)} /></td>
                                        <td className="border p-0"><input type="date" className="w-full p-1 text-center" value={p.settle_date} onChange={e => updatePeriod(idx, 'settle_date', e.target.value)} /></td>
                                        <td className="border p-0"><input type="number" className="w-full p-1 text-center" value={p.trading_days} onChange={e => updatePeriod(idx, 'trading_days', Number(e.target.value))} /></td>
                                        <td className="border p-1"><button onClick={() => removePeriod(idx)} className="text-red-500">×</button></td>
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

                {/* 4. 模拟信息 (Simulation Params) */}
                <div className="bg-white p-4 shadow rounded border border-gray-200">
                    <h3 className="font-bold text-gray-700 border-b pb-2 mb-3">4. 模拟信息 (Simulation Params)</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                        <div>
                            <label className="block text-gray-500 text-xs">无风险利率 (r) <span className="text-red-500">*</span></label>
                            <div className="relative">
                                <input type="number" className={`border w-full p-1 pr-5 rounded ${errors.riskFree ? 'border-red-500 bg-red-50' : ''}`} placeholder={String(DEFAULTS.riskFree)} value={riskFreeInput} onChange={e => setRiskFreeInput(e.target.value)} step={0.01} />
                                <span className="absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-400 text-xs pointer-events-none">%</span>
                            </div>
                            {errors.riskFree && <p className="text-red-500 text-[10px] mt-0.5">{errors.riskFree}</p>}
                        </div>
                        <div>
                            <label className="block text-gray-500 text-xs">历史数据起始日 (Start)</label>
                            <input type="date" className="border w-full p-1 rounded" value={historyStartInput} onChange={e => setHistoryStartInput(e.target.value)} />
                            <span className="text-[9px] text-gray-400">留白自动T-28</span>
                        </div>
                        <div>
                            <label className="block text-gray-500 text-xs">模拟路径 (Paths) <span className="text-red-500">*</span></label>
                            <input type="number" className={`border w-full p-1 rounded ${errors.simCount ? 'border-red-500 bg-red-50' : ''}`} value={simCount} placeholder={String(DEFAULTS.simCount)} onChange={e => setSimCount(e.target.value)} />
                            {errors.simCount && <p className="text-red-500 text-[10px] mt-0.5">{errors.simCount}</p>}
                        </div>
                        <div>
                            <label className="block text-gray-500 text-xs">种子 (Seed) <span className="text-red-500">*</span></label>
                            <input type="number" className={`border w-full p-1 rounded ${errors.randomSeed ? 'border-red-500 bg-red-50' : ''}`} value={randomSeed} placeholder={String(DEFAULTS.randomSeed)} onChange={e => setRandomSeed(e.target.value)} />
                            {errors.randomSeed && <p className="text-red-500 text-[10px] mt-0.5">{errors.randomSeed}</p>}
                        </div>
                        <div className="col-span-1 sm:col-span-2">
                            <label className="block text-gray-500 text-xs">汇率 (To HKD)</label>
                            <input className="border w-full p-1 rounded" placeholder={`留白自动获取 ${currency !== 'HKD' ? currency : 'USD'}/HKD`} value={fxRateInput} onChange={e => setFxRateInput(e.target.value)} />
                        </div>
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
                        <div className="border-b border-gray-200 pb-4">
                            <div className="flex justify-between items-start">
                                <div>
                                    <h4 className="font-bold text-xl text-gray-800">估值结果 (Mark-to-Market)</h4>
                                    <span className={`px-3 py-1 rounded text-sm font-bold ${result.status_msg.includes('提前敲出') || result.status_msg.includes('Expired') ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                                        {result.status_msg}
                                    </span>
                                </div>
                                <div className="flex flex-col items-end gap-2">
                                    <button onClick={() => setIsHKDView(!isHKDView)} className={`px-3 py-1 text-xs font-medium rounded border transition-colors ${isHKDView ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}>
                                        {isHKDView ? '已转为 HKD' : 'HKD 转换'}
                                    </button>
                                    <span className="text-xs text-gray-400">{new Date().toLocaleString()}</span>
                                </div>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-6">
                            <div className="bg-gray-50 p-4 rounded border border-gray-100">
                                <p className="text-gray-500 text-xs mb-1">期望总股数 (Expected Shares)</p>
                                <p className="font-bold text-2xl text-gray-900">{result.expected_shares.toFixed(2)}</p>
                            </div>
                            <div className="bg-blue-50 p-4 rounded border border-blue-100">
                                <p className="text-blue-500 text-xs mb-1">预期完成率 (Completion Rate)</p>
                                <p className="font-bold text-2xl text-blue-700">
                                    {Number(maxGlobalShares) !== 0 ? ((result.expected_shares * Number(leverage) / Number(maxGlobalShares)) * 100).toFixed(2) : "0.00"}%
                                </p>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="bg-gray-50 p-4 rounded border border-gray-200">
                                <p className="text-gray-600 text-sm font-medium mb-2">【全价 Full Price】(含历史)</p>
                                <div className="flex items-baseline space-x-2">
                                    <p className="font-bold text-2xl">{fmtMoney(getDisplayValue(result.val_full_usd), getDisplayCurrency())}</p>
                                </div>
                            </div>

                            <div className="bg-green-50 p-4 rounded border border-green-200">
                                <p className="text-green-800 text-sm font-medium mb-2">【净价 Net Price】(转手价)</p>
                                <div className="flex items-baseline space-x-2">
                                    <p className="font-bold text-2xl text-green-700">{fmtMoney(getDisplayValue(result.val_net_usd), getDisplayCurrency())}</p>
                                </div>
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

                        {/* 股价点位图 */}
                        {(result.status_msg.includes("存续中") || result.plot_data) && result.plot_data && (
                            <SimulationChart data={result.plot_data} />
                        )}

                        {/* 历史结算记录 */}
                        {(txRecords && txRecords.length > 0) && (
                            <div className="mt-8 border-t border-gray-200 pt-6">
                                <div className="flex justify-between items-center mb-4">
                                    <h3 className="text-lg font-bold text-gray-800">交易记录 (自动生成)</h3>
                                    <div>
                                        {editingTxId ? (
                                            <button onClick={() => setEditingTxId(null)} className="px-3 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700 transition-colors">完成</button>
                                        ) : (
                                            <button onClick={() => setEditingTxId('all')} className="px-3 py-1 bg-gray-100 text-gray-600 text-xs rounded hover:bg-gray-200 transition-colors">修改</button>
                                        )}
                                    </div>
                                </div>
                                <div className="bg-gray-50 rounded-lg p-4 text-sm overflow-x-auto">
                                    <table className="min-w-full divide-y divide-gray-200 whitespace-nowrap">
                                        <thead className="bg-gray-100">
                                            <tr>
                                                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">日期</th>
                                                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">账户</th>
                                                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">市场</th>
                                                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">执行人</th>
                                                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">类型</th>
                                                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">方向</th>
                                                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">代码</th>
                                                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">名称</th>
                                                <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">数量</th>
                                                <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">均价(不含费)</th>
                                                <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">手续费</th>
                                                <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">金额(不含费)</th>
                                                <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">均价(含费)</th>
                                                <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">金额(含费)</th>
                                                <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">HKD金额</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-200">
                                            {txRecords.map((rec) => (
                                                <tr key={rec.id} className="hover:bg-gray-50">
                                                    <td className="px-3 py-2 text-blue-700 font-bold">{editingTxId === 'all' || editingTxId === rec.id ? <input type="date" value={rec.date} onChange={(e) => handleTxChange(rec.id, 'date', e.target.value)} className="border rounded p-1 w-24 text-xs" /> : rec.date}</td>
                                                    <td className="px-3 py-2">{editingTxId === 'all' || editingTxId === rec.id ? <input value={rec.account} onChange={(e) => handleTxChange(rec.id, 'account', e.target.value)} className="border rounded p-1 w-20 text-xs" /> : rec.account}</td>
                                                    <td className="px-3 py-2">{editingTxId === 'all' || editingTxId === rec.id ? <select value={rec.market} onChange={(e) => handleTxChange(rec.id, 'market', e.target.value)} className="border rounded p-1 w-16 text-xs"><option value="HK">HK</option><option value="US">US</option><option value="JP">JP</option><option value="CH">CH</option></select> : rec.market}</td>
                                                    <td className="px-3 py-2">{editingTxId === 'all' || editingTxId === rec.id ? <input value={rec.executor} onChange={(e) => handleTxChange(rec.id, 'executor', e.target.value)} className="border rounded p-1 w-20 text-xs" /> : rec.executor}</td>
                                                    <td className="px-3 py-2">{editingTxId === 'all' || editingTxId === rec.id ? <input value={rec.type} onChange={(e) => handleTxChange(rec.id, 'type', e.target.value)} className="border rounded p-1 w-16 text-xs" /> : rec.type}</td>
                                                    <td className="px-3 py-2 text-green-600 font-medium">{editingTxId === 'all' || editingTxId === rec.id ? <select value={rec.direction} onChange={(e) => handleTxChange(rec.id, 'direction', e.target.value)} className="border rounded p-1 w-20 text-xs"><option value="Buy">Buy</option><option value="Sell">Sell</option></select> : rec.direction}</td>
                                                    <td className="px-3 py-2">{editingTxId === 'all' || editingTxId === rec.id ? <input value={rec.stockCode} onChange={(e) => handleTxChange(rec.id, 'stockCode', e.target.value)} className="border rounded p-1 w-20 text-xs" /> : rec.stockCode}</td>
                                                    <td className="px-3 py-2">{editingTxId === 'all' || editingTxId === rec.id ? <input value={rec.stockName} onChange={(e) => handleTxChange(rec.id, 'stockName', e.target.value)} className="border rounded p-1 w-24 text-xs" /> : rec.stockName}</td>
                                                    <td className={`px-3 py-2 text-right ${rec.quantity < 0 ? 'text-red-600' : ''}`}>{editingTxId === 'all' || editingTxId === rec.id ? <input type="number" value={rec.quantity} onChange={(e) => handleTxChange(rec.id, 'quantity', e.target.value)} className="border rounded p-1 w-20 text-xs text-right" /> : rec.quantity}</td>
                                                    <td className="px-3 py-2 text-right">{editingTxId === 'all' || editingTxId === rec.id ? <input type="number" value={rec.priceNoFee} onChange={(e) => handleTxChange(rec.id, 'priceNoFee', e.target.value)} className="border rounded p-1 w-20 text-xs text-right" /> : fmtMoney(getDisplayValue(rec.priceNoFee), getDisplayCurrency())}</td>
                                                    <td className="px-3 py-2 text-right">{editingTxId === 'all' || editingTxId === rec.id ? <input type="number" value={rec.fee} onChange={(e) => handleTxChange(rec.id, 'fee', e.target.value)} className="border rounded p-1 w-16 text-xs text-right" /> : fmtMoney(getDisplayValue(rec.fee), getDisplayCurrency())}</td>
                                                    <td className={`px-3 py-2 text-right ${rec.amountNoFee < 0 ? 'text-red-600' : ''}`}>{fmtMoney(getDisplayValue(rec.amountNoFee), getDisplayCurrency())}</td>
                                                    <td className="px-3 py-2 text-right">{fmtMoney(getDisplayValue(getPriceWithFee(rec)), getDisplayCurrency())}</td>
                                                    <td className={`px-3 py-2 text-right ${getAmountWithFee(rec) < 0 ? 'text-red-600' : ''}`}>{fmtMoney(getDisplayValue(getAmountWithFee(rec)), getDisplayCurrency())}</td>
                                                    <td className={`px-3 py-2 text-right ${rec.hkdAmount < 0 ? 'text-red-600' : ''}`}>HKD {new Intl.NumberFormat('en-US', { style: 'decimal', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(rec.hkdAmount)}</td>
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
                        <svg className="w-16 h-16 mb-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                        <p className="text-lg">请配置左侧参数并开始估值</p>
                        <p className="text-xs mt-2 text-gray-300">或点击“示例运行”查看效果</p>
                        <p className="text-xs mt-1 text-gray-300">基于 {Number(simCount) || 5000} 次蒙特卡洛模拟</p>
                    </div>
                )}
            </div>
        </div>
    );
}