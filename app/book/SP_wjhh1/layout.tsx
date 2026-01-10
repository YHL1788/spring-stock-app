'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { 
  LayoutDashboard, 
  TrendingUp, 
  Briefcase, 
  ShieldAlert 
} from 'lucide-react';

export default function SPWjhh1Layout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // 辅助函数：高亮当前选中的一级 Tab
  const isActive = (path: string) => pathname.startsWith(path);

  return (
    <div className="flex flex-col h-screen bg-gray-50 font-sans text-gray-900">
      {/* 顶部 Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10 flex-shrink-0">
        <div className="px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-blue-600 p-2 rounded-lg shadow-sm">
              <LayoutDashboard className="text-white w-5 h-5" />
            </div>
            <h1 className="text-xl font-bold tracking-tight text-gray-800">SP_wjhh1 管理系统</h1>
          </div>
        </div>

        {/* 一级导航栏 (Tabs) */}
        <nav className="flex px-6 gap-8">
          <Link
            href="/book/SP_wjhh1/trade/fcn"
            className={`pb-3 pt-1 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
              isActive('/book/SP_wjhh1/trade')
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <TrendingUp size={16} />
            交易管理 (Trade)
          </Link>

          <Link
            href="/book/SP_wjhh1/holdings/summary"
            className={`pb-3 pt-1 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
              isActive('/book/SP_wjhh1/holdings')
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <Briefcase size={16} />
            持仓分析 (Holdings)
          </Link>

          <Link
            href="/book/SP_wjhh1/risk/exposure-underlying"
            className={`pb-3 pt-1 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
              isActive('/book/SP_wjhh1/risk')
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <ShieldAlert size={16} />
            风控中心 (Risk)
          </Link>
        </nav>
      </header>

      {/* 子页面内容渲染区域 */}
      <main className="flex-1 overflow-hidden">
        {children}
      </main>
    </div>
  );
}