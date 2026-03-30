'use client';

import React, { useState, useEffect } from 'react';
import { 
  Play, 
  Save, 
  Loader2, 
  AlertCircle,
  CheckCircle,
  X,
  Database,
  Trash2,
  RefreshCw,
  FileJson,
  Edit2
} from 'lucide-react';

import { collection, addDoc, serverTimestamp, getDocs, deleteDoc, doc, updateDoc } from 'firebase/firestore';
import { onAuthStateChanged, signInAnonymously, signInWithCustomToken } from 'firebase/auth';

// ============================================================================
// 引入你本地專案中真實的 Firebase 配置與定價引擎
// ============================================================================
import { db, auth, APP_ID } from '@/app/lib/stockService';
import { FCNPricer, FCNParams, FCNResult } from '@/app/lib/fcnPricer';

// --- 类型定义 ---
interface UnderlyingRow {
    id: string; ticker: string; name: string; initialPrice: string; currentPrice: string; dividendDate: string; dividendAmount: string;
}
interface DateRow {
    id: string; obsDate: string; payDate: string;
}
interface TransactionRecord {
    id?: string; date: string; account: string; market: string; executor: string; type: string; stockCode: string; stockName: string;
    direction: string; quantity: number; priceNoFee: number; amountNoFee: number; fee: number; amountWithFee: number; priceWithFee: number; hkdAmount: number;
    firebaseId?: string; // 新增：用于跟踪缓冲库中的底层文档 ID
    tradeId?: string;    // 新增：全局唯一关联 ID
}

// 示例参数
const EXAMPLE_PARAMS: FCNParams & { executor?: string } = {
    broker_name: "MS", account_name: "FUTU", executor: "Jerry", market: "HKD",
    total_notional: 2000000, denomination: 100000,
    tickers: ['9880.HK', '2050.HK', '6613.HK'], ticker_name: ["优必选", "三花", "蓝思"],
    initial_spots: [134.7, 40.06, 35.38], current_spots: [],
    trade_date: "2025-10-10", history_start_date: "2025-10-09",
    obs_dates: ["2025-11-24", "2025-12-24", "2026-01-26"], pay_dates: ["2025-11-26", "2025-12-30", "2026-01-28"],
    strike_pct: 0.825, trigger_pct: 1.00, coupon_rate: 0.2779, coupon_freq: 12, risk_free_rate: 0.03, n_sims: 5000, fx_rate: 1.0, seed: 42
};

const INITIAL_BASIC = {
    broker_name: '', account_name: '', executor: '', market: 'HKD', total_notional: '' as number | string,
    denomination: '' as number | string, trade_date: '', strike_pct: '' as number | string, trigger_pct: '' as number | string,
    coupon_rate: '' as number | string, coupon_freq: '' as number | string, risk_free_rate: '' as number | string,
    fx_rate: '' as number | string, history_start_date: '', n_sims: '' as number | string, seed: '' as number | string
};

// 辅助函数：将对象中所有的 undefined 替换为 null
const replaceUndefinedWithNull = (obj: any): any => {
    if (obj === undefined) {
        return null;
    }
    if (obj === null || typeof obj !== 'object') {
        return obj;
    }
    if (Array.isArray(obj)) {
        return obj.map(replaceUndefinedWithNull);
    }
    const newObj: any = {};
    for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
            newObj[key] = replaceUndefinedWithNull(obj[key]);
        }
    }
    return newObj;
};

