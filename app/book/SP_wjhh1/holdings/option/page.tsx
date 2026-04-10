'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  RefreshCw, 
  Database, 
  FileJson, 
  Trash2, 
  X, 
  Loader2, 
  AlertCircle,
  TrendingUp,
  Save,
  CheckCircle2
} from 'lucide-react';
import { collection, getDocs, doc, updateDoc, deleteDoc, setDoc, addDoc, serverTimestamp } from 'firebase/firestore';
import { onAuthStateChanged, signInAnonymously, signInWithCustomToken } from 'firebase/auth';

import { db, auth, APP_ID } from '@/app/lib/stockService';

// --- 輔助函數：序列化處理 ---
const replaceUndefinedWithNull = (obj: any): any => {
    if (obj === undefined) return null;
    if (obj === null || typeof obj !== 'object') return obj;
    if (obj.toDate && typeof obj.toDate === 'function') return obj; 
    if (Array.isArray(obj)) return obj.map(replaceUndefinedWithNull);
    const newObj: any = {};
    for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
            newObj[key] = replaceUndefinedWithNull(obj[key]);
        }
    }
    return newObj;
};

// --- 精準過期時間推算 (HKT UTC+8) ---
const getExpirationTimeMs = (expDateStr: string, currency: string): number => {
    if (!expDateStr) return Infinity;
    try {
        if (currency === 'USD') {
            // 美股：到期日次日 04:00 HKT (嚴格處理月份/年份進位)
            const [y, m, d] = expDateStr.split('-').map(Number);
            const nextDay = new Date(y, m - 1, d + 1);
            const nextY = nextDay.getFullYear();
            const nextM = String(nextDay.getMonth() + 1).padStart(2, '0');
            const nextD = String(nextDay.getDate()).padStart(2, '0');
            return new Date(`${nextY}-${nextM}-${nextD}T04:00:00+08:00`).getTime();
        } else if (currency === 'JPY') {
            // 日股：到期日當天 14:00 HKT (即東京 15:00)
            return new Date(`${expDateStr}T14:00:00+08:00`).getTime();
        } else if (currency === 'CNY') {
            // A股：到期日當天 15:00 HKT
            return new Date(`${expDateStr}T15:00:00+08:00`).getTime();
        } else {
            // 港股 (HKD/預設)：到期日當天 16:00 HKT
            return new Date(`${expDateStr}T16:00:00+08:00`).getTime();
        }
    } catch (e) {
        console.error("日期解析錯誤", e);
        const todayStr = new Date().toISOString().split('T')[0];
        return todayStr >= expDateStr ? 0 : Infinity; // 容錯降級
    }
};

// --- 可排序篩選表頭組件 ---
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
                        placeholder="篩選..." 
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

// 格式化數字
const fmtMoney = (val: number, c: string = "") => new Intl.NumberFormat('en-US', { style: 'currency', currency: c || 'USD' }).format(val);
const formatSum = (val: number) => val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface MergedRecord {
    tradeId: string;
    inputId: string;
    outputId: string;
    inputData: any;
    outputData: any;
    createdAt: any;
}

