import { execFile } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { MediaAssetStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const run = promisify(execFile);
const storageRoot = path.join(process.cwd(), "storage", "source-assets");

function commandError(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause);
}

async function downloadYoutubeVideo(sourceUrl: string, output: string) {
  const base = [
    "--no-playlist", "--no-progress", "--write-info-json", "--no-write-subs", "--no-write-auto-subs",
    "--socket-timeout", "60", "--retries", "5", "--fragment-retries", "5", "--retry-sleep", "2",
    "--extractor-args", "youtube:player_client=android_vr",
    "--merge-output-format", "mp4", "--no-continue", "-o", output,
  ];
  const attempts = [
    ["-f", "bv*[height>=720][ext=mp4]+ba[ext=m4a]/bv*[height>=720]+ba/b[height>=720]"],
    ["--impersonate", "Chrome-136:Macos-15", "-f", "137+140/136+140/398+251/b[height>=720]"],
  ];
  const errors: string[] = [];
  for (const flags of attempts) {
    try {
      await run("yt-dlp", [...base, ...flags, sourceUrl], {
        timeout: 15 * 60_000,
        maxBuffer: 2 * 1024 * 1024,
      });
      return;
    } catch (cause) {
      errors.push(commandError(cause));
    }
  }
  const joined = errors.join("\n");
  if (/HTTP Error 429|confirm you.re not a bot/i.test(joined)) {
    throw new Error("YouTube 当前出口 IP 被临时限流（429/人机验证）。任务已保留，请稍后重试或更换片源；不会降级成生图视频。");
  }
  if (/HTTP Error 403|Forbidden/i.test(joined)) {
    throw new Error("YouTube 拒绝了视频直链（403）。已自动尝试稳定播放客户端与浏览器指纹；请稍后重试或更换片源。");
  }
  throw new Error(errors.at(-1)?.slice(0, 4_000) ?? "YouTube 视频下载失败");
}

export async function ingestMediaAsset(assetId: string) {
  const asset = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: assetId } });
  const outputDir = path.join(storageRoot, asset.id);
  try {
    await mkdir(outputDir, { recursive: true });
    await prisma.mediaAsset.update({ where: { id: asset.id }, data: { status: MediaAssetStatus.DOWNLOADING, localDir: outputDir, error: null } });
    if (!isYoutubeUrl(asset.sourceUrl)) {
      await ingestDirectMedia(asset.id, asset.sourceUrl, outputDir);
      return;
    }
    const output = path.join(outputDir, "source-video.%(ext)s");
    // Video/audio are the required inputs. Subtitle endpoints are frequently rate-limited by
    // YouTube, so they are deliberately fetched afterwards as an optional enhancement.
    // Keep a hard 720p floor, but retry YouTube's short-lived CDN URLs with a
    // stable player client and a browser fingerprint before failing the task.
    await downloadYoutubeVideo(asset.sourceUrl, output);
    let files = await readdir(outputDir);
    const find = (pattern: RegExp) => files.find((file) => pattern.test(file));
    const video = find(/^source-video\.(mp4|mkv|webm)$/i);
    if (!video) throw new Error("yt-dlp did not produce a merged video file");
    const audioOutput = path.join(outputDir, "source-audio.wav");
    await run("ffmpeg", ["-y", "-i", path.join(outputDir, video), "-vn", "-acodec", "pcm_s16le", audioOutput], { timeout: 5 * 60_000, maxBuffer: 2 * 1024 * 1024 });
    files = await readdir(outputDir);
    const audio = files.find((file) => /^source-audio\.wav$/i.test(file));
    const info = find(/^source-video\.info\.json$/i);
    const rawMetadata = info ? JSON.parse(await readFile(path.join(outputDir, info), "utf8")) : null;
    const metadata = rawMetadata && typeof rawMetadata === "object" ? rawMetadata : null;
    if (!video || !audio) throw new Error("yt-dlp did not produce both video and WAV audio");
    await prisma.mediaAsset.update({
      where: { id: asset.id },
      data: {
        status: MediaAssetStatus.READY_FOR_ANALYSIS,
        videoPath: path.join(outputDir, video), audioPath: path.join(outputDir, audio), subtitlePath: null,
        transcript: null, metadata: metadata as Prisma.InputJsonValue,
      },
    });
    // Subtitle endpoints are unreliable and must never block the ready-to-analyze state.
    void attachOptionalSubtitles(asset.id, asset.sourceUrl, output, outputDir);
  } catch (cause) {
    const error = cause instanceof Error ? cause.message.slice(0, 4_000) : "Media ingestion failed";
    await prisma.mediaAsset.update({ where: { id: asset.id }, data: { status: MediaAssetStatus.FAILED, error } });
  }
}

