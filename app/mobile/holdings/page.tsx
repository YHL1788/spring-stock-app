"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertCircle, ChevronRight, Loader2, RefreshCw } from "lucide-react";
import MobileShell from "../MobileShell";
import styles from "../mobile.module.css";
import {
  buildCapitalFlowsFromCashTrades,
  signedCapitalFlowHKD,
  type CapitalFlow,
  type CashTradeRecord,
  type InitialPortfolioState,
} from "@/app/book/SP_wjhh1/lib/portfolioNavEngine";
import {
  ensureMobileFirebaseAuth,
  formatHKD,
  formatNumber,
  formatPercent,
  getCollectionRows,
  getDataDoc,
  getDisplayCache,
  getSummaryTime,
  matrixRows,
  toNumber,
  type MatrixData,
  type MobileCacheDoc,
} from "../mobileData";

type TabKey = "summary" | "cash" | "stocks" | "fcn" | "dqaq" | "option" | "pe" | "cbbc";
type StockCurrencyMode = "local" | "HKD" | "USD";
type FormalPair = { mkt: MatrixData | null; pl: MatrixData | null };
type MergedRecord = { tradeId: string; inputId: string; outputId: string; inputData: any; outputData: any };
type SimpleHolding = {
  code: string;
  name: string;
  market: string;
  quantity: number;
  avgCost: number;
  currentPrice: number;
  totalCostHKD: number;
  mktValHKD: number;
  unrealizedPnlHKD: number;
  pnlRatio: number;
  accounts: Record<string, number>;
};

type HoldingsState = {
  summary: MobileCacheDoc | null;
  cash: MobileCacheDoc | null;
  stocks: MobileCacheDoc | null;
  fcnLiving: MergedRecord[];
  dqaqLiving: MergedRecord[];
  optionLiving: MergedRecord[];
  peHoldings: SimpleHolding[];
  cbbcHoldings: SimpleHolding[];
  pe: FormalPair;
  cbbc: FormalPair;
  initialState: InitialPortfolioState | null;
  capitalFlows: CapitalFlow[];
};

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "summary", label: "汇总" },
  { key: "cash", label: "资金" },
  { key: "stocks", label: "股票" },
  { key: "fcn", label: "FCN" },
  { key: "dqaq", label: "DQ-AQ" },
  { key: "option", label: "Option" },
  { key: "pe", label: "私募" },
  { key: "cbbc", label: "牛熊证" },
];

const ASSET_LABELS: Record<string, string> = {
  cash: "现金 (Cash)",
  stock: "现货 (Spot)",
  pe: "私募 (PE)",
  cbbc: "牛熊/期货 (CBBC)",
  option: "期权 (Option)",
  fcn: "FCN",
  dqaq: "DQ-AQ",
};

const EMPTY_STATE: HoldingsState = {
  summary: null,
  cash: null,
  stocks: null,
  fcnLiving: [],
  dqaqLiving: [],
  optionLiving: [],
  peHoldings: [],
  cbbcHoldings: [],
  pe: { mkt: null, pl: null },
  cbbc: { mkt: null, pl: null },
  initialState: null,
  capitalFlows: [],
};

const FALLBACK_FX: Record<string, number> = { HKD: 1, USD: 7.78, JPY: 0.052, CNY: 1.08 };
const todayDate = () => new Date().toISOString().slice(0, 10);

const getMillis = (value: any) => {
  if (!value) return 0;
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (typeof value?.toDate === "function") return value.toDate().getTime();
  if (typeof value?.seconds === "number") return value.seconds * 1000;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
};

const asArray = (value: any) => Array.isArray(value) ? value : [];
const clean = (value: any) => value ?? {};
const pct = (value: any) => formatPercent(toNumber(value));
const signedClass = (value: number) => value >= 0 ? styles.positive : styles.negative;
const latestTime = (...values: any[]) => {
  const ms = Math.max(...values.map(getMillis), 0);
  return ms ? new Date(ms).toLocaleString("zh-CN", { hour12: false }) : "暂无记录";
};

type ValueTone = "positive" | "negative";
type DisplayValue = { label: string; value: React.ReactNode; tone?: ValueTone };

function Metric({ label, value, tone, detail, primary = false }: { label: string; value: string; tone?: ValueTone; detail?: string; primary?: boolean }) {
  return (
    <div className={`${styles.metric} ${primary ? styles.metricPrimary : ""}`}>
      <div className={styles.metricLabel}>{label}</div>
      <div className={`${styles.metricValue} ${tone === "positive" ? styles.positive : tone === "negative" ? styles.negative : ""}`}>{value}</div>
      {detail ? <div className={styles.metricDetail}>{detail}</div> : null}
    </div>
  );
}

