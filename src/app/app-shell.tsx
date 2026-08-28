import type { ReactNode } from "react";

type NavKey = "radar" | "sources" | "runs" | "studio";

const links: Array<{ key: NavKey; href: string; label: string }> = [
  { key: "radar", href: "/", label: "今日雷达" },
  { key: "sources", href: "/sources", label: "信息源" },
  { key: "runs", href: "/runs", label: "运行中心" },
  { key: "studio", href: "/studio", label: "内容工作台" },
];

export function AppShell({ active, children }: { active: NavKey; children: ReactNode }) {
  return <main className="shell">
    <aside className="sidebar">
      <a className="brand" href="/"><span>◉</span> Trend Radar</a>
      <nav>{links.map((link) => <a className={active === link.key ? "active" : ""} href={link.href} key={link.key}>{link.label}</a>)}</nav>
      <div className="sidebar-foot">V1 · 情报发现与选题</div>
    </aside>
    {children}
  </main>;
}
