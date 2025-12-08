import React from 'react';
import Link from 'next/link';

export default function DerivativesPage() {
  return (
    <div className="min-h-screen bg-white">
      {/* 1. Hero Section - 沉浸式背景 */}
      <section className="relative h-[500px] flex items-center justify-center overflow-hidden">
        {/* 背景图层 - 选用体现高端私行、建筑或复杂结构的图片 */}
        <div 
          className="absolute inset-0 bg-cover bg-center z-0"
          style={{ 
            backgroundImage: 'url("https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?ixlib=rb-4.0.3&auto=format&fit=crop&w=2070&q=80")', // 摩天大楼/商务建筑，体现机构感
          }}
        >
          {/* 黑色遮罩 */}
          <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"></div>
        </div>

        {/* Hero 内容 */}
        <div className="relative z-10 text-center px-6 max-w-4xl mx-auto animate-fade-in-up">
          <span className="inline-block py-1 px-3 rounded-full bg-cyan-600/30 border border-cyan-400 text-cyan-200 text-xs font-bold tracking-widest uppercase mb-4 backdrop-blur-md">
            OTC Structured Products
          </span>
          <h1 className="text-4xl md:text-6xl font-black text-white mb-6 tracking-tight">
            场外衍生品与结构化产品
          </h1>
          <p className="text-lg md:text-xl text-gray-200 font-light leading-relaxed">
            携手顶级私人银行与投行，为您量身定制 FCN、AQ、DQ 等非标合约，精准匹配您的风险收益偏好。
          </p>
        </div>
      </section>

      {/* 2. 合作模式与定义 (Partnership & Concept) */}
      <section className="py-20 bg-gray-50">
        <div className="max-w-7xl mx-auto px-6">
          <div className="bg-white rounded-3xl shadow-xl overflow-hidden border border-gray-100 flex flex-col md:flex-row">
            
            {/* 左侧：高端定制理念 */}
            <div className="p-10 md:w-1/2 flex flex-col justify-center border-b md:border-b-0 md:border-r border-gray-100">
              <h2 className="text-2xl font-bold text-gray-900 mb-6 flex items-center gap-3">
                <span className="w-10 h-10 rounded-full bg-cyan-100 flex items-center justify-center text-cyan-600">
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
                </span>
                顶级机构合作网络
              </h2>
              <p className="text-gray-600 leading-loose text-lg mb-6">
                我们与全球知名的<span className="font-bold text-gray-900">私人银行 (Private Banks)</span> 及 <span className="font-bold text-gray-900">投资银行 (Investment Banks)</span> 建立深度合作关系。
              </p>
              <p className="text-gray-600 leading-loose">
                不同于标准化的场内产品，场外衍生品（OTC）通过双边合约形式，针对标的资产、期限、敲出敲入价格等要素进行灵活定制，满足高净值客户与机构投资者的特殊配置需求。
              </p>
            </div>

            {/* 右侧：产品优势 */}
            <div className="p-10 md:w-1/2 bg-slate-50/50">
              <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-6">为什么选择结构化产品？</h3>
              <ul className="space-y-6">
                <li className="flex gap-4">
                  <div className="w-10 h-10 shrink-0 bg-white rounded-full shadow-sm flex items-center justify-center text-xl text-cyan-600">🎯</div>
                  <div>
                    <h4 className="font-bold text-gray-900">收益增强</h4>
                    <p className="text-sm text-gray-500 mt-1">在震荡市或温和下跌市场中，通过卖出波动率获取高于存款或债券的固定票息。</p>
                  </div>
                </li>
                <li className="flex gap-4">
                  <div className="w-10 h-10 shrink-0 bg-white rounded-full shadow-sm flex items-center justify-center text-xl text-cyan-600">📉</div>
                  <div>
                    <h4 className="font-bold text-gray-900">低位建仓</h4>
                    <p className="text-sm text-gray-500 mt-1">通过 AQ 等工具，以低于市场价的折扣分批买入心仪的优质股票。</p>
                  </div>
                </li>
                <li className="flex gap-4">
                  <div className="w-10 h-10 shrink-0 bg-white rounded-full shadow-sm flex items-center justify-center text-xl text-cyan-600">🛠️</div>
                  <div>
                    <h4 className="font-bold text-gray-900">灵活定制</h4>
                    <p className="text-sm text-gray-500 mt-1">挂钩标的覆盖个股、指数、商品，甚至一篮子股票，结构随心而定。</p>
                  </div>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* 3. 核心产品矩阵 (Core Offerings) - FCN, BEN, AQ, DQ */}
      <section className="py-24 bg-white">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-black text-gray-900">核心结构化产品</h2>
            <div className="w-16 h-1 bg-cyan-600 mx-auto mt-4 rounded-full"></div>
            <p className="text-gray-500 mt-4">从票据到累算期权，多元化的非标投资工具。</p>
          </div>

          <div className="grid md:grid-cols-2 gap-8">
            
            {/* Product 1: FCN */}
            <div className="bg-white p-8 rounded-2xl border border-gray-200 hover:border-cyan-300 hover:shadow-xl hover:shadow-cyan-100/50 transition-all duration-300 group">
              <div className="flex justify-between items-start mb-4">
                <h3 className="text-2xl font-bold text-gray-900 group-hover:text-cyan-600 transition-colors">FCN</h3>
                <span className="px-2 py-1 bg-gray-100 text-gray-500 text-xs rounded font-mono">Fixed Coupon Note</span>
              </div>
              <h4 className="text-sm font-bold text-gray-700 mb-2">定息票据</h4>
              <p className="text-gray-500 text-sm leading-relaxed mb-6">
                一种挂钩股票或指数的结构化票据。无论标的资产涨跌（只要不发生敲入），投资者均可定期获得固定的票息收益。
              </p>
              <div className="bg-slate-50 p-4 rounded-lg border border-slate-100 text-xs text-gray-600 space-y-2">
                <p>✅ <span className="font-bold">适合场景：</span>预期市场震荡或温和上涨。</p>
                <p>⚠️ <span className="font-bold">风险：</span>若股价大幅下跌触及敲入价，需以行权价接货。</p>
              </div>
            </div>

            {/* Product 2: AQ */}
            <div className="bg-white p-8 rounded-2xl border border-gray-200 hover:border-cyan-300 hover:shadow-xl hover:shadow-cyan-100/50 transition-all duration-300 group">
              <div className="flex justify-between items-start mb-4">
                <h3 className="text-2xl font-bold text-gray-900 group-hover:text-cyan-600 transition-colors">AQ</h3>
                <span className="px-2 py-1 bg-gray-100 text-gray-500 text-xs rounded font-mono">Accumulator</span>
              </div>
              <h4 className="text-sm font-bold text-gray-700 mb-2">累购期权 </h4>
              <p className="text-gray-500 text-sm leading-relaxed mb-6">
                允许投资者在合约期内，每天以订约时市场价的固定折扣买入指定股票。
              </p>
              <div className="bg-slate-50 p-4 rounded-lg border border-slate-100 text-xs text-gray-600 space-y-2">
                <p>✅ <span className="font-bold">适合场景：</span>看好某只股票长期价值，希望打折建仓。</p>
                <p>⚠️ <span className="font-bold">风险：</span>股价大跌时需双倍吸纳（如有双倍条款），且有敲出机制限制上涨收益。</p>
              </div>
            </div>

            {/* Product 3: DQ */}
            <div className="bg-white p-8 rounded-2xl border border-gray-200 hover:border-cyan-300 hover:shadow-xl hover:shadow-cyan-100/50 transition-all duration-300 group">
              <div className="flex justify-between items-start mb-4">
                <h3 className="text-2xl font-bold text-gray-900 group-hover:text-cyan-600 transition-colors">DQ</h3>
                <span className="px-2 py-1 bg-gray-100 text-gray-500 text-xs rounded font-mono">Decumulator</span>
              </div>
              <h4 className="text-sm font-bold text-gray-700 mb-2">累沽期权</h4>
              <p className="text-gray-500 text-sm leading-relaxed mb-6">
                AQ 的反向操作。允许投资者在合约期内，每天以订约时市场价的溢价卖出持有股票。
              </p>
              <div className="bg-slate-50 p-4 rounded-lg border border-slate-100 text-xs text-gray-600 space-y-2">
                <p>✅ <span className="font-bold">适合场景：</span>持有大量现货，希望以高于市价的价格分批减持套现。</p>
                <p>⚠️ <span className="font-bold">风险：</span>若股价暴涨，不得不以约定的较低价格卖出股票。</p>
              </div>
            </div>

            {/* Product 4: BEN */}
            <div className="bg-white p-8 rounded-2xl border border-gray-200 hover:border-cyan-300 hover:shadow-xl hover:shadow-cyan-100/50 transition-all duration-300 group">
              <div className="flex justify-between items-start mb-4">
                <h3 className="text-2xl font-bold text-gray-900 group-hover:text-cyan-600 transition-colors">BEN</h3>
                <span className="px-2 py-1 bg-gray-100 text-gray-500 text-xs rounded font-mono">Bonus Enhanced Note</span>
              </div>
              <h4 className="text-sm font-bold text-gray-700 mb-2">红利增强票据</h4>
              <p className="text-gray-500 text-sm leading-relaxed mb-6">
                一种剔除了敲出机制（Knock-Out）的票据结构。只要标的资产在到期日不跌破特定屏障，即可获得红利收益。
              </p>
              <div className="bg-slate-50 p-4 rounded-lg border border-slate-100 text-xs text-gray-600 space-y-2">
                <p>✅ <span className="font-bold">适合场景：</span>不需要提前赎回机制，追求确定性的红利收益。</p>
                <p>⚠️ <span className="font-bold">风险：</span>到期日若跌破屏障，将通过实物交割承担股价下跌损失。</p>
              </div>
            </div>

          </div>
        </div>
      </section>

      {/* 4. 询价与定制 (CTA) */}
      <section className="bg-gray-900 py-16 relative overflow-hidden">
        {/* 装饰线条 */}
        <div className="absolute top-0 left-0 w-full h-full opacity-10 pointer-events-none">
            <svg width="100%" height="100%">
                <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                    <path d="M 40 0 L 0 0 0 40" fill="none" stroke="white" strokeWidth="1"/>
                </pattern>
                <rect width="100%" height="100%" fill="url(#grid)" />
            </svg>
        </div>

        <div className="max-w-4xl mx-auto px-6 text-center relative z-10">
          <h2 className="text-2xl md:text-3xl font-bold text-white mb-6">需要定制专属的结构化产品？</h2>
          <p className="text-gray-400 mb-8 max-w-2xl mx-auto">
            场外衍生品具有高度定制化特性。请联系我们的专业顾问，获取主要投行的最新报价（Indicative Pricing）与条款设计。
          </p>
          <div className="flex justify-center gap-4">
            <button className="bg-cyan-600 text-white px-8 py-3 rounded-full font-bold hover:bg-cyan-700 transition shadow-lg shadow-cyan-600/30">
              进行测算
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}