import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { ClerkProvider } from '@clerk/nextjs';
// 引入我們的新 Header 組件
import Header from "@/components/Header";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "SIP - Spring Investment Platform",
  description: "專為家族辦公室打造的投資記賬本",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider>
      <html lang="zh-CN">
        <body className={`${inter.className} bg-gray-50`}>
          {/* 放置全局導航欄 */}
          <Header />
          {/* 頁面主體內容，增加頂部邊距防止被固定的 Header 遮擋 */}
          <main className="pt-24">
            {children}
          </main>
        </body>
      </html>
    </ClerkProvider>
  );
}
