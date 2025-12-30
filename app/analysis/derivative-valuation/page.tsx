"use client";

import React, { useState } from 'react';
import FCNPanel from './_components/FCNPanel';
import DQAQPanel from './_components/DQ-AQPanel';

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
            <div className="mt-4 md:mt-0 flex bg-gray-200 rounded-lg p-1 self-start shadow-inner">
                <button 
                  onClick={() => setActiveTab('FCN')} 
                  className={`px-6 py-2.5 text-sm font-medium rounded-md transition-all duration-200 ${activeTab === 'FCN' ? 'bg-white text-blue-600 shadow-sm ring-1 ring-black/5' : 'text-gray-500 hover:text-gray-700'}`}
                >
                  FCN 模型
                </button>
                <button 
                  onClick={() => setActiveTab('DQ/AQ')} 
                  className={`px-6 py-2.5 text-sm font-medium rounded-md transition-all duration-200 ${activeTab === 'DQ/AQ' ? 'bg-white text-blue-600 shadow-sm ring-1 ring-black/5' : 'text-gray-500 hover:text-gray-700'}`}
                >
                  DQ/AQ 模型
                </button>
            </div>
        </div>

        {/* 内容区域 */}
        <div className="transition-opacity duration-300 ease-in-out">
          {activeTab === 'FCN' ? (
            <FCNPanel />
          ) : (
            <DQAQPanel />
          )}
        </div>
      </div>
    </div>
  );
}