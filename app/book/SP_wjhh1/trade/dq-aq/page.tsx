'use client';

import React, { useState, useEffect } from 'react';
import { 
  Play, Save, Loader2, AlertCircle, CheckCircle, X, Database, Trash2, RefreshCw, FileJson, Edit2 
} from 'lucide-react';
import { 
  collection, addDoc, getDocs, deleteDoc, doc, updateDoc, query, where 
} from 'firebase/firestore';
import { onAuthStateChanged, signInAnonymously, signInWithCustomToken } from 'firebase/auth';

// 引入 Firebase 配置與 DQ-AQ 引擎
import { db, auth, APP_ID } from '@/app/lib/stockService';
import { DQAQValuator, Period, BasicInfo, UnderlyingInfo, SimulationParams, ValuationResult, calculateVolatility, PlotData } from '@/app/lib/DQ-AQPricer';

// --- 時間解析輔助函數 ---
const getTime = (val: any) => {
    if (!val) return 0;
    if (val.toMillis && typeof val.toMillis === 'function') return val.toMillis();
    if (val.seconds) return val.seconds * 1000;
    return new Date(val).getTime() || 0;
};

const formatTime = (val: any) => {
    if (!val) return null;
    if (val.toDate && typeof val.toDate === 'function') return val.toDate().toLocaleString();
    if (val.seconds) return new Date(val.seconds * 1000).toLocaleString();
    return new Date(val).toLocaleString();
};

// 默认观察期配置
const DEFAULT_PERIODS: Period[] = [
    { period_id: 1, obs_start: "2025-10-09", obs_end: "2025-10-22", settle_date: "2025-10-23", trading_days: 10 },
    { period_id: 2, obs_start: "2025-10-23", obs_end: "2025-11-05", settle_date: "2025-11-06", trading_days: 10 },
    { period_id: 3, obs_start: "2025-11-06", obs_end: "2025-11-19", settle_date: "2025-11-20", trading_days: 10 },
    { period_id: 4, obs_start: "2025-11-20", obs_end: "2025-12-03", settle_date: "2025-12-04", trading_days: 9 },
    { period_id: 5, obs_start: "2025-12-04", obs_end: "2025-12-17", settle_date: "2025-12-18", trading_days: 10 },
    { period_id: 6, obs_start: "2025-12-18", obs_end: "2025-12-31", settle_date: "2026-01-02", trading_days: 9 },
    { period_id: 7, obs_start: "2026-01-02", obs_end: "2026-01-14", settle_date: "2026-01-15", trading_days: 9 },
    { period_id: 8, obs_start: "2026-01-15", obs_end: "2026-01-28", settle_date: "2026-01-29", trading_days: 9 },
    { period_id: 9, obs_start: "2026-01-29", obs_end: "2026-02-11", settle_date: "2026-02-12", trading_days: 10 },
    { period_id: 10, obs_start: "2026-02-12", obs_end: "2026-02-25", settle_date: "2026-02-26", trading_days: 9 },
    { period_id: 11, obs_start: "2026-02-26", obs_end: "2026-03-11", settle_date: "2026-03-12", trading_days: 10 },
    { period_id: 12, obs_start: "2026-03-12", obs_end: "2026-03-25", settle_date: "2026-03-26", trading_days: 10 },
    { period_id: 13, obs_start: "2026-03-26", obs_end: "2026-04-08", settle_date: "2026-04-09", trading_days: 9 },
];

const DEFAULTS = {
    ticker: "AMD", stockName: "AMD", spotPrice: 212.92, broker: "EFGL", account: "EFG", executor: "Team",
    currency: "USD", tradeDate: "2025-10-08", dailyShares: -6.0, maxGlobalShares: -1488.0, guaranteedDays: 0,
    strikePct: 128.35, koPct: 93, leverage: 2.0, simCount: 5000, randomSeed: 42, riskFree: 4.5, fxRate: 7.8
};

interface TransactionRecord {
    id: string; tradeId?: string; date: string; account: string; market: string; executor: string; type: string; direction: string;
    stockCode: string; stockName: string; quantity: number; priceNoFee: number; fee: number; amountNoFee: number; hkdAmount: number;
}

// --- 精準過期時間推算 (HKT UTC+8) ---
const getExpirationTimeMs = (expDateStr: string, currency: string): number => {
    if (!expDateStr) return Infinity;
    try {
        if (currency === 'USD') {
            const [y, m, d] = expDateStr.split('-').map(Number);
            const nextDay = new Date(y, m - 1, d + 1);
            const nextY = nextDay.getFullYear();
            const nextM = String(nextDay.getMonth() + 1).padStart(2, '0');
            const nextD = String(nextDay.getDate()).padStart(2, '0');
            return new Date(`${nextY}-${nextM}-${nextD}T04:00:00+08:00`).getTime();
        } else if (currency === 'JPY') {
            return new Date(`${expDateStr}T14:00:00+08:00`).getTime();
        } else if (currency === 'CNY') {
            return new Date(`${expDateStr}T15:00:00+08:00`).getTime();
        } else {
            return new Date(`${expDateStr}T16:00:00+08:00`).getTime();
        }
    } catch (e) {
        console.error("日期解析錯誤", e);
        const todayStr = new Date().toISOString().split('T')[0];
        return todayStr >= expDateStr ? 0 : Infinity;
    }
};

// 辅助函数：替换 undefined 为 null 以保证 JSON 安全存入 Firebase
const replaceUndefinedWithNull = (obj: any): any => {
    if (obj === undefined) return null;
    if (obj === null || typeof obj !== 'object') return obj;
    // 【核心修復】：嚴格放行原生 Date 物件與 Firestore Timestamp
    if (obj instanceof Date) return obj; 
    if (obj.toDate && typeof obj.toDate === 'function') return obj; 
    if (obj._methodName) return obj; 

    if (Array.isArray(obj)) return obj.map(replaceUndefinedWithNull);
    const newObj: any = {};
    for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
            newObj[key] = replaceUndefinedWithNull(obj[key]);
        }
    }
    return newObj;
};

