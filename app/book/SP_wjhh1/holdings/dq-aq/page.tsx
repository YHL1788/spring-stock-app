'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  RefreshCw, Database, FileJson, Trash2, X, Save, Loader2, AlertCircle, TrendingUp, LineChart, PieChart, Clock, BarChart
} from 'lucide-react';
import { collection, getDocs, doc, updateDoc, addDoc, deleteDoc, setDoc, query, where, onSnapshot } from 'firebase/firestore';
import { onAuthStateChanged, signInAnonymously, signInWithCustomToken } from 'firebase/auth';

import { db, auth, APP_ID } from '@/app/lib/stockService';
import { DQAQValuator, Period, BasicInfo, UnderlyingInfo, SimulationParams, ValuationResult, calculateVolatility, PlotData } from '@/app/lib/DQ-AQPricer';

// --- 时间解析辅助函数 ---
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

// ==========================================
// 终极修复：纯净版数值与颜色格式化工具
// 彻底解决 JSX 模板字符串中因包含 < 或 > 符号导致的编译器解析 Bug
// ==========================================
const formatSum = (val: number) => {
    return `${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const formatSumWithSign = (val: number) => {
    const sign = val > 0 ? '+' : '';
    return `${sign}${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const formatMoney = (val: number) => {
    return val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const fmtSign = (val: number) => {
    if (val === 0 || Math.abs(val) < 0.00001) return '-';
    return `${val > 0 ? '+' : ''}${formatMoney(val)}`;
};
const cColor = (val: number, posClass: string, negClass: string, zeroClass: string) => {
    if (val > 0.00001) return posClass;
    if (val < -0.00001) return negClass;
    return zeroClass;
};

// --- 类型定义 ---
interface MergedRecord {
    tradeId: string;
    inputId: string;
    outputId: string;
    inputData: any;
    outputData: any;
    createdAt: any;
    updatedAt: any;
}

// --- 精准过期时间推算 (HKT UTC+8) ---
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
        console.error("日期解析错误", e);
        const todayStr = new Date().toISOString().split('T')[0];
        return todayStr >= expDateStr ? 0 : Infinity; 
    }
};

// --- 辅助函数：序列化处理 ---
const replaceUndefinedWithNull = (obj: any): any => {
    if (obj === undefined) return null;
    if (obj === null || typeof obj !== 'object') return obj;
    // 【核心修复】：严格放行原生 Date 对象与 Firestore Timestamp
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

const replaceNullWithUndefined = (obj: any): any => {
    if (obj === null) return undefined;
    if (typeof obj !== 'object') return obj;
    if (obj instanceof Date) return obj; 
    if (obj.toDate && typeof obj.toDate === 'function') return obj; 
    if (obj._methodName) return obj; 

    if (Array.isArray(obj)) return obj.map(replaceNullWithUndefined);
    const newObj: any = {};
    for (const key in obj) {
        newObj[key] = replaceNullWithUndefined(obj[key]);
    }
    return newObj;
};

// --- 可排序筛选表头组件 ---
const Th = ({ label, sortKey, filterKey, currentSort, onSort, currentFilter, onFilter, align='left' }: any) => {
    const justifyClass = align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : 'justify-start';
    const textClass = align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left';
    return (
        <th className={`px-3 py-2 whitespace-nowrap align-top group ${textClass}`}>
            <div className={`flex items-center ${justifyClass} gap-1 select-none ${sortKey && onSort ? 'cursor-pointer hover:text-gray-800' : ''}`} onClick={() => sortKey && onSort && onSort(sortKey)}>
                {label}
                {sortKey && currentSort?.key === sortKey && <span className="text-blue-500 text-[10px] ml-1">{currentSort.dir === 'asc' ? '▲' : '▼'}</span>}
                {sortKey && currentSort?.key !== sortKey && onSort && <span className="text-gray-300 text-[10px] opacity-0 group-hover:opacity-100 transition-opacity ml-1">▲</span>}
            </div>
            {filterKey && onFilter && (
                <div className="mt-1">
                    <input 
                        type="text" placeholder="筛选..." value={currentFilter?.[filterKey] || ''}
                        onChange={(e) => onFilter(filterKey, e.target.value)} onClick={(e) => e.stopPropagation()}
                        className="w-full min-w-[60px] border border-gray-300 rounded px-1 py-0.5 text-[10px] font-normal focus:outline-none focus:border-blue-500 text-gray-700"
                    />
                </div>
            )}
        </th>
    );
};

// --- 点位图组件 ---
const SimulationChart = ({ data }: { data: PlotData }) => {
    const { history_prices, future_paths, spot_price, barrier_strike, barrier_ko, total_days } = data;
    const fullHistory = [spot_price, ...history_prices];
    const historyLen = fullHistory.length;
    let allPrices = [...fullHistory, barrier_strike, barrier_ko];
    if (future_paths) future_paths.forEach(path => allPrices.push(...path));
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
        <div className="bg-white p-4 rounded border border-gray-200 shadow-sm w-full flex flex-col items-center">
            <svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} className="overflow-visible max-w-lg">
                <rect x={padding} y={padding} width={plotW} height={plotH} fill="#fafafa" stroke="#eee" />
                <line x1={padding} y1={getY(barrier_strike)} x2={width - padding} y2={getY(barrier_strike)} stroke="#ef4444" strokeWidth="1.5" strokeDasharray="4 4" />
                <text x={width - padding + 5} y={getY(barrier_strike) + 3} fontSize="10" fill="#ef4444">Strike</text>
                <line x1={padding} y1={getY(barrier_ko)} x2={width - padding} y2={getY(barrier_ko)} stroke="#10b981" strokeWidth="1.5" strokeDasharray="4 4" />
                <text x={width - padding + 5} y={getY(barrier_ko) + 3} fontSize="10" fill="#10b981">KO</text>
                <line x1={padding} y1={getY(spot_price)} x2={width - padding} y2={getY(spot_price)} stroke="#ddd" strokeWidth="1" />
                {future_paths && future_paths.map((path, idx) => (
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
// 主页面组件
// ==========================================
export default function DQAQHoldingPage() {
    const [user, setUser] = useState<any>(null);
    
    const [livingRecords, setLivingRecords] = useState<MergedRecord[]>([]);
    const [diedRecords, setDiedRecords] = useState<MergedRecord[]>([]);
    const [loadingLiving, setLoadingLiving] = useState(false);
    const [loadingDied, setLoadingDied] = useState(false);

    // --- 统计模块状态 ---
    const [statsTab, setStatsTab] = useState<'GLOBAL' | 'MKT_VAL' | 'PL'>('GLOBAL');
    
    const [isSavingMktVal, setIsSavingMktVal] = useState(false);
    const [lastMktValSavedTime, setLastMktValSavedTime] = useState<string>('未获取');
    
    const [isSavingPl, setIsSavingPl] = useState(false);
    const [lastPlSavedTime, setLastPlSavedTime] = useState<string>('未获取');

    const [isHKDView, setIsHKDView] = useState(false);
    const [globalFxRates, setGlobalFxRates] = useState<Record<string, number>>({});
    const [isFetchingFx, setIsFetchingFx] = useState(false);

    // 覆盖确认 Modal 相关
    const [showDeliveryModal, setShowDeliveryModal] = useState(false);
    const [pendingDeliveries, setPendingDeliveries] = useState<any[]>([]);
    const [syncingDeliveries, setSyncingDeliveries] = useState(false);

    // 点位图 Modal
    const [chartData, setChartData] = useState<{name: string, ticker: string, current: number, strike: number, ko: number} | null>(null);

    // 后台库
    const [activeDbTab, setActiveDbTab] = useState('sip_holding_dqaq_output_living');
    const [dbRecords, setDbRecords] = useState<any[]>([]);
    const [loadingDb, setLoadingDb] = useState(false);
    const [editRecordModal, setEditRecordModal] = useState<{show: boolean, record: any, rawJson: string} | null>(null);

    // 排序和筛选
    const [livingSort, setLivingSort] = useState<any>({key: '', dir: null});
    const [livingFilters, setLivingFilters] = useState<Record<string, string>>({});
    const [riskSort, setRiskSort] = useState<any>({key: '', dir: null});
    const [riskFilters, setRiskFilters] = useState<Record<string, string>>({});
    const [diedSort, setDiedSort] = useState<any>({key: '', dir: null});
    const [diedFilters, setDiedFilters] = useState<Record<string, string>>({});

    const toggleSort = (setSort: any) => (key: string) => {
        setSort((prev: any) => {
            if (prev.key === key) {
                if (prev.dir === 'asc') return { key, dir: 'desc' };
                if (prev.dir === 'desc') return { key: '', dir: null };
            }
            return { key, dir: 'asc' };
        });
    };
    const handleFilter = (setFilter: any) => (key: string, val: string) => setFilter((prev: any) => ({ ...prev, [key]: val }));

    // 实例化排序与筛选函数
    const toggleLivingSort = toggleSort(setLivingSort);
    const updateLivingFilter = handleFilter(setLivingFilters);
    const toggleRiskSort = toggleSort(setRiskSort);
    const updateRiskFilter = handleFilter(setRiskFilters);
    const toggleDiedSort = toggleSort(setDiedSort);
    const updateDiedFilter = handleFilter(setDiedFilters);

    useEffect(() => {
        let unsubMktValTime: (() => void) | undefined;
        let unsubPlTime: (() => void) | undefined;
        
        const initAuth = async () => {
            if (!auth.currentUser) {
                // @ts-ignore
                if (typeof window !== 'undefined' && window.__initial_auth_token) await signInWithCustomToken(auth, window.__initial_auth_token);
                else await signInAnonymously(auth);
            }
            onAuthStateChanged(auth, (currentUser) => {
                setUser(currentUser);
                if (currentUser) {
                    unsubMktValTime = onSnapshot(doc(db, 'artifacts', APP_ID, 'public', 'data', 'sip_holding_dqaq_mktvalue', 'latest_summary'), (docSnap) => {
                        if (docSnap.exists()) {
                            const data = docSnap.data();
                            if (data.updatedAt) setLastMktValSavedTime(new Date(data.updatedAt).toLocaleString('zh-CN', { hour12: false }));
                        }
                    });

                    unsubPlTime = onSnapshot(doc(db, 'artifacts', APP_ID, 'public', 'data', 'sip_holding_dqaq_pl', 'latest_summary'), (docSnap) => {
                        if (docSnap.exists()) {
                            const data = docSnap.data();
                            if (data.updatedAt) setLastPlSavedTime(new Date(data.updatedAt).toLocaleString('zh-CN', { hour12: false }));
                        }
                    });
                }
            });
        };
        initAuth();
        return () => {
            if (unsubMktValTime) unsubMktValTime();
            if (unsubPlTime) unsubPlTime();
        }
    }, []);

    const fetchMergedRecords = async (lifeCycle: 'living' | 'died'): Promise<MergedRecord[]> => {
        try {
            const inputSnap = await getDocs(collection(db, 'artifacts', APP_ID, 'public', 'data', `sip_trade_dqaq_input_${lifeCycle}`));
            const outputSnap = await getDocs(collection(db, 'artifacts', APP_ID, 'public', 'data', `sip_holding_dqaq_output_${lifeCycle}`));
            if (inputSnap.empty) return [];
            const inputs = inputSnap.docs.map(d => ({ id: d.id, ...d.data() })) as any[];
            const outputs = outputSnap.docs.map(d => ({ id: d.id, ...d.data() })) as any[];
            
            const merged = inputs.map(inp => {
                const out = outputs.find(o => o.tradeId && o.tradeId === inp.tradeId);
                if (!out) return null; 
                return { 
                    tradeId: inp.tradeId, 
                    inputId: inp.id, 
                    outputId: out.id, 
                    inputData: inp, 
                    outputData: out, 
                    createdAt: inp.createdAt,
                    updatedAt: inp.updatedAt || out.updatedAt 
                };
            }).filter((item): item is MergedRecord => item !== null); 
            
            merged.sort((a, b) => {
                const timeA = getTime(a.updatedAt) || getTime(a.createdAt);
                const timeB = getTime(b.updatedAt) || getTime(b.createdAt);
                return timeB - timeA;
            });
            return merged;
        } catch (e) { console.warn("Fetch Error:", e); return []; }
    };

    const loadRecords = async () => {
        if (!user) return;
        const [living, died] = await Promise.all([fetchMergedRecords('living'), fetchMergedRecords('died')]);
        setLivingRecords(living); 
        setDiedRecords(died);
    };

    const fetchDbRecords = async (colName: string) => {
        if (!user) return;
        setLoadingDb(true);
        try {
            const snap = await getDocs(collection(db, 'artifacts', APP_ID, 'public', 'data', colName));
            let recs: any[] = [];
            snap.forEach(d => recs.push({ id: d.id, ...d.data() }));
            
            recs.sort((a,b) => {
                const timeA = getTime(a.updatedAt) || getTime(a.createdAt);
                const timeB = getTime(b.updatedAt) || getTime(b.createdAt);
                return timeB - timeA;
            });
            setDbRecords(recs);
        } catch(e) { console.error(e); } finally { setLoadingDb(false); }
    };

    useEffect(() => { if (user) { loadRecords(); fetchDbRecords(activeDbTab); } }, [user, activeDbTab]);

    // --- APIs ---
    const fetchQuotePrice = async (symbol: string) => {
        try {
            const res = await fetch(`/api/quote?symbol=${symbol}`);
            const data = res.ok ? await res.json() : {};
            return data.regularMarketPrice || data.price || data.close || null;
        } catch { return null; }
    };
    const fetchHistoricalPrices = async (symbol: string, start: string, end?: string) => {
        try {
            const apiUrl = `/api/history?symbol=${symbol}&start=${start}${end ? `&end=${end}` : ''}`;
            const res = await fetch(apiUrl);
            const data = res.ok ? await res.json() : [];
            let list = Array.isArray(data) ? data : (data.historical || data.data || []);
            return list.map((item: any) => ({
                date: new Date(item.date || item.timestamp).toISOString().split('T')[0],
                close: Number(item.close || item.adjClose || item.price)
            })).filter((item: any) => !isNaN(item.close));
        } catch { return []; }
    };
    const fetchRealTimeFxRate = async (currency: string) => {
        if (currency === 'HKD') return 1.0;
        try {
            const res = await fetch(`/api/quote?currency=${currency}`);
            const data = res.ok ? await res.json() : {};
            return data.rate || null;
        } catch { return null; }
    };

    const fetchLatestFxRates = async () => {
        const markets = new Set<string>();
        [...livingRecords, ...diedRecords].forEach(r => {
            const mkt = r.inputData?.basic?.currency;
            if (mkt && mkt !== 'HKD') markets.add(mkt);
        });
        if (markets.size === 0) return;
        setIsFetchingFx(true);
        const newRates: Record<string, number> = {};
        for(let mkt of Array.from(markets)) {
            const rate = await fetchRealTimeFxRate(mkt);
            if (rate) newRates[mkt] = rate;
        }
        setGlobalFxRates(prev => ({ ...prev, ...newRates }));
        setIsFetchingFx(false);
    };

    useEffect(() => {
        if (livingRecords.length || diedRecords.length) fetchLatestFxRates();
    }, [livingRecords.length, diedRecords.length]);

    // --- 核心评估逻辑 (封装复用) ---
    const evaluateDQAQ = async (mergedRecord: MergedRecord) => {
        const inputData = replaceNullWithUndefined(mergedRecord.inputData);
        const outputData = replaceNullWithUndefined(mergedRecord.outputData);
        const { basic, underlying, sim, periods, sigma } = inputData;
        
        // 【铁血逻辑】：使用精准到小时的市场过期时间判定
        const contract_end = periods[periods.length - 1].obs_end;
        const expireTimeMs = getExpirationTimeMs(contract_end, basic.currency);
        const isExpired = Date.now() >= expireTimeMs;

        let currentPrice = underlying.spot_price;
        
        // 过期强制抓取历史价，存续强制抓取现价
        if (isExpired) {
            const d = new Date(contract_end); d.setDate(d.getDate() - 7);
            const startStr = d.toISOString().split('T')[0];
            const histRes = await fetchHistoricalPrices(underlying.ticker, startStr, contract_end);
            const validPrices = histRes.filter((p:any) => p.date <= contract_end);
            if (validPrices.length > 0) {
                validPrices.sort((a:any, b:any) => a.date.localeCompare(b.date));
                currentPrice = validPrices[validPrices.length - 1].close;
            } else {
                throw new Error(`无法获取 ${underlying.ticker} 于到期日 ${contract_end} 之前的有效历史收盘价，拒绝结算！`);
            }
        } else {
            const p = await fetchQuotePrice(underlying.ticker);
            if (p !== null) currentPrice = p;
        }

        const cutoffDate = isExpired ? contract_end : new Date().toISOString().split('T')[0];
        const histResFull = await fetchHistoricalPrices(underlying.ticker, sim.history_start_date, cutoffDate);
        const historyPrices = histResFull.map((h:any) => h.close);
        const historyDates = histResFull.map((h:any) => h.date);

        let fx = sim.sim_fx_rate || 1.0;
        if (basic.currency !== 'HKD') fx = await fetchRealTimeFxRate(basic.currency) ?? fx;

        // 偏移 valDtStr 以适配 DQ-AQ 引擎的周期判定
        let valDtStr = new Date().toISOString().split('T')[0];
        if (isExpired && valDtStr < contract_end) valDtStr = contract_end; 
        if (!isExpired && valDtStr >= contract_end) {
            const d = new Date(contract_end); d.setDate(d.getDate() - 1);
            valDtStr = d.toISOString().split('T')[0];
        }

        const valuator = new DQAQValuator(basic, underlying, sim, periods, sigma);
        const res = valuator.generate_report(currentPrice, historyPrices, historyDates, valDtStr, fx);

        // 【时间戳铁血逻辑】：使用精确实时 Date 对象
        const exactNow = new Date();

        const cleanInput = replaceUndefinedWithNull({
            ...inputData, 
            underlying: { ...underlying, current_price: currentPrice }, 
            sim: { ...sim, sim_fx_rate: fx },
            updatedAt: exactNow
        });
        
        const cleanOutput = replaceUndefinedWithNull({
            tradeId: mergedRecord.tradeId, 
            ...res,
            updatedAt: exactNow
        });
        delete cleanOutput.history_records;
        delete cleanOutput.plot_data;

        let newDeliveries: any[] = [];
        if (res.history_records) {
            res.history_records.forEach((rec: any, idx: number) => {
                if (rec.status === 'Settled' || rec.status === 'Knocked Out') {
                    const direction = basic.contract_type === 'AQ' ? "Buy" : "Sell";
                    let qty = Math.abs(rec.shares);
                    if (direction.toUpperCase() === 'SELL') qty = -Math.abs(qty);
                    const sPrice = underlying.spot_price * basic.strike_pct;
                    const amtNoFee = qty * sPrice;
                    const marketCode = basic.currency === 'USD' ? 'US' : basic.currency === 'JPY' ? 'JP' : basic.currency === 'CNY' ? 'CH' : 'HK';

                    if (Math.abs(qty) > 0.0001) {
                        newDeliveries.push({
                            tradeId: mergedRecord.tradeId,
                            date: rec.settle_date,
                            account: basic.account,
                            market: marketCode,
                            executor: basic.executor,
                            type: basic.contract_type,
                            direction,
                            stockCode: underlying.ticker,
                            stockName: underlying.stock_name || underlying.ticker,
                            quantity: Number(qty.toFixed(2)),
                            priceNoFee: Number(sPrice.toFixed(4)),
                            fee: 0,
                            amountNoFee: Number(amtNoFee.toFixed(2)),
                            hkdAmount: Number((amtNoFee * fx).toFixed(2)),
                            createdAt: exactNow
                        });
                    }
                }
            });
        }

        return { res, cleanInput, cleanOutput, newDeliveries, exactNow };
    };

    // --- 刷新引擎核心逻辑 ---
    const handleRefreshLiving = async () => {
        setLoadingLiving(true);
        try {
            const currentLiving = await fetchMergedRecords('living');
            if (currentLiving.length === 0) {
                setLoadingLiving(false);
                return;
            }

            const allNewDeliveries: any[] = [];
            let movedToDiedCount = 0;

            for (const record of currentLiving) {
                const { res, cleanInput, cleanOutput, newDeliveries } = await evaluateDQAQ(record);

                if (res.status_msg.includes('存续中') || res.status_msg.includes('订约但未开始') || res.status_msg.includes('尚未订约')) {
                    await setDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'sip_trade_dqaq_input_living', record.inputId), cleanInput);
                    await setDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'sip_holding_dqaq_output_living', record.outputId), cleanOutput);
                } else {
                    await setDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'sip_trade_dqaq_input_died', record.inputId), cleanInput);
                    await setDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'sip_holding_dqaq_output_died', record.outputId), cleanOutput);
                    await deleteDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'sip_trade_dqaq_input_living', record.inputId));
                    await deleteDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'sip_holding_dqaq_output_living', record.outputId));
                    movedToDiedCount++;
                }

                if (newDeliveries.length > 0) {
                    allNewDeliveries.push(...newDeliveries);
                }
            }

            await loadRecords();
            if (activeDbTab.includes('living')) fetchDbRecords(activeDbTab);

            if (allNewDeliveries.length > 0) {
                setPendingDeliveries(allNewDeliveries);
                setShowDeliveryModal(true);
            } else {
                alert(`刷新完毕！有 ${movedToDiedCount} 笔已失效移入历史库。本次刷新未产生新的结算/接货记录。`);
            }
        } catch(e:any) { alert("刷新失败: " + e.message); } finally { setLoadingLiving(false); }
    };

    const handleConfirmDeliveries = async () => {
        setSyncingDeliveries(true);
        try {
            const getStockRef = collection(db, 'artifacts', APP_ID, 'public', 'data', 'sip_holding_dqaq_output_get-stock');
            const tradeIds = [...new Set(pendingDeliveries.map(d => d.tradeId))];
            
            for (const tid of tradeIds) {
                const q = query(getStockRef, where('tradeId', '==', tid));
                const snap = await getDocs(q);
                for(const d of snap.docs) await deleteDoc(d.ref);
            }
            for (const rec of pendingDeliveries) {
                const clean = replaceUndefinedWithNull(rec);
                await addDoc(getStockRef, {...clean, createdAt: new Date()});
            }
            alert("交收流水已成功精准覆盖至 get-stock 接货库！");
            setShowDeliveryModal(false);
            setPendingDeliveries([]);
            if(activeDbTab==='sip_holding_dqaq_output_get-stock') fetchDbRecords(activeDbTab);
        } catch(e:any) { alert("覆盖失败: " + e.message); } finally { setSyncingDeliveries(false); }
    };

    const handleRefreshDied = async () => {
        setLoadingDied(true);
        let errCount = 0;
        try {
            const currentDied = await fetchMergedRecords('died');
            if (currentDied.length === 0) { setLoadingDied(false); return; }

            for (const record of currentDied) {
                const { res, cleanInput, cleanOutput } = await evaluateDQAQ(record);

                if (res.status_msg.includes('存续中') || res.status_msg.includes('未开始') || res.status_msg.includes('尚未订约')) {
                    errCount++;
                    await setDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'sip_trade_dqaq_input_living', record.inputId), cleanInput);
                    await setDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'sip_holding_dqaq_output_living', record.outputId), cleanOutput);
                    await deleteDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'sip_trade_dqaq_input_died', record.inputId));
                    await deleteDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'sip_holding_dqaq_output_died', record.outputId));
                } else {
                    await setDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'sip_trade_dqaq_input_died', record.inputId), cleanInput);
                    await setDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'sip_holding_dqaq_output_died', record.outputId), cleanOutput);
                }
            }
            await loadRecords();
            if (activeDbTab.includes('died')) fetchDbRecords(activeDbTab);

            if (errCount > 0) alert(`出错！有 ${errCount} 笔数据重新计算后发现仍在存续！请重新检查 died 库内容！`);
            else alert('历史持仓刷新校验完毕！数据已基于历史收盘价精准覆盖。');
        } catch(e:any) { alert("刷新失败: " + e.message); } finally { setLoadingDied(false); }
    };

    // --- 后台库管理 Handler ---
    const handleSaveRecordEdit = async () => {
        if (!editRecordModal) return;
        try {
            const parsedData = JSON.parse(editRecordModal.rawJson);
            const docId = parsedData.id || editRecordModal.record.id;
            delete parsedData.id; 
            parsedData.updatedAt = new Date();
            await updateDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', activeDbTab, docId), parsedData);
            alert("数据修改成功！");
            setEditRecordModal(null);
            fetchDbRecords(activeDbTab); 
        } catch(e: any) {
            alert("修改失败 (请检查 JSON 格式是否正确): \n" + e.message);
        }
    };

    const handleDeleteRecord = async (id: string) => {
        if (!confirm("确定要永久删除这条记录吗？不可恢复。")) return;
        try {
            await deleteDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', activeDbTab, id));
            setDbRecords(dbRecords.filter(r => r.id !== id));
        } catch(e: any) {
            alert("删除失败: " + e.message);
        }
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
            if (tab.includes('mktvalue') || tab.includes('pl') || tab.includes('sum')) {
                const time = formatTime(r.updatedAt) || formatTime(r.createdAt) || 'N/A';
                return `全局大盘统计快照 (更新于: ${time})`;
            }
            return JSON.stringify(r).substring(0, 100) + '...';
        } catch (e) {
            return '解析失败...';
        }
    };

    // --- 数据展平与表头逻辑 ---
    const useTableData = (data: any[], sortConfig: any, filterConfig: any) => {
        return useMemo(() => {
            let result = [...data];
            Object.keys(filterConfig).forEach(key => {
                const filterVal = filterConfig[key]?.toLowerCase();
                if (filterVal) result = result.filter(item => String(item[key]??'').toLowerCase().includes(filterVal));
            });
            if (sortConfig.dir) {
                result.sort((a, b) => {
                    const aVal = a[sortConfig.key]; const bVal = b[sortConfig.key];
                    if (aVal == null && bVal == null) return 0;
                    if (aVal == null) return 1; if (bVal == null) return -1;
                    if (typeof aVal === 'string') return sortConfig.dir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
                    return sortConfig.dir === 'asc' ? aVal - bVal : bVal - aVal;
                });
            }
            return result;
        }, [data, sortConfig, filterConfig, isHKDView, globalFxRates]);
    };

    const fmtPct = (v: number) => (v * 100).toFixed(2) + '%';
    const fmtMoney = (v: number, c: string) => {
        const rate = isHKDView ? (globalFxRates[c] || 1) : 1;
        return (v * rate).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2});
    };

    const processLiving = useMemo(() => livingRecords.map((r: MergedRecord) => {
        const { basic, underlying, periods } = r.inputData;
        const res = r.outputData;
        const name = `${basic.broker} | ${basic.trade_date} | ${underlying.stock_name||underlying.ticker}`;
        const today = new Date().toISOString().split('T')[0];
        const nextObs = periods.map((p:any)=>p.obs_end).filter((d:string)=>d>=today).sort()[0] || '';
        
        const strikePrice = underlying.spot_price * basic.strike_pct;
        const koPrice = underlying.spot_price * basic.ko_barrier_pct;

        return {
            id: r.tradeId, pData: r.outputData,
            account: basic.account,
            name, status: res.status_msg, currency: basic.currency,
            dir: basic.contract_type, leverage: basic.leverage, daily: basic.daily_shares, max: basic.max_global_shares,
            koInPrice: strikePrice.toFixed(4), koOutPrice: koPrice.toFixed(4),
            koInPct: fmtPct(basic.strike_pct), koOutPct: fmtPct(basic.ko_barrier_pct),
            nextObs, maturity: periods[periods.length-1].settle_date,
            koProb: res.ko_probability, expRate: res.exp_completion_rate, mktVal: res.val_net_usd,
            fullPrice: res.val_full_usd || 0,
            settled: res.shares_settled_paid, locked: res.shares_locked_unpaid, future: res.shares_future, expTotal: res.expected_shares,
            ticker: underlying.ticker,
            S0: underlying.spot_price,
            currentPrice: underlying.current_price || underlying.spot_price, 
            strikeRaw: basic.strike_pct,
            koOutRaw: basic.ko_barrier_pct,
            fx_rate: basic.fx_rate || 1
        };
    }), [livingRecords, isHKDView, globalFxRates]);

    const processRisk = useMemo(() => livingRecords.map((r: MergedRecord) => {
        const { basic, underlying } = r.inputData;
        const res = r.outputData;
        const exposureShares = res.expected_shares - res.shares_settled_paid;
        const costPrice = underlying.spot_price * basic.strike_pct;
        const exposureCost = costPrice * exposureShares;
        
        const currentP = underlying.current_price || underlying.spot_price; 
        const exposureMktVal = currentP * exposureShares; 
        
        const pnl = exposureMktVal - exposureCost;
        const pnlRatio = exposureCost !== 0 ? pnl / Math.abs(exposureCost) : 0;
        
        return {
            id: r.tradeId, ticker: underlying.ticker, name: underlying.stock_name || underlying.ticker, currency: basic.currency,
            costPrice, exposureShares, exposureCost, exposureMktVal, pnlRatio
        };
    }), [livingRecords, isHKDView, globalFxRates]);

    const processDied = useMemo(() => diedRecords.map((r: MergedRecord) => {
        const { basic, underlying } = r.inputData;
        const res = r.outputData;
        
        const strikePrice = underlying.spot_price * basic.strike_pct;
        const koPrice = underlying.spot_price * basic.ko_barrier_pct;

        return {
            id: r.tradeId, name: `${basic.broker} | ${basic.trade_date} | ${underlying.stock_name||underlying.ticker}`,
            status: res.status_msg, currency: basic.currency, dir: basic.contract_type, leverage: basic.leverage,
            koInPrice: strikePrice.toFixed(4), koOutPrice: koPrice.toFixed(4),
            koInPct: fmtPct(basic.strike_pct), koOutPct: fmtPct(basic.ko_barrier_pct),
            settled: res.expected_shares || 0, 
            expRate: res.exp_completion_rate || 0,
            fullPrice: res.val_full_usd || 0,
            fx_rate: basic.fx_rate || 1
        };
    }), [diedRecords]);

    const finalLiving = useTableData(processLiving, livingSort, livingFilters);
    const finalRisk = useTableData(processRisk, riskSort, riskFilters);
    const finalDied = useTableData(processDied, diedSort, diedFilters);

    // --- 计算全局 SUM 与统计 ---
    const globalStats = useMemo(() => {
        const markets: Record<string, any> = {};

        const initMarket = (mkt: string) => {
            if (!markets[mkt]) {
                markets[mkt] = {
                    market: mkt,
                    netVal: 0,
                    fullVal: 0,
                    fxRate: 1
                };
            }
        };

        finalLiving.forEach(item => {
            const mkt = item.currency || 'HKD';
            initMarket(mkt);
            const rate = globalFxRates[mkt] || item.fx_rate || 1;
            markets[mkt].fxRate = rate;
            markets[mkt].netVal += (item.mktVal || 0) * rate;
            markets[mkt].fullVal += (item.fullPrice || 0) * rate;
        });

        finalDied.forEach(item => {
            const mkt = item.currency || 'HKD';
            initMarket(mkt);
            const rate = globalFxRates[mkt] || item.fx_rate || 1;
            markets[mkt].fxRate = rate;
            markets[mkt].fullVal += (item.fullPrice || 0) * rate;
        });

        const marketList = Object.values(markets);

        const hkdSum = marketList.reduce((acc, m) => {
            acc.netVal += m.netVal;
            acc.fullVal += m.fullVal;
            return acc;
        }, { netVal: 0, fullVal: 0 });

        return {
            marketList,
            hkdSum,
        };
    }, [finalLiving, finalDied, globalFxRates]);

    // --- 【新增】当前市值二维统计矩阵 ---
    const currentMktStats = useMemo(() => {
        const accountsSet = new Set<string>();
        const marketsSet = new Set<string>();

        processLiving.forEach(item => {
            if (item.account) accountsSet.add(item.account);
            if (item.currency) marketsSet.add(item.currency);
        });

        const accounts = Array.from(accountsSet).sort();
        const markets = Array.from(marketsSet).sort();

        const rawMatrix: Record<string, Record<string, number>> = {};
        markets.forEach(m => {
            rawMatrix[m] = {};
            accounts.forEach(a => rawMatrix[m][a] = 0);
        });

        processLiving.forEach(item => {
            if (item.currency && item.account) {
                rawMatrix[item.currency][item.account] += (item.mktVal || 0);
            }
        });

        return { accounts, markets, rawMatrix };
    }, [processLiving]);

    // --- 【新增】当前收益统计矩阵 ---
    const currentPlStats = useMemo(() => {
        const marketsSet = new Set<string>();
        processLiving.forEach(item => {
            if (item.currency) marketsSet.add(item.currency);
        });
        const markets = Array.from(marketsSet).sort();

        const rawMatrix: Record<string, { realized: number, unrealized: number, total: number }> = {};
        markets.forEach(m => {
            rawMatrix[m] = { realized: 0, unrealized: 0, total: 0 };
        });

        processLiving.forEach(item => {
            if (item.currency) {
                // DQ/AQ 的已实现损益永远为 0，所有净值均为未实现浮动损益
                rawMatrix[item.currency].unrealized += (item.mktVal || 0);
                rawMatrix[item.currency].total += (item.mktVal || 0);
            }
        });

        return { markets, rawMatrix };
    }, [processLiving]);

    // --- 市值与盈亏数据入库逻辑 ---
    const handleSaveMktValStats = async (isAuto = false) => {
        if (!user) return;
        if (!isAuto) setIsSavingMktVal(true);
        try {
            const payload = {
                accounts: currentMktStats.accounts,
                markets: currentMktStats.markets,
                rawMatrix: currentMktStats.rawMatrix,
                updatedAt: new Date().toISOString()
            };
            await setDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'sip_holding_dqaq_mktvalue', 'latest_summary'), payload);
            if (!isAuto) setLastMktValSavedTime(new Date().toLocaleString('zh-CN', { hour12: false }));
        } catch (e) {
            console.error("保存当前市值统计失败:", e);
        } finally {
            if (!isAuto) setIsSavingMktVal(false);
        }
    };

    const handleSavePlStats = async (isAuto = false) => {
        if (!user) return;
        if (!isAuto) setIsSavingPl(true);
        try {
            const payload = {
                markets: currentPlStats.markets,
                rawMatrix: currentPlStats.rawMatrix,
                updatedAt: new Date().toISOString()
            };
            await setDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'sip_holding_dqaq_pl', 'latest_summary'), payload);
            if (!isAuto) setLastPlSavedTime(new Date().toLocaleString('zh-CN', { hour12: false }));
        } catch (e) {
            console.error("保存当前收益统计失败:", e);
        } finally {
            if (!isAuto) setIsSavingPl(false);
        }
    };

    // 每分钟自动保存统计
    useEffect(() => {
        if (!user) return;
        const intervalId = setInterval(() => {
            handleSaveMktValStats(true);
            handleSavePlStats(true);
        }, 60000); 
        return () => clearInterval(intervalId);
    }, [user, currentMktStats, currentPlStats]); 

    return (
        <div className="space-y-8 pb-10">
            {/* === 全局 Header === */}
            <div className="border-b border-gray-200 pb-4 flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">DQ-AQ Holding (持仓与风控)</h1>
                    <p className="mt-1 text-sm text-gray-500">统一管理您的 DQ-AQ 存续与历史持仓，执行实时定价、状态流转与接货覆盖。</p>
                </div>
                {/* 全局 HKD 切换按钮 */}
                <button 
                    onClick={() => setIsHKDView(!isHKDView)} 
                    className={`px-5 py-2.5 text-sm font-bold rounded-lg border transition-all shadow-sm flex items-center gap-2 ${isHKDView ? 'bg-blue-600 text-white border-blue-600 shadow-blue-200' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}
                >
                    {isHKDView ? '已转为 HKD 全局计价' : '转化为 HKD (全局盯市)'}
                </button>
            </div>

            {/* === 1. 存续中持仓 === */}
            <div className="bg-white shadow rounded-lg p-6 border border-gray-200">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2"><Database size={20} className="text-blue-600"/>【DQ-AQ 持仓板块 (存续中)】</h2>
                </div>
                <div className="overflow-x-auto overflow-y-auto max-h-[500px] border rounded-lg mb-4 shadow-sm relative scrollbar-thin">
                    <table className="min-w-full text-xs text-left divide-y divide-gray-200">
                        <thead className="bg-gray-50 text-gray-600 font-medium sticky top-0 z-20 shadow-sm [&>tr>th]:bg-gray-50">
                            <tr>
                                <Th label="名称" sortKey="name" currentSort={livingSort} onSort={toggleLivingSort} currentFilter={livingFilters} onFilter={updateLivingFilter} />
                                <Th label="当前状态" sortKey="status" currentSort={livingSort} onSort={toggleLivingSort} currentFilter={livingFilters} onFilter={updateLivingFilter} />
                                <Th label="币种" sortKey="currency" currentSort={livingSort} onSort={toggleLivingSort} currentFilter={livingFilters} onFilter={updateLivingFilter} />
                                <Th label="方向" sortKey="dir" align="center" currentSort={livingSort} onSort={toggleLivingSort} currentFilter={livingFilters} onFilter={updateLivingFilter} />
                                <Th label="杠杆" sortKey="leverage" align="right" currentSort={livingSort} onSort={toggleLivingSort} currentFilter={livingFilters} onFilter={updateLivingFilter} />
                                <Th label="每日股" sortKey="daily" align="right" currentSort={livingSort} onSort={toggleLivingSort} currentFilter={livingFilters} onFilter={updateLivingFilter} />
                                <Th label="最大股" sortKey="max" align="right" currentSort={livingSort} onSort={toggleLivingSort} currentFilter={livingFilters} onFilter={updateLivingFilter} />
                                <Th label="敲入价" sortKey="koInPrice" align="right" currentSort={livingSort} onSort={toggleLivingSort} currentFilter={livingFilters} onFilter={updateLivingFilter} />
                                <Th label="敲出价" sortKey="koOutPrice" align="right" currentSort={livingSort} onSort={toggleLivingSort} currentFilter={livingFilters} onFilter={updateLivingFilter} />
                                <Th label="下一个观察日" sortKey="nextObs" align="center" currentSort={livingSort} onSort={toggleLivingSort} currentFilter={livingFilters} onFilter={updateLivingFilter} />
                                <Th label="最后结算日" sortKey="maturity" align="center" currentSort={livingSort} onSort={toggleLivingSort} currentFilter={livingFilters} onFilter={updateLivingFilter} />
                                <th className="px-3 py-2 text-center">点位图</th>
                                <Th label="KO概率" sortKey="koProb" align="right" currentSort={livingSort} onSort={toggleLivingSort} currentFilter={livingFilters} onFilter={updateLivingFilter} />
                                <Th label="预期完成率" sortKey="expRate" align="right" currentSort={livingSort} onSort={toggleLivingSort} currentFilter={livingFilters} onFilter={updateLivingFilter} />
                                <Th label="当前市值(净价)" sortKey="mktVal" align="right" currentSort={livingSort} onSort={toggleLivingSort} currentFilter={livingFilters} onFilter={updateLivingFilter} />
                                <Th label="已结算股数" sortKey="settled" align="right" currentSort={livingSort} onSort={toggleLivingSort} currentFilter={livingFilters} onFilter={updateLivingFilter} />
                                <Th label="已锁定未付股数" sortKey="locked" align="right" currentSort={livingSort} onSort={toggleLivingSort} currentFilter={livingFilters} onFilter={updateLivingFilter} />
                                <Th label="全价" sortKey="fullPrice" align="right" currentSort={livingSort} onSort={toggleLivingSort} currentFilter={livingFilters} onFilter={updateLivingFilter} />
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 bg-white">
                            {finalLiving.map(item => (
                                <tr key={item.id} className="hover:bg-blue-50/50">
                                    <td className="px-3 py-2 font-medium">{item.name}</td>
                                    <td className="px-3 py-2 text-green-700 font-bold">{item.status}</td>
                                    <td className="px-3 py-2">{item.currency}</td>
                                    <td className={`px-3 py-2 text-center font-bold ${item.dir==='DQ'?'text-red-600':'text-green-600'}`}>{item.dir}</td>
                                    <td className="px-3 py-2 text-right">{item.leverage}x</td>
                                    <td className="px-3 py-2 text-right font-mono">{item.daily}</td>
                                    <td className="px-3 py-2 text-right font-mono">{item.max}</td>
                                    <td className="px-3 py-2 text-right font-mono underline decoration-dotted cursor-help" title={`敲入比例: ${item.koInPct}`}>{item.koInPrice}</td>
                                    <td className="px-3 py-2 text-right font-mono text-orange-600 underline decoration-dotted cursor-help" title={`敲出比例: ${item.koOutPct}`}>{item.koOutPrice}</td>
                                    <td className="px-3 py-2 text-center font-mono">{item.nextObs}</td>
                                    <td className="px-3 py-2 text-center font-mono">{item.maturity}</td>
                                    <td className="px-3 py-2 text-center">
                                        <button 
                                            onClick={() => {
                                                setChartData({ 
                                                    name: item.name, 
                                                    ticker: item.ticker,
                                                    current: item.currentPrice, 
                                                    strike: item.S0 * item.strikeRaw,
                                                    ko: item.S0 * item.koOutRaw
                                                });
                                            }} 
                                            className="text-blue-500 hover:bg-blue-100 p-1 rounded transition-colors"
                                            title="查看点位图"
                                        >
                                            <LineChart size={16}/>
                                        </button>
                                    </td>
                                    <td className="px-3 py-2 text-right text-red-600 underline decoration-dotted cursor-help" title={`未来期望股数: ${item.future.toFixed(2)}`}>{fmtPct(item.koProb)}</td>
                                    <td className="px-3 py-2 text-right text-blue-600 underline decoration-dotted cursor-help" title={`期望总股数: ${item.expTotal.toFixed(2)}`}>{fmtPct(item.expRate)}</td>
                                    <td className="px-3 py-2 text-right font-mono font-bold text-gray-800">{fmtMoney(item.mktVal, item.currency)}</td>
                                    <td className="px-3 py-2 text-right font-mono">{(item.settled || 0).toFixed(2)}</td>
                                    <td className="px-3 py-2 text-right font-mono">{(item.locked || 0).toFixed(2)}</td>
                                    <td className="px-3 py-2 text-right font-mono font-bold text-blue-800">{fmtMoney(item.fullPrice, item.currency)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                <button onClick={handleRefreshLiving} disabled={loadingLiving} className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-md flex justify-center items-center gap-2">
                    {loadingLiving ? <Loader2 className="animate-spin" size={18} /> : <RefreshCw size={18} />} {loadingLiving ? '重新测算与流转...' : '刷新当前持仓 (获取实时现价并提取交收流水)'}
                </button>
            </div>

            {/* === 2. 风控板块 === */}
            <div className="bg-white shadow rounded-lg p-6 border border-gray-200">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2"><TrendingUp size={20} className="text-red-600"/>【DQ-AQ 风控模块】</h2>
                </div>
                <div className="overflow-x-auto border rounded-lg shadow-sm">
                    <table className="min-w-full text-xs text-left divide-y divide-gray-200">
                        <thead className="bg-red-50 text-red-800 font-medium">
                            <tr>
                                <Th label="标的代码" sortKey="ticker" currentSort={riskSort} onSort={toggleRiskSort} currentFilter={riskFilters} onFilter={updateRiskFilter} />
                                <Th label="合约名称" sortKey="name" currentSort={riskSort} onSort={toggleRiskSort} currentFilter={riskFilters} onFilter={updateRiskFilter} />
                                <Th label="暴露成本价(Strike)" sortKey="costPrice" align="right" currentSort={riskSort} onSort={toggleRiskSort} currentFilter={riskFilters} onFilter={updateRiskFilter} />
                                <Th label="暴露股数" sortKey="exposureShares" align="right" currentSort={riskSort} onSort={toggleRiskSort} currentFilter={riskFilters} onFilter={updateRiskFilter} />
                                <Th label="暴露成本" sortKey="exposureCost" align="right" currentSort={riskSort} onSort={toggleRiskSort} currentFilter={riskFilters} onFilter={updateRiskFilter} />
                                <Th label="暴露市值" sortKey="exposureMktVal" align="right" currentSort={riskSort} onSort={toggleRiskSort} currentFilter={riskFilters} onFilter={updateRiskFilter} />
                                <Th label="暴露盈亏比" sortKey="pnlRatio" align="right" currentSort={riskSort} onSort={toggleRiskSort} currentFilter={riskFilters} onFilter={updateRiskFilter} />
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 bg-white">
                            {finalRisk.map(r => (
                                <tr key={r.id} className="hover:bg-red-50/30">
                                    <td className="px-3 py-2 font-mono font-bold text-gray-800">{r.ticker}</td>
                                    <td className="px-3 py-2">{r.name}</td>
                                    <td className="px-3 py-2 text-right font-mono">{r.costPrice.toFixed(4)}</td>
                                    <td className={`px-3 py-2 text-right font-mono ${r.exposureShares < 0 ? 'text-red-600':'text-green-600'}`}>{r.exposureShares.toFixed(2)}</td>
                                    <td className="px-3 py-2 text-right font-mono">{fmtMoney(r.exposureCost, r.currency)}</td>
                                    <td className="px-3 py-2 text-right font-mono">{fmtMoney(r.exposureMktVal, r.currency)}</td>
                                    <td className={`px-3 py-2 text-right font-mono font-bold ${r.pnlRatio >= 0 ? 'text-green-600':'text-red-600'}`}>{r.pnlRatio > 0 ? '+':''}{fmtPct(r.pnlRatio)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* === 3. 历史持仓 === */}
            <div className="bg-white shadow rounded-lg p-6 border border-gray-200">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2"><Database size={20} className="text-orange-600"/>【DQ-AQ 持仓板块 (历史)】</h2>
                </div>
                <div className="overflow-x-auto overflow-y-auto max-h-[500px] border rounded-lg mb-4 shadow-sm relative scrollbar-thin">
                    <table className="min-w-full text-xs text-left divide-y divide-gray-200">
                        <thead className="bg-gray-50 text-gray-600 font-medium sticky top-0 z-20 shadow-sm [&>tr>th]:bg-gray-50">
                            <tr>
                                <Th label="名称" sortKey="name" currentSort={diedSort} onSort={toggleDiedSort} currentFilter={diedFilters} onFilter={updateDiedFilter} />
                                <Th label="历史状态" sortKey="status" align="center" currentSort={diedSort} onSort={toggleDiedSort} currentFilter={diedFilters} onFilter={updateDiedFilter} />
                                <Th label="币种" sortKey="currency" align="center" currentSort={diedSort} onSort={toggleDiedSort} currentFilter={diedFilters} onFilter={updateDiedFilter} />
                                <Th label="方向" sortKey="dir" align="center" currentSort={diedSort} onSort={toggleDiedSort} currentFilter={diedFilters} onFilter={updateDiedFilter} />
                                <Th label="杠杆" sortKey="leverage" align="right" currentSort={diedSort} onSort={toggleDiedSort} currentFilter={diedFilters} onFilter={updateDiedFilter} />
                                <Th label="敲入价" sortKey="koInPrice" align="right" currentSort={diedSort} onSort={toggleDiedSort} currentFilter={diedFilters} onFilter={updateDiedFilter} />
                                <Th label="敲出价" sortKey="koOutPrice" align="right" currentSort={diedSort} onSort={toggleDiedSort} currentFilter={diedFilters} onFilter={updateDiedFilter} />
                                <Th label="最终结算股数" sortKey="settled" align="right" currentSort={diedSort} onSort={toggleDiedSort} currentFilter={diedFilters} onFilter={updateDiedFilter} />
                                <Th label="最终完成率" sortKey="expRate" align="right" currentSort={diedSort} onSort={toggleDiedSort} currentFilter={diedFilters} onFilter={updateDiedFilter} />
                                <Th label="全价" sortKey="fullPrice" align="right" currentSort={diedSort} onSort={toggleDiedSort} currentFilter={diedFilters} onFilter={updateDiedFilter} />
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 bg-white">
                            {finalDied.map(item => (
                                <tr key={item.id} className="hover:bg-orange-50/30">
                                    <td className="px-3 py-2 font-medium">{item.name}</td>
                                    <td className="px-3 py-2 text-orange-700 font-bold text-center">{item.status}</td>
                                    <td className="px-3 py-2 text-center">{item.currency}</td>
                                    <td className={`px-3 py-2 text-center font-bold ${item.dir==='DQ'?'text-red-600':'text-green-600'}`}>{item.dir}</td>
                                    <td className="px-3 py-2 text-right">{item.leverage}x</td>
                                    <td className="px-3 py-2 text-right font-mono underline decoration-dotted cursor-help" title={`敲入比例: ${item.koInPct}`}>{item.koInPrice}</td>
                                    <td className="px-3 py-2 text-right font-mono text-orange-600 underline decoration-dotted cursor-help" title={`敲出比例: ${item.koOutPct}`}>{item.koOutPrice}</td>
                                    <td className="px-3 py-2 text-right font-mono font-bold text-gray-800">{(item.settled || 0).toFixed(2)}</td>
                                    <td className="px-3 py-2 text-right font-mono">{fmtPct(item.expRate || 0)}</td>
                                    <td className="px-3 py-2 text-right font-mono font-bold text-blue-800">{fmtMoney(item.fullPrice, item.currency)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                <button onClick={handleRefreshDied} disabled={loadingDied} className="w-full py-3 bg-orange-600 hover:bg-orange-700 text-white font-bold rounded-md flex justify-center items-center gap-2">
                    {loadingDied ? <Loader2 className="animate-spin" size={18} /> : <RefreshCw size={18} />} {loadingDied ? '重新计算校验中...' : '刷新历史持仓 (校验状态准确性)'}
                </button>
            </div>

            {/* === 模块 4：DQ-AQ 统计 === */}
            <div className="bg-white shadow rounded-lg p-6 border border-gray-200 mt-8">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                        <PieChart size={20} className="text-indigo-600"/>
                        【DQ-AQ 统计】
                        <span className="text-sm font-normal text-gray-500 ml-2">全局数据统一折合为 HKD</span>
                    </h2>
                    <span className="text-xs text-gray-400">仅市值与收益表进行入库</span>
                </div>

                <div className="flex bg-gray-100 p-1 rounded-lg w-max mb-4">
                    <button 
                        onClick={() => setStatsTab('GLOBAL')} 
                        className={`px-4 py-1.5 text-xs font-bold rounded-md transition-colors ${statsTab === 'GLOBAL' ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                    >
                        全局统计 (不入库)
                    </button>
                    <button 
                        onClick={() => setStatsTab('MKT_VAL')} 
                        className={`px-4 py-1.5 text-xs font-bold rounded-md transition-colors ${statsTab === 'MKT_VAL' ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                    >
                        当前市值二维统计 (入库)
                    </button>
                    <button 
                        onClick={() => setStatsTab('PL')} 
                        className={`px-4 py-1.5 text-xs font-bold rounded-md transition-colors ${statsTab === 'PL' ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                    >
                        当前收益统计表 (入库)
                    </button>
                </div>
                
                {statsTab === 'GLOBAL' && (
                    <div className="overflow-x-auto border rounded-lg shadow-sm">
                        <table className="min-w-full text-sm text-left divide-y divide-gray-200">
                            <thead className="bg-indigo-50 text-indigo-900 font-medium">
                                <tr>
                                    <th className="px-3 py-2 text-center whitespace-nowrap">市场(币种)</th>
                                    <th className="px-3 py-2 text-right whitespace-nowrap">未实现损益 HKD (当前净价)</th>
                                    <th className="px-3 py-2 text-right whitespace-nowrap">总损益 HKD (全价和)</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 bg-white">
                                {globalStats.marketList.length === 0 ? (
                                    <tr><td colSpan={3} className="px-4 py-8 text-center text-gray-400">暂无统计数据</td></tr>
                                ) : globalStats.marketList.map((m: any) => (
                                    <tr key={m.market} className="hover:bg-indigo-50/30">
                                        <td className="px-3 py-2 text-center font-bold text-gray-700">{m.market}</td>
                                        <td className={`px-3 py-2 text-right font-mono font-medium ${cColor(m.netVal, 'text-green-600', 'text-red-600', 'text-gray-500')}`}>
                                            {fmtSign(m.netVal)}
                                        </td>
                                        <td className={`px-3 py-2 text-right font-mono font-bold ${cColor(m.fullVal, 'text-green-600', 'text-red-600', 'text-gray-500')}`}>
                                            {fmtSign(m.fullVal)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                            {globalStats.marketList.length > 0 && (
                                <tfoot className="bg-indigo-100 border-t-2 border-indigo-200 shadow-inner">
                                    <tr>
                                        <td className="px-3 py-3 text-center font-bold text-indigo-900 tracking-wider">全局大盘 SUM</td>
                                        <td className={`px-3 py-3 text-right font-mono font-bold ${cColor(globalStats.hkdSum.netVal, 'text-green-600', 'text-red-600', 'text-gray-500')}`}>
                                            {fmtSign(globalStats.hkdSum.netVal)}
                                        </td>
                                        <td className={`px-3 py-3 text-right font-mono font-bold ${cColor(globalStats.hkdSum.fullVal, 'text-green-600', 'text-red-600', 'text-gray-500')}`}>
                                            {fmtSign(globalStats.hkdSum.fullVal)}
                                        </td>
                                    </tr>
                                </tfoot>
                            )}
                        </table>
                    </div>
                )}

                {statsTab === 'MKT_VAL' && (
                    <div className="bg-indigo-50 border-t border-indigo-100 p-5 rounded-lg">
                        <div className="flex justify-between items-center mb-3">
                            <h3 className="font-bold text-indigo-800 text-sm">当前市值二维统计矩阵</h3>
                            <button 
                                onClick={() => setIsHKDView(!isHKDView)}
                                disabled={isFetchingFx}
                                className={`text-xs font-bold px-3 py-1.5 rounded transition-colors border ${isHKDView ? 'bg-indigo-600 text-white border-indigo-600 shadow-inner' : 'bg-white text-indigo-700 border-indigo-200 hover:bg-indigo-100 shadow-sm'}`}
                            >
                                {isFetchingFx && <Loader2 size={12} className="animate-spin inline mr-1" />}
                                {isHKDView ? '恢复原始币种' : 'TO HKD (一键折算)'}
                            </button>
                        </div>
                        <div className="overflow-x-auto rounded border border-indigo-200 bg-white">
                            <table className="min-w-full text-xs text-right">
                                <thead className="bg-indigo-100/50 text-indigo-900 font-medium">
                                    <tr>
                                        <th className="px-3 py-2 text-center border-b border-r border-indigo-100 bg-indigo-50/50">币种 \ 账户</th>
                                        {currentMktStats.accounts.map(acc => (
                                            <th key={acc} className="px-3 py-2 border-b border-indigo-100">{acc}</th>
                                        ))}
                                        <th className="px-3 py-2 border-b border-l border-indigo-100 bg-indigo-50/50">SUM (HKD)</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-indigo-50">
                                    {currentMktStats.markets.map(mkt => {
                                        const rate = isHKDView ? (globalFxRates[mkt] || 1) : 1;
                                        const actualRate = globalFxRates[mkt] || 1;
                                        let rawRowSum = 0;
                                        return (
                                            <tr key={mkt} className="hover:bg-indigo-50/30">
                                                <td className="px-3 py-2 text-center font-bold text-gray-700 border-r border-indigo-50 bg-indigo-50/20">{mkt}</td>
                                                {currentMktStats.accounts.map(acc => {
                                                    const rawVal = currentMktStats.rawMatrix[mkt][acc] || 0;
                                                    rawRowSum += rawVal;
                                                    const displayVal = rawVal * rate;
                                                    return (
                                                        <td key={acc} className={"px-3 py-2 font-mono " + cColor(displayVal, 'text-gray-700', 'text-red-600', 'text-gray-400')}>
                                                            {displayVal === 0 ? '-' : formatMoney(displayVal)}
                                                        </td>
                                                    );
                                                })}
                                                <td className={"px-3 py-2 font-mono font-bold border-l border-indigo-50 bg-indigo-50/20 " + cColor(rawRowSum * actualRate, 'text-indigo-900', 'text-red-600', 'text-gray-500')}>
                                                    {rawRowSum * actualRate === 0 ? '-' : formatMoney(rawRowSum * actualRate)}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                    {currentMktStats.markets.length === 0 && (
                                        <tr><td colSpan={currentMktStats.accounts.length + 2} className="px-3 py-4 text-center text-gray-400">暂无数据</td></tr>
                                    )}
                                </tbody>
                                {currentMktStats.markets.length > 0 && (
                                    <tfoot className="bg-indigo-100 text-indigo-900 border-t-2 border-indigo-200 shadow-inner">
                                        <tr>
                                            <td className="px-3 py-3 text-center font-bold border-r border-indigo-200">SUM (HKD)</td>
                                            {currentMktStats.accounts.map(acc => {
                                                let colSumHKD = 0;
                                                currentMktStats.markets.forEach(mkt => {
                                                    const rawVal = currentMktStats.rawMatrix[mkt][acc] || 0;
                                                    colSumHKD += rawVal * (globalFxRates[mkt] || 1);
                                                });
                                                return (
                                                    <td key={acc} className={"px-3 py-3 font-mono font-bold " + cColor(colSumHKD, 'text-indigo-900', 'text-red-600', 'text-gray-500')}>
                                                        {colSumHKD === 0 ? '-' : formatMoney(colSumHKD)}
                                                    </td>
                                                );
                                            })}
                                            <td className="px-3 py-3 font-mono font-bold text-sm border-l border-indigo-200 text-indigo-900">
                                                {formatMoney(
                                                    currentMktStats.markets.reduce((sum, mkt) => {
                                                        let rSum = 0;
                                                        currentMktStats.accounts.forEach(a => rSum += currentMktStats.rawMatrix[mkt][a] || 0);
                                                        return sum + rSum * (globalFxRates[mkt] || 1);
                                                    }, 0)
                                                )} HKD
                                            </td>
                                        </tr>
                                    </tfoot>
                                )}
                            </table>
                        </div>

                        <div className="mt-4 flex items-center justify-between bg-white px-4 py-3 rounded border border-indigo-100 shadow-sm">
                            <div className="flex items-center gap-4 text-xs text-gray-500">
                                <span className="flex items-center gap-1.5"><Clock size={14} className="text-indigo-500" /> 最后入库时间: <span className="font-mono font-medium text-gray-700">{lastMktValSavedTime}</span></span>
                                <span className="text-[10px] bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded border border-indigo-100">※每分钟自动入库</span>
                            </div>
                            <div className="flex items-center gap-3">
                                <button onClick={() => fetchLatestFxRates()} disabled={isFetchingFx} className="flex items-center gap-2 px-4 py-2 bg-white border border-indigo-600 text-indigo-600 hover:bg-indigo-50 text-xs font-bold rounded shadow-sm transition-colors disabled:opacity-50">
                                    <RefreshCw size={14} className={isFetchingFx ? 'animate-spin' : ''} /> 手动刷新
                                </button>
                                <button onClick={() => handleSaveMktValStats(false)} disabled={isSavingMktVal} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded shadow-sm transition-colors disabled:opacity-50">
                                    {isSavingMktVal ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} 手动保存入库
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {statsTab === 'PL' && (
                    <div className="bg-rose-50 border-t border-rose-100 p-5 rounded-lg">
                        <div className="flex justify-between items-center mb-3">
                            <h3 className="font-bold text-rose-800 text-sm">当前收益统计表</h3>
                            <button 
                                onClick={() => setIsHKDView(!isHKDView)}
                                disabled={isFetchingFx}
                                className={`text-xs font-bold px-3 py-1.5 rounded transition-colors border ${isHKDView ? 'bg-rose-600 text-white border-rose-600 shadow-inner' : 'bg-white text-rose-700 border-rose-200 hover:bg-rose-100 shadow-sm'}`}
                            >
                                {isFetchingFx && <Loader2 size={12} className="animate-spin inline mr-1" />}
                                {isHKDView ? '恢复原始币种' : 'TO HKD (一键折算)'}
                            </button>
                        </div>
                        <div className="overflow-x-auto rounded border border-rose-200 bg-white">
                            <table className="min-w-full text-xs text-right">
                                <thead className="bg-rose-100/50 text-rose-900 font-medium">
                                    <tr>
                                        <th className="px-3 py-2 text-center border-b border-r border-rose-100 bg-rose-50/50">币种</th>
                                        <th className="px-3 py-2 border-b border-rose-100">已实现盈亏</th>
                                        <th className="px-3 py-2 border-b border-rose-100">浮动盈亏 (未实现)</th>
                                        <th className="px-3 py-2 border-b border-l border-rose-100 bg-rose-50/50">总盈亏 {isHKDView ? '(HKD)' : '(原币种)'}</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-rose-50">
                                    {currentPlStats.markets.map(mkt => {
                                        const rate = isHKDView ? (globalFxRates[mkt] || 1) : 1;
                                        const data = currentPlStats.rawMatrix[mkt];
                                        const displayRealized = data.realized * rate;
                                        const displayUnrealized = data.unrealized * rate;
                                        const displayTotal = data.total * rate;
                                        return (
                                            <tr key={mkt} className="hover:bg-rose-50/30">
                                                <td className="px-3 py-2 text-center font-bold text-gray-700 border-r border-rose-50 bg-rose-50/20">{mkt}</td>
                                                <td className={"px-3 py-3 font-mono " + cColor(displayRealized, 'text-red-600', 'text-green-600', 'text-gray-400')}>
                                                    {fmtSign(displayRealized)}
                                                </td>
                                                <td className={"px-3 py-3 font-mono " + cColor(displayUnrealized, 'text-red-600', 'text-green-600', 'text-gray-400')}>
                                                    {fmtSign(displayUnrealized)}
                                                </td>
                                                <td className={"px-3 py-3 font-mono font-bold border-l border-rose-50 bg-rose-50/20 " + cColor(displayTotal, 'text-red-700', 'text-green-700', 'text-gray-500')}>
                                                    {fmtSign(displayTotal)}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                    {currentPlStats.markets.length === 0 && (
                                        <tr><td colSpan={4} className="px-3 py-6 text-center text-gray-400">暂无数据</td></tr>
                                    )}
                                </tbody>
                                {currentPlStats.markets.length > 0 && (
                                    <tfoot className="bg-rose-100 text-rose-900 border-t-2 border-rose-200 shadow-inner">
                                        <tr>
                                            <td className="px-3 py-4 text-center font-bold border-r border-rose-200">
                                                {isHKDView ? 'SUM (HKD)' : 'SUM (无效)'}
                                            </td>
                                            <td className={"px-3 py-4 font-mono font-bold " + (!isHKDView ? 'text-gray-400' : cColor(globalStats.hkdSum.realizedTotal, 'text-red-600', 'text-green-600', 'text-gray-500'))}>
                                                {!isHKDView ? '-' : fmtSign(globalStats.hkdSum.realizedTotal)}
                                            </td>
                                            <td className={"px-3 py-4 font-mono font-bold " + (!isHKDView ? 'text-gray-400' : cColor(globalStats.hkdSum.unrealized, 'text-red-600', 'text-green-600', 'text-gray-500'))}>
                                                {!isHKDView ? '-' : fmtSign(globalStats.hkdSum.unrealized)}
                                            </td>
                                            <td className={"px-3 py-4 font-mono font-bold text-sm border-l border-rose-200 bg-rose-200/50 " + (!isHKDView ? 'text-rose-900' : cColor(globalStats.hkdSum.totalPnl, 'text-red-700', 'text-green-700', 'text-gray-700'))}>
                                                {!isHKDView ? <span className="text-gray-400">-</span> : `${fmtSign(globalStats.hkdSum.totalPnl)} HKD`}
                                            </td>
                                        </tr>
                                    </tfoot>
                                )}
                            </table>
                        </div>

                        <div className="mt-4 flex items-center justify-between bg-white px-4 py-3 rounded border border-rose-100 shadow-sm">
                            <div className="flex items-center gap-4 text-xs text-gray-500">
                                <span className="flex items-center gap-1.5"><Clock size={14} className="text-rose-500" /> 最后入库时间: <span className="font-mono font-medium text-gray-700">{lastPlSavedTime}</span></span>
                                <span className="text-[10px] bg-rose-50 text-rose-600 px-2 py-0.5 rounded border border-rose-100">※每分钟自动入库</span>
                            </div>
                            <div className="flex items-center gap-3">
                                <button onClick={() => fetchLatestFxRates()} disabled={isFetchingFx} className="flex items-center gap-2 px-4 py-2 bg-white border border-rose-600 text-rose-600 hover:bg-rose-50 text-xs font-bold rounded shadow-sm transition-colors disabled:opacity-50">
                                    <RefreshCw size={14} className={isFetchingFx ? 'animate-spin' : ''} /> 手动刷新
                                </button>
                                <button onClick={() => handleSavePlStats(false)} disabled={isSavingPl} className="flex items-center gap-2 px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded shadow-sm transition-colors disabled:opacity-50">
                                    {isSavingPl ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} 手动保存入库
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* === 模块 5：后台库管理模块 === */}
            <div className="bg-white shadow rounded-lg p-6 border border-gray-200 mt-8">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                        <FileJson size={20} className="text-purple-600"/>
                        【后台库管理模块】
                    </h2>
                    <button onClick={() => fetchDbRecords(activeDbTab)} className="text-sm text-purple-600 hover:text-purple-800 flex items-center gap-1">
                        <RefreshCw size={14}/> 刷新数据
                    </button>
                </div>

                {/* 资料库 Tab 切换 */}
                <div className="flex gap-2 mb-4 border-b pb-2 overflow-x-auto">
                    {[
                        'sip_trade_dqaq_input_living', 
                        'sip_trade_dqaq_input_died', 
                        'sip_holding_dqaq_output_living', 
                        'sip_holding_dqaq_output_died', 
                        'sip_holding_dqaq_output_get-stock',
                        'sip_holding_dqaq_mktvalue',
                        'sip_holding_dqaq_pl'
                    ].map(tab => (
                        <button 
                            key={tab} 
                            onClick={() => setActiveDbTab(tab)} 
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
                    <div className="overflow-x-auto overflow-y-auto max-h-[450px] border rounded relative scrollbar-thin">
                        <table className="min-w-full text-sm text-left divide-y divide-gray-200">
                            <thead className="bg-gray-50 text-gray-500 sticky top-0 z-10 shadow-sm [&>tr>th]:bg-gray-50">
                                <tr>
                                    <th className="px-3 py-2 whitespace-nowrap">ID / 确切修改时间</th>
                                    <th className="px-3 py-2">绑定 TradeID</th>
                                    <th className="px-3 py-2">内容摘要 / 产品名称</th>
                                    <th className="px-3 py-2 text-center whitespace-nowrap">操作</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 bg-white">
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

            {/* 实盘交收记录确认 Modal */}
            {showDeliveryModal && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col relative overflow-hidden">
                        <div className="px-6 py-4 border-b flex justify-between items-center bg-gray-50 flex-shrink-0">
                            <div>
                                <h3 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                                    <AlertCircle className="text-orange-500" size={24} />
                                    检测到实盘交收记录
                                </h3>
                                <p className="text-sm text-gray-500 mt-1">本次刷新触发了以下 DQ-AQ 的到期或敲出结算，请确认并推送到交收库。</p>
                            </div>
                            <button onClick={() => { setShowDeliveryModal(false); setPendingDeliveries([]); }} className="text-gray-400 hover:text-gray-600 bg-white p-1 rounded-full shadow-sm border transition-colors"><X size={24}/></button>
                        </div>
                        
                        <div className="p-6 overflow-y-auto flex-1 bg-white">
                            <div className="border border-gray-200 rounded-lg overflow-x-auto shadow-sm">
                                <table className="min-w-full text-sm text-left">
                                    <thead className="bg-gray-100 text-gray-600 font-medium sticky top-0 shadow-sm">
                                        <tr>
                                            <th className="px-4 py-3">交收日期</th>
                                            <th className="px-4 py-3">账户</th>
                                            <th className="px-4 py-3 text-center">方向</th>
                                            <th className="px-4 py-3">标的</th>
                                            <th className="px-4 py-3 text-right">股数</th>
                                            <th className="px-4 py-3 text-right">结算价</th>
                                            <th className="px-4 py-3 text-right">总额(含费)</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100">
                                        {pendingDeliveries.map((d, i) => (
                                            <tr key={i} className="hover:bg-orange-50 transition-colors">
                                                <td className="px-4 py-3 text-gray-600">{d.date}</td>
                                                <td className="px-4 py-3 font-medium text-gray-800">{d.account}</td>
                                                <td className="px-4 py-3 text-center">
                                                    <span className={`px-2 py-0.5 rounded text-xs font-bold ${d.direction.toUpperCase() === 'BUY' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                                                        {d.direction}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-3">
                                                    <div className="font-bold text-gray-800">{d.stockName}</div>
                                                    <div className="text-[10px] font-mono text-gray-400">{d.stockCode}</div>
                                                </td>
                                                <td className={`px-4 py-3 text-right font-mono font-bold ${d.direction.toUpperCase() === 'BUY' ? 'text-red-600' : 'text-green-600'}`}>
                                                    {d.direction.toUpperCase() === 'BUY' ? '+' : ''}{d.quantity.toLocaleString()}
                                                </td>
                                                <td className="px-4 py-3 text-right font-mono text-gray-600">{d.priceNoFee.toFixed(4)}</td>
                                                <td className="px-4 py-3 text-right font-mono font-bold text-orange-700 bg-orange-50/30">
                                                    {d.amountNoFee.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        <div className="px-6 py-4 border-t bg-gray-50 flex justify-end gap-3 flex-shrink-0">
                            <button onClick={() => { setShowDeliveryModal(false); setPendingDeliveries([]); }} className="px-5 py-2.5 rounded-md text-gray-700 font-bold bg-white border border-gray-300 hover:bg-gray-100 transition-colors shadow-sm">取消并跳过</button>
                            <button onClick={handleConfirmDeliveries} disabled={syncingDeliveries} className="px-6 py-2.5 rounded-md text-white font-bold flex items-center gap-2 transition-all shadow-md bg-orange-600 hover:bg-orange-700 disabled:opacity-50">
                                {syncingDeliveries ? <Loader2 className="animate-spin" size={18}/> : <Save size={18}/>} 确认覆盖至 Get-Stock 交收库
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}