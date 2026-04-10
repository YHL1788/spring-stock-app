'use client';

import React, { useState, useEffect } from 'react';
import { 
    Calculator, Save, Loader2, Database, Trash2, FileJson, 
    X, AlertCircle, Play, CheckCircle2, RefreshCw, Edit2
} from 'lucide-react';
import { collection, addDoc, getDocs, doc, deleteDoc, updateDoc, serverTimestamp, query, where } from 'firebase/firestore';
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

// 產生 UUID
function uuidv4() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// 格式化數字
const fmtMoney = (val: number, c: string = "") => new Intl.NumberFormat('en-US', { style: 'currency', currency: c || 'USD' }).format(val);

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
    // 1. 表單狀態 (State)
    // ==========================================
    const [basic, setBasic] = useState({
        account: 'EFG',
        executor: 'Team',
        currency: 'USD',
        fxRate: '',          // 留白自動抓取
        direction: 'BUY',    // 輔助顯示用，實際以 qty 正負為準
        optionType: 'Call',
        qty: 100,            // 底層股票數量 (Buy>0, Sell<0)
        premium: 5.5,        // 期權單張價格
        fee: 10              // 交易手續費
    });

    const [underlying, setUnderlying] = useState({
        ticker: 'TSLA',
        name: '特斯拉',
        strike: 200,
        spotPrice: ''       // 留白自動抓取
    });

    const [dates, setDates] = useState({
        tradeDate: new Date().toISOString().split('T')[0],
        expiryDate: new Date(new Date().setMonth(new Date().getMonth() + 1)).toISOString().split('T')[0]
    });

    // ==========================================
    // 2. UI & 流程狀態
    // ==========================================
    const [isRunning, setIsRunning] = useState(false);
    const [fetchStatus, setFetchStatus] = useState<string>(''); // 新增：用於顯示抓取狀態
    const [isSaving, setIsSaving] = useState(false);
    const [simResult, setSimResult] = useState<any>(null); // 測算彈窗資料
    const [currentTradeId, setCurrentTradeId] = useState<string>("");

    const [txRecords, setTxRecords] = useState<TransactionRecord[]>([]);
    const [editingTxId, setEditingTxId] = useState<string | null>(null);
    
    const [activeDbTab, setActiveDbTab] = useState('sip_trade_option_input_living');
    const [dbRecords, setDbRecords] = useState<any[]>([]);
    const [loadingDb, setLoadingDb] = useState(false);
    const [editRecordModal, setEditRecordModal] = useState<{show: boolean, record: any, rawJson: string} | null>(null);

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

    // 處理輸入框變更
    const handleBasicChange = (e: any) => setBasic({ ...basic, [e.target.name]: e.target.type === 'number' ? Number(e.target.value) : e.target.value });
    const handleUnderlyingChange = (e: any) => setUnderlying({ ...underlying, [e.target.name]: e.target.name === 'ticker' || e.target.name === 'name' ? e.target.value : e.target.value === '' ? '' : Number(e.target.value) });
    const handleDatesChange = (e: any) => setDates({ ...dates, [e.target.name]: e.target.value });

    // 自動同步 Qty 與 Direction
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
    // 4. 核心邏輯：錄入運行 (生成測算結果)
    // ==========================================
    const handleRunSimulation = async () => {
        if (!underlying.ticker || !underlying.strike || !basic.qty) {
            alert("請填寫完整的標的代碼、執行價與交易數量！");
            return;
        }

        setIsRunning(true);
        setFetchStatus('參數準備中...');
        try {
            // 0. 生成全局 TradeId
            const newTradeId = uuidv4();
            setCurrentTradeId(newTradeId);

            // 1. 狀態流轉判斷
            const todayStr = new Date().toISOString().split('T')[0];
            const isExpired = todayStr >= dates.expiryDate;
            const status = isExpired ? 'Expired (已失效)' : 'Living (存續中)';

            // 2. 自動補全空缺參數 (修正類型推斷，統一轉為數值後再回填字串)
            let finalSpotNum = Number(underlying.spotPrice);
            if (underlying.spotPrice === '') {
                // 【核心修正】：如果已經嚴格過期（到期日 < 今天），則抓取歷史收盤價，否則抓最新現價
                if (dates.expiryDate < todayStr) {
                    setFetchStatus(`獲取 ${dates.expiryDate} 歷史收盤價...`);
                    // 往前推 7 天以防止週末或國定假日導致抓不到數據
                    const d = new Date(dates.expiryDate);
                    d.setDate(d.getDate() - 7);
                    const startStr = d.toISOString().split('T')[0];
                    
                    const histPrices = await fetchHistoricalPrices(underlying.ticker, startStr, dates.expiryDate);
                    if (histPrices && histPrices.length > 0) {
                        finalSpotNum = histPrices[histPrices.length - 1].close;
                    } else {
                        // 降級處理：如果歷史數據接口異常，回退到抓取現價
                        const fetchedSpot = await fetchQuotePrice(underlying.ticker);
                        if (!fetchedSpot) throw new Error("無法獲取歷史收盤價或現價，請手動輸入");
                        finalSpotNum = fetchedSpot;
                    }
                } else {
                    setFetchStatus('獲取最新現價...');
                    const fetchedSpot = await fetchQuotePrice(underlying.ticker);
                    if (!fetchedSpot) throw new Error("無法自動獲取現價，請手動輸入");
                    finalSpotNum = fetchedSpot;
                }
                setUnderlying(p => ({...p, spotPrice: String(finalSpotNum)}));
            }

            let finalFxNum = Number(basic.fxRate);
            if (basic.fxRate === '') {
                setFetchStatus('獲取即時匯率...');
                const fetchedFx = await fetchFxRate(basic.currency);
                finalFxNum = fetchedFx || 1.0;
                setBasic(p => ({...p, fxRate: String(finalFxNum)}));
            }

            setFetchStatus('計算期權收益與分發...');
            // 3. 核心金融計算 (嚴格遵守正負號邏輯)
            const qty = Number(basic.qty);
            const spot = finalSpotNum;
            const strike = Number(underlying.strike);
            const isCall = basic.optionType === 'Call';
            
            const dirStr = qty > 0 ? 'BUY' : 'SELL';
            const name = `${underlying.name} ${dirStr} ${strike} ${basic.optionType}`;

            // (A) 名義金額: Call = Qty*K, Put = -Qty*K
            const notional = isCall ? qty * strike : -qty * strike;

            // (B) 已实现损益: 期权金现金流 = -(Qty * 單價) - 費用
            const realizedPremium = -(qty * basic.premium) - basic.fee;

            // (C) 瞬间未实现损益 (Intrinsic Value): 假设到期价=现价
            const intrinsicValue = isCall 
                ? qty * Math.max(spot - strike, 0)
                : qty * Math.max(strike - spot, 0);

            // (D) 精准复盘逻辑处理
            // 如果期权未到期，未实现损益即为内在价值。如果期权已到期，未实现损益归零。
            const unrealizedPnl = isExpired ? 0 : intrinsicValue;
            
            // 总收益 = 已经落袋的期权金 + 计算瞬间的内在价值盈亏
            const totalPnl = realizedPremium + intrinsicValue;

            // 4. 接貨判斷 (僅到期且處於價內 ITM 時產生)
            const isITM = isCall ? spot > strike : spot < strike;
            const newTxRecords: TransactionRecord[] = [];

            if (isExpired && isITM) {
                // 方向判斷：Buy Call / Sell Put -> 買入現貨 ; Buy Put / Sell Call -> 賣出現貨
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

            // 5. 組裝彈窗所需數據
            setSimResult({
                name,
                status,
                isExpired,
                isITM,
                notional,
                realizedPremium,
                unrealizedPnl,
                totalPnl,
                intrinsicValue,
                spotPrice: spot,
                hasDelivery: newTxRecords.length > 0,
                // 原始輸入打包
                rawData: { 
                    basic: { ...basic, fxRate: String(finalFxNum) }, 
                    underlying: { ...underlying, spotPrice: String(spot) }, 
                    dates 
                }
            });

        } catch (e: any) {
            alert("測算失敗: " + e.message);
        } finally {
            setIsRunning(false);
            setFetchStatus('');
        }
    };

    // ==========================================
    // 5. 執行存庫 (確認保存)
    // ==========================================
    const handleConfirmSave = async () => {
        if (!simResult) return;
        setIsSaving(true);
        try {
            const { rawData, isExpired, hasDelivery } = simResult;
            
            // 構建 Input 和 Output 記錄
            const inputRecord = replaceUndefinedWithNull({
                tradeId: currentTradeId,
                ...rawData,
                createdAt: serverTimestamp()
            });

            const outputRecord = replaceUndefinedWithNull({
                tradeId: currentTradeId,
                status: simResult.status,
                tradeDate: rawData.dates.tradeDate,
                name: simResult.name,
                ticker: rawData.underlying.ticker,
                account: rawData.basic.account,
                currency: rawData.basic.currency,
                notional: simResult.notional,
                strike: rawData.underlying.strike,
                realizedPremium: simResult.realizedPremium,
                expectedPayoff: simResult.unrealizedPnl, // 存入严格的未实现损益 (到期为0)
                totalPnl: simResult.totalPnl,            // 存入复盘用的总收益
                intrinsicValueAtExpiry: simResult.isExpired ? simResult.intrinsicValue : null,
                hasDelivery: hasDelivery,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp()
            });

            // 根據生命週期分發入庫
            const suffix = isExpired ? 'died' : 'living';
            
            await addDoc(collection(db, 'artifacts', APP_ID, 'public', 'data', `sip_trade_option_input_${suffix}`), inputRecord);
            await addDoc(collection(db, 'artifacts', APP_ID, 'public', 'data', `sip_holding_option_output_${suffix}`), outputRecord);

            alert(`✅ 期權參數已成功存入 ${suffix} 庫！${hasDelivery ? '\n(請在下方的【接貨展示模塊】中，將交收記錄錄入至 Get-Stock 庫)' : ''}`);
            setSimResult(null); // 關閉彈窗
            if (activeDbTab.includes('option')) fetchDbRecords(activeDbTab); // 刷新底層表格

        } catch (e: any) {
            alert("入庫失敗: " + e.message);
        } finally {
            setIsSaving(false);
        }
    };

    // ==========================================
    // 6. 交易記錄處理 (Upsert Logic)
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
        if (!confirm(`確認將這 ${txRecords.length} 筆交易記錄錄入後台庫嗎？\n(這將會自動覆蓋相同 TradeID 的舊記錄)`)) return;

        try {
            setIsSaving(true);
            const getStockRef = collection(db, 'artifacts', APP_ID, 'public', 'data', 'sip_holding_option_output_get-stock');
            
            // 1. 根據 tradeId 查找並刪除舊記錄 (保證冪等性)
            const q = query(getStockRef, where('tradeId', '==', currentTradeId));
            const snap = await getDocs(q);
            for(const d of snap.docs) {
                await deleteDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'sip_holding_option_output_get-stock', d.id));
            }

            // 2. 插入當前屏幕的最新記錄
            for (const record of txRecords) {
                const cleanRecord = replaceUndefinedWithNull(record);
                delete cleanRecord.id; // 清除前端自用臨時id
                await addDoc(getStockRef, { ...cleanRecord, createdAt: serverTimestamp() });
            }
            
            alert("交收數據已成功精準覆寫至 get-stock 庫！");
            
            // 【核心修正】：清空接貨展示模塊與綁定的 ID
            setTxRecords([]);
            setCurrentTradeId("");

            if (activeDbTab === 'sip_holding_option_output_get-stock') fetchDbRecords(activeDbTab);
        } catch(e:any) { 
            alert("錄入交易庫失敗: " + e.message); 
        } finally { 
            setIsSaving(false); 
        }
    };

    // ==========================================
    // 7. 後台庫管理功能
    // ==========================================
    const fetchDbRecords = async (collectionName: string) => {
        if (!user) return;
        setLoadingDb(true);
        try {
            const snap = await getDocs(collection(db, 'artifacts', APP_ID, 'public', 'data', collectionName));
            let records: any[] = [];
            snap.forEach(d => records.push({ id: d.id, ...d.data() }));
            records.sort((a,b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
            setDbRecords(records);
        } catch(e) { console.error(e); } finally { setLoadingDb(false); }
    };

    useEffect(() => { if (user) fetchDbRecords(activeDbTab); }, [user, activeDbTab]);

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

    // --- 动态展示记录摘要 Helper ---
    const getRecordSummary = (r: any, tab: string) => {
        try {
            if (tab.includes('input')) {
                const b = r.basic;
                const u = r.underlying;
                if (!b || !u) return 'Option Input 參數';
                return `[Option] ${b.account || '未知'} | ${u.ticker || ''} ${b.direction || ''} ${Math.abs(b.qty || 0)}股`;
            }
            if (tab.includes('output_living') || tab.includes('output_died')) {
                if (r.name) return r.name;
                return 'Option 測算結果';
            }
            if (tab.includes('get-stock')) {
                return `【交收】${r.account || ''} | ${r.direction || ''} ${r.quantity || 0}股 ${r.stockName || r.stockCode || ''}`;
            }
            return JSON.stringify(r).substring(0, 100) + '...';
        } catch (e) {
            return '解析失敗...';
        }
    };

    // ==========================================
    // 渲染 UI
    // ==========================================
    return (
        <div className="space-y-8 pb-10 max-w-[1400px] mx-auto">
            {/* Header */}
            <div className="border-b border-gray-200 pb-4">
                <h1 className="text-2xl font-bold text-gray-900">Option Trade (期權錄入)</h1>
                <p className="mt-1 text-sm text-gray-500">標準化錄入期權交易，自動推算名義本金、期權金收支，並完成生命週期分發與接貨流轉。</p>
            </div>

            {/* --- 模塊 1：參數輸入模塊 --- */}
            <div className="bg-white shadow rounded-xl p-6 border border-gray-200">
                <div className="flex items-center gap-2 mb-6 border-b pb-2">
                    <Calculator className="text-blue-600" size={20} />
                    <h2 className="text-lg font-bold text-gray-800">【參數輸入模塊】</h2>
                </div>

                <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
                    {/* 左側：基礎信息 */}
                    <div className="space-y-4">
                        <h3 className="font-bold text-gray-700 bg-gray-50 p-2 rounded text-sm">1. 基礎信息</h3>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                            <div><label className="block text-xs font-medium text-gray-600 mb-1">賬戶</label><input type="text" name="account" value={basic.account} onChange={handleBasicChange} className="w-full border rounded p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                            <div><label className="block text-xs font-medium text-gray-600 mb-1">執行人</label><input type="text" name="executor" value={basic.executor} onChange={handleBasicChange} className="w-full border rounded p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                            
                            <div>
                                <label className="block text-xs font-medium text-gray-600 mb-1">計價貨幣</label>
                                <select name="currency" value={basic.currency} onChange={handleBasicChange} className="w-full border rounded p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white">
                                    <option value="HKD">HKD</option><option value="USD">USD</option><option value="JPY">JPY</option><option value="CNY">CNY</option>
                                </select>
                            </div>
                            <div className="col-span-2">
                                <label className="block text-xs font-medium text-gray-600 mb-1 flex justify-between">
                                    <span>匯率 (To HKD)</span><span className="text-[10px] text-gray-400">留白自動抓取</span>
                                </label>
                                <input type="number" step="0.0001" name="fxRate" value={basic.fxRate} onChange={handleBasicChange} placeholder="Auto Fetch" className="w-full border rounded p-2 text-sm font-mono focus:ring-2 focus:ring-blue-500 outline-none bg-gray-50" />
                            </div>

                            <div>
                                <label className="block text-xs font-medium text-gray-600 mb-1">方向 (自動)</label>
                                <select name="direction" value={basic.direction} onChange={handleBasicChange} className={`w-full border rounded p-2 text-sm font-bold outline-none ${basic.direction === 'BUY' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                                    <option value="BUY">BUY</option><option value="SELL">SELL</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-gray-600 mb-1">類型</label>
                                <select name="optionType" value={basic.optionType} onChange={handleBasicChange} className="w-full border rounded p-2 text-sm font-bold focus:ring-2 focus:ring-blue-500 outline-none bg-white">
                                    <option value="Call">Call (看漲)</option><option value="Put">Put (看跌)</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-gray-600 mb-1 flex justify-between">
                                    <span>交易數量</span>
                                    <span className="text-[10px] text-blue-500">Buy&gt;0, Sell&lt;0</span>
                                </label>
                                <input type="number" name="qty" value={basic.qty} onChange={handleBasicChange} className="w-full border rounded p-2 text-sm font-mono focus:ring-2 focus:ring-blue-500 outline-none bg-blue-50/30" />
                            </div>
                            
                            <div><label className="block text-xs font-medium text-gray-600 mb-1">期權單張價格</label><input type="number" step="0.01" name="premium" value={basic.premium} onChange={handleBasicChange} className="w-full border rounded p-2 text-sm font-mono focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                            <div><label className="block text-xs font-medium text-gray-600 mb-1">交易手續費</label><input type="number" step="0.01" name="fee" value={basic.fee} onChange={handleBasicChange} className="w-full border rounded p-2 text-sm font-mono focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                        </div>
                    </div>

                    {/* 右側：標的與日期 */}
                    <div className="space-y-6">
                        {/* 2. 標的信息 */}
                        <div className="space-y-4">
                            <h3 className="font-bold text-gray-700 bg-gray-50 p-2 rounded text-sm">2. 標的信息</h3>
                            <div className="grid grid-cols-2 gap-3">
                                <div><label className="block text-xs font-medium text-gray-600 mb-1">標的代碼 (Ticker)</label><input type="text" name="ticker" value={underlying.ticker} onChange={handleUnderlyingChange} className="w-full border rounded p-2 text-sm font-mono focus:ring-2 focus:ring-blue-500 outline-none uppercase" /></div>
                                <div><label className="block text-xs font-medium text-gray-600 mb-1">標的名稱</label><input type="text" name="name" value={underlying.name} onChange={handleUnderlyingChange} className="w-full border rounded p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                                <div><label className="block text-xs font-medium text-gray-600 mb-1">執行價 (Strike)</label><input type="number" step="0.01" name="strike" value={underlying.strike} onChange={handleUnderlyingChange} className="w-full border rounded p-2 text-sm font-mono font-bold text-blue-700 focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                                <div>
                                    <label className="block text-xs font-medium text-gray-600 mb-1 flex justify-between">
                                        <span>當前價 (Spot)</span><span className="text-[10px] text-gray-400">留白自動抓取</span>
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
                                <div><label className="block text-xs font-medium text-gray-600 mb-1">執行/到期日 (Expiry Date)</label><input type="date" name="expiryDate" value={dates.expiryDate} onChange={handleDatesChange} className="w-full border rounded p-2 text-sm font-mono font-bold focus:ring-2 focus:ring-blue-500 outline-none" /></div>
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
                        {isRunning ? (fetchStatus || '計算中...') : '錄入運行 (計算並預覽分發)'}
                    </button>
                </div>
            </div>

            {/* === 模塊 2：接貨展示模塊 (獨立模塊) === */}
            <div className="bg-white shadow rounded-lg p-6 border border-gray-200">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                        <Database size={20} className="text-orange-600"/>
                        【接貨展示模塊】
                    </h2>
                    <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded">當前綁定 TradeID: <span className="font-mono font-bold text-gray-700">{currentTradeId || '暫無'}</span></span>
                </div>

                {txRecords.length === 0 ? (
                    <div className="py-12 text-center text-gray-400 bg-gray-50 rounded-lg border border-dashed border-gray-200">
                        <AlertCircle size={32} className="mx-auto mb-2 opacity-50" />
                        <p>暫無期權交收/接貨紀錄產生</p>
                        <p className="text-xs mt-1">當期權到期且處於價內 (ITM) 時，會在此自動生成交收流水</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto border border-gray-200 rounded-lg mb-6 shadow-sm">
                        <table className="min-w-full divide-y divide-gray-200 text-sm text-left whitespace-nowrap">
                            <thead className="bg-gray-100 text-gray-600 font-medium">
                                <tr>
                                    <th className="px-3 py-3">日期</th>
                                    <th className="px-3 py-3">賬戶</th>
                                    <th className="px-3 py-3">方向</th>
                                    <th className="px-3 py-3">標的代碼</th>
                                    <th className="px-3 py-3 text-right">數量</th>
                                    <th className="px-3 py-3 text-right">均價</th>
                                    <th className="px-3 py-3 text-right">手續費</th>
                                    <th className="px-3 py-3 text-right">總額(含費)</th>
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
                        【錄入庫】覆蓋至 Get-Stock
                    </button>
                </div>
            </div>

            {/* --- 模塊 3：後台庫管理模塊 --- */}
            <div className="bg-white shadow rounded-lg p-6 border border-gray-200 mt-8">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                        <Database size={20} className="text-purple-600"/>
                        【後台庫管理模塊】
                    </h2>
                    <button onClick={() => fetchDbRecords(activeDbTab)} className="text-sm text-purple-600 hover:text-purple-800 flex items-center gap-1">
                        <RefreshCw size={14}/> 刷新數據
                    </button>
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
                                        <td className="px-3 py-2 text-xs font-mono text-blue-600">
                                            {r.tradeId || 'None'}
                                        </td>
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

            {/* --- Modals --- */}
            {/* 測算與分發確認 Modal (精簡版) */}
            {simResult && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-xl shadow-2xl p-0 w-full max-w-3xl flex flex-col overflow-hidden max-h-[90vh]">
                        <div className="px-6 py-4 bg-gray-50 border-b flex justify-between items-center">
                            <h3 className="font-bold text-xl flex items-center gap-2 text-gray-800">
                                <CheckCircle2 className="text-green-600"/> 期權測算與入庫預覽
                            </h3>
                            <button onClick={() => setSimResult(null)} className="text-gray-400 hover:text-gray-600"><X size={24}/></button>
                        </div>
                        
                        <div className="p-6 overflow-y-auto space-y-6 bg-white">
                            <div>
                                <div className="flex items-center justify-between mb-4 border-l-4 border-blue-500 pl-3">
                                    <div>
                                        <h4 className="text-lg font-bold text-gray-800">{simResult.name}</h4>
                                        <p className="text-sm text-gray-500">
                                            將分發至 <span className="font-mono font-bold text-blue-600 mx-1">{simResult.isExpired ? 'Died (歷史庫)' : 'Living (存續庫)'}</span> ({simResult.rawData.basic.currency})
                                        </p>
                                    </div>
                                    <div className={`px-4 py-1.5 rounded-full text-sm font-bold ${simResult.isExpired ? 'bg-orange-100 text-orange-700' : 'bg-green-100 text-green-700'}`}>
                                        {simResult.status}
                                    </div>
                                </div>
                                
                                <div className="grid grid-cols-2 gap-4 mb-4">
                                    <div className="bg-gray-50 p-4 rounded-lg border">
                                        <p className="text-xs text-gray-500 mb-1">底層股數 (Qty)</p>
                                        <p className={`text-lg font-bold font-mono ${simResult.rawData.basic.qty > 0 ? 'text-green-600' : 'text-red-600'}`}>{simResult.rawData.basic.qty}</p>
                                    </div>
                                    <div className="bg-gray-50 p-4 rounded-lg border">
                                        <p className="text-xs text-gray-500 mb-1">名義金額 (Notional)</p>
                                        <p className={`text-lg font-bold font-mono ${simResult.notional > 0 ? 'text-blue-600' : 'text-orange-600'}`}>
                                            {fmtMoney(simResult.notional)}
                                        </p>
                                    </div>
                                </div>

                                <div className="grid grid-cols-3 gap-4">
                                    <div className="bg-gray-50 p-4 rounded-lg border">
                                        <p className="text-xs text-gray-500 mb-1">期權金 (已實現)</p>
                                        <p className={`text-lg font-bold font-mono ${simResult.realizedPremium > 0 ? 'text-green-600' : 'text-red-600'}`}>
                                            {simResult.realizedPremium > 0 ? '+' : ''}{fmtMoney(simResult.realizedPremium)}
                                        </p>
                                    </div>
                                    <div className="bg-gray-50 p-4 rounded-lg border">
                                        <p className="text-xs text-gray-500 mb-1">預期收益 (未實現)</p>
                                        <p className={`text-lg font-bold font-mono ${simResult.unrealizedPnl > 0 ? 'text-green-600' : simResult.unrealizedPnl < 0 ? 'text-red-600' : 'text-gray-800'}`}>
                                            {simResult.unrealizedPnl > 0 ? '+' : ''}{fmtMoney(simResult.unrealizedPnl)}
                                        </p>
                                    </div>
                                    <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                                        <p className="text-xs text-blue-700 mb-1 font-bold">{simResult.isExpired ? '歷史總收益 (復盤)' : '當前總收益'}</p>
                                        <p className={`text-lg font-bold font-mono ${simResult.totalPnl > 0 ? 'text-green-600' : simResult.totalPnl < 0 ? 'text-red-600' : 'text-gray-800'}`}>
                                            {simResult.totalPnl > 0 ? '+' : ''}{fmtMoney(simResult.totalPnl)}
                                        </p>
                                    </div>
                                </div>
                            </div>

                            {/* 提示交收狀態，但不顯示表格 */}
                            {simResult.isExpired && (
                                <div className="mt-6 border-t pt-4">
                                    <h4 className="font-bold text-gray-800 mb-3 flex items-center gap-2">
                                        {simResult.hasDelivery ? <AlertCircle className="text-orange-500"/> : <CheckCircle2 className="text-gray-400"/>}
                                        到期結算判定
                                    </h4>
                                    
                                    {!simResult.hasDelivery ? (
                                        <div className="bg-gray-50 border border-dashed rounded-lg p-6 text-center text-gray-500">
                                            期權處於價外 (OTM)，未觸發行權，<strong className="text-gray-700">無交收接貨流水產生</strong>。
                                        </div>
                                    ) : (
                                        <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 text-orange-800 text-sm">
                                            ⚠️ <strong>已觸發實盤交收。</strong> 具體的交收接貨流水已自動生成並加載至頁面下方的 <strong>【接貨展示模塊】</strong>。請在完成本彈窗保存後，前往下方模塊核對並點擊覆寫入庫。
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        <div className="px-6 py-4 border-t bg-gray-50 flex justify-end gap-4">
                            <button onClick={() => setSimResult(null)} className="px-6 py-2 rounded-lg text-gray-600 font-bold bg-white border hover:bg-gray-100 transition-colors">取消返回</button>
                            <button onClick={handleConfirmSave} disabled={isSaving} className="px-6 py-2 rounded-lg text-white font-bold bg-blue-600 hover:bg-blue-700 flex items-center gap-2 transition-all shadow-md">
                                {isSaving ? <Loader2 className="animate-spin" size={18}/> : <Save size={18}/>} 確認保存輸入與計算結果
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* 修改 Raw JSON 彈窗 */}
            {editRecordModal && (
                <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
                    <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-5xl flex flex-col h-[85vh]">
                        <div className="flex justify-between items-center mb-4 border-b pb-4">
                            <h3 className="font-bold text-lg flex items-center gap-2 text-purple-700"><FileJson size={20}/> 進階修改記錄 - {editRecordModal?.record?.id}</h3>
                            <button onClick={() => setEditRecordModal(null)} className="text-gray-400 hover:text-gray-600"><X size={20}/></button>
                        </div>
                        <p className="text-xs text-gray-500 mb-2 border-l-2 border-orange-400 pl-2">
                            警告：直接修改 Raw JSON 屬於高階操作，請確保 JSON 格式合法且結構正確，否則可能會導致頁面崩潰或邏輯錯誤。
                        </p>
                        <textarea className="flex-1 w-full border rounded-md p-3 text-xs font-mono mb-4 focus:ring-2 focus:ring-purple-500 outline-none resize-none" value={editRecordModal?.rawJson || ''} onChange={(e) => setEditRecordModal(prev => prev ? {...prev, rawJson: e.target.value} : null)} />
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