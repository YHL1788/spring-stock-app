import React from 'react';
import Link from 'next/link';

export default function FundsPage() {
  return (
    <div className="min-h-screen bg-white">
      {/* 1. Hero Section - 沉浸式背景 */}
      <section className="relative h-[500px] flex items-center justify-center overflow-hidden">
        {/* 背景图层 - 选用体现高端财富管理、私密会议或游艇/高尔夫等生活方式的图片 */}
        <div 
          className="absolute inset-0 bg-cover bg-center z-0"
          style={{ 
            backgroundImage: 'url("https://images.unsplash.com/photo-1556761175-5973dc0f32e7?ixlib=rb-4.0.3&auto=format&fit=crop&w=2032&q=80")', // 高端会议室/握手/合作
          }}
        >
          {/* 黑色遮罩 */}
          <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"></div>
        </div>

        {/* Hero 内容 */}
        <div className="relative z-10 text-center px-6 max-w-4xl mx-auto animate-fade-in-up">
          <span className="inline-block py-1 px-3 rounded-full bg-orange-600/30 border border-orange-400 text-orange-200 text-xs font-bold tracking-widest uppercase mb-4 backdrop-blur-md">
            Private  Funds
          </span>
          <h1 className="text-4xl md:text-6xl font-black text-white mb-6 tracking-tight">
            私募基金
          </h1>
          <p className="text-lg md:text-xl text-gray-200 font-light leading-relaxed">
            链接全球顶级管理人，为您提供稀缺额度的优先认购权，定制专属的资产配置方案。
          </p>
        </div>
      </section>

      {/* 2. 顶级资源网络 (Exclusive Network) */}
      <section className="py-20 bg-gray-50">
        <div className="max-w-7xl mx-auto px-6">
          <div className="bg-white rounded-3xl shadow-xl overflow-hidden border border-gray-100 flex flex-col md:flex-row">
            
            {/* 左侧：合作理念 */}
            <div className="p-10 md:w-1/2 flex flex-col justify-center border-b md:border-b-0 md:border-r border-gray-100">
              <h2 className="text-2xl font-bold text-gray-900 mb-6 flex items-center gap-3">
                <span className="w-10 h-10 rounded-full bg-orange-100 flex items-center justify-center text-orange-600">
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
                </span>
                严选全球顶级管理人
              </h2>
              <p className="text-gray-600 leading-loose text-lg mb-6">
                我们不仅仅是销售渠道，更是您的资产配置顾问。我们与国内外知名的<span className="font-bold text-gray-900">主观多头 (Long Only)</span> 及 <span className="font-bold text-gray-900">量化对冲 (Quant/Hedge)</span> 基金保持长期深度合作。
              </p>
              <div className="bg-orange-50 rounded-xl p-5 border border-orange-100">
                <h4 className="font-bold text-orange-800 mb-3 text-sm">覆盖策略</h4>
                <div className="flex flex-wrap gap-2">
                  <span className="px-3 py-1 bg-white text-orange-700 text-xs rounded-full border border-orange-200">股票多头</span>
                  <span className="px-3 py-1 bg-white text-orange-700 text-xs rounded-full border border-orange-200">量化中性</span>
                  <span className="px-3 py-1 bg-white text-orange-700 text-xs rounded-full border border-orange-200">CTA</span>
                  <span className="px-3 py-1 bg-white text-orange-700 text-xs rounded-full border border-orange-200">宏观对冲</span>
                  <span className="px-3 py-1 bg-white text-orange-700 text-xs rounded-full border border-orange-200">事件驱动</span>
                </div>
              </div>
            </div>

            {/* 右侧：核心优势 */}
            <div className="p-10 md:w-1/2 bg-slate-50/50">
              <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-6">您的专属权益</h3>
              <ul className="space-y-8">
                <li className="flex gap-4">
                  <div className="w-12 h-12 shrink-0 bg-white rounded-xl shadow-sm flex items-center justify-center text-2xl border border-gray-100">💎</div>
                  <div>
                    <h4 className="font-bold text-gray-900">稀缺额度直通</h4>
                    <p className="text-sm text-gray-500 mt-1 leading-relaxed">
                      对于不仅对公众关闭、甚至对机构限额的顶流基金，我们为核心客户保留了一定条件的<span className="text-orange-600 font-medium">优先认购权</span>。
                    </p>
                  </div>
                </li>
                <li className="flex gap-4">
                  <div className="w-12 h-12 shrink-0 bg-white rounded-xl shadow-sm flex items-center justify-center text-2xl border border-gray-100">🔍</div>
                  <div>
                    <h4 className="font-bold text-gray-900">深度尽调报告</h4>
                    <p className="text-sm text-gray-500 mt-1 leading-relaxed">
                      不盲目追热点。我们提供详尽的基金经理访谈、过往业绩归因分析及风控压力测试报告。
                    </p>
                  </div>
                </li>
                <li className="flex gap-4">
                  <div className="w-12 h-12 shrink-0 bg-white rounded-xl shadow-sm flex items-center justify-center text-2xl border border-gray-100">🧩</div>
                  <div>
                    <h4 className="font-bold text-gray-900">定制化配置</h4>
                    <p className="text-sm text-gray-500 mt-1 leading-relaxed">
                      根据您的风险偏好（保守/稳健/进取）与流动性需求，向您推荐相关性低、互补性强的基金产品组合。
                    </p>
                  </div>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* 3. 基金筛选与推荐流程 (Process) */}
      <section className="py-24 bg-white">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-black text-gray-900">从数千只基金中，为您优中选优</h2>
            <p className="text-gray-500 mt-4">我们的基金评价体系涵盖定量与定性双重维度。</p>
          </div>

          <div className="grid md:grid-cols-3 gap-8 relative">
            {/* 连线背景 (仅在大屏显示) */}
            <div className="hidden md:block absolute top-1/2 left-0 w-full h-0.5 bg-gray-100 -z-10 -translate-y-1/2"></div>

            {/* Step 1 */}
            <div className="bg-white p-8 rounded-2xl border border-gray-100 text-center hover:shadow-lg transition-shadow">
              <div className="w-16 h-16 bg-orange-50 rounded-full flex items-center justify-center text-orange-600 mx-auto mb-6 text-2xl font-bold">1</div>
              <h3 className="text-lg font-bold text-gray-900 mb-2">需求诊断</h3>
              <p className="text-sm text-gray-500">
                了解您的资金规模、预期收益目标及最大回撤承受能力。
              </p>
            </div>

            {/* Step 2 */}
            <div className="bg-white p-8 rounded-2xl border border-gray-100 text-center hover:shadow-lg transition-shadow">
              <div className="w-16 h-16 bg-orange-50 rounded-full flex items-center justify-center text-orange-600 mx-auto mb-6 text-2xl font-bold">2</div>
              <h3 className="text-lg font-bold text-gray-900 mb-2">策略匹配</h3>
              <p className="text-sm text-gray-500">
                从我们的白名单库中，筛选出风格契合的私募管理人与具体产品。
              </p>
            </div>

            {/* Step 3 */}
            <div className="bg-white p-8 rounded-2xl border border-gray-100 text-center hover:shadow-lg transition-shadow">
              <div className="w-16 h-16 bg-orange-50 rounded-full flex items-center justify-center text-orange-600 mx-auto mb-6 text-2xl font-bold">3</div>
              <h3 className="text-lg font-bold text-gray-900 mb-2">持续跟踪</h3>
              <p className="text-sm text-gray-500">
                提供月度/季度运作报告，定期回顾业绩表现，动态调整持仓建议。
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 4. 合格投资者认证 CTA */}
      <section className="bg-gray-900 py-16">
        <div className="max-w-4xl mx-auto px-6 text-center">
          <div className="inline-block px-3 py-1 border border-orange-500/50 rounded-full text-orange-400 text-xs mb-4">
            Private Placement Only
          </div>
          <h2 className="text-2xl md:text-3xl font-bold text-white mb-6">开启您的私人财富管理之旅</h2>
          <p className="text-gray-400 mb-8 max-w-2xl mx-auto text-sm">
            *私募基金仅面向合格投资者。您需要满足一定的资产规模或收入证明要求，并完成风险测评。
          </p>
          <div className="flex justify-center gap-4">
            <button className="bg-orange-600 text-white px-8 py-3 rounded-full font-bold hover:bg-orange-700 transition shadow-lg shadow-orange-600/30">
              预约理财顾问
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}