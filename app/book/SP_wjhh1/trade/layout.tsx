'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { FileText } from 'lucide-react';

// 定义交易孙页面列表
const tradeItems = [
  { path: 'fcn', label: 'FCN 交易' },
  { path: 'option', label: 'Option 交易' },
  { path: 'dq-aq', label: 'DQ-AQ 交易' },
  { path: 'spot', label: 'Spot 交易' },
  { path: 'pe', label: '私募基金 交易' },
  { path: 'cbbc-futures', label: '牛熊证-期货 交易' },

];

export default function TradeLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex h-full">
      {/* 左侧侧边栏 */}
      <aside className="w-64 bg-white border-r border-gray-200 overflow-y-auto flex-shrink-0">
        <div className="p-4">
          <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3 px-2 flex items-center gap-2">
            <FileText size={12} />
            交易录入类型
          </h2>
          <div className="space-y-1">
            {tradeItems.map((item) => {
              const href = `/book/SP_wjhh1/trade/${item.path}`;
              const isActive = pathname === href;

              return (
                <Link
                  key={item.path}
                  href={href}
                  className={`block w-full text-left px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-blue-50 text-blue-700 border border-blue-100'
                      : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900 border border-transparent'
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        </div>
      </aside>

      {/* 右侧内容区域 */}
      <div className="flex-1 p-8 bg-gray-50 overflow-y-auto">
        {children}
      </div>
    </div>
  );
}