"use client";

import React, { useState } from 'react';
import {
  Activity,
  BarChart3,
  Binary,
  CircleDollarSign,
  FlaskConical,
  Layers3,
  Network,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import FCNPanel from './_components/FCNPanel';
import DQAQPanel from './_components/DQ-AQPanel';

type ModelKey = 'FCN' | 'DQ/AQ';

const MODEL_META: Record<ModelKey, {
  eyebrow: string;
  title: string;
  description: string;
  tags: string[];
}> = {
  FCN: {
    eyebrow: 'Yield Enhancement',
    title: 'FCN 估值模型',
    description: '观察敲出、敲入接货与票息现金流，在统一的蒙特卡洛框架下拆解产品现值和风险概率。',
    tags: ['多标的', '敲入 / 敲出', '票息估值'],
  },
  'DQ/AQ': {
    eyebrow: 'Accumulation & Disposal',
    title: 'DQ / AQ 估值模型',
    description: '模拟逐日累积或减持路径，刻画保证期、行权区间、完成率及预期交割股数。',
    tags: ['单标的', '逐日累计', '交割估值'],
  },
};

export default function DerivativeValuationPage() {
  const [activeTab, setActiveTab] = useState<ModelKey>('FCN');
  const activeModel = MODEL_META[activeTab];

  return (
    <main className="min-h-screen bg-[#f3efe6] text-slate-900">
      <div className="mx-auto max-w-[1500px] px-4 py-7 sm:px-6 lg:px-8">
        <header className="relative overflow-hidden rounded-[28px] border border-slate-900/10 bg-[#102a2a] px-6 py-7 text-white shadow-[0_24px_60px_rgba(15,42,42,0.2)] sm:px-8">
          <div className="absolute -right-16 -top-24 h-64 w-64 rounded-full border border-white/10 bg-[#e76f36]/20" />
          <div className="absolute -bottom-28 left-1/3 h-56 w-56 rounded-full border border-white/5 bg-teal-400/5" />
          <div className="absolute bottom-0 right-1/3 h-px w-72 bg-gradient-to-r from-transparent via-white/30 to-transparent" />

          <div className="relative flex flex-col gap-7 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.26em] text-[#f0ad79]">
                <FlaskConical size={15} /> Structured Products Lab
              </div>
              <h1 className="font-serif text-4xl font-semibold tracking-tight sm:text-5xl">衍生品测算</h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300">
                将条款录入、历史行情、蒙特卡洛模拟和估值结果放进同一张研究工作台。
                页面保留现有定价逻辑，只重新组织信息层级，让参数、结果与风险判断更容易阅读。
              </p>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <HeroMetric icon={<Network size={16} />} label="模型范围" value="FCN · DQ/AQ" />
              <HeroMetric icon={<Binary size={16} />} label="核心方法" value="Monte Carlo" />
              <HeroMetric icon={<CircleDollarSign size={16} />} label="结果视图" value="本币 · HKD" />
            </div>
          </div>
        </header>

        <nav className="mt-6 grid gap-3 rounded-3xl border border-slate-900/10 bg-white/70 p-2 shadow-sm backdrop-blur lg:grid-cols-[1fr_1fr_auto]">
          <ModelTab
            active={activeTab === 'FCN'}
            icon={<Layers3 size={18} />}
            title="FCN 模型"
            subtitle="票息、敲出与接货风险"
            onClick={() => setActiveTab('FCN')}
          />
          <ModelTab
            active={activeTab === 'DQ/AQ'}
            icon={<Activity size={18} />}
            title="DQ / AQ 模型"
            subtitle="逐日累积或减持估值"
            onClick={() => setActiveTab('DQ/AQ')}
          />
          <div className="hidden min-w-[240px] items-center gap-3 px-5 text-xs text-slate-500 lg:flex">
            <ShieldCheck size={18} className="shrink-0 text-teal-700" />
            <span>沿用现有计算引擎与交易记录生成逻辑</span>
          </div>
        </nav>

        <section className="mt-6 overflow-hidden rounded-[28px] border border-slate-900/10 bg-white/45 shadow-sm">
          <div className="grid gap-5 border-b border-slate-900/10 bg-[#faf8f3] px-5 py-5 md:grid-cols-[1fr_auto] md:items-center sm:px-7">
            <div>
              <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.22em] text-[#d95f2b]">
                <Sparkles size={13} /> {activeModel.eyebrow}
              </div>
              <h2 className="mt-2 font-serif text-2xl font-semibold text-slate-900">{activeModel.title}</h2>
              <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-500">{activeModel.description}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {activeModel.tags.map(tag => (
                <span
                  key={tag}
                  className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-bold text-slate-600 shadow-sm"
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>

          <div className="derivative-workbench p-3 sm:p-5 lg:p-6">
            {activeTab === 'FCN' ? <FCNPanel /> : <DQAQPanel />}
          </div>
        </section>

        <footer className="mt-5 flex flex-col gap-2 rounded-2xl border border-[#d95f2b]/20 bg-[#fff4e8] px-5 py-4 text-xs leading-5 text-[#8d5b45] sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-2">
            <BarChart3 size={16} className="mt-0.5 shrink-0" />
            <span>模型结果用于估值研究与情景分析，不替代正式成交报价、法律条款确认或独立风险复核。</span>
          </div>
          <span className="whitespace-nowrap font-semibold text-[#8d3517]">Research use only</span>
        </footer>
      </div>

      <style jsx global>{`
        .derivative-workbench input,
        .derivative-workbench select {
          min-height: 40px;
          border-color: #dbe1df !important;
          border-radius: 12px !important;
          background-color: #fbfaf7;
          padding: 8px 11px !important;
          color: #1e293b;
          outline: none;
          box-shadow: none !important;
          transition: border-color 160ms ease, box-shadow 160ms ease, background-color 160ms ease;
        }

        .derivative-workbench input:focus,
        .derivative-workbench select:focus {
          border-color: #0f766e !important;
          background-color: #fff;
          box-shadow: 0 0 0 3px rgba(15, 118, 110, 0.1) !important;
        }

        .derivative-workbench input[type='date'] {
          color-scheme: light;
        }

        .derivative-workbench button {
          border-radius: 11px !important;
          box-shadow: none !important;
        }

        .derivative-workbench button.bg-blue-600 {
          background-color: #d95f2b !important;
        }

        .derivative-workbench button.bg-blue-600:hover {
          background-color: #b94b1d !important;
        }

        .derivative-workbench .border-l-4.border-blue-500 {
          border-left-color: #d95f2b !important;
        }

        .derivative-workbench .text-blue-600,
        .derivative-workbench .text-blue-700,
        .derivative-workbench .text-blue-800 {
          color: #0f766e !important;
        }

        .derivative-workbench .bg-blue-50 {
          background-color: #edf7f4 !important;
        }

        .derivative-workbench .border-blue-100,
        .derivative-workbench .border-blue-200 {
          border-color: #bfe0d9 !important;
        }

        .derivative-workbench .bg-white.shadow,
        .derivative-workbench .bg-white.shadow-sm {
          border: 1px solid rgba(15, 23, 42, 0.09);
          border-radius: 22px !important;
          box-shadow: 0 12px 28px rgba(15, 42, 42, 0.055) !important;
        }

        .derivative-workbench h2,
        .derivative-workbench h4 {
          letter-spacing: -0.015em;
        }

        .derivative-workbench h3 {
          color: #173c3a !important;
          letter-spacing: 0.01em;
        }

        .derivative-workbench table {
          border-collapse: separate;
          border-spacing: 0;
          overflow: hidden;
          border-radius: 14px;
        }

        .derivative-workbench thead {
          background-color: #f7f3eb !important;
        }

        .derivative-workbench th {
          color: #52615e !important;
          font-weight: 700 !important;
        }

        .derivative-workbench th,
        .derivative-workbench td {
          border-color: #e7e8e3 !important;
        }

        .derivative-workbench tbody tr {
          transition: background-color 140ms ease;
        }

        .derivative-workbench tbody tr:hover {
          background-color: rgba(236, 253, 245, 0.45);
        }

        .derivative-workbench ::-webkit-scrollbar {
          width: 8px;
          height: 8px;
        }

        .derivative-workbench ::-webkit-scrollbar-track {
          background: transparent;
        }

        .derivative-workbench ::-webkit-scrollbar-thumb {
          border: 2px solid transparent;
          border-radius: 999px;
          background: #c8cfca;
          background-clip: padding-box;
        }

        @media (min-width: 1024px) {
          .derivative-workbench > div {
            gap: 22px !important;
          }
        }
      `}</style>
    </main>
  );
}

function HeroMetric({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-[150px] rounded-2xl border border-white/10 bg-white/5 px-4 py-3 backdrop-blur-sm">
      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">
        <span className="text-[#f0ad79]">{icon}</span>
        {label}
      </div>
      <div className="mt-1.5 whitespace-nowrap text-sm font-semibold text-white">{value}</div>
    </div>
  );
}

function ModelTab({
  active,
  icon,
  title,
  subtitle,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-2xl px-4 py-3.5 text-left transition-all ${
        active
          ? 'bg-[#102a2a] text-white shadow-lg'
          : 'text-slate-600 hover:bg-white hover:text-slate-900'
      }`}
    >
      <span className="flex items-center gap-2 text-sm font-black">{icon}{title}</span>
      <span className={`mt-1 block text-[11px] ${active ? 'text-slate-300' : 'text-slate-400'}`}>{subtitle}</span>
    </button>
  );
}
