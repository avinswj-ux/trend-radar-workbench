import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import { prisma } from "@/lib/prisma";
import {
  chooseFishyAction,
  fishyActions,
  varyAvatarActions,
  type FishyAction,
} from "@/lib/avatar/fishy";
import { assertUsableVideo } from "@/lib/video-policy";
import { missingNarrationScenes, narrationScenes } from "@/lib/narration-generation";
import { generateMotionGraphicSceneVideos } from "@/lib/motion-graphic-scenes";
import { hasCompleteEvidenceMap } from "@/lib/evidence-map";
import {
  collectGithubEvidenceAssets,
  isPreferredOfficialShot,
  type OfficialEvidenceAsset,
} from "@/lib/github-evidence-assets";
import { OFFICIAL_EVIDENCE_VISUAL_POLICY } from "@/lib/video-policy-config";
import { loadXNewsImages } from "@/lib/x-news-assets";
import { pickSceneImage, renderXNewsSceneFrames } from "@/lib/x-news-scene-graphics";

const run = promisify(execFile);
function resolveAvatarRoot() {
  const roots = [
    process.env.FISHY_ASSETS_DIR,
    "/Users/apple/Desktop/Avin口播素材包",
    "/Users/apple/Desktop/Fishy口播素材包",
  ].filter((value): value is string => Boolean(value));
  const found = roots.find((root) =>
    existsSync(path.join(root, fishyActions.IDLE.asset)),
  );
  if (!found)
    throw new Error("找不到 Avin 透明口播素材，请检查 FISHY_ASSETS_DIR");
  return found;
}

type Scene = {
  scene?: number;
  visual?: string;
  narration?: string;
  onScreenText?: string;
  avatarAction?: FishyAction;
  claim?: string;
  evidenceType?: string;
  evidenceRequirement?: string;
};
type SourceShot = { startSeconds?: number; endSeconds?: number };

const escapeXml = (text: string) =>
  text.replace(
    /[<>&'\"]/g,
    (c) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        "'": "&apos;",
        '"': "&quot;",
      })[c] ?? c,
  );

function wrapText(text: string, limit: number, maxLines = 2) {
  const rows: string[] = [];
  let row = "";
  let width = 0;
  for (const character of text.trim()) {
    const weight = /[\u2E80-\u9FFF]/.test(character) ? 2 : 1;
    if (width + weight > limit && row) {
      rows.push(row);
      row = character;
      width = weight;
      if (rows.length === maxLines - 1) break;
    } else {
      row += character;
      width += weight;
    }
  }
  if (row && rows.length < maxLines) rows.push(row);
  return rows;
}

function subtitleChunks(text: string, maxCharacters = 22) {
  const cleaned = text.replace(/\s+/g, "").trim();
  const sentences = cleaned
    .split(/(?<=[。！？!?])/u)
    .map((item) => item.trim())
    .filter(Boolean);
  const chunks: string[] = [];
  for (const sentence of sentences) {
    if (sentence.length <= maxCharacters) {
      chunks.push(sentence);
      continue;
    }
    const parts = sentence.split(/(?<=[，；;,])/u).filter(Boolean);
    let buffer = "";
    for (const part of parts) {
      if ((buffer + part).length <= maxCharacters) buffer += part;
      else {
        if (buffer) chunks.push(buffer);
        buffer = part;
      }
    }
    if (buffer) chunks.push(buffer);
  }
  return chunks.length ? chunks : [cleaned || text];
}

async function duration(file: string) {
  const { stdout } = await run("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=nw=1:nk=1",
    file,
  ]);
  return Math.max(1, Number(stdout.trim()) || 1);
}

async function dimensions(file: string) {
  const { stdout } = await run("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height",
    "-of",
    "csv=p=0:s=x",
    file,
  ]);
  const [width, height] = stdout.trim().split("x").map(Number);
  return { width, height };
}

async function isRealVideo(file: string) {
  const sampleSeconds = Math.min(60, await duration(file));
  const { stderr } = await run(
    "ffmpeg",
    [
      "-t",
      String(sampleSeconds),
      "-i",
      file,
      "-vf",
      "freezedetect=n=-42dB:d=3",
      "-an",
      "-f",
      "null",
      "-",
    ],
    { timeout: 3 * 60_000, maxBuffer: 4 * 1024 * 1024 },
  );
  const startsAtZero = /freeze_start:\s*0(?:\.0+)?(?:\s|$)/.test(stderr);
  const hasFreezeEnd = /freeze_end:/.test(stderr);
  return !(startsAtZero && !hasFreezeEnd);
}

