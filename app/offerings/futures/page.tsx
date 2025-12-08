import React from 'react';
import Link from 'next/link';

export default function FuturesPage() {
  return (
    <div className="min-h-screen bg-white">
      {/* 1. Hero Section - 沉浸式背景 */}
      <section className="relative h-[500px] flex items-center justify-center overflow-hidden">
        {/* 背景图层 - 选用大宗商品/全球贸易相关的图片 */}
        <div 
          className="absolute inset-0 bg-cover bg-center z-0"
          style={{ 
            backgroundImage: 'url("https://images.unsplash.com/photo-1614028674026-a65e31bfd27c?ixlib=rb-4.0.3&auto=format&fit=crop&w=2070&q=80")', // 抽象的金融图表或大宗商品概念图
          }}
        >
          {/* 黑色遮罩 */}
          <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"></div>
        </div>

        {/* Hero 内容 */}
        <div className="relative z-10 text-center px-6 max-w-4xl mx-auto animate-fade-in-up">
          <span className="inline-block py-1 px-3 rounded-full bg-amber-600/30 border border-amber-400 text-amber-200 text-xs font-bold tracking-widest uppercase mb-4 backdrop-blur-md">
            Exchange-Traded Futures
          </span>
          <h1 className="text-4xl md:text-6xl font-black text-white mb-6 tracking-tight">
            场内期货
          </h1>
          <p className="text-lg md:text-xl text-gray-200 font-light leading-relaxed">
            利用杠杆效应与双向交易机制，精准对冲风险，捕捉全球大宗商品与金融资产波动机遇。
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
                <span className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center text-amber-600">
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.384-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" /></svg>
                </span>
                什么是场内期货？
              </h2>
              <p className="text-gray-600 leading-loose text-lg mb-6">
                场内期货是指在交易所挂牌、集中撮合交易的标准化期货合约。
              </p>
              
              <div className="bg-amber-50 rounded-xl p-5 border border-amber-100">
                <h4 className="font-bold text-amber-800 mb-3 text-sm">常见品种</h4>
                <div className="flex flex-wrap gap-2">
                  <span className="px-3 py-1 bg-white text-amber-700 text-xs rounded-full border border-amber-200">股指期货</span>
                  <span className="px-3 py-1 bg-white text-amber-700 text-xs rounded-full border border-amber-200">国债期货</span>
                  <span className="px-3 py-1 bg-white text-amber-700 text-xs rounded-full border border-amber-200">原油</span>
                  <span className="px-3 py-1 bg-white text-amber-700 text-xs rounded-full border border-amber-200">黄金</span>
                  <span className="px-3 py-1 bg-white text-amber-700 text-xs rounded-full border border-amber-200">农产品</span>
                </div>
              </div>
            </div>

            {/* 右侧：特点 (Grid) */}
            <div className="p-10 lg:w-7/12 bg-slate-50/50">
              <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-6">核心特点</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-10">
                {[
                  { title: '标准化合约', desc: '合约条款（标的、数量、交割日期等）由交易所统一规定，交易便捷。', icon: '📝' },
                  { title: '公开透明', desc: '交易所集中撮合，价格公开透明，市场流动性较高。', icon: '🔍' },
                  { title: '保证金制度', desc: '只需缴纳一定比例保证金即可交易，具备资金杠杆效应。', icon: '⚖️' },
                  { title: '风险管理工具', desc: '广泛用于套期保值与风险对冲，亦可用于投机获利。', icon: '🛡️' },
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
            <h2 className="text-3xl font-black text-gray-900">专业赋能，致胜未来</h2>
            <p className="text-gray-500 mt-4 max-w-2xl mx-auto">我们不提供交易通道，专注于从宏观分析到策略落地的全方位支持。</p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            {/* Service Card 1 */}
            <div className="group p-8 rounded-2xl bg-white border border-gray-100 hover:border-amber-200 hover:shadow-xl transition-all duration-300">
              <div className="w-12 h-12 bg-blue-50 rounded-lg flex items-center justify-center text-blue-600 mb-6 group-hover:scale-110 transition-transform">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" /></svg>
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-4">市场趋势分析</h3>
              <ul className="space-y-3">
                <li className="flex items-start gap-2 text-sm text-gray-600">
                  <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0"></span>
                  对主要期货品种（股指、商品、利率等）进行宏观与微观趋势研判。
                </li>
                <li className="flex items-start gap-2 text-sm text-gray-600">
                  <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0"></span>
                  结合政策、供需、资金面，形成多维度分析框架。
                </li>
              </ul>
            </div>

            {/* Service Card 2 */}
            <div className="group p-8 rounded-2xl bg-white border border-gray-100 hover:border-amber-200 hover:shadow-xl transition-all duration-300">
              <div className="w-12 h-12 bg-purple-50 rounded-lg flex items-center justify-center text-purple-600 mb-6 group-hover:scale-110 transition-transform">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-4">策略设计与模拟</h3>
              <ul className="space-y-3">
                <li className="flex items-start gap-2 text-sm text-gray-600">
                  <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-purple-400 shrink-0"></span>
                  提供常见策略逻辑解析与模拟（跨期套利、跨品种套利、趋势跟随）。
                </li>
                <li className="flex items-start gap-2 text-sm text-gray-600">
                  <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-purple-400 shrink-0"></span>
                  帮助客户深度理解不同策略的风险收益特征。
                </li>
              </ul>
            </div>

            {/* Service Card 3 */}
            <div className="group p-8 rounded-2xl bg-white border border-gray-100 hover:border-amber-200 hover:shadow-xl transition-all duration-300">
              <div className="w-12 h-12 bg-green-50 rounded-lg flex items-center justify-center text-green-600 mb-6 group-hover:scale-110 transition-transform">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-4">风险管理建议</h3>
              <ul className="space-y-3">
                <li className="flex items-start gap-2 text-sm text-gray-600">
                  <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-green-400 shrink-0"></span>
                  分析客户现有投资组合的风险敞口，量身提出期货对冲思路。
                </li>
                <li className="flex items-start gap-2 text-sm text-gray-600">
                  <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-green-400 shrink-0"></span>
                  提供情景分析与极端行情下的压力测试，辅助科学决策。
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* 4. CTA (Call to Action) */}
      <section className="bg-gray-900 py-16">
        <div className="max-w-4xl mx-auto px-6 text-center">
          <h2 className="text-2xl md:text-3xl font-bold text-white mb-6">掌握期货工具，优化资产配置</h2>
          <div className="flex justify-center gap-4">
          </div>
        </div>
      </section>
    </div>
  );
}