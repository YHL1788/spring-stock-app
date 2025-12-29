"use client";

import React, { useState } from 'react';
import FCNPanel from './_components/FCNPanel';

export default function DerivativeValuationPage() {
  const [activeTab, setActiveTab] = useState<'FCN' | 'DQ/AQ'>('FCN');

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* 顶部标题栏 */}
        <div className="mb-8 flex flex-col md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">衍生品测算</h1>
              <p className="mt-2 text-sm text-gray-500">结构化产品定价与风险分析模型</p>
            </div>
            <div className="mt-4 md:mt-0 flex bg-gray-200 rounded-lg p-1 self-start">
                <button onClick={() => setActiveTab('FCN')} className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${activeTab === 'FCN' ? 'bg-white text-gray-900 shadow' : 'text-gray-500'}`}>FCN</button>
                <button onClick={() => setActiveTab('DQ/AQ')} className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${activeTab === 'DQ/AQ' ? 'bg-white text-gray-900 shadow' : 'text-gray-500'}`}>DQ/AQ</button>
            </div>
        </div>

        {activeTab === 'FCN' ? (
          <FCNPanel />
        ) : (
          // 这里以后可以放 DQ/AQ 组件
          <div className="bg-white shadow rounded-lg p-12 min-h-[500px] flex flex-col items-center justify-center text-gray-400">
             <svg className="w-16 h-16 mb-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
             </svg>
             <p className="text-lg font-medium">DQ/AQ 定价引擎</p>
             <p className="text-sm mt-2">即将上线...</p>
          </div>
        )}
      </div>
    </div>
  );
}