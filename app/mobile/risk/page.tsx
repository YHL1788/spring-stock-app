"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertCircle, ChevronRight, Loader2, RefreshCw } from "lucide-react";
import MobileShell from "../MobileShell";
import styles from "../mobile.module.css";
import {
  ensureMobileFirebaseAuth,
  formatHKD,
  formatNumber,
  formatPercent,
  getCollectionRows,
  getDataDoc,
  getSummaryTime,
  toNumber,
} from "../mobileData";

type RiskTab = "underlying" | "industry";
type ExposureSourceKey = "dqaq" | "fcn" | "option" | "spot";

type ExposureRow = {
  symbol: string;
  market: string;
  source: ExposureSourceKey;
  shares: number;
  cost: number;
};

type GroupedUnderlying = {
  key: string;
  symbol: string;
  market: string;
  name: string;
  shares: number;
  cost: number;
  price: number | null;
  fxRate: number;
  mktValHKD: number | null;
  pnlHKD: number | null;
  sector1: string;
  sector2: string;
};

type SourceStatus = {
  label: string;
  count: number;
  updatedAt: string;
};

const SOURCES: Array<{ key: ExposureSourceKey; label: string; collection: string }> = [
  { key: "dqaq", label: "DQ-AQ", collection: "sip_exposure_dqaq" },
  { key: "fcn", label: "FCN", collection: "sip_exposure_fcn" },
  { key: "option", label: "Option", collection: "sip_exposure_option" },
  { key: "spot", label: "Spot", collection: "sip_exposure_spot" },
];

const inferMarket = (symbol: string, fallback?: string) => {
  const normalized = String(fallback || "").trim().toUpperCase();
  if (normalized) return normalized;
  if (symbol.endsWith(".HK")) return "HKD";
  if (symbol.endsWith(".T")) return "JPY";
  if (symbol.endsWith(".SS") || symbol.endsWith(".SZ")) return "CNY";
  return "USD";
};

const normalizeSymbol = (value: string) => value.trim().toUpperCase();

