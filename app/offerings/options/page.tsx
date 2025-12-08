import React from 'react';
import Link from 'next/link';

export default function OptionsPage() {
  return (
    <div className="min-h-screen bg-white">
      {/* 1. Hero Section - 沉浸式背景 */}
      <section className="relative h-[500px] flex items-center justify-center overflow-hidden">
        {/* 背景图层 - 选用更加抽象、具有波动率或数学模型感的图片 */}
        <div 
          className="absolute inset-0 bg-cover bg-center z-0"
          style={{ 
            backgroundImage: 'url("https://images.unsplash.com/photo-1639322537228-f710d846310a?ixlib=rb-4.0.3&auto=format&fit=crop&w=2232&q=80")', // 区块链/数学模型/波动率概念图
          }}
        >
          {/* 黑色遮罩 */}
          <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"></div>
        </div>

        {/* Hero 内容 */}
        <div className="relative z-10 text-center px-6 max-w-4xl mx-auto animate-fade-in-up">
          <span className="inline-block py-1 px-3 rounded-full bg-violet-600/30 border border-violet-400 text-violet-200 text-xs font-bold tracking-widest uppercase mb-4 backdrop-blur-md">
            Exchange-Traded Options
          </span>
          <h1 className="text-4xl md:text-6xl font-black text-white mb-6 tracking-tight">
            场内期权
          </h1>
          <p className="text-lg md:text-xl text-gray-200 font-light leading-relaxed">
            从波动中寻找确定性。无论是美股的权利金收益，还是港股的杠杆博弈，我们助您构建非线性收益曲线。
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
                <span className="w-10 h-10 rounded-full bg-violet-100 flex items-center justify-center text-violet-600">
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.384-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" /></svg>
                </span>
                什么是场内期权？
              </h2>
              <p className="text-gray-600 leading-loose text-lg mb-6">
                期权是一种赋予持有人在特定日期以特定价格买入或卖出资产权利（而非义务）的合约。
              </p>
              
              <div className="bg-violet-50 rounded-xl p-5 border border-violet-100">
                <h4 className="font-bold text-violet-800 mb-3 text-sm">核心术语</h4>
                <div className="flex flex-wrap gap-2">
                  <span className="px-3 py-1 bg-white text-violet-700 text-xs rounded-full border border-violet-200">Call (看涨)</span>
                  <span className="px-3 py-1 bg-white text-violet-700 text-xs rounded-full border border-violet-200">Put (看跌)</span>
                  <span className="px-3 py-1 bg-white text-violet-700 text-xs rounded-full border border-violet-200">Strike Price</span>
                  <span className="px-3 py-1 bg-white text-violet-700 text-xs rounded-full border border-violet-200">Expiration</span>
                  <span className="px-3 py-1 bg-white text-violet-700 text-xs rounded-full border border-violet-200">Premium</span>
                </div>
              </div>
            </div>

            {/* 右侧：特点 (Grid) */}
            <div className="p-10 lg:w-7/12 bg-slate-50/50">
              <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-6">产品特性</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-10">
                {[
                  { title: '非线性收益', desc: '收益与标的资产价格变动不成简单的线性关系，损失有限（买方），收益无限（理论上）。', icon: '📈' },
                  { title: '高杠杆效应', desc: '以小博大，少量的权利金即可控制大额的名义资产。', icon: '⚖️' },
                  { title: '多维度获利', desc: '不仅可以赚取方向性的收益，还可以赚取时间价值（Theta）和波动率（Vega）的收益。', icon: '⏳' },
                  { title: '精准风控', desc: '可作为现货持仓的“保险单”，锁定最大亏损，对冲尾部风险。', icon: '🛡️' },
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

      {/* 3. 市场特色策略 (Market Strategies) - 核心差异化板块 */}
      <section className="py-24 bg-white">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-black text-gray-900">两大市场，差异化致胜</h2>
            <p className="text-gray-500 mt-4 max-w-2xl mx-auto">针对美股与港股不同的市场生态，我们为您提供定制化的交易策略支持。</p>
          </div>

          <div className="grid md:grid-cols-2 gap-10">
            
            {/* 美股策略 Card */}
            <div className="group relative p-10 rounded-3xl bg-gradient-to-br from-slate-900 to-slate-800 text-white shadow-2xl hover:shadow-blue-900/20 transition-all duration-300 overflow-hidden">
              {/* 装饰背景 */}
              <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2"></div>
              
              <div className="relative z-10">
                <div className="flex items-center gap-4 mb-6">
                  <div className="w-12 h-12 bg-blue-500/20 rounded-xl flex items-center justify-center text-blue-400">
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" /></svg>
                  </div>
                  <div>
                    <h3 className="text-2xl font-bold">美股市场</h3>
                    <p className="text-blue-300 text-sm">Sell Option / 权利金策略</p>
                  </div>
                </div>
                
                <p className="text-gray-300 leading-relaxed mb-8">
                  在美股市场，我们主推**卖方策略 (Option Selling)**。利用美股长期向上的慢牛特征与丰富的时间价值，帮助投资者通过 "收租" 模式增强收益。
                </p>

                <div className="space-y-4">
                  <div className="bg-slate-700/50 p-4 rounded-xl border border-slate-600">
                    <h4 className="font-bold text-white mb-1">Cash-Secured Put</h4>
                    <p className="text-xs text-gray-400">以目标价打折买入心仪股票，等待期间先赚取权利金。</p>
                  </div>
                  <div className="bg-slate-700/50 p-4 rounded-xl border border-slate-600">
                    <h4 className="font-bold text-white mb-1">Covered Call</h4>
                    <p className="text-xs text-gray-400">持有正股的同时卖出看涨期权，降低持仓成本，增厚回报。</p>
                  </div>
                </div>
              </div>
            </div>

            {/* 港股策略 Card */}
            <div className="group relative p-10 rounded-3xl bg-white border border-gray-100 shadow-xl hover:border-red-100 hover:shadow-red-900/5 transition-all duration-300 overflow-hidden">
              {/* 装饰背景 */}
              <div className="absolute top-0 right-0 w-64 h-64 bg-red-500/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2"></div>

              <div className="relative z-10">
                <div className="flex items-center gap-4 mb-6">
                  <div className="w-12 h-12 bg-red-50 rounded-xl flex items-center justify-center text-red-600">
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>
                  </div>
                  <div>
                    <h3 className="text-2xl font-bold text-gray-900">港股市场</h3>
                    <p className="text-red-500 text-sm">结构化产品 / 牛熊证</p>
                  </div>
                </div>
                
                <p className="text-gray-600 leading-relaxed mb-8">
                  针对港股市场波动大、交易灵活的特点，我们提供深度的牛熊证 (CBBCs)与窝轮(Warrants)交易支持，适合短线高频博弈与方向性交易。
                </p>

                <div className="space-y-4">
                  <div className="bg-red-50/50 p-4 rounded-xl border border-red-100">
                    <h4 className="font-bold text-gray-900 mb-1">牛熊证 (CBBCs)</h4>
                    <p className="text-xs text-gray-500">紧贴正股走势，高杠杆且不受引伸波幅影响，适合日内捕捉趋势。</p>
                  </div>
                  <div className="bg-red-50/50 p-4 rounded-xl border border-red-100">
                    <h4 className="font-bold text-gray-900 mb-1">窝轮 (Warrants)</h4>
                    <p className="text-xs text-gray-500">利用引伸波幅变化进行博弈，提供更多样化的行权价与到期日选择。</p>
                  </div>
                </div>
              </div>
            </div>

          </div>
        </div>
      </section>

      {/* 4. CTA (Call to Action) */}
      <section className="bg-gray-900 py-16">
        <div className="max-w-4xl mx-auto px-6 text-center">
          <h2 className="text-2xl md:text-3xl font-bold text-white mb-6">用期权为您的投资组合加杠杆或上保险</h2>
          <div className="flex justify-center gap-4">
          </div>
        </div>
      </section>
    </div>
  );
}