export default function FCNTradePage() {
    // --- Auth State ---
    const [user, setUser] = useState<any>(null);

    // --- 【模块1: 参数输入】State ---
    const [basicParams, setBasicParams] = useState(INITIAL_BASIC);
    const [underlyingRows, setUnderlyingRows] = useState<UnderlyingRow[]>([{
        id: 'init_1', ticker: '', name: '', initialPrice: '', currentPrice: '', dividendDate: '', dividendAmount: ''
    }]);
    const [dateRows, setDateRows] = useState<DateRow[]>([{ id: 'init_d1', obsDate: '', payDate: '' }]);
    const [loading, setLoading] = useState(false);
    const [fetchStatus, setFetchStatus] = useState<string>('');

    // --- 子操作框 (Modal) State ---
    const [showResultModal, setShowResultModal] = useState(false);
    const [currentResult, setCurrentResult] = useState<FCNResult | null>(null);
    const [currentCalcParams, setCurrentCalcParams] = useState<any>(null);
    const [isHKDView, setIsHKDView] = useState(false); 

    // --- 【模块2: 接货展示】State ---
    const [deliveryRecords, setDeliveryRecords] = useState<TransactionRecord[]>([]);
    const [editingDeliveryIdx, setEditingDeliveryIdx] = useState<number | null>(null);
    const [editFormData, setEditFormData] = useState<TransactionRecord | null>(null);

    // --- 【模块3: 后台库管理】State ---
    const [activeDbTab, setActiveDbTab] = useState('sip_trade_fcn_input_living');
    const [dbRecords, setDbRecords] = useState<any[]>([]);
    const [loadingDb, setLoadingDb] = useState(false);
    const [editRecordModal, setEditRecordModal] = useState<{show: boolean, record: any, rawJson: string} | null>(null);

    // --- 初始化 Firebase Auth ---
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

    // --- 获取并刷新接货缓冲库数据 (新逻辑) ---
    const fetchPendingDeliveries = async () => {
        if (!user) return;
        try {
            const snap = await getDocs(collection(db, 'artifacts', APP_ID, 'public', 'data', 'sip_trade_fcn_pending_delivery'));
            const records = snap.docs.map(doc => ({ firebaseId: doc.id, ...doc.data() })) as any[];
            records.sort((a,b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
            setDeliveryRecords(records);
        } catch(e) {
            console.error("读取接货缓冲库失败:", e);
        }
    };

    // --- 获取并刷新后台库数据 ---
    const fetchDbRecords = async (collectionName: string) => {
        if (!user) return;
        setLoadingDb(true);
        try {
            const querySnapshot = await getDocs(collection(db, 'artifacts', APP_ID, 'public', 'data', collectionName));
            let records: any[] = [];
            querySnapshot.forEach((docSnap) => {
                records.push({ id: docSnap.id, ...docSnap.data() });
            });
            records.sort((a, b) => {
               const timeA = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
               const timeB = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
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
        if (user) {
            fetchDbRecords(activeDbTab);
            fetchPendingDeliveries(); // 加载时自动读取缓冲库
        }
    }, [activeDbTab, user]);

    // --- API 调用 (复用逻辑, 对齐 FCNPanel) ---
    const fetchQuotePrice = async (symbol: string): Promise<number | null> => {
        try {
            const res = await fetch(`/api/quote?symbol=${symbol}`);
            if (!res.ok) throw new Error('API Error');
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

    // --- 【模块1: 参数输入】Handers ---
    const handleBasicChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        if (value === '') { setBasicParams(prev => ({ ...prev, [name]: '' })); return; }
        let parsedValue: any = value;
        if (['total_notional', 'denomination', 'coupon_freq', 'n_sims', 'fx_rate', 'seed'].includes(name)) {
            const floatVal = parseFloat(value);
            parsedValue = isNaN(floatVal) ? '' : floatVal;
        }
        setBasicParams(prev => ({ ...prev, [name]: parsedValue }));
    };
    const handlePercentChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        if (value === '') { setBasicParams(prev => ({ ...prev, [name]: '' })); return; }
        const floatVal = parseFloat(value);
        setBasicParams(prev => ({ ...prev, [name]: isNaN(floatVal) ? '' : floatVal / 100 }));
    };

    const updateUnderlyingRow = (id: string, field: keyof UnderlyingRow, value: string) => setUnderlyingRows(underlyingRows.map(r => r.id === id ? { ...r, [field]: value } : r));
    const addUnderlyingRow = () => setUnderlyingRows([...underlyingRows, { id: Math.random().toString(36).substr(2, 9), ticker: '', name: '', initialPrice: '', currentPrice: '', dividendDate: '', dividendAmount: '' }]);
    const removeUnderlyingRow = (id: string) => setUnderlyingRows(underlyingRows.filter(r => r.id !== id));
    const updateDateRow = (id: string, field: keyof DateRow, value: string) => setDateRows(dateRows.map(r => r.id === id ? { ...r, [field]: value } : r));
    const addDateRow = () => setDateRows([...dateRows, { id: Math.random().toString(36).substr(2, 9), obsDate: '', payDate: '' }]);
    const removeDateRow = (id: string) => setDateRows(dateRows.filter(r => r.id !== id));

    const handleRunAndRecord = async () => {
        setLoading(true); setFetchStatus('参数解析中...');
        try {
            if (!basicParams.total_notional) throw new Error("请输入总名义本金");
            if (!basicParams.denomination) throw new Error("请输入单张面值");
            if (!basicParams.trade_date) throw new Error("请选择交易日期");
            if (basicParams.strike_pct === '') throw new Error("请输入敲入界限");
            if (basicParams.trigger_pct === '') throw new Error("请输入敲出界限");
            if (basicParams.coupon_rate === '') throw new Error("请输入年化票息");
            
            const tickers: string[] = [];
            const ticker_names: string[] = [];
            const initial_spots: number[] = [];
            const current_spots_manual: (number | null)[] = [];
            const discrete_dividends: { [key: string]: [string, number][] } = {};
            const processedTickers = new Set<string>();

            // 对齐 FCNPanel: 去重且组装 discrete_dividends
            for (const row of underlyingRows) {
                if (!row.ticker) continue;
                const divAmt = parseFloat(row.dividendAmount);
                if (row.dividendDate && row.dividendAmount && !isNaN(divAmt)) {
                    if (!discrete_dividends[row.ticker]) discrete_dividends[row.ticker] = [];
                    discrete_dividends[row.ticker].push([row.dividendDate, divAmt]);
                }
                if (!processedTickers.has(row.ticker)) {
                    processedTickers.add(row.ticker);
                    tickers.push(row.ticker);
                    ticker_names.push(row.name);
                    const initP = parseFloat(row.initialPrice);
                    if (isNaN(initP)) throw new Error(`标的 ${row.ticker} 初始价格无效`);
                    initial_spots.push(initP);
                    const cp = parseFloat(row.currentPrice);
                    current_spots_manual.push(isNaN(cp) ? null : cp);
                }
            }

            const obs_dates = dateRows.map(r => r.obsDate).filter(d => d);
            const pay_dates = dateRows.map(r => r.payDate).filter(d => d);

            if (tickers.length === 0) { throw new Error("请至少添加一个标的"); }
            if (obs_dates.length === 0) { throw new Error("请至少添加一个观察日"); }
            
            // 对齐 FCNPanel: 检查历史起始日
            const histStart = basicParams.history_start_date as string;
            if (!histStart) throw new Error("请添加历史数据起始日");
            if (histStart && basicParams.trade_date && histStart >= basicParams.trade_date) {
                throw new Error("历史数据起始日必须早于交易日");
            }

            const calcParams: FCNParams = {
                ...basicParams, tickers, ticker_name: ticker_names, initial_spots, current_spots: [],
                hist_prices: {}, discrete_dividends, obs_dates, pay_dates,
                fx_rate: basicParams.fx_rate === '' ? undefined : (basicParams.fx_rate as number),
                seed: basicParams.seed === '' ? undefined : (basicParams.seed as number),
                n_sims: basicParams.n_sims === '' ? 5000 : (basicParams.n_sims as number),
                coupon_freq: basicParams.coupon_freq === '' ? 12 : (basicParams.coupon_freq as number),
                risk_free_rate: basicParams.risk_free_rate === '' ? 0.03 : (basicParams.risk_free_rate as number),
                total_notional: Number(basicParams.total_notional), denomination: Number(basicParams.denomination),
                strike_pct: Number(basicParams.strike_pct), trigger_pct: Number(basicParams.trigger_pct),
                coupon_rate: Number(basicParams.coupon_rate),
            } as FCNParams;

            setFetchStatus('获取最新价...');
            const fetchedSpots = await Promise.all(tickers.map(async (t, i) => {
                const manual = current_spots_manual[i];
                if (manual !== null) return manual;
                setFetchStatus(`正在获取 ${t} 最新价格...`);
                const p = await fetchQuotePrice(t); 
                return p !== null ? p : initial_spots[i];
            }));
            calcParams.current_spots = fetchedSpots;

            // 对齐 FCNPanel: 更新UI上的当前价格
            const updatedRows = underlyingRows.map(row => {
                const tIdx = tickers.indexOf(row.ticker);
                if (tIdx !== -1 && fetchedSpots[tIdx] !== undefined) {
                    if (!row.currentPrice) {
                        return { ...row, currentPrice: fetchedSpots[tIdx].toString() };
                    }
                }
                return row;
            });
            setUnderlyingRows(updatedRows);

            // 对齐 FCNPanel: 判断是否需要拉取历史数据
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const hasPastObservation = obs_dates.some(d => new Date(d) <= today);

            if (hasPastObservation && histStart) {
                setFetchStatus('正在拉取历史K线数据...');
                const histDataMap: { [t: string]: any[] } = {};
                await Promise.all(tickers.map(async (t) => { 
                    histDataMap[t] = await fetchHistoricalPrices(t, histStart); 
                }));
                calcParams.hist_prices = histDataMap;
            }

            if (calcParams.market !== 'HKD' && (!calcParams.fx_rate || isNaN(calcParams.fx_rate))) {
                setFetchStatus(`正在获取 ${calcParams.market}/HKD 汇率...`);
                const fxSymbol = `${calcParams.market}HKD=X`;
                const rate = await fetchQuotePrice(fxSymbol);
                calcParams.fx_rate = rate !== null ? rate : 1.0;
                setBasicParams(prev => ({ ...prev, fx_rate: calcParams.fx_rate || '' }));
            } else if (calcParams.market === 'HKD') { 
                calcParams.fx_rate = 1.0; 
            }

            setFetchStatus('计算中...');
            
            setTimeout(() => {
                try {
                    // --- 呼叫真實的 FCNPricer 引擎 ---
                    const pricer = new FCNPricer(calcParams);
                    const res = pricer.simulate_price();
                    
                    setCurrentResult(res);
                    // 保存 updatedRows 以便入库
                    setCurrentCalcParams({ inputParams: basicParams, underlyingRows: updatedRows, dateRows, pricerParams: calcParams });
                    setShowResultModal(true); 
                } catch (e: any) { alert("计算错误: " + e.message); }
                finally { setLoading(false); setFetchStatus(''); }
            }, 50);

        } catch (e: any) {
            alert(e.message); setLoading(false); setFetchStatus('');
        }
    };

    // --- 子操作框 Handlers ---
    const handleSaveToDB = async () => {
        if (!user || !currentResult || !currentCalcParams) return;
        
        const status = currentResult.status;
        const isLiving = status === 'Active' || status === 'Settling_NoDelivery' || status === 'Settling_Delivery';
        const lifeCycle = isLiving ? 'living' : 'died';

        // 核心修复：生成唯一的 tradeId 来关联 input 和 output
        const tradeId = crypto.randomUUID();

        try {
            setLoading(true); setFetchStatus('写入资料库中...');

            // 在保存到数据库之前，清理数据中的 undefined，并注入 tradeId
            const cleanCalcParams = replaceUndefinedWithNull({ ...currentCalcParams, tradeId });
            const cleanResult = replaceUndefinedWithNull(currentResult);
            
            // 1. 保存输入参数 (带 tradeId)
            await addDoc(collection(db, 'artifacts', APP_ID, 'public', 'data', `sip_trade_fcn_input_${lifeCycle}`), {
                ...cleanCalcParams, createdAt: serverTimestamp()
            });
            
            // 2. 保存输出结果 (带 tradeId)
            await addDoc(collection(db, 'artifacts', APP_ID, 'public', 'data', `sip_holding_fcn_output_${lifeCycle}`), {
                result: cleanResult, tradeId, createdAt: serverTimestamp()
            });

            // 3. 处理接货状况: 【严格只在状态 F (Terminated_Delivery) 时生成接货记录】
            if (status === 'Terminated_Delivery') {
                const worstIdx = currentResult.loss_attribution.findIndex(val => val === 1.0);
                if (worstIdx !== -1) {
                    const pricerParams = currentCalcParams.pricerParams;
                    const ticker = pricerParams.tickers[worstIdx];
                    const strikePrice = pricerParams.initial_spots[worstIdx] * pricerParams.strike_pct;
                    const quantity = pricerParams.total_notional / strikePrice;
                    const amountNoFee = strikePrice * quantity;
                    const amountWithFee = amountNoFee;

                    const newDelivery: TransactionRecord = {
                        tradeId, // 关联接货记录
                        date: pricerParams.pay_dates[pricerParams.pay_dates.length - 1],
                        account: pricerParams.account_name || basicParams.account_name,
                        market: pricerParams.market === 'USD' ? 'US' : pricerParams.market === 'JPY' ? 'JP' : pricerParams.market === 'CNY' ? 'CH' : 'HK',
                        executor: pricerParams.executor || basicParams.executor,
                        type: "FCN接货",
                        stockCode: ticker,
                        stockName: pricerParams.ticker_name?.[worstIdx] || ticker,
                        direction: "BUY",
                        quantity: Math.round(quantity),
                        priceNoFee: strikePrice,
                        amountNoFee: amountNoFee,
                        fee: 0,
                        amountWithFee: amountWithFee,
                        priceWithFee: amountWithFee / quantity,
                        hkdAmount: amountWithFee * (pricerParams.fx_rate || 1.0)
                    };
                    
                    // 将生成的接货单存入缓冲库
                    const cleanDelivery = replaceUndefinedWithNull(newDelivery);
                    await addDoc(collection(db, 'artifacts', APP_ID, 'public', 'data', 'sip_trade_fcn_pending_delivery'), {
                        ...cleanDelivery, createdAt: serverTimestamp()
                    });
                    fetchPendingDeliveries(); // 重新获取更新后的缓冲数据

                    alert(`参数与结果已保存至 [${lifeCycle}] 库，并已自动生成接货纪录至下方展示模块(缓冲库)！`);
                }
            } else {
                alert(`参数与结果已成功保存至 [${lifeCycle}] 库！`);
            }
            setShowResultModal(false);
            fetchDbRecords(activeDbTab);
        } catch (e: any) {
            alert("保存失败: " + e.message);
        } finally {
            setLoading(false); setFetchStatus('');
        }
    };

    // --- 【模块2: 接货展示】Handers ---
    const handleEditDelivery = (idx: number) => {
        setEditingDeliveryIdx(idx);
        setEditFormData({ ...deliveryRecords[idx] });
    };

    const handleEditFormChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!editFormData) return;
        const { name, value } = e.target;
        let newData = { ...editFormData, [name]: value };
        
        if (['quantity', 'priceNoFee', 'fee'].includes(name)) {
            const qty = name === 'quantity' ? parseFloat(value) : newData.quantity;
            const price = name === 'priceNoFee' ? parseFloat(value) : newData.priceNoFee;
            const fee = name === 'fee' ? parseFloat(value) : newData.fee;
            
            if (!isNaN(qty) && !isNaN(price) && !isNaN(fee)) {
                newData.amountNoFee = qty * price;
                newData.amountWithFee = newData.amountNoFee + fee;
                newData.priceWithFee = qty > 0 ? newData.amountWithFee / qty : 0;
                newData.hkdAmount = newData.amountWithFee * (basicParams.fx_rate as number || 1.0);
            }
        }
        setEditFormData(newData as any);
    };

    const handleSaveDeliveryEdit = async () => {
        if (editingDeliveryIdx === null || !editFormData) return;
        const record = deliveryRecords[editingDeliveryIdx];
        try {
            setLoading(true); setFetchStatus('正在更新缓冲库...');
            if (record.firebaseId) {
                 const cleanRecord = replaceUndefinedWithNull(editFormData);
                 const { firebaseId, ...recordData } = cleanRecord;
                 await updateDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'sip_trade_fcn_pending_delivery', firebaseId), recordData);
            }
            await fetchPendingDeliveries();
            setEditingDeliveryIdx(null);
            setEditFormData(null);
        } catch(e: any) {
            alert("修改失败: " + e.message);
        } finally {
            setLoading(false); setFetchStatus('');
        }
    };

    const handleSaveDeliveriesToDB = async () => {
        if (!user || deliveryRecords.length === 0) return;
        if (!confirm(`确认将这 ${deliveryRecords.length} 笔待处理的接货记录，正式推送到实际持仓库 (get-stock) 中吗？`)) return;

        try {
            setLoading(true); setFetchStatus('正在推送到持仓接货库...');
            for (const record of deliveryRecords) {
                const cleanRecord = replaceUndefinedWithNull(record);
                const { firebaseId, ...recordData } = cleanRecord;
                
                // 1. 推送到最终的 get-stock 库
                await addDoc(collection(db, 'artifacts', APP_ID, 'public', 'data', 'sip_holding_fcn_output_get-stock'), {
                    ...recordData,
                    createdAt: serverTimestamp()
                });

                // 2. 从 pending_delivery 缓冲库中删除以完成闭环流转
                if (firebaseId) {
                    await deleteDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'sip_trade_fcn_pending_delivery', firebaseId));
                }
            }
            alert("接货数据已成功推送到实际持仓接货库 (get-stock)，并清理了缓冲池！");
            await fetchPendingDeliveries(); 
            if (activeDbTab === 'sip_holding_fcn_output_get-stock') fetchDbRecords(activeDbTab);
        } catch (e: any) {
            alert("录入失败: " + e.message);
        } finally {
            setLoading(false); setFetchStatus('');
        }
    };

    // --- 【模块3: 后台库管理】Handlers ---
    const handleDeleteRecord = async (id: string) => {
        if (!confirm("确定要永久删除这条记录吗？不可恢复。")) return;
        try {
            await deleteDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', activeDbTab, id));
            setDbRecords(dbRecords.filter(r => r.id !== id));
        } catch(e: any) {
            alert("删除失败: " + e.message);
        }
    };

    const handleSaveRecordEdit = async () => {
        if (!editRecordModal) return;
        try {
            const parsedData = JSON.parse(editRecordModal.rawJson);
            const docId = parsedData.id || editRecordModal.record.id;
            delete parsedData.id; 
            
            await updateDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', activeDbTab, docId), parsedData);
            alert("数据修改成功！");
            setEditRecordModal(null);
            fetchDbRecords(activeDbTab); 
        } catch(e: any) {
            alert("修改失败 (请检查 JSON 格式是否正确): \n" + e.message);
        }
    };

    // --- UI Formatting Helpers ---
    const pctToInput = (val: number | string) => {
        if (val === '' || val === undefined) return '';
        return parseFloat((Number(val) * 100).toFixed(4)).toString();
    };
    const fmtPct = (val: number) => (val * 100).toFixed(2) + '%';
    const getDisplayCurrency = () => isHKDView ? 'HKD' : (basicParams.market || 'HKD');
    const getDisplayValue = (val: number) => {
        const rate = typeof basicParams.fx_rate === 'number' ? basicParams.fx_rate : 1.0;
        if (isHKDView) return val * rate;
        return val;
    };
    const fmtMoney = (val: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: getDisplayCurrency() }).format(val);
    const calcExpectedCouponPeriods = (res: FCNResult) => {
        const total_return = res.hist_coupons_paid + res.pending_coupons_pv + res.future_coupons_pv;
        return res.avg_period_coupon > 0 ? total_return / res.avg_period_coupon : 0;
    };
    const getUniqueTickersForDisplay = () => {
        const seen = new Set();
        return underlyingRows.filter(row => {
            const duplicate = seen.has(row.ticker);
            if (row.ticker) seen.add(row.ticker);
            return !duplicate && row.ticker;
        });
    };
    const getStatusDisplay = (status: FCNResult['status']) => {
        switch (status) {
            case 'Active': return { text: '存续中', color: 'bg-green-100 text-green-800' };
            case 'Settling_NoDelivery': return { text: '结算中 (无接货)', color: 'bg-blue-100 text-blue-800' };
            case 'Settling_Delivery': return { text: '结算中 (有接货)', color: 'bg-orange-100 text-orange-800' };
            case 'Terminated_Early': return { text: '已结束 (提前敲出)', color: 'bg-gray-100 text-gray-800' };
            case 'Terminated_Normal': return { text: '已结束 (自然到期)', color: 'bg-gray-100 text-gray-800' };
            case 'Terminated_Delivery': return { text: '已结束 (已接货)', color: 'bg-gray-100 text-gray-800' };
            default: return { text: status, color: 'bg-gray-100 text-gray-800' };
        }
    };
    const shouldShowTotalPL = (status: FCNResult['status']) => !status.startsWith('Terminated');
    const shouldShowRiskAttribution = (res: FCNResult) => {
        if (res.status === 'Settling_Delivery') return true;
        if (res.status === 'Active' && res.loss_prob > 0) return true;
        return false;
    };

    return (
        <div className="space-y-8 pb-10">
            {/* Header */}
            <div className="border-b border-gray-200 pb-4">
                <h1 className="text-2xl font-bold text-gray-900">FCN Trade (发行录入)</h1>
                <p className="mt-1 text-sm text-gray-500">用于录入FCN参数、执行引擎测算，并依据生命周期自动分发至 Living/Died 库与接货管理库。</p>
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
                            <div><label className="block text-gray-600 mb-1">券商 (Broker)</label><input type="text" name="broker_name" value={basicParams.broker_name} onChange={handleBasicChange} placeholder={EXAMPLE_PARAMS.broker_name} className="w-full border-gray-300 rounded border p-1.5 outline-none focus:ring-1 focus:ring-blue-500" /></div>
                            <div><label className="block text-gray-600 mb-1">账户 (Account)</label><input type="text" name="account_name" value={basicParams.account_name} onChange={handleBasicChange} placeholder={EXAMPLE_PARAMS.account_name} className="w-full border-gray-300 rounded border p-1.5 outline-none focus:ring-1 focus:ring-blue-500" /></div>
                            <div><label className="block text-gray-600 mb-1">执行人 (Executor)</label><input type="text" name="executor" value={basicParams.executor} onChange={handleBasicChange} placeholder={EXAMPLE_PARAMS.executor} className="w-full border-gray-300 rounded border p-1.5 outline-none focus:ring-1 focus:ring-blue-500" /></div>
                            <div>
                                <label className="block text-gray-600 mb-1">计价货币</label>
                                <select name="market" value={basicParams.market} onChange={handleBasicChange} className="w-full border-gray-300 rounded border p-1.5 outline-none">
                                    <option value="HKD">HKD</option><option value="USD">USD</option><option value="CNY">CNY</option><option value="JPY">JPY</option>
                                </select>
                            </div>
                            <div><label className="block text-gray-600 mb-1">总名义本金</label><input type="number" name="total_notional" value={basicParams.total_notional} onChange={handleBasicChange} placeholder={EXAMPLE_PARAMS.total_notional.toString()} className="w-full border-gray-300 rounded border p-1.5 outline-none" /></div>
                            <div><label className="block text-gray-600 mb-1">单张面值</label><input type="number" name="denomination" value={basicParams.denomination} onChange={handleBasicChange} placeholder={EXAMPLE_PARAMS.denomination.toString()} className="w-full border-gray-300 rounded border p-1.5 outline-none" /></div>
                            <div className="col-span-2"><label className="block text-gray-600 mb-1">交易日期 (Trade Date)</label><input type="date" name="trade_date" value={basicParams.trade_date} onChange={handleBasicChange} className="w-full border-gray-300 rounded border p-1.5 outline-none" /></div>
                            <div><label className="block text-gray-600 mb-1">敲出界限 (%)</label><input type="number" step="0.01" name="trigger_pct" value={pctToInput(basicParams.trigger_pct)} onChange={handlePercentChange} placeholder={(EXAMPLE_PARAMS.trigger_pct * 100).toString()} className="w-full border-gray-300 rounded border p-1.5 outline-none" /></div>
                            <div><label className="block text-gray-600 mb-1">敲入界限 (%)</label><input type="number" step="0.01" name="strike_pct" value={pctToInput(basicParams.strike_pct)} onChange={handlePercentChange} placeholder={(EXAMPLE_PARAMS.strike_pct * 100).toString()} className="w-full border-gray-300 rounded border p-1.5 outline-none" /></div>
                            <div className="col-span-2"><label className="block text-gray-600 mb-1">年化票息 (%)</label><input type="number" step="0.01" name="coupon_rate" value={pctToInput(basicParams.coupon_rate)} onChange={handlePercentChange} placeholder={(EXAMPLE_PARAMS.coupon_rate * 100).toString()} className="w-full border-gray-300 rounded border p-1.5 outline-none" /></div>
                        </div>
                    </div>

                    {/* 右半：标的与模拟 */}
                    <div className="space-y-6">
                        <div>
                            <div className="flex justify-between items-center mb-2">
                                <h3 className="text-sm font-bold text-gray-800 border-l-4 border-blue-500 pl-2">2. 标的信息</h3>
                                <button onClick={addUnderlyingRow} className="text-xs text-blue-600 hover:text-blue-800 font-medium">+ 添加标的</button>
                            </div>
                            <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                                {underlyingRows.map(row => (
                                    <div key={row.id} className="bg-gray-50 p-2 rounded border border-gray-200 text-xs">
                                        <div className="grid grid-cols-2 gap-2 mb-2">
                                            <input placeholder="代码" value={row.ticker} onChange={(e) => updateUnderlyingRow(row.id, 'ticker', e.target.value)} className="border-gray-300 rounded p-1" />
                                            <input placeholder="名称" value={row.name} onChange={(e) => updateUnderlyingRow(row.id, 'name', e.target.value)} className="border-gray-300 rounded p-1" />
                                        </div>
                                        <div className="grid grid-cols-2 gap-2 mb-2">
                                            <input type="number" placeholder="初始价" value={row.initialPrice} onChange={(e) => updateUnderlyingRow(row.id, 'initialPrice', e.target.value)} className="border-gray-300 rounded p-1" />
                                            <input type="number" placeholder="当前价" value={row.currentPrice} onChange={(e) => updateUnderlyingRow(row.id, 'currentPrice', e.target.value)} className="border-gray-300 rounded p-1 bg-blue-50" />
                                        </div>
                                        <div className="grid grid-cols-5 gap-2 items-center">
                                            <div className="col-span-2"><input type="date" placeholder="分红日" value={row.dividendDate} onChange={(e) => updateUnderlyingRow(row.id, 'dividendDate', e.target.value)} className="w-full border-gray-300 rounded p-1" /></div>
                                            <div className="col-span-2"><input type="number" step="0.01" placeholder="分红额" value={row.dividendAmount} onChange={(e) => updateUnderlyingRow(row.id, 'dividendAmount', e.target.value)} className="w-full border-gray-300 rounded p-1" /></div>
                                            <button onClick={() => removeUnderlyingRow(row.id)} className="text-red-500 hover:text-red-700 text-center">删</button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div>
                            <div className="flex justify-between items-center mb-2">
                                <h3 className="text-sm font-bold text-gray-800 border-l-4 border-blue-500 pl-2">3. 日期信息</h3>
                                <button onClick={addDateRow} className="text-xs text-blue-600 hover:text-blue-800 font-medium">+ 添加日期</button>
                            </div>
                            <div className="space-y-1 max-h-32 overflow-y-auto pr-1">
                                {dateRows.map(row => (
                                    <div key={row.id} className="grid grid-cols-7 gap-1 items-center">
                                        <input type="date" value={row.obsDate} onChange={(e) => updateDateRow(row.id, 'obsDate', e.target.value)} className="col-span-3 text-xs border-gray-300 rounded p-1" />
                                        <input type="date" value={row.payDate} onChange={(e) => updateDateRow(row.id, 'payDate', e.target.value)} className="col-span-3 text-xs border-gray-300 rounded p-1" />
                                        <button onClick={() => removeDateRow(row.id)} className="col-span-1 text-red-500 hover:text-red-700 text-xs text-center">删</button>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div>
                            <h3 className="text-sm font-bold text-gray-800 border-l-4 border-blue-500 pl-2 mb-2">4. 模拟信息</h3>
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs">
                                <div><label className="block text-gray-600 mb-1">模拟汇率 (To HKD)</label><input type="number" step="0.0001" name="fx_rate" value={basicParams.fx_rate} onChange={handleBasicChange} placeholder="自动" className="w-full border-gray-300 rounded border p-1" /></div>
                                <div><label className="block text-gray-600 mb-1">历史起始日</label><input type="date" name="history_start_date" value={basicParams.history_start_date} max={basicParams.trade_date} onChange={handleBasicChange} className="w-full border-gray-300 rounded border p-1" /></div>
                                <div><label className="block text-gray-600 mb-1">模拟次数</label><input type="number" name="n_sims" value={basicParams.n_sims} onChange={handleBasicChange} placeholder="5000" className="w-full border-gray-300 rounded border p-1" /></div>
                                <div><label className="block text-gray-600 mb-1">无风险利率 (%)</label><input type="number" step="0.01" name="risk_free_rate" value={pctToInput(basicParams.risk_free_rate)} onChange={handlePercentChange} placeholder="3" className="w-full border-gray-300 rounded border p-1" /></div>
                                <div><label className="block text-gray-600 mb-1">随机种子 (Seed)</label><input type="number" name="seed" value={basicParams.seed} onChange={handleBasicChange} placeholder="随机" className="w-full border-gray-300 rounded border p-1" /></div>
                                <div>
                                    <label className="block text-gray-600 mb-1">&nbsp;</label>
                                    <button onClick={() => {
                                        setBasicParams({ ...INITIAL_BASIC, ...EXAMPLE_PARAMS });
                                        setUnderlyingRows(EXAMPLE_PARAMS.tickers.map((t, i) => ({ id: `ex_${i}`, ticker: t, name: EXAMPLE_PARAMS.ticker_name?.[i] || '', initialPrice: EXAMPLE_PARAMS.initial_spots[i].toString(), currentPrice: '', dividendDate: '', dividendAmount: '' })));
                                        setDateRows(EXAMPLE_PARAMS.obs_dates.map((d, i) => ({ id: `ex_d_${i}`, obsDate: d, payDate: EXAMPLE_PARAMS.pay_dates[i] })));
                                    }} className="w-full bg-gray-100 text-gray-600 p-1 rounded hover:bg-gray-200 border">载入测试数据</button>
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

            {/* === 子操作框 Modal (包含详细 FCNPanel 报告) === */}
            {showResultModal && currentResult && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 animate-in fade-in p-4">
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl h-[90vh] flex flex-col relative overflow-hidden">
                        
                        {/* Modal Header */}
                        <div className="px-6 py-4 border-b flex justify-between items-center bg-gray-50 flex-shrink-0">
                            <div>
                                <h3 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                                    <CheckCircle className="text-green-500" size={24} />
                                    计算完成 - FCN 估值报告
                                </h3>
                                <p className="text-sm text-gray-500 mt-1">请确认下方测算结果与状态后，再进行保存入库。</p>
                            </div>
                            <button onClick={() => setShowResultModal(false)} className="text-gray-400 hover:text-gray-600 bg-white p-1 rounded-full shadow-sm border"><X size={24}/></button>
                        </div>

                        {/* Modal Body (Scrollable Detailed Result from FCNPanel) */}
                        <div className="p-6 overflow-y-auto flex-1 bg-white space-y-6">
                            
                            {/* 报告头部与状态 */}
                            <div className="border-b border-gray-200 pb-4">
                                <div className="flex justify-between items-start">
                                    <div>
                                        <h2 className="text-lg font-bold text-gray-900">{currentResult.product_name_display}</h2>
                                    </div>
                                    <button onClick={() => setIsHKDView(!isHKDView)} className={`px-3 py-1 text-xs font-medium rounded border transition-colors ${isHKDView ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}>
                                        {isHKDView ? '已转为 HKD' : 'HKD 转换'}
                                    </button>
                                </div>
                                <div className="mt-2 flex items-center space-x-2">
                                    <span className={`px-2 py-1 rounded text-xs font-semibold ${getStatusDisplay(currentResult.status).color}`}>
                                        {getStatusDisplay(currentResult.status).text}
                                    </span>
                                </div>
                                {currentResult.status === 'Active' && (
                                    <div className="mt-2 text-sm text-gray-600">预期收息期数: <span className="font-semibold">{calcExpectedCouponPeriods(currentResult).toFixed(2)} 期</span></div>
                                )}
                            </div>

                            {/* 结算提示 (如有) */}
                            {currentResult.status !== 'Active' && currentResult.settlement_info && (
                                <div className="bg-orange-50 border-l-4 border-orange-400 p-4 mb-4">
                                    <p className="text-sm text-orange-700">{currentResult.settlement_info.desc}</p>
                                </div>
                            )}

                            {/* 单价估值 & 持仓损益 */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="bg-gray-50 p-4 rounded-lg">
                                    <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-3">单价估值 (Par={basicParams.denomination})</h3>
                                    <div className="space-y-2 text-sm text-gray-700">
                                        <div className="flex justify-between"><span>全价</span><span className="font-semibold">{(currentResult.dirty_price + currentResult.hist_coupons_paid).toFixed(2)}</span></div>
                                        <div className="flex justify-between"><span>现值 (Dirty)</span><span className="font-bold text-blue-600">{currentResult.dirty_price.toFixed(2)}</span></div>
                                        <div className="text-xs text-right text-gray-400">本金 {(currentResult.principal_pv).toFixed(2)} + 待付/未来票息 {(currentResult.pending_coupons_pv + currentResult.future_coupons_pv).toFixed(2)}</div>
                                    </div>
                                </div>

                                <div className="bg-gray-50 p-4 rounded-lg">
                                    <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-3">持仓损益 ({getDisplayCurrency()})</h3>
                                    <div className="space-y-2 text-sm text-gray-700">
                                        <div className="flex justify-between"><span>总名义本金</span><span>{fmtMoney(Number(basicParams.total_notional))}</span></div>
                                        <div className="flex justify-between"><span>当前市值</span><span className="font-semibold">{fmtMoney(getDisplayValue(currentResult.dirty_price * (Number(basicParams.total_notional) / Number(basicParams.denomination))))}</span></div>
                                        <div className="flex justify-between text-gray-600"><span>已实现票息</span><span>{fmtMoney(getDisplayValue(currentResult.hist_coupons_paid * (Number(basicParams.total_notional) / Number(basicParams.denomination))))}</span></div>
                                        <div className="flex justify-between text-gray-600"><span>未实现损益</span><span>{fmtMoney(getDisplayValue(((currentResult.pending_coupons_pv + currentResult.future_coupons_pv) - currentResult.implied_loss_pv) * (Number(basicParams.total_notional) / Number(basicParams.denomination))))}</span></div>
                                        {shouldShowTotalPL(currentResult.status) && (
                                            <div className="border-t border-gray-200 my-2 pt-2 flex justify-between font-bold"><span>累计总损益</span><span className={(currentResult.dirty_price + currentResult.hist_coupons_paid - Number(basicParams.denomination)) >= 0 ? 'text-green-600' : 'text-red-600'}>{fmtMoney(getDisplayValue((currentResult.dirty_price + currentResult.hist_coupons_paid - Number(basicParams.denomination)) * (Number(basicParams.total_notional) / Number(basicParams.denomination))))}</span></div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* 风险概率 */}
                            <div>
                                <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-3">风险概率</h3>
                                <div className="grid grid-cols-2 gap-4 text-center">
                                    <div className="p-3 border rounded-md">
                                        <div className="text-xs text-gray-500">提前赎回概率</div>
                                        <div className="text-lg font-bold text-gray-800">{fmtPct(currentResult.early_redemption_prob)}</div>
                                    </div>
                                    <div className="p-3 border rounded-md">
                                        <div className="text-xs text-gray-500">敲入接货概率</div>
                                        <div className="text-lg font-bold text-red-600">{fmtPct(currentResult.loss_prob)}</div>
                                    </div>
                                </div>
                            </div>

                            {/* 提前敲出分佈 */}
                            {currentResult.early_redemption_prob > 0 && (
                                <div>
                                    <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-3">提前敲出分布</h3>
                                    <div className="overflow-x-auto">
                                        <table className="min-w-full divide-y divide-gray-200 text-sm">
                                            <thead><tr><th className="px-3 py-2 text-left font-medium text-gray-500">期数</th><th className="px-3 py-2 text-left font-medium text-gray-500">观察日</th><th className="px-3 py-2 text-right font-medium text-gray-500">概率</th></tr></thead>
                                            <tbody className="divide-y divide-gray-200">
                                                {currentResult.autocall_attribution.map((prob, idx) => { 
                                                    if (prob <= 0.0001) return null; 
                                                    const today = new Date(); today.setHours(0, 0, 0, 0); 
                                                    const futureDates = currentResult.status === 'Active' ? dateRows.map(r => r.obsDate).filter(d => new Date(d) > today) : []; 
                                                    const dateStr = futureDates[idx] || `Future Obs ${idx + 1}`; 
                                                    return (
                                                        <tr key={idx}><td className="px-3 py-2 text-gray-900">未来第 {idx + 1} 个观察日</td><td className="px-3 py-2 text-gray-500">{dateStr}</td><td className="px-3 py-2 text-right">{fmtPct(prob)}</td></tr>
                                                    ); 
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}

                            {/* 接货风险归因 */}
                            {shouldShowRiskAttribution(currentResult) && (
                                <div>
                                    <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-3">
                                        {currentResult.status === 'Settling_Delivery' ? '接货详情 (已确定)' : '接货风险归因 (预期)'}
                                    </h3>
                                    <div className="overflow-x-auto">
                                        <table className="min-w-full divide-y divide-gray-200 text-sm">
                                            <thead>
                                                <tr>
                                                    <th className="px-3 py-2 text-left font-medium text-gray-500">标的</th>
                                                    <th className="px-3 py-2 text-right font-medium text-gray-500">归因概率</th>
                                                    <th className="px-3 py-2 text-right font-medium text-gray-500">暴露成本价</th>
                                                    <th className="px-3 py-2 text-right font-medium text-gray-500">现价</th>
                                                    <th className="px-3 py-2 text-right font-medium text-gray-500">暴露股数</th>
                                                    <th className="px-3 py-2 text-right font-medium text-gray-500">暴露成本</th>
                                                    <th className="px-3 py-2 text-right font-medium text-gray-500">暴露市值</th>
                                                    <th className="px-3 py-2 text-right font-medium text-gray-500">暴露盈亏比</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-200">
                                                {getUniqueTickersForDisplay().map((row, idx) => {
                                                    const initialP = parseFloat(row.initialPrice) || 0;
                                                    const currentP = parseFloat(row.currentPrice) || initialP;
                                                    const strikePct = Number(basicParams.strike_pct) || 0;
                                                    const strikePrice = initialP * strikePct;
                                                    const attributionProb = currentResult.loss_attribution[idx] || 0;
                                                    const factor = Number(basicParams.total_notional) / Number(basicParams.denomination);
                                                    const exposureShares = (currentResult.exposure_shares_avg[idx] || 0) * factor;
                                                    const exposureCost = strikePrice * exposureShares;
                                                    const exposureMktVal = currentP * exposureShares;
                                                    let pnlDisplay = "-";
                                                    let pnlClass = "text-gray-500";
                                                    if (exposureCost > 0.0001) {
                                                        const pnlPct = (exposureMktVal / exposureCost) - 1;
                                                        pnlDisplay = fmtPct(pnlPct);
                                                        pnlClass = pnlPct >= 0 ? 'text-green-600' : 'text-red-600';
                                                    }
                                                    return (
                                                        <tr key={row.ticker} className={attributionProb === 1 ? "bg-red-50" : ""}>
                                                            <td className="px-3 py-2 text-gray-900">{row.name || row.ticker}<span className="block text-xs text-gray-400">{row.ticker}</span></td>
                                                            <td className="px-3 py-2 text-right">{fmtPct(attributionProb)}</td>
                                                            <td className="px-3 py-2 text-right text-gray-600">{strikePrice.toFixed(2)}</td>
                                                            <td className="px-3 py-2 text-right text-gray-600">{currentP.toFixed(2)}</td>
                                                            <td className="px-3 py-2 text-right">{exposureShares.toFixed(0)}</td>
                                                            <td className="px-3 py-2 text-right">{fmtMoney(getDisplayValue(exposureCost))}</td>
                                                            <td className="px-3 py-2 text-right">{fmtMoney(getDisplayValue(exposureMktVal))}</td>
                                                            <td className={`px-3 py-2 text-right font-medium ${pnlClass}`}>{pnlDisplay}</td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}

                            {/* 股价点位图 */}
                            {(currentResult.status === 'Active' || currentResult.status === 'Settling_Delivery' || currentResult.status === 'Settling_NoDelivery') && (
                                <div>
                                    <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-3">股价点位图</h3>
                                    <div className="space-y-6">
                                        {getUniqueTickersForDisplay().map((row, idx) => {
                                            const initial = parseFloat(row.initialPrice);
                                            const current = parseFloat(row.currentPrice) || initial;
                                            const strike = initial * (Number(basicParams.strike_pct) || 0);
                                            const ko = initial * (Number(basicParams.trigger_pct) || 0);

                                            const leftPct = (strike / current) - 1;
                                            const rightPct = (ko / current) - 1;

                                            const values = [strike, current, ko];
                                            const minVal = Math.min(...values) * 0.85;
                                            const maxVal = Math.max(...values) * 1.15;
                                            const range = maxVal - minVal;

                                            const getPos = (val: number) => ((val - minVal) / range) * 100;

                                            return (
                                                <div key={row.ticker} className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm">
                                                    <div className="flex justify-between items-end mb-4">
                                                        <div>
                                                            <span className="text-lg font-bold text-gray-800 mr-2">{row.name || row.ticker}</span>
                                                            <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">{row.ticker}</span>
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
                                                            <div className="absolute top-1/2 h-1.5 bg-blue-50 transform -translate-y-1/2" style={{ left: `${getPos(strike)}%`, width: `${getPos(ko) - getPos(strike)}%` }}></div>
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
                            )}

                        </div>

                        {/* Modal Footer (Action Buttons) */}
                        <div className="px-6 py-4 border-t bg-gray-50 flex justify-between items-center flex-shrink-0">
                            <div className="text-sm">
                                <span className="text-gray-600 mr-2">系统判定录入路径: </span>
                                {['Active', 'Settling_NoDelivery', 'Settling_Delivery'].includes(currentResult.status) ? (
                                    <span className="font-bold text-green-600 flex items-center gap-1 inline-flex"><CheckCircle size={16}/> Living (存续库)</span>
                                ) : (
                                    <span className="font-bold text-orange-600 flex items-center gap-1 inline-flex"><AlertCircle size={16}/> Died (已结束库)</span>
                                )}
                            </div>
                            
                            <div className="flex gap-3 w-[40%]">
                                {['Active', 'Settling_NoDelivery', 'Settling_Delivery'].includes(currentResult.status) ? (
                                    <button onClick={handleSaveToDB} disabled={loading} className="flex-1 bg-green-600 hover:bg-green-700 text-white font-bold py-3 rounded-md flex items-center justify-center gap-2 shadow-md transition-colors">
                                        {loading ? <Loader2 className="animate-spin" size={18}/> : <Save size={18}/>}
                                        保存结果入库 (Living)
                                    </button>
                                ) : (
                                    <button onClick={handleSaveToDB} disabled={loading} className="flex-1 bg-orange-600 hover:bg-orange-700 text-white font-bold py-3 rounded-md flex items-center justify-center gap-2 shadow-md transition-colors">
                                        {loading ? <Loader2 className="animate-spin" size={18}/> : <Save size={18}/>}
                                        保存结果入库 (Died)
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
                    <span className="text-sm text-gray-500">待入库接货记录: {deliveryRecords.length} 笔</span>
                </div>

                {deliveryRecords.length === 0 ? (
                    <div className="py-10 text-center text-gray-400 bg-gray-50 rounded-lg border border-dashed border-gray-200">
                        <AlertCircle size={32} className="mx-auto mb-2 opacity-50" />
                        <p>暂无待处理的接货记录</p>
                        <p className="text-xs mt-1">当录入运行结果为「Terminated_Delivery」时会自动生成</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto border rounded-lg mb-6">
                        <table className="min-w-full divide-y divide-gray-200 text-sm text-left">
                            <thead className="bg-gray-50 text-gray-500 font-medium">
                                <tr>
                                    <th className="px-3 py-2">日期/账户</th>
                                    <th className="px-3 py-2">标的代码/名称</th>
                                    <th className="px-3 py-2 text-right">接货数量</th>
                                    <th className="px-3 py-2 text-right">接货单价(不含费)</th>
                                    <th className="px-3 py-2 text-right">手续费</th>
                                    <th className="px-3 py-2 text-right">接货总额(含费)</th>
                                    <th className="px-3 py-2 text-center">操作</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 bg-white">
                                {deliveryRecords.map((t, idx) => (
                                    <tr key={idx} className="hover:bg-blue-50/50 transition-colors">
                                        {editingDeliveryIdx === idx && editFormData ? (
                                            // 编辑状态
                                            <>
                                                <td className="px-3 py-2">
                                                    <input type="date" name="date" value={editFormData.date} onChange={handleEditFormChange} className="border p-1 text-xs w-full mb-1 rounded"/>
                                                    <input type="text" name="account" value={editFormData.account} onChange={handleEditFormChange} className="border p-1 text-xs w-full rounded"/>
                                                </td>
                                                <td className="px-3 py-2">
                                                    <input type="text" name="stockCode" value={editFormData.stockCode} onChange={handleEditFormChange} className="border p-1 text-xs w-full mb-1 rounded"/>
                                                    <input type="text" name="stockName" value={editFormData.stockName} onChange={handleEditFormChange} className="border p-1 text-xs w-full rounded"/>
                                                </td>
                                                <td className="px-3 py-2 text-right"><input type="number" name="quantity" value={editFormData.quantity} onChange={handleEditFormChange} className="border p-1 text-xs w-24 text-right rounded"/></td>
                                                <td className="px-3 py-2 text-right"><input type="number" step="0.0001" name="priceNoFee" value={editFormData.priceNoFee} onChange={handleEditFormChange} className="border p-1 text-xs w-24 text-right rounded"/></td>
                                                <td className="px-3 py-2 text-right"><input type="number" step="0.01" name="fee" value={editFormData.fee} onChange={handleEditFormChange} className="border p-1 text-xs w-20 text-right rounded"/></td>
                                                <td className="px-3 py-2 text-right font-mono font-medium text-blue-700 bg-blue-50">{fmtMoney(editFormData.amountWithFee)}</td>
                                                <td className="px-3 py-2 text-center">
                                                    <button onClick={handleSaveDeliveryEdit} className="text-white bg-blue-600 hover:bg-blue-700 px-2 py-1 rounded text-xs font-bold">保存修改</button>
                                                </td>
                                            </>
                                        ) : (
                                            // 浏览状态
                                            <>
                                                <td className="px-3 py-2 text-gray-600"><div>{t.date}</div><div className="text-xs">{t.account}</div></td>
                                                <td className="px-3 py-2 font-medium"><div>{t.stockCode}</div><div className="text-xs text-gray-500">{t.stockName}</div></td>
                                                <td className="px-3 py-2 text-right font-mono">{t.quantity.toLocaleString()}</td>
                                                <td className="px-3 py-2 text-right font-mono">{fmtMoney(t.priceNoFee)}</td>
                                                <td className="px-3 py-2 text-right font-mono">{fmtMoney(t.fee)}</td>
                                                <td className="px-3 py-2 text-right font-mono font-bold text-gray-900">{fmtMoney(t.amountWithFee)}</td>
                                                <td className="px-3 py-2 text-center">
                                                    <button onClick={() => handleEditDelivery(idx)} className="text-blue-500 hover:text-blue-700 p-1 bg-blue-50 rounded" title="修改"><Edit2 size={16}/></button>
                                                </td>
                                            </>
                                        )}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
                <div className="flex justify-end pt-2">
                    <button
                        onClick={handleSaveDeliveriesToDB}
                        disabled={loading || deliveryRecords.length === 0}
                        className={`px-6 py-2.5 rounded-md font-bold text-white transition-all shadow-md flex items-center gap-2 ${loading || deliveryRecords.length === 0 ? 'bg-gray-400 cursor-not-allowed' : 'bg-orange-600 hover:bg-orange-700 shadow-orange-200'}`}
                    >
                        {loading ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
                        推送到库 (Get Stock)
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
                    {[
                        'sip_trade_fcn_input_living', 
                        'sip_trade_fcn_input_died', 
                        'sip_holding_fcn_output_living', 
                        'sip_holding_fcn_output_died', 
                        'sip_trade_fcn_pending_delivery',
                        'sip_holding_fcn_output_get-stock'
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
                                    <th className="px-3 py-2 whitespace-nowrap">ID / 创建时间</th>
                                    <th className="px-3 py-2">内容摘要 (Raw JSON Preview)</th>
                                    <th className="px-3 py-2 text-center whitespace-nowrap">操作</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {dbRecords.map(r => (
                                    <tr key={r.id} className="hover:bg-gray-50">
                                        <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap font-mono">
                                            <div className="font-bold text-gray-700">{r.id.substring(0,8)}...</div>
                                            <div>{r.createdAt?.toDate ? r.createdAt.toDate().toLocaleString() : 'N/A'}</div>
                                        </td>
                                        <td className="px-3 py-2 text-xs">
                                            <div className="max-w-md xl:max-w-2xl truncate text-gray-600 font-mono bg-gray-100 px-2 py-1 rounded">
                                                {JSON.stringify(r).substring(0, 150)}...
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

            {/* 修改 Raw JSON 弹窗 */}
            {editRecordModal && (
                <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
                    <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-5xl flex flex-col h-[85vh] max-h-[90vh]">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="font-bold text-lg flex items-center gap-2 text-purple-700">
                                <FileJson size={20}/> 
                                进阶修改记录 - {editRecordModal.record.id}
                            </h3>
                            <button onClick={() => setEditRecordModal(null)} className="text-gray-400 hover:text-gray-600"><X size={20}/></button>
                        </div>
                        <p className="text-xs text-gray-500 mb-2 border-l-2 border-orange-400 pl-2">
                            警告：直接修改 Raw JSON 属于高阶操作，请确保 JSON 格式合法且结构正确，否则可能会导致页面崩溃或逻辑错误。
                        </p>
                        
                        <textarea 
                            className="flex-1 w-full border border-gray-300 rounded-md p-3 text-xs font-mono mb-4 focus:ring-2 focus:ring-purple-500 outline-none resize-none" 
                            value={editRecordModal.rawJson}
                            onChange={(e) => setEditRecordModal({...editRecordModal, rawJson: e.target.value})}
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