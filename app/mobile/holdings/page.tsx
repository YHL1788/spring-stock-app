"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import MobileShell from "../MobileShell";
import styles from "../mobile.module.css";
import {
  ensureMobileFirebaseAuth,
  formatHKD,
  formatNumber,
  formatPercent,
  getCacheTime,
  getDataDoc,
  getDisplayCache,
  getSummaryTime,
  matrixRows,
  matrixTotal,
  pnlTotal,
  type MatrixData,
  type MobileCacheDoc,
} from "../mobileData";

type TabKey = "summary" | "cash" | "stocks" | "fcn" | "dqaq" | "option" | "pe" | "cbbc";

type FormalPair = {
  mkt: MatrixData | null;
  pl: MatrixData | null;
};

type HoldingsState = {
  summary: MobileCacheDoc | null;
  cash: MobileCacheDoc | null;
  stocks: MobileCacheDoc | null;
  fcn: MobileCacheDoc | null;
  dqaq: MobileCacheDoc | null;
  option: MobileCacheDoc | null;
  pe: FormalPair;
  cbbc: FormalPair;
};

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "summary", label: "汇总" },
  { key: "cash", label: "现金" },
  { key: "stocks", label: "股票" },
  { key: "fcn", label: "FCN" },
  { key: "dqaq", label: "DQ-AQ" },
  { key: "option", label: "Option" },
  { key: "pe", label: "私募" },
  { key: "cbbc", label: "牛熊证" },
];

const EMPTY_STATE: HoldingsState = {
  summary: null,
  cash: null,
  stocks: null,
  fcn: null,
  dqaq: null,
  option: null,
  pe: { mkt: null, pl: null },
  cbbc: { mkt: null, pl: null },
};