async function createDynamicMontage(
  files: string[],
  seconds: number[],
  workDir: string,
) {
  if (files.length !== seconds.length)
    throw new Error("动态镜头数量与口播分镜不一致，已停止渲染");
  const concat = ["ffconcat version 1.0"];
  for (let index = 0; index < files.length; index += 1) {
    const clip = path.join(
      workDir,
      `dynamic-${String(index + 1).padStart(2, "0")}.mp4`,
    );
    await run(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostats",
        "-y",
        "-stream_loop",
        "-1",
        "-i",
        files[index],
        "-t",
        String(seconds[index]),
        "-an",
        "-vf",
        "fps=30,scale=1280:720:force_original_aspect_ratio=increase:flags=lanczos,crop=1280:720,format=yuv420p",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "18",
        clip,
      ],
      { timeout: 10 * 60_000, maxBuffer: 2 * 1024 * 1024 },
    );
    concat.push(`file '${clip.replaceAll("'", "'\\''")}'`);
  }
  const concatFile = path.join(workDir, "dynamic.ffconcat");
  const output = path.join(workDir, "dynamic-storyboard.mp4");
  await writeFile(concatFile, `${concat.join("\n")}\n`);
  await run(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-nostats",
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      concatFile,
      "-c",
      "copy",
      output,
    ],
    { timeout: 10 * 60_000, maxBuffer: 2 * 1024 * 1024 },
  );
  await assertUsableVideo(output, "无源片动态合成结果");
  return output;
}

type EvidenceShot = {
  asset: OfficialEvidenceAsset;
  seconds: number;
  focusX: number;
  focusY: number;
};

