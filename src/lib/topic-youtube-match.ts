import { prisma } from "@/lib/prisma";

type SearchItem = { id?: { videoId?: string }; snippet?: { title?: string; channelTitle?: string; publishedAt?: string; thumbnails?: Record<string, { url?: string }> } };
type VideoDetail = { id?: string; contentDetails?: { duration?: string }; status?: { license?: string; embeddable?: boolean }; statistics?: { viewCount?: string; likeCount?: string } };

function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
}

function buildQuery(item: { title: string; canonicalUrl: string; analysis: { tags: unknown; entities: unknown } | null }) {
  const urlTail = (() => { try { return decodeURIComponent(new URL(item.canonicalUrl).pathname.split("/").filter(Boolean).pop() ?? ""); } catch { return ""; } })();
  const tags = strings(item.analysis?.tags).concat(strings(item.analysis?.entities));
  const parts = [urlTail, item.title, ...tags]
    .map((part) => part.replace(/https?:\/\/\S+|[#|｜].*$/g, " ").replace(/[^\p{L}\p{N}._+\- ]/gu, " ").replace(/\s+/g, " ").trim())
    .filter((part) => part.length > 1);
  return [...new Set(parts)].join(" ").slice(0, 120);
}

function relevance(query: string, title: string, views: number, publishedAt: Date | null) {
  const queryTokens = query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((token) => token.length >= 3);
  const haystack = title.toLowerCase();
  const overlap = queryTokens.filter((token) => haystack.includes(token)).length / Math.max(1, Math.min(queryTokens.length, 8));
  const ageHours = Math.max(6, (Date.now() - (publishedAt?.getTime() ?? Date.now())) / 3_600_000);
  const velocity = views / ageHours;
  return Math.min(100, Math.round(overlap * 65 + Math.log10(views + 1) * 5 + Math.log10(velocity + 1) * 5));
}

export async function matchYoutubeForTopic(contentItemId: string) {
  const apiKey = process.env.YOUTUBE_API_KEY?.trim();
  if (!apiKey) throw new Error("YOUTUBE_API_KEY 未配置");
  const item = await prisma.contentItem.findUniqueOrThrow({ where: { id: contentItemId }, include: { analysis: true } });
  const query = buildQuery(item);
  const params = new URLSearchParams({ part: "snippet", type: "video", q: query, maxResults: "15", order: "relevance", relevanceLanguage: "en", videoEmbeddable: "true", videoLicense: "creativeCommon", safeSearch: "strict", key: apiKey });
  const response = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`YouTube 定向搜索失败：${response.status}`);
  const search = await response.json() as { items?: SearchItem[] };
  const ids = (search.items ?? []).flatMap((entry) => entry.id?.videoId ? [entry.id.videoId] : []);
  if (!ids.length) return [];
  const detailParams = new URLSearchParams({ part: "contentDetails,statistics,status", id: ids.join(","), key: apiKey });
  const detailResponse = await fetch(`https://www.googleapis.com/youtube/v3/videos?${detailParams}`, { cache: "no-store" });
  if (!detailResponse.ok) throw new Error(`YouTube 视频数据读取失败：${detailResponse.status}`);
  const details = await detailResponse.json() as { items?: VideoDetail[] };
  const detailMap = new Map((details.items ?? []).flatMap((entry) => entry.id ? [[entry.id, entry] as const] : []));
  const ranked = (search.items ?? []).flatMap((entry) => {
    const videoId = entry.id?.videoId; const snippet = entry.snippet;
    if (!videoId || !snippet?.title) return [];
    const detail = detailMap.get(videoId);
    if (detail?.status?.license !== "creativeCommon" || detail.status.embeddable === false) return [];
    const publishedAt = snippet.publishedAt ? new Date(snippet.publishedAt) : null;
    const views = Number(detail?.statistics?.viewCount) || 0;
    const score = relevance(query, snippet.title, views, publishedAt);
    return [{ videoId, title: snippet.title, channel: snippet.channelTitle ?? null, thumbnailUrl: snippet.thumbnails?.high?.url ?? snippet.thumbnails?.medium?.url ?? null, publishedAt, viewCount: BigInt(views), likeCount: BigInt(Number(detail?.statistics?.likeCount) || 0), duration: detail?.contentDetails?.duration ?? null, matchScore: score }];
  }).sort((a, b) => b.matchScore - a.matchScore || Number(b.viewCount - a.viewCount)).slice(0, 3);
  await prisma.topicVideoMatch.deleteMany({ where: { contentItemId } });
  for (const video of ranked) await prisma.topicVideoMatch.create({ data: { contentItemId, youtubeVideoId: video.videoId, url: `https://www.youtube.com/watch?v=${video.videoId}`, title: video.title, channel: video.channel, thumbnailUrl: video.thumbnailUrl, publishedAt: video.publishedAt, viewCount: video.viewCount, likeCount: video.likeCount, duration: video.duration, matchScore: video.matchScore } });
  return prisma.topicVideoMatch.findMany({ where: { contentItemId }, orderBy: [{ matchScore: "desc" }, { viewCount: "desc" }] });
}
