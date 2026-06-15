'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Clock3,
  Database,
  ExternalLink,
  RefreshCw,
  ShieldCheck,
  Waves,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { doc, getDoc } from 'firebase/firestore';
import { signInAnonymously } from 'firebase/auth';
import { APP_ID, auth, db } from '@/app/lib/stockService';

type SubSignals = {
  factorReversal: number;
  soxReversal: number;
  cftcExtreme: number;
  vixRising: number;
  leadingWeak: number;
};

type CurrentScore = {
  date: string;
  rawScore: number;
  confirmedScore: number;
  activeSignals: number;
  subSignals: SubSignals;
  riskLabel: string;
  modelVersion?: string;
  source?: string;
  generatedAt?: string;
};

type HistoryPoint = {
  date: string;
  rawScore: number | null;
  confirmedScore: number | null;
  activeSignals: number;
  ndxClose?: number | null;
  ndxNormalized?: number | null;
};

type TopRiskData = {
  current: CurrentScore;
  history: { points: HistoryPoint[] };
};

const SIGNALS: Array<{
  key: keyof SubSignals;
  title: string;
  subtitle: string;
}> = [
  { key: 'factorReversal', title: '因子反转', subtitle: '拥挤因子从近期极端峰值回落' },
  { key: 'soxReversal', title: 'SOX 反转', subtitle: '半导体超买状态开始消化' },
  { key: 'cftcExtreme', title: 'CFTC 极端持续', subtitle: '快钱极端空头及快慢钱分歧' },
  { key: 'vixRising', title: 'VIX 上升', subtitle: '波动率上行与期限结构恶化' },
  { key: 'leadingWeak', title: '领先指标转弱', subtitle: '信用、小盘、半导体等同步走弱' },
];

const EMPTY_SIGNALS: SubSignals = {
  factorReversal: 0,
  soxReversal: 0,
  cftcExtreme: 0,
  vixRising: 0,
  leadingWeak: 0,
};

function asNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeCurrent(raw: Record<string, unknown>): CurrentScore {
  const sourceSignals = (raw.subSignals || raw.sub_signals || {}) as Record<string, unknown>;
  const confirmedScore = asNumber(raw.confirmedScore ?? raw.confirmed_score);
  return {
    date: String(raw.date || ''),
    rawScore: asNumber(raw.rawScore ?? raw.raw_score),
    confirmedScore,
    activeSignals: asNumber(raw.activeSignals ?? raw.n_active_signals),
    subSignals: {
      factorReversal: asNumber(sourceSignals.factorReversal ?? sourceSignals.factor_reversal),
      soxReversal: asNumber(sourceSignals.soxReversal ?? sourceSignals.sox_reversal),
      cftcExtreme: asNumber(sourceSignals.cftcExtreme ?? sourceSignals.cftc_extreme),
      vixRising: asNumber(sourceSignals.vixRising ?? sourceSignals.vix_rising),
      leadingWeak: asNumber(sourceSignals.leadingWeak ?? sourceSignals.leading_weak),
    },
    riskLabel: String(raw.riskLabel || scoreLabel(confirmedScore)),
    modelVersion: String(raw.modelVersion || 'junquant-v2'),
    source: String(raw.source || 'firebase'),
    generatedAt: raw.generatedAt ? String(raw.generatedAt) : undefined,
  };
}

function normalizeHistory(raw: unknown): HistoryPoint[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(item => {
      const row = item as Record<string, unknown>;
      return {
        date: String(row.date || ''),
        rawScore: row.rawScore == null ? null : asNumber(row.rawScore),
        confirmedScore: row.confirmedScore == null ? null : asNumber(row.confirmedScore),
        activeSignals: asNumber(row.activeSignals),
        ndxClose: row.ndxClose == null ? null : asNumber(row.ndxClose),
        ndxNormalized: row.ndxNormalized == null ? null : asNumber(row.ndxNormalized),
      };
    })
    .filter(item => item.date);
}

function scoreLabel(score: number) {
  if (score >= 0.85) return '极端风险';
  if (score >= 0.75) return '短期高风险';
  if (score >= 0.6) return '风险升温';
  if (score >= 0.4) return '中性偏谨慎';
  return '正常或动量延续';
}

