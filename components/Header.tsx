"use client";

import Link from 'next/link';
// 移除 useState，因为不再需要管理语言状态
import { SignedIn, SignedOut, SignInButton, UserButton } from '@clerk/nextjs';

// 定義導航菜單結構
const navigation = [
  {
    name: '提供的产品',
    href: '#',
    current: false,
    children: [
      { name: '场内证券', href: '/offerings/securities' },
      { name: '场内期货', href: '/offerings/futures' },
      { name: '外汇', href: '/offerings/forex' },
      { name: '场内期权', href: '/offerings/options' },
      { name: '场外衍生品', href: '/offerings/derivatives' },
      { name: '私募基金', href: '/offerings/funds' },
    ],
  },
  {
    name: '行情',
    href: '#',
    current: false,
    children: [
      { name: '全球概览', href: '/market/overview' },
      { name: '重大事件日历', href: '/market/calendar' },
      { name: '个股查询', href: '/market/quote' }, 
      { name: '我的自选股', href: '/market/pools' }, 
    ],
  },
  {
    name: '分析',
    href: '#',
    current: false,
    children: [
      { name: '衍生品测算', href: '/analysis/derivative-valuation' },
      { name: '供应链', href: '/analysis/supply-chain' },
      { name: '同业估值比对', href: '/analysis/valuation' }
    ,
    ],
  },
  {
    name: '策略',
    href: '#',
    current: false,
    children: [
      { name: '日频PCHIP插值策略', href: '/strategies/pchip' },
      { name: '我的策略', href: '/strategies/mine' },
    ],
  },
  { name: '账簿', href: '#', current: false },
  {
    name: '投资笔记',
    href: '#',
    current: false,
    children: [
      { name: 'SIP笔记', href: '/notes/sip' },
      { name: '我的笔记', href: '/notes/mine' },
    ],
  },
  {
    name: '关于我們',
    href: '#',
    current: false,
    children: [
      { name: 'SIP介紹', href: '/about/intro' },
      { name: 'SIP团队', href: '/about/team' },
      { name: '常见问题', href: '/about/faq' },
      { name: '联系我们', href: '/about/contact' },
    ],
  },
];

export default function Header() {
  return (
    <header className="bg-white border-b border-gray-100 fixed w-full top-0 z-50">
      <nav className="mx-auto max-w-7xl px-6 lg:px-8" aria-label="Top">
        <div className="flex w-full items-center justify-between border-b border-indigo-500 py-4 lg:border-none">
          <div className="flex items-center">
            {/* Logo 區域 */}
            <Link href="/" className="flex flex-col items-start">
              <span className="sr-only">SIP</span>
              <div className="flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-8 h-8 text-blue-600">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941" />
                </svg>
                <span className="text-2xl font-extrabold text-gray-900 tracking-tight">SIP</span>
              </div>
              <span className="text-[10px] text-gray-500 uppercase tracking-wider font-medium mt-0.5">Spring Investment Platform</span>
            </Link>
            
            {/* 導航菜單區域 (桌面端) */}
            <div className="hidden ml-16 lg:flex lg:items-center lg:space-x-8">
              {navigation.map((item) => (
                <div key={item.name} className="relative group">
                  <Link
                    href={item.href}
                    className="text-sm font-medium text-gray-700 hover:text-blue-600 py-2 flex items-center gap-1"
                  >
                    {item.name}
                    {item.children && (
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3 h-3 text-gray-400 group-hover:text-blue-600 transition-transform group-hover:rotate-180">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                      </svg>
                    )}
                  </Link>
                  {/* 下拉菜單 */}
                  {item.children && (
                    <div className="absolute left-0 top-full pt-2 w-48 hidden group-hover:block">
                      <div className="bg-white rounded-lg shadow-xl border border-gray-100 py-2">
                        {item.children.map((child) => (
                          <Link
                            key={child.name}
                            href={child.href}
                            className="block px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 hover:text-blue-600"
                          >
                            {child.name}
                          </Link>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
          
          {/* 右側功能區 */}
          <div className="flex items-center gap-4">
            {/* 移除了語言切換按鈕 */}
            <SignedOut>
              <SignInButton mode="modal">
                <button className="text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-full transition shadow-sm">
                  登录 / 注册
                </button>
              </SignInButton>
            </SignedOut>
            <SignedIn>
              <UserButton afterSignOutUrl="/" />
            </SignedIn>
          </div>
        </div>
      </nav>
    </header>
  );
}