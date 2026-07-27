"use client";

import React, { useEffect, useMemo, useState } from 'react';
import {
  Calculator,
  CircleDollarSign,
  FileSpreadsheet,
  Plus,
  RefreshCw,
  Sigma,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

type OptionType = 'call' | 'put';
type OptionSide = 'buy' | 'sell';
type QuoteMode = 'natural' | 'mid';

type ChainRow = {
  k: number;
  cb: number;
  ca: number;
  cm: number;
  civ: number | null;
  pb: number;
  pa: number;
  pm: number;
  piv: number | null;
};

type Leg = {
  id: string;
  side: OptionSide;
  type: OptionType;
  strike: number;
  quantity: number;
  openPrice: number;
};

type CalcResult = {
  openingCash: number;
  closingValue: number;
  pnl: number;
  ret: number;
  ann: number;
};

const DEFAULT_PARAMS = {
  symbol: 'NVDA',
  currentPrice: 0,
  capitalHkd: 3_000_000,
  fx: 7.85,
  contractSize: 100,
  openDate: '2026-07-27',
  expiryDate: '2026-12-18',
  rate: 4.25,
  dividend: 0,
  mode: 'natural' as QuoteMode,
};

const money = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const precise = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

function normalizeNumber(value: unknown) {
  if (value === null || value === undefined) return null;
  let text = String(value).trim().replace(/"/g, '');
  if (!text || text === '-' || text === '--' || text === '—') return null;
  let multiplier = 1;
  if (text.includes('万')) {
    multiplier = 10000;
    text = text.replace('万', '');
  }
  const parsed = Number(text.replace(/%|,|张|張/g, ''));
  return Number.isFinite(parsed) ? parsed * multiplier : null;
}

function splitLine(line: string) {
  const out: string[] = [];
  let current = '';
  let quoted = false;
  for (const char of line) {
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if ((char === ',' || char === '\t') && !quoted) {
      out.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  out.push(current.trim());
  return out;
}

function headerIndex(headers: string[], keys: string[]) {
  return headers.findIndex(header => keys.some(key => header.includes(key)));
}

function parseOptionChain(text: string) {
  const lines = text.split(/\r?\n/).map(splitLine).filter(row => row.some(cell => cell.trim()));
  if (lines.length < 2) return [];

  const headers = lines[0].map(item => item.trim().toLowerCase());
  const strikeIndex = headerIndex(headers, ['strike', '行权价', '行權價', '行权']);
  const typeIndex = headerIndex(headers, ['type', '类型', '類型']);
  const bidIndex = headerIndex(headers, ['bid', '买入价', '買入價']);
  const askIndex = headerIndex(headers, ['ask', '卖出价', '賣出價']);
  const midIndex = headerIndex(headers, ['mid', '中间价', '中間價']);
  const ivIndex = headerIndex(headers, ['iv', 'implied', '隐含波动率', '隱含波動率', '波动率', '波動率']);

  if (strikeIndex < 0 || typeIndex < 0 || ivIndex < 0) return [];

  const byStrike: Record<string, Partial<ChainRow>> = {};
  for (const row of lines.slice(1)) {
    const strike = normalizeNumber(row[strikeIndex]);
    if (strike === null) continue;
    const key = String(strike);
    byStrike[key] ||= { k: strike };

    const type = String(row[typeIndex] || '').toLowerCase();
    const bid = bidIndex >= 0 ? normalizeNumber(row[bidIndex]) : null;
    const ask = askIndex >= 0 ? normalizeNumber(row[askIndex]) : null;
    const mid = midIndex >= 0 ? normalizeNumber(row[midIndex]) : null;
    const rawIv = normalizeNumber(row[ivIndex]);
    const iv = rawIv === null ? null : rawIv > 2 ? rawIv / 100 : rawIv;

    if (type.includes('c') || type.includes('call') || type.includes('购') || type.includes('購')) {
      byStrike[key].cb = bid ?? mid ?? 0;
      byStrike[key].ca = ask ?? mid ?? 0;
      byStrike[key].cm = mid ?? ((bid ?? 0) + (ask ?? 0)) / 2;
      byStrike[key].civ = iv;
    }
    if (type.includes('p') || type.includes('put') || type.includes('沽')) {
      byStrike[key].pb = bid ?? mid ?? 0;
      byStrike[key].pa = ask ?? mid ?? 0;
      byStrike[key].pm = mid ?? ((bid ?? 0) + (ask ?? 0)) / 2;
      byStrike[key].piv = iv;
    }
  }

  return Object.values(byStrike)
    .filter(row => row.k !== undefined)
    .map(row => ({
      k: row.k as number,
      cb: row.cb ?? row.cm ?? 0,
      ca: row.ca ?? row.cm ?? 0,
      cm: row.cm ?? ((row.cb ?? 0) + (row.ca ?? 0)) / 2,
      civ: row.civ ?? null,
      pb: row.pb ?? row.pm ?? 0,
      pa: row.pa ?? row.pm ?? 0,
      pm: row.pm ?? ((row.pb ?? 0) + (row.pa ?? 0)) / 2,
      piv: row.piv ?? null,
    }))
    .sort((a, b) => a.k - b.k);
}

function normCdf(x: number) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}

function normPdf(x: number) {
  return Math.exp((-x * x) / 2) / Math.sqrt(2 * Math.PI);
}

function bsm(type: OptionType, s: number, k: number, t: number, r: number, q: number, vol: number) {
  if (t <= 0 || vol <= 0 || s <= 0 || k <= 0) {
    return type === 'call' ? Math.max(s - k, 0) : Math.max(k - s, 0);
  }
  const sd = vol * Math.sqrt(t);
  const d1 = (Math.log(s / k) + (r - q + 0.5 * vol * vol) * t) / sd;
  const d2 = d1 - sd;
  if (type === 'call') return s * Math.exp(-q * t) * normCdf(d1) - k * Math.exp(-r * t) * normCdf(d2);
  return k * Math.exp(-r * t) * normCdf(-d2) - s * Math.exp(-q * t) * normCdf(-d1);
}

function bsmGreeks(type: OptionType, s: number, k: number, t: number, r: number, q: number, vol: number) {
  if (t <= 0 || vol <= 0 || s <= 0 || k <= 0) {
    const intrinsicDelta = type === 'call' ? (s > k ? 1 : 0) : (s < k ? -1 : 0);
    return { delta: intrinsicDelta, gamma: 0, vega: 0, theta: 0 };
  }
  const sd = vol * Math.sqrt(t);
  const d1 = (Math.log(s / k) + (r - q + 0.5 * vol * vol) * t) / sd;
  const d2 = d1 - sd;
  const delta = type === 'call' ? Math.exp(-q * t) * normCdf(d1) : Math.exp(-q * t) * (normCdf(d1) - 1);
  const gamma = Math.exp(-q * t) * normPdf(d1) / (s * sd);
  const vega = s * Math.exp(-q * t) * normPdf(d1) * Math.sqrt(t) / 100;
  const thetaCall = (-(s * Math.exp(-q * t) * normPdf(d1) * vol) / (2 * Math.sqrt(t)) - r * k * Math.exp(-r * t) * normCdf(d2) + q * s * Math.exp(-q * t) * normCdf(d1)) / 365;
  const thetaPut = (-(s * Math.exp(-q * t) * normPdf(d1) * vol) / (2 * Math.sqrt(t)) + r * k * Math.exp(-r * t) * normCdf(-d2) - q * s * Math.exp(-q * t) * normCdf(-d1)) / 365;
  return { delta, gamma, vega, theta: type === 'call' ? thetaCall : thetaPut };
}

function daysBetween(a: string, b: string) {
  const start = new Date(`${a}T00:00:00`).getTime();
  const end = new Date(`${b}T00:00:00`).getTime();
  return Math.max(Math.round((end - start) / 86400000), 0);
}

function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00`);
  value.setDate(value.getDate() + days);
  return value.toISOString().slice(0, 10);
}

function formatMoney(value: number) {
  return `${value >= 0 ? '+' : '-'}HK$${money.format(Math.abs(value))}`;
}

function formatPct(value: number, digits = 1) {
  if (!Number.isFinite(value)) return '--';
  return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(digits)}%`;
}

function getIv(row: ChainRow | undefined, type: OptionType) {
  if (!row) return null;
  return type === 'call' ? row.civ : row.piv;
}

function getQuote(row: ChainRow | undefined, type: OptionType, side: OptionSide, mode: QuoteMode) {
  if (!row) return null;
  if (type === 'call') {
    if (mode === 'mid') return row.cm;
    return side === 'buy' ? row.ca : row.cb;
  }
  if (mode === 'mid') return row.pm;
  return side === 'buy' ? row.pa : row.pb;
}

function makeLeg(currentPrice: number, chainRows: ChainRow[]): Leg {
  const defaultStrike = chainRows.length ? chainRows[Math.floor(chainRows.length / 2)].k : Number(currentPrice.toFixed(2)) || 0;
  return {
    id: Math.random().toString(36).slice(2, 10),
    side: 'buy',
    type: 'call',
    strike: defaultStrike,
    quantity: 1,
    openPrice: Number(currentPrice.toFixed(4)) || 0,
  };
}

export default function OptionPortfolioPanel() {
  const [symbol, setSymbol] = useState(DEFAULT_PARAMS.symbol);
  const [currentPrice, setCurrentPrice] = useState(DEFAULT_PARAMS.currentPrice);
  const [capitalHkd, setCapitalHkd] = useState(DEFAULT_PARAMS.capitalHkd);
  const [fx, setFx] = useState(DEFAULT_PARAMS.fx);
  const [contractSize, setContractSize] = useState(DEFAULT_PARAMS.contractSize);
  const [openDate, setOpenDate] = useState(DEFAULT_PARAMS.openDate);
  const [expiryDate, setExpiryDate] = useState(DEFAULT_PARAMS.expiryDate);
  const [closeDayOffset, setCloseDayOffset] = useState(0);
  const [rate, setRate] = useState(DEFAULT_PARAMS.rate);
  const [dividend, setDividend] = useState(DEFAULT_PARAMS.dividend);
  const [mode, setMode] = useState<QuoteMode>(DEFAULT_PARAMS.mode);
  const [chainRows, setChainRows] = useState<ChainRow[]>([]);
  const [legs, setLegs] = useState<Leg[]>([]);
  const [pasteText, setPasteText] = useState('');
  const [parseStatus, setParseStatus] = useState('请粘贴期权链数据。当前格式：Type, Strike, Bid, Ask, Mid, IV。');
  const [quoteStatus, setQuoteStatus] = useState('尚未刷新股价');

  const totalDays = useMemo(() => daysBetween(openDate, expiryDate), [openDate, expiryDate]);
  const closeDate = useMemo(() => addDays(openDate, Math.min(closeDayOffset, totalDays)), [openDate, closeDayOffset, totalDays]);
  const yearsToExpiry = Math.max(daysBetween(closeDate, expiryDate), 0) / 365;
  const holdingDays = Math.max(daysBetween(openDate, closeDate), 1);
  const rateDecimal = rate / 100;
  const dividendDecimal = dividend / 100;
  const chainMap = useMemo(() => new Map(chainRows.map(row => [row.k, row])), [chainRows]);

  useEffect(() => {
    if (closeDayOffset > totalDays) setCloseDayOffset(totalDays);
  }, [closeDayOffset, totalDays]);

  const fetchQuote = async () => {
    const cleanSymbol = symbol.trim().toUpperCase();
    if (!cleanSymbol) return;
    setQuoteStatus('正在刷新股价...');
    try {
      const response = await fetch(`/api/quote?symbol=${encodeURIComponent(cleanSymbol)}&t=${Date.now()}`);
      const data = await response.json();
      const price = Number(data.regularMarketPrice || data.price || data.close || 0);
      if (!response.ok || !Number.isFinite(price) || price <= 0) throw new Error(data?.error || '股价读取失败');
      setCurrentPrice(price);
      setQuoteStatus(`已刷新：${cleanSymbol} ${precise.format(price)}`);
      setLegs(prev => prev.map(leg => leg.openPrice > 0 ? leg : { ...leg, openPrice: Number(price.toFixed(4)) }));
    } catch (error) {
      setQuoteStatus(error instanceof Error ? error.message : '股价读取失败');
    }
  };

  useEffect(() => {
    void fetchQuote();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const getLegIv = (leg: Leg) => getIv(chainMap.get(leg.strike), leg.type);

  const calcAtPrice = (price: number): CalcResult => {
    const openingCash = legs.reduce((sum, leg) => {
      const sign = leg.side === 'buy' ? -1 : 1;
      return sum + sign * leg.openPrice * leg.quantity * contractSize * fx;
    }, 0);
    const closingValue = legs.reduce((sum, leg) => {
      const iv = getLegIv(leg);
      const sign = leg.side === 'buy' ? 1 : -1;
      const value = bsm(leg.type, price, leg.strike, yearsToExpiry, rateDecimal, dividendDecimal, iv ?? 0);
      return sum + sign * value * leg.quantity * contractSize * fx;
    }, 0);
    const pnl = openingCash + closingValue;
    const ret = pnl / Math.max(capitalHkd, 1);
    const ann = ret * 365 / holdingDays;
    return { openingCash, closingValue, pnl, ret, ann };
  };

  const chartData = useMemo(() => {
    const keyPrices = legs.map(leg => leg.strike).concat(currentPrice || 0).filter(value => Number.isFinite(value) && value > 0);
    const center = currentPrice || keyPrices[0] || 100;
    const minPrice = Math.max(0, Math.min(center * 0.55, keyPrices.length ? Math.min(...keyPrices) * 0.75 : center * 0.55));
    const maxPrice = Math.max(center * 1.45, keyPrices.length ? Math.max(...keyPrices) * 1.25 : center * 1.45, minPrice + 10);
    const points = [];
    const step = Math.max(0.5, (maxPrice - minPrice) / 100);
    for (let price = minPrice; price <= maxPrice; price += step) {
      const result = calcAtPrice(price);
      points.push({ price, pnl: result.pnl, ret: result.ret * 100, ann: result.ann * 100 });
    }
    return points;
  }, [legs, currentPrice, capitalHkd, fx, contractSize, yearsToExpiry, rateDecimal, dividendDecimal, holdingDays, chainRows]);

  const breakevens = useMemo(() => {
    if (!chartData.length) return [];
    const roots: number[] = [];
    let prev = chartData[0];
    for (const point of chartData.slice(1)) {
      if ((prev.pnl < 0 && point.pnl > 0) || (prev.pnl > 0 && point.pnl < 0)) {
        const weight = Math.abs(prev.pnl) / (Math.abs(prev.pnl) + Math.abs(point.pnl));
        roots.push(prev.price + (point.price - prev.price) * weight);
      }
      prev = point;
    }
    return roots;
  }, [chartData]);

  const greeks = useMemo(() => {
    return legs.reduce((sum, leg) => {
      const iv = getLegIv(leg);
      const sign = leg.side === 'buy' ? 1 : -1;
      const g = bsmGreeks(leg.type, currentPrice || leg.strike || 1, leg.strike, yearsToExpiry, rateDecimal, dividendDecimal, iv ?? 0);
      const multiplier = sign * leg.quantity * contractSize;
      return {
        delta: sum.delta + g.delta * multiplier,
        gamma: sum.gamma + g.gamma * multiplier,
        vega: sum.vega + g.vega * multiplier * fx,
        theta: sum.theta + g.theta * multiplier * fx,
      };
    }, { delta: 0, gamma: 0, vega: 0, theta: 0 });
  }, [legs, currentPrice, yearsToExpiry, rateDecimal, dividendDecimal, contractSize, fx, chainRows]);

  const updateLeg = (id: string, patch: Partial<Leg>) => {
    setLegs(prev => prev.map(leg => leg.id === id ? { ...leg, ...patch } : leg));
  };

  const addLeg = () => {
    if (!chainRows.length) {
      setParseStatus('请先粘贴并解析期权链数据，再新增输入期权行。');
      return;
    }
    setLegs(prev => [...prev, makeLeg(currentPrice, chainRows)]);
  };
  const removeLeg = (id: string) => setLegs(prev => prev.filter(leg => leg.id !== id));

  const autoFillPremiums = () => {
    setLegs(prev => prev.map(leg => {
      const quote = getQuote(chainMap.get(leg.strike), leg.type, leg.side, mode);
      return quote === null ? leg : { ...leg, openPrice: Number(quote.toFixed(4)) };
    }));
  };

  const handleParse = () => {
    const parsed = parseOptionChain(pasteText.trim());
    if (!parsed.length) {
      setParseStatus('未能识别期权链。请使用表头：Type, Strike, Bid, Ask, Mid, IV。Type 填 Call/Put，IV 可以填 0.42 或 42%。');
      return;
    }
    setChainRows(parsed);
    setParseStatus(`已解析 ${parsed.length} 个行权价。IV 已按方向和类型自动匹配。`);
  };

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-[26px] border border-slate-900/10 bg-white shadow-sm">
        <div className="grid gap-5 bg-gradient-to-br from-[#123332] via-[#163d39] to-[#74421f] px-6 py-6 text-white lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
          <div>
            <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.22em] text-[#f0bd82]">
              <SlidersHorizontal size={14} /> Option Portfolio Close-out Model
            </div>
            <h3 className="mt-3 font-serif text-3xl font-semibold tracking-tight">期权组合平仓估值器</h3>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-200">
              输入任意多腿期权组合，粘贴标准期权链后自动匹配 IV。平仓日期由曲线下方时间轴控制，方便观察时间流逝对组合收益结构的影响。
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <MiniMetric label="当前股价" value={currentPrice > 0 ? precise.format(currentPrice) : '--'} icon={<CircleDollarSign size={15} />} />
            <MiniMetric label="输入期权" value={`${legs.length} 行`} icon={<Calculator size={15} />} />
            <MiniMetric label="期权链" value={`${chainRows.length} 个行权价`} icon={<FileSpreadsheet size={15} />} />
            <MiniMetric label="平仓日" value={closeDate} icon={<SlidersHorizontal size={15} />} />
          </div>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[430px_1fr]">
        <div className="space-y-5">
          <Card title="基础参数" subtitle="平仓日已移到图表底部时间轴">
            <div className="grid grid-cols-2 gap-3">
              <Field label="股票代码"><input value={symbol} onChange={event => setSymbol(event.target.value.toUpperCase())} /></Field>
              <Field label="当前股价"><NumberInput value={currentPrice} onChange={setCurrentPrice} step={0.01} /></Field>
              <Field label="本金 HKD"><NumberInput value={capitalHkd} onChange={setCapitalHkd} step={10000} /></Field>
              <Field label="汇率"><NumberInput value={fx} onChange={setFx} step={0.01} /></Field>
              <Field label="合约乘数"><NumberInput value={contractSize} onChange={setContractSize} step={1} /></Field>
              <Field label="报价方式">
                <select value={mode} onChange={event => setMode(event.target.value as QuoteMode)}>
                  <option value="natural">保守 bid/ask</option>
                  <option value="mid">Mid price</option>
                </select>
              </Field>
              <Field label="开仓日"><input type="date" value={openDate} onChange={event => setOpenDate(event.target.value)} /></Field>
              <Field label="到期日"><input type="date" value={expiryDate} onChange={event => setExpiryDate(event.target.value)} /></Field>
              <Field label="无风险利率 %"><NumberInput value={rate} onChange={setRate} step={0.05} /></Field>
              <Field label="股息率 %"><NumberInput value={dividend} onChange={setDividend} step={0.05} /></Field>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <button type="button" onClick={fetchQuote} className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#153a36] px-4 py-2 text-xs font-bold text-white hover:bg-[#0f2d2a]">
                <RefreshCw size={14} /> 刷新股价
              </button>
              <button type="button" onClick={autoFillPremiums} className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-600 hover:border-[#d95f2b] hover:text-[#b94b1d]">
                自动带入权利金
              </button>
            </div>
            <p className="mt-3 text-xs text-slate-500">{quoteStatus}</p>
          </Card>

          <Card title="期权链数据" subtitle="请复制 Excel/CSV，第一行必须是表头">
            <div className="mb-3 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
              标准格式：<span className="font-mono font-bold">Type, Strike, Bid, Ask, Mid, IV</span><br />
              示例：<span className="font-mono">Call, 240, 11.35, 11.65, 11.50, 42.13%</span>
            </div>
            <textarea
              value={pasteText}
              onChange={event => setPasteText(event.target.value)}
              placeholder="Type,Strike,Bid,Ask,Mid,IV\nCall,240,11.35,11.65,11.50,42.13%\nPut,240,40.55,42.45,41.50,41.93%"
              className="min-h-[128px] w-full resize-y rounded-2xl border border-slate-200 bg-[#fbfaf7] p-3 font-mono text-xs text-slate-700 outline-none focus:border-teal-700 focus:bg-white focus:ring-4 focus:ring-teal-700/10"
            />
            <button type="button" onClick={handleParse} className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#153a36] px-4 py-2 text-xs font-bold text-white hover:bg-[#0f2d2a]">
              <FileSpreadsheet size={14} /> 解析期权链
            </button>
            <p className="mt-3 text-xs leading-5 text-slate-500">{parseStatus}</p>
          </Card>
        </div>

        <div className="space-y-5">
          <Card title="输入期权" subtitle="行权价来自期权链下拉选项；IV 自动匹配且不可手动修改；新增行的开仓价默认使用当前股价">
            <div className="mb-3 flex justify-end">
              <button type="button" onClick={addLeg} className="inline-flex items-center gap-2 rounded-xl bg-[#d95f2b] px-4 py-2 text-xs font-bold text-white hover:bg-[#b94b1d]">
                <Plus size={14} /> 新增行
              </button>
            </div>
            <div className="overflow-x-auto rounded-2xl border border-slate-200">
              <table className="w-full table-fixed text-xs">
                <colgroup>
                  <col className="w-[14%]" />
                  <col className="w-[14%]" />
                  <col className="w-[17%]" />
                  <col className="w-[13%]" />
                  <col className="w-[19%]" />
                  <col className="w-[14%]" />
                  <col className="w-[9%]" />
                </colgroup>
                <thead className="bg-[#f7f3eb] text-slate-500">
                  <tr>
                    <th className="px-2 py-2 text-left">方向</th>
                    <th className="px-2 py-2 text-left">类型</th>
                    <th className="px-2 py-2 text-right">行权价</th>
                    <th className="px-2 py-2 text-right">张数</th>
                    <th className="px-2 py-2 text-right">开仓价</th>
                    <th className="px-2 py-2 text-right">IV</th>
                    <th className="px-2 py-2 text-center">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {legs.length === 0 ? (
                    <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">暂无期权腿，请点击“新增行”。</td></tr>
                  ) : legs.map(leg => {
                    const iv = getLegIv(leg);
                    return (
                      <tr key={leg.id} className="border-t border-slate-100 hover:bg-teal-50/40">
                        <td className="px-2 py-2">
                          <select className="w-full min-w-0" value={leg.side} onChange={event => updateLeg(leg.id, { side: event.target.value as OptionSide })}>
                            <option value="buy">buy</option>
                            <option value="sell">sell</option>
                          </select>
                        </td>
                        <td className="px-2 py-2">
                          <select className="w-full min-w-0" value={leg.type} onChange={event => updateLeg(leg.id, { type: event.target.value as OptionType })}>
                            <option value="call">call</option>
                            <option value="put">put</option>
                          </select>
                        </td>
                        <td className="px-2 py-2 text-right">
                          <select className="w-full min-w-0 text-right font-mono" value={leg.strike} onChange={event => updateLeg(leg.id, { strike: Number(event.target.value) })}>
                            {chainRows.map(row => (
                              <option key={row.k} value={row.k}>{row.k}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-2 py-2 text-right"><CompactNumberInput value={leg.quantity} onChange={value => updateLeg(leg.id, { quantity: value })} step={1} min={0} /></td>
                        <td className="px-2 py-2 text-right"><CompactNumberInput value={leg.openPrice} onChange={value => updateLeg(leg.id, { openPrice: value })} step={0.0001} min={0} /></td>
                        <td className="px-2 py-2 truncate text-right font-mono font-semibold text-[#153a36]" title={iv === null ? '期权链缺少对应 IV' : `${(iv * 100).toFixed(2)}%`}>{iv === null ? '--' : `${(iv * 100).toFixed(2)}%`}</td>
                        <td className="px-2 py-2 text-center">
                          <button type="button" onClick={() => removeLeg(leg.id)} className="inline-flex items-center justify-center rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-rose-700 hover:bg-rose-100">
                            <Trash2 size={13} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="平仓估值曲线" subtitle={`当前平仓日：${closeDate}，距离到期 ${Math.round(yearsToExpiry * 365)} 天`}>
            <div className="h-[370px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 14, right: 26, bottom: 8, left: 28 }}>
                  <CartesianGrid stroke="#e8e1d3" strokeDasharray="4 4" />
                  <XAxis dataKey="price" tick={{ fontSize: 11, fill: '#64748b' }} tickFormatter={value => precise.format(Number(value))} />
                  <YAxis tick={{ fontSize: 11, fill: '#64748b' }} tickFormatter={value => `${Number(value).toFixed(0)}%`} />
                  <Tooltip content={<CurveTooltip />} />
                  <ReferenceLine y={0} stroke="#64748b" strokeDasharray="5 5" />
                  {currentPrice > 0 && <ReferenceLine x={currentPrice} stroke="#0f8a5f" strokeWidth={2} label={{ value: '现价', position: 'insideTop', fill: '#0f8a5f', fontSize: 11 }} />}
                  {breakevens.map((value, index) => (
                    <ReferenceLine key={`${value}-${index}`} x={value} stroke="#d9a441" strokeDasharray="4 4" label={{ value: `盈亏平衡 ${precise.format(value)}`, position: 'insideBottom', fill: '#9a6a00', fontSize: 11 }} />
                  ))}
                  <Line type="monotone" dataKey="ret" stroke="#d95f2b" strokeWidth={3} dot={false} name="本金收益率" />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-4 rounded-2xl border border-slate-200 bg-[#fbfaf7] px-4 py-3">
              <div className="mb-2 flex items-center justify-between text-xs text-slate-500">
                <span>开仓日 {openDate}</span>
                <span className="font-bold text-[#153a36]">平仓日 {closeDate}</span>
                <span>到期日 {expiryDate}</span>
              </div>
              <input
                type="range"
                min={0}
                max={Math.max(totalDays, 0)}
                step={1}
                value={Math.min(closeDayOffset, totalDays)}
                onChange={event => setCloseDayOffset(Number(event.target.value))}
                className="w-full accent-[#d95f2b]"
              />
            </div>
          </Card>
        </div>
      </section>

      <Card title="组合 Greeks" subtitle="移至底部展示；Delta 为股数等效敞口，Vega/Theta 已折算 HKD">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <GreekCard label="Delta" value={greeks.delta.toFixed(2)} />
          <GreekCard label="Gamma" value={greeks.gamma.toFixed(4)} />
          <GreekCard label="Vega / 1%" value={`HK$${money.format(greeks.vega)}`} />
          <GreekCard label="Theta / day" value={`HK$${money.format(greeks.theta)}`} />
        </div>
      </Card>
    </div>
  );
}

function CurveTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const item = payload[0]?.payload;
  if (!item) return null;
  return (
    <div className="rounded-2xl border border-slate-200 bg-white/95 p-3 text-xs shadow-xl backdrop-blur">
      <div className="font-mono font-bold text-slate-900">平仓价 {precise.format(Number(label))}</div>
      <div className={`mt-2 font-mono font-bold ${item.pnl >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>估算总盈亏 HKD：{formatMoney(item.pnl)}</div>
      <div className={`mt-1 font-mono ${item.ret >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>本金收益率：{item.ret.toFixed(2)}%</div>
      <div className={`mt-1 font-mono ${item.ann >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>简单年化：{item.ann.toFixed(2)}%</div>
    </div>
  );
}

function NumberInput({ value, onChange, step, min }: { value: number; onChange: (value: number) => void; step?: number; min?: number }) {
  return <input type="number" value={value} step={step} min={min} onChange={event => onChange(Number(event.target.value) || 0)} />;
}

function CompactNumberInput({ value, onChange, step, min }: { value: number; onChange: (value: number) => void; step?: number; min?: number }) {
  return (
    <input
      type="number"
      value={value}
      step={step}
      min={min}
      onChange={event => onChange(Number(event.target.value) || 0)}
      className="w-full min-w-0 text-right font-mono"
    />
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-500">
      {label}
      {children}
    </label>
  );
}

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[24px] border border-slate-900/10 bg-white p-5 shadow-sm">
      <div className="mb-4">
        <h4 className="font-serif text-xl font-semibold text-slate-900">{title}</h4>
        {subtitle && <p className="mt-1 text-xs leading-5 text-slate-500">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

function MiniMetric({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3 backdrop-blur">
      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-slate-300">
        <span className="text-[#f0bd82]">{icon}</span>
        {label}
      </div>
      <div className="mt-1.5 truncate text-sm font-semibold">{value}</div>
    </div>
  );
}

function GreekCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-[#fffaf1] p-4">
      <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{label}</div>
      <div className="mt-2 font-mono text-lg font-black text-[#153a36]">{value}</div>
    </div>
  );
}
