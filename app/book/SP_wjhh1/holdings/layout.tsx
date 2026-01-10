'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { PieChart, DollarSign, Layers } from 'lucide-react';

// 定义持仓孙页面列表
const holdingsItems = [
  { path: 'summary', label: '汇总', icon: PieChart },
  { path: 'cash', label: '资金', icon: DollarSign },
  { path: 'fcn', label: 'FCN', icon: Layers },
  { path: 'stocks', label: '股票', icon: Layers },
  { path: 'dq-aq', label: 'DQ-AQ', icon: Layers },
  { path: 'option', label: 'Option', icon: Layers },
  { path: 'pe', label: '私募基金', icon: Layers },
  { path: 'cbbc-futures', label: '牛熊证-期货', icon: Layers },
];

export default function HoldingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex h-full">
      <aside className="w-64 bg-white border-r border-gray-200 overflow-y-auto flex-shrink-0">
        <div className="p-4">
          <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3 px-2 flex items-center gap-2">
            <Layers size={12} />
            资产分布
          </h2>
          <div className="space-y-1">
            {holdingsItems.map((item) => {
              const href = `/book/SP_wjhh1/holdings/${item.path}`;
              const isActive = pathname === href;

              return (
                <Link
                  key={item.path}
                  href={href}
                  className={`flex items-center gap-2 w-full text-left px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-blue-50 text-blue-700 border border-blue-100'
                      : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900 border border-transparent'
                  }`}
                >
                  {item.icon ? <item.icon size={16} /> : <Layers size={16} />}
                  {item.label}
                </Link>
              );
            })}
          </div>
        </div>
      </aside>

      <div className="flex-1 p-8 bg-gray-50 overflow-y-auto">
        {children}
      </div>
    </div>
  );
}