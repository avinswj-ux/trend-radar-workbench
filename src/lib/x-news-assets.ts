import { execFile } from "node:child_process";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { AssetRights, MediaAssetStatus, Prisma } from "@prisma/client";
import sharp from "sharp";
import { prisma } from "@/lib/prisma";
import { enrichXStatus } from "@/lib/sources/x-media";

const run = promisify(execFile);

export type XNewsImage = {
  sourceUrl: string;
  localPath: string;
  publicUrl: string;
  width: number;
  height: number;
};

export type XNewsPayload = {
  kind?: string;
  username?: string;
  statusId?: string;
  imageUrls?: string[];
  videoUrls?: string[];
  articleUrl?: string | null;
  body?: string;
  quote?: { author?: string | null; text?: string } | null;
};

const sourceMarker = (contentItemId: string) => `x-news:${contentItemId}`;

export function readXNewsPayload(payload: unknown): XNewsPayload {
  if (!payload || typeof payload !== "object") return {};
  return payload as XNewsPayload;
}

export async function attachXNewsAssets(contentItemId: string, imageUrls: string[], startIndex = 0) {
  const unique = [...new Set(imageUrls.filter(Boolean))].slice(0, Math.max(0, 16 - startIndex));
  if (!unique.length) return [] as XNewsImage[];

  const storageDir = path.join(process.cwd(), "storage", "x-news", contentItemId);
  const publicDir = path.join(process.cwd(), "public", "generated", "x-source", contentItemId);
  await mkdir(storageDir, { recursive: true });
  await mkdir(publicDir, { recursive: true });

  const images: XNewsImage[] = [];
  for (const [index, sourceUrl] of unique.entries()) {
    const downloaded = await downloadImage(sourceUrl, storageDir, publicDir, startIndex + index + 1);
    if (downloaded) images.push(downloaded);
  }
  if (!images.length) return [];

  const existing = await prisma.mediaAsset.findFirst({
    where: { contentItemId, sourceUrl: sourceMarker(contentItemId) },
    select: { id: true },
  });
  const author = (await prisma.contentItem.findUnique({
    where: { id: contentItemId },
    select: { author: true },
  }))?.author;
  const data = {
    contentItemId,
    sourceUrl: sourceMarker(contentItemId),
    rights: AssetRights.RESEARCH_ONLY,
    status: MediaAssetStatus.ANALYZED,
    localDir: storageDir,
    videoPath: images[0]?.localPath ?? null,
    metadata: {
      kind: "x-news-remix",
      credit: author ? `@${author}` : "x-news",
      images,
    } as Prisma.InputJsonValue,
    error: null,
  };
  if (existing) {
    await prisma.mediaAsset.update({ where: { id: existing.id }, data });
  } else {
    await prisma.mediaAsset.create({ data });
  }
  return images;
}

export async function enrichAndAttachXNewsAssets(contentItemId: string) {
  const item = await prisma.contentItem.findUnique({
    where: { id: contentItemId },
    include: { rawItem: { select: { id: true, payload: true } } },
  });
  if (!item) return [] as XNewsImage[];
  const payload = readXNewsPayload(item.rawItem?.payload);
  const extra = payload.statusId
    ? await enrichXStatus(payload.statusId)
    : { imageUrls: [], videoUrls: [], articleTitle: "", articleText: "" };
  const videoUrls = [...new Set([...(payload.videoUrls ?? []), ...extra.videoUrls])];
  const photos = [...new Set([...(payload.imageUrls ?? []), ...extra.imageUrls])]
    .filter((url) => !isVideoPoster(url) || !videoUrls.length)
    .slice(0, 16);
  const frames = videoUrls.length
    ? await extractVideoSlides(contentItemId, videoUrls)
    : [];
  const imageUrls = [...frames.map((frame) => frame.sourceUrl), ...photos].slice(0, 16);
  if (item.rawItem) {
    await prisma.rawItem.update({
      where: { id: item.rawItem.id },
      data: {
        payload: {
          ...payload,
          imageUrls,
          videoUrls,
          articleTitle: extra.articleTitle || payload.articleUrl,
          body: extra.articleText || payload.body,
        } as Prisma.InputJsonValue,
      },
    });
  }
  if (extra.articleText.replace(/\s+/g, "").length > (item.body ?? "").replace(/\s+/g, "").length) {
    await prisma.contentItem.update({
      where: { id: contentItemId },
      data: { body: extra.articleText, title: extra.articleTitle || item.title },
    });
  }
  const downloaded = await attachXNewsAssets(contentItemId, photos, frames.length);
  if (!frames.length) return downloaded;
  return mergeAttachedFrames(contentItemId, frames, downloaded);
}

export async function loadXNewsDraftContext(contentItemId: string) {
  const item = await prisma.contentItem.findUnique({
    where: { id: contentItemId },
    include: { rawItem: { select: { payload: true } } },
  });
  const payload = readXNewsPayload(item?.rawItem?.payload);
  const images = await loadXNewsImages(contentItemId);
  return {
    sourceImages: images.map((image) => image.publicUrl),
    imageFiles: images,
    quote: payload.quote ?? null,
    articleUrl: payload.articleUrl ?? null,
  };
}

export async function loadXNewsImages(contentItemId: string) {
  const asset = await prisma.mediaAsset.findFirst({
    where: { contentItemId, sourceUrl: sourceMarker(contentItemId) },
    orderBy: { updatedAt: "desc" },
  });
  const metadata = asset?.metadata as { images?: XNewsImage[] } | null;
  return Array.isArray(metadata?.images) ? metadata.images : [];
}

function isVideoPoster(url: string) {
  return /amplify_video_thumb|ext_tw_video_thumb|tweet_video_thumb|video_thumb/i.test(url);
}

