'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Activity, PieChart } from 'lucide-react';

// 定义风控孙页面列表
const riskItems = [
  { path: 'exposure-underlying', label: '标的暴露情况', icon: Activity },
  { path: 'exposure-industry', label: '行业暴露情况', icon: PieChart },
];

export default function RiskLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex h-full">
      <aside className="w-64 bg-white border-r border-gray-200 overflow-y-auto flex-shrink-0">
        <div className="p-4">
          <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3 px-2 flex items-center gap-2">
            <Activity size={12} />
            风险监控
          </h2>
          <div className="space-y-1">
            {riskItems.map((item) => {
              const href = `/book/SP_wjhh1/risk/${item.path}`;
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
                  <item.icon size={16} />
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