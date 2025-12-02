import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { ClerkProvider } from '@clerk/nextjs' // <--- 引入 Clerk

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Spring Stock",
  description: "Global stock market analysis tool",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // 用 ClerkProvider 包裹整个应用
    <ClerkProvider>
      <html lang="en">
        <body className={inter.className}>{children}</body>
      </html>
    </ClerkProvider>
  );
}