function sceneSearchText(scene: Scene) {
  return [
    scene.visual,
    scene.narration,
    scene.claim,
    scene.evidenceRequirement,
    scene.evidenceType,
    scene.onScreenText,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function sceneNeedles(scene: Scene) {
  const text = sceneSearchText(scene);
  const needles: string[] = [];
  const add = (...items: string[]) =>
    items.forEach((item) => {
      if (!needles.includes(item)) needles.push(item);
    });
  if (/clone|克隆|声线|样本|3秒|三秒/.test(text)) add("clone", "studio");
  if (/dub|配音|转写|transcri|有声书|audiobook/.test(text))
    add("dub", "launchpad");
  if (/tts|asr|引擎|engine|catalogue|十六|十一|16种|11种/.test(text))
    add("engine", "catalogue");
  if (/内存|磁盘|门槛|8gb|10gb|cpu|限制|硬件|system|settings/.test(text))
    add("settings", "limit", "readme");
  if (scene.evidenceType === "LIMIT_PROOF") add("settings", "limit", "readme");
  if (/启动|launch|工作台|流水线|全景|录十遍|痛点/.test(text))
    add("launchpad", "preview");
  if (scene.evidenceType === "AVIN_COMMENTARY") add("launchpad", "preview");
  if (scene.evidenceType === "PRODUCT_UI") add("studio", "dub", "clone");
  if (!needles.length) add("launchpad", "studio", "preview");
  return needles;
}

function focusForAsset(file: string) {
  const name = file.replaceAll("\\", "/").toLowerCase();
  if (name.includes("clone")) return { focusX: 0.58, focusY: 0.1 };
  if (name.includes("studio")) return { focusX: 0.32, focusY: 0.16 };
  if (name.includes("dub")) return { focusX: 0.06, focusY: 0.08 };
  if (name.includes("engine") || name.includes("catalogue"))
    return { focusX: 0.2, focusY: 0.1 };
  if (name.includes("launchpad") || name.includes("preview"))
    return { focusX: 0.16, focusY: 0.08 };
  if (name.includes("settings") || name.includes("limit"))
    return { focusX: 0.26, focusY: 0.42 };
  if (name.includes("gallery")) return { focusX: 0.12, focusY: 0.12 };
  return { focusX: 0.14, focusY: 0.1 };
}

function scoreAssetForScene(
  asset: OfficialEvidenceAsset,
  needles: string[],
  used: Set<string>,
) {
  const name = asset.path.replaceAll("\\", "/").toLowerCase();
  let score = asset.score;
  if (isPreferredOfficialShot(asset.path)) score += 80;
  for (const needle of needles) {
    if (name.includes(needle)) score += 90;
  }
  if (used.has(asset.path)) score -= 55;
  return score;
}

function pickUnused(
  ranked: OfficialEvidenceAsset[],
  used: Set<string>,
) {
  return ranked.find((asset) => !used.has(asset.path)) ?? ranked[0];
}

async function createLimitProofCard(workDir: string) {
  const svg = `<svg width="1280" height="720" xmlns="http://www.w3.org/2000/svg">
    <rect width="1280" height="720" fill="#080b10"/>
    <text x="80" y="120" fill="#9ca3af" font-family="PingFang SC,sans-serif" font-size="28" font-weight="700">官方 System Requirements</text>
    <text x="80" y="280" fill="#ffe53a" font-family="PingFang SC,sans-serif" font-size="92" font-weight="900">8 GB</text>
    <text x="80" y="340" fill="#f3f4f6" font-family="PingFang SC,sans-serif" font-size="36" font-weight="700">最低内存</text>
    <text x="500" y="280" fill="#ffe53a" font-family="PingFang SC,sans-serif" font-size="92" font-weight="900">10 GB</text>
    <text x="500" y="340" fill="#f3f4f6" font-family="PingFang SC,sans-serif" font-size="36" font-weight="700">磁盘空间</text>
    <text x="80" y="500" fill="#ffe53a" font-family="PingFang SC,sans-serif" font-size="64" font-weight="900">CPU 能跑，只是更慢</text>
    <text x="80" y="640" fill="#6b7280" font-family="PingFang SC,sans-serif" font-size="24">来源：README System Requirements · 非实测数据</text>
  </svg>`;
  const file = path.join(workDir, "limit-proof-readme.png");
  await sharp(Buffer.from(svg)).png().toFile(file);
  return { path: file, kind: "IMAGE" as const, score: 240 };
}

function planOfficialEvidenceShots(
  assets: OfficialEvidenceAsset[],
  scenes: Scene[],
  sceneSeconds: number[],
) {
  const preferred = assets.filter(
    (asset) =>
      isPreferredOfficialShot(asset.path) || /limit-proof/.test(asset.path),
  );
  const pool = preferred.length >= 5 ? preferred : assets;
  const used = new Set<string>();
  const shots: EvidenceShot[] = [];
  scenes.forEach((scene, sceneIndex) => {
    const seconds = sceneSeconds[sceneIndex] ?? 4;
    const needles = sceneNeedles(scene);
    const ranked = [...pool]
      .map((asset) => ({
        asset,
        score: scoreAssetForScene(asset, needles, used),
      }))
      .sort((left, right) => right.score - left.score)
      .map((item) => item.asset);
    const split =
      seconds >= 5.2 &&
      ranked.length > 1 &&
      shots.length < OFFICIAL_EVIDENCE_VISUAL_POLICY.maxShotCount - 1;
    if (split) {
      const first = pickUnused(ranked, used);
      used.add(first.path);
      const second = pickUnused(ranked, used);
      used.add(second.path);
      const firstSeconds = Number((seconds * 0.48).toFixed(3));
      shots.push(
        { asset: first, seconds: firstSeconds, ...focusForAsset(first.path) },
        {
          asset: second,
          seconds: Number((seconds - firstSeconds).toFixed(3)),
          ...focusForAsset(second.path),
        },
      );
    } else {
      const chosen = pickUnused(ranked, used);
      used.add(chosen.path);
      shots.push({
        asset: chosen,
        seconds,
        ...focusForAsset(chosen.path),
      });
    }
  });
  return shots;
}

function stillEvidenceFilter() {
  return [
    "scale=1280:720:force_original_aspect_ratio=increase:flags=lanczos",
    "crop=1280:720",
    "fps=30",
    "format=yuv420p",
  ].join(",");
}

function evidenceMotionFilter(shot: EvidenceShot) {
  // Locked camera: user asked to stop pan/Ken Burns. Still full-bleed crop only.
  if (/limit-proof/.test(shot.asset.path)) {
    return [
      "scale=1280:720:force_original_aspect_ratio=decrease:flags=lanczos",
      "pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=0x080b10",
      "fps=30",
      "format=yuv420p",
    ].join(",");
  }
  return stillEvidenceFilter();
}

async function createOfficialEvidenceMontage(
  assets: OfficialEvidenceAsset[],
  scenes: Scene[],
  sceneSeconds: number[],
  workDir: string,
) {
  const pool = [...assets];
  if (scenes.some((scene) => scene.evidenceType === "LIMIT_PROOF")) {
    pool.unshift(await createLimitProofCard(workDir));
  }
  const distinct = [...new Set(pool.map((asset) => asset.path))];
  if (distinct.length < 5)
    throw new Error("官方真实素材不足 5 个，未达到成片质量门槛");
  const shots = planOfficialEvidenceShots(pool, scenes, sceneSeconds);
  return encodeEvidenceShots(shots, workDir, "official-evidence");
}

function planXNewsImageShots(
  images: OfficialEvidenceAsset[],
  scenes: Scene[],
  sceneSeconds: number[],
) {
  const shots: EvidenceShot[] = [];
  const used = new Set<string>();
  scenes.forEach((scene, sceneIndex) => {
    const seconds = sceneSeconds[sceneIndex] ?? 4;
    const chosen = pickSceneImage(images, scene, used) ?? images[0];
    used.add(chosen.path);
    shots.push({
      asset: chosen,
      seconds,
      focusX: 0.5,
      focusY: 0.5,
    });
  });
  return shots;
}

async function createXNewsImageMontage(
  images: OfficialEvidenceAsset[],
  scenes: Scene[],
  sceneSeconds: number[],
  workDir: string,
) {
  const base = planXNewsImageShots(images, scenes, sceneSeconds);
  const annotated: EvidenceShot[] = [];
  for (const [index, shot] of base.entries()) {
    const frames = await renderXNewsSceneFrames(
      shot.asset.path,
      scenes[index] ?? {},
      workDir,
      index,
      shot.seconds,
    );
    for (const frame of frames) {
      if (frame.seconds < 0.2) continue;
      annotated.push({
        ...shot,
        asset: { ...shot.asset, path: frame.path },
        seconds: frame.seconds,
      });
    }
  }
  return encodeEvidenceShots(annotated, workDir, "x-news-evidence");
}

async function encodeEvidenceShots(
  shots: EvidenceShot[],
  workDir: string,
  basename: string,
) {
  await writeFile(
    path.join(workDir, "evidence-plan.json"),
    JSON.stringify(
      shots.map((shot) => ({
        file: path.basename(shot.asset.path),
        seconds: shot.seconds,
        focusX: shot.focusX,
        focusY: shot.focusY,
      })),
      null,
      2,
    ),
  );
  const concat = ["ffconcat version 1.0"];
  for (const [index, shot] of shots.entries()) {
    const clip = path.join(
      workDir,
      `evidence-${String(index + 1).padStart(2, "0")}.mp4`,
    );
    const args = shot.asset.kind === "IMAGE"
      ? ["-loop", "1", "-i", shot.asset.path]
      : ["-stream_loop", "-1", "-i", shot.asset.path];
    await run(
      "ffmpeg",
      [
        "-hide_banner", "-loglevel", "error", "-nostats", "-y",
        ...args,
        "-t", String(shot.seconds), "-an", "-vf", basename === "x-news-evidence" ? stillEvidenceFilter() : evidenceMotionFilter(shot),
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", clip,
      ],
      { timeout: 10 * 60_000, maxBuffer: 2 * 1024 * 1024 },
    );
    concat.push(`file '${clip.replaceAll("'", "'\\''")}'`);
  }
  const concatFile = path.join(workDir, `${basename}.ffconcat`);
  const output = path.join(workDir, `${basename}.mp4`);
  await writeFile(concatFile, `${concat.join("\n")}\n`);
  await run(
    "ffmpeg",
    [
      "-hide_banner", "-loglevel", "error", "-nostats", "-y",
      "-f", "concat", "-safe", "0", "-i", concatFile,
      "-c", "copy", output,
    ],
    { timeout: 10 * 60_000, maxBuffer: 2 * 1024 * 1024 },
  );
  await assertUsableVideo(output, basename === "x-news-evidence" ? "卡兹克原图蒙太奇" : "官方证据素材蒙太奇");
  return { output, beatCount: shots.length, realMaterialCoverage: 1 };
}

function sourceShots(value: unknown): SourceShot[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const payload = value as { shotList?: unknown; selectedClips?: unknown };
  if (Array.isArray(payload.shotList)) {
    return payload.shotList.filter((shot): shot is SourceShot =>
      Boolean(
        shot &&
          typeof shot === "object" &&
          Number.isFinite(Number((shot as SourceShot).startSeconds)),
      ),
    );
  }
  if (Array.isArray(payload.selectedClips)) {
    return payload.selectedClips.flatMap((raw) => {
      if (!raw || typeof raw !== "object") return [];
      const clip = raw as { start?: unknown; duration?: unknown };
      const startSeconds = Number(clip.start);
      const durationSeconds = Number(clip.duration);
      if (!Number.isFinite(startSeconds)) return [];
      return [
        {
          startSeconds,
          endSeconds:
            startSeconds +
            (Number.isFinite(durationSeconds) ? durationSeconds : 8),
        },
      ];
    });
  }
  return [];
}

async function createSourceMontage(
  source: string,
  shots: SourceShot[],
  seconds: number[],
  workDir: string,
) {
  if (!shots.length)
    throw new Error("YouTube 拉片结果没有可用时间码，不能生成真实视频切片");
  const concat = ["ffconcat version 1.0"];
  for (let index = 0; index < seconds.length; index += 1) {
    const shot = shots[index % shots.length];
    const start = Math.max(0, Number(shot.startSeconds) || 0);
    const clip = path.join(
      workDir,
      `source-cut-${String(index + 1).padStart(2, "0")}.mp4`,
    );
    await run(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostats",
        "-y",
        "-ss",
        String(start),
        "-i",
        source,
        "-t",
        String(seconds[index]),
        "-an",
        "-vf",
        "fps=30,scale=1280:720:force_original_aspect_ratio=increase:flags=lanczos,crop=1280:720,format=yuv420p",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "18",
        clip,
      ],
      { timeout: 10 * 60_000, maxBuffer: 2 * 1024 * 1024 },
    );
    concat.push(`file '${clip.replaceAll("'", "'\\''")}'`);
  }
  const concatFile = path.join(workDir, "source-cuts.ffconcat");
  const output = path.join(workDir, "source-montage.mp4");
  await writeFile(concatFile, `${concat.join("\n")}\n`);
  await run(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-nostats",
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      concatFile,
      "-c",
      "copy",
      output,
    ],
    { timeout: 10 * 60_000, maxBuffer: 2 * 1024 * 1024 },
  );
  return output;
}