function SectionCard({ title, note, time, children }: { title: string; note?: string; time?: string; children: React.ReactNode }) {
  return (
    <section className={`${styles.card} mb-4`}>
      <div className={styles.cardHeader}>
        <div>
          <h2 className={styles.cardTitle}>{title}</h2>
          {note ? <p className={styles.cardNote}>{note}</p> : null}
        </div>
        {time ? <div className={styles.statusPill}>{time}</div> : null}
      </div>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className={styles.empty}>{children}</div>;
}

function RecordCard({ title, subtitle, status, highlights, details }: {
  title: string;
  subtitle?: string;
  status?: string;
  highlights: DisplayValue[];
  details: DisplayValue[];
}) {
  return (
    <article className={styles.recordCard}>
      <div className={styles.recordHeader}>
        <div className={styles.recordIdentity}>
          <h3>{title}</h3>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        {status ? <span className={styles.recordStatus}>{status}</span> : null}
      </div>
      <div className={styles.recordHighlights}>
        {highlights.map((item) => (
          <div key={item.label} className={styles.recordHighlight}>
            <span>{item.label}</span>
            <strong className={item.tone === "positive" ? styles.positive : item.tone === "negative" ? styles.negative : ""}>{item.value}</strong>
          </div>
        ))}
      </div>
      {details.length ? (
        <details className={styles.recordDetails}>
          <summary>查看全部数据 <ChevronRight size={14} /></summary>
          <div className={styles.recordDetailGrid}>
            {details.map((item) => (
              <div key={item.label}>
                <span>{item.label}</span>
                <strong className={item.tone === "positive" ? styles.positive : item.tone === "negative" ? styles.negative : ""}>{item.value}</strong>
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </article>
  );
}

function MatrixTable({ matrix, type = "mkt" }: { matrix?: MatrixData | null; type?: "mkt" | "pl" }) {
  const rows = matrixRows(matrix);
  const columns = useMemo(() => {
    if (type === "pl") return ["realized", "unrealized", "total"];
    const fromAccounts = matrix?.accounts || [];
    const fromRows = rows.flatMap(({ row }) => Object.keys(row || {}));
    return Array.from(new Set([...fromAccounts, ...fromRows]));
  }, [matrix?.accounts, rows, type]);

  if (!rows.length) return <Empty>暂无可展示矩阵数据</Empty>;

  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>{type === "pl" ? "币种" : "市场/币种"}</th>
            {columns.map((column) => <th key={column}>{column}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ market, row }) => (
            <tr key={market}>
              <td>{market}</td>
              {columns.map((column) => <td key={column}>{formatHKD(toNumber(row?.[column]), 2)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SummaryMktMatrix({ mktDataMap }: { mktDataMap?: Record<string, MatrixData> }) {
  const rows = useMemo(() => Object.entries(mktDataMap || {}).map(([asset, matrix]) => {
    const valuesByCurrency: Record<string, number> = {};
    matrixRows(matrix).forEach(({ market, row }) => {
      valuesByCurrency[market] = Object.values(row || {}).reduce<number>((sum, value) => sum + toNumber(value), 0);
    });
    return {
      asset,
      label: ASSET_LABELS[asset] || asset.toUpperCase(),
      valuesByCurrency,
      total: Object.values(valuesByCurrency).reduce((sum, value) => sum + value, 0),
    };
  }).filter((item) => item.total !== 0), [mktDataMap]);

  const currencies = useMemo(() => {
    const set = new Set<string>();
    Object.values(mktDataMap || {}).forEach((matrix) => {
      (matrix.markets || Object.keys(matrix.rawMatrix || {})).forEach((market) => set.add(market));
    });
    return Array.from(set);
  }, [mktDataMap]);

  const currencyTotals = useMemo(() => currencies.reduce<Record<string, number>>((acc, currency) => {
    acc[currency] = rows.reduce((sum, row) => sum + toNumber(row.valuesByCurrency[currency]), 0);
    return acc;
  }, {}), [currencies, rows]);

  const grandTotal = rows.reduce((sum, row) => sum + row.total, 0);

  if (!rows.length || !currencies.length) return <Empty>暂无当前持仓市值分布矩阵</Empty>;
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>资产</th>
            {currencies.map((currency) => <th key={currency}>{currency}</th>)}
            <th>合计</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((item) => (
            <tr key={item.asset}>
              <td>{item.label}</td>
              {currencies.map((currency) => (
                <td key={currency}>{formatHKD(item.valuesByCurrency[currency], 2)}</td>
              ))}
              <td>{formatHKD(item.total, 2)}</td>
            </tr>
          ))}
          <tr>
            <td>合计</td>
            {currencies.map((currency) => <td key={currency}>{formatHKD(currencyTotals[currency], 2)}</td>)}
            <td>{formatHKD(grandTotal, 2)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function SummaryPlMatrix({ plDataMap }: { plDataMap?: Record<string, MatrixData> }) {
  const rows = Object.entries(plDataMap || {}).flatMap(([asset, matrix]) => (
    matrixRows(matrix).map(({ market, row }) => ({ asset, market, row }))
  ));
  if (!rows.length) return <Empty>暂无当前交易归因盈亏矩阵</Empty>;
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead><tr><th>资产</th><th>币种</th><th>已实现</th><th>未实现</th><th>合计</th></tr></thead>
        <tbody>
          {rows.map((item) => <tr key={`${item.asset}-${item.market}`}><td>{item.asset.toUpperCase()}</td><td>{item.market}</td><td>{formatHKD(toNumber(item.row?.realized), 2)}</td><td>{formatHKD(toNumber(item.row?.unrealized), 2)}</td><td>{formatHKD(toNumber(item.row?.total), 2)}</td></tr>)}
        </tbody>
      </table>
    </div>
  );
}

function SummaryPanel({ cache, initialState, capitalFlows }: { cache: MobileCacheDoc | null; initialState: InitialPortfolioState | null; capitalFlows: CapitalFlow[] }) {
  const data = cache?.data || {};
  const snapshot = data.snapshot || {};
  const snapshotDate = String(snapshot.snapshotDate || new Date().toISOString().slice(0, 10));
  const netCapitalFlow = initialState ? capitalFlows
    .filter((flow) => flow.flowDate > initialState.inceptionDate && flow.flowDate <= snapshotDate)
    .reduce((sum, flow) => sum + signedCapitalFlowHKD(flow), 0) : 0;
  const navPnl = initialState
    ? toNumber(snapshot.totalMarketValueHKD) - initialState.initialCapitalHKD - netCapitalFlow
    : null;
  const attributionPnl = toNumber(snapshot.totalPnlHKD);
  const pnlDifference = navPnl === null ? null : navPnl - attributionPnl;
  const allocation = Object.entries(snapshot.marketValueByAssetHKD || {})
    .map(([asset, value]) => ({ asset, label: ASSET_LABELS[asset] || asset.toUpperCase(), value: toNumber(value) }))
    .filter((item) => Math.abs(item.value) > 0.01)
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  const grossAllocation = allocation.reduce((sum, item) => sum + Math.abs(item.value), 0);

  return (
    <>
      <SectionCard title="资产总览" note="组合最重要的市值与收益口径。" time={latestTime(cache?.calculatedAt, cache?.updatedAt)}>
        <div className={styles.summaryMetrics}>
          <Metric label="总持仓市值" value={formatHKD(snapshot.totalMarketValueHKD, 0)} detail="HKD" primary />
          <Metric label="净值盈亏" value={navPnl === null ? "—" : formatHKD(navPnl, 0)} tone={navPnl === null ? undefined : navPnl >= 0 ? "positive" : "negative"} detail={initialState ? "总资产 − 期初 − 净出入金" : "尚未设置期初净资产"} />
          <Metric label="归因盈亏" value={formatHKD(attributionPnl, 0)} tone={attributionPnl >= 0 ? "positive" : "negative"} detail="来自各持仓模块" />
          <Metric label="口径差异" value={pnlDifference === null ? "—" : formatHKD(pnlDifference, 0)} tone={pnlDifference === null ? undefined : pnlDifference >= 0 ? "positive" : "negative"} detail="净值盈亏 − 归因盈亏" />
        </div>
      </SectionCard>

      <SectionCard title="资产配置" note="按市值绝对值排序，快速查看组合结构。">
        <div className={styles.allocationList}>
          {allocation.map((item) => {
            const ratio = grossAllocation > 0 ? Math.abs(item.value) / grossAllocation : 0;
            return (
              <div key={item.asset} className={styles.allocationItem}>
                <div className={styles.allocationTopline}>
                  <span>{item.label}</span>
                  <strong>{formatHKD(item.value, 0)}</strong>
                </div>
                <div className={styles.allocationTrack}><span style={{ width: `${Math.max(ratio * 100, 1)}%` }} /></div>
                <small>{formatPercent(ratio)}</small>
              </div>
            );
          })}
        </div>
      </SectionCard>

      <SectionCard title="完整数据" note="详细矩阵按需展开，保留原网站的关键只读数据。">
        <details className={styles.dataDisclosure}>
          <summary>持仓市值分布矩阵 <ChevronRight size={15} /></summary>
          <SummaryMktMatrix mktDataMap={data.mktDataMap} />
        </details>
        <details className={styles.dataDisclosure}>
          <summary>交易归因盈亏矩阵 <ChevronRight size={15} /></summary>
          <SummaryPlMatrix plDataMap={data.plDataMap} />
        </details>
      </SectionCard>
    </>
  );
}

function CashPanel({ cache }: { cache: MobileCacheDoc | null }) {
  const data = cache?.data || {};
  return (
    <SectionCard title="当前现金二维统计表" note="对应资金页面的当前现金二维统计表。" time={latestTime(cache?.calculatedAt, data.currentCashStats?.updatedAt)}>
      <MatrixTable matrix={data.currentCashStats} />
    </SectionCard>
  );
}

function StocksPanel({ cache }: { cache: MobileCacheDoc | null }) {
  const data = cache?.data || {};
  const holdings = asArray(data.holdings);
  const [mktSortDir, setMktSortDir] = useState<"desc" | "asc">("desc");
  const [currencyMode, setCurrencyMode] = useState<StockCurrencyMode>("local");
  const [fxRates, setFxRates] = useState<Record<string, number>>({
    ...FALLBACK_FX,
    ...(data.quoteStatus?.fxRates || {}),
  });
  const [fxLoading, setFxLoading] = useState(false);
  const [fxIsLive, setFxIsLive] = useState(false);
  const groupedHoldings = useMemo(() => {
    const map = new Map<string, any>();
    holdings.forEach((item: any) => {
      const key = `${item.code || ""}|${item.market || ""}`;
      const existing = map.get(key) || {
        code: item.code || "-",
        name: item.name || "-",
        market: item.market || "-",
        quantity: 0,
        avgCostNumerator: 0,
        priceNumerator: 0,
        priceWeight: 0,
        totalCostHKD: 0,
        mktValHKD: 0,
        unrealizedPnlHKD: 0,
      };
      const quantity = toNumber(item.quantity);
      const weight = Math.abs(quantity);
      existing.quantity += quantity;
      existing.avgCostNumerator += toNumber(item.avgCost ?? item.costPrice) * weight;
      existing.priceNumerator += toNumber(item.currentPrice) * weight;
      existing.priceWeight += weight;
      existing.totalCostHKD += toNumber(item.totalCostHKD);
      existing.mktValHKD += toNumber(item.mktValHKD);
      existing.unrealizedPnlHKD += toNumber(item.unrealizedPnlHKD);
      map.set(key, existing);
    });
    return Array.from(map.values()).map((item) => ({
      ...item,
      avgCost: item.priceWeight ? item.avgCostNumerator / item.priceWeight : 0,
      currentPrice: item.priceWeight ? item.priceNumerator / item.priceWeight : 0,
      localCost: item.quantity * (item.priceWeight ? item.avgCostNumerator / item.priceWeight : 0),
      localMktVal: item.quantity * (item.priceWeight ? item.priceNumerator / item.priceWeight : 0),
      localPnl: item.quantity * (
        (item.priceWeight ? item.priceNumerator / item.priceWeight : 0)
        - (item.priceWeight ? item.avgCostNumerator / item.priceWeight : 0)
      ),
      pnlRatio: Math.abs(item.quantity * (item.priceWeight ? item.avgCostNumerator / item.priceWeight : 0)) > 0
        ? item.quantity * ((item.priceWeight ? item.priceNumerator / item.priceWeight : 0) - (item.priceWeight ? item.avgCostNumerator / item.priceWeight : 0))
          / Math.abs(item.quantity * (item.priceWeight ? item.avgCostNumerator / item.priceWeight : 0))
        : 0,
    }));
  }, [holdings]);

  const currenciesKey = useMemo(() => Array.from(new Set([
    "HKD",
    "USD",
    ...groupedHoldings.map((item: any) => String(item.market || "HKD").toUpperCase()),
  ])).sort().join(","), [groupedHoldings]);

  useEffect(() => {
    let active = true;
    const refreshFxRates = async () => {
      setFxLoading(true);
      const currencies = currenciesKey.split(",").filter(Boolean);
      const cachedRates = data.quoteStatus?.fxRates || {};
      const results = await Promise.all(currencies.map(async (currency) => {
        if (currency === "HKD") return { currency, rate: 1, live: true };
        const fallbackRate = toNumber(cachedRates[currency], FALLBACK_FX[currency] || 1);
        try {
          const response = await fetch(`/api/quote?currency=${encodeURIComponent(currency)}&fresh=1&t=${Date.now()}`, { cache: "no-store" });
          if (!response.ok) return { currency, rate: fallbackRate, live: false };
          const quote = await response.json();
          return { currency, rate: toNumber(quote.rate, fallbackRate), live: Boolean(quote.isRealTimeFx) };
        } catch {
          return { currency, rate: fallbackRate, live: false };
        }
      }));
      if (!active) return;
      setFxRates(results.reduce<Record<string, number>>((rates, item) => {
        rates[item.currency] = item.rate;
        return rates;
      }, { ...FALLBACK_FX, ...cachedRates }));
      setFxIsLive(results.filter((item) => item.currency !== "HKD").every((item) => item.live));
      setFxLoading(false);
    };
    refreshFxRates();
    return () => { active = false; };
  }, [currenciesKey, data.quoteStatus?.fxRates]);

  const displayHoldings = useMemo(() => [...groupedHoldings].sort((a, b) => {
    const aHkd = Math.abs(a.localMktVal * (fxRates[a.market] || FALLBACK_FX[a.market] || 1));
    const bHkd = Math.abs(b.localMktVal * (fxRates[b.market] || FALLBACK_FX[b.market] || 1));
    return (
      mktSortDir === "desc"
        ? bHkd - aHkd
        : aHkd - bHkd
    );
  }), [fxRates, groupedHoldings, mktSortDir]);

  const convertFromLocal = (value: number, market: string) => {
    if (currencyMode === "local") return value;
    const valueInHkd = value * (fxRates[market] || FALLBACK_FX[market] || 1);
    if (currencyMode === "HKD") return valueInHkd;
    return valueInHkd / (fxRates.USD || FALLBACK_FX.USD);
  };

  if (!groupedHoldings.length) return <SectionCard title="当前持仓统计表" time={latestTime(cache?.calculatedAt)}><Empty>暂无股票持仓数据</Empty></SectionCard>;
  return (
    <SectionCard title={`当前持仓统计表 (${groupedHoldings.length} 只标的)`} note="对应股票页面的当前持仓统计表，手机版按股票代码和市场合并。" time={latestTime(cache?.calculatedAt)}>
      <div className={styles.stockToolbar}>
        <div className={styles.currencySwitch} role="group" aria-label="股票金额显示币种">
          {([['local', '本币'], ['HKD', 'HKD'], ['USD', 'USD']] as const).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              aria-pressed={currencyMode === mode}
              onClick={() => setCurrencyMode(mode)}
              className={`${styles.currencySwitchButton} ${currencyMode === mode ? styles.currencySwitchButtonActive : ""}`}
            >
              {label}
            </button>
          ))}
        </div>
        <span className={styles.fxStatus}>
          {fxLoading ? "汇率更新中…" : `USD/HKD ${formatNumber(fxRates.USD, 4)} · ${fxIsLive ? "实时" : "缓存"}`}
        </span>
      </div>
      <div className={styles.tableWrap}>
        <table className={`${styles.table} ${styles.stockTable}`}>
          <colgroup>
            <col className={styles.stockCodeColumn} />
            <col className={styles.stockNameColumn} />
            <col className={styles.stockMarketColumn} />
            <col className={styles.stockQuantityColumn} />
            <col span={2} className={styles.stockPriceColumn} />
            <col span={3} className={styles.stockAmountColumn} />
            <col className={styles.stockRatioColumn} />
          </colgroup>
          <thead><tr><th>代码</th><th>名称</th><th>市场</th><th>数量</th><th>成本均价</th><th>现价</th><th>总成本</th><th><button type="button" onClick={() => setMktSortDir((prev) => prev === "desc" ? "asc" : "desc")} className="font-bold text-inherit">现市值 {mktSortDir === "desc" ? "▼" : "▲"}</button></th><th>浮动盈亏</th><th>盈亏比</th></tr></thead>
          <tbody>
            {displayHoldings.map((item: any) => {
              const stockName = String(item.name || "-");
              const market = String(item.market || "HKD").toUpperCase();
              const nameDisplayWidth = Array.from(stockName).reduce((width, char) => width + (/[^\u0000-\u00ff]/.test(char) ? 2 : 1), 0);
              const shouldScrollName = nameDisplayWidth > 18;
              const displayAvgCost = convertFromLocal(item.avgCost, market);
              const displayCurrentPrice = convertFromLocal(item.currentPrice, market);
              const displayCost = convertFromLocal(item.localCost, market);
              const displayMktVal = convertFromLocal(item.localMktVal, market);
              const displayPnl = convertFromLocal(item.localPnl, market);
              return (
              <tr key={`${item.code}-${item.market}`}>
                <td>{item.code}</td>
                <td className={styles.stockNameCell} title={stockName}>
                  <span className={styles.stockNameViewport}>
                    <span className={`${styles.stockNameTrack} ${shouldScrollName ? styles.stockNameTrackMoving : ""}`}>
                      <span>{stockName}</span>
                      {shouldScrollName ? <span aria-hidden="true">{stockName}</span> : null}
                    </span>
                  </span>
                </td>
                <td>{market}</td>
                <td>{formatNumber(item.quantity, 2)}</td><td>{formatNumber(displayAvgCost, 4)}</td><td>{formatNumber(displayCurrentPrice, 4)}</td>
                <td>{formatHKD(displayCost, 2)}</td><td>{formatHKD(displayMktVal, 2)}</td><td className={signedClass(displayPnl)}>{formatHKD(displayPnl, 2)}</td><td>{formatPercent(item.pnlRatio)}</td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}

function FCNPanel({ rows }: { rows: MergedRecord[] }) {
  const tableRows = rows.map((row) => {
    const input = clean(row.inputData);
    const output = clean(row.outputData);
    const p = output.adjustedPricerParams || input.pricerParams || {};
    const res = output.result || {};
    const factor = toNumber(p.total_notional) / Math.max(toNumber(p.denomination), 1);
    const mktVal = toNumber(res.dirty_price) * factor;
    const realized = toNumber(res.hist_coupons_paid) * factor;
    const unrealizedCoupon = (toNumber(res.pending_coupons_pv) + toNumber(res.future_coupons_pv)) * factor;
    const impliedLoss = toNumber(res.implied_loss_pv) * factor;
    const unrealized = unrealizedCoupon - impliedLoss;
    const totalPnl = (toNumber(res.dirty_price) + toNumber(res.hist_coupons_paid) - toNumber(p.denomination)) * factor;
    const noteName = asArray(p.ticker_name).length ? asArray(p.ticker_name).join(" + ") : asArray(p.tickers).join(" + ");
    const dateRows = asArray(input.dateRows);
    const nextObs = dateRows.map((item: any) => item.obsDate || item.obs_date || item.obsEnd || item.obs_end).filter((date: string) => date >= todayDate()).sort()[0] || "";
    return {
      id: row.tradeId,
      status: res.status || "-",
      tradeDate: p.trade_date || input.inputParams?.trade_date || "",
      name: noteName || row.tradeId,
      account: p.account_name || input.inputParams?.account_name || "-",
      currency: p.market || p.currency || "HKD",
      notional: toNumber(p.total_notional),
      coupon: toNumber(p.coupon_rate),
      strike: `${pct(p.strike_pct)} / ${pct(p.trigger_pct)}`,
      nextObs,
      maturity: dateRows[dateRows.length - 1]?.payDate || p.maturity_date || "",
      earlyProb: toNumber(res.early_redemption_prob),
      lossProb: toNumber(res.loss_prob),
      mktVal,
      realized,
      unrealized,
      unrealizedCoupon,
      impliedLoss,
      totalPnl,
    };
  });
  if (!tableRows.length) return <SectionCard title="FCN 持仓板块（存续中）"><Empty>暂无存续中 FCN</Empty></SectionCard>;
  return (
    <SectionCard title={`FCN 存续持仓 (${tableRows.length})`} note="关键估值与风险优先展示，完整条款可展开。">
      <div className={styles.recordList}>
        {tableRows.map((item) => <RecordCard
          key={item.id}
          title={item.name}
          subtitle={`${item.account} · ${item.currency}`}
          status={item.status}
          highlights={[
            { label: "当前市值", value: formatHKD(item.mktVal, 2) },
            { label: "累计盈亏", value: formatHKD(item.totalPnl, 2), tone: item.totalPnl >= 0 ? "positive" : "negative" },
            { label: "接货概率", value: formatPercent(item.lossProb) },
          ]}
          details={[
            { label: "交易日期", value: item.tradeDate || "—" },
            { label: "总名义本金", value: formatHKD(item.notional, 2) },
            { label: "年化票息", value: formatPercent(item.coupon) },
            { label: "敲入 / 出界", value: item.strike },
            { label: "下个观察日", value: item.nextObs || "—" },
            { label: "最后结算日", value: item.maturity || "—" },
            { label: "提前赎回概率", value: formatPercent(item.earlyProb) },
            { label: "已实现票息", value: formatHKD(item.realized, 2) },
            { label: "未实现票息", value: formatHKD(item.unrealizedCoupon, 2) },
            { label: "隐含亏损", value: formatHKD(item.impliedLoss, 2), tone: item.impliedLoss > 0 ? "negative" : undefined },
            { label: "未实现损益", value: formatHKD(item.unrealized, 2), tone: item.unrealized >= 0 ? "positive" : "negative" },
          ]}
        />)}
      </div>
    </SectionCard>
  );
}

function DQAQPanel({ rows }: { rows: MergedRecord[] }) {
  const tableRows = rows.map((row) => {
    const input = clean(row.inputData);
    const basic = clean(input.basic);
    const underlying = clean(input.underlying);
    const periods = asArray(input.periods);
    const res = clean(row.outputData);
    const initialPrice = toNumber(underlying.spot_price);
    const currentPrice = toNumber(underlying.current_price || underlying.spot_price);
    return {
      id: row.tradeId,
      status: res.status_msg || res.status || "-",
      tradeDate: basic.trade_date || "",
      name: `${basic.broker || "-"} | ${underlying.stock_name || underlying.ticker || row.tradeId}`,
      currency: basic.currency || "HKD",
      dir: basic.contract_type || "-",
      leverage: toNumber(basic.leverage),
      daily: toNumber(basic.daily_shares),
      max: toNumber(basic.max_global_shares),
      initialPrice,
      currentPrice,
      koInPrice: initialPrice * toNumber(basic.strike_pct),
      koOutPrice: initialPrice * toNumber(basic.ko_barrier_pct),
      nextObs: periods.map((p: any) => p.obs_end).filter((date: string) => date >= todayDate()).sort()[0] || "",
      maturity: periods[periods.length - 1]?.settle_date || "",
      koProb: toNumber(res.ko_probability),
      expRate: toNumber(res.exp_completion_rate),
      mktVal: toNumber(res.val_net_usd),
      settled: toNumber(res.shares_settled_paid),
      locked: toNumber(res.shares_locked_unpaid),
      fullPrice: toNumber(res.val_full_usd),
    };
  });
  if (!tableRows.length) return <SectionCard title="DQ-AQ 持仓板块 (存续中)"><Empty>暂无存续中 DQ-AQ</Empty></SectionCard>;
  return (
    <SectionCard title={`DQ-AQ 存续持仓 (${tableRows.length})`} note="净价、完成率与敲出风险前置展示。">
      <div className={styles.recordList}>
        {tableRows.map((item) => <RecordCard
          key={item.id}
          title={item.name}
          subtitle={`${item.currency} · ${item.dir}`}
          status={item.status}
          highlights={[
            { label: "当前净值", value: formatHKD(item.mktVal, 2) },
            { label: "完成率", value: formatPercent(item.expRate) },
            { label: "KO 概率", value: formatPercent(item.koProb) },
          ]}
          details={[
            { label: "交易日期", value: item.tradeDate || "—" },
            { label: "杠杆", value: `${formatNumber(item.leverage, 2)}x` },
            { label: "每日股数", value: formatNumber(item.daily, 2) },
            { label: "最大股数", value: formatNumber(item.max, 2) },
            { label: "初始价", value: formatNumber(item.initialPrice, 4) },
            { label: "现价", value: formatNumber(item.currentPrice, 4) },
            { label: "敲入价", value: formatNumber(item.koInPrice, 4) },
            { label: "敲出价", value: formatNumber(item.koOutPrice, 4) },
            { label: "下个观察日", value: item.nextObs || "—" },
            { label: "最后结算日", value: item.maturity || "—" },
            { label: "已结算股数", value: formatNumber(item.settled, 2) },
            { label: "锁定未付股数", value: formatNumber(item.locked, 2) },
            { label: "当前全价", value: formatHKD(item.fullPrice, 2) },
          ]}
        />)}
      </div>
    </SectionCard>
  );
}

function OptionPanel({ rows }: { rows: MergedRecord[] }) {
  const tableRows = rows.map((row) => {
    const input = clean(row.inputData);
    const basic = clean(input.basic);
    const und = clean(input.underlying);
    const dates = clean(input.dates);
    const out = clean(row.outputData);
    return {
      id: row.tradeId,
      status: out.status || "-",
      tradeDate: dates.tradeDate || "",
      expiryDate: dates.expiryDate || "",
      name: out.name || `${und.ticker || "-"} ${basic.direction || ""} ${und.strike || ""} ${basic.optionType || ""}`,
      ticker: und.ticker || "",
      account: basic.account || "",
      currency: basic.currency || "USD",
      notional: toNumber(out.notional),
      strike: toNumber(und.strike),
      spotPrice: toNumber(und.spotPrice),
      realizedPremium: toNumber(out.realizedPremium),
      unrealizedPnl: toNumber(out.expectedPayoff),
      totalPnl: toNumber(out.totalPnl),
    };
  });
  if (!tableRows.length) return <SectionCard title="Option 持仓板块 (存续中)"><Empty>暂无存续中 Option</Empty></SectionCard>;
  return (
    <SectionCard title={`Option 存续持仓 (${tableRows.length})`} note="总收益与到期信息优先展示。">
      <div className={styles.recordList}>
        {tableRows.map((item) => <RecordCard
          key={item.id}
          title={item.name}
          subtitle={`${item.ticker} · ${item.account} · ${item.currency}`}
          status={item.status}
          highlights={[
            { label: "总收益", value: formatHKD(item.totalPnl, 2), tone: item.totalPnl >= 0 ? "positive" : "negative" },
            { label: "未实现", value: formatHKD(item.unrealizedPnl, 2), tone: item.unrealizedPnl >= 0 ? "positive" : "negative" },
            { label: "结算日期", value: item.expiryDate || "—" },
          ]}
          details={[
            { label: "交易日期", value: item.tradeDate || "—" },
            { label: "名义金额", value: formatHKD(item.notional, 2) },
            { label: "执行价", value: formatNumber(item.strike, 2) },
            { label: "标的现价", value: formatNumber(item.spotPrice, 2) },
            { label: "已实现期权金", value: formatHKD(item.realizedPremium, 2), tone: item.realizedPremium >= 0 ? "positive" : "negative" },
          ]}
        />)}
      </div>
    </SectionCard>
  );
}

function SimpleHoldingTable({ title, rows, time }: { title: string; rows: SimpleHolding[]; time?: string }) {
  if (!rows.length) return <SectionCard title={title} time={time}><Empty>暂无当前持仓数据</Empty></SectionCard>;
  return (
    <SectionCard title={`${title} (${rows.length})`} note="市值与浮动盈亏优先展示，账户明细可展开。" time={time}>
      <div className={styles.recordList}>
        {rows.map((item) => <RecordCard
          key={item.code}
          title={item.name}
          subtitle={`${item.code} · ${item.market}`}
          highlights={[
            { label: "现市值 HKD", value: formatHKD(item.mktValHKD, 2) },
            { label: "浮动盈亏", value: formatHKD(item.unrealizedPnlHKD, 2), tone: item.unrealizedPnlHKD >= 0 ? "positive" : "negative" },
            { label: "盈亏比", value: formatPercent(item.pnlRatio), tone: item.pnlRatio >= 0 ? "positive" : "negative" },
          ]}
          details={[
            { label: "持有数量", value: formatNumber(item.quantity, 4) },
            { label: "单位平均成本", value: formatNumber(item.avgCost, 4) },
            { label: "最新内部估值", value: formatNumber(item.currentPrice, 4) },
            { label: "总成本 HKD", value: formatHKD(item.totalCostHKD, 2) },
            { label: "账户数量分布", value: Object.entries(item.accounts).filter(([, qty]) => qty > 0).map(([acc, qty]) => `${acc}: ${formatNumber(qty, 2)}`).join("；") || "—" },
          ]}
        />)}
      </div>
    </SectionCard>
  );
}

const fetchMergedRecords = async (prefix: "fcn" | "dqaq" | "option") => {
  const [inputs, outputs] = await Promise.all([
    getCollectionRows<any>(`sip_trade_${prefix}_input_living`),
    getCollectionRows<any>(`sip_holding_${prefix}_output_living`),
  ]);
  return inputs.map((input) => {
    const output = outputs.find((item) => item.tradeId && item.tradeId === input.tradeId);
    if (!output) return null;
    return { tradeId: input.tradeId, inputId: input.id, outputId: output.id, inputData: input, outputData: output } as MergedRecord;
  }).filter(Boolean) as MergedRecord[];
};

const loadSimpleHoldings = async (kind: "pe" | "cbbc") => {
  const startCollection = kind === "pe" ? "sip_holding_pe_start" : "sip_holding_cbbc_start";
  const tradeCollection = kind === "pe" ? "sip_trade_pe" : "sip_trade_cbbc";
  const priceCollection = kind === "pe" ? "sip_holding_pe_lastprice" : "sip_holding_cbbc_lastprice";
  const codeKey = kind === "pe" ? "fundCode" : "futuresCode";
  const nameKey = kind === "pe" ? "fundName" : "futuresName";
  const [starts, trades, prices] = await Promise.all([
    getCollectionRows<any>(startCollection),
    getCollectionRows<any>(tradeCollection),
    getCollectionRows<any>(priceCollection),
  ]);
  const global = starts.find((item) => item.id === "_global_config") || {};
  const baseDate = String(global.baseDate || "");
  const fxRates: Record<string, number> = { ...FALLBACK_FX, ...(global.baseFxRates || {}) };
  const priceMap = new Map(prices.map((item) => [item.id, item]));
  const map = new Map<string, SimpleHolding & { localCost: number }>();

  const ensure = (code: string, row: any): SimpleHolding & { localCost: number } => {
    const current = map.get(code) || {
      code,
      name: row[nameKey] || code,
      market: row.market || "HKD",
      quantity: 0,
      avgCost: 0,
      currentPrice: 0,
      totalCostHKD: 0,
      mktValHKD: 0,
      unrealizedPnlHKD: 0,
      pnlRatio: 0,
      accounts: {},
      localCost: 0,
    };
    map.set(code, current);
    return current;
  };

  starts.filter((item) => item.id !== "_global_config").forEach((item) => {
    const code = String(item[codeKey] || "");
    if (!code) return;
    const h = ensure(code, item);
    const qty = toNumber(item.quantity);
    const costPrice = toNumber(item.costPrice);
    const account = String(item.account || "N/A");
    h.accounts[account] = toNumber(h.accounts[account]) + qty;
    h.localCost += qty * costPrice;
    h.quantity += qty;
    h.avgCost = h.quantity ? h.localCost / h.quantity : 0;
  });

  trades.filter((item) => !baseDate || String(item.date || "") > baseDate).sort((a, b) => String(a.date || "").localeCompare(String(b.date || ""))).forEach((item) => {
    const code = String(item[codeKey] || "");
    if (!code) return;
    const h = ensure(code, item);
    const direction = String(item.direction || "BUY").toUpperCase() === "SELL" ? "SELL" : "BUY";
    const qty = Math.abs(toNumber(item.quantity));
    const signedQty = direction === "BUY" ? qty : -qty;
    const account = String(item.account || "N/A");
    h.accounts[account] = toNumber(h.accounts[account]) + signedQty;
    if (direction === "BUY") {
      h.localCost += toNumber(item.amount_incl_fee || item.amount_excl_fee || item.amount || qty * toNumber(item.price));
      h.quantity += qty;
      h.avgCost = h.quantity ? h.localCost / h.quantity : 0;
    } else {
      const sellQty = Math.min(qty, h.quantity);
      h.localCost -= sellQty * h.avgCost;
      h.quantity -= sellQty;
      if (h.quantity <= 0) {
        h.quantity = 0;
        h.localCost = 0;
        h.avgCost = 0;
      }
    }
  });

  Array.from(map.values()).forEach((item) => {
    const rate = fxRates[item.market] || 1;
    const price = priceMap.get(item.code)?.price;
    item.currentPrice = toNumber(price, item.avgCost);
    item.totalCostHKD = item.quantity * item.avgCost * rate;
    item.mktValHKD = item.quantity * item.currentPrice * rate;
    item.unrealizedPnlHKD = item.mktValHKD - item.totalCostHKD;
    item.pnlRatio = item.totalCostHKD ? item.unrealizedPnlHKD / item.totalCostHKD : 0;
  });

  return Array.from(map.values()).filter((item) => item.quantity > 0).sort((a, b) => b.mktValHKD - a.mktValHKD);
};

export default function MobileHoldingsPage() {
  const [activeTab, setActiveTab] = useState<TabKey>("summary");
  const [state, setState] = useState<HoldingsState>(EMPTY_STATE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        setLoading(true);
        await ensureMobileFirebaseAuth();
        const [summary, cash, stocks, fcnLiving, dqaqLiving, optionLiving, peMkt, pePl, cbbcMkt, cbbcPl, peHoldings, cbbcHoldings, initialState, cashTrades] = await Promise.all([
          getDisplayCache("summary"),
          getDisplayCache("cash"),
          getDisplayCache("stocks"),
          fetchMergedRecords("fcn"),
          fetchMergedRecords("dqaq"),
          fetchMergedRecords("option"),
          getDataDoc<MatrixData>("sip_holding_pe_mktvalue"),
          getDataDoc<MatrixData>("sip_holding_pe_pl"),
          getDataDoc<MatrixData>("sip_holding_cbbc_mktvalue"),
          getDataDoc<MatrixData>("sip_holding_cbbc_pl"),
          loadSimpleHoldings("pe"),
          loadSimpleHoldings("cbbc"),
          getDataDoc<InitialPortfolioState>("sip_holding_summary_nav_config", "global"),
          getCollectionRows<CashTradeRecord>("sip_trade_cash"),
        ]);
        const capitalFlows = await buildCapitalFlowsFromCashTrades(
          cashTrades,
          initialState?.fxRates || summary?.data?.fxRates || FALLBACK_FX,
        ).catch(() => []);
        if (!mounted) return;
        setState({ summary, cash, stocks, fcnLiving, dqaqLiving, optionLiving, pe: { mkt: peMkt, pl: pePl }, cbbc: { mkt: cbbcMkt, pl: cbbcPl }, peHoldings, cbbcHoldings, initialState, capitalFlows });
        setError("");
      } catch (err: any) {
        if (mounted) setError(err?.message || "读取移动端持仓数据失败");
      } finally {
        if (mounted) setLoading(false);
      }
    };
    load();
    return () => { mounted = false; };
  }, [refreshKey]);

  const panel = useMemo(() => {
    if (activeTab === "summary") return <SummaryPanel cache={state.summary} initialState={state.initialState} capitalFlows={state.capitalFlows} />;
    if (activeTab === "cash") return <CashPanel cache={state.cash} />;
    if (activeTab === "stocks") return <StocksPanel cache={state.stocks} />;
    if (activeTab === "fcn") return <FCNPanel rows={state.fcnLiving} />;
    if (activeTab === "dqaq") return <DQAQPanel rows={state.dqaqLiving} />;
    if (activeTab === "option") return <OptionPanel rows={state.optionLiving} />;
    if (activeTab === "pe") return <SimpleHoldingTable title="当前私募基金统计表" rows={state.peHoldings} time={getSummaryTime(state.pe.mkt || state.pe.pl)} />;
    return <SimpleHoldingTable title="当前牛熊证/期货统计表" rows={state.cbbcHoldings} time={getSummaryTime(state.cbbc.mkt || state.cbbc.pl)} />;
  }, [activeTab, state]);

  return (
    <MobileShell title="持仓" subtitle="组合市值、收益与产品持仓，一屏掌握。">
      <div className={styles.syncBar}>
        <div>
          <span className={styles.syncState}><i />只读数据已同步</span>
          <small>{latestTime(state.summary?.calculatedAt, state.summary?.updatedAt)}</small>
        </div>
        <button type="button" onClick={() => setRefreshKey((value) => value + 1)} disabled={loading} aria-label="刷新持仓数据">
          <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
          刷新
        </button>
      </div>
      <div className={styles.tabRail}>
        {TABS.map((tab) => (
          <button key={tab.key} type="button" onClick={() => setActiveTab(tab.key)} className={`${styles.tabButton} ${activeTab === tab.key ? styles.tabButtonActive : ""}`}>{tab.label}</button>
        ))}
      </div>
      {loading ? (
        <section className={`${styles.card} p-6 text-center ${styles.muted}`}><Loader2 className="mx-auto mb-3 animate-spin" size={22} />正在读取只读持仓数据...</section>
      ) : error ? (
        <div className={styles.alert}><AlertCircle size={14} className="inline mr-1" />{error}</div>
      ) : panel}
    </MobileShell>
  );
}
