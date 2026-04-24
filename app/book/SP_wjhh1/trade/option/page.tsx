'use client';

import React, { useState, useEffect } from 'react';
import { 
    Calculator, Save, Loader2, Database, Trash2, FileJson, 
    X, AlertCircle, Play, CheckCircle2, RefreshCw, Edit2, ClipboardList
} from 'lucide-react';
import { collection, addDoc, getDocs, doc, deleteDoc, updateDoc, query, where, writeBatch } from 'firebase/firestore';
import { onAuthStateChanged, signInAnonymously, signInWithCustomToken } from 'firebase/auth';

import { db, auth, APP_ID } from '@/app/lib/stockService';

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

// --- 日期格式规范化辅助函数 (清洗 Excel 各种斜杠、不补零格式) ---
const normalizeDateStr = (dateStr: string) => {
    if (!dateStr) return '';
    let formatted = dateStr.replace(/\//g, '-');
    const parts = formatted.split('-');
    if (parts.length === 3) {
        const y = parts[0];
        const m = parts[1].padStart(2, '0');
        const d = parts[2].padStart(2, '0');
        formatted = `${y}-${m}-${d}`;
    }
    return formatted;
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

// 产生 UUID
function uuidv4() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// 格式化数字
const fmtMoney = (val: number, c: string = "") => new Intl.NumberFormat('en-US', { style: 'currency', currency: c || 'USD' }).format(val);

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

interface TransactionRecord {
    id: string;
    tradeId?: string;
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

export default function OptionTradePage() {
    const [user, setUser] = useState<any>(null);

    // ==========================================
    // 1. 表单状态 (State)
    // ==========================================
    const [basic, setBasic] = useState({
        account: 'EFG',
        executor: 'Team',
        currency: 'USD',
        fxRate: '',          // 留白自动抓取
        direction: 'BUY',    // 辅助显示用，实际以 qty 正负为准
        optionType: 'Call',
        qty: 100,            // 底层股票数量 (Buy>0, Sell<0)
        premium: 5.5,        // 期权单张价格
        fee: 10              // 交易手续费
    });

    const [underlying, setUnderlying] = useState({
        ticker: 'TSLA',
        name: '特斯拉',
        strike: 200,
        spotPrice: ''       // 留白自动抓取
    });

    const [dates, setDates] = useState({
        tradeDate: new Date().toISOString().split('T')[0],
        expiryDate: new Date(new Date().setMonth(new Date().getMonth() + 1)).toISOString().split('T')[0]
    });

    // ==========================================
    // 2. UI & 流程状态
    // ==========================================
    const [isRunning, setIsRunning] = useState(false);
    const [fetchStatus, setFetchStatus] = useState<string>(''); // 用于显示抓取状态
    const [isSaving, setIsSaving] = useState(false);
    const [simResult, setSimResult] = useState<any>(null); // 测算弹窗数据
    const [currentTradeId, setCurrentTradeId] = useState<string>("");

    const [txRecords, setTxRecords] = useState<TransactionRecord[]>([]);
    const [editingTxId, setEditingTxId] = useState<string | null>(null);
    
    const [activeDbTab, setActiveDbTab] = useState('sip_trade_option_input_living');
    const [dbRecords, setDbRecords] = useState<any[]>([]);
    const [loadingDb, setLoadingDb] = useState(false);
    const [editRecordModal, setEditRecordModal] = useState<{show: boolean, record: any, rawJson: string} | null>(null);

    // --- 批量导入 (Clipboard Paste) State ---
    const [showPasteModal, setShowPasteModal] = useState(false);
    const [pasteText, setPasteText] = useState('');
    const [parsedPasteData, setParsedPasteData] = useState<any[]>([]);
    const [isBulkProcessing, setIsBulkProcessing] = useState(false);
    const [bulkProgress, setBulkProgress] = useState({ current: 0, total: 0, living: 0, died: 0, delivery: 0, failed: 0 });

    // 初始化 Auth
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

    // 处理输入框变更
    const handleBasicChange = (e: any) => setBasic({ ...basic, [e.target.name]: e.target.type === 'number' ? Number(e.target.value) : e.target.value });
    const handleUnderlyingChange = (e: any) => setUnderlying({ ...underlying, [e.target.name]: e.target.name === 'ticker' || e.target.name === 'name' ? e.target.value : e.target.value === '' ? '' : Number(e.target.value) });
    const handleDatesChange = (e: any) => setDates({ ...dates, [e.target.name]: e.target.value });

    // 自动同步 Qty 与 Direction
    useEffect(() => {
        if (basic.direction === 'BUY' && basic.qty < 0) setBasic(p => ({...p, qty: Math.abs(p.qty)}));
        if (basic.direction === 'SELL' && basic.qty > 0) setBasic(p => ({...p, qty: -Math.abs(p.qty)}));
    }, [basic.direction]);

    useEffect(() => {
        if (basic.qty > 0 && basic.direction !== 'BUY') setBasic(p => ({...p, direction: 'BUY'}));
        if (basic.qty < 0 && basic.direction !== 'SELL') setBasic(p => ({...p, direction: 'SELL'}));
    }, [basic.qty]);

    // ==========================================
    // 3. API 抓取工具
    // ==========================================
    const fetchQuotePrice = async (symbol: string) => {
        try {
            const res = await fetch(`/api/quote?symbol=${symbol}`);
            const data = res.ok ? await res.json() : {};
            return data.regularMarketPrice || data.price || data.close || null;
        } catch { return null; }
    };
    const fetchFxRate = async (currency: string) => {
        if (currency === 'HKD') return 1.0;
        try {
            const res = await fetch(`/api/quote?currency=${currency}`);
            const data = res.ok ? await res.json() : {};
            return data.rate || null;
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
    // 4. 核心逻辑：录入运行 (生成测算结果)
    // ==========================================
    const handleRunSimulation = async () => {
        if (!underlying.ticker || !underlying.strike || !basic.qty) {
            alert("请填写完整的标的代码、执行价与交易数量！");
            return;
        }

        setIsRunning(true);
        setFetchStatus('参数准备中...');
        try {
            const newTradeId = uuidv4();
            setCurrentTradeId(newTradeId);

            const expireTimeMs = getExpirationTimeMs(dates.expiryDate, basic.currency);
            const isExpired = Date.now() >= expireTimeMs;
            const status = isExpired ? 'Expired (已失效)' : 'Living (存续中)';

            let finalSpotNum = 0;

            if (isExpired) {
                setFetchStatus(`获取 ${dates.expiryDate} 历史收盘价...`);
                const d = new Date(dates.expiryDate);
                d.setDate(d.getDate() - 7);
                const startStr = d.toISOString().split('T')[0];
                
                const histPrices = await fetchHistoricalPrices(underlying.ticker, startStr, dates.expiryDate);
                if (histPrices && histPrices.length > 0) {
                    const validPrices = histPrices.filter((p: {date: string, close: number}) => p.date <= dates.expiryDate);
                    if (validPrices.length > 0) {
                        validPrices.sort((a: {date: string}, b: {date: string}) => a.date.localeCompare(b.date));
                        finalSpotNum = validPrices[validPrices.length - 1].close;
                        setUnderlying(p => ({...p, spotPrice: String(finalSpotNum)}));
                    } else {
                        throw new Error(`无法获取 ${underlying.ticker} 于到期日 ${dates.expiryDate} 之前的有效历史收盘价，已拒绝本次结算！`);
                    }
                } else {
                    throw new Error(`无法获取 ${underlying.ticker} 于到期日 ${dates.expiryDate} 的历史收盘价，已拒绝本次结算！`);
                }
            } else {
                if (underlying.spotPrice === '') {
                    setFetchStatus('获取最新现价...');
                    const fetchedSpot = await fetchQuotePrice(underlying.ticker);
                    if (fetchedSpot === null) throw new Error("无法自动获取现价，请手动输入");
                    finalSpotNum = fetchedSpot;
                    setUnderlying(p => ({...p, spotPrice: String(finalSpotNum)}));
                } else {
                    finalSpotNum = Number(underlying.spotPrice);
                }
            }

            let finalFxNum = Number(basic.fxRate);
            if (basic.fxRate === '') {
                setFetchStatus('获取即时汇率...');
                const fetchedFx = await fetchFxRate(basic.currency);
                finalFxNum = fetchedFx || 1.0;
                setBasic(p => ({...p, fxRate: String(finalFxNum)}));
            }

            setFetchStatus('计算期权收益与分发...');
            const qty = Number(basic.qty);
            const spot = finalSpotNum;
            const strike = Number(underlying.strike);
            const isCall = basic.optionType === 'Call';
            
            const dirStr = qty > 0 ? 'BUY' : 'SELL';
            const name = `${underlying.name} ${dirStr} ${strike} ${basic.optionType}`;

            const notional = isCall ? qty * strike : -qty * strike;
            const realizedPremium = -(qty * basic.premium) - basic.fee;
            const intrinsicValue = isCall 
                ? qty * Math.max(spot - strike, 0)
                : qty * Math.max(strike - spot, 0);

            const unrealizedPnl = isExpired ? 0 : intrinsicValue;
            const totalPnl = realizedPremium + intrinsicValue;

            const isITM = isCall ? spot > strike : spot < strike;
            const newTxRecords: TransactionRecord[] = [];

            if (isExpired && isITM) {
                const deliveryDir = ((qty > 0 && isCall) || (qty < 0 && !isCall)) ? 'BUY' : 'SELL';
                const deliveryQty = deliveryDir === 'BUY' ? Math.abs(qty) : -Math.abs(qty);
                const deliveryTotal = deliveryQty * strike;

                newTxRecords.push({
                    id: `tx-opt-${Date.now()}`,
                    tradeId: newTradeId,
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
                    hkdAmount: deliveryTotal * finalFxNum
                });
            }
            setTxRecords(newTxRecords);

            setSimResult({
                name, status, isExpired, isITM, notional, realizedPremium, unrealizedPnl, totalPnl, intrinsicValue, spotPrice: spot, hasDelivery: newTxRecords.length > 0,
                rawData: { basic: { ...basic, fxRate: String(finalFxNum) }, underlying: { ...underlying, spotPrice: String(spot) }, dates }
            });

        } catch (e: any) {
            alert("测算失败: " + e.message);
        } finally {
            setIsRunning(false);
            setFetchStatus('');
        }
    };

    // ==========================================
    // 5. 执行存库 (确认保存)
    // ==========================================
    const handleConfirmSave = async () => {
        if (!simResult) return;
        setIsSaving(true);
        try {
            const { rawData, isExpired, hasDelivery } = simResult;
            const exactNow = new Date();
            
            const inputRecord = replaceUndefinedWithNull({ tradeId: currentTradeId, ...rawData, createdAt: exactNow, updatedAt: exactNow });
            const outputRecord = replaceUndefinedWithNull({
                tradeId: currentTradeId, status: simResult.status, tradeDate: rawData.dates.tradeDate, name: simResult.name, ticker: rawData.underlying.ticker,
                account: rawData.basic.account, currency: rawData.basic.currency, notional: simResult.notional, strike: rawData.underlying.strike,
                realizedPremium: simResult.realizedPremium, expectedPayoff: simResult.unrealizedPnl, totalPnl: simResult.totalPnl, 
                intrinsicValueAtExpiry: simResult.isExpired ? simResult.intrinsicValue : null, hasDelivery: hasDelivery, createdAt: exactNow, updatedAt: exactNow
            });

            const suffix = isExpired ? 'died' : 'living';
            
            await addDoc(collection(db, 'artifacts', APP_ID, 'public', 'data', `sip_trade_option_input_${suffix}`), inputRecord);
            await addDoc(collection(db, 'artifacts', APP_ID, 'public', 'data', `sip_holding_option_output_${suffix}`), outputRecord);

            alert(`✅ 期权参数已成功存入 ${suffix} 库！${hasDelivery ? '\n(请在下方的【接货展示模块】中，将交收记录录入至 Get-Stock 库)' : ''}`);
            setSimResult(null); 
            if (activeDbTab.includes('option')) fetchDbRecords(activeDbTab); 

        } catch (e: any) {
            alert("入库失败: " + e.message);
        } finally {
            setIsSaving(false);
        }
    };

    // ==========================================
    // --- 批量导入 (Clipboard Paste) 解析与执行逻辑 ---
    // ==========================================
    const handlePasteTextChange = (e: any) => {
        const text = e.target.value;
        setPasteText(text);
        
        const rows = text.split('\n').map((r: string) => r.trim()).filter(Boolean);
        
        const parsed = rows.map((row: string) => {
            const cols = row.split('\t');
            const rawDirection = cols[8]?.trim().toUpperCase() || 'BUY';
            const isSell = rawDirection.includes('SELL');
            const absQty = Math.abs(parseFloat(cols[9]?.replace(/,/g, '')) || 0);

            return {
                account: cols[0]?.trim() || '',
                executor: cols[1]?.trim() || '',
                tradeDate: normalizeDateStr(cols[2]?.trim() || ''),
                expiryDate: normalizeDateStr(cols[3]?.trim() || ''),
                ticker: cols[4]?.trim().toUpperCase() || '',
                name: cols[5]?.trim() || '',
                currency: cols[6]?.trim().toUpperCase() || 'USD',
                optionType: cols[7]?.trim().toLowerCase().includes('put') ? 'Put' : 'Call',
                direction: isSell ? 'SELL' : 'BUY',
                qty: isSell ? -absQty : absQty, 
                strike: parseFloat(cols[10]?.replace(/,/g, '')) || 0,
                premium: parseFloat(cols[11]?.replace(/,/g, '')) || 0,
                fee: parseFloat(cols[12]?.replace(/,/g, '')) || 0,
            };
        }).filter((item: any) => item.ticker && item.account && item.expiryDate); 
        
        setParsedPasteData(parsed);
    };

    // --- 修改校验区数据的事件处理器 ---
    const handleParsedDataChange = (index: number, field: string, value: any) => {
        const newData = [...parsedPasteData];
        newData[index] = { ...newData[index], [field]: value };
        setParsedPasteData(newData);
    };

    const processBulkImport = async () => {
        if (parsedPasteData.length === 0) return alert('没有解析到有效的数据！');
        
        setIsBulkProcessing(true);
        let livingCount = 0, diedCount = 0, deliveryCount = 0, failedCount = 0;
        const failedRecords: any[] = []; // 保存失败的记录

        for (let i = 0; i < parsedPasteData.length; i++) {
            setBulkProgress({ current: i + 1, total: parsedPasteData.length, living: livingCount, died: diedCount, delivery: deliveryCount, failed: failedCount });
            const item = parsedPasteData[i];
            
            try {
                const tradeId = uuidv4();
                const expireTimeMs = getExpirationTimeMs(item.expiryDate, item.currency);
                const isExpired = Date.now() >= expireTimeMs;
                const status = isExpired ? 'Expired (已失效)' : 'Living (存续中)';
                
                let spot = 0;
                if (isExpired) {
                    const d = new Date(item.expiryDate); d.setDate(d.getDate() - 7);
                    const startStr = d.toISOString().split('T')[0];
                    const histPrices = await fetchHistoricalPrices(item.ticker, startStr, item.expiryDate);
                    const validPrices = histPrices.filter((p: {date: string, close: number}) => p.date <= item.expiryDate);
                    if (validPrices.length > 0) {
                        validPrices.sort((a: {date: string}, b: {date: string}) => a.date.localeCompare(b.date));
                        spot = validPrices[validPrices.length - 1].close;
                    } else {
                        throw new Error(`缺少 ${item.ticker} 在 ${item.expiryDate} 之前的有效历史收盘价`);
                    }
                } else {
                    const p = await fetchQuotePrice(item.ticker);
                    if (p !== null) spot = p;
                    else throw new Error(`无法获取 ${item.ticker} 的现价`);
                }

                const fx = await fetchFxRate(item.currency) || 1.0;
                
                const isCall = item.optionType === 'Call';
                const notional = isCall ? item.qty * item.strike : -item.qty * item.strike;
                const realizedPremium = -(item.qty * item.premium) - item.fee;
                const intrinsicValue = isCall ? item.qty * Math.max(spot - item.strike, 0) : item.qty * Math.max(item.strike - spot, 0);
                const unrealizedPnl = isExpired ? 0 : intrinsicValue;
                const totalPnl = realizedPremium + intrinsicValue;
                
                const isITM = isCall ? spot > item.strike : spot < item.strike;
                let hasDelivery = false;
                let deliveryRecord: any = null;

                if (isExpired && isITM) {
                    hasDelivery = true;
                    const deliveryDir = ((item.qty > 0 && isCall) || (item.qty < 0 && !isCall)) ? 'BUY' : 'SELL';
                    const deliveryQty = deliveryDir === 'BUY' ? Math.abs(item.qty) : -Math.abs(item.qty);
                    const deliveryTotal = deliveryQty * item.strike;
                    
                    deliveryRecord = {
                        tradeId: tradeId,
                        date: item.expiryDate,
                        account: item.account,
                        market: item.currency === 'USD' ? 'US' : item.currency === 'JPY' ? 'JP' : item.currency === 'CNY' ? 'CH' : 'HK',
                        executor: item.executor,
                        type: item.optionType,
                        direction: deliveryDir,
                        stockCode: item.ticker,
                        stockName: item.name,
                        quantity: deliveryQty,
                        priceNoFee: item.strike,
                        fee: 0,
                        amountNoFee: deliveryTotal,
                        hkdAmount: deliveryTotal * fx
                    };
                }

                const exactNow = new Date();
                const name = `${item.name} ${item.direction} ${item.strike} ${item.optionType}`;
                
                const rawData = {
                    basic: {
                        account: item.account, executor: item.executor, currency: item.currency, fxRate: String(fx),
                        direction: item.direction, optionType: item.optionType, qty: item.qty, premium: item.premium, fee: item.fee
                    },
                    underlying: { ticker: item.ticker, name: item.name, strike: item.strike, spotPrice: String(spot) },
                    dates: { tradeDate: item.tradeDate, expiryDate: item.expiryDate }
                };

                const inputRecord = replaceUndefinedWithNull({ tradeId, ...rawData, createdAt: exactNow, updatedAt: exactNow });
                const outputRecord = replaceUndefinedWithNull({
                    tradeId, status, tradeDate: item.tradeDate, name, ticker: item.ticker, account: item.account, currency: item.currency,
                    notional, strike: item.strike, realizedPremium, expectedPayoff: unrealizedPnl, totalPnl, intrinsicValueAtExpiry: isExpired ? intrinsicValue : null,
                    hasDelivery, createdAt: exactNow, updatedAt: exactNow
                });

                const suffix = isExpired ? 'died' : 'living';
                await addDoc(collection(db, 'artifacts', APP_ID, 'public', 'data', `sip_trade_option_input_${suffix}`), inputRecord);
                await addDoc(collection(db, 'artifacts', APP_ID, 'public', 'data', `sip_holding_option_output_${suffix}`), outputRecord);
                
                if (isExpired) diedCount++; else livingCount++;

                if (hasDelivery && deliveryRecord) {
                    await addDoc(collection(db, 'artifacts', APP_ID, 'public', 'data', 'sip_holding_option_output_get-stock'), replaceUndefinedWithNull({
                        ...deliveryRecord, createdAt: exactNow
                    }));
                    deliveryCount++;
                }

            } catch (e: any) {
                console.error(`Batch parsing error at row ${i+1}:`, e);
                failedCount++;
                failedRecords.push(item); // 把失败的记录保存下来
            }
        }
        
        setIsBulkProcessing(false);
        
        if (failedCount > 0) {
            // 将失败的记录覆盖回解析数据中，并提示用户
            setParsedPasteData(failedRecords);
            alert(`⚠️ 批量导入部分完成，但有 ${failedCount} 笔数据录入失败（原因通常为代码错误、API抓取不到现价/历史价，或日期格式有误）。\n\n✅ 成功移入 Living: ${livingCount} 笔\n✅ 成功移入 Died: ${diedCount} 笔\n✅ 自动生成现货交收(接货): ${deliveryCount} 笔\n\n失败的记录已保留在校验区，您可以直接在表单中修改错误数据后，再次点击入库。`);
        } else {
            setShowPasteModal(false);
            setPasteText('');
            setParsedPasteData([]);
            alert(`✅ 批量测算流转与入库完成！\n\n成功移入 Living (存续) 库: ${livingCount} 笔\n成功移入 Died (已到期) 库: ${diedCount} 笔\n自动生成现货交收(接货): ${deliveryCount} 笔\n\n(提示：请在下方后台库管理或 Option Holding 页面核对明细)`);
        }
        
        fetchDbRecords(activeDbTab);
    };

    // ==========================================
    // 6. 交易记录处理 (Upsert Logic)
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
                    const fx = parseFloat(basic.fxRate) || 1.0;
                    updatedRec.hkdAmount = (updatedRec.amountNoFee + (isNaN(fee) ? 0 : fee)) * fx;
                }
            } else if (field === 'amountNoFee') {
                const amt = parseFloat(value);
                if (!isNaN(amt) && Math.abs(rec.quantity) > 0) {
                    updatedRec.priceNoFee = amt / rec.quantity;
                    const fx = parseFloat(basic.fxRate) || 1.0;
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
            setIsSaving(true);
            const getStockRef = collection(db, 'artifacts', APP_ID, 'public', 'data', 'sip_holding_option_output_get-stock');
            
            const q = query(getStockRef, where('tradeId', '==', currentTradeId));
            const snap = await getDocs(q);
            for(const d of snap.docs) {
                await deleteDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'sip_holding_option_output_get-stock', d.id));
            }

            for (const record of txRecords) {
                const cleanRecord = replaceUndefinedWithNull(record);
                delete cleanRecord.id; 
                await addDoc(getStockRef, { ...cleanRecord, createdAt: new Date() });
            }
            
            alert("交收数据已成功精准覆写至 get-stock 库！");
            
            setTxRecords([]);
            setCurrentTradeId("");

            if (activeDbTab === 'sip_holding_option_output_get-stock') fetchDbRecords(activeDbTab);
        } catch(e:any) { 
            alert("录入交易库失败: " + e.message); 
        } finally { 
            setIsSaving(false); 
        }
    };

    // ==========================================
    // 7. 后台库管理功能
    // ==========================================
    const fetchDbRecords = async (collectionName: string) => {
        if (!user) return;
        setLoadingDb(true);
        try {
            const snap = await getDocs(collection(db, 'artifacts', APP_ID, 'public', 'data', collectionName));
            let records: any[] = [];
            snap.forEach(d => records.push({ id: d.id, ...d.data() }));
            records.sort((a,b) => {
                const timeA = getTime(a.updatedAt) || getTime(a.createdAt);
                const timeB = getTime(b.updatedAt) || getTime(b.createdAt);
                return timeB - timeA;
            });
            setDbRecords(records);
        } catch(e) { console.error(e); } finally { setLoadingDb(false); }
    };

    useEffect(() => { if (user) fetchDbRecords(activeDbTab); }, [user, activeDbTab]);

    const handleDeleteRecord = async (id: string) => {
        if (!confirm("确定要删除吗？")) return;
        await deleteDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', activeDbTab, id));
        setDbRecords(dbRecords.filter(r => r.id !== id));
    };

    const handleClearCurrentDb = async () => {
        if (!user) return;
        if (!confirm(`警告：您确定要永久清空【${activeDbTab}】库中的所有数据吗？此操作不可撤销！`)) return;
        if (!confirm(`再次确认：清空操作将删除该库的所有记录，请确认您知道自己在做什么！`)) return;

        setLoadingDb(true);
        try {
            const q = query(collection(db, 'artifacts', APP_ID, 'public', 'data', activeDbTab));
            const snap = await getDocs(q);
            const batch = writeBatch(db);
            snap.docs.forEach(d => batch.delete(d.ref));
            await batch.commit();
            alert(`成功清空了 ${snap.size} 条数据！`);
            setDbRecords([]);
        } catch(e: any) {
            alert("清空失败: " + e.message);
        } finally {
            setLoadingDb(false);
        }
    };

    const handleSaveRecordEdit = async () => {
        if (!editRecordModal) return;
        try {
            const parsedData = JSON.parse(editRecordModal.rawJson);
            const docId = parsedData.id || editRecordModal.record?.id;
            delete parsedData.id; 
            parsedData.updatedAt = new Date();
            await updateDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', activeDbTab, docId), parsedData);
            setEditRecordModal(null);
            fetchDbRecords(activeDbTab); 
        } catch(e:any) { alert("修改失败: " + e.message); }
    };

    const getRecordSummary = (r: any, tab: string) => {
        try {
            if (tab.includes('input')) {
                const b = r.basic;
                const u = r.underlying;
                if (!b || !u) return 'Option Input 参数';
                return `[Option] ${b.account || '未知'} | ${u.ticker || ''} ${b.direction || ''} ${Math.abs(b.qty || 0)}股`;
            }
            if (tab.includes('output_living') || tab.includes('output_died')) {
                if (r.name) return r.name;
                return 'Option 测算结果';
            }
            if (tab.includes('get-stock')) {
                return `【交收】${r.account || ''} | ${r.direction || ''} ${r.quantity || 0}股 ${r.stockName || r.stockCode || ''}`;
            }
            return JSON.stringify(r).substring(0, 100) + '...';
        } catch (e) {
            return '解析失败...';
        }
    };

    // ==========================================
    // 渲染 UI
    // ==========================================
    return (
        <div className="space-y-8 pb-10 max-w-[1400px] mx-auto">
            {/* Header */}
            <div className="border-b border-gray-200 pb-4 flex justify-between items-end">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">Option Trade (期权录入)</h1>
                    <p className="mt-1 text-sm text-gray-500">标准化录入期权交易，自动推算名义本金、期权金收支，并完成生命周期分发与接货流转。</p>
                </div>
                <button
                    onClick={() => {
                        setPasteText('');
                        setParsedPasteData([]);
                        setBulkProgress({ current: 0, total: 0, living: 0, died: 0, delivery: 0, failed: 0 });
                        setShowPasteModal(true);
                    }}
                    className="px-4 py-2 bg-blue-100 text-blue-700 hover:bg-blue-200 rounded text-sm font-bold transition-colors shadow-sm flex items-center gap-2"
                >
                    <ClipboardList size={16}/> 从 Excel 批量测算与导入
                </button>
            </div>

            {/* --- 模块 1：参数输入模块 --- */}
            <div className="bg-white shadow rounded-xl p-6 border border-gray-200">
                <div className="flex items-center gap-2 mb-6 border-b pb-2">
                    <Calculator className="text-blue-600" size={20} />
                    <h2 className="text-lg font-bold text-gray-800">【参数输入模块】</h2>
                </div>

                <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
                    {/* 左侧：基础信息 */}
                    <div className="space-y-4">
                        <h3 className="font-bold text-gray-700 bg-gray-50 p-2 rounded text-sm">1. 基础信息</h3>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                            <div><label className="block text-xs font-medium text-gray-600 mb-1">账户</label><input type="text" name="account" value={basic.account} onChange={handleBasicChange} className="w-full border rounded p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                            <div><label className="block text-xs font-medium text-gray-600 mb-1">执行人</label><input type="text" name="executor" value={basic.executor} onChange={handleBasicChange} className="w-full border rounded p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                            
                            <div>
                                <label className="block text-xs font-medium text-gray-600 mb-1">计价货币</label>
                                <select name="currency" value={basic.currency} onChange={handleBasicChange} className="w-full border rounded p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white">
                                    <option value="HKD">HKD</option><option value="USD">USD</option><option value="JPY">JPY</option><option value="CNY">CNY</option>
                                </select>
                            </div>
                            <div className="col-span-2">
                                <label className="block text-xs font-medium text-gray-600 mb-1 flex justify-between">
                                    <span>汇率 (To HKD)</span><span className="text-[10px] text-gray-400">留白自动抓取</span>
                                </label>
                                <input type="number" step="0.0001" name="fxRate" value={basic.fxRate} onChange={handleBasicChange} placeholder="Auto Fetch" className="w-full border rounded p-2 text-sm font-mono focus:ring-2 focus:ring-blue-500 outline-none bg-gray-50" />
                            </div>

                            <div>
                                <label className="block text-xs font-medium text-gray-600 mb-1">方向 (自动)</label>
                                <select name="direction" value={basic.direction} onChange={handleBasicChange} className={`w-full border rounded p-2 text-sm font-bold outline-none ${basic.direction === 'BUY' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                                    <option value="BUY">BUY</option><option value="SELL">SELL</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-gray-600 mb-1">类型</label>
                                <select name="optionType" value={basic.optionType} onChange={handleBasicChange} className="w-full border rounded p-2 text-sm font-bold focus:ring-2 focus:ring-blue-500 outline-none bg-white">
                                    <option value="Call">Call (看涨)</option><option value="Put">Put (看跌)</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-gray-600 mb-1 flex justify-between">
                                    <span>交易数量</span>
                                    <span className="text-[10px] text-blue-500">Buy&gt;0, Sell&lt;0</span>
                                </label>
                                <input type="number" name="qty" value={basic.qty} onChange={handleBasicChange} className="w-full border rounded p-2 text-sm font-mono focus:ring-2 focus:ring-blue-500 outline-none bg-blue-50/30" />
                            </div>
                            
                            <div><label className="block text-xs font-medium text-gray-600 mb-1">期权单张价格</label><input type="number" step="0.01" name="premium" value={basic.premium} onChange={handleBasicChange} className="w-full border rounded p-2 text-sm font-mono focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                            <div><label className="block text-xs font-medium text-gray-600 mb-1">交易手续费</label><input type="number" step="0.01" name="fee" value={basic.fee} onChange={handleBasicChange} className="w-full border rounded p-2 text-sm font-mono focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                        </div>
                    </div>

                    {/* 右侧：标的与日期 */}
                    <div className="space-y-6">
                        {/* 2. 标的信息 */}
                        <div className="space-y-4">
                            <h3 className="font-bold text-gray-700 bg-gray-50 p-2 rounded text-sm">2. 标的信息</h3>
                            <div className="grid grid-cols-2 gap-3">
                                <div><label className="block text-xs font-medium text-gray-600 mb-1">标的代码 (Ticker)</label><input type="text" name="ticker" value={underlying.ticker} onChange={handleUnderlyingChange} className="w-full border rounded p-2 text-sm font-mono focus:ring-2 focus:ring-blue-500 outline-none uppercase" /></div>
                                <div><label className="block text-xs font-medium text-gray-600 mb-1">标的名称</label><input type="text" name="name" value={underlying.name} onChange={handleUnderlyingChange} className="w-full border rounded p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                                <div><label className="block text-xs font-medium text-gray-600 mb-1">执行价 (Strike)</label><input type="number" step="0.01" name="strike" value={underlying.strike} onChange={handleUnderlyingChange} className="w-full border rounded p-2 text-sm font-mono font-bold text-blue-700 focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                                <div>
                                    <label className="block text-xs font-medium text-gray-600 mb-1 flex justify-between">
                                        <span>当前价 (Spot)</span><span className="text-[10px] text-gray-400">过期无视手填</span>
                                    </label>
                                    <input type="number" step="0.01" name="spotPrice" value={underlying.spotPrice} onChange={handleUnderlyingChange} placeholder="Auto Fetch" className="w-full border rounded p-2 text-sm font-mono focus:ring-2 focus:ring-blue-500 outline-none bg-gray-50" />
                                </div>
                            </div>
                        </div>

                        {/* 3. 日期信息 */}
                        <div className="space-y-4">
                            <h3 className="font-bold text-gray-700 bg-gray-50 p-2 rounded text-sm">3. 日期信息</h3>
                            <div className="grid grid-cols-2 gap-3">
                                <div><label className="block text-xs font-medium text-gray-600 mb-1">交易日期 (Trade Date)</label><input type="date" name="tradeDate" value={dates.tradeDate} onChange={handleDatesChange} className="w-full border rounded p-2 text-sm font-mono focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                                <div><label className="block text-xs font-medium text-gray-600 mb-1">执行/到期日 (Expiry Date)</label><input type="date" name="expiryDate" value={dates.expiryDate} onChange={handleDatesChange} className="w-full border rounded p-2 text-sm font-mono font-bold focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="mt-8 pt-4 border-t flex justify-end">
                    <button 
                        onClick={handleRunSimulation} 
                        disabled={isRunning}
                        className={`px-8 py-3 rounded-lg text-white font-bold flex items-center gap-2 shadow-lg transition-all ${isRunning ? 'bg-blue-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700 hover:shadow-xl transform hover:-translate-y-0.5'}`}
                    >
                        {isRunning ? <Loader2 className="animate-spin" size={20}/> : <Play size={20}/>}
                        {isRunning ? (fetchStatus || '计算中...') : '录入运行 (计算并预览分发)'}
                    </button>
                </div>
            </div>

            {/* === 子操作框 Modal (包含测算报告与入库按钮) === */}
            {simResult && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 animate-in fade-in p-4">
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col relative overflow-hidden">
                        
                        <div className="px-6 py-4 border-b flex justify-between items-center bg-gray-50 flex-shrink-0">
                            <div>
                                <h3 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                                    <CheckCircle2 className="text-green-500" size={24} />
                                    计算完成 - 期权定价报告
                                </h3>
                                <p className="text-sm text-gray-500 mt-1">请确认下方测算结果与状态后，再进行保存入库。</p>
                            </div>
                            <button onClick={() => setSimResult(null)} className="text-gray-400 hover:text-gray-600 bg-white p-1 rounded-full shadow-sm border"><X size={24}/></button>
                        </div>

                        <div className="p-6 overflow-y-auto flex-1 bg-white space-y-6">
                            
                            <div className="border-b border-gray-200 pb-4">
                                <div className="flex justify-between items-start">
                                    <div>
                                        <h2 className="text-lg font-bold text-gray-900">{simResult.name}</h2>
                                    </div>
                                    <div className={`px-3 py-1 rounded text-sm font-bold ${simResult.isExpired ? 'bg-orange-100 text-orange-700' : 'bg-green-100 text-green-700'}`}>
                                        {simResult.status}
                                    </div>
                                </div>
                            </div>

                            {/* 核心数据面板 */}
                            <div className="grid grid-cols-2 gap-6">
                                <div className="bg-gray-50 p-4 rounded-lg">
                                    <p className="text-sm text-gray-500 mb-1">名义本金 (Notional)</p>
                                    <p className={`text-xl font-bold font-mono ${simResult.notional > 0 ? 'text-blue-600' : 'text-orange-600'}`}>
                                        {fmtMoney(simResult.notional, basic.currency)}
                                    </p>
                                </div>
                                <div className="bg-gray-50 p-4 rounded-lg">
                                    <p className="text-sm text-gray-500 mb-1">结算标的价 (Spot)</p>
                                    <p className="text-xl font-bold font-mono text-indigo-700">
                                        {simResult.spotPrice.toFixed(2)}
                                        {simResult.isExpired && <span className="text-xs text-orange-500 ml-2">(到期日真实历史价)</span>}
                                    </p>
                                </div>
                            </div>

                            {/* 收益分解面板 */}
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                <div className="bg-gray-50 p-4 rounded-lg border">
                                    <h3 className="text-sm font-medium text-gray-500 mb-2">已实现盈亏 (期权金)</h3>
                                    <p className={`text-xl font-bold font-mono ${simResult.realizedPremium >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                        {simResult.realizedPremium > 0 ? '+' : ''}{fmtMoney(simResult.realizedPremium, basic.currency)}
                                    </p>
                                </div>
                                <div className="bg-gray-50 p-4 rounded-lg border">
                                    <h3 className="text-sm font-medium text-gray-500 mb-2">预期收益 (未实现)</h3>
                                    <p className={`text-xl font-bold font-mono ${simResult.unrealizedPnl > 0 ? 'text-green-600' : simResult.unrealizedPnl < 0 ? 'text-red-600' : 'text-gray-800'}`}>
                                        {simResult.unrealizedPnl > 0 ? '+' : ''}{fmtMoney(simResult.unrealizedPnl, basic.currency)}
                                    </p>
                                </div>
                                <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                                    <h3 className="text-sm font-bold text-blue-800 mb-2">{simResult.isExpired ? '历史总收益 (复盘)' : '当前总收益'}</h3>
                                    <p className={`text-xl font-bold font-mono ${simResult.totalPnl > 0 ? 'text-green-600' : simResult.totalPnl < 0 ? 'text-red-600' : 'text-gray-800'}`}>
                                        {simResult.totalPnl > 0 ? '+' : ''}{fmtMoney(simResult.totalPnl, basic.currency)}
                                    </p>
                                </div>
                            </div>

                            {/* 接货判定 */}
                            {simResult.isExpired && (
                                <div className="mt-6 border-t pt-4">
                                    <h4 className="font-bold text-gray-800 mb-3 flex items-center gap-2">
                                        {simResult.hasDelivery ? <AlertCircle className="text-orange-500"/> : <CheckCircle2 className="text-gray-400"/>}
                                        到期结算判定
                                    </h4>
                                    {!simResult.hasDelivery ? (
                                        <div className="bg-gray-50 border border-dashed rounded-lg p-6 text-center text-gray-500">
                                            期权处于价外 (OTM)，未触发行权，<strong className="text-gray-700">无交收接货流水产生。</strong>
                                        </div>
                                    ) : (
                                        <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 text-orange-800 text-sm">
                                            ⚠️ <strong>已触发实盘交收。 具体的交收接货流水已自动生成并加载至页面下方的 【接货展示模块】。请在完成本弹窗保存后，前往下方模块核对并点击覆写入库。</strong>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        <div className="px-6 py-4 border-t bg-gray-50 flex justify-between items-center flex-shrink-0">
                            <div className="text-sm">
                                <span className="text-gray-600 mr-2">系统判定录入路径: </span>
                                {!simResult.isExpired ? (
                                    <span className="font-bold text-green-600 flex items-center gap-1 inline-flex"><CheckCircle2 size={16}/> Living (存续库)</span>
                                ) : (
                                    <span className="font-bold text-orange-600 flex items-center gap-1 inline-flex"><AlertCircle size={16}/> Died (已结束库)</span>
                                )}
                            </div>
                            <div className="flex gap-3">
                                <button onClick={() => setSimResult(null)} className="px-5 py-2 rounded-md text-gray-600 font-bold bg-white border hover:bg-gray-100 transition-colors">取消</button>
                                <button onClick={handleConfirmSave} disabled={isSaving} className={`px-6 py-2 rounded-md text-white font-bold flex items-center gap-2 transition-all shadow-md ${!simResult.isExpired ? 'bg-green-600 hover:bg-green-700' : 'bg-orange-600 hover:bg-orange-700'}`}>
                                    {isSaving ? <Loader2 className="animate-spin" size={18}/> : <Save size={18}/>} 确认入库 ({!simResult.isExpired ? 'Living' : 'Died'})
                                </button>
                            </div>
                        </div>

                    </div>
                </div>
            )}

            {/* --- 批量导入 (Clipboard Paste) 弹窗 --- */}
            {showPasteModal && (
                <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-6xl max-h-[95vh] flex flex-col overflow-hidden">
                        <div className="px-6 py-4 border-b flex justify-between items-center bg-gray-50 flex-shrink-0">
                            <div>
                                <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                                    <ClipboardList className="text-blue-600" size={20} /> 
                                    批量测算与导入 (从 Excel 粘贴)
                                </h3>
                                <p className="text-xs text-gray-500 mt-1">系统将自动为每条记录推算生命周期、抓取 API 定价并执行分发入库。</p>
                            </div>
                            {!isBulkProcessing && (
                                <button onClick={() => setShowPasteModal(false)} className="text-gray-400 hover:text-gray-600 transition-colors">
                                    <X size={20}/>
                                </button>
                            )}
                        </div>
                        
                        <div className="flex-1 overflow-y-auto p-6 space-y-6 flex flex-col lg:flex-row gap-6 relative">
                            {/* 遮罩层 (处理中) */}
                            {isBulkProcessing && (
                                <div className="absolute inset-0 bg-white/80 backdrop-blur-sm z-10 flex flex-col items-center justify-center rounded-b-xl">
                                    <Loader2 className="animate-spin text-blue-600 mb-4" size={48} />
                                    <h2 className="text-xl font-bold text-gray-800 mb-2">正在执行大规模并发测算...</h2>
                                    <p className="text-gray-600 font-mono text-sm mb-6">
                                        当前进度: {bulkProgress.current} / {bulkProgress.total}
                                    </p>
                                    <div className="flex gap-6 text-sm">
                                        <div className="bg-green-50 text-green-700 px-4 py-2 rounded border border-green-200 font-bold">Living 存续: {bulkProgress.living}</div>
                                        <div className="bg-orange-50 text-orange-700 px-4 py-2 rounded border border-orange-200 font-bold">Died 历史: {bulkProgress.died}</div>
                                        <div className="bg-blue-50 text-blue-700 px-4 py-2 rounded border border-blue-200 font-bold">实盘交收: {bulkProgress.delivery}</div>
                                    </div>
                                </div>
                            )}

                            {/* 左侧：粘贴区 */}
                            <div className="flex-1 flex flex-col max-w-sm">
                                <label className="block text-sm font-bold text-gray-700 mb-2">
                                    1. 请在下方粘贴数据 <span className="text-xs font-normal text-gray-500">(13列严格对齐)</span>
                                </label>
                                <div className="bg-blue-50 border border-blue-200 text-blue-800 text-xs p-3 rounded-lg mb-3">
                                    <span className="font-mono mt-1 block">账户 | 执行人 | 交易日 | 到期日 | 代码 | 名称 | 币种 | 类型(Call/Put) | 方向(Buy/Sell) | 数量(填绝对值) | 执行价 | 期权单价 | 手续费</span>
                                </div>
                                <textarea 
                                    className="flex-1 w-full border border-gray-300 rounded-lg p-3 text-xs font-mono focus:ring-2 focus:ring-blue-500 outline-none resize-none min-h-[300px] whitespace-pre"
                                    placeholder="在此处粘贴 Excel / Google Sheets 复制的数据..."
                                    value={pasteText}
                                    onChange={handlePasteTextChange}
                                    disabled={isBulkProcessing}
                                />
                            </div>

                            {/* 右侧：结构化可编辑预览区 */}
                            <div className="flex-[2] flex flex-col">
                                <label className="block text-sm font-bold text-gray-700 mb-2">
                                    2. 结构化校验区 <span className="text-xs font-normal text-gray-500">(共识别 {parsedPasteData.length} 笔)</span>
                                </label>
                                <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 text-[10px] p-2 rounded-md mb-2">
                                    💡 提示：您可以在下方表格中<b>直接修改错误的数据</b>，无需重新在 Excel 中粘贴。修改完成后点击右下角再次尝试入库。
                                </div>
                                <div className="flex-1 border border-gray-200 rounded-lg overflow-x-auto overflow-y-auto bg-gray-50 max-h-[500px]">
                                    {parsedPasteData.length === 0 ? (
                                        <div className="flex items-center justify-center h-full text-gray-400 text-sm">等待粘贴数据...</div>
                                    ) : (
                                        <table className="min-w-full text-xs text-left whitespace-nowrap">
                                            <thead className="bg-gray-100 text-gray-600 sticky top-0 shadow-sm z-10">
                                                <tr>
                                                    <th className="px-2 py-2 font-medium">账户</th>
                                                    <th className="px-2 py-2 font-medium">标的</th>
                                                    <th className="px-2 py-2 font-medium">到期日</th>
                                                    <th className="px-2 py-2 font-medium text-center">币种</th>
                                                    <th className="px-2 py-2 font-medium text-center">方向/类型</th>
                                                    <th className="px-2 py-2 font-medium text-right">数量</th>
                                                    <th className="px-2 py-2 font-medium text-right">执行价</th>
                                                    <th className="px-2 py-2 font-medium text-right">期权单价</th>
                                                    <th className="px-2 py-2 font-medium text-center">操作</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-200 bg-white">
                                                {parsedPasteData.map((item, idx) => (
                                                    <tr key={idx} className="hover:bg-blue-50">
                                                        <td className="px-2 py-1.5">
                                                            <input type="text" value={item.account} onChange={(e) => handleParsedDataChange(idx, 'account', e.target.value)} className="w-16 p-1 border border-gray-200 rounded text-xs outline-none focus:border-blue-400" />
                                                        </td>
                                                        <td className="px-2 py-1.5 flex flex-col gap-1">
                                                            <input type="text" value={item.ticker} onChange={(e) => handleParsedDataChange(idx, 'ticker', e.target.value.toUpperCase())} className="w-16 p-1 border border-gray-200 rounded text-xs font-bold outline-none focus:border-blue-400" placeholder="代码" />
                                                            <input type="text" value={item.name} onChange={(e) => handleParsedDataChange(idx, 'name', e.target.value)} className="w-16 p-1 border border-gray-200 rounded text-[10px] text-gray-500 outline-none focus:border-blue-400" placeholder="名称" />
                                                        </td>
                                                        <td className="px-2 py-1.5">
                                                            <input type="text" value={item.expiryDate} onChange={(e) => handleParsedDataChange(idx, 'expiryDate', e.target.value)} className="w-20 p-1 border border-gray-200 rounded text-xs font-mono outline-none focus:border-blue-400" placeholder="YYYY-MM-DD" />
                                                        </td>
                                                        <td className="px-2 py-1.5 text-center">
                                                            <select value={item.currency} onChange={(e) => handleParsedDataChange(idx, 'currency', e.target.value)} className="w-14 p-1 border border-gray-200 rounded text-xs outline-none focus:border-blue-400 bg-white">
                                                                <option value="USD">USD</option>
                                                                <option value="HKD">HKD</option>
                                                                <option value="CNY">CNY</option>
                                                                <option value="JPY">JPY</option>
                                                            </select>
                                                        </td>
                                                        <td className="px-2 py-1.5 text-center">
                                                            <div className="flex flex-col gap-1 items-center">
                                                                <select value={item.direction} onChange={(e) => {
                                                                    const dir = e.target.value;
                                                                    const absQty = Math.abs(item.qty);
                                                                    const newData = [...parsedPasteData];
                                                                    newData[idx] = { ...newData[idx], direction: dir, qty: dir === 'SELL' ? -absQty : absQty };
                                                                    setParsedPasteData(newData);
                                                                }} className={`w-14 p-1 border border-gray-200 rounded text-[10px] font-bold outline-none focus:border-blue-400 bg-white ${item.direction === 'BUY' ? 'text-green-700' : 'text-red-700'}`}>
                                                                    <option value="BUY">BUY</option>
                                                                    <option value="SELL">SELL</option>
                                                                </select>
                                                                <select value={item.optionType} onChange={(e) => handleParsedDataChange(idx, 'optionType', e.target.value)} className="w-14 p-1 border border-gray-200 rounded text-[10px] text-gray-600 outline-none focus:border-blue-400 bg-white">
                                                                    <option value="Call">Call</option>
                                                                    <option value="Put">Put</option>
                                                                </select>
                                                            </div>
                                                        </td>
                                                        <td className="px-2 py-1.5 text-right">
                                                            <input type="number" min="0" value={Math.abs(item.qty)} onChange={(e) => {
                                                                const val = parseFloat(e.target.value) || 0;
                                                                handleParsedDataChange(idx, 'qty', item.direction === 'SELL' ? -val : val);
                                                            }} className={`w-16 text-right p-1 border border-gray-200 rounded text-xs font-mono outline-none focus:border-blue-400 ${item.qty < 0 ? 'text-red-500' : 'text-green-600'}`} />
                                                        </td>
                                                        <td className="px-2 py-1.5 text-right">
                                                            <input type="number" value={item.strike} onChange={(e) => handleParsedDataChange(idx, 'strike', parseFloat(e.target.value) || 0)} className="w-16 text-right p-1 border border-gray-200 rounded text-xs font-mono outline-none focus:border-blue-400" />
                                                        </td>
                                                        <td className="px-2 py-1.5 text-right">
                                                            <input type="number" value={item.premium} onChange={(e) => handleParsedDataChange(idx, 'premium', parseFloat(e.target.value) || 0)} className="w-14 text-right p-1 border border-gray-200 rounded text-xs font-mono outline-none focus:border-blue-400 text-gray-500" />
                                                        </td>
                                                        <td className="px-2 py-1.5 text-center align-middle">
                                                            <button onClick={() => {
                                                                const newData = [...parsedPasteData];
                                                                newData.splice(idx, 1);
                                                                setParsedPasteData(newData);
                                                            }} className="text-gray-400 hover:text-red-500 p-1 rounded hover:bg-red-50 transition-colors" title="移除此条">
                                                                <Trash2 size={14}/>
                                                            </button>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    )}
                                </div>
                            </div>
                        </div>

                        <div className="bg-gray-50 px-6 py-4 border-t border-gray-200 flex justify-end gap-3 flex-shrink-0">
                            <button onClick={() => setShowPasteModal(false)} disabled={isBulkProcessing} className="px-5 py-2.5 bg-gray-200 text-gray-700 text-sm font-bold rounded shadow-sm hover:bg-gray-300 transition-colors disabled:opacity-50">
                                取消
                            </button>
                            <button 
                                onClick={processBulkImport} 
                                disabled={parsedPasteData.length === 0 || isBulkProcessing}
                                className="px-6 py-2.5 bg-blue-600 text-white text-sm font-bold rounded shadow-sm hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center gap-2"
                            >
                                {isBulkProcessing ? <Loader2 size={16} className="animate-spin"/> : <Play size={16}/>}
                                确认开始批量解析与入库
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* === 模块 2：接货展示模块 (独立模块) === */}
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
                        <p>暂无期权交收/接货记录产生</p>
                        <p className="text-xs mt-1">当期权到期且处于价内 (ITM) 时，会在此自动生成交收流水</p>
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
                                        <td className="px-3 py-2 text-green-600 font-bold">{editingTxId === rec.id ? <select value={rec.direction} onChange={(e) => handleTxChange(rec.id, 'direction', e.target.value)} className="border p-1 w-full text-xs rounded"><option value="BUY">BUY</option><option value="SELL">SELL</option></select> : rec.direction}</td>
                                        <td className="px-3 py-2 font-mono font-medium">{editingTxId === rec.id ? <input value={rec.stockCode} onChange={(e) => handleTxChange(rec.id, 'stockCode', e.target.value)} className="border p-1 w-full text-xs rounded" /> : rec.stockCode}</td>
                                        <td className={`px-3 py-2 text-right font-mono ${rec.quantity < 0 ? 'text-red-600' : ''}`}>{editingTxId === rec.id ? <input type="number" value={rec.quantity} onChange={(e) => handleTxChange(rec.id, 'quantity', e.target.value)} className="border p-1 w-20 text-xs rounded text-right" /> : rec.quantity}</td>
                                        <td className="px-3 py-2 text-right font-mono text-gray-600">{editingTxId === rec.id ? <input type="number" value={rec.priceNoFee} onChange={(e) => handleTxChange(rec.id, 'priceNoFee', e.target.value)} className="border p-1 w-20 text-xs rounded text-right" /> : Number(rec.priceNoFee).toFixed(4)}</td>
                                        <td className="px-3 py-2 text-right font-mono text-gray-500">{editingTxId === rec.id ? <input type="number" value={rec.fee} onChange={(e) => handleTxChange(rec.id, 'fee', e.target.value)} className="border p-1 w-16 text-xs rounded text-right" /> : rec.fee}</td>
                                        <td className={`px-3 py-2 text-right font-mono font-bold ${(rec.amountNoFee + rec.fee) < 0 ? 'text-red-600' : 'text-gray-900'}`}>{fmtMoney(rec.amountNoFee + rec.fee, basic.currency)}</td>
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
                        disabled={isSaving || txRecords.length === 0 || !currentTradeId}
                        className={`px-8 py-3 rounded-lg font-bold text-white transition-all shadow-md flex items-center gap-2 ${isSaving || txRecords.length === 0 ? 'bg-gray-300 cursor-not-allowed' : 'bg-orange-600 hover:bg-orange-700 shadow-orange-200'}`}
                    >
                        {isSaving ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
                        【录入库】覆盖至 Get-Stock
                    </button>
                </div>
            </div>

            {/* --- 模块 3：后台库管理模块 --- */}
            <div className="bg-white shadow rounded-lg p-6 border border-gray-200 mt-8">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                        <Database size={20} className="text-purple-600"/>
                        【后台库管理模块】
                    </h2>
                    <div className="flex items-center gap-3">
                        <button onClick={() => fetchDbRecords(activeDbTab)} className="text-sm text-purple-600 hover:text-purple-800 flex items-center gap-1">
                            <RefreshCw size={14}/> 刷新数据
                        </button>
                        <button 
                            onClick={handleClearCurrentDb} 
                            className="text-sm text-red-500 hover:text-red-700 flex items-center gap-1 bg-red-50 px-2 py-1 rounded transition-colors"
                        >
                            <Trash2 size={14}/> 一键清空当前库
                        </button>
                    </div>
                </div>

                <div className="flex gap-2 mb-4 border-b pb-2 overflow-x-auto">
                    {['sip_trade_option_input_living', 'sip_trade_option_input_died', 'sip_holding_option_output_living', 'sip_holding_option_output_died', 'sip_holding_option_output_get-stock'].map(tab => (
                        <button 
                            key={tab} onClick={() => setActiveDbTab(tab)} 
                            className={`px-3 py-1.5 text-xs font-bold rounded whitespace-nowrap transition-colors ${activeDbTab === tab ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                        >
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
                        <textarea className="flex-1 w-full border border-gray-300 rounded-md p-3 text-xs font-mono mb-4 focus:ring-2 focus:ring-purple-500 outline-none resize-none bg-gray-50" value={editRecordModal.rawJson} onChange={(e) => setEditRecordModal(prev => prev ? {...prev, rawJson: e.target.value} : null)} />
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