function isYoutubeUrl(value: string) {
  try {
    const host = new URL(value).hostname.replace(/^www\./, "");
    return host === "youtube.com" || host === "youtu.be";
  } catch {
    return false;
  }
}

async function ingestDirectMedia(assetId: string, sourceUrl: string, outputDir: string) {
  const response = await fetch(sourceUrl, {
    headers: { "User-Agent": "Mozilla/5.0 TrendRadar/1.0" },
    redirect: "follow",
    signal: AbortSignal.timeout(2 * 60_000),
  });
  if (!response.ok) throw new Error(`官网下载失败（${response.status}）`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > 250 * 1024 * 1024)
    throw new Error("官网动态素材超过 250MB，已停止下载");
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  const extension = contentType.includes("gif")
    ? "gif"
    : contentType.includes("webm")
      ? "webm"
      : contentType.includes("quicktime")
        ? "mov"
        : "mp4";
  const original = path.join(outputDir, `official-source.${extension}`);
  const videoPath = path.join(outputDir, "source-video.mp4");
  const audioPath = path.join(outputDir, "source-audio.wav");
  await writeFile(original, bytes);
  await run(
    "ffmpeg",
    [
      "-hide_banner", "-loglevel", "error", "-nostats", "-y", "-i", original,
      "-vf", "fps=30,scale=trunc(iw/2)*2:trunc(ih/2)*2:flags=lanczos",
      "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", videoPath,
    ],
    { timeout: 10 * 60_000, maxBuffer: 2 * 1024 * 1024 },
  );
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", videoPath]);
  const seconds = Math.max(1, Number(stdout.trim()) || 1);
  await run(
    "ffmpeg",
    ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", `anullsrc=r=48000:cl=stereo`, "-t", String(seconds), "-c:a", "pcm_s16le", audioPath],
    { timeout: 5 * 60_000, maxBuffer: 1 * 1024 * 1024 },
  );
  await prisma.mediaAsset.update({
    where: { id: assetId },
    data: {
      status: MediaAssetStatus.READY_FOR_ANALYSIS,
      videoPath,
      audioPath,
      subtitlePath: null,
      transcript: null,
      metadata: { sourceKind: "official_dynamic_media", originalUrl: sourceUrl } as Prisma.InputJsonValue,
    },
  });
}

async function attachOptionalSubtitles(assetId: string, sourceUrl: string, output: string, outputDir: string) {
  const subtitleWarning = await downloadSubtitles(sourceUrl, output);
  const files = await readdir(outputDir);
  const subtitle = files.find((file) => /^source-video\..+\.srt$/i.test(file)) ?? files.find((file) => /^source-video\.srt$/i.test(file));
  const asset = await prisma.mediaAsset.findUnique({ where: { id: assetId }, select: { metadata: true } });
  const metadata = asset?.metadata && typeof asset.metadata === "object" && !Array.isArray(asset.metadata) ? { ...asset.metadata, ...(subtitleWarning ? { subtitleWarning } : {}) } : subtitleWarning ? { subtitleWarning } : null;
  await prisma.mediaAsset.update({ where: { id: assetId }, data: { subtitlePath: subtitle ? path.join(outputDir, subtitle) : null, transcript: subtitle ? await readFile(path.join(outputDir, subtitle), "utf8") : null, metadata: metadata as Prisma.InputJsonValue } });
}

async function downloadSubtitles(sourceUrl: string, output: string) {
  try {
    await run("yt-dlp", [
      "--no-playlist", "--no-progress", "--skip-download", "--write-subs", "--write-auto-subs", "--sub-langs", "en.*,zh.*", "--convert-subs", "srt", "--ignore-errors", "-o", output, sourceUrl,
    ], { timeout: 5 * 60_000, maxBuffer: 2 * 1024 * 1024 });
    return null;
  } catch (cause) {
    // A 429 subtitle response must never discard a successfully downloaded authorized video.
    const message = cause instanceof Error ? cause.message : "字幕下载失败";
    return message.slice(0, 1_000);
  }
}