// ==========================================
// 模拟图表元件 (复用自 Panel)
// ==========================================
const SimulationChart = ({ data }: { data: PlotData }) => {
    const { history_prices, future_paths, spot_price, barrier_strike, barrier_ko, total_days } = data;
    const fullHistory = [spot_price, ...history_prices];
    const historyLen = fullHistory.length;
    let allPrices = [...fullHistory, barrier_strike, barrier_ko];
    future_paths.forEach(path => allPrices.push(...path));
    const minP = Math.min(...allPrices) * 0.95;
    const maxP = Math.max(...allPrices) * 1.05;
    const rangeP = maxP - minP;

    const width = 500; const height = 250; const padding = 30;
    const plotW = width - padding * 2; const plotH = height - padding * 2;
    const getX = (dayIndex: number) => padding + (dayIndex / total_days) * plotW;
    const getY = (price: number) => padding + plotH - ((price - minP) / rangeP) * plotH;

    const makePath = (prices: number[], startDayIdx: number) => prices.map((p, i) => `${i === 0 ? 'M' : 'L'} ${getX(startDayIdx + i)} ${getY(p)}`).join(' ');
    const historyPathStr = makePath(fullHistory, 0);
    const getPathColor = (index: number) => `hsl(${(index * 137.508) % 360}, ${65 + (index % 3) * 10}%, ${50 + (index % 2) * 10}%)`;

    return (
        <div className="bg-white p-4 rounded border border-gray-200 shadow-sm mt-6 w-full flex flex-col items-center">
            <h4 className="font-bold text-gray-700 text-sm mb-4 self-start">模拟路径预览 (Monte Carlo Paths)</h4>
            <svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} className="overflow-visible max-w-lg">
                <rect x={padding} y={padding} width={plotW} height={plotH} fill="#fafafa" stroke="#eee" />
                <line x1={padding} y1={getY(barrier_strike)} x2={width - padding} y2={getY(barrier_strike)} stroke="#ef4444" strokeWidth="1.5" strokeDasharray="4 4" />
                <text x={width - padding + 5} y={getY(barrier_strike) + 3} fontSize="10" fill="#ef4444">Strike</text>
                <line x1={padding} y1={getY(barrier_ko)} x2={width - padding} y2={getY(barrier_ko)} stroke="#10b981" strokeWidth="1.5" strokeDasharray="4 4" />
                <text x={width - padding + 5} y={getY(barrier_ko) + 3} fontSize="10" fill="#10b981">KO</text>
                <line x1={padding} y1={getY(spot_price)} x2={width - padding} y2={getY(spot_price)} stroke="#ddd" strokeWidth="1" />
                {future_paths.map((path, idx) => (
                    <path key={`sim-${idx}`} d={`M ${getX(historyLen - 1)} ${getY(fullHistory[fullHistory.length - 1])} ` + makePath(path, historyLen).substring(1)} fill="none" stroke={getPathColor(idx)} strokeWidth="0.8" opacity="0.5" />
                ))}
                <path d={historyPathStr} fill="none" stroke="#1f2937" strokeWidth="2.5" />
                <circle cx={getX(historyLen - 1)} cy={getY(fullHistory[fullHistory.length - 1])} r="3" fill="#1f2937" />
                <text x={padding} y={height - 10} fontSize="10" fill="#888">T=0</text>
                <text x={width - padding} y={height - 10} fontSize="10" fill="#888" textAnchor="end">End</text>
            </svg>
            <div className="flex justify-center gap-4 mt-4 text-[10px] text-gray-500">
                <div className="flex items-center"><span className="w-3 h-0.5 bg-gray-800 mr-1"></span>历史</div>
                <div className="flex items-center"><span className="w-3 h-0.5 bg-gradient-to-r from-red-400 to-blue-400 mr-1"></span>模拟</div>
                <div className="flex items-center"><span className="w-3 h-0.5 border-t border-dashed border-red-500 mr-1"></span>Strike</div>
                <div className="flex items-center"><span className="w-3 h-0.5 border-t border-dashed border-green-500 mr-1"></span>KO</div>
            </div>
        </div>
    );
};


