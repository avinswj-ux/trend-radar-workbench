import "server-only";

import { AssetRights, MediaAssetStatus } from "@prisma/client";
import { analyzeMediaAsset } from "@/lib/media-analysis";
import { ingestMediaAsset } from "@/lib/media-ingest";
import { prisma } from "@/lib/prisma";
import { matchYoutubeForTopic } from "@/lib/topic-youtube-match";

function decodeHtml(value: string) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&#x2F;", "/")
    .replaceAll("&quot;", '"');
}

function isSafePublicUrl(value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return (
      ["http:", "https:"].includes(url.protocol) &&
      host !== "localhost" &&
      host !== "127.0.0.1" &&
      !host.endsWith(".local") &&
      !/^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(host)
    );
  } catch {
    return false;
  }
}

async function officialDynamicUrls(pageUrl: string) {
  if (!isSafePublicUrl(pageUrl)) return [];
  const response = await fetch(pageUrl, {
    headers: { "User-Agent": "Mozilla/5.0 TrendRadar/1.0" },
    redirect: "follow",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) return [];
  const html = decodeHtml((await response.text()).slice(0, 5_000_000));
  const values = [
    ...Array.from(html.matchAll(/<(?:source|video)[^>]+src=["']([^"']+)["']/gi), (match) => match[1]),
    ...Array.from(html.matchAll(/<meta[^>]+(?:property|name)=["']og:video(?::url)?["'][^>]+content=["']([^"']+)["']/gi), (match) => match[1]),
    ...Array.from(html.matchAll(/https?:[^"'\s<>]+\.(?:mp4|webm|gif)(?:\?[^"'\s<>]*)?/gi), (match) => match[0]),
  ];
  return [...new Set(values.flatMap((value) => {
    try { return [new URL(value, response.url).toString()]; }
    catch { return []; }
  }))].filter(isSafePublicUrl).slice(0, 5);
}

async function tryAsset(
  contentItemId: string,
  sourceUrl: string,
  rights: AssetRights,
) {
  const asset = await prisma.mediaAsset.create({
    data: { contentItemId, sourceUrl, rights },
  });
  await ingestMediaAsset(asset.id);
  const downloaded = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: asset.id } });
  if (downloaded.status !== MediaAssetStatus.READY_FOR_ANALYSIS)
    throw new Error(downloaded.error || "动态素材下载失败");
  await analyzeMediaAsset(asset.id, { rewriteDraft: false });
  return prisma.mediaAsset.findUniqueOrThrow({ where: { id: asset.id } });
}

export async function ensureDynamicSource(contentItemId: string) {
  const existing = await prisma.mediaAsset.findFirst({
    where: { contentItemId, status: MediaAssetStatus.ANALYZED, videoPath: { not: null } },
    orderBy: { updatedAt: "desc" },
  });
  if (existing) return existing;
  const item = await prisma.contentItem.findUniqueOrThrow({
    where: { id: contentItemId },
    include: { source: true },
  });
  const errors: string[] = [];

  try {
    const matches = await matchYoutubeForTopic(contentItemId);
    for (const match of matches.filter((entry) => entry.matchScore >= 30)) {
      try {
        return await tryAsset(contentItemId, match.url, AssetRights.CC_BY);
      } catch (cause) {
        errors.push(`YouTube《${match.title}》：${cause instanceof Error ? cause.message : "失败"}`);
      }
    }
  } catch (cause) {
    errors.push(`YouTube 搜索：${cause instanceof Error ? cause.message : "失败"}`);
  }

  try {
    for (const url of await officialDynamicUrls(item.canonicalUrl)) {
      try {
        return await tryAsset(contentItemId, url, AssetRights.RESEARCH_ONLY);
      } catch (cause) {
        errors.push(`官网动态素材：${cause instanceof Error ? cause.message : "失败"}`);
      }
    }
  } catch (cause) {
    errors.push(`官网/GitHub 搜索：${cause instanceof Error ? cause.message : "失败"}`);
  }
  return { fallback: "MOTION_GRAPHICS" as const, errors: errors.slice(-5) };
}
