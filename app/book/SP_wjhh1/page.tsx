'use client';

import React from 'react';
import Link from 'next/link';
import { 
  TrendingUp, 
  Briefcase, 
  ShieldAlert, 
  ArrowRight,
  Wallet,
  Activity,
  AlertTriangle,
  BarChart3
} from 'lucide-react';

export default function SPWjhh1Dashboard() {
  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8 relative">
      
      {/* 1. 欢迎与标题区域 */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900">春天稳健混合1号基金</h1>
        <p className="mt-2 text-gray-600">
          欢迎回来。以下是今日的投资组合概况与系统状态。
        </p>
      </div>

      {/* 2. 核心指标卡片 (Mock Data) */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex flex-col">
          <div className="text-sm text-gray-500 font-medium mb-2 flex items-center gap-2">
            <Wallet size={16} className="text-blue-500" />
            总资产规模 (AUM)
          </div>
          <div className="text-2xl font-bold text-gray-900">$12,450,000</div>
          <div className="text-xs text-green-600 mt-2 flex items-center">
            <TrendingUp size={12} className="mr-1" />
            +2.4% 较昨日
          </div>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex flex-col">
          <div className="text-sm text-gray-500 font-medium mb-2 flex items-center gap-2">
            <Activity size={16} className="text-purple-500" />
            今日盈亏 (PnL)
          </div>
          <div className="text-2xl font-bold text-gray-900">+$34,200</div>
          <div className="text-xs text-gray-400 mt-2">实时更新中</div>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex flex-col">
          <div className="text-sm text-gray-500 font-medium mb-2 flex items-center gap-2">
            <BarChart3 size={16} className="text-indigo-500" />
            持仓头寸数
          </div>
          <div className="text-2xl font-bold text-gray-900">28</div>
          <div className="text-xs text-gray-400 mt-2">包含 5 个未结 FCN</div>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex flex-col">
          <div className="text-sm text-gray-500 font-medium mb-2 flex items-center gap-2">
            <AlertTriangle size={16} className="text-red-500" />
            风控警报
          </div>
          <div className="text-2xl font-bold text-red-600">2</div>
          <div className="text-xs text-red-500 mt-2">需立即关注</div>
        </div>
      </div>

      {/* 3. 模块快捷导航入口 */}
      <h2 className="text-xl font-bold text-gray-800 pt-4">快速进入模块</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        
        {/* 交易管理卡片 */}
        <Link 
          href="/book/SP_wjhh1/trade/fcn"
          className="group relative bg-gradient-to-br from-blue-50 to-white p-8 rounded-2xl border border-blue-100 shadow-sm hover:shadow-md transition-all duration-300 hover:-translate-y-1"
        >
          <div className="absolute top-6 right-6 bg-blue-100 p-3 rounded-full text-blue-600 group-hover:bg-blue-600 group-hover:text-white transition-colors">
            <TrendingUp size={24} />
          </div>
          <h3 className="text-xl font-bold text-gray-900 mb-2">交易管理</h3>
          <p className="text-gray-500 text-sm mb-6 h-10">
            录入新的 FCN、Option、Spot 等各类交易指令。
          </p>
          <span className="inline-flex items-center text-blue-600 font-semibold text-sm group-hover:translate-x-1 transition-transform">
            进入交易模块 <ArrowRight size={16} className="ml-1" />
          </span>
        </Link>

        {/* 持仓分析卡片 */}
        <Link 
          href="/book/SP_wjhh1/holdings/summary"
          className="group relative bg-gradient-to-br from-purple-50 to-white p-8 rounded-2xl border border-purple-100 shadow-sm hover:shadow-md transition-all duration-300 hover:-translate-y-1"
        >
          <div className="absolute top-6 right-6 bg-purple-100 p-3 rounded-full text-purple-600 group-hover:bg-purple-600 group-hover:text-white transition-colors">
            <Briefcase size={24} />
          </div>
          <h3 className="text-xl font-bold text-gray-900 mb-2">持仓分析</h3>
          <p className="text-gray-500 text-sm mb-6 h-10">
            查看资金池、FCN、股票等资产的实时持仓与汇总报表。
          </p>
          <span className="inline-flex items-center text-purple-600 font-semibold text-sm group-hover:translate-x-1 transition-transform">
            查看持仓详情 <ArrowRight size={16} className="ml-1" />
          </span>
        </Link>

        {/* 风控中心卡片 */}
        <Link 
          href="/book/SP_wjhh1/risk/exposure-underlying"
          className="group relative bg-gradient-to-br from-red-50 to-white p-8 rounded-2xl border border-red-100 shadow-sm hover:shadow-md transition-all duration-300 hover:-translate-y-1"
        >
          <div className="absolute top-6 right-6 bg-red-100 p-3 rounded-full text-red-600 group-hover:bg-red-600 group-hover:text-white transition-colors">
            <ShieldAlert size={24} />
          </div>
          <h3 className="text-xl font-bold text-gray-900 mb-2">风控中心</h3>
          <p className="text-gray-500 text-sm mb-6 h-10">
            监控标的暴露与行业集中度，管理潜在风险。
          </p>
          <span className="inline-flex items-center text-red-600 font-semibold text-sm group-hover:translate-x-1 transition-transform">
            前往风控面板 <ArrowRight size={16} className="ml-1" />
          </span>
        </Link>
      </div>

      {/* 4. 系统通知或最近活动 (Optional) */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
          <h3 className="font-semibold text-gray-800">最近活动日志</h3>
        </div>
        <div className="divide-y divide-gray-100">
          {[
            { action: '新交易录入', detail: 'FCN - NVDA.US (Trade ID: #8823)', time: '10分钟前', type: 'trade' },
            { action: '风险警报', detail: '科技板块暴露度接近阈值 (28%)', time: '2小时前', type: 'alert' },
            { action: '资金变动', detail: '入金确认: $500,000', time: '4小时前', type: 'fund' },
          ].map((log, index) => (
            <div key={index} className="px-6 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors">
              <div className="flex items-center gap-3">
                <span className={`w-2 h-2 rounded-full ${log.type === 'alert' ? 'bg-red-500' : 'bg-blue-500'}`}></span>
                <span className="text-sm font-medium text-gray-700">{log.action}</span>
                <span className="text-sm text-gray-500">- {log.detail}</span>
              </div>
              <span className="text-xs text-gray-400">{log.time}</span>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}