import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export type VideoMotionAudit = {
  samples: number;
  averageDifference: number;
  activeRatio: number;
  suitable: boolean;
};

export async function auditVideoMotion(
  videoPath: string,
): Promise<VideoMotionAudit> {
  const [{ stdout }, { stdout: durationOutput }] = await Promise.all([
    run(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-t",
      "120",
      "-i",
      videoPath,
      "-vf",
      "fps=1,scale=160:-2,tblend=all_mode=difference,signalstats,metadata=print:file=-",
      "-an",
      "-f",
      "null",
      "-",
    ],
    { timeout: 3 * 60_000, maxBuffer: 4 * 1024 * 1024 },
    ),
    run("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=nw=1:nk=1",
      videoPath,
    ]),
  ]);
  const values = Array.from(
    stdout.matchAll(/lavfi\.signalstats\.YAVG=([0-9.]+)/g),
    (match) => Number(match[1]),
  ).filter(Number.isFinite);
  const averageDifference = values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0;
  const activeRatio = values.length
    ? values.filter((value) => value > 4).length / values.length
    : 0;
  const durationSeconds = Math.max(1, Number(durationOutput.trim()) || 1);
  // Source videos need a broad sample. Generated B-roll is intentionally 3–7s,
  // so requiring eight one-second differences would reject every valid clip.
  const minimumSamples =
    durationSeconds < 8 ? Math.max(2, Math.floor(durationSeconds) - 1) : 8;
  return {
    samples: values.length,
    averageDifference,
    activeRatio,
    suitable:
      values.length >= minimumSamples &&
      ((averageDifference >= 1.8 && activeRatio >= 0.12) ||
        (averageDifference >= 4 && activeRatio >= 0.08)),
  };
}

export async function assertUsableVideo(
  videoPath: string,
  label = "YouTube 素材",
) {
  const audit = await auditVideoMotion(videoPath);
  if (!audit.suitable) {
    throw new Error(
      `${label}动态画面不足（运动差异 ${audit.averageDifference.toFixed(2)}，有效动态占比 ${(audit.activeRatio * 100).toFixed(1)}%）。该素材接近单图缩放或静态幻灯片，已按固定规则淘汰，请更换产品操作、多镜头演示或更明显的动态图形。`,
    );
  }
  return audit;
}

export function suitabilityScoreFromAudit(audit: VideoMotionAudit) {
  if (!audit.suitable)
    return Math.max(
      0,
      Math.min(
        35,
        Math.round(audit.averageDifference * 8 + audit.activeRatio * 80),
      ),
    );
  return Math.max(
    55,
    Math.min(
      100,
      Math.round(
        55 +
          Math.max(0, audit.averageDifference - 1.8) * 5 +
          Math.max(0, audit.activeRatio - 0.12) * 80,
      ),
    ),
  );
}
