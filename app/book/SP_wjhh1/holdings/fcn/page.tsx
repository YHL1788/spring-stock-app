'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  RefreshCw, 
  Database, 
  FileJson, 
  Trash2, 
  X, 
  Save, 
  Loader2, 
  AlertCircle,
  TrendingUp,
  LineChart,
  PieChart
} from 'lucide-react';
import { collection, getDocs, doc, updateDoc, addDoc, deleteDoc, setDoc } from 'firebase/firestore';
import { onAuthStateChanged, signInAnonymously, signInWithCustomToken } from 'firebase/auth';

import { db, auth, APP_ID } from '@/app/lib/stockService';
import { FCNPricer, FCNParams, FCNResult } from '@/app/lib/fcnPricer';

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

// --- 辅助函数：序列化处理 ---
const replaceUndefinedWithNull = (obj: any): any => {
    if (obj === undefined) return null;
    if (obj === null || typeof obj !== 'object') return obj;
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

// --- 汇总数值格式化工具 ---
const formatSum = (val: number) => {
    return `${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const formatSumWithSign = (val: number) => {
    const sign = val > 0 ? '+' : '';
    return `${sign}${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const formatMoney = (val: number, isHkdContext = false) => {
    const v = isHkdContext ? val : val; 
    return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

interface MergedRecord {
    tradeId: string;
    inputId: string;
    outputId: string;
    inputData: any;
    outputData: any;
    updatedAt: any;
    createdAt: any;
}

// 點位圖資料結構
interface FCNChartData {
    name: string;
    ticker: string;
    current: number;
    strike: number;
    ko: number;
}

// --- 可排序筛选表头组件 ---
const Th = ({ label, sortKey, filterKey, currentSort, onSort, currentFilter, onFilter, align='left' }: any) => {
    const justifyClass = align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : 'justify-start';
    const textClass = align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left';
    
    return (
        <th className={`px-3 py-2 whitespace-nowrap align-top group ${textClass}`}>
            <div 
                className={`flex items-center ${justifyClass} gap-1 select-none ${sortKey ? 'cursor-pointer hover:text-gray-800' : ''}`}
                onClick={() => sortKey && onSort(sortKey)}
            >
                {label}
                {sortKey && currentSort.key === sortKey && (
                    <span className="text-blue-500 text-[10px] ml-1">
                        {currentSort.dir === 'asc' ? '▲' : '▼'}
                    </span>
                )}
                {sortKey && currentSort.key !== sortKey && (
                    <span className="text-gray-300 text-[10px] opacity-0 group-hover:opacity-100 transition-opacity ml-1">▲</span>
                )}
            </div>
            {filterKey && (
                <div className="mt-1">
                    <input 
                        type="text" 
                        placeholder="筛选..." 
                        value={currentFilter[filterKey] || ''}
                        onChange={(e) => onFilter(filterKey, e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        className="w-full min-w-[60px] border border-gray-300 rounded px-1 py-0.5 text-[10px] font-normal focus:outline-none focus:border-blue-500 text-gray-700"
                    />
                </div>
            )}
        </th>
    );
};

export default function FCNHoldingPage() {
    const [user, setUser] = useState<any>(null);
    
    // --- 核心持仓状态 ---
    const [livingRecords, setLivingRecords] = useState<MergedRecord[]>([]);
    const [diedRecords, setDiedRecords] = useState<MergedRecord[]>([]);
    const [loadingLiving, setLoadingLiving] = useState(false);
    const [loadingDied, setLoadingDied] = useState(false);
    const [loadingSum, setLoadingSum] = useState(false);

    // --- 全局最新汇率与 HKD 视图状态 ---
    const [isHKDView, setIsHKDView] = useState(false);
    const [globalFxRates, setGlobalFxRates] = useState<Record<string, number>>({});
    const [isFetchingFx, setIsFetchingFx] = useState(false);
    const hasFetchedInitialFxRates = useRef(false);

    // --- DB管理模块状态 ---
    const [activeDbTab, setActiveDbTab] = useState('sip_holding_fcn_output_living');
    const [dbRecords, setDbRecords] = useState<any[]>([]);
    const [loadingDb, setLoadingDb] = useState(false);
    const [editRecordModal, setEditRecordModal] = useState<{show: boolean, record: any, rawJson: string} | null>(null);

    // --- 股价点位图 Modal 状态 (安全重構) ---
    const [chartModalData, setChartModalData] = useState<{ title: string, charts: FCNChartData[] } | null>(null);

    // --- 排序与筛选 State ---
    const [livingSort, setLivingSort] = useState<{key: string, dir: 'asc'|'desc'|null}>({key: '', dir: null});
    const [livingFilters, setLivingFilters] = useState<Record<string, string>>({});
    const [riskSort, setRiskSort] = useState<{key: string, dir: 'asc'|'desc'|null}>({key: '', dir: null});
    const [riskFilters, setRiskFilters] = useState<Record<string, string>>({});
    const [diedSort, setDiedSort] = useState<{key: string, dir: 'asc'|'desc'|null}>({key: '', dir: null});
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
    const handleFilter = (setFilter: any) => (key: string, val: string) => {
        setFilter((prev: any) => ({ ...prev, [key]: val }));
    };

    const toggleLivingSort = toggleSort(setLivingSort);
    const updateLivingFilter = handleFilter(setLivingFilters);
    const toggleRiskSort = toggleSort(setRiskSort);
    const updateRiskFilter = handleFilter(setRiskFilters);
    const toggleDiedSort = toggleSort(setDiedSort);
    const updateDiedFilter = handleFilter(setDiedFilters);

    // --- 初始化 Auth ---
    useEffect(() => {
        const initAuth = async () => {
            if (!auth.currentUser) {
                // @ts-ignore
                if (typeof window !== 'undefined' && window.__initial_auth_token) {
                    // @ts-ignore
                    await signInWithCustomToken(auth, window.__initial_auth_token);
                } else {
                    await signInAnonymously(auth);
                }
            }
            onAuthStateChanged(auth, setUser);
        };
        initAuth();
    }, []);

    // --- 核心：通过 tradeId 映射合并 Input 和 Output 库 ---
    const fetchMergedRecords = async (lifeCycle: 'living' | 'died'): Promise<MergedRecord[]> => {
        try {
            const inputSnap = await getDocs(collection(db, 'artifacts', APP_ID, 'public', 'data', `sip_trade_fcn_input_${lifeCycle}`));
            const outputSnap = await getDocs(collection(db, 'artifacts', APP_ID, 'public', 'data', `sip_holding_fcn_output_${lifeCycle}`));
            
            if (inputSnap.empty) return [];

            // 解析数据时，严格 delete 掉 data 中的污染 id
            const inputs = inputSnap.docs.map(d => {
                const data = d.data();
                delete data.id; 
                return { ...data, id: d.id };
            }) as any[];
            
            const outputs = outputSnap.docs.map(d => {
                const data = d.data();
                delete data.id;
                return { ...data, id: d.id };
            }) as any[];
            
            const merged = inputs.map(inp => {
                const out = outputs.find(o => o.tradeId && o.tradeId === inp.tradeId);
                if (!out) return null; 
                return {
                    tradeId: inp.tradeId,
                    inputId: inp.id,
                    outputId: out.id,
                    inputData: inp,
                    outputData: out,
                    updatedAt: inp.updatedAt || out.updatedAt,
                    createdAt: inp.createdAt
                };
            }).filter(Boolean) as MergedRecord[];
            
            merged.sort((a,b) => {
                const timeA = getTime(a.updatedAt) || getTime(a.createdAt);
                const timeB = getTime(b.updatedAt) || getTime(b.createdAt);
                return timeB - timeA;
            });
            return merged;
        } catch (error) {
            console.warn(`[Graceful Fallback] Fetch ${lifeCycle} records failed, possibly empty:`, error);
            return []; 
        }
    };

    const loadRecords = async () => {
        if (!user) return;
        try {
            const living = await fetchMergedRecords('living');
            setLivingRecords(living);
            const died = await fetchMergedRecords('died');
            setDiedRecords(died);
        } catch(e) { console.error(e); }
    };

    // --- 获取并刷新后台库数据 ---
    const fetchDbRecords = async (collectionName: string) => {
        if (!user) return;
        setLoadingDb(true);
        try {
            const querySnapshot = await getDocs(collection(db, 'artifacts', APP_ID, 'public', 'data', collectionName));
            let records: any[] = [];
            querySnapshot.forEach((docSnap) => {
                const data = docSnap.data();
                delete data.id; // 防止污染
                records.push({ ...data, id: docSnap.id });
            });
            records.sort((a, b) => {
               const timeA = getTime(a.updatedAt) || getTime(a.createdAt);
               const timeB = getTime(b.updatedAt) || getTime(b.createdAt);
               return timeB - timeA;
            });
            setDbRecords(records);
        } catch(e) {
            console.error("读取数据库失败:", e);
        } finally {
            setLoadingDb(false);
        }
    };

    useEffect(() => {
        if (user) { fetchDbRecords(activeDbTab); }
    }, [activeDbTab, user]);

    useEffect(() => {
        if (user) {
            loadRecords();
        }
    }, [user]);

    // --- API 调用 ---
    const fetchQuotePrice = async (symbol: string): Promise<number | null> => {
        try {
            const res = await fetch(`/api/quote?symbol=${symbol}`);
            if (!res.ok) return null;
            const data = await res.json();
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
        livingRecords.forEach(r => {
            const mkt = r.inputData?.pricerParams?.market;
            if (mkt && mkt !== 'HKD') markets.add(mkt);
        });
        diedRecords.forEach(r => {
            const mkt = r.inputData?.pricerParams?.market;
            if (mkt && mkt !== 'HKD') markets.add(mkt);
        });

        if (markets.size === 0) return;

        setIsFetchingFx(true);
        const newRates: Record<string, number> = {};
        try {
            await Promise.all(Array.from(markets).map(async (mkt) => {
                const res = await fetch(`/api/quote?currency=${mkt}`);
                if (res.ok) {
                    const data = await res.json();
                    if (data && data.rate) {
                        newRates[mkt] = data.rate;
                    }
                }
            }));
            setGlobalFxRates(prev => ({ ...prev, ...newRates }));
        } catch (e) {
            console.error("Failed to fetch global FX rates", e);
        } finally {
            setIsFetchingFx(false);
        }
    };

    useEffect(() => {
        if ((livingRecords.length > 0 || diedRecords.length > 0) && !hasFetchedInitialFxRates.current) {
            fetchLatestFxRates();
            hasFetchedInitialFxRates.current = true;
        }
    }, [livingRecords, diedRecords]);

    const handleToggleHKDView = async () => {
        if (!isHKDView) {
            await fetchLatestFxRates();
        }
        setIsHKDView(!isHKDView);
    };

    // --- 核心評估邏輯 (封裝復用) ---
    const evaluateFCN = async (mergedRecord: MergedRecord) => {
        const inputData = replaceNullWithUndefined(mergedRecord.inputData);
        const outputData = replaceNullWithUndefined(mergedRecord.outputData);
        const pricerParams = inputData.pricerParams as FCNParams;
        if (!pricerParams) throw new Error("Missing pricerParams");

        const last_obs_date = pricerParams.obs_dates[pricerParams.obs_dates.length - 1];
        const expireTimeMs = getExpirationTimeMs(last_obs_date, pricerParams.market || 'HKD');
        const isExpired = Date.now() >= expireTimeMs;

        const fetchedSpots = await Promise.all(pricerParams.tickers.map(async (t, i) => {
            if (isExpired) {
                const d = new Date(last_obs_date); d.setDate(d.getDate() - 7);
                const startStr = d.toISOString().split('T')[0];
                const histPrices = await fetchHistoricalPrices(t, startStr, last_obs_date);
                
                const validPrices = histPrices.filter((p:any) => p.date <= last_obs_date);
                if (validPrices.length > 0) {
                    validPrices.sort((a:any, b:any) => a.date.localeCompare(b.date));
                    return validPrices[validPrices.length - 1].close;
                }
                throw new Error(`無法獲取 ${t} 於最後觀察日 ${last_obs_date} 之前的有效歷史收盤價，拒絕結算！`);
            } else {
                const p = await fetchQuotePrice(t);
                return p !== null ? p : pricerParams.initial_spots[i];
            }
        }));
        pricerParams.current_spots = fetchedSpots;

        const today = new Date(); today.setHours(0,0,0,0);
        const hasPastObservation = pricerParams.obs_dates.some(d => new Date(d) <= today);
        const cutoffDate = isExpired ? last_obs_date : new Date().toISOString().split('T')[0];

        if (hasPastObservation && pricerParams.history_start_date) {
            const histMap: any = {};
            await Promise.all(pricerParams.tickers.map(async (t) => {
                histMap[t] = await fetchHistoricalPrices(t, pricerParams.history_start_date!, cutoffDate);
            }));
            pricerParams.hist_prices = histMap;
        }

        if (pricerParams.market !== 'HKD') {
            const res = await fetch(`/api/quote?currency=${pricerParams.market}`);
            const data = res.ok ? await res.json() : null;
            pricerParams.fx_rate = data?.rate || pricerParams.fx_rate || 1.0;
        } else {
            pricerParams.fx_rate = 1.0;
        }
        
        const pricer = new FCNPricer(pricerParams);
        const newResult = pricer.simulate_price();

        let deliveryRecord = null;
        if (newResult.status === 'Terminated_Delivery') {
            const worstIdx = newResult.loss_attribution.findIndex((val: number) => val === 1.0);
            if (worstIdx !== -1) {
                const ticker = pricerParams.tickers[worstIdx];
                const strikePrice = pricerParams.initial_spots[worstIdx] * pricerParams.strike_pct;
                const quantity = pricerParams.total_notional / strikePrice;
                const amountNoFee = strikePrice * quantity;
                
                deliveryRecord = {
                    tradeId: mergedRecord.tradeId,
                    date: pricerParams.pay_dates[pricerParams.pay_dates.length - 1],
                    account: pricerParams.account_name || inputData.inputParams?.account_name || '',
                    market: pricerParams.market === 'USD' ? 'US' : pricerParams.market === 'JPY' ? 'JP' : pricerParams.market === 'CNY' ? 'CH' : 'HK',
                    executor: pricerParams.executor || inputData.inputParams?.executor || '',
                    type: "FCN接货",
                    stockCode: ticker,
                    stockName: pricerParams.ticker_name?.[worstIdx] || ticker,
                    direction: "BUY",
                    quantity: Math.round(quantity),
                    priceNoFee: strikePrice,
                    amountNoFee: amountNoFee,
                    fee: 0,
                    amountWithFee: amountNoFee,
                    priceWithFee: amountNoFee / quantity,
                    hkdAmount: amountNoFee * (pricerParams.fx_rate || 1.0)
                };
            }
        }

        const exactNow = new Date();

        const cleanInput = replaceUndefinedWithNull({ 
            ...inputData, 
            pricerParams,
            updatedAt: exactNow 
        });
        delete cleanInput.id; delete cleanInput.inputId; delete cleanInput.outputId;

        const cleanOutput = replaceUndefinedWithNull({ 
            ...outputData, 
            result: newResult,
            updatedAt: exactNow 
        });
        delete cleanOutput.id; delete cleanOutput.inputId; delete cleanOutput.outputId;

        return { newResult, deliveryRecord, cleanInput, cleanOutput, exactNow };
    };

    // --- 刷新当前持仓 (Living) ---
    const handleRefreshLiving = async () => {
        setLoadingLiving(true);
        let deliveredCount = 0;
        try {
            const currentLiving = await fetchMergedRecords('living');
            if (currentLiving.length === 0) { setLoadingLiving(false); return; }

            const allNewDeliveries: any[] = [];

            for (const mergedRecord of currentLiving) {
                const { newResult, deliveryRecord, cleanInput, cleanOutput, exactNow } = await evaluateFCN(mergedRecord);
                
                const status = newResult.status;
                if (['Active', 'Settling_NoDelivery', 'Settling_Delivery'].includes(status)) {
                    await setDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'sip_trade_fcn_input_living', mergedRecord.inputId), cleanInput);
                    await setDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'sip_holding_fcn_output_living', mergedRecord.outputId), cleanOutput);
                } else {
                    await setDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'sip_trade_fcn_input_died', mergedRecord.inputId), cleanInput);
                    await setDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'sip_holding_fcn_output_died', mergedRecord.outputId), cleanOutput);
                    await deleteDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'sip_trade_fcn_input_living', mergedRecord.inputId));
                    await deleteDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'sip_holding_fcn_output_living', mergedRecord.outputId));
                    
                    if (deliveryRecord) {
                        deliveredCount++;
                        const cleanDelivery = replaceUndefinedWithNull({
                            ...deliveryRecord,
                            createdAt: exactNow
                        });
                        allNewDeliveries.push(cleanDelivery);
                        await addDoc(collection(db, 'artifacts', APP_ID, 'public', 'data', 'sip_trade_fcn_pending_delivery'), cleanDelivery);
                    }
                }
            }
            
            await loadRecords();
            await fetchLatestFxRates();

            if (activeDbTab === 'sip_holding_fcn_output_living' || activeDbTab === 'sip_trade_fcn_input_living') fetchDbRecords(activeDbTab);

            if (deliveredCount > 0) {
                alert(`刷新完毕！有 ${deliveredCount} 笔FCN触发了接货并已结束。接货记录已发往缓冲池，请移步 FCN Trade 页面的接货展示模块进行验证与推库！`);
            } else {
                alert('刷新完毕，已更新最新持仓与市值。');
            }
        } catch(e: any) {
            alert("刷新当前持仓失败: " + e.message);
        } finally {
            setLoadingLiving(false);
        }
    };

    // --- 刷新历史持仓 (Died) ---
    const handleRefreshDied = async () => {
        setLoadingDied(true);
        let errorCount = 0;
        try {
            const currentDied = await fetchMergedRecords('died');
            if (currentDied.length === 0) { setLoadingDied(false); return; }

            for (const mergedRecord of currentDied) {
                const { newResult, cleanInput, cleanOutput } = await evaluateFCN(mergedRecord);
                
                const status = newResult.status;
                if (['Active', 'Settling_NoDelivery', 'Settling_Delivery'].includes(status)) {
                    await setDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'sip_trade_fcn_input_living', mergedRecord.inputId), cleanInput);
                    await setDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'sip_holding_fcn_output_living', mergedRecord.outputId), cleanOutput);
                    await deleteDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'sip_trade_fcn_input_died', mergedRecord.inputId));
                    await deleteDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'sip_holding_fcn_output_died', mergedRecord.outputId));
                    errorCount++;
                } else {
                    await setDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'sip_trade_fcn_input_died', mergedRecord.inputId), cleanInput);
                    await setDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'sip_holding_fcn_output_died', mergedRecord.outputId), cleanOutput);
                }
            }
            
            await loadRecords();
            await fetchLatestFxRates();

            if (activeDbTab === 'sip_holding_fcn_output_died' || activeDbTab === 'sip_trade_fcn_input_died') fetchDbRecords(activeDbTab);

            if (errorCount > 0) {
                alert(`出错纠正！有 ${errorCount} 笔数据重新计算后发现仍在存续/结算中！系统已将其自动修复并转移回 Living 存续库！`);
            } else {
                alert('历史持仓刷新完毕！数据已更新校验。');
            }
        } catch(e: any) {
            alert("刷新历史持仓失败: " + e.message);
        } finally {
            setLoadingDied(false);
        }
    };

    // --- 后台库管理 Handlers ---
    const handleDeleteRecord = async (id: string) => {
        if (!confirm("确定要永久删除这条记录吗？不可恢复。")) return;
        try {
            await deleteDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', activeDbTab, id));
            setDbRecords(dbRecords.filter(r => r.id !== id));
        } catch(e: any) { alert("删除失败: " + e.message); }
    };

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

    // --- 动态展示记录摘要 Helper ---
    const getRecordSummary = (r: any, tab: string) => {
        try {
            if (tab.includes('input')) {
                const p = r.pricerParams || r.inputParams;
                if (!p) return 'FCN Input 参数';
                const names = p.ticker_name?.length ? p.ticker_name.join('~') : (p.tickers?.join('~') || '');
                return `${p.broker_name || p.broker || '未知'} 【${names}】 | ${p.trade_date || ''}`;
            }
            if (tab.includes('output_living') || tab.includes('output_died')) {
                if (r.result?.product_name_display) return r.result.product_name_display;
                if (r.name) return r.name;
                return 'FCN 测算结果';
            }
            if (tab.includes('get-stock') || tab.includes('pending_delivery')) {
                return `【交收】${r.account || ''} | ${r.direction || ''} ${r.quantity || 0}股 ${r.stockName || r.stockCode || ''}`;
            }
            if (tab.includes('sum')) {
                const time = formatTime(r.updatedAt) || formatTime(r.createdAt) || 'N/A';
                return `全局大盘统计快照 (更新于: ${time})`;
            }
            return JSON.stringify(r).substring(0, 100) + '...';
        } catch (e) {
            return '解析失败...';
        }
    };

    // --- 核心工具 (融合全局实时汇率逻辑) ---
    const formatMoneyWithUnit = (val: number, market: string, fxRate: number = 1) => {
        const effectiveRate = globalFxRates[market] || fxRate || 1;
        const value = isHKDView ? val * effectiveRate : val;
        const currency = isHKDView ? 'HKD' : (market || 'HKD');
        const numStr = value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        return `${numStr} ${currency}`;
    };

    const formatNotionalWithUnit = (val: number, market: string, fxRate: number = 1) => {
        const effectiveRate = globalFxRates[market] || fxRate || 1;
        const value = isHKDView ? val * effectiveRate : val;
        const currency = isHKDView ? 'HKD' : (market || 'HKD');
        const numStr = Math.round(value).toLocaleString('en-US');
        return `${numStr} ${currency}`;
    };

    const renderName = (params: FCNParams) => {
        if (!params) return 'N/A';
        const tNames = params.ticker_name && params.ticker_name.length > 0 
            ? params.ticker_name.join('~') 
            : params.tickers?.join('~') || '';
        return `${params.broker_name || '未知券商'} 【${tNames}】`;
    };
    
    const fmtPct = (val: number) => (val * 100).toFixed(2) + '%';
    
    const getStatusText = (status: string) => {
        switch (status) {
            case 'Active': return 'A (存续中)';
            case 'Settling_NoDelivery': return 'B (结算中,无接货)';
            case 'Settling_Delivery': return 'C (结算中,有接货)';
            case 'Terminated_Early': return 'D (提前敲出)';
            case 'Terminated_Normal': return 'E (正常结束,无接货)';
            case 'Terminated_Delivery': return 'F (结束已接货)';
            default: return status;
        }
    };

    const calcExpectedCouponPeriods = (res: FCNResult) => {
        if (!res) return 0;
        const total_return = res.hist_coupons_paid + res.pending_coupons_pv + res.future_coupons_pv;
        return res.avg_period_coupon > 0 ? total_return / res.avg_period_coupon : 0;
    };

    const getKnockInTooltip = (params: FCNParams, result: FCNResult) => {
        if (!params || !result || !result.loss_attribution) return '';
        return params.tickers.map((t, idx) => {
            const name = params.ticker_name?.[idx] || t;
            const prob = result.loss_attribution[idx] || 0;
            return `${name}: ${fmtPct(prob)}`;
        }).join('\n');
    };

    const getDeliveryTooltip = (params: FCNParams, result: FCNResult) => {
        if (result.status !== 'Terminated_Delivery' && result.status !== 'Settling_Delivery') return '';
        const worstIdx = result.loss_attribution.findIndex((val: number) => val === 1.0);
        if (worstIdx !== -1) {
            const name = params.ticker_name?.[worstIdx] || params.tickers[worstIdx];
            const qty = params.total_notional / (params.initial_spots[worstIdx] * params.strike_pct);
            return `${name} ${Math.round(qty)}股`;
        }
        return '';
    };

    const getNextObsDate = (dateRows: any[]) => {
        if (!dateRows) return '';
        const today = new Date(); today.setHours(0,0,0,0);
        return dateRows.map(r => r.obsDate).filter(d => new Date(d) >= today).sort()[0] || '';
    };

    // --- 数据重构与扁平化 Hook (处理排序与筛选) ---
    const useTableData = (data: any[], sortConfig: any, filterConfig: any, isHKDView: boolean, globalFx: Record<string, number>) => {
        return useMemo(() => {
            let result = [...data];

            Object.keys(filterConfig).forEach(key => {
                const filterValue = filterConfig[key]?.toLowerCase();
                if (filterValue) {
                    result = result.filter(item => {
                        const itemVal = item[key];
                        if (itemVal == null) return false;
                        return String(itemVal).toLowerCase().includes(filterValue);
                    });
                }
            });

            if (sortConfig.dir) {
                const isMonetary = ['notional', 'cost', 'mktVal', 'realized', 'unrealized', 'unrealizedCoupon', 'impliedLoss', 'totalPnl'].includes(sortConfig.key);
                result.sort((a, b) => {
                    let aVal = a[sortConfig.key];
                    let bVal = b[sortConfig.key];
                    
                    if (isHKDView && isMonetary) {
                        const rateA = globalFx[a.market] || a.fx_rate || 1;
                        const rateB = globalFx[b.market] || b.fx_rate || 1;
                        aVal = (typeof aVal === 'number' ? aVal : parseFloat(aVal) || 0) * rateA;
                        bVal = (typeof bVal === 'number' ? bVal : parseFloat(bVal) || 0) * rateB;
                    }
                    
                    const isAEmpty = aVal === null || aVal === undefined || aVal === '' || (typeof aVal === 'number' && Number.isNaN(aVal));
                    const isBEmpty = bVal === null || bVal === undefined || bVal === '' || (typeof bVal === 'number' && Number.isNaN(bVal));
                    
                    if (isAEmpty && isBEmpty) return 0;
                    if (isAEmpty) return 1; 
                    if (isBEmpty) return -1; 

                    if (typeof aVal === 'string' && typeof bVal === 'string') {
                        return sortConfig.dir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
                    }

                    if (aVal < bVal) return sortConfig.dir === 'asc' ? -1 : 1;
                    if (aVal > bVal) return sortConfig.dir === 'asc' ? 1 : -1;
                    return 0;
                });
            }

            return result;
        }, [data, sortConfig, filterConfig, isHKDView, globalFx]);
    };

    // --- 准备展平后的数据字典 ---
    const processedLiving = useMemo(() => {
        return livingRecords.map((mergedRecord) => {
            const inputData = replaceNullWithUndefined(mergedRecord.inputData);
            const outputData = replaceNullWithUndefined(mergedRecord.outputData);
            const res = outputData.result as FCNResult;
            const p = inputData.pricerParams as FCNParams;
            if (!res || !p) return null;
            
            const factor = Number(p.total_notional) / Number(p.denomination);
            const mktVal = res.dirty_price * factor;
            const realized = res.hist_coupons_paid * factor;
            const unrealizedCoupon = (res.pending_coupons_pv + res.future_coupons_pv) * factor;
            const impliedLoss = res.implied_loss_pv * factor;
            const unrealized = unrealizedCoupon - impliedLoss;
            const totalPnl = (res.dirty_price + res.hist_coupons_paid - Number(p.denomination)) * factor;
            
            const notional = Number(p.total_notional);
            const pnlRatio = notional ? ((mktVal + realized) / notional) - 1 : 0;
            const account = p.account_name || inputData.inputParams?.account_name || 'N/A';
            const expectedPeriods = calcExpectedCouponPeriods(res);

            return {
                id: mergedRecord.tradeId,
                p, res, factor,
                statusText: getStatusText(res.status),
                tradeDate: p.trade_date || '',
                name: renderName(p),
                account,
                market: p.market || 'HKD',
                notional,
                pnlRatio,
                coupon: p.coupon_rate,
                strikeStr: `${fmtPct(p.strike_pct)} / ${fmtPct(p.trigger_pct)}`,
                strike: p.strike_pct,
                nextObs: getNextObsDate(inputData.dateRows),
                maturity: inputData.dateRows[inputData.dateRows.length-1]?.payDate || '',
                earlyProb: res.early_redemption_prob,
                lossProb: res.loss_prob,
                expectedPeriods,
                mktVal, realized, unrealized, unrealizedCoupon, impliedLoss, totalPnl,
                fx_rate: p.fx_rate || 1,
                tooltipAutocall: `预期收息期数: ${expectedPeriods.toFixed(2)}`,
                tooltipKnockIn: getKnockInTooltip(p, res)
            };
        }).filter(Boolean) as any[];
    }, [livingRecords]);

    const processedRisk = useMemo(() => {
        const rows: any[] = [];
        livingRecords.forEach(mergedRecord => {
            const inputData = replaceNullWithUndefined(mergedRecord.inputData);
            const outputData = replaceNullWithUndefined(mergedRecord.outputData);
            const result = outputData.result as FCNResult;
            const params = inputData.pricerParams as FCNParams;
            if (!result || !params) return;
            
            if (result.status === 'Settling_Delivery' || (result.status === 'Active' && result.loss_prob > 0)) {
                const factor = Number(params.total_notional) / Number(params.denomination);
                const account = params.account_name || inputData.inputParams?.account_name || 'N/A';

                params.tickers.forEach((ticker, idx) => {
                    const initialP = params.initial_spots[idx];
                    const currentP = params.current_spots?.[idx] || initialP;
                    const strikePrice = initialP * params.strike_pct;
                    const exposureShares = (result.exposure_shares_avg[idx] || 0) * factor;
                    const exposureCost = strikePrice * exposureShares;
                    const exposureMktVal = currentP * exposureShares;
                    
                    if (exposureMktVal === 0) return;
                    
                    rows.push({
                        fcnName: renderName(params),
                        account,
                        ticker,
                        name: params.ticker_name?.[idx] || ticker,
                        costPrice: strikePrice,
                        shares: exposureShares,
                        cost: exposureCost,
                        mktVal: exposureMktVal,
                        pnlRatio: exposureCost > 0.0001 ? (exposureMktVal / exposureCost) - 1 : 0,
                        isWorst: result.loss_attribution[idx] === 1.0,
                        market: params.market,
                        fx_rate: params.fx_rate || 1
                    });
                });
            }
        });
        return rows;
    }, [livingRecords]);

    const processedDied = useMemo(() => {
        return diedRecords.map(mergedRecord => {
            const inputData = replaceNullWithUndefined(mergedRecord.inputData);
            const outputData = replaceNullWithUndefined(mergedRecord.outputData);
            const res = outputData.result as FCNResult;
            const p = inputData.pricerParams as FCNParams;
            if (!res || !p) return null;
            
            const factor = Number(p.total_notional) / Number(p.denomination);
            const realized = res.hist_coupons_paid * factor;
            const hasDelivery = res.status === 'Terminated_Delivery';
            const account = p.account_name || inputData.inputParams?.account_name || 'N/A';

            return {
                id: mergedRecord.tradeId,
                p, res, factor,
                statusText: getStatusText(res.status),
                tradeDate: p.trade_date || '',
                name: renderName(p),
                account,
                market: p.market || 'HKD',
                notional: Number(p.total_notional),
                coupon: p.coupon_rate,
                strikeStr: `${fmtPct(p.strike_pct)} / ${fmtPct(p.trigger_pct)}`,
                strike: p.strike_pct,
                realized,
                hasDeliveryText: hasDelivery ? '是' : '否',
                hasDelivery,
                tooltip: getDeliveryTooltip(p, res),
                fx_rate: p.fx_rate || 1
            };
        }).filter(Boolean) as any[];
    }, [diedRecords]);

    const finalLiving = useTableData(processedLiving, livingSort, livingFilters, isHKDView, globalFxRates);
    const finalRisk = useTableData(processedRisk, riskSort, riskFilters, isHKDView, globalFxRates);
    const finalDied = useTableData(processedDied, diedSort, diedFilters, isHKDView, globalFxRates);

    // --- 计算全局 SUM 与统计 ---
    const globalStats = useMemo(() => {
        const markets: Record<string, any> = {};

        const initMarket = (mkt: string) => {
            if (!markets[mkt]) {
                markets[mkt] = {
                    market: mkt,
                    notionalTotal: 0,
                    notionalLiving: 0,
                    mktValLiving: 0,
                    realizedTotal: 0,
                    unrealized: 0,
                    totalPnl: 0,
                    fxRate: 1
                };
            }
        };

        finalLiving.forEach(item => {
            const mkt = item.market || 'HKD';
            initMarket(mkt);
            const rate = globalFxRates[mkt] || item.fx_rate || 1;
            markets[mkt].fxRate = rate;
            markets[mkt].notionalLiving += (item.notional || 0) * rate;
            markets[mkt].notionalTotal += (item.notional || 0) * rate;
            markets[mkt].mktValLiving += (item.mktVal || 0) * rate;
            markets[mkt].realizedTotal += (item.realized || 0) * rate;
            markets[mkt].unrealized += (item.unrealized || 0) * rate;
        });

        finalDied.forEach(item => {
            const mkt = item.market || 'HKD';
            initMarket(mkt);
            const rate = globalFxRates[mkt] || item.fx_rate || 1;
            markets[mkt].fxRate = rate;
            markets[mkt].notionalTotal += (item.notional || 0) * rate;
            markets[mkt].realizedTotal += (item.realized || 0) * rate;
        });

        const marketList = Object.values(markets).map(m => {
            m.totalPnl = m.realizedTotal + m.unrealized;
            return m;
        });

        const hkdSum = marketList.reduce((acc, m) => {
            acc.notionalTotal += m.notionalTotal;
            acc.notionalLiving += m.notionalLiving;
            acc.mktValLiving += m.mktValLiving;
            acc.realizedTotal += m.realizedTotal;
            acc.unrealized += m.unrealized;
            acc.totalPnl += m.totalPnl;
            return acc;
        }, {
            notionalTotal: 0, notionalLiving: 0, mktValLiving: 0, realizedTotal: 0, unrealized: 0, totalPnl: 0
        });

        const livingSumsForTable = finalLiving.reduce((acc, item) => {
            const rate = globalFxRates[item.market] || item.fx_rate || 1;
            acc.notional += (item.notional || 0) * rate;
            acc.mktVal += (item.mktVal || 0) * rate;
            acc.realized += (item.realized || 0) * rate;
            acc.unrealized += (item.unrealized || 0) * rate;
            acc.unrealizedCoupon += (item.unrealizedCoupon || 0) * rate;
            acc.impliedLoss += (item.impliedLoss || 0) * rate;
            acc.totalPnl += (item.totalPnl || 0) * rate;
            return acc;
        }, { notional: 0, mktVal: 0, realized: 0, unrealized: 0, unrealizedCoupon: 0, impliedLoss: 0, totalPnl: 0 });

        const diedSumsForTable = finalDied.reduce((acc, item) => {
            const rate = globalFxRates[item.market] || item.fx_rate || 1;
            acc.notional += (item.notional || 0) * rate;
            acc.realized += (item.realized || 0) * rate;
            return acc;
        }, { notional: 0, realized: 0 });

        return {
            marketList,
            hkdSum,
            livingSums: livingSumsForTable,
            diedSums: diedSumsForTable,
        };
    }, [finalLiving, finalDied, globalFxRates]);

    const livingSumPnlRatio = globalStats.livingSums.notional > 0 ? ((globalStats.livingSums.mktVal + globalStats.livingSums.realized) / globalStats.livingSums.notional) - 1 : 0;

    const riskSums = useMemo(() => {
        return finalRisk.reduce((acc, item) => {
            const rate = globalFxRates[item.market] || item.fx_rate || 1;
            acc.cost += (item.cost || 0) * rate;
            acc.mktVal += (item.mktVal || 0) * rate;
            return acc;
        }, { cost: 0, mktVal: 0 });
    }, [finalRisk, globalFxRates]);
    const riskSumPnlRatio = riskSums.cost > 0 ? (riskSums.mktVal / riskSums.cost) - 1 : 0;

    // --- 资金净买入统计数据 (存续名义本金 - 累计已实现票息) ---
    const cashStats = useMemo(() => {
        const accountsSet = new Set<string>();
        const marketsSet = new Set<string>();

        processedLiving.forEach(item => {
            if (item.account) accountsSet.add(item.account);
            if (item.market) marketsSet.add(item.market);
        });
        processedDied.forEach(item => {
            if (item.account) accountsSet.add(item.account);
            if (item.market) marketsSet.add(item.market);
        });

        const accounts = Array.from(accountsSet).sort();
        const markets = Array.from(marketsSet).sort();

        const rawMatrix: Record<string, Record<string, number>> = {};
        markets.forEach(m => {
            rawMatrix[m] = {};
            accounts.forEach(a => rawMatrix[m][a] = 0);
        });

        // 加上：存续中的名义本金
        processedLiving.forEach(item => {
            if (item.market && item.account) {
                rawMatrix[item.market][item.account] += (item.notional || 0);
            }
        });

        // 减去：所有的累计已实现票息 (Living + Died)
        processedLiving.forEach(item => {
            if (item.market && item.account) {
                rawMatrix[item.market][item.account] -= (item.realized || 0);
            }
        });
        processedDied.forEach(item => {
            if (item.market && item.account) {
                rawMatrix[item.market][item.account] -= (item.realized || 0);
            }
        });

        return { accounts, markets, rawMatrix };
    }, [processedLiving, processedDied]);

    // 计算用于底部展示的全局 HKD 总合
    const totalCashNetBuyHKD = useMemo(() => {
        let total = 0;
        cashStats.markets.forEach(mkt => {
            const rate = globalFxRates[mkt] || 1;
            cashStats.accounts.forEach(acc => {
                total += (cashStats.rawMatrix[mkt][acc] || 0) * rate;
            });
        });
        return total;
    }, [cashStats, globalFxRates]);

    // --- FCN 统计入库逻辑 ---
    const handleSaveSum = async (isAuto = false) => {
        if (!user) return;
        try {
            if (!isAuto) setLoadingSum(true);
            const payload = replaceUndefinedWithNull({
                marketStats: globalStats.marketList,
                hkdSum: globalStats.hkdSum,
                updatedAt: new Date() // 使用絕對時間
            });

            await setDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'sip_holding_fcn_output_sum', 'latest_summary'), payload);
            
            if (!isAuto) alert("FCN 统计已成功覆盖更新至 sum 库！");
        } catch (e: any) {
            if (!isAuto) alert("保存 FCN 统计失败: " + e.message);
            console.error("Auto-save sum failed", e);
        } finally {
            if (!isAuto) setLoadingSum(false);
        }
    };

    // --- 资金净买入统计入库逻辑 ---
    const handleSaveCashStats = async () => {
        if (!user) return;
        try {
            const payload = {
                accounts: cashStats.accounts,
                markets: cashStats.markets,
                rawMatrix: cashStats.rawMatrix,
                updatedAt: new Date().toISOString()
            };
            await setDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'sip_holding_cash_fcn', 'latest_summary'), payload);
        } catch (e) {
            console.error("保存 FCN 资金净买入统计失败:", e);
        }
    };

    // 每分钟自动保存统计与资金净买入
    useEffect(() => {
        if (!user) return;
        const intervalId = setInterval(() => {
            handleSaveSum(true);
            handleSaveCashStats();
        }, 60000); 
        return () => clearInterval(intervalId);
    }, [user, globalStats, cashStats]); 

    return (
        <div className="space-y-8 pb-10">
            {/* === 全局 Header === */}
            <div className="border-b border-gray-200 pb-4 flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">FCN Holding (持仓与风控)</h1>
                    <p className="mt-1 text-sm text-gray-500">统一管理您的 FCN 存续与历史持仓，执行实时定价、状态流转与接货覆写。</p>
                </div>
                {/* 全局 HKD 切换按钮 */}
                <button 
                    onClick={handleToggleHKDView} 
                    disabled={isFetchingFx}
                    className={`px-5 py-2.5 text-sm font-bold rounded-lg border transition-all shadow-sm flex items-center gap-2 ${isHKDView ? 'bg-blue-600 text-white border-blue-600 shadow-blue-200' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}
                >
                    {isFetchingFx && <Loader2 size={16} className="animate-spin" />}
                    {isHKDView ? '已转为 HKD 全局计价' : '转化为 HKD (全局盯市)'}
                </button>
            </div>

            {/* === 模块 1：FCN 持仓板块（存续中） === */}
            <div className="bg-white shadow rounded-lg p-6 border border-gray-200">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                        <Database size={20} className="text-blue-600"/>
                        【FCN 持仓板块（存续中）】
                    </h2>
                    <div className="flex items-center gap-4">
                        <span className="text-sm text-gray-500">Living 库总计: {livingRecords.length} 笔</span>
                    </div>
                </div>
                
                <div className="overflow-x-auto border rounded-lg mb-4 shadow-sm pb-16">
                    <table className="min-w-full text-xs text-left divide-y divide-gray-200">
                        <thead className="bg-gray-50 text-gray-600 font-medium">
                            <tr>
                                <Th label="当前状态" sortKey="statusText" filterKey="statusText" currentSort={livingSort} onSort={toggleLivingSort} currentFilter={livingFilters} onFilter={updateLivingFilter} align="center" />
                                <Th label="交易日期" sortKey="tradeDate" filterKey="tradeDate" currentSort={livingSort} onSort={toggleLivingSort} currentFilter={livingFilters} onFilter={updateLivingFilter} align="center" />
                                <Th label="名称" sortKey="name" filterKey="name" currentSort={livingSort} onSort={toggleLivingSort} currentFilter={livingFilters} onFilter={updateLivingFilter} align="left" />
                                <Th label="账户" sortKey="account" filterKey="account" currentSort={livingSort} onSort={toggleLivingSort} currentFilter={livingFilters} onFilter={updateLivingFilter} align="center" />
                                <Th label="币种" sortKey="market" filterKey="market" currentSort={livingSort} onSort={toggleLivingSort} currentFilter={livingFilters} onFilter={updateLivingFilter} align="center" />
                                <Th label="总名义本金" sortKey="notional" filterKey={null} currentSort={livingSort} onSort={toggleLivingSort} currentFilter={livingFilters} onFilter={updateLivingFilter} align="right" />
                                <Th label="FCN盈亏比" sortKey="pnlRatio" filterKey={null} currentSort={livingSort} onSort={toggleLivingSort} currentFilter={livingFilters} onFilter={updateLivingFilter} align="right" />
                                <Th label="年化票息" sortKey="coupon" filterKey={null} currentSort={livingSort} onSort={toggleLivingSort} currentFilter={livingFilters} onFilter={updateLivingFilter} align="right" />
                                <Th label="敲入/出界限" sortKey="strike" filterKey={null} currentSort={livingSort} onSort={toggleLivingSort} currentFilter={livingFilters} onFilter={updateLivingFilter} align="right" />
                                <Th label="下一个观察日" sortKey="nextObs" filterKey="nextObs" currentSort={livingSort} onSort={toggleLivingSort} currentFilter={livingFilters} onFilter={updateLivingFilter} align="center" />
                                <Th label="最后结算日" sortKey="maturity" filterKey="maturity" currentSort={livingSort} onSort={toggleLivingSort} currentFilter={livingFilters} onFilter={updateLivingFilter} align="center" />
                                <Th label="点位图" sortKey={null} filterKey={null} align="center" />
                                <Th label="提前赎回概率" sortKey="earlyProb" filterKey={null} currentSort={livingSort} onSort={toggleLivingSort} currentFilter={livingFilters} onFilter={updateLivingFilter} align="right" />
                                <Th label="敲入接货概率" sortKey="lossProb" filterKey={null} currentSort={livingSort} onSort={toggleLivingSort} currentFilter={livingFilters} onFilter={updateLivingFilter} align="right" />
                                <Th label="当前市值" sortKey="mktVal" filterKey={null} currentSort={livingSort} onSort={toggleLivingSort} currentFilter={livingFilters} onFilter={updateLivingFilter} align="right" />
                                <Th label="已实现票息" sortKey="realized" filterKey={null} currentSort={livingSort} onSort={toggleLivingSort} currentFilter={livingFilters} onFilter={updateLivingFilter} align="right" />
                                <Th label="未实现损益" sortKey="unrealized" filterKey={null} currentSort={livingSort} onSort={toggleLivingSort} currentFilter={livingFilters} onFilter={updateLivingFilter} align="right" />
                                <Th label="未实现票息" sortKey="unrealizedCoupon" filterKey={null} currentSort={livingSort} onSort={toggleLivingSort} currentFilter={livingFilters} onFilter={updateLivingFilter} align="right" />
                                <Th label="预计接货损失" sortKey="impliedLoss" filterKey={null} currentSort={livingSort} onSort={toggleLivingSort} currentFilter={livingFilters} onFilter={updateLivingFilter} align="right" />
                                <Th label="累计总损益" sortKey="totalPnl" filterKey={null} currentSort={livingSort} onSort={toggleLivingSort} currentFilter={livingFilters} onFilter={updateLivingFilter} align="right" />
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 bg-white">
                            {finalLiving.length === 0 ? (
                                <tr><td colSpan={20} className="px-4 py-8 text-center text-gray-400">暂无存续中的持仓数据 或 暂无匹配条件数据</td></tr>
                            ) : finalLiving.map((item) => (
                                <tr key={item.id} className="hover:bg-blue-50/50 transition-colors">
                                    <td className="px-3 py-2 text-center whitespace-nowrap font-bold text-gray-700">{item.statusText}</td>
                                    <td className="px-3 py-2 text-center text-gray-600 whitespace-nowrap">{item.tradeDate}</td>
                                    <td className="px-3 py-2 font-medium text-gray-800 whitespace-nowrap">{item.name}</td>
                                    <td className="px-3 py-2 text-center text-gray-600 whitespace-nowrap">{item.account}</td>
                                    <td className="px-3 py-2 text-center font-mono text-gray-500">{item.market}</td>
                                    <td className="px-3 py-2 text-right font-mono whitespace-nowrap">{formatNotionalWithUnit(item.notional, item.market, item.fx_rate)}</td>
                                    <td className={`px-3 py-2 text-right font-mono font-bold ${item.pnlRatio >= 0 ? 'text-green-600' : 'text-red-600'}`}>{item.pnlRatio > 0 ? '+' : ''}{fmtPct(item.pnlRatio)}</td>
                                    <td className="px-3 py-2 text-right font-mono whitespace-nowrap">{fmtPct(item.coupon)}</td>
                                    <td className="px-3 py-2 text-right font-mono text-gray-500 whitespace-nowrap">{item.strikeStr}</td>
                                    <td className="px-3 py-2 text-center text-gray-600 whitespace-nowrap">{item.nextObs}</td>
                                    <td className="px-3 py-2 text-center text-gray-600 whitespace-nowrap">{item.maturity}</td>
                                    <td className="px-3 py-2 text-center">
                                        <button onClick={() => {
                                            const p = item.p as FCNParams;
                                            // 【安全校驗】：防止舊數據或髒數據導致 Modal 崩潰
                                            if (!p || !p.tickers || !p.initial_spots) {
                                                alert("數據格式不完整或為舊版數據，無法繪製點位圖。");
                                                return;
                                            }
                                            const charts = p.tickers.map((ticker: string, idx: number) => {
                                                const initial = p.initial_spots[idx] || 0;
                                                const current = p.current_spots?.[idx] || initial;
                                                const strike = initial * (Number(p.strike_pct) || 0);
                                                const ko = initial * (Number(p.trigger_pct) || 0);
                                                return {
                                                    name: p.ticker_name?.[idx] || ticker,
                                                    ticker,
                                                    current,
                                                    strike,
                                                    ko
                                                };
                                            });
                                            setChartModalData({
                                                title: item.name,
                                                charts
                                            });
                                        }} className="text-blue-500 hover:text-blue-700 bg-blue-50 p-1 rounded transition-colors" title="查看点位图">
                                            <LineChart size={16}/>
                                        </button>
                                    </td>
                                    <td className="px-3 py-2 text-right font-mono text-green-700 underline decoration-dotted cursor-help" title={item.tooltipAutocall}>{fmtPct(item.earlyProb)}</td>
                                    <td className="px-3 py-2 text-right font-mono text-red-600 underline decoration-dotted cursor-help" title={item.tooltipKnockIn}>{fmtPct(item.lossProb)}</td>
                                    <td className="px-3 py-2 text-right font-mono font-medium">{formatMoneyWithUnit(item.mktVal, item.market, item.fx_rate)}</td>
                                    <td className="px-3 py-2 text-right font-mono text-gray-600">{formatMoneyWithUnit(item.realized, item.market, item.fx_rate)}</td>
                                    <td className={`px-3 py-2 text-right font-mono font-medium ${item.unrealized >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                        {item.unrealized > 0 ? '+' : ''}{formatMoneyWithUnit(item.unrealized, item.market, item.fx_rate)}
                                    </td>
                                    <td className={`px-3 py-2 text-right font-mono ${item.unrealizedCoupon > 0 ? 'text-green-600' : 'text-gray-500'}`}>
                                        {item.unrealizedCoupon > 0 ? '+' : ''}{formatMoneyWithUnit(item.unrealizedCoupon, item.market, item.fx_rate)}
                                    </td>
                                    <td className={`px-3 py-2 text-right font-mono ${item.impliedLoss > 0 ? 'text-red-600' : 'text-gray-500'}`}>
                                        {item.impliedLoss > 0 ? '-' : ''}{formatMoneyWithUnit(item.impliedLoss, item.market, item.fx_rate)}
                                    </td>
                                    <td className={`px-3 py-2 text-right font-mono font-bold ${item.totalPnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                        {item.totalPnl > 0 ? '+' : ''}{formatMoneyWithUnit(item.totalPnl, item.market, item.fx_rate)}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                        {finalLiving.length > 0 && (
                            <tfoot className="bg-gray-100 border-t-2 border-gray-300 shadow-inner">
                                <tr>
                                    <td colSpan={5} className="px-3 py-3 text-center font-bold text-gray-700 tracking-wider">SUM (折合 HKD)</td>
                                    <td className="px-3 py-3 text-right font-mono font-bold text-gray-800">{formatSum(globalStats.livingSums.notional)}</td>
                                    <td className={`px-3 py-3 text-right font-mono font-bold ${livingSumPnlRatio >= 0 ? 'text-green-600' : 'text-red-600'}`}>{livingSumPnlRatio > 0 ? '+' : ''}{fmtPct(livingSumPnlRatio)}</td>
                                    <td colSpan={7}></td>
                                    <td className="px-3 py-3 text-right font-mono font-bold text-gray-800">{formatSum(globalStats.livingSums.mktVal)}</td>
                                    <td className="px-3 py-3 text-right font-mono font-bold text-gray-800">{formatSum(globalStats.livingSums.realized)}</td>
                                    <td className={`px-3 py-3 text-right font-mono font-bold ${globalStats.livingSums.unrealized >= 0 ? 'text-green-600' : 'text-red-600'}`}>{formatSumWithSign(globalStats.livingSums.unrealized)}</td>
                                    <td className={`px-3 py-3 text-right font-mono font-bold ${globalStats.livingSums.unrealizedCoupon > 0 ? 'text-green-600' : 'text-gray-500'}`}>{formatSumWithSign(globalStats.livingSums.unrealizedCoupon)}</td>
                                    <td className={`px-3 py-3 text-right font-mono font-bold ${globalStats.livingSums.impliedLoss > 0 ? 'text-red-600' : 'text-gray-500'}`}>{globalStats.livingSums.impliedLoss > 0 ? '-' : ''}{formatSum(globalStats.livingSums.impliedLoss)}</td>
                                    <td className={`px-3 py-3 text-right font-mono font-bold ${globalStats.livingSums.totalPnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>{formatSumWithSign(globalStats.livingSums.totalPnl)}</td>
                                </tr>
                            </tfoot>
                        )}
                    </table>
                </div>

                <button
                    onClick={handleRefreshLiving}
                    disabled={loadingLiving}
                    className={`w-full py-3 px-4 rounded-md text-white font-bold transition-all shadow-md flex justify-center items-center gap-2 ${loadingLiving ? 'bg-blue-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'}`}
                >
                    {loadingLiving ? <Loader2 className="animate-spin" size={18} /> : <RefreshCw size={18} />}
                    {loadingLiving ? '重新计算并流转数据...' : '刷新当前持仓 (重新定价与生命周期流转)'}
                </button>
            </div>

            {/* === 模块 2：FCN风控板块 === */}
            <div className="bg-white shadow rounded-lg p-6 border border-gray-200">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                        <TrendingUp size={20} className="text-red-600"/>
                        【FCN 风控板块】
                    </h2>
                    <div className="flex items-center gap-4">
                        <span className="text-sm text-gray-500">高风险标的: {finalRisk.length} 项</span>
                    </div>
                </div>

                <div className="overflow-x-auto border rounded-lg shadow-sm pb-16">
                    <table className="min-w-full text-xs text-left divide-y divide-gray-200">
                        <thead className="bg-red-50 text-red-800 font-medium">
                            <tr>
                                <Th label="标的代码 (Ticker)" filterKey="ticker" currentSort={riskSort} onSort={toggleRiskSort} currentFilter={riskFilters} onFilter={updateRiskFilter} align="left" />
                                <Th label="FCN 产品名称" filterKey="fcnName" currentSort={riskSort} onSort={toggleRiskSort} currentFilter={riskFilters} onFilter={updateRiskFilter} align="left" />
                                <Th label="账户" sortKey="account" filterKey="account" currentSort={riskSort} onSort={toggleRiskSort} currentFilter={riskFilters} onFilter={updateRiskFilter} align="center" />
                                <Th label="暴露成本价" sortKey="costPrice" currentSort={riskSort} onSort={toggleRiskSort} currentFilter={riskFilters} onFilter={updateRiskFilter} align="right" />
                                <Th label="暴露股数" sortKey="shares" currentSort={riskSort} onSort={toggleRiskSort} currentFilter={riskFilters} onFilter={updateRiskFilter} align="right" />
                                <Th label="暴露成本总额" sortKey="cost" currentSort={riskSort} onSort={toggleRiskSort} currentFilter={riskFilters} onFilter={updateRiskFilter} align="right" />
                                <Th label="暴露当前市值" sortKey="mktVal" currentSort={riskSort} onSort={toggleRiskSort} currentFilter={riskFilters} onFilter={updateRiskFilter} align="right" />
                                <Th label="暴露盈亏比" sortKey="pnlRatio" currentSort={riskSort} onSort={toggleRiskSort} currentFilter={riskFilters} onFilter={updateRiskFilter} align="right" />
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 bg-white">
                            {finalRisk.length === 0 ? (
                                <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">当前没有处于高接货风险或结算有接货的持仓</td></tr>
                            ) : finalRisk.map((row, idx) => (
                                <tr key={`${row.ticker}-${idx}`} className={`transition-colors ${row.isWorst ? 'bg-red-50/50 font-medium' : 'hover:bg-gray-50'}`}>
                                    <td className="px-3 py-2 text-gray-900 whitespace-nowrap">{row.ticker} <span className="text-gray-400 text-[10px] ml-1">{row.name}</span></td>
                                    <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{row.fcnName}</td>
                                    <td className="px-3 py-2 text-center text-gray-600 whitespace-nowrap">{row.account}</td>
                                    <td className="px-3 py-2 text-right font-mono text-gray-600">{row.costPrice.toFixed(2)}</td>
                                    <td className="px-3 py-2 text-right font-mono text-gray-900">
                                        {row.shares.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                                    </td>
                                    <td className="px-3 py-2 text-right font-mono text-gray-700">{formatMoneyWithUnit(row.cost, row.market, row.fx_rate)}</td>
                                    <td className="px-3 py-2 text-right font-mono text-gray-900">{formatMoneyWithUnit(row.mktVal, row.market, row.fx_rate)}</td>
                                    <td className={`px-3 py-2 text-right font-mono font-bold ${row.pnlRatio >= 0 ? 'text-green-600' : 'text-red-600'}`}>{fmtPct(row.pnlRatio)}</td>
                                </tr>
                            ))}
                        </tbody>
                        {finalRisk.length > 0 && (
                            <tfoot className="bg-red-50 border-t-2 border-red-200 shadow-inner">
                                <tr>
                                    <td colSpan={5} className="px-3 py-3 text-center font-bold text-red-800 tracking-wider">SUM (折合 HKD)</td>
                                    <td className="px-3 py-3 text-right font-mono font-bold text-red-900">{formatSum(riskSums.cost)}</td>
                                    <td className="px-3 py-3 text-right font-mono font-bold text-red-900">{formatSum(riskSums.mktVal)}</td>
                                    <td className={`px-3 py-3 text-right font-mono font-bold ${riskSumPnlRatio >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                        {riskSumPnlRatio > 0 ? '+' : ''}{fmtPct(riskSumPnlRatio)}
                                    </td>
                                </tr>
                            </tfoot>
                        )}
                    </table>
                </div>
            </div>

            {/* === 模块 3：FCN 持仓板块（历史） === */}
            <div className="bg-white shadow rounded-lg p-6 border border-gray-200">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                        <Database size={20} className="text-orange-600"/>
                        【FCN 持仓板块（历史）】
                    </h2>
                    <div className="flex items-center gap-4">
                        <span className="text-sm text-gray-500">Died 库总计: {diedRecords.length} 笔</span>
                    </div>
                </div>
                
                <div className="overflow-x-auto border rounded-lg mb-4 shadow-sm pb-16">
                    <table className="min-w-full text-xs text-left divide-y divide-gray-200">
                        <thead className="bg-gray-50 text-gray-600 font-medium">
                            <tr>
                                <Th label="当前状态" sortKey="statusText" filterKey="statusText" currentSort={diedSort} onSort={toggleDiedSort} currentFilter={diedFilters} onFilter={updateDiedFilter} align="center" />
                                <Th label="交易日期" sortKey="tradeDate" filterKey="tradeDate" currentSort={diedSort} onSort={toggleDiedSort} currentFilter={diedFilters} onFilter={updateDiedFilter} align="center" />
                                <Th label="名称" sortKey="name" filterKey="name" currentSort={diedSort} onSort={toggleDiedSort} currentFilter={diedFilters} onFilter={updateDiedFilter} align="left" />
                                <Th label="账户" sortKey="account" filterKey="account" currentSort={diedSort} onSort={toggleDiedSort} currentFilter={diedFilters} onFilter={updateDiedFilter} align="center" />
                                <Th label="币种" sortKey="market" filterKey="market" currentSort={diedSort} onSort={toggleDiedSort} currentFilter={diedFilters} onFilter={updateDiedFilter} align="center" />
                                <Th label="总名义本金" sortKey="notional" filterKey={null} currentSort={diedSort} onSort={toggleDiedSort} currentFilter={diedFilters} onFilter={updateDiedFilter} align="right" />
                                <Th label="年化票息" sortKey="coupon" filterKey={null} currentSort={diedSort} onSort={toggleDiedSort} currentFilter={diedFilters} onFilter={updateDiedFilter} align="right" />
                                <Th label="敲入/出界限" sortKey="strike" filterKey={null} currentSort={diedSort} onSort={toggleDiedSort} currentFilter={diedFilters} onFilter={updateDiedFilter} align="right" />
                                <Th label="已实现票息" sortKey="realized" filterKey={null} currentSort={diedSort} onSort={toggleDiedSort} currentFilter={diedFilters} onFilter={updateDiedFilter} align="right" />
                                <Th label="是否有接货" sortKey="hasDeliveryText" filterKey="hasDeliveryText" currentSort={diedSort} onSort={toggleDiedSort} currentFilter={diedFilters} onFilter={updateDiedFilter} align="center" />
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 bg-white">
                            {finalDied.length === 0 ? (
                                <tr><td colSpan={10} className="px-4 py-8 text-center text-gray-400">暂无历史持仓数据 或 暂无匹配条件数据</td></tr>
                            ) : finalDied.map((item) => (
                                <tr key={item.id} className="hover:bg-orange-50/50 transition-colors">
                                    <td className="px-3 py-2 text-center whitespace-nowrap font-bold text-gray-700">{item.statusText}</td>
                                    <td className="px-3 py-2 text-center text-gray-600 whitespace-nowrap">{item.tradeDate}</td>
                                    <td className="px-3 py-2 font-medium text-gray-600 whitespace-nowrap">{item.name}</td>
                                    <td className="px-3 py-2 text-center text-gray-600 whitespace-nowrap">{item.account}</td>
                                    <td className="px-3 py-2 text-center font-mono text-gray-500">{item.market}</td>
                                    <td className="px-3 py-2 text-right font-mono text-gray-800">{formatNotionalWithUnit(item.notional, item.market, item.fx_rate)}</td>
                                    <td className="px-3 py-2 text-right font-mono text-gray-600">{fmtPct(item.coupon)}</td>
                                    <td className="px-3 py-2 text-right font-mono text-gray-500 whitespace-nowrap">{item.strikeStr}</td>
                                    <td className="px-3 py-2 text-right font-mono text-gray-800">{formatMoneyWithUnit(item.realized, item.market, item.fx_rate)}</td>
                                    <td className="px-3 py-2 text-center text-gray-800">
                                        {item.hasDelivery ? (
                                            <span className="px-2 py-0.5 bg-orange-100 text-orange-800 rounded font-bold underline decoration-dotted cursor-help" title={item.tooltip}>是</span>
                                        ) : (
                                            <span className="text-gray-400">否</span>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                        {finalDied.length > 0 && (
                            <tfoot className="bg-gray-100 border-t-2 border-gray-300 shadow-inner">
                                <tr>
                                    <td colSpan={5} className="px-3 py-3 text-center font-bold text-gray-700 tracking-wider">SUM (折合 HKD)</td>
                                    <td className="px-3 py-3 text-right font-mono font-bold text-gray-800">{formatSum(globalStats.diedSums.notional)}</td>
                                    <td colSpan={2}></td>
                                    <td className="px-3 py-3 text-right font-mono font-bold text-gray-800">{formatSum(globalStats.diedSums.realized)}</td>
                                    <td></td>
                                </tr>
                            </tfoot>
                        )}
                    </table>
                </div>

                <button
                    onClick={handleRefreshDied}
                    disabled={loadingDied}
                    className={`w-full py-3 px-4 rounded-md text-white font-bold transition-all shadow-md flex justify-center items-center gap-2 ${loadingDied ? 'bg-orange-400 cursor-not-allowed' : 'bg-orange-600 hover:bg-orange-700'}`}
                >
                    {loadingDied ? <Loader2 className="animate-spin" size={18} /> : <RefreshCw size={18} />}
                    {loadingDied ? '重新计算校验中...' : '刷新历史持仓 (校验状态准确性)'}
                </button>
            </div>

            {/* === 模块 4：FCN 统计 === */}
            <div className="bg-white shadow rounded-lg p-6 border border-gray-200">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                        <PieChart size={20} className="text-indigo-600"/>
                        【FCN 统计】
                        <span className="text-sm font-normal text-gray-500 ml-2">全局数据统一折合为 HKD</span>
                    </h2>
                    <span className="text-xs text-gray-400">数据每分钟自动刷新存库</span>
                </div>
                
                <div className="overflow-x-auto border rounded-lg mb-6 shadow-sm">
                    <table className="min-w-full text-sm text-left divide-y divide-gray-200">
                        <thead className="bg-indigo-50 text-indigo-900 font-medium">
                            <tr>
                                <th className="px-3 py-2 text-center whitespace-nowrap">市场(币种)</th>
                                <th className="px-3 py-2 text-right whitespace-nowrap">总名义本金(含历史) HKD</th>
                                <th className="px-3 py-2 text-right whitespace-nowrap">总名义本金(存续中) HKD</th>
                                <th className="px-3 py-2 text-right whitespace-nowrap">总市值(存续中) HKD</th>
                                <th className="px-3 py-2 text-right whitespace-nowrap">已实现票息(含历史) HKD</th>
                                <th className="px-3 py-2 text-right whitespace-nowrap">未实现损益 HKD</th>
                                <th className="px-3 py-2 text-right whitespace-nowrap">总损益 HKD</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 bg-white">
                            {globalStats.marketList.length === 0 ? (
                                <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">暂无统计数据</td></tr>
                            ) : globalStats.marketList.map((m: any) => (
                                <tr key={m.market} className="hover:bg-indigo-50/30">
                                    <td className="px-3 py-2 text-center font-bold text-gray-700">{m.market}</td>
                                    <td className="px-3 py-2 text-right font-mono text-gray-800">{m.notionalTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                    <td className="px-3 py-2 text-right font-mono text-gray-800">{m.notionalLiving.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                    <td className="px-3 py-2 text-right font-mono text-gray-800">{m.mktValLiving.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                    <td className="px-3 py-2 text-right font-mono text-gray-800">{m.realizedTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                    <td className={`px-3 py-2 text-right font-mono font-medium ${m.unrealized >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                        {m.unrealized > 0 ? '+' : ''}{m.unrealized.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </td>
                                    <td className={`px-3 py-2 text-right font-mono font-bold ${m.totalPnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                        {m.totalPnl > 0 ? '+' : ''}{m.totalPnl.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                        {globalStats.marketList.length > 0 && (
                            <tfoot className="bg-indigo-100 border-t-2 border-indigo-200 shadow-inner">
                                <tr>
                                    <td className="px-3 py-3 text-center font-bold text-indigo-900 tracking-wider">全局大盘 SUM</td>
                                    <td className="px-3 py-3 text-right font-mono font-bold text-indigo-900">{formatSum(globalStats.hkdSum.notionalTotal)}</td>
                                    <td className="px-3 py-3 text-right font-mono font-bold text-indigo-900">{formatSum(globalStats.hkdSum.notionalLiving)}</td>
                                    <td className="px-3 py-3 text-right font-mono font-bold text-indigo-900">{formatSum(globalStats.hkdSum.mktValLiving)}</td>
                                    <td className="px-3 py-3 text-right font-mono font-bold text-indigo-900">{formatSum(globalStats.hkdSum.realizedTotal)}</td>
                                    <td className={`px-3 py-3 text-right font-mono font-bold ${globalStats.hkdSum.unrealized >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                        {formatSumWithSign(globalStats.hkdSum.unrealized)}
                                    </td>
                                    <td className={`px-3 py-3 text-right font-mono font-bold ${globalStats.hkdSum.totalPnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                        {formatSumWithSign(globalStats.hkdSum.totalPnl)}
                                    </td>
                                </tr>
                            </tfoot>
                        )}
                    </table>
                </div>

                <div className="flex justify-end">
                    <button
                        onClick={() => handleSaveSum(false)}
                        disabled={loadingSum}
                        className={`py-2 px-6 rounded-md text-white font-bold transition-all shadow-md flex justify-center items-center gap-2 ${loadingSum ? 'bg-indigo-400 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700'}`}
                    >
                        {loadingSum ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
                        {loadingSum ? '正在保存统计...' : '手动更新至 Sum 库'}
                    </button>
                </div>
            </div>

            {/* === 模块 5：资金净买入统计表 (資金浄買入統計表) === */}
            <div className="bg-white shadow rounded-lg p-6 border border-gray-200 mt-8">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                        <Database size={20} className="text-teal-600"/>
                        【资金净买入统计表】
                        <span className="text-sm font-normal text-gray-500 ml-2">存续中名义本金 - 累计已实现票息</span>
                    </h2>
                    <div className="flex items-center gap-4">
                        <span className="text-xs text-gray-400">数据每分钟自动存入 sip_holding_cash_fcn 库</span>
                    </div>
                </div>

                <div className="bg-teal-50 border-t border-teal-100 p-5 rounded-lg">
                    <div className="flex justify-between items-center mb-3">
                        <h3 className="font-bold text-teal-800 text-sm">资金净买入矩阵</h3>
                        <button 
                            onClick={handleToggleHKDView}
                            disabled={isFetchingFx}
                            className={`text-xs font-bold px-3 py-1.5 rounded transition-colors border ${isHKDView ? 'bg-teal-600 text-white border-teal-600 shadow-inner' : 'bg-white text-teal-700 border-teal-200 hover:bg-teal-100 shadow-sm'}`}
                        >
                            {isFetchingFx && <Loader2 size={12} className="animate-spin inline mr-1" />}
                            {isHKDView ? '恢复原始币种' : 'TO HKD (一键折算)'}
                        </button>
                    </div>
                    <div className="overflow-x-auto rounded border border-teal-200 bg-white">
                        <table className="min-w-full text-xs text-right">
                            <thead className="bg-teal-100/50 text-teal-900 font-medium">
                                <tr>
                                    <th className="px-3 py-2 text-center border-b border-r border-teal-100 bg-teal-50/50">币种 \ 账户</th>
                                    {cashStats.accounts.map(acc => (
                                        <th key={acc} className="px-3 py-2 border-b border-teal-100">{acc}</th>
                                    ))}
                                    <th className="px-3 py-2 border-b border-l border-teal-100 bg-teal-50/50">SUM (HKD)</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-teal-50">
                                {cashStats.markets.map(mkt => {
                                    const rate = isHKDView ? (globalFxRates[mkt] || 1) : 1;
                                    const actualRate = globalFxRates[mkt] || 1;
                                    let rawRowSum = 0;
                                    return (
                                        <tr key={mkt} className="hover:bg-teal-50/30">
                                            <td className="px-3 py-2 text-center font-bold text-gray-700 border-r border-teal-50 bg-teal-50/20">{mkt}</td>
                                            {cashStats.accounts.map(acc => {
                                                const rawVal = cashStats.rawMatrix[mkt][acc] || 0;
                                                rawRowSum += rawVal;
                                                const displayVal = rawVal * rate;
                                                return (
                                                    <td key={acc} className={`px-3 py-2 font-mono ${displayVal > 0 ? 'text-red-600' : displayVal < 0 ? 'text-green-600' : 'text-gray-400'}`}>
                                                        {displayVal > 0 ? '+' : ''}{displayVal === 0 ? '-' : formatMoney(displayVal, isHKDView)}
                                                    </td>
                                                );
                                            })}
                                            <td className={`px-3 py-2 font-mono font-bold border-l border-teal-50 bg-teal-50/20 ${rawRowSum * actualRate > 0 ? 'text-red-600' : rawRowSum * actualRate < 0 ? 'text-green-600' : 'text-gray-500'}`}>
                                                {rawRowSum * actualRate > 0 ? '+' : ''}{rawRowSum === 0 ? '-' : formatMoney(rawRowSum * actualRate, true)}
                                            </td>
                                        </tr>
                                    );
                                })}
                                {cashStats.markets.length === 0 && (
                                    <tr><td colSpan={cashStats.accounts.length + 2} className="px-3 py-4 text-center text-gray-400">暂无数据</td></tr>
                                )}
                            </tbody>
                            {cashStats.markets.length > 0 && (
                                <tfoot className="bg-teal-100 text-teal-900 border-t-2 border-teal-200 shadow-inner">
                                    <tr>
                                        <td className="px-3 py-3 text-center font-bold border-r border-teal-200">SUM (HKD)</td>
                                        {cashStats.accounts.map(acc => {
                                            let colSumHKD = 0;
                                            cashStats.markets.forEach(mkt => {
                                                const rawVal = cashStats.rawMatrix[mkt][acc] || 0;
                                                colSumHKD += rawVal * (globalFxRates[mkt] || 1);
                                            });
                                            return (
                                                <td key={acc} className={`px-3 py-3 font-mono font-bold ${colSumHKD > 0 ? 'text-red-600' : colSumHKD < 0 ? 'text-green-600' : 'text-teal-900'}`}>
                                                    {colSumHKD > 0 ? '+' : ''}{colSumHKD === 0 ? '-' : formatMoney(colSumHKD, true)}
                                                </td>
                                            );
                                        })}
                                        <td className={`px-3 py-3 font-mono font-bold text-sm border-l border-teal-200 ${totalCashNetBuyHKD > 0 ? 'text-red-600' : totalCashNetBuyHKD < 0 ? 'text-green-600' : 'text-teal-900'}`}>
                                            {totalCashNetBuyHKD > 0 ? '+' : ''}{formatMoney(totalCashNetBuyHKD, true)} HKD
                                        </td>
                                    </tr>
                                </tfoot>
                            )}
                        </table>
                    </div>
                </div>
            </div>

            {/* === 模块 6：后台库管理模块 === */}
            <div className="bg-white shadow rounded-lg p-6 border border-gray-200 mt-8">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                        <FileJson size={20} className="text-purple-600"/> 【后台库管理模块】
                    </h2>
                    <button onClick={() => fetchDbRecords(activeDbTab)} className="text-sm text-purple-600 hover:text-purple-800 flex items-center gap-1">
                        <RefreshCw size={14}/> 刷新数据
                    </button>
                </div>

                <div className="flex gap-2 mb-4 border-b pb-2 overflow-x-auto">
                    {[
                        'sip_trade_fcn_input_living',
                        'sip_holding_fcn_output_living', 
                        'sip_trade_fcn_input_died',
                        'sip_holding_fcn_output_died', 
                        'sip_trade_fcn_pending_delivery',
                        'sip_holding_fcn_output_get-stock',
                        'sip_holding_fcn_output_sum'
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
                    <div className="py-10 text-center"><Loader2 className="animate-spin mx-auto text-purple-600" size={30}/></div>
                ) : dbRecords.length === 0 ? (
                    <div className="py-10 text-center text-gray-400 bg-gray-50 rounded border border-dashed">该库中暂无数据</div>
                ) : (
                    <div className="overflow-x-auto border rounded">
                        <table className="min-w-full text-sm text-left divide-y divide-gray-200">
                            <thead className="bg-gray-50 text-gray-500">
                                <tr>
                                    <th className="px-3 py-2 whitespace-nowrap">ID / 确切修改时间</th>
                                    <th className="px-3 py-2">绑定 TradeID</th>
                                    <th className="px-3 py-2">内容摘要 / 产品名称</th>
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
                                        <td className="px-3 py-2 text-xs font-mono text-blue-600">
                                            {r.tradeId || 'None'}
                                        </td>
                                        <td className="px-3 py-2 text-xs">
                                            <div className="max-w-md xl:max-w-2xl truncate text-gray-700 bg-blue-50/50 px-2 py-1.5 rounded border border-blue-100 font-medium">
                                                {getRecordSummary(r, activeDbTab)}
                                            </div>
                                        </td>
                                        <td className="px-3 py-2 text-center whitespace-nowrap">
                                            <button 
                                                onClick={() => setEditRecordModal({show: true, record: r, rawJson: JSON.stringify(r, null, 4)})} 
                                                className="text-blue-600 hover:text-blue-800 mx-1 p-1 hover:bg-blue-50 rounded transition-colors"
                                                title="修改 JSON"
                                            >
                                                <FileJson size={16}/>
                                            </button>
                                            <button 
                                                onClick={() => handleDeleteRecord(r.id)} 
                                                className="text-red-600 hover:text-red-800 mx-1 p-1 hover:bg-red-50 rounded transition-colors"
                                                title="永久删除"
                                            >
                                                <Trash2 size={16}/>
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* --- Modals --- */}
            {/* 股价点位图 Modal */}
            {chartModalData && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col relative overflow-hidden">
                        <div className="px-6 py-4 border-b flex justify-between items-center bg-gray-50 flex-shrink-0">
                            <div>
                                <h3 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                                    <LineChart className="text-blue-500" size={24} />
                                    股價點位圖
                                </h3>
                                <p className="text-xs text-gray-500 mt-1">{chartModalData.title}</p>
                            </div>
                            <button onClick={() => setChartModalData(null)} className="text-gray-400 hover:text-gray-600 bg-white p-1 rounded-full shadow-sm border transition-colors"><X size={24}/></button>
                        </div>
                        <div className="p-6 overflow-y-auto flex-1 bg-white space-y-6">
                            {chartModalData.charts.map((data, idx) => {
                                const { current, strike, ko, ticker, name } = data;
                                const leftPct = current > 0 ? (strike / current) - 1 : 0;
                                const rightPct = current > 0 ? (ko / current) - 1 : 0;

                                const values = [strike, current, ko];
                                const minVal = Math.min(...values) * 0.85;
                                const maxVal = Math.max(...values) * 1.15;
                                const range = maxVal - minVal;

                                const getPos = (val: number) => range === 0 ? 50 : ((val - minVal) / range) * 100;

                                return (
                                    <div key={ticker} className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm">
                                        <div className="flex justify-between items-end mb-4">
                                            <div>
                                                <span className="text-lg font-bold text-gray-800 mr-2">{name}</span>
                                                <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">{ticker}</span>
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
                                                {/* 標記 Strike 到 KO 之間的區間 */}
                                                <div className="absolute top-1/2 h-1.5 bg-blue-50 transform -translate-y-1/2" style={{ left: `${getPos(Math.min(strike, ko))}%`, width: `${Math.abs(getPos(ko) - getPos(strike))}%` }}></div>
                                                
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
                </div>
            )}

            {/* 修改 Raw JSON 弹窗 */}
            {editRecordModal && (
                <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
                    <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-5xl flex flex-col h-[85vh] max-h-[90vh]">
                        <div className="flex justify-between items-center mb-4 border-b pb-4">
                            <h3 className="font-bold text-lg flex items-center gap-2 text-purple-700">
                                <FileJson size={20}/> 
                                进阶修改记录 - {editRecordModal?.record?.id}
                            </h3>
                            <button onClick={() => setEditRecordModal(null)} className="text-gray-400 hover:text-gray-600"><X size={20}/></button>
                        </div>
                        <p className="text-xs text-gray-500 mb-2 border-l-2 border-orange-400 pl-2">
                            警告：直接修改 Raw JSON 属于高阶操作，请确保 JSON 格式合法且结构正确，否则可能会导致页面崩溃或逻辑错误。
                        </p>
                        
                        <textarea 
                            className="flex-1 w-full border border-gray-300 rounded-md p-3 text-xs font-mono mb-4 focus:ring-2 focus:ring-purple-500 outline-none resize-none" 
                            value={editRecordModal?.rawJson || ''}
                            onChange={(e) => setEditRecordModal(prev => prev ? {...prev, rawJson: e.target.value} : null)}
                        />
                        
                        <div className="flex justify-end gap-3 pt-2 border-t">
                            <button onClick={() => setEditRecordModal(null)} className="px-5 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-md text-sm font-medium transition-colors">取消</button>
                            <button onClick={handleSaveRecordEdit} className="px-5 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-md text-sm font-bold flex items-center gap-2 transition-colors">
                                <Save size={16}/> 保存强制覆盖
                            </button>
                        </div>
                    </div>
                </div>
            )}

        </div>
    );
}