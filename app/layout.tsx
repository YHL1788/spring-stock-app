import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { ClerkProvider } from '@clerk/nextjs';
// 引入我們的新 Header 組件
import Header from "@/components/Header";
import PwaRegister from "@/components/PwaRegister";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "SIP - Spring Investment Platform",
  description: "專為家族辦公室打造的投資記賬本",
  manifest: "/manifest.webmanifest",
  applicationName: "SIP Holdings",
  icons: {
    icon: [
      { url: "/icons/sip-ledger-icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/sip-ledger-icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    title: "SIP Holdings",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#16352f",
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
          <PwaRegister />
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
