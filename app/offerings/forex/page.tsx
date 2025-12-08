import React from 'react';
import Link from 'next/link';

export default function ForexPage() {
  return (
    <div className="min-h-screen bg-white">
      {/* 1. Hero Section - 沉浸式背景 */}
      <section className="relative h-[500px] flex items-center justify-center overflow-hidden">
        {/* 背景图层 - 选用全球货币/全天候交易氛围的图片 */}
        <div 
          className="absolute inset-0 bg-cover bg-center z-0"
          style={{ 
            backgroundImage: 'url("https://images.unsplash.com/photo-1451187580459-43490279c0fa?ixlib=rb-4.0.3&auto=format&fit=crop&w=2072&q=80")', // 更换为全球网络/科技金融背景图
          }}
        >
          {/* 黑色遮罩 */}
          <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"></div>
        </div>

        {/* Hero 内容 */}
        <div className="relative z-10 text-center px-6 max-w-4xl mx-auto animate-fade-in-up">
          <span className="inline-block py-1 px-3 rounded-full bg-emerald-600/30 border border-emerald-400 text-emerald-200 text-xs font-bold tracking-widest uppercase mb-4 backdrop-blur-md">
            Global Forex Trading
          </span>
          <h1 className="text-4xl md:text-6xl font-black text-white mb-6 tracking-tight">
            外汇
          </h1>
          <p className="text-lg md:text-xl text-gray-200 font-light leading-relaxed">
            连接全球经济脉搏，在24小时不间断的市场中，把握汇率波动带来的双向机遇。
          </p>
        </div>
      </section>

      {/* 2. 概念定义与特点 (Definition & Features) */}
      <section className="py-20 bg-gray-50">
        <div className="max-w-7xl mx-auto px-6">
          <div className="bg-white rounded-3xl shadow-xl overflow-hidden border border-gray-100 flex flex-col lg:flex-row">
            
            {/* 左侧：定义 */}
            <div className="p-10 lg:w-5/12 flex flex-col justify-center border-b lg:border-b-0 lg:border-r border-gray-100 bg-white">
              <h2 className="text-2xl font-bold text-gray-900 mb-6 flex items-center gap-3">
                <span className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600">
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                </span>
                什么是外汇交易？
              </h2>
              <p className="text-gray-600 leading-loose text-lg mb-6">
                外汇（Forex）是指同时买入一种货币并卖出另一种货币的交易方式。它是全球最大的金融市场，日交易量巨大。
              </p>
              
              <div className="bg-emerald-50 rounded-xl p-5 border border-emerald-100">
                <h4 className="font-bold text-emerald-800 mb-3 text-sm">热门货币对</h4>
                <div className="flex flex-wrap gap-2">
                  <span className="px-3 py-1 bg-white text-emerald-700 text-xs rounded-full border border-emerald-200 font-mono">EUR/USD</span>
                  <span className="px-3 py-1 bg-white text-emerald-700 text-xs rounded-full border border-emerald-200 font-mono">USD/JPY</span>
                  <span className="px-3 py-1 bg-white text-emerald-700 text-xs rounded-full border border-emerald-200 font-mono">GBP/USD</span>
                  <span className="px-3 py-1 bg-white text-emerald-700 text-xs rounded-full border border-emerald-200 font-mono">AUD/USD</span>
                  <span className="px-3 py-1 bg-white text-emerald-700 text-xs rounded-full border border-emerald-200 font-mono">USD/CNH</span>
                </div>
              </div>
            </div>

            {/* 右侧：特点 (Grid) */}
            <div className="p-10 lg:w-7/12 bg-slate-50/50">
              <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-6">核心特点</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-10">
                {[
                  { title: '24小时交易', desc: '市场跟随太阳从悉尼、东京、伦敦到纽约周转，全天候运行，无缝衔接。', icon: '⏰' },
                  { title: '极高流动性', desc: '全球日交易量超6万亿美元，成交迅速，即使大额交易也能快速执行。', icon: '🌊' },
                  { title: '双向获利机会', desc: '无论汇率上涨还是下跌，均可通过买入（做多）或卖出（做空）寻找获利空间。', icon: '⇅' },
                  { title: '杠杆机制', desc: '利用保证金交易放大资金效率，小资金也能参与大市场（需注意风险）。', icon: '🚀' },
                ].map((item, idx) => (
                  <div key={idx} className="flex gap-4">
                    <div className="w-12 h-12 shrink-0 bg-white rounded-xl shadow-sm flex items-center justify-center text-2xl border border-gray-100">
                        {item.icon}
                    </div>
                    <div>
                      <h4 className="font-bold text-gray-900 text-base mb-1">{item.title}</h4>
                      <p className="text-sm text-gray-500 leading-relaxed">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 3. 我们提供的服务 (Services / Value Proposition) */}
      <section className="py-24 bg-white">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-black text-gray-900">洞悉宏观，精准交易</h2>
            <p className="text-gray-500 mt-4 max-w-2xl mx-auto">为您提供顶级的市场接入与深度的宏观策略分析，助您在汇市博弈中占据先机。</p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            {/* Service Card 1 */}
            <div className="group p-8 rounded-2xl bg-white border border-gray-100 hover:border-emerald-200 hover:shadow-xl transition-all duration-300">
              <div className="w-12 h-12 bg-blue-50 rounded-lg flex items-center justify-center text-blue-600 mb-6 group-hover:scale-110 transition-transform">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-4">主流与新兴全覆盖</h3>
              <ul className="space-y-3">
                <li className="flex items-start gap-2 text-sm text-gray-600">
                  <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0"></span>
                  提供美元、欧元、日元等所有主要货币对（Majors）交易。
                </li>
                <li className="flex items-start gap-2 text-sm text-gray-600">
                  <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0"></span>
                  精选高波动的新兴市场货币对，捕捉区域经济发展红利。
                </li>
              </ul>
            </div>

            {/* Service Card 2 */}
            <div className="group p-8 rounded-2xl bg-white border border-gray-100 hover:border-emerald-200 hover:shadow-xl transition-all duration-300">
              <div className="w-12 h-12 bg-purple-50 rounded-lg flex items-center justify-center text-purple-600 mb-6 group-hover:scale-110 transition-transform">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-4">极具竞争力的点差</h3>
              <ul className="space-y-3">
                <li className="flex items-start gap-2 text-sm text-gray-600">
                  <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-purple-400 shrink-0"></span>
                  接入顶级银行间流动性，确保报价精准、执行迅速。
                </li>
                <li className="flex items-start gap-2 text-sm text-gray-600">
                  <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-purple-400 shrink-0"></span>
                  行业领先的低点差模式，显著降低高频交易与套利策略的成本。
                </li>
              </ul>
            </div>

            {/* Service Card 3 */}
            <div className="group p-8 rounded-2xl bg-white border border-gray-100 hover:border-emerald-200 hover:shadow-xl transition-all duration-300">
              <div className="w-12 h-12 bg-green-50 rounded-lg flex items-center justify-center text-green-600 mb-6 group-hover:scale-110 transition-transform">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 01-2-2z" /></svg>
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-4">专业的宏观策略</h3>
              <ul className="space-y-3">
                <li className="flex items-start gap-2 text-sm text-gray-600">
                  <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-green-400 shrink-0"></span>
                  深度解读全球央行（美联储、ECB等）政策动向与利率决议。
                </li>
                <li className="flex items-start gap-2 text-sm text-gray-600">
                  <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-green-400 shrink-0"></span>
                  实时跟踪非农、CPI 等关键经济数据，预判汇率中长期走势。
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* 4. CTA (Call to Action) */}
      <section className="bg-gray-900 py-16">
        <div className="max-w-4xl mx-auto px-6 text-center">
          <h2 className="text-2xl md:text-3xl font-bold text-white mb-6">把握全球机遇，从外汇开始</h2>
          <div className="flex justify-center gap-4">
            <Link href="/market/quote" className="bg-transparent border border-gray-600 text-white px-8 py-3 rounded-full font-bold hover:bg-gray-800 transition">
              查看汇率行情
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}