function riskTone(score: number) {
  if (score >= 0.75) return 'text-rose-700 bg-rose-50 border-rose-200';
  if (score >= 0.4) return 'text-amber-700 bg-amber-50 border-amber-200';
  return 'text-teal-700 bg-teal-50 border-teal-200';
}

function pct(value: number) {
  return `${Math.round(value * 100)}%`;
}

function signalTone(value: number) {
  if (value >= 0.6) return 'bg-rose-500';
  if (value >= 0.3) return 'bg-amber-500';
  return 'bg-teal-600';
}

async function readFirebaseSnapshot(): Promise<TopRiskData | null> {
  if (!auth.currentUser) await signInAnonymously(auth);
  const [latestSnapshot, historySnapshot] = await Promise.all([
    getDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'quant_us_top_risk', 'latest')),
    getDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'quant_us_top_risk', 'history')),
  ]);
  if (!latestSnapshot.exists()) return null;

  const latest = normalizeCurrent(latestSnapshot.data());
  const historyData = historySnapshot.exists() ? historySnapshot.data() : {};
  return {
    current: { ...latest, source: 'firebase' },
    history: { points: normalizeHistory(historyData.points) },
  };
}

async function readFallbackSnapshot(): Promise<TopRiskData> {
  const response = await fetch('/api/quant/crowding', { cache: 'no-store' });
  if (!response.ok) throw new Error('暂时无法取得顶部风险评分');
  const payload = await response.json();
  return {
    current: normalizeCurrent(payload.current || {}),
    history: { points: normalizeHistory(payload.history?.points) },
  };
}

