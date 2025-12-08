import React from 'react';
import Link from 'next/link';

export default function SecuritiesPage() {
  return (
    <div className="min-h-screen bg-white">
      {/* 1. Hero Section - 沉浸式背景 */}
      <section className="relative h-[500px] flex items-center justify-center overflow-hidden">
        {/* 背景图层 - 模拟股市大屏或城市天际线 */}
        <div 
          className="absolute inset-0 bg-cover bg-center z-0"
          style={{ 
            backgroundImage: 'url("https://images.unsplash.com/photo-1590283603385-17ffb3a7f29f?ixlib=rb-4.0.3&auto=format&fit=crop&w=2070&q=80")', // 更换为更具现代感的金融市场背景
          }}
        >
          {/* 黑色遮罩，确保文字可读性 */}
          <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"></div>
        </div>

        {/* Hero 内容 */}
        <div className="relative z-10 text-center px-6 max-w-4xl mx-auto animate-fade-in-up">
          <span className="inline-block py-1 px-3 rounded-full bg-blue-600/30 border border-blue-400 text-blue-200 text-xs font-bold tracking-widest uppercase mb-4 backdrop-blur-md">
            Exchange-Traded Securities
          </span>
          <h1 className="text-4xl md:text-6xl font-black text-white mb-6 tracking-tight">
            场内证券
          </h1>
          <p className="text-lg md:text-xl text-gray-200 font-light leading-relaxed">
            连接全球最具活力的资本市场，直通美股与港股核心资产。
          </p>
        </div>
      </section>

      {/* 2. 概念定义与特点 (Definition & Features) */}
      <section className="py-20 bg-gray-50">
        <div className="max-w-7xl mx-auto px-6">
          <div className="bg-white rounded-3xl shadow-xl overflow-hidden border border-gray-100 flex flex-col md:flex-row">
            
            {/* 左侧：定义 */}
            <div className="p-10 md:w-1/2 flex flex-col justify-center border-b md:border-b-0 md:border-r border-gray-100">
              <h2 className="text-2xl font-bold text-gray-900 mb-6 flex items-center gap-3">
                <span className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600">
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                </span>
                什么是场内证券？
              </h2>
              <p className="text-gray-600 leading-loose text-lg">
                在交易所挂牌上市，通过交易所系统进行买卖的证券。
                <br/>
                涵盖 <span className="font-bold text-gray-900">股票、债券、ETF、REITs</span> 等多元化资产类别。
              </p>
            </div>

            {/* 右侧：特点 (Grid) */}
            <div className="p-10 md:w-1/2 bg-slate-50/50">
              <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-6">核心特点</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                {[
                  { title: '流动性高', desc: '买卖撮合迅速，资金周转灵活', icon: '💧' },
                  { title: '价格透明', desc: '实时竞价，市场信息公开公正', icon: '👁️' },
                  { title: '规则标准', desc: '统一的交易机制与结算制度', icon: '📏' },
                  { title: '严格监管', desc: '受交易所与监管机构双重保护', icon: '🛡️' },
                ].map((item, idx) => (
                  <div key={idx} className="flex gap-3">
                    <span className="text-2xl">{item.icon}</span>
                    <div>
                      <h4 className="font-bold text-gray-900 text-sm">{item.title}</h4>
                      <p className="text-xs text-gray-500 mt-1">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 3. 我们的价值 (Value Proposition) */}
      <section className="py-24 bg-white">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-black text-gray-900">赋能您的每一笔投资</h2>
            <div className="w-16 h-1 bg-blue-600 mx-auto mt-4 rounded-full"></div>
          </div>

          <div className="grid md:grid-cols-3 gap-10">
            {/* Value Card 1: 市场准入 */}
            <div className="group relative p-8 rounded-2xl bg-white border border-gray-100 hover:border-blue-100 shadow-sm hover:shadow-2xl hover:-translate-y-1 transition-all duration-300">
              <div className="w-14 h-14 bg-indigo-50 rounded-xl flex items-center justify-center text-indigo-600 mb-6 group-hover:scale-110 transition-transform">
                <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-3">全球市场直连</h3>
              <p className="text-gray-500 text-sm leading-relaxed">
                我们提供美股与港股场内证券交易服务，帮助您跨越地域限制，直接参与全球最具活力的资本市场，捕捉国际增长红利。
              </p>
            </div>

            {/* Value Card 2: 标的丰富 */}
            <div className="group relative p-8 rounded-2xl bg-white border border-gray-100 hover:border-blue-100 shadow-sm hover:shadow-2xl hover:-translate-y-1 transition-all duration-300">
              <div className="w-14 h-14 bg-blue-50 rounded-xl flex items-center justify-center text-blue-600 mb-6 group-hover:scale-110 transition-transform">
                <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-3">龙头与创新并进</h3>
              <p className="text-gray-500 text-sm leading-relaxed">
                通过我们的平台，您可以实时交易 <span className="font-semibold text-gray-800">苹果、微软、腾讯、阿里巴巴</span> 等龙头公司股票。同时支持参与热门 ETF 配置与全球新股认购，构建多元组合。
              </p>
            </div>

            {/* Value Card 3: 综合保障 */}
            <div className="group relative p-8 rounded-2xl bg-white border border-gray-100 hover:border-blue-100 shadow-sm hover:shadow-2xl hover:-translate-y-1 transition-all duration-300">
              <div className="w-14 h-14 bg-emerald-50 rounded-xl flex items-center justify-center text-emerald-600 mb-6 group-hover:scale-110 transition-transform">
                <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-3">高效与安全护航</h3>
              <p className="text-gray-500 text-sm leading-relaxed">
                我们不仅提供极速交易通道，还提供深度的投研报告、专业的分析工具与严格的合规保障体系，让您的每一次投资决策更高效、资产更安全。
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 4. CTA (Call to Action) */}
      <section className="bg-gray-900 py-16">
        <div className="max-w-4xl mx-auto px-6 text-center">
          <h2 className="text-2xl md:text-3xl font-bold text-white mb-6">准备好开启全球投资之旅了吗？</h2>
          <div className="flex justify-center gap-4">
            <Link href="/market/quote" className="bg-transparent border border-gray-600 text-white px-8 py-3 rounded-full font-bold hover:bg-gray-800 transition">
              查看实时行情
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}