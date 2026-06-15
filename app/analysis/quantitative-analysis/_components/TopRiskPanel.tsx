'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CircleHelp,
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
  weight: number;
  explanation: {
    watches: string;
    trigger: string;
    meaning: string;
    current: {
      low: string;
      medium: string;
      high: string;
    };
  };
}> = [
  {
    key: 'factorReversal',
    title: '因子反转',
    subtitle: '拥挤因子从近期极端峰值回落',
    weight: 0.2,
    explanation: {
      watches: '观察多个风格因子的拥挤度 z-score 是否由极端位置转向。',
      trigger: '近20日曾高于 2σ，且当前较峰值回落超过 0.5σ；多个因子同时回落时分数更高。',
      meaning: '高拥挤本身不算顶部，只有拥挤交易开始松动才得分。',
      current: {
        low: '拥挤因子尚未出现广泛回落，当前更接近动量延续或中性状态。',
        medium: '部分拥挤因子已经从高位回落，但反转范围或幅度尚不足以形成全面确认。',
        high: '多个拥挤因子正从极端位置明显回落，拥挤交易松动信号较强。',
      },
    },
  },
  {
    key: 'soxReversal',
    title: 'SOX 反转',
    subtitle: '半导体超买状态开始消化',
    weight: 0.15,
    explanation: {
      watches: '观察费城半导体指数相对20日均线的偏离程度。',
      trigger: '近30日最大正偏离超过 12%，且当前较该峰值回落超过4个百分点。',
      meaning: '表示半导体短期动能明显降温，不等于长期趋势已经转空。',
      current: {
        low: 'SOX 尚未从近期超买峰值明显回落，半导体动能暂未出现反转确认。',
        medium: 'SOX 已有一定降温迹象，但从超买峰值回落的幅度仍属中等。',
        high: 'SOX 已从近期极端偏离显著回落，半导体短期动能反转信号充分触发。',
      },
    },
  },
  {
    key: 'cftcExtreme',
    title: 'CFTC 极端持续',
    subtitle: '快钱极端空头及快慢钱分歧',
    weight: 0.3,
    explanation: {
      watches: '观察纳指期货中杠杆资金与资产管理机构的净持仓分歧。',
      trigger: '杠杆资金净空头低于 -40% OI 并持续至少两周，同时考察慢钱是否净多及空头是否继续加深。',
      meaning: '反映机构仓位结构极端。它是重要预警，但单独出现不代表市场马上下跌。',
      current: {
        low: '纳指期货机构持仓尚未达到模型定义的持续极端状态。',
        medium: '机构持仓已出现一定极端或快慢钱分歧，但持续性与加深程度尚不完整。',
        high: '杠杆资金极端净空并持续，且快慢钱分歧明显；这是强仓位预警，但仍需价格信号配合。',
      },
    },
  },
  {
    key: 'vixRising',
    title: 'VIX 上升',
    subtitle: '波动率上行与期限结构恶化',
    weight: 0.15,
    explanation: {
      watches: '观察 VIX 的短期涨速、相对60日均线位置及 VIX/VIX3M 期限结构。',
      trigger: 'VIX五日涨幅超过 15% 得主要分；同时高于60日均线、VIX/VIX3M 超过 0.95 时继续加分。',
      meaning: '衡量风险溢价是否正在快速回归，而不是简单判断 VIX 当前高不高。',
      current: {
        low: 'VIX 暂未快速上升，期限结构也未明显恶化，市场尚未集中买入短期保护。',
        medium: '波动率已有抬升或期限结构趋紧，但风险溢价回归尚未全面确认。',
        high: 'VIX 快速上升并伴随期限结构恶化，市场正在显著提高短期风险定价。',
      },
    },
  },
  {
    key: 'leadingWeak',
    title: '领先指标转弱',
    subtitle: '信用、小盘、半导体等同步走弱',
    weight: 0.2,
    explanation: {
      watches: '综合 HYG/LQD、IWM/SPY、SOXX/SPY、IYT/XLI、XLY/XLP 五组相对强弱。',
      trigger: '每组按60日跌幅低于 -5%、处于60日最低20%区域、跌破200日均线分别计分，再取五组平均值。',
      meaning: '分数越高，说明风险偏好恶化越广泛；接近0表示市场内部结构整体仍健康。',
      current: {
        low: '信用、小盘、半导体、运输及可选消费的相对表现整体健康，弱化尚未广泛扩散。',
        medium: '部分领先市场已经走弱，但尚未形成跨资产、跨板块的一致恶化。',
        high: '多组领先指标同步转弱，风险偏好恶化已具有较强的市场广度。',
      },
    },
  },
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

function signalState(value: number) {
  if (value >= 0.6) {
    return {
      key: 'high' as const,
      label: '强信号',
      tone: 'border-rose-200 bg-rose-50 text-rose-800',
    };
  }
  if (value >= 0.3) {
    return {
      key: 'medium' as const,
      label: '部分触发',
      tone: 'border-amber-200 bg-amber-50 text-amber-800',
    };
  }
  return {
    key: 'low' as const,
    label: '未明显触发',
    tone: 'border-teal-200 bg-teal-50 text-teal-800',
  };
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
  const [openSignalHelp, setOpenSignalHelp] = useState<keyof SubSignals | null>(null);

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
  const selectedSignal = SIGNALS.find(signal => signal.key === openSignalHelp) || null;
  const selectedSignalValue = selectedSignal ? signals[selectedSignal.key] : 0;
  const selectedSignalState = signalState(selectedSignalValue);
  const selectedSignalContribution = selectedSignal
    ? selectedSignalValue * selectedSignal.weight * 100
    : 0;
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
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="text-sm font-bold text-slate-800">{signal.title}</span>
                      <button
                        type="button"
                        aria-label={`查看${signal.title}解释`}
                        aria-expanded={openSignalHelp === signal.key}
                        onClick={() => setOpenSignalHelp(current => current === signal.key ? null : signal.key)}
                        className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors ${
                          openSignalHelp === signal.key
                            ? 'border-[#d95f2b] bg-[#d95f2b] text-white'
                            : 'border-slate-300 bg-white text-slate-400 hover:border-[#d95f2b] hover:text-[#d95f2b]'
                        }`}
                      >
                        <CircleHelp size={13} />
                      </button>
                    </div>
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

          <div className="mt-4 rounded-2xl border border-[#e8d8c8] bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.16em] text-[#d95f2b]">
              <CircleHelp size={15} /> 因子解释
            </div>
            {selectedSignal ? (
              <div className="mt-3 text-[11px] leading-5 text-slate-600">
                <div className={`mb-3 rounded-xl border px-3 py-3 ${selectedSignalState.tone}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-black">
                      {selectedSignal.title} · {selectedSignalState.label}
                    </span>
                    <span className="font-mono font-bold">
                      {selectedSignalValue.toFixed(2)} · 贡献 {selectedSignalContribution.toFixed(1)} 分
                    </span>
                  </div>
                  <p className="mt-1.5 leading-5">
                    {selectedSignal.explanation.current[selectedSignalState.key]}
                  </p>
                </div>
                <div className="grid gap-x-5 gap-y-1 lg:grid-cols-3">
                  <p><span className="font-bold text-slate-800">观察什么：</span>{selectedSignal.explanation.watches}</p>
                  <p><span className="font-bold text-slate-800">如何触发：</span>{selectedSignal.explanation.trigger}</p>
                  <p><span className="font-bold text-slate-800">如何理解：</span>{selectedSignal.explanation.meaning}</p>
                </div>
              </div>
            ) : (
              <p className="mt-3 text-xs text-slate-500">
                点击任一因子名称旁的问号，在这里查看结合当前数值的解释。
              </p>
            )}
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
