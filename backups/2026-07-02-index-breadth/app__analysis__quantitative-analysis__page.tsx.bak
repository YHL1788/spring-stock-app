import { Activity, Binary, ShieldCheck, Sigma } from 'lucide-react';
import TopRiskPanel from './_components/TopRiskPanel';

export default function QuantitativeAnalysisPage() {
  return (
    <main className="min-h-screen bg-[#f3efe6] text-slate-900">
      <div className="mx-auto max-w-[1500px] px-4 py-7 sm:px-6 lg:px-8">
        <header className="relative overflow-hidden rounded-[28px] border border-slate-900/10 bg-[#102a2a] px-6 py-7 text-white shadow-[0_24px_60px_rgba(15,42,42,0.2)] sm:px-8">
          <div className="absolute -right-16 -top-24 h-64 w-64 rounded-full border border-white/10 bg-[#e76f36]/20" />
          <div className="absolute bottom-0 right-1/3 h-px w-72 bg-gradient-to-r from-transparent via-white/30 to-transparent" />
          <div className="relative">
            <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.26em] text-[#f0ad79]">
              <Sigma size={15} /> Quantitative Research
            </div>
            <h1 className="font-serif text-4xl font-semibold tracking-tight sm:text-5xl">
              量化分析
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300">
              用公开数据、可复现模型和明确的使用边界，把市场结构信号转化为风险预算与短期仓位判断。
            </p>
          </div>
        </header>

        <nav className="mt-6 flex w-full gap-2 overflow-x-auto rounded-2xl border border-slate-900/10 bg-white/70 p-2 shadow-sm backdrop-blur">
          <button className="min-w-[260px] rounded-xl bg-[#102a2a] px-4 py-3 text-left text-white shadow-sm">
            <span className="flex items-center gap-2 text-sm font-bold"><Activity size={17} />短期拥挤与顶部风险</span>
            <span className="mt-1 block text-[11px] text-slate-300">美股 5–20 日风险确认模型</span>
          </button>
          <div className="ml-auto hidden items-center gap-2 px-4 text-xs text-slate-500 lg:flex">
            <Binary size={17} className="text-teal-700" />
            JunQuant v2 · 可复现公开数据模型
          </div>
        </nav>

        <section className="mt-6 rounded-[28px] border border-slate-900/10 bg-white/45 p-3 shadow-sm sm:p-5 lg:p-6">
          <TopRiskPanel />
        </section>

        <div className="mt-5 flex items-start gap-2 rounded-2xl border border-slate-900/10 bg-white/55 px-5 py-4 text-xs leading-5 text-slate-500">
          <ShieldCheck size={16} className="mt-0.5 shrink-0 text-teal-700" />
          本页模型用于研究和风险提示，不替代独立投资判断。上游核心算法依照 MIT License 使用并保留原作者声明。
        </div>
      </div>
    </main>
  );
}