async function fetchQuote(symbol: string) {
  const candidates = symbol.endsWith(".US") ? [symbol, symbol.replace(/\.US$/, "")] : [symbol];
  for (const candidate of candidates) {
    try {
      const res = await fetch(`/api/quote?symbol=${encodeURIComponent(candidate)}&fresh=1&t=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) continue;
      const data = await res.json();
      const price = toNumber(data.regularMarketPrice || data.price || data.close);
      if (price > 0) return price;
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

async function fetchFxRate(market: string) {
  if (market === "HKD") return 1;
  try {
    const res = await fetch(`/api/quote?currency=${encodeURIComponent(market)}&fresh=1&t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return 1;
    const data = await res.json();
    const rate = toNumber(data.rate, 1);
    return rate > 0 ? rate : 1;
  } catch {
    return 1;
  }
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "positive" | "negative" }) {
  return (
    <div className={styles.metric}>
      <div className={styles.metricLabel}>{label}</div>
      <div className={`${styles.metricValue} ${tone === "positive" ? styles.positive : tone === "negative" ? styles.negative : ""}`}>{value}</div>
    </div>
  );
}

function SourceList({ statuses }: { statuses: SourceStatus[] }) {
  return (
    <div className={styles.list}>
      {statuses.map((status) => (
        <div className={styles.listItem} key={status.label}>
          <div className={styles.listTitle}>
            <span>{status.label}</span>
            <span>{status.count} 条</span>
          </div>
          <div className={styles.listMeta}>入库时间：{status.updatedAt}</div>
        </div>
      ))}
    </div>
  );
}

function UnderlyingTable({ rows }: { rows: GroupedUnderlying[] }) {
  if (!rows.length) return <div className={styles.empty}>暂无标的暴露数据</div>;
  return (
    <div className={styles.recordList}>
      {rows.slice(0, 100).map((row) => (
        <article className={styles.recordCard} key={row.key}>
          <div className={styles.recordHeader}>
            <div className={styles.recordIdentity}>
              <h3>{row.name}</h3>
              <p>{row.symbol}</p>
            </div>
            <span className={styles.recordStatus}>{row.market}</span>
          </div>
          <div className={styles.recordHighlights}>
            <div className={styles.recordHighlight}><span>暴露市值</span><strong>{formatHKD(row.mktValHKD, 2)}</strong></div>
            <div className={styles.recordHighlight}><span>浮动盈亏</span><strong className={(row.pnlHKD || 0) >= 0 ? styles.positive : styles.negative}>{formatHKD(row.pnlHKD, 2)}</strong></div>
            <div className={styles.recordHighlight}><span>暴露股数</span><strong>{formatNumber(row.shares, 2)}</strong></div>
          </div>
          <details className={styles.recordDetails}>
            <summary>查看风险明细 <ChevronRight size={14} /></summary>
            <div className={styles.recordDetailGrid}>
              <div><span>现价</span><strong>{formatNumber(row.price, 4)}</strong></div>
              <div><span>成本 HKD</span><strong>{formatHKD(row.cost, 2)}</strong></div>
              <div><span>一级行业</span><strong>{row.sector1}</strong></div>
              <div><span>二级行业</span><strong>{row.sector2}</strong></div>
              <div><span>汇率</span><strong>{formatNumber(row.fxRate, 4)}</strong></div>
            </div>
          </details>
        </article>
      ))}
    </div>
  );
}

function IndustryTable({ rows }: { rows: GroupedUnderlying[] }) {
  const groups = useMemo(() => {
    const map = new Map<string, { name: string; value: number; count: number; pnl: number }>();
    rows.forEach((row) => {
      const key = row.sector1 || "未知";
      const item = map.get(key) || { name: key, value: 0, count: 0, pnl: 0 };
      item.value += Math.abs(row.mktValHKD || 0);
      item.pnl += row.pnlHKD || 0;
      item.count += 1;
      map.set(key, item);
    });
    return Array.from(map.values()).sort((a, b) => b.value - a.value);
  }, [rows]);
  const total = groups.reduce((sum, item) => sum + item.value, 0);

  if (!groups.length) return <div className={styles.empty}>暂无行业暴露数据</div>;

  return (
    <div className={styles.industryList}>
      {groups.map((item) => {
        const ratio = total > 0 ? item.value / total : 0;
        return (
          <div key={item.name} className={styles.industryItem}>
            <div className={styles.industryTopline}>
              <div><strong>{item.name}</strong><span>{item.count} 个标的</span></div>
              <div><strong>{formatHKD(item.value, 0)}</strong><span className={item.pnl >= 0 ? styles.positive : styles.negative}>{formatHKD(item.pnl, 0)}</span></div>
            </div>
            <div className={styles.industryTrack}><span style={{ width: `${Math.max(ratio * 100, 1)}%` }} /></div>
            <small>{formatPercent(ratio)} 暴露占比</small>
          </div>
        );
      })}
    </div>
  );
}

export default function MobileRiskPage() {
  const [activeTab, setActiveTab] = useState<RiskTab>("underlying");
  const [rows, setRows] = useState<GroupedUnderlying[]>([]);
  const [statuses, setStatuses] = useState<SourceStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [lastSyncedAt, setLastSyncedAt] = useState("");

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      try {
        setLoading(true);
        await ensureMobileFirebaseAuth();
        const [sourceDocs, stockPool] = await Promise.all([
          Promise.all(SOURCES.map(async (source) => ({ source, doc: await getDataDoc<any>(source.collection) }))),
          getCollectionRows<any>("stock_pool"),
        ]);

        const nextStatuses: SourceStatus[] = [];
        const exposures: ExposureRow[] = [];
        sourceDocs.forEach(({ source, doc }) => {
          const items = Array.isArray(doc?.data) ? doc.data : [];
          nextStatuses.push({ label: source.label, count: items.length, updatedAt: getSummaryTime(doc) });
          items.forEach((item: any) => {
            const rawSymbol = item.ticker || item.code || item.symbol;
            if (!rawSymbol) return;
            const symbol = normalizeSymbol(String(rawSymbol));
            exposures.push({
              symbol,
              market: inferMarket(symbol, item.market || item.currency),
              source: source.key,
              shares: toNumber(item.shares),
              cost: toNumber(item.cost),
            });
          });
        });

        const stockMap = new Map<string, any>();
        stockPool.forEach((stock) => {
          if (stock.symbol) stockMap.set(normalizeSymbol(String(stock.symbol)), stock);
        });

        const symbols = Array.from(new Set(exposures.map((item) => item.symbol)));
        const markets = Array.from(new Set(exposures.map((item) => item.market)));
        const [quotePairs, fxPairs] = await Promise.all([
          Promise.all(symbols.map(async (symbol) => [symbol, await fetchQuote(symbol)] as const)),
          Promise.all(markets.map(async (market) => [market, await fetchFxRate(market)] as const)),
        ]);
        const quoteMap = Object.fromEntries(quotePairs);
        const fxMap = Object.fromEntries(fxPairs);

        const grouped = new Map<string, GroupedUnderlying & { localCost: number }>();
        exposures.forEach((item) => {
          const key = `${item.symbol}|${item.market}`;
          const stock = stockMap.get(item.symbol) || stockMap.get(item.symbol.replace(/\.US$/, ""));
          const current = grouped.get(key) || {
            key,
            symbol: item.symbol,
            market: item.market,
            name: stock?.name || item.symbol,
            shares: 0,
            cost: 0,
            price: null,
            fxRate: fxMap[item.market] || 1,
            mktValHKD: null,
            pnlHKD: null,
            sector1: stock?.sector_level_1 || "未知",
            sector2: stock?.sector_level_2 || "未知",
            localCost: 0,
          };
          current.shares += item.shares;
          current.localCost += item.cost;
          current.cost += item.cost * current.fxRate;
          grouped.set(key, current);
        });

        const nextRows = Array.from(grouped.values()).map((row) => {
          const price = quoteMap[row.symbol] ?? null;
          const mktValHKD = price !== null ? row.shares * price * row.fxRate : null;
          return {
            ...row,
            price,
            mktValHKD,
            pnlHKD: mktValHKD !== null ? mktValHKD - row.cost : null,
          };
        }).sort((a, b) => Math.abs(b.mktValHKD || b.cost) - Math.abs(a.mktValHKD || a.cost));

        if (!mounted) return;
        setRows(nextRows);
        setStatuses(nextStatuses);
        setLastSyncedAt(new Date().toLocaleString("zh-CN", { hour12: false }));
        setError("");
      } catch (err: any) {
        if (mounted) setError(err?.message || "读取移动端风控数据失败");
      } finally {
        if (mounted) setLoading(false);
      }
    };

    load();
    return () => { mounted = false; };
  }, [refreshKey]);

  const totalExposure = rows.reduce((sum, row) => sum + Math.abs(row.mktValHKD || 0), 0);
  const totalPnl = rows.reduce((sum, row) => sum + (row.pnlHKD || 0), 0);
  const maxSingle = rows[0];
  const maxSingleRatio = totalExposure > 0 ? Math.abs(maxSingle?.mktValHKD || 0) / totalExposure : 0;

  return (
    <MobileShell title="风险" subtitle="实时暴露、集中度与行业风险，清晰可见。">
      <div className={styles.syncBar}>
        <div>
          <span className={styles.syncState}><i />行情与汇率已同步</span>
          <small>{lastSyncedAt || "正在连接数据"}</small>
        </div>
        <button type="button" onClick={() => setRefreshKey((value) => value + 1)} disabled={loading} aria-label="刷新风险数据">
          <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
          刷新
        </button>
      </div>
      <div className={styles.tabRail}>
        <button type="button" onClick={() => setActiveTab("underlying")} className={`${styles.tabButton} ${activeTab === "underlying" ? styles.tabButtonActive : ""}`}>标的暴露</button>
        <button type="button" onClick={() => setActiveTab("industry")} className={`${styles.tabButton} ${activeTab === "industry" ? styles.tabButtonActive : ""}`}>行业暴露</button>
      </div>

      {loading ? (
        <section className={`${styles.card} p-6 text-center ${styles.muted}`}>
          <Loader2 className="mx-auto mb-3 animate-spin" size={22} />
          正在读取只读风控数据...
        </section>
      ) : error ? (
        <div className={styles.alert}><AlertCircle size={14} className="inline mr-1" />{error}</div>
      ) : (
        <>
          <section className={`${styles.card} mb-4`}>
            <div className={styles.cardHeader}>
              <div>
                <h2 className={styles.cardTitle}>风险总览</h2>
                <p className={styles.cardNote}>多空净额合并后的关键风险指标。</p>
              </div>
              <div className={styles.statusPill}>{rows.length} 个标的</div>
            </div>
            <div className={styles.summaryMetrics}>
              <Metric label="总暴露市值 HKD" value={formatHKD(totalExposure, 0)} />
              <Metric label="浮动盈亏 HKD" value={formatHKD(totalPnl, 0)} tone={totalPnl >= 0 ? "positive" : "negative"} />
              <Metric label="最大单一标的" value={maxSingle?.symbol || "-"} />
              <Metric label="最大标的占比" value={formatPercent(maxSingleRatio)} />
            </div>
            <details className={styles.dataDisclosure}>
              <summary>数据覆盖范围 <ChevronRight size={15} /></summary>
              <SourceList statuses={statuses} />
            </details>
          </section>

          <section className={`${styles.card} mb-4`}>
            <div className={styles.cardHeader}>
              <div>
                <h2 className={styles.cardTitle}>{activeTab === "underlying" ? "综合标的暴露" : "行业暴露情况"}</h2>
                <p className={styles.cardNote}>{activeTab === "underlying" ? "按股票代码与市场合并展示。" : "按一级行业聚合展示暴露市值占比。"}</p>
              </div>
            </div>
            {activeTab === "underlying" ? <UnderlyingTable rows={rows} /> : <IndustryTable rows={rows} />}
          </section>
        </>
      )}
    </MobileShell>
  );
}
