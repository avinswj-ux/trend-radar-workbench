import { AppShell } from "../app-shell";
import { Dashboard } from "../dashboard";
import { prisma } from "@/lib/prisma";

export default async function SourcesPage() {
  const sources = await prisma.source.findMany({ orderBy: { createdAt: "desc" }, include: { _count: { select: { runs: true, items: true } } } });
  return <AppShell active="sources"><section className="content operations-content"><header><div><p className="eyebrow">SOURCE LIBRARY</p><h1>信息源</h1><p className="subtle">添加、配置与运行情报采集来源。候选审核已移至今日雷达。</p></div></header><Dashboard mode="sources" initialCandidates={[]} initialSources={sources} initialRuns={[]} /></section></AppShell>;
}
