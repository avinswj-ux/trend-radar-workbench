import { youtubeSourceConfigSchema } from "@/lib/contracts";
import type { NormalizedDiscovery, SourceAdapter } from "./types";

type YouTubeSearchItem = {
  id?: { videoId?: string };
  snippet?: { title?: string; description?: string; channelTitle?: string; publishedAt?: string; thumbnails?: Record<string, { url?: string }> };
};
type YouTubeVideo = { id?: string; contentDetails?: { duration?: string }; status?: { license?: "youtube" | "creativeCommon"; embeddable?: boolean }; statistics?: { viewCount?: string; likeCount?: string; commentCount?: string } };

export const youtubeAdapter: SourceAdapter = {
  type: "YOUTUBE",
  async discover(config: unknown): Promise<NormalizedDiscovery[]> {
    const apiKey = process.env.YOUTUBE_API_KEY;
    if (!apiKey) throw new Error("YOUTUBE_API_KEY is not configured");
    const { query, limit, order, windowDays, relevanceLanguage, regionCode, videoLicense } = youtubeSourceConfigSchema.parse(config);
    const publishedAfter = new Date(Date.now() - windowDays * 86_400_000).toISOString();
    const params = new URLSearchParams({ part: "snippet", type: "video", q: query, maxResults: String(limit), order, publishedAfter, relevanceLanguage, regionCode, key: apiKey });
    if (videoLicense) params.set("videoLicense", videoLicense);
    const response = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`YouTube Data API search failed: ${response.status} ${await response.text()}`);
    const payload = await response.json() as { items?: YouTubeSearchItem[] };
    const ids = (payload.items ?? []).map((item) => item.id?.videoId).filter((id): id is string => Boolean(id));
    const details = await fetchVideoDetails(ids, apiKey);
    return (payload.items ?? []).flatMap((item) => {
      const videoId = item.id?.videoId;
      const snippet = item.snippet;
      if (!videoId || !snippet?.title) return [];
      const thumbnail = snippet.thumbnails?.high?.url ?? snippet.thumbnails?.medium?.url ?? snippet.thumbnails?.default?.url;
      return [{
        externalId: `youtube:${videoId}`,
        canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
        title: snippet.title,
        body: [snippet.description, snippet.channelTitle ? `YouTube channel: ${snippet.channelTitle}` : null].filter(Boolean).join("\n\n"),
        author: snippet.channelTitle ?? null,
        publishedAt: dateOrNull(snippet.publishedAt),
        language: relevanceLanguage,
        mediaLicense: details.get(videoId)?.status?.license ?? null,
        rawPayload: { ...item, thumbnail, videoDetails: details.get(videoId) ?? null },
      }];
    });
  },
};

function dateOrNull(value: string | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function fetchVideoDetails(ids: string[], apiKey: string) {
  if (!ids.length) return new Map<string, YouTubeVideo>();
  const params = new URLSearchParams({ part: "contentDetails,status,statistics", id: ids.join(","), key: apiKey });
  const response = await fetch(`https://www.googleapis.com/youtube/v3/videos?${params}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`YouTube Data API videos failed: ${response.status} ${await response.text()}`);
  const payload = await response.json() as { items?: YouTubeVideo[] };
  return new Map((payload.items ?? []).flatMap((item) => item.id ? [[item.id, item] as const] : []));
}
