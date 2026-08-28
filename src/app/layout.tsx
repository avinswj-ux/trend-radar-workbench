import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI 情报雷达",
  description: "发现、理解并筛选值得创作的 AI 趋势。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
