import { CandidateStatus } from "@prisma/client";
import { AppShell } from "./app-shell";
import { Dashboard } from "./dashboard";
import { prisma } from "@/lib/prisma";

export default async function Home() {
  const start = new Date(); start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start); end.setUTCDate(end.getUTCDate() + 1);
  const weekStart = new Date(); weekStart.setUTCDate(weekStart.getUTCDate() - 7);
  const [candidates, discovered, selected, weeklyYoutube] = await Promise.all([
    prisma.dailyCandidate.findMany({ where: { date: start }, orderBy: { rank: "asc" }, include: { contentItem: { include: { analysis: true, score: true, source: true, mediaAssets: { orderBy: { updatedAt: "desc" }, take: 1 } } } } }),
    prisma.contentItem.count({ where: { createdAt: { gte: start, lt: end } } }),
    prisma.dailyCandidate.count({ where: { date: start, status: CandidateStatus.SELECTED } }),
    prisma.contentItem.count({ where: { source: { type: "YOUTUBE" }, publishedAt: { gte: weekStart }, score: { isNot: null } } }),
  ]);
  const metrics = [["待审核", String(candidates.filter((item) => item.status === CandidateStatus.PENDING).length), "今日 + 视频周榜"], ["已选题", String(selected), "可进入内容工作台"], ["YouTube 周素材", String(weeklyYoutube), "近 7 天已分析"]];
  return (
    <AppShell active="radar">
      <section className="content">
        <header>
          <div>
            <p className="eyebrow">TODAY&apos;S SIGNALS + WEEKLY VIDEO</p>
            <h1>今天的新信号，本周的好素材</h1>
            <p className="subtle">普通信息源按今日筛选；YouTube 按近 7 天播放与互动热度补充视频素材。</p>
          </div>
          <a className="primary button-link" href="/sources">管理信息源</a>
        </header>

        <section className="metric-grid" aria-label="今日指标">
          {metrics.map(([name, value, note]) => (
            <article className="metric" key={name}>
              <p>{name}</p><strong>{value}</strong><span>{note}</span>
            </article>
          ))}
        </section>

        <Dashboard initialCandidates={candidates} initialSources={[]} initialRuns={[]} />
      </section>
    </AppShell>
  );
}