async function createAvatarMontage(
  scenes: Scene[],
  seconds: number[],
  workDir: string,
) {
  const root = resolveAvatarRoot();
  const varied = varyAvatarActions(
    seconds.map((_, index) => ({
      scene: index + 1,
      narration: scenes[index]?.narration,
      onScreenText: scenes[index]?.onScreenText,
      avatarAction: scenes[index]?.avatarAction,
    })),
  );
  const concat = ["ffconcat version 1.0"];
  for (let index = 0; index < seconds.length; index += 1) {
    const action = varied[index]?.avatarAction ?? chooseFishyAction(index + 1, scenes[index]?.narration ?? "");
    const definition = fishyActions[action];
    const asset = path.join(root, definition.asset);
    if (!existsSync(asset))
      throw new Error(`Avin 动作素材不存在：${definition.asset}`);
    const clip = path.join(
      workDir,
      `avatar-${String(index + 1).padStart(2, "0")}.mov`,
    );
    const isIntro = index === 0;
    const isOutro = index === seconds.length - 1;
    const avatarHeight = isIntro ? 560 : isOutro ? 250 : 188;
    const padX = isIntro ? "(ow-iw)/2-90" : "ow-iw-22";
    const padY = isIntro ? "(oh-ih)/2+16" : "oh-ih-102";
    const key = definition.chromaKey ? "chromakey=0x0000FF:0.24:0.08," : "";
    const filters = `fps=30,${key}scale=-2:${avatarHeight}:flags=lanczos,pad=1280:720:${padX}:${padY}:color=black@0,format=argb`;
    await run(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostats",
        "-y",
        "-stream_loop",
        "-1",
        "-i",
        asset,
        "-t",
        String(seconds[index]),
        "-an",
        "-vf",
        filters,
        "-c:v",
        "qtrle",
        clip,
      ],
      { timeout: 10 * 60_000, maxBuffer: 2 * 1024 * 1024 },
    );
    concat.push(`file '${clip.replaceAll("'", "'\\''")}'`);
  }
  const concatFile = path.join(workDir, "avatar.ffconcat");
  const output = path.join(workDir, "avatar-track.mov");
  await writeFile(concatFile, `${concat.join("\n")}\n`);
  await run(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-nostats",
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      concatFile,
      "-c",
      "copy",
      output,
    ],
    { timeout: 10 * 60_000, maxBuffer: 2 * 1024 * 1024 },
  );
  return output;
}

