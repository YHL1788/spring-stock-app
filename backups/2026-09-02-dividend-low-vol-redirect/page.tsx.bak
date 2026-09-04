"use client";

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  CircleAlert,
  Clock3,
  Gauge,
  LineChart as LineChartIcon,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Target,
  X,
} from 'lucide-react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type {
  DividendLowVolApiResponse,
  DividendLowVolBacktestPoint,
  DividendLowVolHolding,
  DividendLowVolSnapshot,
  DividendLowVolVersion,
} from '@/types/dividend-low-vol';

type ViewKey = 'backtest' | 'selection';

const LOCAL_CACHE_KEY = 'sip:dividend-low-vol:last-success:v1';

const COLORS = {
  net: '#0f766e',
  gross: '#64a087',
  hsi: '#d95f2b',
  hscei: '#315a9b',
};

const METRIC_CARDS = [
  ['annualized_return', '年化收益', '复合年化后的历史收益率', 'percent'],
  ['annualized_volatility', '年化波动', '月度收益波动折算成年化', 'percent'],
  ['sharpe', '夏普比率', '每承担一单位波动获得的收益', 'number'],
  ['max_drawdown', '最大回撤', '历史高点到低点的最大跌幅', 'percent'],
  ['calmar', 'Calmar', '年化收益与最大回撤之比', 'number'],
  ['average_turnover', '月均换手', '每月平均调整仓位的比例', 'percent'],
] as const;

