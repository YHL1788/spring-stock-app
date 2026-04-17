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
  CheckCircle2,
  PieChart
} from 'lucide-react';
import { collection, getDocs, doc, updateDoc, deleteDoc, setDoc, addDoc } from 'firebase/firestore';
import { onAuthStateChanged, signInAnonymously, signInWithCustomToken } from 'firebase/auth';

import { db, auth, APP_ID } from '@/app/lib/stockService';

// --- 時間のパース補助関数 ---
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

// --- 補助関数：シリアライズ処理 ---
const replaceUndefinedWithNull = (obj: any): any => {
    if (obj === undefined) return null;
    if (obj === null || typeof obj !== 'object') return obj;
    // 【コア修正】：ネイティブのDateオブジェクトとFirestoreのTimestampをそのまま通す
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

// --- 正確な有効期限の計算 (HKT UTC+8) ---
const getExpirationTimeMs = (expDateStr: string, currency: string): number => {
    if (!expDateStr) return Infinity;
    try {
        if (currency === 'USD') {
            // 米国株：満期日の翌日 04:00 HKT
            const [y, m, d] = expDateStr.split('-').map(Number);
            const nextDay = new Date(y, m - 1, d + 1);
            const nextY = nextDay.getFullYear();
            const nextM = String(nextDay.getMonth() + 1).padStart(2, '0');
            const nextD = String(nextDay.getDate()).padStart(2, '0');
            return new Date(`${nextY}-${nextM}-${nextD}T04:00:00+08:00`).getTime();
        } else if (currency === 'JPY') {
            // 日本株：満期日の当日 14:00 HKT (東京 15:00)
            return new Date(`${expDateStr}T14:00:00+08:00`).getTime();
        } else if (currency === 'CNY') {
            // A株：満期日の当日 15:00 HKT
            return new Date(`${expDateStr}T15:00:00+08:00`).getTime();
        } else {
            // 香港株 (HKD/デフォルト)：満期日の当日 16:00 HKT
            return new Date(`${expDateStr}T16:00:00+08:00`).getTime();
        }
    } catch (e) {
        console.error("日付解析エラー", e);
        const todayStr = new Date().toISOString().split('T')[0];
        return todayStr >= expDateStr ? 0 : Infinity; // フォールバック
    }
};

// --- ソート・フィルタリング可能なテーブルヘッダーコンポーネント ---
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

// 数値のフォーマット
const fmtMoneyDisplay = (val: number, c: string = "") => new Intl.NumberFormat('en-US', { style: 'currency', currency: c || 'USD' }).format(val);

interface MergedRecord {
    tradeId: string;
    inputId: string;
    outputId: string;
    inputData: any;
    outputData: any;
    updatedAt: any;
    createdAt: any;
}

export default function OptionHoldingPage() {
    const [user, setUser] = useState<any>(null);
    
    // --- コアとなる保有状態 ---
    const [livingRecords, setLivingRecords] = useState<MergedRecord[]>([]);
    const [diedRecords, setDiedRecords] = useState<MergedRecord[]>([]);
    const [loadingLiving, setLoadingLiving] = useState(false);
    const [loadingDied, setLoadingDied] = useState(false);
    const [loadingSum, setLoadingSum] = useState(false);

    // --- グローバルな最新為替レートとHKD表示のフラグ ---
    const [isHKDView, setIsHKDView] = useState(false);
    const [globalFxRates, setGlobalFxRates] = useState<Record<string, number>>({});
    const [isFetchingFx, setIsFetchingFx] = useState(false);
    const hasFetchedInitialFxRates = useRef(false);

    // --- データベース管理モジュールの状態 ---
    const [activeDbTab, setActiveDbTab] = useState('sip_holding_option_output_living');
    const [dbRecords, setDbRecords] = useState<any[]>([]);
    const [loadingDb, setLoadingDb] = useState(false);
    const [editRecordModal, setEditRecordModal] = useState<{show: boolean, record: any, rawJson: string} | null>(null);

    // --- ソートとフィルターのState ---
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

    // --- 認証の初期化 ---
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

    // --- コア処理：tradeIdを基にInputとOutputのコレクションをマージ ---
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

    // --- データベース管理のデータを取得 ---
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
               const timeA = getTime(a.updatedAt) || getTime(a.createdAt);
               const timeB = getTime(b.updatedAt) || getTime(b.createdAt);
               return timeB - timeA;
            });
            setDbRecords(records);
        } catch(e) { console.error("读取数据库失败:", e); } 
        finally { setLoadingDb(false); }
    };

    useEffect(() => { if (user) fetchDbRecords(activeDbTab); }, [activeDbTab, user]);
    useEffect(() => { if (user) { loadRecords(); fetchDbRecords(activeDbTab); } }, [user]);

    // --- API呼び出し群 ---
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

    // --- コアの計算と状態判定ロジック ---
    const evaluateOption = async (mergedRecord: MergedRecord) => {
        const { inputData, outputData } = mergedRecord;
        const { basic, underlying, dates } = inputData;
        
        // 【厳格なロジック】：時間単位での市場期限判定を使用
        const expireTimeMs = getExpirationTimeMs(dates.expiryDate, basic.currency);
        const isExpired = Date.now() >= expireTimeMs;
        const status = isExpired ? 'Expired (已失效)' : 'Living (存续中)';

        let spot = Number(underlying.spotPrice);

        if (isExpired) {
            const d = new Date(dates.expiryDate);
            d.setDate(d.getDate() - 7); 
            const startStr = d.toISOString().split('T')[0];
            
            const histPrices = await fetchHistoricalPrices(underlying.ticker, startStr, dates.expiryDate);
            
            if (histPrices && histPrices.length > 0) {
                const validPrices = histPrices.filter((p: {date: string, close: number}) => p.date <= dates.expiryDate);
                
                if (validPrices.length > 0) {
                    validPrices.sort((a: {date: string}, b: {date: string}) => a.date.localeCompare(b.date));
                    spot = validPrices[validPrices.length - 1].close;
                } else {
                    throw new Error(`无法获取 ${underlying.ticker} 于到期日 ${dates.expiryDate} 之前的有效历史收盘价，为保证复盘准确性，拒绝结算！`);
                }
            } else {
                throw new Error(`无法获取 ${underlying.ticker} 于到期日 ${dates.expiryDate} 的历史收盘价，为保证复盘准确性，拒绝结算！`);
            }
        } else {
            const p = await fetchQuotePrice(underlying.ticker);
            if (p !== null) {
                spot = p;
            }
        }

        // 財務計算
        const qty = Number(basic.qty);
        const strike = Number(underlying.strike);
        const isCall = basic.optionType === 'Call';
        
        const notional = isCall ? qty * strike : -qty * strike;
        const realizedPremium = -(qty * basic.premium) - basic.fee;
        
        const intrinsicValue = isCall 
            ? qty * Math.max(spot - strike, 0)
            : qty * Math.max(strike - spot, 0);

        const unrealizedPnl = isExpired ? 0 : intrinsicValue;
        const totalPnl = realizedPremium + intrinsicValue;
        
        // デリバリー（受渡）の判定
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

        // 【タイムスタンプの厳格なロジック】：正確な絶対時間を使用
        const exactNow = new Date();

        return {
            status, isExpired, isITM,
            spot, notional, realizedPremium, unrealizedPnl, totalPnl, intrinsicValue,
            hasDelivery, deliveryRecord,
            cleanInput: replaceUndefinedWithNull({ 
                ...inputData, 
                underlying: { ...underlying, spotPrice: spot },
                updatedAt: exactNow
            }),
            cleanOutput: replaceUndefinedWithNull({
                ...outputData,
                status,
                notional,
                realizedPremium,
                expectedPayoff: unrealizedPnl,
                totalPnl: totalPnl,
                intrinsicValueAtExpiry: isExpired ? intrinsicValue : null,
                hasDelivery,
                updatedAt: exactNow
            })
        };
    };

    // --- 現在の保有状況を更新 (Living) ---
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
                    // 期限切れ -> Died へ移動
                    await setDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'sip_trade_option_input_died', mergedRecord.inputId), res.cleanInput);
                    await setDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'sip_holding_option_output_died', mergedRecord.outputId), res.cleanOutput);
                    await deleteDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'sip_trade_option_input_living', mergedRecord.inputId));
                    await deleteDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'sip_holding_option_output_living', mergedRecord.outputId));
                    expiredCount++;

                    // 受渡記録の書き込み
                    if (res.hasDelivery && res.deliveryRecord) {
                        const cleanDelivery = replaceUndefinedWithNull(res.deliveryRecord);
                        await addDoc(collection(db, 'artifacts', APP_ID, 'public', 'data', 'sip_holding_option_output_get-stock'), {
                            ...cleanDelivery, createdAt: new Date() // 絶対時間を使用
                        });
                    }
                }
            }
            
            await loadRecords();
            if (activeDbTab.includes('living')) fetchDbRecords(activeDbTab);

            if (expiredCount > 0) alert(`刷新完毕！有 ${expiredCount} 笔期权已到期并移至历史库。对应的接货记录已自动存入 Get-Stock 库。`);
            else alert('刷新完毕，已更新最新持仓与现价值。');
        } catch(e: any) { alert("刷新当前持仓失败: " + e.message); } 
        finally { setLoadingLiving(false); }
    };

    // --- 過去の保有状況を更新 (Died) ---
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
                    // 自動修復 (Self-Healing)：期限切れではないと判明した場合、Living へ戻す
                    await setDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'sip_trade_option_input_living', mergedRecord.inputId), res.cleanInput);
                    await setDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'sip_holding_option_output_living', mergedRecord.outputId), res.cleanOutput);
                    await deleteDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'sip_trade_option_input_died', mergedRecord.inputId));
                    await deleteDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'sip_holding_option_output_died', mergedRecord.outputId));
                    errorHealedCount++;
                } else {
                    // やはり期限切れの場合は上書き調整
                    await setDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'sip_trade_option_input_died', mergedRecord.inputId), res.cleanInput);
                    await setDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'sip_holding_option_output_died', mergedRecord.outputId), res.cleanOutput);
                }
            }
            
            await loadRecords();
            if (activeDbTab.includes('died')) fetchDbRecords(activeDbTab);

            if (errorHealedCount > 0) alert(`出错纠正！有 ${errorHealedCount} 笔数据重新计算后发现仍在存续期中（可能修改了到期日）！系统已将其自动修复并转移回 Living 存续库！`);
            else alert('历史持仓刷新完毕！数据已基于到期日历史价格精准校验覆盖。');
        } catch(e: any) { alert("刷新历史持仓失败: " + e.message); } 
        finally { setLoadingDied(false); }
    };

    // --- データの平坦化とテーブルヘッダーのロジック ---
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

    // --- 平坦化辞書の準備 ---
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
                strike: Number(und.strike) || 0,
                spotPrice: Number(und.spotPrice) || 0,
                realizedPremium: out.realizedPremium || 0,
                unrealizedPnl: out.expectedPayoff || 0, // Option Trade は expectedPayoff に保存
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

            let exposureShares = 0;
            if (isITM) {
                exposureShares = isCall ? qty : -qty;
            }

            const exposureCost = exposureShares * strike;
            const exposureMktVal = exposureShares * spot;
            
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
                strike: Number(und.strike) || 0,
                spotPrice: Number(und.spotPrice) || 0,
                realizedPremium: out.realizedPremium || 0,
                totalPnl: out.totalPnl || 0, 
                fx_rate: basic.fxRate || 1
            };
        });
    }, [diedRecords]);

    const finalLiving = useTableData(processedLiving, livingSort, livingFilters, isHKDView, globalFxRates);
    const finalRisk = useTableData(processedRisk, riskSort, riskFilters, isHKDView, globalFxRates);
    const finalDied = useTableData(processedDied, diedSort, diedFilters, isHKDView, globalFxRates);

    // --- グローバルな SUM と統計の計算 ---
    const globalStats = useMemo(() => {
        const markets: Record<string, any> = {};

        const initMarket = (mkt: string) => {
            if (!markets[mkt]) {
                markets[mkt] = {
                    market: mkt,
                    notionalTotal: 0,
                    notionalLiving: 0,
                    realizedTotal: 0,
                    unrealized: 0,
                    totalPnl: 0,
                    fxRate: 1
                };
            }
        };

        finalLiving.forEach(item => {
            const mkt = item.currency || 'HKD';
            initMarket(mkt);
            const rate = globalFxRates[mkt] || item.fx_rate || 1;
            markets[mkt].fxRate = rate;
            markets[mkt].notionalLiving += (item.notional || 0) * rate;
            markets[mkt].notionalTotal += (item.notional || 0) * rate;
            markets[mkt].realizedTotal += (item.realizedPremium || 0) * rate;
            markets[mkt].unrealized += (item.unrealizedPnl || 0) * rate;
            markets[mkt].totalPnl += (item.totalPnl || 0) * rate;
        });

        finalDied.forEach(item => {
            const mkt = item.currency || 'HKD';
            initMarket(mkt);
            const rate = globalFxRates[mkt] || item.fx_rate || 1;
            markets[mkt].fxRate = rate;
            markets[mkt].notionalTotal += (item.notional || 0) * rate;
            markets[mkt].realizedTotal += (item.realizedPremium || 0) * rate;
            markets[mkt].totalPnl += (item.totalPnl || 0) * rate;
        });

        const marketList = Object.values(markets);

        const hkdSum = marketList.reduce((acc, m) => {
            acc.notionalTotal += m.notionalTotal;
            acc.notionalLiving += m.notionalLiving;
            acc.realizedTotal += m.realizedTotal;
            acc.unrealized += m.unrealized;
            acc.totalPnl += m.totalPnl;
            return acc;
        }, { notionalTotal: 0, notionalLiving: 0, realizedTotal: 0, unrealized: 0, totalPnl: 0 });

        return { marketList, hkdSum };
    }, [finalLiving, finalDied, globalFxRates]);

    // --- 【追加】資金純買付統計データ (資金浄買入 = -已実現期権金) ---
    const cashStats = useMemo(() => {
        const accountsSet = new Set<string>();
        const marketsSet = new Set<string>();

        processedLiving.forEach(item => {
            if (item.account) accountsSet.add(item.account);
            if (item.currency) marketsSet.add(item.currency); // Option は currency を使用
        });
        processedDied.forEach(item => {
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

        // 資金純買付 = - 実現したオプションプレミアム (Living + Died)
        const addPremium = (item: any) => {
            if (item.currency && item.account) {
                // premiumがマイナス(支払済)ならプラスに、プラス(受取済)ならマイナスにする
                rawMatrix[item.currency][item.account] += -(item.realizedPremium || 0);
            }
        };

        processedLiving.forEach(addPremium);
        processedDied.forEach(addPremium);

        return { accounts, markets, rawMatrix };
    }, [processedLiving, processedDied]);

    // UI表示用のHKD総合算（データベースには保存しない）
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

    // --- Option 統計のデータベース保存ロジック ---
    const handleSaveSum = async (isAuto = false) => {
        if (!user) return;
        try {
            if (!isAuto) setLoadingSum(true);
            const payload = replaceUndefinedWithNull({
                marketStats: globalStats.marketList,
                hkdSum: globalStats.hkdSum,
                updatedAt: new Date() // 絶対時間を使用
            });

            await setDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'sip_holding_option_output_sum', 'latest_summary'), payload);
            
            if (!isAuto) alert("Option 统计已成功覆盖更新至 Sum 库！");
        } catch (e: any) {
            if (!isAuto) alert("保存 Option 统计失败: " + e.message);
            console.error("Auto-save sum failed", e);
        } finally {
            if (!isAuto) setLoadingSum(false);
        }
    };

    // --- 【追加】資金純買付データの保存ロジック ---
    const handleSaveCashStats = async () => {
        if (!user) return;
        try {
            const payload = {
                accounts: cashStats.accounts,
                markets: cashStats.markets,
                rawMatrix: cashStats.rawMatrix,
                updatedAt: new Date().toISOString()
            };
            await setDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'sip_holding_cash_option', 'latest_summary'), payload);
        } catch (e) {
            console.error("保存 Option 资金净买入统计失败:", e);
        }
    };

    // 毎分自動で統計と資金純買付を保存
    useEffect(() => {
        if (!user) return;
        const intervalId = setInterval(() => {
            handleSaveSum(true);
            handleSaveCashStats();
        }, 60000); 
        return () => clearInterval(intervalId);
    }, [user, globalStats, cashStats]);

    // --- ヘルパー関数 ---
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
            if (tab.includes('output_living') || tab.includes('output_died')) {
                return r.name || 'Option 测算结果';
            }
            if (tab.includes('get-stock')) {
                return `【交收】${r.account || ''} | ${r.direction || ''} ${r.quantity || 0}股 ${r.stockName || r.stockCode || ''}`;
            }
            if (tab.includes('sum')) {
                const time = formatTime(r.updatedAt) || formatTime(r.createdAt) || 'N/A';
                return `全局大盘统计快照 (更新于: ${time})`;
            }
            return JSON.stringify(r).substring(0, 100) + '...';
        } catch (e) { return '解析失败...'; }
    };

    const handleDeleteRecord = async (id: string) => {
        if (!confirm("确定要永久删除这条记录吗？不可恢复。")) return;
        await deleteDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', activeDbTab, id));
        setDbRecords(dbRecords.filter(r => r.id !== id));
    };
    
    const handleSaveRecordEdit = async () => {
        if (!editRecordModal) return;
        try {
            const parsedData = JSON.parse(editRecordModal.rawJson);
            const docId = parsedData.id || editRecordModal.record?.id;
            delete parsedData.id; 
            parsedData.updatedAt = new Date();
            await updateDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', activeDbTab, docId), parsedData);
            alert("数据修改成功！");
            setEditRecordModal(null);
            fetchDbRecords(activeDbTab); 
        } catch(e:any) { alert("修改失败 (请检查 JSON 格式是否正确): \n" + e.message); }
    };

    return (
        <div className="space-y-8 pb-10">
            {/* Header */}
            <div className="border-b border-gray-200 pb-4 flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">Option Holding (期权持仓与风控)</h1>
                    <p className="mt-1 text-sm text-gray-500">统一管理您的期权存续与历史持仓，执行实时定价、状态流转与交收风险评估。</p>
                </div>
                <button 
                    onClick={handleToggleHKDView} disabled={isFetchingFx}
                    className={`px-5 py-2.5 text-sm font-bold rounded-lg border transition-all shadow-sm flex items-center gap-2 ${isHKDView ? 'bg-blue-600 text-white border-blue-600 shadow-blue-200' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}
                >
                    {isFetchingFx && <Loader2 size={16} className="animate-spin" />}
                    {isHKDView ? '已转为 HKD 全局计价' : '转化为 HKD (全局盯市)'}
                </button>
            </div>

            {/* --- モジュール 1：Option 持倉板块（存续中） --- */}
            <div className="bg-white shadow rounded-lg p-6 border border-gray-200">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                        <Database size={20} className="text-blue-600"/> 【Option 持仓板块 (存续中)】
                    </h2>
                    <span className="text-sm text-gray-500">Living 库总计: {livingRecords.length} 笔</span>
                </div>
                
                <div className="overflow-x-auto border rounded-lg mb-4 shadow-sm pb-16">
                    <table className="min-w-full text-xs text-left divide-y divide-gray-200">
                        <thead className="bg-gray-50 text-gray-600 font-medium">
                            <tr>
                                <Th label="状态" sortKey="status" currentSort={livingSort} onSort={toggleLivingSort} currentFilter={livingFilters} onFilter={updateLivingFilter} align="center" />
                                <Th label="交易日期" sortKey="tradeDate" filterKey="tradeDate" currentSort={livingSort} onSort={toggleLivingSort} currentFilter={livingFilters} onFilter={updateLivingFilter} align="center" />
                                <Th label="名称" sortKey="name" filterKey="name" currentSort={livingSort} onSort={toggleLivingSort} currentFilter={livingFilters} onFilter={updateLivingFilter} align="left" />
                                <Th label="标的代码" sortKey="ticker" filterKey="ticker" currentSort={livingSort} onSort={toggleLivingSort} currentFilter={livingFilters} onFilter={updateLivingFilter} align="center" />
                                <Th label="账户" sortKey="account" filterKey="account" currentSort={livingSort} onSort={toggleLivingSort} currentFilter={livingFilters} onFilter={updateLivingFilter} align="center" />
                                <Th label="币种" sortKey="currency" filterKey="currency" currentSort={livingSort} onSort={toggleLivingSort} currentFilter={livingFilters} onFilter={updateLivingFilter} align="center" />
                                <Th label="名义金额" sortKey="notional" currentSort={livingSort} onSort={toggleLivingSort} currentFilter={livingFilters} onFilter={updateLivingFilter} align="right" />
                                <Th label="执行价" sortKey="strike" currentSort={livingSort} onSort={toggleLivingSort} currentFilter={livingFilters} onFilter={updateLivingFilter} align="right" />
                                <Th label="标的现价" sortKey="spotPrice" currentSort={livingSort} onSort={toggleLivingSort} currentFilter={livingFilters} onFilter={updateLivingFilter} align="right" />
                                <Th label="期权金(已实现)" sortKey="realizedPremium" currentSort={livingSort} onSort={toggleLivingSort} currentFilter={livingFilters} onFilter={updateLivingFilter} align="right" />
                                <Th label="当前预期收益(未实现)" sortKey="unrealizedPnl" currentSort={livingSort} onSort={toggleLivingSort} currentFilter={livingFilters} onFilter={updateLivingFilter} align="right" />
                                <Th label="当前总收益" sortKey="totalPnl" currentSort={livingSort} onSort={toggleLivingSort} currentFilter={livingFilters} onFilter={updateLivingFilter} align="right" />
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 bg-white">
                            {finalLiving.length === 0 ? (
                                <tr><td colSpan={12} className="px-4 py-8 text-center text-gray-400">暂无存续中的持仓数据</td></tr>
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
                    {loadingLiving ? '重新计算并流转数据...' : '刷新当前持仓 (重新定价与生命周期流转)'}
                </button>
            </div>

            {/* --- モジュール 2：Option 风控模块 --- */}
            <div className="bg-white shadow rounded-lg p-6 border border-gray-200">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                        <TrendingUp size={20} className="text-red-600"/> 【Option 风控模块 (现货交收暴露)】
                    </h2>
                    <span className="text-sm text-gray-500">潜在交收标的: {finalRisk.filter(r => r.exposureShares !== 0).length} 项</span>
                </div>

                <div className="overflow-x-auto border rounded-lg shadow-sm pb-16">
                    <table className="min-w-full text-xs text-left divide-y divide-gray-200">
                        <thead className="bg-red-50 text-red-800 font-medium">
                            <tr>
                                <Th label="标的代码" filterKey="ticker" currentSort={riskSort} onSort={toggleRiskSort} currentFilter={riskFilters} onFilter={updateRiskFilter} align="center" />
                                <Th label="Option 名称" filterKey="name" currentSort={riskSort} onSort={toggleRiskSort} currentFilter={riskFilters} onFilter={updateRiskFilter} align="left" />
                                <Th label="账户" sortKey="account" filterKey="account" currentSort={riskSort} onSort={toggleRiskSort} currentFilter={riskFilters} onFilter={updateRiskFilter} align="center" />
                                <Th label="暴露成本价" sortKey="strike" currentSort={riskSort} onSort={toggleRiskSort} currentFilter={riskFilters} onFilter={updateRiskFilter} align="right" />
                                <Th label="暴露股数 (多/空)" sortKey="exposureShares" currentSort={riskSort} onSort={toggleRiskSort} currentFilter={riskFilters} onFilter={updateRiskFilter} align="right" />
                                <Th label="暴露成本总额" sortKey="exposureCost" currentSort={riskSort} onSort={toggleRiskSort} currentFilter={riskFilters} onFilter={updateRiskFilter} align="right" />
                                <Th label="暴露当前市值" sortKey="exposureMktVal" currentSort={riskSort} onSort={toggleRiskSort} currentFilter={riskFilters} onFilter={updateRiskFilter} align="right" />
                                <Th label="现货暴露盈亏比" sortKey="pnlRatio" currentSort={riskSort} onSort={toggleRiskSort} currentFilter={riskFilters} onFilter={updateRiskFilter} align="right" />
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 bg-white">
                            {finalRisk.filter(r => r.exposureShares !== 0).length === 0 ? (
                                <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">当前没有潜在交收风险的持仓</td></tr>
                            ) : finalRisk.filter(r => r.exposureShares !== 0).map((row, idx) => (
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

            {/* --- モジュール 3：Option 持倉板块（历史） --- */}
            <div className="bg-white shadow rounded-lg p-6 border border-gray-200">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                        <Database size={20} className="text-orange-600"/> 【Option 持仓板块 (历史复盘)】
                    </h2>
                    <span className="text-sm text-gray-500">Died 库总计: {diedRecords.length} 笔</span>
                </div>
                
                <div className="overflow-x-auto border rounded-lg mb-4 shadow-sm pb-16">
                    <table className="min-w-full text-xs text-left divide-y divide-gray-200">
                        <thead className="bg-gray-50 text-gray-600 font-medium">
                            <tr>
                                <Th label="状态" sortKey="status" currentSort={diedSort} onSort={toggleDiedSort} currentFilter={diedFilters} onFilter={updateDiedFilter} align="center" />
                                <Th label="交易日期" sortKey="tradeDate" filterKey="tradeDate" currentSort={diedSort} onSort={toggleDiedSort} currentFilter={diedFilters} onFilter={updateDiedFilter} align="center" />
                                <Th label="名称" sortKey="name" filterKey="name" currentSort={diedSort} onSort={toggleDiedSort} currentFilter={diedFilters} onFilter={updateDiedFilter} align="left" />
                                <Th label="标的代码" sortKey="ticker" filterKey="ticker" currentSort={diedSort} onSort={toggleDiedSort} currentFilter={diedFilters} onFilter={updateDiedFilter} align="center" />
                                <Th label="账户" sortKey="account" filterKey="account" currentSort={diedSort} onSort={toggleDiedSort} currentFilter={diedFilters} onFilter={updateDiedFilter} align="center" />
                                <Th label="币种" sortKey="currency" filterKey="currency" currentSort={diedSort} onSort={toggleDiedSort} currentFilter={diedFilters} onFilter={updateDiedFilter} align="center" />
                                <Th label="名义金额" sortKey="notional" currentSort={diedSort} onSort={toggleDiedSort} currentFilter={diedFilters} onFilter={updateDiedFilter} align="right" />
                                <Th label="执行价" sortKey="strike" currentSort={diedSort} onSort={toggleDiedSort} currentFilter={diedFilters} onFilter={updateDiedFilter} align="right" />
                                <Th label="结算标的价" sortKey="spotPrice" currentSort={diedSort} onSort={toggleDiedSort} currentFilter={diedFilters} onFilter={updateDiedFilter} align="right" />
                                <Th label="期权金(已实现)" sortKey="realizedPremium" currentSort={diedSort} onSort={toggleDiedSort} currentFilter={diedFilters} onFilter={updateDiedFilter} align="right" />
                                <Th label="历史总收益" sortKey="totalPnl" currentSort={diedSort} onSort={toggleDiedSort} currentFilter={diedFilters} onFilter={updateDiedFilter} align="right" />
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 bg-white">
                            {finalDied.length === 0 ? (
                                <tr><td colSpan={11} className="px-4 py-8 text-center text-gray-400">暂无历史期权数据</td></tr>
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
                    {loadingDied ? '重新获取历史价格并校验中...' : '刷新历史持仓 (基于到期日历史价格精准校验)'}
                </button>
            </div>

            {/* --- モジュール 4：Option 统计 --- */}
            <div className="bg-white shadow rounded-lg p-6 border border-gray-200 mt-8">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                        <PieChart size={20} className="text-indigo-600"/>
                        【Option 统计】
                        <span className="text-sm font-normal text-gray-500 ml-2">全局数据统一折合为 HKD</span>
                    </h2>
                    <span className="text-xs text-gray-400">数据每分钟自动刷新存库</span>
                </div>
                
                <div className="overflow-x-auto border rounded-lg mb-6 shadow-sm">
                    <table className="min-w-full text-sm text-left divide-y divide-gray-200">
                        <thead className="bg-indigo-50 text-indigo-900 font-medium">
                            <tr>
                                <th className="px-3 py-2 text-center whitespace-nowrap">市场(币种)</th>
                                <th className="px-3 py-2 text-right whitespace-nowrap">总名义金额(含历史) HKD</th>
                                <th className="px-3 py-2 text-right whitespace-nowrap">总名义金额(存续中) HKD</th>
                                <th className="px-3 py-2 text-right whitespace-nowrap">已实现期权金(含历史) HKD</th>
                                <th className="px-3 py-2 text-right whitespace-nowrap">未实现损益 HKD</th>
                                <th className="px-3 py-2 text-right whitespace-nowrap">总损益 HKD</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 bg-white">
                            {globalStats.marketList.length === 0 ? (
                                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">暂无统计数据</td></tr>
                            ) : globalStats.marketList.map((m: any) => (
                                <tr key={m.market} className="hover:bg-indigo-50/30">
                                    <td className="px-3 py-2 text-center font-bold text-gray-700">{m.market}</td>
                                    <td className="px-3 py-2 text-right font-mono text-gray-800">{m.notionalTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                    <td className="px-3 py-2 text-right font-mono text-gray-800">{m.notionalLiving.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
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

            {/* === モジュール 5：资金净买入统计表 (資金浄買入統計表) === */}
            <div className="bg-white shadow rounded-lg p-6 border border-gray-200 mt-8">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                        <Database size={20} className="text-teal-600"/>
                        【资金净买入统计表】
                        <span className="text-sm font-normal text-gray-500 ml-2">净买入 = - 已实现期权金 (含历史)</span>
                    </h2>
                    <div className="flex items-center gap-4">
                        <span className="text-xs text-gray-400">数据每分钟自动存入 sip_holding_cash_option 库</span>
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
                                    const actualRate = globalFxRates[mkt] || 1;
                                    let rawRowSum = 0;
                                    return (
                                        <tr key={mkt} className="hover:bg-teal-50/30">
                                            <td className="px-3 py-2 text-center font-bold text-gray-700 border-r border-teal-50 bg-teal-50/20">{mkt}</td>
                                            {cashStats.accounts.map(acc => {
                                                const rawVal = cashStats.rawMatrix[mkt][acc] || 0;
                                                rawRowSum += rawVal;
                                                const displayVal = isHKDView ? rawVal * actualRate : rawVal;
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

            {/* --- モジュール 6：后台库管理模块 --- */}
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
                        'sip_trade_option_input_living', 
                        'sip_holding_option_output_living', 
                        'sip_trade_option_input_died', 
                        'sip_holding_option_output_died', 
                        'sip_holding_option_output_get-stock',
                        'sip_holding_option_output_sum'
                    ].map(tab => (
                        <button key={tab} onClick={() => setActiveDbTab(tab)} className={`px-3 py-1.5 text-xs font-bold rounded whitespace-nowrap transition-colors ${activeDbTab === tab ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                            {tab.replace('sip_', '').replace(/_/g, '/')}
                        </button>
                    ))}
                </div>

                {loadingDb ? (
                    <div className="py-10 text-center"><Loader2 className="animate-spin mx-auto text-purple-600 mb-2" size={30}/></div>
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
                                        <td className="px-3 py-2 text-xs font-mono text-blue-600">{r.tradeId || 'None'}</td>
                                        <td className="px-3 py-2 text-xs">
                                            <div className="max-w-md xl:max-w-2xl truncate text-gray-700 bg-blue-50/50 px-2 py-1.5 rounded border border-blue-100 font-medium">
                                                {getRecordSummary(r, activeDbTab)}
                                            </div>
                                        </td>
                                        <td className="px-3 py-2 text-center whitespace-nowrap">
                                            <button onClick={() => setEditRecordModal({show: true, record: r, rawJson: JSON.stringify(r, null, 4)})} className="text-blue-600 hover:text-blue-800 mx-1 p-1 hover:bg-blue-50 rounded transition-colors" title="修改 JSON"><FileJson size={16}/></button>
                                            <button onClick={() => handleDeleteRecord(r.id)} className="text-red-600 hover:text-red-800 mx-1 p-1 hover:bg-red-50 rounded transition-colors" title="永久删除"><Trash2 size={16}/></button>
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
                    <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-5xl flex flex-col h-[85vh]">
                        <div className="flex justify-between items-center mb-4 border-b pb-4">
                            <h3 className="font-bold text-lg flex items-center gap-2 text-purple-700"><FileJson size={20}/> 进阶修改记录 - {editRecordModal.record?.id}</h3>
                            <button onClick={() => setEditRecordModal(null)} className="text-gray-400 hover:text-gray-600"><X size={20}/></button>
                        </div>
                        <p className="text-xs text-gray-500 mb-2 border-l-2 border-orange-400 pl-2">
                            警告：直接修改 Raw JSON 属于高阶操作，请确保 JSON 格式合法且结构正确，否则可能会导致页面崩溃或逻辑错误。
                        </p>
                        <textarea className="flex-1 w-full border border-gray-300 rounded-md p-3 text-xs font-mono mb-4 focus:ring-2 focus:ring-purple-500 outline-none resize-none" value={editRecordModal.rawJson} onChange={(e) => setEditRecordModal(prev => prev ? {...prev, rawJson: e.target.value} : null)} />
                        <div className="flex justify-end gap-3 pt-2 border-t">
                            <button onClick={() => setEditRecordModal(null)} className="px-5 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-md text-sm font-medium transition-colors">取消</button>
                            <button onClick={handleSaveRecordEdit} className="px-5 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-md text-sm font-bold flex items-center gap-2 transition-colors"><Save size={16}/> 保存强制覆盖</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}