async function extractVideoSlides(contentItemId: string, videoUrls: string[]) {
  const storageDir = path.join(process.cwd(), "storage", "x-news", contentItemId);
  const publicDir = path.join(process.cwd(), "public", "generated", "x-source", contentItemId);
  const slideDir = path.join(storageDir, "slides");
  await mkdir(storageDir, { recursive: true });
  await mkdir(publicDir, { recursive: true });
  await mkdir(slideDir, { recursive: true });

  const videoPath = path.join(storageDir, "source.mp4");
  const videoUrl = await downloadFirstVideo(videoUrls, videoPath);
  if (!videoUrl) return [] as XNewsImage[];

  const sceneFiles = await renderSlideFrames(videoPath, slideDir, "select='gt(scene,0.08)',scale=1080:-2");
  const files = sceneFiles.length >= 6
    ? sceneFiles
    : await renderSlideFrames(videoPath, slideDir, evenSampleFilter(videoPath));
  const images: XNewsImage[] = [];
  for (const [index, file] of files.slice(0, 16).entries()) {
    const image = await promoteSlide(file, storageDir, publicDir, index + 1, videoUrl);
    if (image) images.push(image);
  }
  return images;
}

async function downloadFirstVideo(videoUrls: string[], videoPath: string) {
  for (const videoUrl of videoUrls) {
    try {
      await run(
        "curl",
        ["-4", "-fL", "-C", "-", "--max-time", "180", "-A", "Mozilla/5.0 TrendRadar", "-o", videoPath, videoUrl],
        { timeout: 200_000 },
      );
      return videoUrl;
    } catch {
      // try a smaller render if the first file is too slow
    }
  }
  return "";
}

function evenSampleFilter(_videoPath: string) {
  return "fps=1/6,scale=1080:-2";
}

async function renderSlideFrames(videoPath: string, slideDir: string, videoFilter: string) {
  await run(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      videoPath,
      "-vf",
      videoFilter,
      "-vsync",
      "vfr",
      "-q:v",
      "3",
      path.join(slideDir, "slide-%02d.jpg"),
    ],
    { timeout: 120_000 },
  );
  const files = (await readdir(slideDir))
    .filter((name) => /^slide-\d+\.jpg$/i.test(name))
    .sort();
  return files.map((name) => path.join(slideDir, name));
}

async function promoteSlide(
  file: string,
  storageDir: string,
  publicDir: string,
  index: number,
  sourceUrl: string,
) {
  try {
    const image = sharp(file);
    const info = await image.metadata();
    if (!info.width || !info.height) return null;
    const filename = `${String(index).padStart(2, "0")}.jpg`;
    const localPath = path.join(storageDir, filename);
    const publicPath = path.join(publicDir, filename);
    const jpeg = await image.jpeg({ quality: 88 }).toBuffer();
    await writeFile(localPath, jpeg);
    await writeFile(publicPath, jpeg);
    return {
      sourceUrl: `${sourceUrl}#slide-${index}`,
      localPath,
      publicUrl: `/generated/x-source/${path.basename(publicDir)}/${filename}`,
      width: info.width,
      height: info.height,
    } satisfies XNewsImage;
  } catch {
    return null;
  }
}

async function mergeAttachedFrames(contentItemId: string, frames: XNewsImage[], photos: XNewsImage[]) {
  const images = [...frames, ...photos].slice(0, 16);
  const existing = await prisma.mediaAsset.findFirst({
    where: { contentItemId, sourceUrl: sourceMarker(contentItemId) },
    select: { id: true, metadata: true, localDir: true },
  });
  const author = (await prisma.contentItem.findUnique({
    where: { id: contentItemId },
    select: { author: true },
  }))?.author;
  const data = {
    contentItemId,
    sourceUrl: sourceMarker(contentItemId),
    rights: AssetRights.RESEARCH_ONLY,
    status: MediaAssetStatus.ANALYZED,
    localDir: existing?.localDir ?? path.join(process.cwd(), "storage", "x-news", contentItemId),
    videoPath: images[0]?.localPath ?? null,
    metadata: {
      kind: "x-news-remix",
      credit: author ? `@${author}` : "x-news",
      images,
      fromVideo: true,
    } as Prisma.InputJsonValue,
    error: null,
  };
  if (existing) await prisma.mediaAsset.update({ where: { id: existing.id }, data });
  else await prisma.mediaAsset.create({ data });
  return images;
}

async function downloadImage(sourceUrl: string, storageDir: string, publicDir: string, index: number) {
  const candidates = [sourceUrl];
  if (sourceUrl.includes("/pic/orig/")) candidates.push(sourceUrl.replace("/pic/orig/", "/pic/"));
  for (const url of candidates) {
    try {
      const tmpPath = path.join(storageDir, `.tmp-${index}`);
      await run(
        "curl",
        ["-fsSL", "--max-time", "25", "-A", "Mozilla/5.0 TrendRadar", "-o", tmpPath, url],
        { timeout: 30_000 },
      );
      const image = sharp(tmpPath);
      const info = await image.metadata();
      if (!info.width || !info.height) continue;
      const filename = `${String(index).padStart(2, "0")}.jpg`;
      const localPath = path.join(storageDir, filename);
      const publicPath = path.join(publicDir, filename);
      const jpeg = await image.jpeg({ quality: 88 }).toBuffer();
      await writeFile(localPath, jpeg);
      await writeFile(publicPath, jpeg);
      return {
        sourceUrl: url,
        localPath,
        publicUrl: `/generated/x-source/${path.basename(publicDir)}/${filename}`,
        width: info.width,
        height: info.height,
      } satisfies XNewsImage;
    } catch {
      // try the next candidate URL
    }
  }
  return null;
}