function Metric({ label, value, tone }: { label: string; value: string; tone?: "positive" | "negative" }) {
  return (
    <div className={styles.metric}>
      <div className={styles.metricLabel}>{label}</div>
      <div className={`${styles.metricValue} ${tone === "positive" ? styles.positive : tone === "negative" ? styles.negative : ""}`}>{value}</div>
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

function MatrixTable({ matrix, type = "mkt" }: { matrix?: MatrixData | null; type?: "mkt" | "pl" }) {
  const rows = matrixRows(matrix);
  const columns = useMemo(() => {
    if (type === "pl") return ["realized", "unrealized", "total"];
    const fromAccounts = matrix?.accounts || [];
    const fromRows = rows.flatMap(({ row }) => Object.keys(row || {}));
    return Array.from(new Set([...fromAccounts, ...fromRows]));
  }, [matrix?.accounts, rows, type]);

  if (!rows.length) return <div className={styles.empty}>暂无可展示矩阵数据</div>;

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
              {columns.map((column) => (
                <td key={column}>{formatHKD(type === "pl" ? row?.[column] : row?.[column], 2)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ExposureList({ rows }: { rows?: any[] }) {
  const data = Array.isArray(rows) ? rows.slice(0, 30) : [];
  if (!data.length) return <div className={styles.empty}>暂无暴露明细</div>;

  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>代码</th>
            <th>市场</th>
            <th>暴露股数</th>
            <th>成本</th>
            <th>成本价</th>
          </tr>
        </thead>
        <tbody>
          {data.map((item, index) => (
            <tr key={`${item.ticker || item.code || item.symbol}-${index}`}>
              <td>{item.ticker || item.code || item.symbol || "-"}</td>
              <td>{item.market || item.currency || "-"}</td>
              <td>{formatNumber(Number(item.shares || 0), 2)}</td>
              <td>{formatHKD(Number(item.cost || 0), 2)}</td>
              <td>{formatNumber(Number(item.costPrice || 0), 4)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SummaryPanel({ cache }: { cache: MobileCacheDoc | null }) {
  const snapshot = cache?.data?.snapshot || {};
  const assetMap = snapshot.marketValueByAssetHKD || {};
  const pnlMap = snapshot.pnlByAssetHKD || {};
  const exposureValue = snapshot.totalExposureMarketValueHKD ?? snapshot.exposureMarketValueHKD ?? null;
  const exposureRatio = snapshot.exposureRatio ?? (exposureValue && snapshot.totalMarketValueHKD ? exposureValue / snapshot.totalMarketValueHKD : null);

  return (
    <SectionCard title="Summary Holding" note="只读展示最新后端汇总缓存。" time={getCacheTime(cache)}>
      <div className={styles.grid}>
        <Metric label="总持仓市值 HKD" value={formatHKD(snapshot.totalMarketValueHKD, 0)} />
        <Metric label="净值盈亏 HKD" value={formatHKD(snapshot.totalPnlHKD, 0)} tone={snapshot.totalPnlHKD >= 0 ? "positive" : "negative"} />
        <Metric label="暴露市值 HKD" value={formatHKD(exposureValue, 0)} />
        <Metric label="暴露比例" value={formatPercent(exposureRatio)} />
      </div>
      <div className={styles.list}>
        {Object.keys(assetMap).map((asset) => (
          <div key={asset} className={styles.listItem}>
            <div className={styles.listTitle}>
              <span>{asset.toUpperCase()}</span>
              <span>{formatHKD(assetMap[asset], 0)}</span>
            </div>
            <div className={styles.listMeta}>归因盈亏：{formatHKD(pnlMap[asset], 0)} HKD</div>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

function CashPanel({ cache }: { cache: MobileCacheDoc | null }) {
  const data = cache?.data || {};
  return (
    <SectionCard title="Cash Holding" note="当前现金二维统计表与收益统计表。" time={getCacheTime(cache)}>
      <div className={styles.grid}>
        <Metric label="现金合计" value={formatHKD(matrixTotal(data.currentCashStats), 2)} />
        <Metric label="现金收益" value={formatHKD(pnlTotal(data.currentPlStats), 2)} />
      </div>
      <MatrixTable matrix={data.currentCashStats} />
      <MatrixTable matrix={data.currentPlStats} type="pl" />
    </SectionCard>
  );
}

function StocksPanel({ cache }: { cache: MobileCacheDoc | null }) {
  const data = cache?.data || {};
  const holdings = Array.isArray(data.holdings) ? data.holdings : [];
  const sums = data.holdingSums || {};

  return (
    <SectionCard title="Stocks" note="当前持仓统计表的只读移动视图。" time={getCacheTime(cache)}>
      <div className={styles.grid}>
        <Metric label="现市值 HKD" value={formatHKD(sums.mktValHKD, 0)} />
        <Metric label="未实现盈亏 HKD" value={formatHKD(sums.unrealizedPnlHKD, 0)} tone={sums.unrealizedPnlHKD >= 0 ? "positive" : "negative"} />
        <Metric label="总成本 HKD" value={formatHKD(sums.totalCostHKD, 0)} />
        <Metric label="行情缺失" value={String(data.quoteStatus?.missingQuoteCodes?.length || 0)} />
      </div>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>代码</th>
              <th>名称</th>
              <th>账户</th>
              <th>市场</th>
              <th>数量</th>
              <th>现价</th>
              <th>市值HKD</th>
              <th>浮盈HKD</th>
            </tr>
          </thead>
          <tbody>
            {holdings.slice(0, 80).map((item: any, index: number) => (
              <tr key={`${item.code}-${item.account}-${index}`}>
                <td>{item.code}</td>
                <td>{item.name || "-"}</td>
                <td>{item.account || "-"}</td>
                <td>{item.market || "-"}</td>
                <td>{formatNumber(item.quantity, 2)}</td>
                <td>{formatNumber(item.currentPrice, 4)}</td>
                <td>{formatHKD(item.mktValHKD, 2)}</td>
                <td className={item.unrealizedPnlHKD >= 0 ? styles.positive : styles.negative}>{formatHKD(item.unrealizedPnlHKD, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}

function StructuredProductPanel({ title, cache }: { title: string; cache: MobileCacheDoc | null }) {
  const data = cache?.data || {};
  return (
    <SectionCard title={title} note="持仓市值、收益与暴露汇总的只读视图。" time={getCacheTime(cache)}>
      <div className={styles.grid}>
        <Metric label="当前市值" value={formatHKD(matrixTotal(data.currentMktStats), 2)} />
        <Metric label="当前盈亏" value={formatHKD(pnlTotal(data.currentPlStats), 2)} />
        <Metric label="暴露标的数" value={String(data.riskExposureSummary?.length || 0)} />
        <Metric label="行情缺失" value={String(data.quoteStatus?.missingQuoteCodes?.length || 0)} />
      </div>
      <MatrixTable matrix={data.currentMktStats} />
      <MatrixTable matrix={data.currentPlStats} type="pl" />
      <ExposureList rows={data.riskExposureSummary} />
    </SectionCard>
  );
}

function FormalOnlyPanel({ title, pair }: { title: string; pair: FormalPair }) {
  return (
    <SectionCard title={title} note="该模块暂不接后端展示缓存，读取最新手动入库结果。" time={getSummaryTime(pair.mkt || pair.pl)}>
      <div className={styles.grid}>
        <Metric label="当前市值" value={formatHKD(matrixTotal(pair.mkt), 2)} />
        <Metric label="当前收益" value={formatHKD(pnlTotal(pair.pl), 2)} />
      </div>
      <MatrixTable matrix={pair.mkt} />
      <MatrixTable matrix={pair.pl} type="pl" />
    </SectionCard>
  );
}

export default function MobileHoldingsPage() {
  const [activeTab, setActiveTab] = useState<TabKey>("summary");
  const [state, setState] = useState<HoldingsState>(EMPTY_STATE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      try {
        setLoading(true);
        await ensureMobileFirebaseAuth();
        const [summary, cash, stocks, fcn, dqaq, option, peMkt, pePl, cbbcMkt, cbbcPl] = await Promise.all([
          getDisplayCache("summary"),
          getDisplayCache("cash"),
          getDisplayCache("stocks"),
          getDisplayCache("fcn"),
          getDisplayCache("dqaq"),
          getDisplayCache("option"),
          getDataDoc<MatrixData>("sip_holding_pe_mktvalue"),
          getDataDoc<MatrixData>("sip_holding_pe_pl"),
          getDataDoc<MatrixData>("sip_holding_cbbc_mktvalue"),
          getDataDoc<MatrixData>("sip_holding_cbbc_pl"),
        ]);
        if (!mounted) return;
        setState({ summary, cash, stocks, fcn, dqaq, option, pe: { mkt: peMkt, pl: pePl }, cbbc: { mkt: cbbcMkt, pl: cbbcPl } });
        setError("");
      } catch (err: any) {
        if (mounted) setError(err?.message || "读取移动端持仓数据失败");
      } finally {
        if (mounted) setLoading(false);
      }
    };

    load();
    return () => { mounted = false; };
  }, []);

  const panel = useMemo(() => {
    if (activeTab === "summary") return <SummaryPanel cache={state.summary} />;
    if (activeTab === "cash") return <CashPanel cache={state.cash} />;
    if (activeTab === "stocks") return <StocksPanel cache={state.stocks} />;
    if (activeTab === "fcn") return <StructuredProductPanel title="FCN" cache={state.fcn} />;
    if (activeTab === "dqaq") return <StructuredProductPanel title="DQ-AQ" cache={state.dqaq} />;
    if (activeTab === "option") return <StructuredProductPanel title="Option" cache={state.option} />;
    if (activeTab === "pe") return <FormalOnlyPanel title="私募基金" pair={state.pe} />;
    return <FormalOnlyPanel title="牛熊证/期货" pair={state.cbbc} />;
  }, [activeTab, state]);

  return (
    <MobileShell title="持仓只读终端" subtitle="只读取 Holdings 下各模块的最新缓存或最新入库数据，不提供编辑、刷新、删除和入库入口。">
      <div className={styles.tabRail}>
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={`${styles.tabButton} ${activeTab === tab.key ? styles.tabButtonActive : ""}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {loading ? (
        <section className={`${styles.card} p-6 text-center ${styles.muted}`}>
          <Loader2 className="mx-auto mb-3 animate-spin" size={22} />
          正在读取只读持仓数据...
        </section>
      ) : error ? (
        <div className={styles.alert}><AlertCircle size={14} className="inline mr-1" />{error}</div>
      ) : panel}
    </MobileShell>
  );
}
