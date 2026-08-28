import { prisma } from "@/lib/prisma";
import {
  isDullB2b,
  isGenericCompilation,
  isUnreadableForAudience,
} from "@/lib/scoring";

export async function rebuildTodayCandidates() {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  const dailyItems = await prisma.contentItem.findMany({
    where: { createdAt: { gte: start, lt: end }, score: { isNot: null } },
    include: { score: true, rawItem: { select: { payload: true } }, source: { select: { type: true } } },
    orderBy: { score: { total: "desc" } },
    take: 30,
  });
  const weekStart = new Date();
  weekStart.setUTCDate(weekStart.getUTCDate() - 7);
  const youtubeItems = await prisma.contentItem.findMany({
    where: { source: { type: "YOUTUBE" }, publishedAt: { gte: weekStart }, score: { isNot: null } },
    include: { score: true, rawItem: { select: { payload: true } }, source: { select: { type: true } } },
    take: 60,
  });
  const popularity = (item: typeof youtubeItems[number]) => {
    const payload = item.rawItem?.payload as { videoDetails?: { statistics?: { viewCount?: string; likeCount?: string; commentCount?: string } } } | null;
    const statistics = payload?.videoDetails?.statistics;
    const views = Math.max(0, Number(statistics?.viewCount) || 0);
    const likes = Math.max(0, Number(statistics?.likeCount) || 0);
    const comments = Math.max(0, Number(statistics?.commentCount) || 0);
    const ageHours = Math.max(6, (Date.now() - (item.publishedAt?.getTime() ?? Date.now())) / 3_600_000);
    const velocity = views / ageHours;
    // Engagement is a freshness tie-breaker, not the main editorial signal.
    // It must never overpower Avin's ability-gain and evidence score.
    return (item.score?.total ?? 0) + Math.min(8, Math.log10(views + 1) * 0.8 + Math.log10(velocity + 1) * 1.2 + Math.log10(likes + comments + 1) * 0.6);
  };
  youtubeItems.sort((a, b) => popularity(b) - popularity(a));
  const attractive = (item: (typeof dailyItems)[number]) => {
    const title = item.title;
    if (isUnreadableForAudience(title)) return false;
    if (isGenericCompilation(`${title} ${item.body ?? ""}`)) return false;
    if (isDullB2b(`${title} ${item.body ?? ""}`)) return false;
    return (item.score?.total ?? 0) >= 58;
  };
  const merged = new Map(
    dailyItems.filter(attractive).map((item) => [item.id, item]),
  );
  for (const item of youtubeItems.filter(attractive).slice(0, 16))
    merged.set(item.id, item);
  const xNewsSince = new Date(start);
  xNewsSince.setUTCDate(xNewsSince.getUTCDate() - 4);
  const xNewsItems = await prisma.contentItem.findMany({
    where: {
      source: { type: "X_BOOKMARK" },
      OR: [{ createdAt: { gte: xNewsSince } }, { publishedAt: { gte: xNewsSince } }],
    },
    include: { score: true, rawItem: { select: { payload: true } }, source: { select: { type: true } } },
    orderBy: { createdAt: "desc" },
    take: 24,
  });
  for (const item of xNewsItems) merged.set(item.id, item);
  const items = [...merged.values()].sort((a, b) => {
    if (a.source.type === "X_BOOKMARK" && b.source.type !== "X_BOOKMARK") return -1;
    if (b.source.type === "X_BOOKMARK" && a.source.type !== "X_BOOKMARK") return 1;
    const aRank = a.source.type === "YOUTUBE" ? popularity(a) : (a.score?.total ?? 0);
    const bRank = b.source.type === "YOUTUBE" ? popularity(b) : (b.score?.total ?? 0);
    return bRank - aRank;
  });
  await Promise.all(items.map((item, index) => {
    const xNews = item.source.type === "X_BOOKMARK";
    return prisma.dailyCandidate.upsert({
      where: { date_contentItemId: { date: start, contentItemId: item.id } },
      create: {
        date: start,
        contentItemId: item.id,
        rank: index + 1,
        status: "PENDING",
        editorNote: xNews ? "中文圈图文，待挑选" : undefined,
      },
      update: { rank: index + 1 },
    });
  }));
  await prisma.dailyCandidate.deleteMany({
    where: {
      date: start,
      contentItemId: { notIn: items.map((item) => item.id) },
    },
  });
  return items.length;
}