function overlaySvg(_title: string, subtitle: string) {
  const display = subtitle.replace(/[。！？!?]+$/u, "");
  const subtitleRows = wrapText(display, 44, 2);
  const startY = subtitleRows.length === 1 ? 668 : 624;
  const subtitleText = subtitleRows
    .map(
      (row, index) =>
        `<text x="640" y="${startY + index * 54}" text-anchor="middle" font-family="PingFang SC,sans-serif" font-size="50" font-weight="900" fill="#ffe53a" stroke="#050505" stroke-opacity=".98" stroke-width="10" stroke-linejoin="round" paint-order="stroke">${escapeXml(row)}</text>`,
    )
    .join("");
  return Buffer.from(
    `<svg width="1280" height="720" xmlns="http://www.w3.org/2000/svg"><text x="28" y="42" font-family="PingFang SC,sans-serif" font-size="22" font-weight="800" fill="#fff" stroke="#050505" stroke-width="5" stroke-linejoin="round" paint-order="stroke">*纯干货分享，不存在站外引流</text>${subtitleText}</svg>`,
  );
}

export async function renderDraftVideo(renderId: string) {
  try {
    const claimed = await prisma.videoRender.updateMany({
      where: { id: renderId, status: "QUEUED" },
      data: { status: "RENDERING", progress: 5, error: null },
    });
    if (!claimed.count) return;
    const job = await prisma.videoRender.findUniqueOrThrow({
      where: { id: renderId },
      include: {
        draft: {
          include: {
            publishReview: true,
            narrationClips: { orderBy: { scene: "asc" } },
            contentItem: {
              include: {
                source: true,
                mediaAssets: { orderBy: { updatedAt: "desc" }, take: 10 },
              },
            },
          },
        },
      },
    });
    const draft = job.draft;
    if (draft.platform !== "DOUYIN")
      throw new Error("一键成片当前只用于抖音视频稿");
    if (draft.publishReview?.status !== "PASSED")
      throw new Error("发布前审查通过后才能生成视频");
    if (!hasCompleteEvidenceMap(draft.storyboard))
      throw new Error("分镜缺少“口播观点—证据画面”映射，已禁止生成无证据成片");
    const scenes = (
      Array.isArray(draft.storyboard) ? draft.storyboard : []
    ) as Scene[];
    const expectedScenes = narrationScenes(draft.storyboard);
    const missingScenes = missingNarrationScenes(
      draft.storyboard,
      draft.narrationClips,
    );
    if (!scenes.length || missingScenes.length) {
      throw new Error(
        `TTS 旁白不完整，缺少抖音分镜：${missingScenes.map((scene) => scene.scene).join("、") || "全部"}`,
      );
    }
    const narrationClips = expectedScenes.map((scene) =>
      draft.narrationClips.find((clip) => clip.scene === scene.scene),
    );
    if (narrationClips.some((clip) => !clip))
      throw new Error("TTS 旁白场次与抖音分镜不匹配，请重新生成旁白");
    const latestAsset = draft.contentItem.mediaAssets[0];
    const asset = draft.contentItem.mediaAssets.find(
      (item) =>
        item.status === "ANALYZED" &&
        Boolean(item.videoPath) &&
        !String(item.sourceUrl).startsWith("x-news:"),
    );
    if (
      draft.contentItem.source.type === "YOUTUBE" &&
      (!asset || asset.status !== "ANALYZED" || !asset.videoPath)
    ) {
      const state =
        latestAsset?.status === "DOWNLOADING"
          ? "素材仍在下载"
          : latestAsset?.status === "READY_FOR_ANALYSIS"
            ? "素材待视觉理解与拉片"
            : latestAsset?.status === "ANALYZING"
              ? "素材正在拉片"
              : latestAsset?.status === "FAILED"
                ? `素材处理失败：${latestAsset.error ?? "未知错误"}`
                : "尚未拉取视频素材";
      throw new Error(
        `这是 YouTube 视频选题，必须使用原视频切片，不自动改成生图模式；${state}`,
      );
    }
    let inputVideo: string | null = null;
    let visualMode = "MOTION_GRAPHICS";
    if (asset?.videoPath && draft.contentItem.source.type !== "X_BOOKMARK") {
      if (draft.contentItem.source.type === "YOUTUBE")
        await assertUsableVideo(asset.videoPath);
      const candidateSize = await dimensions(asset.videoPath);
      if (
        (candidateSize.width >= 720 || candidateSize.height >= 720) &&
        (await isRealVideo(asset.videoPath))
      ) {
        inputVideo = asset.videoPath;
        visualMode = "SOURCE_VIDEO";
      }
    }

    const outputDir = path.join(
      process.cwd(),
      "public",
      "generated",
      "videos",
      draft.id,
    );
    const workDir = path.join(
      process.cwd(),
      "storage",
      "video-renders",
      draft.id,
    );
    await mkdir(outputDir, { recursive: true });
    await mkdir(workDir, { recursive: true });
    const audioConcat = ["ffconcat version 1.0"];
    const overlayConcat = ["ffconcat version 1.0"];
    let overlayIndex = 0;
    let lastOverlay = "";
    let total = 0;
    const sceneSeconds: number[] = [];
    for (const [index, clip] of narrationClips.entries()) {
      if (!clip) continue;
      const audioPath = path.join(
        process.cwd(),
        "public",
        clip.audioUrl.replace(/^\//, ""),
      );
      const seconds = await duration(audioPath);
      total += seconds;
      sceneSeconds.push(seconds);
      audioConcat.push(`file '${audioPath.replaceAll("'", "'\\''")}'`);
      const scene =
        scenes.find((item) => Number(item.scene) === clip.scene) ??
        scenes[index];
      const chunks = subtitleChunks(clip.text);
      const characters = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      let assigned = 0;
      for (const [chunkIndex, chunk] of chunks.entries()) {
        overlayIndex += 1;
        const png = path.join(
          workDir,
          `overlay-${String(overlayIndex).padStart(2, "0")}.png`,
        );
        await sharp(overlaySvg(draft.title, chunk)).png().toFile(png);
        const chunkSeconds = chunkIndex === chunks.length - 1
          ? Math.max(0.08, seconds - assigned)
          : seconds * (chunk.length / Math.max(1, characters));
        assigned += chunkSeconds;
        overlayConcat.push(
          `file '${png.replaceAll("'", "'\\''")}'`,
          `duration ${chunkSeconds.toFixed(3)}`,
        );
        lastOverlay = png;
      }
    }
    overlayConcat.push(`file '${lastOverlay.replaceAll("'", "'\\''")}'`);
    await writeFile(
      path.join(workDir, "audio.ffconcat"),
      `${audioConcat.join("\n")}\n`,
    );
    await writeFile(
      path.join(workDir, "overlays.ffconcat"),
      `${overlayConcat.join("\n")}\n`,
    );
    await prisma.videoRender.update({
      where: { id: renderId },
      data: { progress: 30 },
    });

    const voice = path.join(workDir, "voice.wav");
    const overlays = path.join(workDir, "overlays.mov");
    await run(
      "ffmpeg",
      [
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        path.join(workDir, "audio.ffconcat"),
        "-ar",
        "48000",
        "-ac",
        "2",
        voice,
      ],
      { timeout: 10 * 60_000, maxBuffer: 4 * 1024 * 1024 },
    );
    await run(
      "ffmpeg",
      [
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        path.join(workDir, "overlays.ffconcat"),
        "-vf",
        "fps=30,format=argb",
        "-t",
        String(total),
        "-c:v",
        "qtrle",
        overlays,
      ],
      { timeout: 10 * 60_000, maxBuffer: 4 * 1024 * 1024 },
    );
    if (visualMode === "SOURCE_VIDEO" && asset?.videoPath) {
      inputVideo = await createSourceMontage(
        asset.videoPath,
        sourceShots(asset.shotList),
        sceneSeconds,
        workDir,
      );
      await assertUsableVideo(inputVideo, "拉片结果");
    }
    if (!inputVideo && draft.contentItem.source.type === "GITHUB") {
      await prisma.videoRender.update({
        where: { id: renderId },
        data: { progress: 40, visualMode: "OFFICIAL_EVIDENCE" },
      });
      const officialAssets = await collectGithubEvidenceAssets(
        draft.contentItem.canonicalUrl,
      );
      const evidence = await createOfficialEvidenceMontage(
        officialAssets,
        scenes,
        sceneSeconds,
        workDir,
      );
      inputVideo = evidence.output;
      visualMode = "OFFICIAL_EVIDENCE";
    }
    if (!inputVideo && draft.contentItem.source.type === "X_BOOKMARK") {
      const xNewsImages = (await loadXNewsImages(draft.contentItem.id))
        .filter((image) => existsSync(image.localPath))
        .map((image, index) => ({
          path: image.localPath,
          kind: "IMAGE" as const,
          score: 120 - index,
        }));
      if (xNewsImages.length) {
        await prisma.videoRender.update({
          where: { id: renderId },
          data: { progress: 40, visualMode: "X_NEWS_EVIDENCE" },
        });
        const evidence = await createXNewsImageMontage(
          xNewsImages,
          scenes,
          sceneSeconds,
          workDir,
        );
        inputVideo = evidence.output;
        visualMode = "X_NEWS_EVIDENCE";
      }
    }
    if (!inputVideo) {
      await prisma.videoRender.update({
        where: { id: renderId },
        data: { progress: 42, visualMode },
      });
      const dynamic = await generateMotionGraphicSceneVideos(
        draft.id,
        draft.title,
        scenes,
      );
      inputVideo = await createDynamicMontage(
        dynamic.files,
        sceneSeconds,
        workDir,
      );
    }
    await prisma.videoRender.update({
      where: { id: renderId },
      data: { progress: 60, visualMode },
    });

    const output = path.join(outputDir, "final.mp4");
    const avatarPath = await createAvatarMontage(scenes, sceneSeconds, workDir);
    const introSeconds = Math.min(2.4, sceneSeconds[0] ?? 2.4);
    const previewBgm = [
      path.join(process.cwd(), "storage", "bgm", "licensed-bed.mp3"),
      path.join(process.cwd(), "storage", "bgm", "licensed-bed.wav"),
    ].find((file) => existsSync(file));
    const audioFilter = previewBgm
      ? "[3:a]highpass=f=75,equalizer=f=2600:t=q:w=1.1:g=1.6[voice];[4:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,loudnorm=I=-18:TP=-2:LRA=8,volume=0.2,lowpass=f=6500[bgm];[voice][bgm]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,loudnorm=I=-14:TP=-1.2:LRA=8[a]"
      : "[3:a]highpass=f=75,equalizer=f=2600:t=q:w=1.1:g=2.2,loudnorm=I=-14:TP=-1.2:LRA=7[a]";
    const filter = [
      "[0:v]fps=30,scale=1280:720:force_original_aspect_ratio=increase:flags=lanczos,crop=1280:720,eq=contrast=1.03:saturation=1.02[raw]",
      "[raw]split[r1][r2]",
      "[r1]eq=brightness=-0.45:saturation=0.45[dark]",
      `[dark][r2]overlay=0:0:enable='gte(t,${introSeconds.toFixed(3)})'[base]`,
      "[1:v]fps=30,format=rgba[avatar]",
      "[base][avatar]overlay=0:0:shortest=1[person]",
      "[person][2:v]overlay=0:0:shortest=1[v]",
      audioFilter,
    ].join(";");
    await run(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostats",
        "-y",
        "-stream_loop",
        "-1",
        "-i",
        inputVideo,
        "-i",
        avatarPath,
        "-i",
        overlays,
        "-i",
        voice,
        ...(previewBgm ? ["-stream_loop", "-1", "-i", previewBgm] : []),
        "-filter_complex",
        filter,
        "-map",
        "[v]",
        "-map",
        "[a]",
        "-t",
        String(total),
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "18",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-movflags",
        "+faststart",
        output,
      ],
      { timeout: 30 * 60_000, maxBuffer: 2 * 1024 * 1024 },
    );
    const douyinUpload = path.join(outputDir, "douyin-upload.mp4");
    // The picture is identical to the preview. Reuse its encoded video stream
    // and replace only the mixed audio with clean narration for Douyin's music picker.
    await run(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostats",
        "-y",
        "-i",
        output,
        "-i",
        voice,
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-af",
        "loudnorm=I=-16:TP=-1.5:LRA=9",
        "-shortest",
        "-movflags",
        "+faststart",
        douyinUpload,
      ],
      { timeout: 30 * 60_000, maxBuffer: 2 * 1024 * 1024 },
    );
    const outputUrl = `/generated/videos/${draft.id}/final.mp4`;
    await prisma.videoRender.update({
      where: { id: renderId },
      data: { status: "SUCCEEDED", progress: 100, outputUrl, visualMode },
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "视频生成失败";
    await prisma.videoRender.update({
      where: { id: renderId },
      data: { status: "FAILED", error: message.slice(-2_000) },
    });
  }
}