export default function OptionHoldingPage() {
    const [user, setUser] = useState<any>(null);
    
    // --- 核心持倉狀態 ---
    const [livingRecords, setLivingRecords] = useState<MergedRecord[]>([]);
    const [diedRecords, setDiedRecords] = useState<MergedRecord[]>([]);
    const [loadingLiving, setLoadingLiving] = useState(false);
    const [loadingDied, setLoadingDied] = useState(false);

    // --- 全局最新匯率與 HKD 視圖狀態 ---
    const [isHKDView, setIsHKDView] = useState(false);
    const [globalFxRates, setGlobalFxRates] = useState<Record<string, number>>({});
    const [isFetchingFx, setIsFetchingFx] = useState(false);
    const hasFetchedInitialFxRates = useRef(false);

    // --- DB管理模塊狀態 ---
    const [activeDbTab, setActiveDbTab] = useState('sip_holding_option_output_living');
    const [dbRecords, setDbRecords] = useState<any[]>([]);
    const [loadingDb, setLoadingDb] = useState(false);
    const [editRecordModal, setEditRecordModal] = useState<{show: boolean, record: any, rawJson: string} | null>(null);

    // --- 排序與篩選 State ---
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
                if (typeof window !== 'undefined' && window.__initial_auth_token) await signInWithCustomToken(auth, window.__initial_auth_token);
                else await signInAnonymously(auth);
            }
            onAuthStateChanged(auth, setUser);
        };
        initAuth();
    }, []);

    // --- 核心：通過 tradeId 映射合併 Input 和 Output 庫 ---
    const fetchMergedRecords = async (lifeCycle: 'living' | 'died'): Promise<MergedRecord[]> => {
        try {
            const inputSnap = await getDocs(collection(db, 'artifacts', APP_ID, 'public', 'data', `sip_trade_option_input_${lifeCycle}`));
            const outputSnap = await getDocs(collection(db, 'artifacts', APP_ID, 'public', 'data', `sip_holding_option_output_${lifeCycle}`));
            
            if (inputSnap.empty) return [];

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
                    createdAt: inp.createdAt
                };
            }).filter(Boolean) as MergedRecord[];
            
            merged.sort((a,b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
            return merged;
        } catch (error) {
            console.warn(`[Graceful Fallback] Fetch ${lifeCycle} records failed:`, error);
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

    // --- 獲取並刷新後台庫數據 ---
    const fetchDbRecords = async (collectionName: string) => {
        if (!user) return;
        setLoadingDb(true);
        try {
            const querySnapshot = await getDocs(collection(db, 'artifacts', APP_ID, 'public', 'data', collectionName));
            let records: any[] = [];
            querySnapshot.forEach((docSnap) => {
                const data = docSnap.data();
                delete data.id; 
                records.push({ ...data, id: docSnap.id });
            });
            records.sort((a, b) => {
               const timeA = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
               const timeB = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
               return timeB - timeA;
            });
            setDbRecords(records);
        } catch(e) { console.error("讀取資料庫失敗:", e); } 
        finally { setLoadingDb(false); }
    };

    useEffect(() => { if (user) fetchDbRecords(activeDbTab); }, [activeDbTab, user]);
    useEffect(() => { if (user) { loadRecords(); fetchDbRecords(activeDbTab); } }, [user]);

    // --- API 調用 ---
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

    const fetchLatestFxRates = async () => {
        const markets = new Set<string>();
        [...livingRecords, ...diedRecords].forEach(r => {
            const mkt = r.inputData?.basic?.currency;
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
                    if (data && data.rate) newRates[mkt] = data.rate;
                }
            }));
            setGlobalFxRates(prev => ({ ...prev, ...newRates }));
        } catch (e) { console.error("Failed to fetch FX rates", e); } 
        finally { setIsFetchingFx(false); }
    };

    useEffect(() => {
        if ((livingRecords.length > 0 || diedRecords.length > 0) && !hasFetchedInitialFxRates.current) {
            fetchLatestFxRates();
            hasFetchedInitialFxRates.current = true;
        }
    }, [livingRecords, diedRecords]);

    const handleToggleHKDView = async () => {
        if (!isHKDView) await fetchLatestFxRates();
        setIsHKDView(!isHKDView);
    };

    // --- 核心計算與狀態判斷邏輯 ---
    const evaluateOption = async (mergedRecord: MergedRecord) => {
        const { inputData, outputData } = mergedRecord;
        const { basic, underlying, dates } = inputData;
        
        // 【鐵血邏輯】：使用精準到小時的市場過期時間判定
        const expireTimeMs = getExpirationTimeMs(dates.expiryDate, basic.currency);
        const isExpired = Date.now() >= expireTimeMs;
        const status = isExpired ? 'Expired (已失效)' : 'Living (存續中)';

        let spot = Number(underlying.spotPrice);

        if (isExpired) {
            const d = new Date(dates.expiryDate);
            d.setDate(d.getDate() - 7); // 往前推7天防節假日無數據
            const startStr = d.toISOString().split('T')[0];
            
            const histPrices = await fetchHistoricalPrices(underlying.ticker, startStr, dates.expiryDate);
            
            if (histPrices && histPrices.length > 0) {
                // 嚴格過濾掉大於到期日的數據
                const validPrices = histPrices.filter((p: {date: string, close: number}) => p.date <= dates.expiryDate);
                
                if (validPrices.length > 0) {
                    // 按日期排序後取最後一天
                    validPrices.sort((a: {date: string}, b: {date: string}) => a.date.localeCompare(b.date));
                    spot = validPrices[validPrices.length - 1].close;
                } else {
                    throw new Error(`無法獲取 ${underlying.ticker} 於到期日 ${dates.expiryDate} 之前的有效歷史收盤價，為保證復盤準確性，拒絕結算！`);
                }
            } else {
                throw new Error(`無法獲取 ${underlying.ticker} 於到期日 ${dates.expiryDate} 的歷史收盤價，為保證復盤準確性，拒絕結算！`);
            }
        } else {
            // 未過期，抓取最新現價
            const p = await fetchQuotePrice(underlying.ticker);
            if (p !== null) {
                spot = p;
            }
        }

        // 金融計算
        const qty = Number(basic.qty);
        const strike = Number(underlying.strike);
        const isCall = basic.optionType === 'Call';
        
        const notional = isCall ? qty * strike : -qty * strike;
        const realizedPremium = -(qty * basic.premium) - basic.fee;
        
        // 瞬間內在價值
        const intrinsicValue = isCall 
            ? qty * Math.max(spot - strike, 0)
            : qty * Math.max(strike - spot, 0);

        // 未實現損益 (過期歸零)
        const unrealizedPnl = isExpired ? 0 : intrinsicValue;
        
        // 總收益
        const totalPnl = realizedPremium + intrinsicValue;
        
        // 接貨判斷
        const isITM = isCall ? spot > strike : spot < strike;
        let hasDelivery = false;
        let deliveryRecord: any = null;

        if (isExpired && isITM) {
            hasDelivery = true;
            const deliveryDir = ((qty > 0 && isCall) || (qty < 0 && !isCall)) ? 'BUY' : 'SELL';
            const deliveryQty = deliveryDir === 'BUY' ? Math.abs(qty) : -Math.abs(qty);
            const deliveryTotal = deliveryQty * strike;

            deliveryRecord = {
                tradeId: mergedRecord.tradeId,
                date: dates.expiryDate,
                account: basic.account,
                market: basic.currency === 'USD' ? 'US' : basic.currency === 'JPY' ? 'JP' : basic.currency === 'CNY' ? 'CH' : 'HK',
                executor: basic.executor,
                type: basic.optionType,
                direction: deliveryDir,
                stockCode: underlying.ticker,
                stockName: underlying.name,
                quantity: deliveryQty,
                priceNoFee: strike,
                fee: 0,
                amountNoFee: deliveryTotal,
                hkdAmount: deliveryTotal * (Number(basic.fxRate) || 1.0)
            };
        }

        return {
            status, isExpired, isITM,
            spot, notional, realizedPremium, unrealizedPnl, totalPnl, intrinsicValue,
            hasDelivery, deliveryRecord,
            cleanInput: replaceUndefinedWithNull({ ...inputData, underlying: { ...underlying, spotPrice: spot } }),
            cleanOutput: replaceUndefinedWithNull({
                ...outputData,
                status,
                notional,
                realizedPremium,
                expectedPayoff: unrealizedPnl,
                totalPnl: totalPnl,
                intrinsicValueAtExpiry: isExpired ? intrinsicValue : null,
                hasDelivery
            })
        };
    };

    // --- 刷新當前持倉 (Living) ---
    const handleRefreshLiving = async () => {
        setLoadingLiving(true);
        let expiredCount = 0;
        try {
            const currentLiving = await fetchMergedRecords('living');
            if (currentLiving.length === 0) {
                setLivingRecords([]); setLoadingLiving(false); return;
            }

            for (const mergedRecord of currentLiving) {
                const res = await evaluateOption(mergedRecord);
                delete res.cleanInput.id; delete res.cleanOutput.id;

                if (!res.isExpired) {
                    await setDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'sip_trade_option_input_living', mergedRecord.inputId), res.cleanInput);
                    await setDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'sip_holding_option_output_living', mergedRecord.outputId), res.cleanOutput);
                } else {
                    // 到期搬家 -> Died
                    await setDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'sip_trade_option_input_died', mergedRecord.inputId), res.cleanInput);
                    await setDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'sip_holding_option_output_died', mergedRecord.outputId), res.cleanOutput);
                    await deleteDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'sip_trade_option_input_living', mergedRecord.inputId));
                    await deleteDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'sip_holding_option_output_living', mergedRecord.outputId));
                    expiredCount++;

                    // 寫入交收記錄
                    if (res.hasDelivery && res.deliveryRecord) {
                        const cleanDelivery = replaceUndefinedWithNull(res.deliveryRecord);
                        await addDoc(collection(db, 'artifacts', APP_ID, 'public', 'data', 'sip_holding_option_output_get-stock'), {
                            ...cleanDelivery, createdAt: serverTimestamp()
                        });
                    }
                }
            }
            
            await loadRecords();
            if (activeDbTab.includes('living')) fetchDbRecords(activeDbTab);

            if (expiredCount > 0) alert(`刷新完畢！有 ${expiredCount} 筆期權已到期並移至歷史庫。對應的接貨記錄已自動存入 Get-Stock 庫。`);
            else alert('刷新完畢，已更新最新持倉與現價值。');
        } catch(e: any) { alert("刷新當前持倉失敗: " + e.message); } 
        finally { setLoadingLiving(false); }
    };

    // --- 刷新歷史持倉 (Died) ---
    const handleRefreshDied = async () => {
        setLoadingDied(true);
        let errorHealedCount = 0;
        try {
            const currentDied = await fetchMergedRecords('died');
            if (currentDied.length === 0) {
                setDiedRecords([]); setLoadingDied(false); return;
            }

            for (const mergedRecord of currentDied) {
                const res = await evaluateOption(mergedRecord);
                delete res.cleanInput.id; delete res.cleanOutput.id;

                if (!res.isExpired) {
                    // 智能自愈 (Self-Healing)：發現沒死，搬回 Living
                    await setDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'sip_trade_option_input_living', mergedRecord.inputId), res.cleanInput);
                    await setDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'sip_holding_option_output_living', mergedRecord.outputId), res.cleanOutput);
                    await deleteDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'sip_trade_option_input_died', mergedRecord.inputId));
                    await deleteDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'sip_holding_option_output_died', mergedRecord.outputId));
                    errorHealedCount++;
                } else {
                    // 依然已死，無腦覆寫校準
                    await setDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'sip_trade_option_input_died', mergedRecord.inputId), res.cleanInput);
                    await setDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'sip_holding_option_output_died', mergedRecord.outputId), res.cleanOutput);
                }
            }
            
            await loadRecords();
            if (activeDbTab.includes('died')) fetchDbRecords(activeDbTab);

            if (errorHealedCount > 0) alert(`出錯糾正！有 ${errorHealedCount} 筆數據重新計算後發現仍在存續期中（可能修改了到期日）！系統已將其自動修復並轉移回 Living 存續庫！`);
            else alert('歷史持倉刷新完畢！數據已基於到期日歷史價格精準校驗覆寫。');
        } catch(e: any) { alert("刷新歷史持倉失敗: " + e.message); } 
        finally { setLoadingDied(false); }
    };

    // --- 數據展平與表頭邏輯 ---
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
                const isMonetary = ['notional', 'realizedPremium', 'unrealizedPnl', 'totalPnl', 'exposureCost', 'exposureMktVal'].includes(sortConfig.key);
                result.sort((a, b) => {
                    let aVal = a[sortConfig.key];
                    let bVal = b[sortConfig.key];
                    if (isHKDView && isMonetary) {
                        const rateA = globalFx[a.currency] || a.fx_rate || 1;
                        const rateB = globalFx[b.currency] || b.fx_rate || 1;
                        aVal = (typeof aVal === 'number' ? aVal : parseFloat(aVal) || 0) * rateA;
                        bVal = (typeof bVal === 'number' ? bVal : parseFloat(bVal) || 0) * rateB;
                    }
                    const isAEmpty = aVal === null || aVal === undefined || aVal === '' || (typeof aVal === 'number' && Number.isNaN(aVal));
                    const isBEmpty = bVal === null || bVal === undefined || bVal === '' || (typeof bVal === 'number' && Number.isNaN(bVal));
                    if (isAEmpty && isBEmpty) return 0;
                    if (isAEmpty) return 1;
                    if (isBEmpty) return -1;
                    if (typeof aVal === 'string' && typeof bVal === 'string') return sortConfig.dir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
                    if (aVal < bVal) return sortConfig.dir === 'asc' ? -1 : 1;
                    if (aVal > bVal) return sortConfig.dir === 'asc' ? 1 : -1;
                    return 0;
                });
            }
            return result;
        }, [data, sortConfig, filterConfig, isHKDView, globalFx]);
    };

    // --- 準備展平字典 ---
    const processedLiving = useMemo(() => {
        return livingRecords.map((r) => {
            const out = r.outputData || {};
            const basic = r.inputData?.basic || {};
            const und = r.inputData?.underlying || {};
            const dts = r.inputData?.dates || {};
            return {
                id: r.tradeId,
                status: out.status,
                tradeDate: dts.tradeDate || '',
                name: out.name || '',
                ticker: und.ticker || '',
                account: basic.account || '',
                currency: basic.currency || 'USD',
                notional: out.notional || 0,
                strike: und.strike || 0,
                spotPrice: und.spotPrice || 0,
                realizedPremium: out.realizedPremium || 0,
                unrealizedPnl: out.expectedPayoff || 0, // Option Trade 存的是 expectedPayoff
                totalPnl: out.totalPnl || 0,
                fx_rate: basic.fxRate || 1
            };
        });
    }, [livingRecords]);

    const processedRisk = useMemo(() => {
        const rows: any[] = [];
        livingRecords.forEach(r => {
            const out = r.outputData || {}; 
            const basic = r.inputData?.basic || {};
            const und = r.inputData?.underlying || {};
            const qty = Number(basic.qty) || 0;
            const strike = Number(und.strike) || 0;
            const spot = Number(und.spotPrice) || 0;
            const isCall = basic.optionType === 'Call';
            const isITM = isCall ? spot > strike : spot < strike;

            // 【核心風控修復】：Buy/Sell 與 Call/Put 的暴露正負號判斷
            let exposureShares = 0;
            if (isITM) {
                exposureShares = isCall ? qty : -qty;
            }

            const exposureCost = exposureShares * strike;
            const exposureMktVal = exposureShares * spot;
            
            // PnL Ratio: 為了穩定反映多空，公式 PnL / Math.abs(Cost)
            const pnl = exposureShares * (spot - strike);
            const pnlRatio = Math.abs(exposureCost) > 0.0001 ? pnl / Math.abs(exposureCost) : 0;

            rows.push({
                id: r.tradeId,
                ticker: und.ticker || '',
                name: out.name || `${und.name} ${basic.direction} ${strike} ${basic.optionType}`,
                account: basic.account || '',
                currency: basic.currency || 'USD',
                fx_rate: basic.fxRate || 1,
                strike: strike,
                spot: spot,
                isITM: isITM,
                exposureShares: exposureShares,
                exposureCost: exposureCost,
                exposureMktVal: exposureMktVal,
                pnlRatio: pnlRatio
            });
        });
        return rows;
    }, [livingRecords]);

    const processedDied = useMemo(() => {
        return diedRecords.map((r) => {
            const out = r.outputData || {};
            const basic = r.inputData?.basic || {};
            const und = r.inputData?.underlying || {};
            const dts = r.inputData?.dates || {};
            return {
                id: r.tradeId,
                status: out.status,
                tradeDate: dts.tradeDate || '',
                name: out.name || '',
                ticker: und.ticker || '',
                account: basic.account || '',
                currency: basic.currency || 'USD',
                notional: out.notional || 0,
                strike: und.strike || 0,
                spotPrice: und.spotPrice || 0,
                realizedPremium: out.realizedPremium || 0,
                totalPnl: out.totalPnl || 0, // 歷史總收益 (期權金 + 結算瞬間內在價值)
                fx_rate: basic.fxRate || 1
            };
        });
    }, [diedRecords]);

    const finalLiving = useTableData(processedLiving, livingSort, livingFilters, isHKDView, globalFxRates);
    const finalRisk = useTableData(processedRisk, riskSort, riskFilters, isHKDView, globalFxRates);
    const finalDied = useTableData(processedDied, diedSort, diedFilters, isHKDView, globalFxRates);

    // --- 幫助函數 ---
    const formatMoneyWithUnit = (val: number, ccy: string, fxRate: number = 1) => {
        const effectiveRate = globalFxRates[ccy] || fxRate || 1;
        const value = isHKDView ? val * effectiveRate : val;
        const displayCcy = isHKDView ? 'HKD' : (ccy || 'USD');
        return `${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${displayCcy}`;
    };

    const getRecordSummary = (r: any, tab: string) => {
        try {
            if (tab.includes('input')) {
                const b = r.basic || {};
                const u = r.underlying || {};
                return `[Option] ${b.account || '未知'} | ${u.ticker || ''} ${b.direction || ''} ${Math.abs(b.qty || 0)}股`;
            }
            if (tab.includes('output')) return r.name || 'Option 測算結果';
            if (tab.includes('get-stock')) return `【交收】${r.account || ''} | ${r.direction || ''} ${r.quantity || 0}股 ${r.stockName || r.stockCode || ''}`;
            return JSON.stringify(r).substring(0, 100) + '...';
        } catch (e) { return '解析失敗...'; }
    };

    const handleDeleteRecord = async (id: string) => {
        if (!confirm("確定刪除嗎？")) return;
        await deleteDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', activeDbTab, id));
        setDbRecords(dbRecords.filter(r => r.id !== id));
    };
    const handleSaveRecordEdit = async () => {
        if (!editRecordModal) return;
        try {
            const parsedData = JSON.parse(editRecordModal.rawJson);
            const docId = parsedData.id || editRecordModal.record?.id;
            delete parsedData.id; 
            await updateDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', activeDbTab, docId), parsedData);
            setEditRecordModal(null);
            fetchDbRecords(activeDbTab); 
        } catch(e:any) { alert("修改失敗: " + e.message); }
    };

    return (
        <div className="space-y-8 pb-10">
            {/* Header */}
            <div className="border-b border-gray-200 pb-4 flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">Option Holding (期權持倉與風控)</h1>
                    <p className="mt-1 text-sm text-gray-500">統一管理您的期權存續與歷史持倉，執行實時定價、狀態流轉與交收風險評估。</p>
                </div>
                <button 
                    onClick={handleToggleHKDView} disabled={isFetchingFx}
                    className={`px-5 py-2.5 text-sm font-bold rounded-lg border transition-all shadow-sm flex items-center gap-2 ${isHKDView ? 'bg-blue-600 text-white border-blue-600 shadow-blue-200' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}
                >
                    {isFetchingFx && <Loader2 size={16} className="animate-spin" />}
                    {isHKDView ? '已轉為 HKD 全局計價' : '轉化為 HKD (全局盯市)'}
                </button>
            </div>

            {/* --- 模塊 1：Option 持倉板塊（存續中） --- */}
            <div className="bg-white shadow rounded-lg p-6 border border-gray-200">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                        <Database size={20} className="text-blue-600"/> 【Option 持倉板塊（存續中）】
                    </h2>
                    <span className="text-sm text-gray-500">Living 庫總計: {livingRecords.length} 筆</span>
                </div>
                
                <div className="overflow-x-auto border rounded-lg mb-4 shadow-sm pb-16">
                    <table className="min-w-full text-xs text-left divide-y divide-gray-200">
                        <thead className="bg-gray-50 text-gray-600 font-medium">
                            <tr>
                                <Th label="狀態" sortKey="status" currentSort={livingSort} onSort={toggleLivingSort} currentFilter={livingFilters} onFilter={updateLivingFilter} align="center" />
                                <Th label="交易日期" sortKey="tradeDate" filterKey="tradeDate" currentSort={livingSort} onSort={toggleLivingSort} currentFilter={livingFilters} onFilter={updateLivingFilter} align="center" />
                                <Th label="名稱" sortKey="name" filterKey="name" currentSort={livingSort} onSort={toggleLivingSort} currentFilter={livingFilters} onFilter={updateLivingFilter} align="left" />
                                <Th label="標的代碼" sortKey="ticker" filterKey="ticker" currentSort={livingSort} onSort={toggleLivingSort} currentFilter={livingFilters} onFilter={updateLivingFilter} align="center" />
                                <Th label="帳戶" sortKey="account" filterKey="account" currentSort={livingSort} onSort={toggleLivingSort} currentFilter={livingFilters} onFilter={updateLivingFilter} align="center" />
                                <Th label="幣種" sortKey="currency" filterKey="currency" currentSort={livingSort} onSort={toggleLivingSort} currentFilter={livingFilters} onFilter={updateLivingFilter} align="center" />
                                <Th label="名義金額" sortKey="notional" currentSort={livingSort} onSort={toggleLivingSort} currentFilter={livingFilters} onFilter={updateLivingFilter} align="right" />
                                <Th label="執行價" sortKey="strike" currentSort={livingSort} onSort={toggleLivingSort} currentFilter={livingFilters} onFilter={updateLivingFilter} align="right" />
                                <Th label="標的現價" sortKey="spotPrice" currentSort={livingSort} onSort={toggleLivingSort} currentFilter={livingFilters} onFilter={updateLivingFilter} align="right" />
                                <Th label="期權金(已實現)" sortKey="realizedPremium" currentSort={livingSort} onSort={toggleLivingSort} currentFilter={livingFilters} onFilter={updateLivingFilter} align="right" />
                                <Th label="當前預期收益(未實現)" sortKey="unrealizedPnl" currentSort={livingSort} onSort={toggleLivingSort} currentFilter={livingFilters} onFilter={updateLivingFilter} align="right" />
                                <Th label="當前總收益" sortKey="totalPnl" currentSort={livingSort} onSort={toggleLivingSort} currentFilter={livingFilters} onFilter={updateLivingFilter} align="right" />
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 bg-white">
                            {finalLiving.length === 0 ? (
                                <tr><td colSpan={12} className="px-4 py-8 text-center text-gray-400">暫無存續中的持倉數據</td></tr>
                            ) : finalLiving.map((item) => (
                                <tr key={item.id} className="hover:bg-blue-50/50 transition-colors">
                                    <td className="px-3 py-2 text-center font-bold text-green-700">{item.status}</td>
                                    <td className="px-3 py-2 text-center text-gray-600">{item.tradeDate}</td>
                                    <td className="px-3 py-2 font-medium text-gray-800">{item.name}</td>
                                    <td className="px-3 py-2 text-center font-mono text-blue-600">{item.ticker}</td>
                                    <td className="px-3 py-2 text-center text-gray-600">{item.account}</td>
                                    <td className="px-3 py-2 text-center font-mono text-gray-500">{item.currency}</td>
                                    <td className={`px-3 py-2 text-right font-mono ${item.notional > 0 ? 'text-blue-600' : 'text-orange-600'}`}>{formatMoneyWithUnit(item.notional, item.currency, item.fx_rate)}</td>
                                    <td className="px-3 py-2 text-right font-mono text-gray-600">{item.strike.toFixed(2)}</td>
                                    <td className="px-3 py-2 text-right font-mono text-gray-900">{item.spotPrice.toFixed(2)}</td>
                                    <td className={`px-3 py-2 text-right font-mono ${item.realizedPremium >= 0 ? 'text-green-600' : 'text-red-600'}`}>{item.realizedPremium > 0 ? '+' : ''}{formatMoneyWithUnit(item.realizedPremium, item.currency, item.fx_rate)}</td>
                                    <td className={`px-3 py-2 text-right font-mono ${item.unrealizedPnl > 0 ? 'text-green-600' : item.unrealizedPnl < 0 ? 'text-red-600' : 'text-gray-500'}`}>{item.unrealizedPnl > 0 ? '+' : ''}{formatMoneyWithUnit(item.unrealizedPnl, item.currency, item.fx_rate)}</td>
                                    <td className={`px-3 py-2 text-right font-mono font-bold ${item.totalPnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>{item.totalPnl > 0 ? '+' : ''}{formatMoneyWithUnit(item.totalPnl, item.currency, item.fx_rate)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                <button onClick={handleRefreshLiving} disabled={loadingLiving} className={`w-full py-3 px-4 rounded-md text-white font-bold transition-all shadow-md flex justify-center items-center gap-2 ${loadingLiving ? 'bg-blue-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'}`}>
                    {loadingLiving ? <Loader2 className="animate-spin" size={18} /> : <RefreshCw size={18} />}
                    {loadingLiving ? '重新計算並流轉數據...' : '刷新當前持倉 (重新定價與生命週期流轉)'}
                </button>
            </div>

            {/* --- 模塊 2：Option 風控模塊 --- */}
            <div className="bg-white shadow rounded-lg p-6 border border-gray-200">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                        <TrendingUp size={20} className="text-red-600"/> 【Option 風控模塊 (現貨交收暴露)】
                    </h2>
                    <span className="text-sm text-gray-500">潛在交收標的: {finalRisk.filter(r => r.exposureShares !== 0).length} 項</span>
                </div>

                <div className="overflow-x-auto border rounded-lg shadow-sm pb-16">
                    <table className="min-w-full text-xs text-left divide-y divide-gray-200">
                        <thead className="bg-red-50 text-red-800 font-medium">
                            <tr>
                                <Th label="標的代碼" filterKey="ticker" currentSort={riskSort} onSort={toggleRiskSort} currentFilter={riskFilters} onFilter={updateRiskFilter} align="center" />
                                <Th label="Option 名稱" filterKey="name" currentSort={riskSort} onSort={toggleRiskSort} currentFilter={riskFilters} onFilter={updateRiskFilter} align="left" />
                                <Th label="帳戶" sortKey="account" filterKey="account" currentSort={riskSort} onSort={toggleRiskSort} currentFilter={riskFilters} onFilter={updateRiskFilter} align="center" />
                                <Th label="暴露成本價" sortKey="strike" currentSort={riskSort} onSort={toggleRiskSort} currentFilter={riskFilters} onFilter={updateRiskFilter} align="right" />
                                <Th label="暴露股數 (多/空)" sortKey="exposureShares" currentSort={riskSort} onSort={toggleRiskSort} currentFilter={riskFilters} onFilter={updateRiskFilter} align="right" />
                                <Th label="暴露成本總額" sortKey="exposureCost" currentSort={riskSort} onSort={toggleRiskSort} currentFilter={riskFilters} onFilter={updateRiskFilter} align="right" />
                                <Th label="暴露當前市值" sortKey="exposureMktVal" currentSort={riskSort} onSort={toggleRiskSort} currentFilter={riskFilters} onFilter={updateRiskFilter} align="right" />
                                <Th label="現貨暴露盈虧比" sortKey="pnlRatio" currentSort={riskSort} onSort={toggleRiskSort} currentFilter={riskFilters} onFilter={updateRiskFilter} align="right" />
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 bg-white">
                            {finalRisk.length === 0 ? (
                                <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">當前無存續期權</td></tr>
                            ) : finalRisk.map((row, idx) => (
                                <tr key={`${row.id}-${idx}`} className={`transition-colors ${row.isITM ? 'bg-red-50/50 font-medium' : 'hover:bg-gray-50'}`}>
                                    <td className="px-3 py-2 text-center font-mono text-blue-600">{row.ticker}</td>
                                    <td className="px-3 py-2 text-gray-800">{row.name}</td>
                                    <td className="px-3 py-2 text-center text-gray-600">{row.account}</td>
                                    <td className="px-3 py-2 text-right font-mono text-gray-600">{row.strike.toFixed(2)}</td>
                                    <td className={`px-3 py-2 text-right font-mono ${row.exposureShares > 0 ? 'text-green-600' : row.exposureShares < 0 ? 'text-red-600' : 'text-gray-400'}`}>
                                        {row.exposureShares === 0 ? '-' : row.exposureShares.toLocaleString()}
                                    </td>
                                    <td className="px-3 py-2 text-right font-mono text-gray-700">{row.exposureCost === 0 ? '-' : formatMoneyWithUnit(row.exposureCost, row.currency, row.fx_rate)}</td>
                                    <td className="px-3 py-2 text-right font-mono text-gray-900">{row.exposureMktVal === 0 ? '-' : formatMoneyWithUnit(row.exposureMktVal, row.currency, row.fx_rate)}</td>
                                    <td className={`px-3 py-2 text-right font-mono font-bold ${row.pnlRatio > 0 ? 'text-green-600' : row.pnlRatio < 0 ? 'text-red-600' : 'text-gray-400'}`}>
                                        {row.pnlRatio === 0 ? '-' : `${row.pnlRatio > 0 ? '+' : ''}${(row.pnlRatio * 100).toFixed(2)}%`}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* --- 模塊 3：Option 持倉板塊（歷史） --- */}
            <div className="bg-white shadow rounded-lg p-6 border border-gray-200">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                        <Database size={20} className="text-orange-600"/> 【Option 持倉板塊（歷史復盤）】
                    </h2>
                    <span className="text-sm text-gray-500">Died 庫總計: {diedRecords.length} 筆</span>
                </div>
                
                <div className="overflow-x-auto border rounded-lg mb-4 shadow-sm pb-16">
                    <table className="min-w-full text-xs text-left divide-y divide-gray-200">
                        <thead className="bg-gray-50 text-gray-600 font-medium">
                            <tr>
                                <Th label="狀態" sortKey="status" currentSort={diedSort} onSort={toggleDiedSort} currentFilter={diedFilters} onFilter={updateDiedFilter} align="center" />
                                <Th label="交易日期" sortKey="tradeDate" filterKey="tradeDate" currentSort={diedSort} onSort={toggleDiedSort} currentFilter={diedFilters} onFilter={updateDiedFilter} align="center" />
                                <Th label="名稱" sortKey="name" filterKey="name" currentSort={diedSort} onSort={toggleDiedSort} currentFilter={diedFilters} onFilter={updateDiedFilter} align="left" />
                                <Th label="標的代碼" sortKey="ticker" filterKey="ticker" currentSort={diedSort} onSort={toggleDiedSort} currentFilter={diedFilters} onFilter={updateDiedFilter} align="center" />
                                <Th label="帳戶" sortKey="account" filterKey="account" currentSort={diedSort} onSort={toggleDiedSort} currentFilter={diedFilters} onFilter={updateDiedFilter} align="center" />
                                <Th label="幣種" sortKey="currency" filterKey="currency" currentSort={diedSort} onSort={toggleDiedSort} currentFilter={diedFilters} onFilter={updateDiedFilter} align="center" />
                                <Th label="名義金額" sortKey="notional" currentSort={diedSort} onSort={toggleDiedSort} currentFilter={diedFilters} onFilter={updateDiedFilter} align="right" />
                                <Th label="執行價" sortKey="strike" currentSort={diedSort} onSort={toggleDiedSort} currentFilter={diedFilters} onFilter={updateDiedFilter} align="right" />
                                <Th label="結算標的價" sortKey="spotPrice" currentSort={diedSort} onSort={toggleDiedSort} currentFilter={diedFilters} onFilter={updateDiedFilter} align="right" />
                                <Th label="期權金(已實現)" sortKey="realizedPremium" currentSort={diedSort} onSort={toggleDiedSort} currentFilter={diedFilters} onFilter={updateDiedFilter} align="right" />
                                <Th label="歷史總收益" sortKey="totalPnl" currentSort={diedSort} onSort={toggleDiedSort} currentFilter={diedFilters} onFilter={updateDiedFilter} align="right" />
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 bg-white">
                            {finalDied.length === 0 ? (
                                <tr><td colSpan={11} className="px-4 py-8 text-center text-gray-400">暫無歷史期權數據</td></tr>
                            ) : finalDied.map((item) => (
                                <tr key={item.id} className="hover:bg-orange-50/50 transition-colors">
                                    <td className="px-3 py-2 text-center font-bold text-gray-500">{item.status}</td>
                                    <td className="px-3 py-2 text-center text-gray-600">{item.tradeDate}</td>
                                    <td className="px-3 py-2 font-medium text-gray-800">{item.name}</td>
                                    <td className="px-3 py-2 text-center font-mono text-blue-600">{item.ticker}</td>
                                    <td className="px-3 py-2 text-center text-gray-600">{item.account}</td>
                                    <td className="px-3 py-2 text-center font-mono text-gray-500">{item.currency}</td>
                                    <td className={`px-3 py-2 text-right font-mono ${item.notional > 0 ? 'text-blue-600' : 'text-orange-600'}`}>{formatMoneyWithUnit(item.notional, item.currency, item.fx_rate)}</td>
                                    <td className="px-3 py-2 text-right font-mono text-gray-600">{item.strike.toFixed(2)}</td>
                                    <td className="px-3 py-2 text-right font-mono font-bold text-indigo-700">{item.spotPrice.toFixed(2)}</td>
                                    <td className={`px-3 py-2 text-right font-mono ${item.realizedPremium >= 0 ? 'text-green-600' : 'text-red-600'}`}>{item.realizedPremium > 0 ? '+' : ''}{formatMoneyWithUnit(item.realizedPremium, item.currency, item.fx_rate)}</td>
                                    <td className={`px-3 py-2 text-right font-mono font-bold ${item.totalPnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>{item.totalPnl > 0 ? '+' : ''}{formatMoneyWithUnit(item.totalPnl, item.currency, item.fx_rate)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                <button onClick={handleRefreshDied} disabled={loadingDied} className={`w-full py-3 px-4 rounded-md text-white font-bold transition-all shadow-md flex justify-center items-center gap-2 ${loadingDied ? 'bg-orange-400 cursor-not-allowed' : 'bg-orange-600 hover:bg-orange-700'}`}>
                    {loadingDied ? <Loader2 className="animate-spin" size={18} /> : <RefreshCw size={18} />}
                    {loadingDied ? '重新獲取歷史價格並校驗中...' : '刷新歷史持倉 (基於到期日歷史價格精準校驗)'}
                </button>
            </div>

            {/* --- 模塊 4：後台庫管理模塊 --- */}
            <div className="bg-white shadow rounded-lg p-6 border border-gray-200 mt-8">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                        <FileJson size={20} className="text-purple-600"/> 【後台庫管理模塊】
                    </h2>
                    <button onClick={() => fetchDbRecords(activeDbTab)} className="text-sm text-purple-600 hover:text-purple-800 flex items-center gap-1">
                        <RefreshCw size={14}/> 刷新數據
                    </button>
                </div>

                <div className="flex gap-2 mb-4 border-b pb-2 overflow-x-auto">
                    {['sip_trade_option_input_living', 'sip_holding_option_output_living', 'sip_trade_option_input_died', 'sip_holding_option_output_died', 'sip_holding_option_output_get-stock'].map(tab => (
                        <button key={tab} onClick={() => setActiveDbTab(tab)} className={`px-3 py-1.5 text-xs font-bold rounded whitespace-nowrap transition-colors ${activeDbTab === tab ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                            {tab.replace('sip_', '').replace(/_/g, '/')}
                        </button>
                    ))}
                </div>

                {loadingDb ? (
                    <div className="py-10 text-center"><Loader2 className="animate-spin mx-auto text-purple-600 mb-2" size={30}/></div>
                ) : dbRecords.length === 0 ? (
                    <div className="py-10 text-center text-gray-400 bg-gray-50 rounded border border-dashed">該庫中暫無數據</div>
                ) : (
                    <div className="overflow-x-auto border rounded">
                        <table className="min-w-full text-sm text-left divide-y divide-gray-200">
                            <thead className="bg-gray-50 text-gray-500">
                                <tr>
                                    <th className="px-3 py-2 whitespace-nowrap">ID / 創建時間</th>
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
                                            <div>{r.createdAt?.toDate ? r.createdAt.toDate().toLocaleString() : 'N/A'}</div>
                                        </td>
                                        <td className="px-3 py-2 text-xs font-mono text-blue-600">{r.tradeId || 'None'}</td>
                                        <td className="px-3 py-2 text-xs">
                                            <div className="max-w-md xl:max-w-2xl truncate text-gray-700 bg-blue-50/50 px-2 py-1.5 rounded border border-blue-100 font-medium">
                                                {getRecordSummary(r, activeDbTab)}
                                            </div>
                                        </td>
                                        <td className="px-3 py-2 text-center whitespace-nowrap">
                                            <button onClick={() => setEditRecordModal({show: true, record: r, rawJson: JSON.stringify(r, null, 4)})} className="text-blue-600 hover:text-blue-800 mx-1 p-1 hover:bg-blue-50 rounded transition-colors" title="修改 JSON"><FileJson size={16}/></button>
                                            <button onClick={() => handleDeleteRecord(r.id)} className="text-red-600 hover:text-red-800 mx-1 p-1 hover:bg-red-50 rounded transition-colors" title="永久刪除"><Trash2 size={16}/></button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* 修改 Raw JSON 彈窗 */}
            {editRecordModal && (
                <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
                    <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-5xl flex flex-col h-[85vh]">
                        <div className="flex justify-between items-center mb-4 border-b pb-4">
                            <h3 className="font-bold text-lg flex items-center gap-2 text-purple-700"><FileJson size={20}/> 進階修改記錄 - {editRecordModal.record?.id}</h3>
                            <button onClick={() => setEditRecordModal(null)} className="text-gray-400 hover:text-gray-600"><X size={20}/></button>
                        </div>
                        <p className="text-xs text-gray-500 mb-2 border-l-2 border-orange-400 pl-2">
                            警告：直接修改 Raw JSON 屬於高階操作，請確保 JSON 格式合法且結構正確，否則可能會導致頁面崩潰或邏輯錯誤。
                        </p>
                        <textarea className="flex-1 w-full border rounded-md p-3 text-xs font-mono mb-4 focus:ring-2 focus:ring-purple-500 outline-none resize-none" value={editRecordModal.rawJson} onChange={(e) => setEditRecordModal({...editRecordModal, rawJson: e.target.value})} />
                        <div className="flex justify-end gap-3 pt-2 border-t">
                            <button onClick={() => setEditRecordModal(null)} className="px-5 py-2 bg-gray-100 text-gray-700 rounded-md text-sm font-medium">取消</button>
                            <button onClick={handleSaveRecordEdit} className="px-5 py-2 bg-purple-600 text-white rounded-md text-sm font-bold flex gap-2"><Save size={16}/> 保存覆蓋</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}