export default function TopRiskPanel() {
  const [data, setData] = useState<TopRiskData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      let snapshot: TopRiskData | null = null;
      try {
        snapshot = await readFirebaseSnapshot();
      } catch {
        snapshot = null;
      }
      setData(snapshot || await readFallbackSnapshot());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '评分读取失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const current = data?.current;
  const history = data?.history.points || [];
  const chartData = useMemo(() => history.map(point => ({
    ...point,
    rawPercent: point.rawScore == null ? null : point.rawScore * 100,
    confirmedPercent: point.confirmedScore == null ? null : point.confirmedScore * 100,
  })), [history]);

  if (loading) {
    return (
      <div className="flex min-h-[520px] items-center justify-center text-sm text-slate-500">
        <RefreshCw className="mr-2 animate-spin" size={18} /> 正在读取风险评分
      </div>
    );
  }

  if (!current || error) {
    return (
      <div className="flex min-h-[520px] flex-col items-center justify-center px-6 text-center">
        <AlertTriangle size={34} className="text-amber-600" />
        <p className="mt-4 font-semibold text-slate-800">{error || '暂无评分数据'}</p>
        <button
          onClick={loadData}
          className="mt-5 rounded-full bg-[#102a2a] px-5 py-2 text-sm font-bold text-white"
        >
          重新读取
        </button>
      </div>
    );
  }

  const signals = current.subSignals || EMPTY_SIGNALS;
  const gaugeProgress = Math.min(100, Math.max(0, current.confirmedScore * 100));
  const gaugeAngle = Math.PI + (gaugeProgress / 100) * Math.PI;
  const gaugeDotX = 100 + Math.cos(gaugeAngle) * 80;
  const gaugeDotY = 100 + Math.sin(gaugeAngle) * 80;

  return (
    <div className="space-y-6">
      <section className="grid gap-4 xl:grid-cols-[0.8fr_1.2fr]">
        <div className="relative overflow-hidden rounded-[26px] border border-slate-900/10 bg-[#102a2a] p-6 text-white">
          <div className="absolute -right-12 -top-14 h-44 w-44 rounded-full border border-[#f0ad79]/10 bg-[#e76f36]/10" />
          <div className="absolute -bottom-24 -left-20 h-52 w-52 rounded-full border border-white/5" />

          <div className="relative flex items-start justify-between gap-4">
            <div>
              <div className="text-[10px] font-black uppercase tracking-[0.22em] text-[#f0ad79]">
                Confirmed Score
              </div>
              <div className="mt-2 text-5xl font-semibold tracking-tight">{pct(current.confirmedScore)}</div>
            </div>
            <div className={`rounded-full border px-3 py-1.5 text-xs font-black ${riskTone(current.confirmedScore)}`}>
              {current.riskLabel}
            </div>
          </div>

          <div className="relative mx-auto mt-5 max-w-[290px]">
            <svg viewBox="0 0 200 118" className="w-full overflow-visible" role="img" aria-label={`确认评分 ${pct(current.confirmedScore)}`}>
              <defs>
                <linearGradient id="confirmed-score-gradient" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#17a398" />
                  <stop offset="55%" stopColor="#f0ad79" />
                  <stop offset="100%" stopColor="#e76f36" />
                </linearGradient>
              </defs>
              <path
                d="M 20 100 A 80 80 0 0 1 180 100"
                fill="none"
                stroke="rgba(255,255,255,0.10)"
                strokeWidth="14"
                strokeLinecap="round"
                pathLength="100"
              />
              <path
                d="M 20 100 A 80 80 0 0 1 180 100"
                fill="none"
                stroke="url(#confirmed-score-gradient)"
                strokeWidth="14"
                strokeLinecap="round"
                pathLength="100"
                strokeDasharray={`${gaugeProgress} 100`}
                className="transition-all duration-700"
              />
              <circle cx={gaugeDotX} cy={gaugeDotY} r="5.5" fill="#fff" stroke="#e76f36" strokeWidth="3" />
              <line x1="100" y1="92" x2="100" y2="100" stroke="rgba(255,255,255,0.3)" strokeWidth="2" />
              <text x="18" y="116" fill="rgba(255,255,255,0.52)" fontSize="9">0</text>
              <text x="100" y="78" textAnchor="middle" fill="rgba(255,255,255,0.52)" fontSize="9">50</text>
              <text x="182" y="116" textAnchor="end" fill="rgba(255,255,255,0.52)" fontSize="9">100</text>
              <text x="100" y="101" textAnchor="middle" fill="#fff" fontSize="18" fontWeight="700">
                {Math.round(gaugeProgress)}
              </text>
              <text x="100" y="113" textAnchor="middle" fill="rgba(255,255,255,0.52)" fontSize="8">
                确认风险分
              </text>
            </svg>
          </div>

          <div className="relative mt-2 grid grid-cols-2 gap-3 border-t border-white/10 pt-4">
            <div>
              <div className="text-[11px] text-slate-400">原始评分</div>
              <div className="mt-1 text-xl font-semibold tabular-nums">{pct(current.rawScore)}</div>
            </div>
            <div className="text-right">
              <div className="text-[11px] text-slate-400">已激活信号</div>
              <div className="mt-1 text-xl font-semibold tabular-nums">{current.activeSignals}<span className="text-sm text-slate-400"> / 5</span></div>
            </div>
          </div>
        </div>

        <div className="rounded-[26px] border border-slate-900/10 bg-white/80 p-5 shadow-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.18em] text-[#d95f2b]">
                <Waves size={15} /> 五项确认信号
              </div>
              <h2 className="mt-2 font-serif text-2xl font-semibold">当前市场结构</h2>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                {current.activeSignals}/5 项信号激活。单点极端不直接构成顶部，需要方向反转与多信号共振。
              </p>
            </div>
            <button
              onClick={loadData}
              className="inline-flex items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-600 hover:border-slate-400"
            >
              <RefreshCw size={14} /> 刷新
            </button>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {SIGNALS.map(signal => {
              const value = signals[signal.key];
              return (
                <div key={signal.key} className="rounded-2xl border border-slate-100 bg-[#faf9f5] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-bold text-slate-800">{signal.title}</span>
                    <span className="font-mono text-sm font-bold text-slate-700">{value.toFixed(2)}</span>
                  </div>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-200">
                    <div
                      className={`h-full rounded-full ${signalTone(value)}`}
                      style={{ width: `${Math.max(2, value * 100)}%` }}
                    />
                  </div>
                  <p className="mt-2 text-[11px] leading-4 text-slate-500">{signal.subtitle}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="rounded-[26px] border border-slate-900/10 bg-white/80 p-5 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.18em] text-[#d95f2b]">History</div>
            <h2 className="mt-1 font-serif text-2xl font-semibold">风险评分与 NDX 对照</h2>
            <p className="mt-1 text-xs text-slate-500">
              评分更适合观察未来 5–20 个交易日的短期回撤风险，不用于判断长期熊市。
            </p>
          </div>
          <div className="flex gap-3 text-[11px] text-slate-500">
            <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-[#d95f2b]" />确认评分</span>
            <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-slate-400" />NDX 标准化</span>
          </div>
        </div>

        {chartData.length > 1 ? (
          <div className="mt-5 h-[340px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                <defs>
                  <linearGradient id="riskScoreFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#d95f2b" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="#d95f2b" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#e5e7eb" strokeDasharray="3 5" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#64748b' }} minTickGap={42} />
                <YAxis yAxisId="score" domain={[0, 100]} tick={{ fontSize: 10, fill: '#64748b' }} unit="%" />
                <YAxis yAxisId="ndx" orientation="right" tick={{ fontSize: 10, fill: '#64748b' }} />
                <Tooltip
                  formatter={(value, name) => [
                    name === '确认评分' ? `${Number(value).toFixed(1)}%` : Number(value).toFixed(2),
                    name,
                  ]}
                  contentStyle={{ borderRadius: 14, borderColor: '#e2e8f0', fontSize: 12 }}
                />
                <Area
                  yAxisId="score"
                  type="monotone"
                  dataKey="confirmedPercent"
                  name="确认评分"
                  stroke="#d95f2b"
                  strokeWidth={2}
                  fill="url(#riskScoreFill)"
                  connectNulls
                />
                <Line
                  yAxisId="ndx"
                  type="monotone"
                  dataKey="ndxNormalized"
                  name="NDX 标准化"
                  stroke="#64748b"
                  strokeWidth={1.5}
                  dot={false}
                  connectNulls
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="mt-5 flex h-[260px] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-[#faf9f5] text-center">
            <Database size={28} className="text-slate-400" />
            <p className="mt-3 text-sm font-semibold text-slate-700">当前仅有实时评分</p>
            <p className="mt-1 max-w-md text-xs leading-5 text-slate-500">
              配置 GitHub Actions 与 Firebase 后，页面会自动积累历史评分和 NDX 对照曲线。
            </p>
          </div>
        )}
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <InfoCard
          icon={<Clock3 size={18} />}
          title="有效窗口"
          value="5–20 个交易日"
          text="30 日以后信号明显衰减，因此每次触发都应设置重新评估日期。"
        />
        <InfoCard
          icon={<Activity size={18} />}
          title="触发纪律"
          value="评分 + 共振"
          text="不因单一 CFTC、VIX 或拥挤度极端而直接减仓，优先等待多个独立信号确认。"
        />
        <InfoCard
          icon={<ShieldCheck size={18} />}
          title="使用边界"
          value="风险辅助"
          text="适合短期对冲或降低风险预算，不作为长期方向预测和单独交易依据。"
        />
      </section>

      <footer className="flex flex-col gap-3 rounded-2xl border border-[#d95f2b]/20 bg-[#fff4e8] px-5 py-4 text-xs text-[#8d5b45] sm:flex-row sm:items-center sm:justify-between">
        <div>
          数据日期：{current.date || '未知'} · 数据源：
          {current.source === 'firebase' ? '本项目 Firebase 定时快照' : 'JunQuant 实时接口'}
        </div>
        <div className="flex flex-wrap gap-3 font-semibold">
          <a
            href="https://www.junquant.com/research/crowding/01"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 hover:text-[#5f2712]"
          >
            原始研究 <ExternalLink size={12} />
          </a>
          <a
            href="https://github.com/junqt/junquant-research/tree/main/us-market/01_top_risk_score"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 hover:text-[#5f2712]"
          >
            MIT 源码 <ExternalLink size={12} />
          </a>
        </div>
      </footer>
    </div>
  );
}

function InfoCard({
  icon,
  title,
  value,
  text,
}: {
  icon: React.ReactNode;
  title: string;
  value: string;
  text: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-900/10 bg-white/75 p-5 shadow-sm">
      <div className="flex items-center gap-2 text-[#d95f2b]">{icon}<span className="text-xs font-black uppercase tracking-widest">{title}</span></div>
      <div className="mt-3 font-serif text-xl font-semibold text-slate-900">{value}</div>
      <p className="mt-2 text-xs leading-5 text-slate-500">{text}</p>
    </div>
  );
}
