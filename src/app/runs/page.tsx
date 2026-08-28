import { AppShell } from "../app-shell";
import { Dashboard } from "../dashboard";
import { prisma } from "@/lib/prisma";

export default async function RunsPage() {
  const runs = await prisma.crawlRun.findMany({ orderBy: { startedAt: "desc" }, take: 50, include: { source: { select: { name: true, type: true } } } });
  const failed = runs.filter((run) => run.status === "FAILED").length;
  return <AppShell active="runs"><section className="content operations-content"><header><div><p className="eyebrow">OPERATIONS</p><h1>运行中心</h1><p className="subtle">查看采集任务、失败原因和系统运行记录。</p></div><span className={failed ? "issue-badge" : "status"}>{failed ? `${failed} 个异常` : "运行正常"}</span></header><Dashboard mode="runs" initialCandidates={[]} initialSources={[]} initialRuns={runs} /></section></AppShell>;
}