// ==========================================
// 页面主程序
// ==========================================
export default function DQAQTradePage() {
    const [user, setUser] = useState<any>(null);

    // --- State: 1. Inputs ---
    const [ticker, setTicker] = useState(""); const [stockName, setStockName] = useState("");
    const [spotPrice, setSpotPrice] = useState<string>(""); const [currentMktPrice, setCurrentMktPrice] = useState<string>("");
    const [contractType, setContractType] = useState<'DQ' | 'AQ'>('DQ');
    const [broker, setBroker] = useState(""); const [account, setAccount] = useState("");
    const [executor, setExecutor] = useState(""); const [currency, setCurrency] = useState("USD");
    const [tradeDate, setTradeDate] = useState(""); const [dailyShares, setDailyShares] = useState<string>("");
    const [maxGlobalShares, setMaxGlobalShares] = useState<string>(""); const [guaranteedDays, setGuaranteedDays] = useState<string>(""); 
    const [strikePct, setStrikePct] = useState<string>(""); const [koPct, setKoPct] = useState<string>("");
    const [leverage, setLeverage] = useState<string>("");
    const [simCount, setSimCount] = useState<string>(""); const [randomSeed, setRandomSeed] = useState<string>("");
    const [riskFreeInput, setRiskFreeInput] = useState<string>(""); const [fxRateInput, setFxRateInput] = useState<string>("");
    const [historyStartInput, setHistoryStartInput] = useState<string>("");
    const [periods, setPeriods] = useState<Period[]>([]);

    // --- State: 2. UI & Valuation ---
    const [loading, setLoading] = useState(false);
    const [fetchStatus, setFetchStatus] = useState("");
    const [errors, setErrors] = useState<Record<string, string>>({});
    
    // 弹窗与结果状态
    const [showResultModal, setShowResultModal] = useState(false);
    const [currentResult, setCurrentResult] = useState<ValuationResult | null>(null);
    const [currentCalcParams, setCurrentCalcParams] = useState<any>(null);
    const [currentTradeId, setCurrentTradeId] = useState<string>("");
    const [isHKDView, setIsHKDView] = useState(false);

    // --- State: 3.交易展示模块 ---
    const [txRecords, setTxRecords] = useState<TransactionRecord[]>([]);
    const [editingTxId, setEditingTxId] = useState<string | null>(null);

    // --- State: 4. 后台管理模块 ---
    const [activeDbTab, setActiveDbTab] = useState('sip_trade_dqaq_input_living');
    const [dbRecords, setDbRecords] = useState<any[]>([]);
    const [loadingDb, setLoadingDb] = useState(false);
    const [editRecordModal, setEditRecordModal] = useState<{show: boolean, record: any, rawJson: string} | null>(null);

    // ==========================================
    // Auth & DB Fetching
    // ==========================================
    useEffect(() => {
        const initAuth = async () => {
            if (!auth.currentUser) {
                // @ts-ignore
                if (typeof window !== 'undefined' && window.__initial_auth_token) await signInWithCustomToken(auth, window.__initial_auth_token);
                else await signInAnonymously(auth);
            }
            onAuthStateChanged(auth, setUser);
        };
        initAuth();
    }, []);

    const fetchDbRecords = async (collectionName: string) => {
        if (!user) return;
        setLoadingDb(true);
        try {
            const querySnapshot = await getDocs(collection(db, 'artifacts', APP_ID, 'public', 'data', collectionName));
            let records: any[] = [];
            querySnapshot.forEach((docSnap) => records.push({ id: docSnap.id, ...docSnap.data() }));
            records.sort((a, b) => {
                const timeA = getTime(a.updatedAt) || getTime(a.createdAt);
                const timeB = getTime(b.updatedAt) || getTime(b.createdAt);
                return timeB - timeA;
            });
            setDbRecords(records);
        } catch(e) { console.error(e); } 
        finally { setLoadingDb(false); }
    };

    useEffect(() => { if (user) fetchDbRecords(activeDbTab); }, [activeDbTab, user]);

    // ==========================================
    // Input Handlers
    // ==========================================
    const addPeriod = () => {
        const last = periods[periods.length - 1];
        const newId = last ? last.period_id + 1 : 1;
        let nextStart = "";
        if (last && last.obs_end) {
            const d = new Date(last.obs_end); d.setDate(d.getDate() + 1);
            nextStart = d.toISOString().split('T')[0];
        }
        setPeriods([...periods, { period_id: newId, obs_start: nextStart, obs_end: "", settle_date: "", trading_days: 10 }]);
    };
    const removePeriod = (idx: number) => {
        const p = [...periods]; p.splice(idx, 1);
        setPeriods(p.map((item, i) => ({ ...item, period_id: i + 1 })));
    };
    const updatePeriod = (idx: number, field: keyof Period, val: any) => {
        const p = [...periods]; p[idx] = { ...p[idx], [field]: val };
        setPeriods(p);
    };

    const fetchQuotePrice = async (symbol: string): Promise<number | null> => {
        try {
            const response = await fetch(`/api/quote?symbol=${symbol}`);
            if (!response.ok) return null;
            const data = await response.json();
            const price = data.regularMarketPrice || data.price || data.close;
            return typeof price === 'number' ? price : null;
        } catch { return null; }
    };

    const fetchHistoricalPrices = async (symbol: string, startDate: string, endDate?: string): Promise<{ date: string, close: number }[]> => {
        try {
            const apiUrl = `/api/history?symbol=${symbol}&start=${startDate}${endDate ? `&end=${endDate}` : ''}`;
            const res = await fetch(apiUrl);
            if (!res.ok) return [];
            const data = await res.json();
            let list = Array.isArray(data) ? data : (data.historical || data.data || []);
            return list.map((item: any) => {
                const rawDate = item.date || item.timestamp;
                const d = new Date(rawDate);
                return {
                    date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
                    close: Number(item.close || item.adjClose || item.price)
                };
            }).filter((item: any) => !isNaN(item.close));
        } catch { return []; }
    };

    // ==========================================
    // 核心计算引擎触发
    // ==========================================
    const handleRunAndRecord = async () => {
        // Validation
        const newErrors: Record<string, string> = {};
        if (!ticker) newErrors["ticker"] = "！必填"; if (!spotPrice) newErrors["spotPrice"] = "！必填";
        if (!tradeDate) newErrors["tradeDate"] = "！必填"; if (!dailyShares) newErrors["dailyShares"] = "！必填";
        if (!maxGlobalShares) newErrors["maxGlobalShares"] = "！必填"; if (!strikePct) newErrors["strikePct"] = "！必填";
        if (!koPct) newErrors["koPct"] = "！必填"; if (!leverage) newErrors["leverage"] = "！必填";
        if (!simCount) newErrors["simCount"] = "！必填"; if (!randomSeed) newErrors["randomSeed"] = "！必填";
        if (guaranteedDays === "") newErrors["guaranteedDays"] = "！必填"; if (riskFreeInput === "") newErrors["riskFree"] = "！必填";
        if (periods.length === 0) newErrors["periods"] = "！至少添加一个观察期";
        if (Object.keys(newErrors).length > 0) { setErrors(newErrors); return; }
        
        setErrors({}); setLoading(true); setFetchStatus("参数准备中...");
        
        try {
            // 生成全局 TradeId
            const newTradeId = crypto.randomUUID();
            setCurrentTradeId(newTradeId);

            let r = parseFloat(riskFreeInput) / 100;
            if (isNaN(r)) throw new Error("无风险利率无效");

            let fx = 1.0;
            if (currency === 'HKD') { fx = 1.0; if (fxRateInput === "") setFxRateInput("1.0"); } 
            else if (fxRateInput !== "") { fx = parseFloat(fxRateInput); } 
            else {
                setFetchStatus(`抓取 ${currency}/HKD 汇率...`);
                try {
                    const res = await fetch(`/api/quote?currency=${currency}`);
                    if (res.ok) { const data = await res.json(); fx = data?.rate || DEFAULTS.fxRate; }
                } catch { fx = DEFAULTS.fxRate; }
                setFxRateInput(fx.toFixed(4));
            }

            let hStart = historyStartInput;
            if (hStart === "") {
                const d = new Date(tradeDate); d.setDate(d.getDate() - 28);
                hStart = d.toISOString().split('T')[0];
                setHistoryStartInput(hStart);
            }

            // --- 精準過期時間判定與取價鐵血邏輯 ---
            const contract_end = periods[periods.length - 1].obs_end;
            const expireTimeMs = getExpirationTimeMs(contract_end, currency);
            const isExpired = Date.now() >= expireTimeMs;
            
            let finalMktPrice = Number(spotPrice);

            if (isExpired) {
                setFetchStatus(`獲取 ${contract_end} 歷史收盤價...`);
                const d = new Date(contract_end); d.setDate(d.getDate() - 7);
                const startStr = d.toISOString().split('T')[0];
                const histRes = await fetchHistoricalPrices(ticker, startStr, contract_end);
                const validPrices = histRes.filter((p:any) => p.date <= contract_end);
                
                if (validPrices.length > 0) {
                    validPrices.sort((a:any, b:any) => a.date.localeCompare(b.date));
                    finalMktPrice = validPrices[validPrices.length - 1].close;
                    setCurrentMktPrice(String(finalMktPrice)); // 強制回填歷史價
                } else {
                    throw new Error(`無法獲取 ${ticker} 於到期日 ${contract_end} 之前的有效歷史收盤價，拒絕結算！`);
                }
            } else {
                if (currentMktPrice !== "") {
                    finalMktPrice = parseFloat(currentMktPrice);
                } else {
                    setFetchStatus('抓取实时市价...');
                    const p = await fetchQuotePrice(ticker);
                    if (p !== null) { finalMktPrice = p; setCurrentMktPrice(p.toString()); }
                }
            }

            setFetchStatus('抓取歷史價格序列...');
            let historyPrices: number[] = []; let historyDates: string[] = [];
            try {
                // 如果是已過期，為了保持 DQ-AQ 引擎在內部判定的穩定，統一過濾掉未來的日期
                const cutoffDate = isExpired ? contract_end : new Date().toISOString().split('T')[0];
                const histRes = await fetchHistoricalPrices(ticker, hStart, cutoffDate);
                histRes.forEach((item: any) => {
                    const p = item.close;
                    if (typeof p === 'number' && !isNaN(p) && item.date) { historyPrices.push(p); historyDates.push(item.date); }
                });
            } catch (e) { console.warn(e); }

            // --- 偏移 valDtStr 以適配 DQ-AQ 引擎的週期判定 ---
            let valDtStr = new Date().toISOString().split('T')[0];
            if (isExpired && valDtStr < contract_end) {
                valDtStr = contract_end; 
            }
            if (!isExpired && valDtStr >= contract_end) {
                const d = new Date(contract_end); d.setDate(d.getDate() - 1);
                valDtStr = d.toISOString().split('T')[0];
            }

            for (const p of periods) {
                if (p.obs_end < valDtStr) {
                    const days_in_history = historyDates.filter(d => d >= p.obs_start && d <= p.obs_end).length;
                    if (days_in_history !== p.trading_days) throw new Error(`[日期错位拦截] 第 ${p.period_id} 期实际拉取到 ${days_in_history} 天价格，与您输入的 ${p.trading_days} 天不符。请检查节假日！`);
                }
            }

            const sigma = calculateVolatility(historyPrices);

            const basic: BasicInfo = {
                contract_type: contractType, broker, account, executor, currency, trade_date: tradeDate,
                daily_shares: Number(dailyShares), max_global_shares: Number(maxGlobalShares), guaranteed_days: Number(guaranteedDays),
                strike_pct: Number(strikePct) / 100, ko_barrier_pct: Number(koPct) / 100, leverage: Number(leverage)
            };
            const underlying: UnderlyingInfo = { ticker, stock_name: stockName, spot_price: Number(spotPrice) };
            const sim: SimulationParams = { sim_count: Number(simCount), random_seed: Number(randomSeed), risk_free_rate: r, sim_fx_rate: fx, history_start_date: hStart };

            setFetchStatus('执行定价引擎测算...');
            setTimeout(() => {
                try {
                    const valuator = new DQAQValuator(basic, underlying, sim, periods, sigma);
                    const res = valuator.generate_report(finalMktPrice, historyPrices, historyDates, valDtStr, fx);
                    
                    setCurrentResult(res);
                    setCurrentCalcParams({ basic, underlying, sim, periods, sigma }); // 供入库用
                    
                    // 覆写交易展示模块的数据 (清空并仅展示本次)
                    const newTxRecords: TransactionRecord[] = [];
                    if (res.history_records) {
                        res.history_records.forEach((rec: any, index: number) => {
                            if (rec.status === 'Settled' || rec.status === 'Knocked Out') {
                                const isBuy = contractType === 'AQ';
                                const direction = isBuy ? "Buy" : "Sell";
                                let qty = Math.abs(rec.shares);
                                if (direction === 'Sell') qty = -Math.abs(qty);
                                const sPrice = Number(spotPrice) * (Number(strikePct) / 100);
                                const amtNoFee = qty * sPrice;
                                let marketCode = currency === 'USD' ? 'US' : currency === 'JPY' ? 'JP' : currency === 'CNY' ? 'CH' : 'HK';
                                
                                if (Math.abs(qty) > 0.0001) {
                                    newTxRecords.push({
                                        id: `tx-${index}-${Date.now()}`,
                                        tradeId: newTradeId, // 绑定贸易标识
                                        date: rec.settle_date,
                                        account: account, market: marketCode, executor: executor, type: contractType,
                                        direction, stockCode: ticker, stockName: stockName || ticker,
                                        quantity: Number(qty.toFixed(2)), priceNoFee: Number(sPrice.toFixed(4)),
                                        fee: 0, amountNoFee: Number(amtNoFee.toFixed(2)), hkdAmount: Number((amtNoFee * fx).toFixed(2))
                                    });
                                }
                            }
                        });
                    }
                    setTxRecords(newTxRecords);
                    setShowResultModal(true);
                } catch (e: any) { alert("计算错误: " + e.message); } 
                finally { setLoading(false); setFetchStatus(""); }
            }, 50);

        } catch (e: any) { alert("准备错误: " + e.message); setLoading(false); setFetchStatus(""); }
    };

    // ==========================================
    // Modal & 入库流转逻辑
    // ==========================================
    const handleSaveParamsToDB = async () => {
        if (!user || !currentResult || !currentCalcParams) return;
        
        const msg = currentResult.status_msg;
        if (msg.includes('尚未订约')) { alert("错误：合約尚未開始 (Trade Date 在估值日之後)，不允许入库。请检查日期！"); return; }
        
        const isLiving = msg.includes('订约但未开始') || msg.includes('存续中');
        const lifeCycle = isLiving ? 'living' : 'died';

        try {
            setLoading(true); setFetchStatus('入库中...');
            const exactNow = new Date(); // 使用精確絕對時間
            
            // 剥离交易记录和图表数据，避免结果文档过于臃肿及触发 Firestore 嵌套数组报错
            const { history_records, plot_data, ...cleanResultBody } = currentResult;
            
            const safeCalc = replaceUndefinedWithNull({ 
                ...currentCalcParams, 
                tradeId: currentTradeId,
                createdAt: exactNow,
                updatedAt: exactNow
            });
            const safeRes = replaceUndefinedWithNull({ 
                ...cleanResultBody, 
                tradeId: currentTradeId,
                createdAt: exactNow,
                updatedAt: exactNow 
            });

            await addDoc(collection(db, 'artifacts', APP_ID, 'public', 'data', `sip_trade_dqaq_input_${lifeCycle}`), safeCalc);
            await addDoc(collection(db, 'artifacts', APP_ID, 'public', 'data', `sip_holding_dqaq_output_${lifeCycle}`), safeRes);

            alert(`参数与结果已成功保存至 [${lifeCycle}] 库！(TradeID: ${currentTradeId.substring(0,8)})`);
            setShowResultModal(false);
            fetchDbRecords(`sip_trade_dqaq_input_${lifeCycle}`);
        } catch(e:any) { alert("保存失败: " + e.message); } 
        finally { setLoading(false); setFetchStatus(""); }
    };

    // ==========================================
    // 后台记录管理逻辑
    // ==========================================
    const handleDeleteRecord = async (id: string) => {
        if (!confirm("确定要永久删除这条记录吗？不可恢复。")) return;
        try {
            await deleteDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', activeDbTab, id));
            setDbRecords(dbRecords.filter(r => r.id !== id));
        } catch(e: any) {
            alert("删除失败: " + e.message);
        }
    };

    // ==========================================
    // 交易记录处理 (Upsert Logic)
    // ==========================================
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
            } else if (field === 'amountNoFee') {
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

    const handleSaveDeliveriesToDB = async () => {
        if (!user || txRecords.length === 0 || !currentTradeId) return;
        if (!confirm(`确认将这 ${txRecords.length} 笔交易记录录入后台库吗？\n(这将会自动覆盖相同 TradeID 的旧记录)`)) return;

        try {
            setLoading(true); setFetchStatus('执行精准覆写中...');
            const getStockRef = collection(db, 'artifacts', APP_ID, 'public', 'data', 'sip_holding_dqaq_output_get-stock');
            
            // 1. 根据 tradeId 查找并删除旧记录 (保证幂等性)
            const q = query(getStockRef, where('tradeId', '==', currentTradeId));
            const snap = await getDocs(q);
            for(const d of snap.docs) {
                await deleteDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'sip_holding_dqaq_output_get-stock', d.id));
            }

            // 2. 插入当前屏幕的最新记录
            for (const record of txRecords) {
                const cleanRecord = replaceUndefinedWithNull(record);
                delete cleanRecord.id; // 清除前端自用临时id
                await addDoc(getStockRef, { ...cleanRecord, createdAt: new Date() });
            }
            
            alert("交易数据已成功精准覆写至 get-stock 库！");
            
            // 清空接货展示模块与绑定的 ID
            setTxRecords([]);
            setCurrentTradeId("");

            if (activeDbTab === 'sip_holding_dqaq_output_get-stock') fetchDbRecords(activeDbTab);
        } catch(e:any) { alert("录入交易库失败: " + e.message); } 
        finally { setLoading(false); setFetchStatus(""); }
    };

    // --- 动态展示记录摘要 Helper ---
    const getRecordSummary = (r: any, tab: string) => {
        try {
            if (tab.includes('input')) {
                const b = r.basic || r.basic_info;
                const u = r.underlying || r.underlying_info;
                if (!b || !u) return 'DQ-AQ Input 参数';
                return `[${b.contract_type}] ${b.broker || '未知'} | ${b.trade_date || ''} | ${u.stock_name || u.ticker || ''}`;
            }
            if (tab.includes('output_living') || tab.includes('output_died')) {
                if (r.status_msg) return `DQ-AQ 结果 | ${r.status_msg} | 期望总股数: ${r.expected_shares?.toFixed(2) || 0}`;
                return 'DQ-AQ 测算结果';
            }
            if (tab.includes('get-stock') || tab.includes('pending_delivery')) {
                return `【交收】${r.account || ''} | ${r.direction || ''} ${r.quantity || 0}股 ${r.stockName || r.stockCode || ''}`;
            }
            if (tab.includes('sum')) {
                return `全局大盘统计快照 (更新于: ${formatTime(r.updatedAt) || formatTime(r.createdAt) || 'N/A'})`;
            }
            return JSON.stringify(r).substring(0, 100) + '...';
        } catch (e) {
            return '解析失败...';
        }
    };

    // ==========================================
    // Utils & Formatters
    // ==========================================
    const fmtMoney = (val: number, c: string = "") => new Intl.NumberFormat('en-US', { style: 'currency', currency: c || 'USD' }).format(val);
    const getDisplayCurrency = () => isHKDView ? 'HKD' : (currency || 'USD');
    const getDisplayValue = (val: number) => { const rate = currentResult?.final_fx_rate || 1.0; return isHKDView ? val * rate : val; };
    const uiSpot = spotPrice ? Number(spotPrice) : 0;
    
    // UI Helpers
    const getInputClass = (err?: string) => `w-full border-gray-300 rounded border p-1.5 outline-none focus:ring-1 focus:ring-blue-500 ${err ? 'border-red-500 ring-1 ring-red-500' : ''}`;

    return (
        <div className="space-y-8 pb-10">
            {/* Header (Aligned with FCN) */}
            <div className="border-b border-gray-200 pb-4">
                <h1 className="text-2xl font-bold text-gray-900">DQ-AQ Trade (发行录入)</h1>
                <p className="mt-1 text-sm text-gray-500">参数配置、估值测算引擎与底层资料库全周期分发入口。</p>
            </div>

            {/* === 模块 1：参数输入模块 === */}
            <div className="bg-white shadow rounded-lg p-6 border border-gray-200">
                <h2 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
                    <Database size={20} className="text-blue-600"/>
                    【参数输入模块】
                </h2>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* 左半：基础信息 */}
                    <div className="space-y-4">
                        <h3 className="text-sm font-bold text-gray-800 border-l-4 border-blue-500 pl-2">1. 基础信息</h3>
                        <div className="grid grid-cols-2 gap-3 text-xs">
                            <div>
                                <label className="block text-gray-600 mb-1">券商 (Broker)</label>
                                <input className={getInputClass()} value={broker} placeholder={DEFAULTS.broker} onChange={e => setBroker(e.target.value)} />
                            </div>
                            <div>
                                <label className="block text-gray-600 mb-1">账户 (Account)</label>
                                <input className={getInputClass()} value={account} placeholder={DEFAULTS.account} onChange={e => setAccount(e.target.value)} />
                            </div>
                            <div>
                                <label className="block text-gray-600 mb-1">执行人 (Executor)</label>
                                <input className={getInputClass()} value={executor} placeholder={DEFAULTS.executor} onChange={e => setExecutor(e.target.value)} />
                            </div>
                            <div>
                                <label className="block text-gray-600 mb-1">计价货币</label>
                                <select className={getInputClass()} value={currency} onChange={(e:any) => setCurrency(e.target.value)}>
                                    <option value="HKD">HKD</option><option value="USD">USD</option>
                                    <option value="CNY">CNY</option><option value="JPY">JPY</option>
                                </select>
                            </div>
                            <div className="col-span-2">
                                <label className="block text-gray-600 mb-1">交易日期 (Trade Date) <span className="text-red-500">*</span></label>
                                <input type="date" className={getInputClass(errors.tradeDate)} value={tradeDate} onChange={e => setTradeDate(e.target.value)} />
                            </div>
                            <div>
                                <label className="block text-gray-600 mb-1">合约类型 (Type)</label>
                                <select className={getInputClass()} value={contractType} onChange={(e:any) => setContractType(e.target.value)}>
                                    <option value="DQ">DQ (减持)</option>
                                    <option value="AQ">AQ (累积)</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-gray-600 mb-1">杠杆 (Leverage) <span className="text-red-500">*</span></label>
                                <input type="number" className={getInputClass(errors.leverage)} value={leverage} placeholder={String(DEFAULTS.leverage)} onChange={e => setLeverage(e.target.value)} />
                            </div>
                            <div>
                                <label className="block text-gray-600 mb-1">每日股数 (Daily) <span className="text-red-500">*</span></label>
                                <input type="number" className={getInputClass(errors.dailyShares)} value={dailyShares} placeholder={String(DEFAULTS.dailyShares)} onChange={e => setDailyShares(e.target.value)} />
                                <span className="text-[9px] font-bold text-red-500 block mt-0.5">DQ必负，AQ必正</span>
                            </div>
                            <div>
                                <label className="block text-gray-600 mb-1">最大股数 (Max) <span className="text-red-500">*</span></label>
                                <input type="number" className={getInputClass(errors.maxGlobalShares)} value={maxGlobalShares} placeholder={String(DEFAULTS.maxGlobalShares)} onChange={e => setMaxGlobalShares(e.target.value)} />
                                <span className="text-[9px] font-bold text-red-500 block mt-0.5">DQ必负，AQ必正</span>
                            </div>
                            <div>
                                <label className="block font-bold text-indigo-600 mb-1">保证天数 <span className="text-red-500">*</span></label>
                                <input type="number" min="0" className={getInputClass(errors.guaranteedDays) + " bg-indigo-50"} value={guaranteedDays} placeholder={String(DEFAULTS.guaranteedDays)} onChange={e => setGuaranteedDays(e.target.value)} />
                            </div>
                            <div>
                                {/* Placeholder */}
                            </div>
                            <div>
                                <label className="block text-gray-600 mb-1">行权% (Strike) <span className="text-red-500">*</span></label>
                                <div className="relative">
                                    <input type="number" step="0.01" className={getInputClass(errors.strikePct) + " pr-5"} value={strikePct} placeholder={String(DEFAULTS.strikePct)} onChange={e => setStrikePct(e.target.value)} />
                                    <span className="absolute right-2 top-1.5 text-gray-400 pointer-events-none">%</span>
                                </div>
                                <span className="text-[9px] text-gray-400 block mt-0.5">价格: {(uiSpot * (Number(strikePct)||0) / 100).toFixed(2)}</span>
                            </div>
                            <div>
                                <label className="block text-gray-600 mb-1">敲出界限% (KO) <span className="text-red-500">*</span></label>
                                <div className="relative">
                                    <input type="number" step="0.01" className={getInputClass(errors.koPct) + " pr-5"} value={koPct} placeholder={String(DEFAULTS.koPct)} onChange={e => setKoPct(e.target.value)} />
                                    <span className="absolute right-2 top-1.5 text-gray-400 pointer-events-none">%</span>
                                </div>
                                <span className="text-[9px] text-gray-400 block mt-0.5">价格: {(uiSpot * (Number(koPct)||0) / 100).toFixed(2)}</span>
                            </div>
                        </div>
                    </div>

                    {/* 右半：标的、日期与模拟 */}
                    <div className="space-y-6">
                        <div>
                            <h3 className="text-sm font-bold text-gray-800 border-l-4 border-blue-500 pl-2 mb-3">2. 标的信息</h3>
                            <div className="bg-gray-50 p-3 rounded border border-gray-200 text-xs">
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="col-span-2">
                                        <label className="block text-gray-600 mb-1">标的代码 (Ticker) <span className="text-red-500">*</span></label>
                                        <input className={getInputClass(errors.ticker)} value={ticker} placeholder={DEFAULTS.ticker} onChange={e => setTicker(e.target.value)} />
                                    </div>
                                    <div>
                                        <label className="block text-gray-600 mb-1">标的名称</label>
                                        <input className={getInputClass()} value={stockName} placeholder={DEFAULTS.stockName} onChange={e => setStockName(e.target.value)} />
                                    </div>
                                    <div>
                                        <label className="block text-gray-600 mb-1">初始价格 (S0) <span className="text-red-500">*</span></label>
                                        <input type="number" className={getInputClass(errors.spotPrice)} value={spotPrice} placeholder={String(DEFAULTS.spotPrice)} onChange={e => setSpotPrice(e.target.value)} />
                                    </div>
                                    <div className="col-span-2">
                                        <label className="block text-gray-600 mb-1">当前市价 (MTM Price)</label>
                                        <input type="number" placeholder="过期无视手填" className={getInputClass() + " bg-blue-50"} value={currentMktPrice} onChange={e => setCurrentMktPrice(e.target.value)} />
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div>
                            <div className="flex justify-between items-center mb-2">
                                <h3 className="text-sm font-bold text-gray-800 border-l-4 border-blue-500 pl-2">3. 日期信息</h3>
                                <button onClick={addPeriod} className="text-xs text-blue-600 hover:text-blue-800 font-medium">+ 添加期数</button>
                            </div>
                            <div className="space-y-1 max-h-48 overflow-y-auto pr-1 border border-gray-200 rounded">
                                <table className="min-w-full text-xs text-center divide-y divide-gray-200">
                                    <thead className="bg-gray-50 sticky top-0">
                                        <tr>
                                            <th className="p-1 font-medium text-gray-500">ID</th>
                                            <th className="p-1 font-medium text-gray-500">Start</th>
                                            <th className="p-1 font-medium text-gray-500">End</th>
                                            <th className="p-1 font-medium text-gray-500">Settle</th>
                                            <th className="p-1 font-medium text-gray-500">Days</th>
                                            <th className="p-1"></th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100 bg-white">
                                        {periods.map((p, idx) => (
                                            <tr key={idx} className="hover:bg-blue-50">
                                                <td className="p-1">{p.period_id}</td>
                                                <td className="p-0"><input type="date" className="w-full p-1 text-center bg-transparent outline-none" value={p.obs_start} onChange={e => updatePeriod(idx, 'obs_start', e.target.value)} /></td>
                                                <td className="p-0"><input type="date" className="w-full p-1 text-center bg-transparent outline-none" value={p.obs_end} onChange={e => updatePeriod(idx, 'obs_end', e.target.value)} /></td>
                                                <td className="p-0"><input type="date" className="w-full p-1 text-center bg-transparent outline-none text-blue-700" value={p.settle_date} onChange={e => updatePeriod(idx, 'settle_date', e.target.value)} /></td>
                                                <td className="p-0"><input type="number" className="w-full p-1 text-center bg-transparent outline-none font-mono" value={p.trading_days} onChange={e => updatePeriod(idx, 'trading_days', Number(e.target.value))} /></td>
                                                <td className="p-1"><button onClick={() => removePeriod(idx)} className="text-red-500 hover:text-red-700 text-center">删</button></td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                {periods.length === 0 && <div className="text-center py-4 text-gray-400 text-xs">请点击添加期数或使用示例</div>}
                            </div>
                        </div>

                        <div>
                            <h3 className="text-sm font-bold text-gray-800 border-l-4 border-blue-500 pl-2 mb-2">4. 模拟信息</h3>
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs">
                                <div>
                                    <label className="block text-gray-600 mb-1">模拟汇率 (To HKD)</label>
                                    <input className={getInputClass()} placeholder={`留白获取 ${currency !== 'HKD' ? currency : 'USD'}/HKD`} value={fxRateInput} onChange={e => setFxRateInput(e.target.value)} />
                                </div>
                                <div>
                                    <label className="block text-gray-600 mb-1">历史起点 (留白T-28)</label>
                                    <input type="date" className={getInputClass()} value={historyStartInput} onChange={e => setHistoryStartInput(e.target.value)} />
                                </div>
                                <div>
                                    <label className="block text-gray-600 mb-1">模拟次数 <span className="text-red-500">*</span></label>
                                    <input type="number" className={getInputClass(errors.simCount)} value={simCount} placeholder={String(DEFAULTS.simCount)} onChange={e => setSimCount(e.target.value)} />
                                </div>
                                <div>
                                    <label className="block text-gray-600 mb-1">无风险利率 (r) <span className="text-red-500">*</span></label>
                                    <div className="relative">
                                        <input type="number" step="0.01" className={getInputClass(errors.riskFree) + " pr-5"} placeholder={String(DEFAULTS.riskFree)} value={riskFreeInput} onChange={e => setRiskFreeInput(e.target.value)} />
                                        <span className="absolute right-2 top-1.5 text-gray-400 pointer-events-none">%</span>
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-gray-600 mb-1">随机种子 (Seed) <span className="text-red-500">*</span></label>
                                    <input type="number" className={getInputClass(errors.randomSeed)} value={randomSeed} placeholder={String(DEFAULTS.randomSeed)} onChange={e => setRandomSeed(e.target.value)} />
                                </div>
                                <div>
                                    <label className="block text-gray-600 mb-1">&nbsp;</label>
                                    <button onClick={() => {
                                        setTicker(DEFAULTS.ticker); setSpotPrice(String(DEFAULTS.spotPrice)); setDailyShares(String(DEFAULTS.dailyShares));
                                        setMaxGlobalShares(String(DEFAULTS.maxGlobalShares)); setGuaranteedDays(String(DEFAULTS.guaranteedDays));
                                        setStrikePct(String(DEFAULTS.strikePct)); setKoPct(String(DEFAULTS.koPct)); setLeverage(String(DEFAULTS.leverage));
                                        setSimCount(String(DEFAULTS.simCount)); setRandomSeed(String(DEFAULTS.randomSeed)); setRiskFreeInput(String(DEFAULTS.riskFree));
                                        setTradeDate(DEFAULTS.tradeDate); setPeriods(DEFAULT_PERIODS); setErrors({});
                                    }} className="w-full bg-gray-100 text-gray-600 p-1.5 rounded hover:bg-gray-200 border text-center font-medium">载入测试数据</button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* 录入运行按钮 */}
                <div className="mt-6 border-t pt-4">
                    <button
                        onClick={handleRunAndRecord}
                        disabled={loading}
                        className={`w-full py-3 px-4 rounded-md text-white font-bold transition-all shadow-md flex justify-center items-center gap-2 ${loading ? 'bg-indigo-400 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700'}`}
                    >
                        {loading ? <Loader2 className="animate-spin" size={20} /> : <Play size={20} />}
                        {loading ? (fetchStatus || '测算中...') : '录入运行 (Run & Record)'}
                    </button>
                </div>
            </div>

            {/* === 子操作框 Modal === */}
            {showResultModal && currentResult && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 animate-in fade-in p-4">
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl h-[90vh] flex flex-col relative overflow-hidden">
                        <div className="px-6 py-4 border-b flex justify-between items-center bg-gray-50 flex-shrink-0">
                            <div>
                                <h3 className="text-xl font-bold text-gray-900 flex items-center gap-2"><CheckCircle className="text-green-500" size={24} /> 计算完成 - 估值报告</h3>
                                <p className="text-sm text-gray-500 mt-1">全局 TradeID: <span className="font-mono bg-gray-200 px-1 rounded">{currentTradeId}</span></p>
                            </div>
                            <button onClick={() => setShowResultModal(false)} className="text-gray-400 hover:text-gray-600 bg-white p-1 rounded-full shadow-sm border"><X size={24}/></button>
                        </div>

                        <div className="p-6 overflow-y-auto flex-1 bg-white space-y-6">
                            <div className="border-b border-gray-200 pb-4">
                                <div className="flex justify-between items-start">
                                    <div>
                                        <h2 className="text-lg font-bold text-gray-900">DQ-AQ 状态研判</h2>
                                    </div>
                                    <button onClick={() => setIsHKDView(!isHKDView)} className={`px-3 py-1.5 text-xs font-medium rounded border transition-colors ${isHKDView ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-300'}`}>
                                        {isHKDView ? '已转为 HKD' : '转换为 HKD'}
                                    </button>
                                </div>
                                <div className="mt-2 flex items-center space-x-2">
                                    <span className={`px-2 py-1 rounded text-xs font-semibold ${currentResult.status_msg.includes('提前敲出') || currentResult.status_msg.includes('Expired') ? 'bg-red-100 text-red-700' : currentResult.status_msg.includes('尚未订约') ? 'bg-orange-100 text-orange-800' : 'bg-green-100 text-green-700'}`}>
                                        {currentResult.status_msg}
                                    </span>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="bg-gray-50 p-4 rounded-lg">
                                    <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-3">资产与完成率</h3>
                                    <div className="space-y-2 text-sm text-gray-700">
                                        <div className="flex justify-between"><span>期望总股数</span><span className="font-bold text-gray-900">{currentResult.expected_shares.toFixed(2)}</span></div>
                                        <div className="flex justify-between"><span>预期完成率</span><span className="font-bold text-blue-600">{Number(maxGlobalShares) !== 0 ? ((currentResult.expected_shares * Number(leverage) / Number(maxGlobalShares)) * 100).toFixed(2) : "0.00"}%</span></div>
                                    </div>
                                </div>

                                <div className="bg-gray-50 p-4 rounded-lg">
                                    <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-3">估值测算 ({getDisplayCurrency()})</h3>
                                    <div className="space-y-2 text-sm text-gray-700">
                                        <div className="flex justify-between"><span>全价 (Full Price, 含已结算)</span><span className="font-bold text-gray-900">{fmtMoney(getDisplayValue(currentResult.val_full_usd), getDisplayCurrency())}</span></div>
                                        <div className="flex justify-between"><span>净价 (Net Price, 转手公允)</span><span className="font-bold text-green-600">{fmtMoney(getDisplayValue(currentResult.val_net_usd), getDisplayCurrency())}</span></div>
                                    </div>
                                </div>
                            </div>

                            <div>
                                <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-3">交收状态分布</h3>
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                                    <div className="p-3 border rounded-md">
                                        <div className="text-xs text-gray-500">已结算</div>
                                        <div className="text-lg font-bold text-gray-800">{currentResult.shares_settled_paid.toFixed(2)}</div>
                                    </div>
                                    <div className="p-3 border rounded-md">
                                        <div className="text-xs text-gray-500">已锁定未付</div>
                                        <div className="text-lg font-bold text-gray-800">{currentResult.shares_locked_unpaid.toFixed(2)}</div>
                                    </div>
                                    <div className="p-3 border rounded-md">
                                        <div className="text-xs text-gray-500">未来期望</div>
                                        <div className="text-lg font-bold text-gray-800">{currentResult.shares_future.toFixed(2)}</div>
                                    </div>
                                    <div className="p-3 border rounded-md">
                                        <div className="text-xs text-gray-500">提前敲出概率</div>
                                        <div className="text-lg font-bold text-red-600">{(currentResult.ko_probability * 100).toFixed(2)}%</div>
                                    </div>
                                </div>
                            </div>

                            {currentResult.plot_data && <SimulationChart data={currentResult.plot_data} />}
                        </div>

                        <div className="px-6 py-4 border-t bg-gray-50 flex justify-between items-center flex-shrink-0">
                            <div className="text-sm">
                                <span className="text-gray-600 mr-2">入库判定路线: </span>
                                {currentResult.status_msg.includes('尚未订约') ? (
                                    <span className="font-bold text-red-600">⚠ 拦截入库 (请检查日期)</span>
                                ) : currentResult.status_msg.includes('已到期') || currentResult.status_msg.includes('提前敲出') ? (
                                    <span className="font-bold text-orange-600">→ Died (已结束库)</span>
                                ) : (
                                    <span className="font-bold text-green-600">→ Living (存续库)</span>
                                )}
                            </div>
                            
                            <div className="flex gap-3 w-[40%]">
                                {currentResult.status_msg.includes('尚未订约') ? (
                                    <button disabled className="flex-1 bg-red-200 text-red-600 font-bold py-3 rounded-md cursor-not-allowed">禁止保存</button>
                                ) : currentResult.status_msg.includes('已到期') || currentResult.status_msg.includes('提前敲出') ? (
                                    <button onClick={handleSaveParamsToDB} disabled={loading} className="flex-1 bg-orange-600 hover:bg-orange-700 text-white font-bold py-3 rounded-md flex items-center justify-center gap-2 shadow-md transition-colors">
                                        {loading ? <Loader2 className="animate-spin" size={18}/> : <Save size={18}/>}
                                        保存结果入库 (Died)
                                    </button>
                                ) : (
                                    <button onClick={handleSaveParamsToDB} disabled={loading} className="flex-1 bg-green-600 hover:bg-green-700 text-white font-bold py-3 rounded-md flex items-center justify-center gap-2 shadow-md transition-colors">
                                        {loading ? <Loader2 className="animate-spin" size={18}/> : <Save size={18}/>}
                                        保存结果入库 (Living)
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* === 模块 2：接货展示模块 === */}
            <div className="bg-white shadow rounded-lg p-6 border border-gray-200">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                        <Database size={20} className="text-orange-600"/>
                        【接货展示模块】
                    </h2>
                    <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded">当前绑定 TradeID: <span className="font-mono font-bold text-gray-700">{currentTradeId || '暂无'}</span></span>
                </div>

                {txRecords.length === 0 ? (
                    <div className="py-12 text-center text-gray-400 bg-gray-50 rounded-lg border border-dashed border-gray-200">
                        <AlertCircle size={32} className="mx-auto mb-2 opacity-50" />
                        <p>暂无交易/接货记录产生</p>
                        <p className="text-xs mt-1">当上方测算包含已结算或KO触发时，会在此覆写展示</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto border border-gray-200 rounded-lg mb-6 shadow-sm">
                        <table className="min-w-full divide-y divide-gray-200 text-sm text-left whitespace-nowrap">
                            <thead className="bg-gray-100 text-gray-600 font-medium">
                                <tr>
                                    <th className="px-3 py-3">日期</th>
                                    <th className="px-3 py-3">账户</th>
                                    <th className="px-3 py-3">方向</th>
                                    <th className="px-3 py-3">标的代码</th>
                                    <th className="px-3 py-3 text-right">数量</th>
                                    <th className="px-3 py-3 text-right">均价</th>
                                    <th className="px-3 py-3 text-right">手续费</th>
                                    <th className="px-3 py-3 text-right">总额(含费)</th>
                                    <th className="px-3 py-3 text-center">操作</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 bg-white">
                                {txRecords.map(rec => (
                                    <tr key={rec.id} className="hover:bg-blue-50 transition-colors">
                                        <td className="px-3 py-2 text-gray-800">{editingTxId === rec.id ? <input type="date" value={rec.date} onChange={(e) => handleTxChange(rec.id, 'date', e.target.value)} className="border p-1 w-full text-xs rounded" /> : rec.date}</td>
                                        <td className="px-3 py-2 text-gray-800">{editingTxId === rec.id ? <input type="text" value={rec.account} onChange={(e) => handleTxChange(rec.id, 'account', e.target.value)} className="border p-1 w-full text-xs rounded" /> : rec.account}</td>
                                        <td className="px-3 py-2 text-green-600 font-bold">{editingTxId === rec.id ? <select value={rec.direction} onChange={(e) => handleTxChange(rec.id, 'direction', e.target.value)} className="border p-1 w-full text-xs rounded"><option value="Buy">Buy</option><option value="Sell">Sell</option></select> : rec.direction}</td>
                                        <td className="px-3 py-2 font-mono font-medium">{editingTxId === rec.id ? <input value={rec.stockCode} onChange={(e) => handleTxChange(rec.id, 'stockCode', e.target.value)} className="border p-1 w-full text-xs rounded" /> : rec.stockCode}</td>
                                        <td className={`px-3 py-2 text-right font-mono ${rec.quantity < 0 ? 'text-red-600' : ''}`}>{editingTxId === rec.id ? <input type="number" value={rec.quantity} onChange={(e) => handleTxChange(rec.id, 'quantity', e.target.value)} className="border p-1 w-20 text-xs rounded text-right" /> : rec.quantity}</td>
                                        <td className="px-3 py-2 text-right font-mono text-gray-600">{editingTxId === rec.id ? <input type="number" value={rec.priceNoFee} onChange={(e) => handleTxChange(rec.id, 'priceNoFee', e.target.value)} className="border p-1 w-20 text-xs rounded text-right" /> : Number(rec.priceNoFee).toFixed(4)}</td>
                                        <td className="px-3 py-2 text-right font-mono text-gray-500">{editingTxId === rec.id ? <input type="number" value={rec.fee} onChange={(e) => handleTxChange(rec.id, 'fee', e.target.value)} className="border p-1 w-16 text-xs rounded text-right" /> : rec.fee}</td>
                                        <td className={`px-3 py-2 text-right font-mono font-bold ${(rec.amountNoFee + rec.fee) < 0 ? 'text-red-600' : 'text-gray-900'}`}>{fmtMoney(rec.amountNoFee + rec.fee, currency)}</td>
                                        <td className="px-3 py-2 text-center">
                                            {editingTxId === rec.id ? 
                                                <button onClick={() => setEditingTxId(null)} className="text-white bg-blue-600 hover:bg-blue-700 px-3 py-1 rounded text-xs font-bold transition-colors">完成</button> : 
                                                <button onClick={() => setEditingTxId(rec.id)} className="text-blue-500 hover:text-blue-700 p-1 bg-blue-50 rounded hover:bg-blue-100 transition-colors" title="修改"><Edit2 size={14}/></button>
                                            }
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
                <div className="flex justify-end pt-4 border-t border-gray-100">
                    <button
                        onClick={handleSaveDeliveriesToDB}
                        disabled={loading || txRecords.length === 0 || !currentTradeId}
                        className={`px-8 py-3 rounded-lg font-bold text-white transition-all shadow-md flex items-center gap-2 ${loading || txRecords.length === 0 ? 'bg-gray-300 cursor-not-allowed' : 'bg-orange-600 hover:bg-orange-700 shadow-orange-200'}`}
                    >
                        {loading ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
                        【录入库】覆盖至 Get-Stock
                    </button>
                </div>
            </div>

            {/* === 模块 3：后台库管理模块 === */}
            <div className="bg-white shadow rounded-lg p-6 border border-gray-200 mt-8">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                        <Database size={20} className="text-purple-600"/>
                        【后台库管理模块】
                    </h2>
                    <button onClick={() => fetchDbRecords(activeDbTab)} className="text-sm text-purple-600 hover:text-purple-800 flex items-center gap-1">
                        <RefreshCw size={14}/> 刷新数据
                    </button>
                </div>

                {/* 资料库 Tab 切换 */}
                <div className="flex gap-2 mb-4 border-b pb-2 overflow-x-auto">
                    {['sip_trade_dqaq_input_living', 'sip_trade_dqaq_input_died', 'sip_holding_dqaq_output_living', 'sip_holding_dqaq_output_died', 'sip_holding_dqaq_output_get-stock'].map(tab => (
                        <button 
                            key={tab} onClick={() => setActiveDbTab(tab)} 
                            className={`px-3 py-1.5 text-xs font-bold rounded whitespace-nowrap transition-colors ${activeDbTab === tab ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                        >
                            {tab.replace('sip_', '').replace(/_/g, '/')}
                        </button>
                    ))}
                </div>

                {/* 资料库表格 */}
                {loadingDb ? (
                    <div className="py-10 text-center"><Loader2 className="animate-spin mx-auto text-purple-600 mb-2" size={30}/><p className="text-gray-400 text-sm">拉取中...</p></div>
                ) : dbRecords.length === 0 ? (
                    <div className="py-10 text-center text-gray-400 bg-gray-50 rounded border border-dashed">该合集中暂无数据</div>
                ) : (
                    <div className="overflow-x-auto border rounded">
                        <table className="min-w-full text-sm text-left divide-y divide-gray-200">
                            <thead className="bg-gray-50 text-gray-500">
                                <tr>
                                    <th className="px-3 py-2 whitespace-nowrap">ID / 確切修改時間</th>
                                    <th className="px-3 py-2">綁定 TradeID</th>
                                    <th className="px-3 py-2">內容摘要 / 產品名稱</th>
                                    <th className="px-3 py-2 text-center whitespace-nowrap">操作</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {dbRecords.map(r => (
                                    <tr key={r.id} className="hover:bg-gray-50 transition-colors">
                                        <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap font-mono">
                                            <div className="font-bold text-gray-700">{r.id.substring(0,8)}...</div>
                                            <div className="text-blue-600">
                                                {formatTime(r.updatedAt) || formatTime(r.createdAt) || 'N/A'}
                                            </div>
                                        </td>
                                        <td className="px-3 py-2 text-xs font-mono text-blue-600">{r.tradeId || 'None'}</td>
                                        <td className="px-3 py-2 text-xs">
                                            <div className="max-w-xs xl:max-w-2xl truncate text-gray-700 bg-blue-50/50 px-2 py-1.5 rounded border border-blue-100 font-medium">
                                                {getRecordSummary(r, activeDbTab)}
                                            </div>
                                        </td>
                                        <td className="px-3 py-2 text-center whitespace-nowrap">
                                            <button onClick={() => setEditRecordModal({show: true, record: r, rawJson: JSON.stringify(r, null, 4)})} className="text-blue-600 hover:text-blue-800 mx-1 p-1 hover:bg-blue-50 rounded transition-colors" title="修改 JSON"><FileJson size={16}/></button>
                                            <button onClick={() => handleDeleteRecord(r.id)} className="text-red-500 hover:text-red-700 mx-1 p-1 hover:bg-red-50 rounded transition-colors" title="永久删除"><Trash2 size={16}/></button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* 修改 Raw JSON 弹窗 */}
            {editRecordModal && (
                <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
                    <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-5xl flex flex-col h-[85vh] max-h-[90vh]">
                        <div className="flex justify-between items-center mb-4 border-b pb-4">
                            <h3 className="font-bold text-lg flex items-center gap-2 text-purple-700"><FileJson size={20}/> 进阶修改记录 - {editRecordModal.record.id}</h3>
                            <button onClick={() => setEditRecordModal(null)} className="text-gray-400 hover:text-gray-600"><X size={20}/></button>
                        </div>
                        <p className="text-xs text-gray-500 mb-2 border-l-2 border-orange-400 pl-2">
                            警告：直接修改 Raw JSON 属于高阶操作，请确保 JSON 格式合法且结构正确。
                        </p>
                        <textarea className="flex-1 w-full border border-gray-300 rounded-md p-3 text-xs font-mono mb-4 focus:ring-2 focus:ring-purple-500 outline-none resize-none" value={editRecordModal.rawJson} onChange={(e) => setEditRecordModal({...editRecordModal, rawJson: e.target.value})} />
                        <div className="flex justify-end gap-3 pt-2 border-t">
                            <button onClick={() => setEditRecordModal(null)} className="px-5 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-md text-sm font-medium transition-colors">取消</button>
                            <button onClick={async () => {
                                try {
                                    const parsedData = JSON.parse(editRecordModal.rawJson);
                                    const docId = parsedData.id || editRecordModal.record.id; delete parsedData.id; 
                                    parsedData.updatedAt = new Date();
                                    await updateDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', activeDbTab, docId), parsedData);
                                    alert("数据修改成功！"); setEditRecordModal(null); fetchDbRecords(activeDbTab); 
                                } catch(e:any) { alert("修改失败: \n" + e.message); }
                            }} className="px-5 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-md text-sm font-bold flex items-center gap-2 transition-colors"><Save size={16}/> 保存强制覆盖</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}