function numeric(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatPercent(value: unknown, digits = 1, signed = false) {
  const number = numeric(value);
  if (number === null) return '--';
  return `${signed && number > 0 ? '+' : ''}${(number * 100).toFixed(digits)}%`;
}

function formatNumber(value: unknown, digits = 2) {
  const number = numeric(value);
  return number === null ? '--' : number.toFixed(digits);
}

function formatPrice(value: unknown) {
  const number = numeric(value);
  return number === null ? '--' : `HK$ ${number.toFixed(2)}`;
}

function monthKey(value: string | null | undefined) {
  return String(value || '').slice(0, 7);
}

function displayMonth(value: string | null | undefined) {
  const key = monthKey(value);
  if (!/^\d{4}-\d{2}$/.test(key)) return value || '--';
  return `${key.slice(0, 4)}年${Number(key.slice(5, 7))}月`;
}

function tenYearsBefore(month: string) {
  if (!/^\d{4}-\d{2}$/.test(month)) return '2016-01';
  const year = Math.max(2016, Number(month.slice(0, 4)) - 10);
  return `${year}-${month.slice(5, 7)}`;
}

function splitSymbols(value?: string | null) {
  if (!value) return [];
  return value.split(/[，,;；\s]+/).filter(Boolean);
}

export default function DividendLowVolPage() {
  const [view, setView] = useState<ViewKey>('backtest');
  const [snapshot, setSnapshot] = useState<DividendLowVolSnapshot | null>(null);
  const [versions, setVersions] = useState<DividendLowVolVersion[]>([]);
  const [selectedVersion, setSelectedVersion] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [fromMonth, setFromMonth] = useState('2016-01');
  const [toMonth, setToMonth] = useState('');
  const [selectedMonth, setSelectedMonth] = useState('');

  const load = useCallback(async (experimentId?: string) => {
    setLoading(true);
    setError('');
    setWarning('');
    try {
      const query = experimentId ? `?experimentId=${encodeURIComponent(experimentId)}` : '';
      const response = await fetch(`/api/dividend-low-vol${query}`, { cache: 'no-store' });
      const payload: DividendLowVolApiResponse = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || '红利低波结果读取失败。');
      const nextSnapshot = payload.snapshot || null;
      setWarning(payload.warning || '');
      setSnapshot(nextSnapshot);
      setVersions(payload.versions || []);
      if (nextSnapshot) {
        setSelectedVersion(nextSnapshot.experiment.experiment_id);
        const months = nextSnapshot.backtest_monthly.map(item => monthKey(item.month_end)).filter(Boolean);
        const first = months[0] || '2016-01';
        const last = months.at(-1) || first;
        setFromMonth(previous => experimentId && previous >= first && previous <= last
          ? previous
          : [first, tenYearsBefore(last)].sort().at(-1) || first);
        setToMonth(previous => experimentId && previous >= first && previous <= last ? previous : last);
      }
      try {
        window.localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify({
          cachedAt: new Date().toISOString(),
          snapshot: nextSnapshot,
          versions: payload.versions || [],
        }));
      } catch {
        // Browser storage is optional; large research snapshots may exceed its quota.
      }
    } catch (caught) {
      let restored = false;
      try {
        const cached = JSON.parse(window.localStorage.getItem(LOCAL_CACHE_KEY) || 'null');
        if (cached?.snapshot) {
          setSnapshot(cached.snapshot);
          setVersions(cached.versions || []);
          setSelectedVersion(cached.snapshot.experiment.experiment_id);
          setWarning(`云端数据服务暂时不可用，当前展示本浏览器于 ${cached.cachedAt || '此前'} 保存的最近结果。`);
          restored = true;
        }
      } catch {
        // Fall through to the friendly empty state.
      }
      if (!restored) {
        const message = caught instanceof Error ? caught.message : '红利低波结果读取失败。';
        setError(message.includes('RESOURCE_EXHAUSTED') || message.includes('Quota exceeded')
          ? '云端数据服务今日配额已用尽，暂时无法读取同步结果。请稍后重试或联系管理员提升 Firebase 配额。'
          : message);
        setSnapshot(null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const availableBounds = useMemo(() => {
    const rows = snapshot?.backtest_monthly || [];
    const months = rows.map(item => monthKey(item.month_end)).filter(Boolean);
    return { min: months[0] || '2016-01', max: months.at(-1) || '2016-01' };
  }, [snapshot]);

  const chartRows = useMemo(() => (snapshot?.backtest_monthly || []).filter(item => {
    const month = monthKey(item.month_end);
    return month >= fromMonth && (!toMonth || month <= toMonth);
  }).map(item => ({ ...item, month: monthKey(item.month_end) })), [fromMonth, snapshot, toMonth]);

  const selectedRecord = useMemo(() => (
    snapshot?.backtest_monthly.find(item => monthKey(item.month_end) === selectedMonth) || null
  ), [selectedMonth, snapshot]);

  const selectedHoldings = useMemo(() => (snapshot?.backtest_holdings || []).filter(
    item => monthKey(item.month_end) === selectedMonth,
  ).sort((a, b) => (numeric(b.target_weight) || 0) - (numeric(a.target_weight) || 0)), [selectedMonth, snapshot]);

  const experiment = snapshot?.experiment;
  const summary = snapshot?.summary;

  return (
    <main className="min-h-screen bg-[#f3efe6] text-slate-900">
      <div className="mx-auto max-w-[1500px] px-4 py-7 sm:px-6 lg:px-8">
        <header className="relative overflow-hidden rounded-[28px] border border-slate-900/10 bg-[#102a2a] px-6 py-7 text-white shadow-[0_24px_60px_rgba(15,42,42,0.2)] sm:px-8">
          <div className="absolute -right-20 -top-24 h-72 w-72 rounded-full border border-white/10 bg-[#e76f36]/20" />
          <div className="absolute -bottom-32 right-1/3 h-52 w-52 rounded-full border border-white/5" />
          <div className="relative flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.26em] text-[#f0ad79]">
                <Sparkles size={15} /> HK Equity Research
              </div>
              <h1 className="font-serif text-4xl font-semibold tracking-tight sm:text-5xl">红利低波分析</h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300">
                汇总实验室正式版本的动态月度回测、基准对照、调仓明细和最新候选股票。页面只读取后台同步结果，不在前台重新拟合模型。
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <HeroFact label="实验版本" value={experiment?.display_name || '尚未同步'} icon={<Clock3 size={13} />} />
              <HeroFact label="最新因子月末" value={displayMonth(summary?.factor_month_end)} icon={<CalendarDays size={13} />} />
              <HeroFact label="发布状态" value={experiment?.approved ? '正式批准' : experiment ? '研究版本' : '--'} icon={<ShieldCheck size={13} />} />
            </div>
          </div>
        </header>

        <section className="mt-6 rounded-2xl border border-slate-900/10 bg-white/75 p-3 shadow-sm backdrop-blur">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="flex flex-1 gap-2 overflow-x-auto">
              <ViewButton active={view === 'backtest'} icon={<LineChartIcon size={17} />} title="月度组合回测" subtitle="净值、风险与每月调仓" onClick={() => setView('backtest')} />
              <ViewButton active={view === 'selection'} icon={<Target size={17} />} title="最新选股结果" subtitle="候选池、权重与买点参考" onClick={() => setView('selection')} />
            </div>
            <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
              <label className="min-w-0 sm:w-[330px]">
                <span className="sr-only">实验版本</span>
                <select
                  value={selectedVersion}
                  disabled={loading || !versions.length}
                  onChange={event => { setSelectedVersion(event.target.value); void load(event.target.value); }}
                  className="w-full rounded-xl border border-slate-200 bg-[#faf8f3] px-3 py-2.5 text-sm font-semibold outline-none focus:border-teal-700"
                >
                  {!versions.length && <option value="">尚无同步版本</option>}
                  {versions.map(version => (
                    <option key={version.experiment_id} value={version.experiment_id}>
                      {version.approved ? '★ ' : ''}{version.display_name} · {version.model_label}
                    </option>
                  ))}
                </select>
              </label>
              <button onClick={() => void load(selectedVersion || undefined)} disabled={loading} className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:border-teal-700 hover:text-teal-800 disabled:opacity-50">
                {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />} 刷新
              </button>
            </div>
          </div>
        </section>

        {warning && <Notice kind="warning">{warning}</Notice>}
        {error && <Notice kind="error">{error}</Notice>}
        {!loading && !error && !snapshot && (
          <section className="mt-6 rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center">
            <BarChart3 className="mx-auto text-slate-300" size={42} />
            <h2 className="mt-4 font-serif text-2xl font-semibold">尚无可展示的实验结果</h2>
            <p className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-slate-500">
              请先在“港股红利低波实验室”完成月度组合回测并批准正式实验。配置同步密钥后，实验结果会自动发布到此处。
            </p>
          </section>
        )}

        {snapshot && view === 'backtest' && (
          <BacktestView
            snapshot={snapshot}
            chartRows={chartRows}
            fromMonth={fromMonth}
            toMonth={toMonth}
            bounds={availableBounds}
            setFromMonth={setFromMonth}
            setToMonth={setToMonth}
            setSelectedMonth={setSelectedMonth}
          />
        )}

        {snapshot && view === 'selection' && <SelectionView snapshot={snapshot} />}
      </div>

      {selectedMonth && selectedRecord && (
        <MonthDialog month={selectedMonth} record={selectedRecord} holdings={selectedHoldings} onClose={() => setSelectedMonth('')} />
      )}
    </main>
  );
}

function BacktestView({
  snapshot, chartRows, fromMonth, toMonth, bounds, setFromMonth, setToMonth, setSelectedMonth,
}: {
  snapshot: DividendLowVolSnapshot;
  chartRows: Array<DividendLowVolBacktestPoint & { month: string }>;
  fromMonth: string;
  toMonth: string;
  bounds: { min: string; max: string };
  setFromMonth: (value: string) => void;
  setToMonth: (value: string) => void;
  setSelectedMonth: (value: string) => void;
}) {
  const metrics = snapshot.metrics;
  const note = snapshot.experiment.experiment_note;
  return (
    <section className="mt-6 space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        {METRIC_CARDS.map(([key, label, description, format]) => (
          <MetricCard
            key={key}
            label={label}
            value={format === 'percent' ? formatPercent(metrics[key]) : formatNumber(metrics[key])}
            note={description}
          />
        ))}
      </div>

      <div className="rounded-3xl border border-slate-900/10 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <div className="flex items-center gap-2 text-[#0f766e]"><Activity size={18} /><span className="text-xs font-black uppercase tracking-widest">Dynamic Monthly Rebalance</span></div>
            <h2 className="mt-2 font-serif text-2xl font-semibold">动态月度调仓净值</h2>
            <p className="mt-1 text-xs leading-5 text-slate-500">每个圆点代表一个月末。点击曲线月份可查看当月交易记录与持仓；区间切换只裁剪真实回测结果，不重新计算模型。</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <MonthField label="起始年月" value={fromMonth} min={bounds.min < '2016-01' ? '2016-01' : bounds.min} max={toMonth || bounds.max} onChange={value => setFromMonth(value <= toMonth ? value : toMonth)} />
            <MonthField label="终止年月" value={toMonth} min={fromMonth} max={bounds.max} onChange={value => setToMonth(value >= fromMonth ? value : fromMonth)} />
          </div>
        </div>

        <div className="mt-6 h-[460px] w-full">
          {chartRows.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={chartRows}
                margin={{ top: 10, right: 22, left: 2, bottom: 18 }}
                onClick={(state: any) => state?.activeLabel && setSelectedMonth(String(state.activeLabel))}
              >
                <CartesianGrid stroke="#e7e2d8" strokeDasharray="3 5" vertical={false} />
                <XAxis dataKey="month" minTickGap={28} tick={{ fontSize: 10, fill: '#64748b' }} />
                <YAxis width={54} domain={['auto', 'auto']} tick={{ fontSize: 10, fill: '#64748b' }} tickFormatter={value => Number(value).toFixed(1)} />
                <Tooltip labelFormatter={value => displayMonth(String(value))} formatter={(value: any, name: any) => [formatNumber(value, 3), name]} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <ReferenceLine y={1} stroke="#94a3b8" strokeDasharray="4 4" />
                <Line type="monotone" dataKey="net_value" name="扣费后净值" stroke={COLORS.net} strokeWidth={3} dot={{ r: 2.6, fill: COLORS.net, cursor: 'pointer' }} activeDot={{ r: 5 }} connectNulls isAnimationActive={false} />
                <Line type="monotone" dataKey="gross_value" name="扣费前净值" stroke={COLORS.gross} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
                <Line type="monotone" dataKey="hsi_value" name="恒生指数" stroke={COLORS.hsi} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
                <Line type="monotone" dataKey="hscei_value" name="恒生国企指数" stroke={COLORS.hscei} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : <div className="flex h-full items-center justify-center text-sm text-slate-400">当前年月区间没有回测记录。</div>}
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.4fr_0.6fr]">
        <div className="rounded-3xl border border-slate-900/10 bg-white p-6 shadow-sm">
          <h2 className="font-serif text-2xl font-semibold">研究口径</h2>
          <div className="mt-4 grid gap-3 text-sm text-slate-600 sm:grid-cols-3">
            <ResearchFact label="回测区间" value={`${snapshot.summary.backtest_start?.slice(0, 10) || '--'} 至 ${snapshot.summary.backtest_end?.slice(0, 10) || '--'}`} />
            <ResearchFact label="组合模型" value={snapshot.experiment.model_label} />
            <ResearchFact label="数据状态" value={snapshot.experiment.approved ? '已批准正式实验' : '研究实验，未批准'} />
          </div>
          {note && <p className="mt-4 rounded-2xl bg-[#f7f4ee] px-4 py-3 text-xs leading-5 text-slate-500">实验说明：{note}</p>}
        </div>
        <div className="rounded-3xl border border-[#d95f2b]/20 bg-[#fff4e8] p-6">
          <div className="flex items-center gap-2 text-[#8d3517]"><CircleAlert size={18} /><span className="font-serif text-xl font-semibold">结果边界</span></div>
          <p className="mt-4 text-sm leading-6 text-[#8d5b45]">本页展示历史研究结果，不构成收益承诺。回测可能受到当前证券池回看历史、数据覆盖、交易成本假设和幸存者偏差影响。</p>
        </div>
      </div>
    </section>
  );
}

function SelectionView({ snapshot }: { snapshot: DividendLowVolSnapshot }) {
  const rows = snapshot.latest_selection;
  const summary = snapshot.summary;
  return (
    <section className="mt-6 space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="候选股票" value={String(summary.candidate_count)} note="通过风险过滤并有最新因子的证券" />
        <MetricCard label="最终入选" value={String(summary.selected_count)} note={`因子月末：${displayMonth(summary.factor_month_end)}`} />
        <MetricCard label="股票权重" value={formatPercent(summary.stock_weight)} note="目标组合中的股票配置比例" />
        <MetricCard label="保留现金" value={formatPercent(summary.cash_weight)} note="受单股与行业上限约束后的现金" />
      </div>

      <div className="overflow-hidden rounded-3xl border border-slate-900/10 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-100 px-6 py-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-[#0f766e]"><Target size={18} /><span className="text-xs font-black uppercase tracking-widest">Approved Selection</span></div>
            <h2 className="mt-2 font-serif text-2xl font-semibold">最新建仓候选池</h2>
            <p className="mt-1 text-xs text-slate-500">目标权重来自正式实验。均线买点是执行参考，不改变因子排名，也不构成个股买卖承诺。</p>
          </div>
          <div className="inline-flex items-center gap-2 self-start rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-800">
            <CheckCircle2 size={14} /> {snapshot.experiment.approved ? '正式批准版本' : '研究预览版本'}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-[1280px] w-full text-left text-sm">
            <thead className="bg-[#f7f4ee] text-[11px] font-black uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-5 py-3">排名</th><th className="px-5 py-3">证券</th><th className="px-5 py-3">行业</th><th className="px-5 py-3">综合得分</th><th className="px-5 py-3">因子覆盖</th><th className="px-5 py-3">目标权重</th><th className="px-5 py-3">最新价</th><th className="px-5 py-3">参考均线</th><th className="px-5 py-3">参考区间</th><th className="px-5 py-3">买点建议</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map(row => (
                <tr key={row.symbol} className="align-top transition hover:bg-teal-50/40">
                  <td className="px-5 py-4 font-serif text-lg font-semibold text-slate-400">{row.rank}</td>
                  <td className="px-5 py-4"><b className="font-mono text-slate-900">{row.symbol}</b><span className="mt-1 block max-w-[180px] text-xs text-slate-500">{row.name || '--'}</span></td>
                  <td className="px-5 py-4 text-xs text-slate-600">{row.sector || '--'}</td>
                  <td className="px-5 py-4 font-mono font-bold">{formatNumber(row.model_score, 2)}</td>
                  <td className="px-5 py-4">{formatPercent(row.factor_coverage)}</td>
                  <td className="px-5 py-4 font-bold text-teal-800">{formatPercent(row.target_weight)}</td>
                  <td className="px-5 py-4 font-mono">{formatPrice(row.latest_price)}</td>
                  <td className="px-5 py-4"><span className="rounded-lg bg-slate-100 px-2 py-1 text-xs font-bold">{row.reference_ma || '--'}</span><span className="mt-2 block font-mono text-xs text-slate-500">{formatPrice(row.reference_price)}</span></td>
                  <td className="px-5 py-4 font-mono text-xs">{formatPrice(row.reference_low)}<br /><span className="text-slate-400">至</span> {formatPrice(row.reference_high)}</td>
                  <td className="max-w-[300px] px-5 py-4 text-xs leading-5 text-slate-600">{row.entry_guidance || '等待股价回到参考均线附近分批观察，避免追高。'}</td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={10} className="px-5 py-12 text-center text-slate-400">该实验尚未生成最新选股结果。</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <Notice kind="info">强势股票可优先参考5日均线附近的回撤承接，走势较弱或波动较大的股票优先等待20日均线附近；实际执行仍需结合成交量、公告、止损纪律和组合资金约束。</Notice>
    </section>
  );
}

function MonthDialog({ month, record, holdings, onClose }: { month: string; record: DividendLowVolBacktestPoint; holdings: DividendLowVolHolding[]; onClose: () => void }) {
  const entered = splitSymbols(record.entered_symbols);
  const exited = splitSymbols(record.exited_symbols);
  const retained = splitSymbols(record.retained_symbols);
  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-950/45 p-0 backdrop-blur-sm sm:items-center sm:p-6" onMouseDown={event => event.currentTarget === event.target && onClose()}>
      <div role="dialog" aria-modal="true" className="max-h-[90vh] w-full max-w-6xl overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl">
        <div className="flex items-center justify-between border-b border-slate-100 bg-[#102a2a] px-6 py-5 text-white">
          <div><div className="text-xs font-black uppercase tracking-widest text-[#f0ad79]">Monthly Rebalance Detail</div><h2 className="mt-1 font-serif text-2xl font-semibold">{displayMonth(month)} 调仓与持仓</h2></div>
          <button onClick={onClose} className="rounded-full border border-white/15 p-2 hover:bg-white/10" aria-label="关闭"><X size={20} /></button>
        </div>
        <div className="max-h-[calc(90vh-92px)] overflow-y-auto p-5 sm:p-6">
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <MiniFact label="扣费前收益" value={formatPercent(record.gross_return, 2, true)} />
            <MiniFact label="交易成本" value={formatPercent(record.transaction_cost, 3)} />
            <MiniFact label="扣费后收益" value={formatPercent(record.net_return, 2, true)} />
            <MiniFact label="组合换手" value={formatPercent(record.turnover)} />
            <MiniFact label="扣费后净值" value={formatNumber(record.net_value, 3)} />
            <MiniFact label="保留现金" value={formatPercent(record.cash_weight)} />
          </div>
          <div className="mt-5 grid gap-3 lg:grid-cols-3">
            <TradeList label="新买入" items={entered} accent="emerald" />
            <TradeList label="卖出" items={exited} accent="rose" />
            <TradeList label="继续持有" items={retained} accent="slate" />
          </div>
          <h3 className="mt-6 font-serif text-xl font-semibold">月末持仓情况</h3>
          <div className="mt-3 overflow-x-auto rounded-2xl border border-slate-200">
            <table className="min-w-[850px] w-full text-left text-sm"><thead className="bg-[#f7f4ee] text-xs text-slate-500"><tr><th className="px-4 py-3">证券代码</th><th className="px-4 py-3">证券名称</th><th className="px-4 py-3">行业</th><th className="px-4 py-3">模型得分</th><th className="px-4 py-3">目标权重</th><th className="px-4 py-3">当月收益</th><th className="px-4 py-3">收益贡献</th></tr></thead>
              <tbody className="divide-y divide-slate-100">{holdings.map(item => <tr key={`${item.month_end}-${item.symbol}`}><td className="px-4 py-3 font-mono font-bold">{item.symbol}</td><td className="px-4 py-3">{item.name || '--'}</td><td className="px-4 py-3 text-xs text-slate-500">{item.sector || '--'}</td><td className="px-4 py-3">{formatNumber(item.model_score, 2)}</td><td className="px-4 py-3">{formatPercent(item.target_weight)}</td><td className="px-4 py-3">{formatPercent(item.actual_return, 2, true)}</td><td className="px-4 py-3">{formatPercent(item.contribution, 2, true)}</td></tr>)}</tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function HeroFact({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) { return <div className="min-w-[150px] rounded-2xl border border-white/10 bg-white/5 px-4 py-3"><span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">{icon}{label}</span><span className="mt-1 block max-w-[220px] truncate text-sm font-semibold" title={value}>{value}</span></div>; }
function ViewButton({ active, icon, title, subtitle, onClick }: { active: boolean; icon: React.ReactNode; title: string; subtitle: string; onClick: () => void }) { return <button onClick={onClick} className={`min-w-[235px] rounded-xl px-4 py-3 text-left transition ${active ? 'bg-[#102a2a] text-white shadow-md' : 'text-slate-600 hover:bg-white'}`}><span className="flex items-center gap-2 text-sm font-bold">{icon}{title}</span><span className={`mt-1 block text-[11px] ${active ? 'text-slate-300' : 'text-slate-400'}`}>{subtitle}</span></button>; }
function MetricCard({ label, value, note }: { label: string; value: string; note: string }) { return <div className="rounded-2xl border border-slate-900/10 bg-white p-4 shadow-sm"><div className="text-[10px] font-black uppercase tracking-widest text-slate-500">{label}</div><div className="mt-2 font-serif text-2xl font-semibold">{value}</div><div className="mt-1 truncate text-[10px] text-slate-400" title={note}>{note}</div></div>; }
function MonthField({ label, value, min, max, onChange }: { label: string; value: string; min: string; max: string; onChange: (value: string) => void }) { return <label className="rounded-2xl border border-slate-200 bg-[#faf8f3] px-4 py-3"><span className="flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-slate-500"><CalendarDays size={11} />{label}</span><input type="month" value={value} min={min} max={max} onChange={event => onChange(event.target.value)} className="mt-1 bg-transparent text-sm font-semibold outline-none" /></label>; }
function ResearchFact({ label, value }: { label: string; value: string }) { return <div className="rounded-2xl border border-slate-100 bg-[#faf8f3] p-4"><div className="text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</div><div className="mt-2 font-semibold text-slate-800">{value}</div></div>; }
function MiniFact({ label, value }: { label: string; value: string }) { return <div className="rounded-2xl border border-slate-200 bg-[#faf8f3] p-3"><div className="text-[10px] font-bold text-slate-400">{label}</div><div className="mt-1 font-mono text-lg font-bold">{value}</div></div>; }
function TradeList({ label, items, accent }: { label: string; items: string[]; accent: 'emerald' | 'rose' | 'slate' }) { const styles = accent === 'emerald' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : accent === 'rose' ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-slate-200 bg-slate-50 text-slate-700'; return <div className={`rounded-2xl border p-4 ${styles}`}><div className="text-xs font-black">{label} · {items.length}只</div><div className="mt-2 flex flex-wrap gap-1.5">{items.length ? items.map(item => <span key={item} className="rounded-md bg-white/70 px-2 py-1 font-mono text-xs">{item}</span>) : <span className="text-xs opacity-60">无变动</span>}</div></div>; }
function Notice({ kind, children }: { kind: 'error' | 'info' | 'warning'; children: React.ReactNode }) { const tone = kind === 'error' ? 'border-rose-300 bg-rose-50 text-rose-900' : kind === 'warning' ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-sky-200 bg-sky-50 text-sky-900'; return <div className={`mt-6 flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm ${tone}`}>{kind === 'error' || kind === 'warning' ? <CircleAlert size={18} className="mt-0.5 shrink-0" /> : <Gauge size={18} className="mt-0.5 shrink-0" />}<span>{children}</span></div>; }
