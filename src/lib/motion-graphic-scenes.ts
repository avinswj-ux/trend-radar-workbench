import "server-only";

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import { assertUsableVideo } from "@/lib/video-policy";
import {
  buildVisualScenePlan,
  type VisualScene,
  type VisualScenePlan,
} from "@/lib/visual-planner";

const run = promisify(execFile);
const POLICY_VERSION = "semantic-locked-claim-card-v7";

type Scene = VisualScene & { durationSeconds?: number };

const palettes = [
  { bg: "0x071426", panel: "0x12355b", accent: "0x38bdf8", warm: "0xf7d84b" },
  { bg: "0x160d2b", panel: "0x35205d", accent: "0xa78bfa", warm: "0xf59e0b" },
  { bg: "0x071f1d", panel: "0x12423e", accent: "0x2dd4bf", warm: "0xfacc15" },
  { bg: "0x24100d", panel: "0x51231e", accent: "0xfb7185", warm: "0xfbbf24" },
];

function motionFilter(index: number) {
  // Locked camera + no drifting ornaments. User: 镜头不要移来移去.
  const color = palettes[index % palettes.length];
  return [
    "scale=1280:720:flags=lanczos",
    "drawbox=x=64:y=646:w=1152:h=10:color=0xffffff@0.10:t=fill",
    `drawbox=x=64:y=646:w=1152:h=10:color=${color.accent}@0.96:t=fill`,
    "format=yuv420p",
  ].join(",");
}

function escapeXml(value: string) {
  return value.replace(/[<>&'\"]/g, (character) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[
      character
    ] ?? character,
  );
}

function wrapText(value: string, limit: number, maxLines: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  const rows: string[] = [];
  let current = "";
  for (const character of normalized) {
    const width = /[\u2E80-\u9FFF]/.test(character) ? 2 : 1;
    const currentWidth = [...current].reduce(
      (sum, item) => sum + (/[\u2E80-\u9FFF]/.test(item) ? 2 : 1),
      0,
    );
    if (current && currentWidth + width > limit) {
      rows.push(current);
      current = character;
      if (rows.length === maxLines - 1) break;
    } else current += character;
  }
  if (current && rows.length < maxLines) rows.push(current);
  return rows;
}

function svgRows(
  rows: string[],
  x: number,
  y: number,
  size: number,
  lineHeight: number,
  color: string,
  weight = 700,
) {
  return rows
    .map(
      (row, index) =>
        `<text x="${x}" y="${y + index * lineHeight}" fill="${color}" font-family="PingFang SC,STHeiti,sans-serif" font-size="${size}" font-weight="${weight}">${escapeXml(row)}</text>`,
    )
    .join("");
}

function featureLabels(text: string) {
  const candidates = [
    "语音克隆",
    "视频配音",
    "转写",
    "转文字",
    "有声书",
    "本地部署",
    "批量处理",
    "上传录音",
    "输入文字",
    "生成音频",
    "数据掌控",
  ].filter((label) => text.includes(label));
  if (!candidates.includes("视频配音") && text.includes("配音"))
    candidates.push("配音");
  return [...new Set(candidates)]
    .map((label) => (label === "转文字" ? "语音转写" : label))
    .slice(0, 4);
}

function productName(title: string, text: string) {
  const allowed = (token: string) => !["AI", "GitHub", "AVIN"].includes(token);
  const latin = title.match(/\b[A-Z][A-Za-z0-9._-]{2,}\b/g)?.find(allowed)
    ?? text.match(/\b[A-Z][A-Za-z0-9._-]{2,}\b/g)?.find(allowed);
  return latin || title.split(/[，,：:？?]/)[0].slice(0, 20);
}

function semanticDiagram(plan: VisualScenePlan, text: string, accent: string) {
  const product = productName(plan.functionFact, text);
  const features = featureLabels(text);
  if (plan.visualType === "WORKFLOW") {
    const steps = features.length >= 3 ? features.slice(0, 3) : ["输入素材", "AI 处理", "结果输出"];
    return steps
      .map(
        (step, index) =>
          `<g transform="translate(${70 + index * 402} 300)"><rect width="340" height="230" rx="28" fill="#ffffff" fill-opacity=".08" stroke="${accent}" stroke-width="3"/><circle cx="46" cy="46" r="22" fill="${accent}"/><text x="46" y="55" text-anchor="middle" fill="#10131d" font-family="Arial" font-size="24" font-weight="900">${index + 1}</text><text x="170" y="125" text-anchor="middle" fill="#fff" font-family="PingFang SC,STHeiti,sans-serif" font-size="34" font-weight="800">${escapeXml(step)}</text><path d="M75 174 H265" stroke="${accent}" stroke-width="10" stroke-linecap="round" opacity=".75"/></g>${index < 2 ? `<path d="M${420 + index * 402} 415 H${458 + index * 402}" stroke="${accent}" stroke-width="10" stroke-linecap="round"/><path d="M${448 + index * 402} 401 L${464 + index * 402} 415 L${448 + index * 402} 429" fill="none" stroke="${accent}" stroke-width="7"/>` : ""}`,
      )
      .join("");
  }
  if (plan.visualType === "FEATURE_GRID") {
    const labels = features.length ? features : ["核心功能", "内容处理", "结果输出", "批量工作流"];
    return labels
      .map((label, index) => {
        const x = 70 + (index % 2) * 585;
        const y = 270 + Math.floor(index / 2) * 155;
        return `<g transform="translate(${x} ${y})"><rect width="540" height="125" rx="24" fill="#ffffff" fill-opacity=".08" stroke="${accent}" stroke-opacity=".75"/><circle cx="56" cy="62" r="25" fill="${accent}"/><path d="M43 62 H69 M56 49 V75" stroke="#10131d" stroke-width="7"/><text x="105" y="75" fill="#fff" font-family="PingFang SC,STHeiti,sans-serif" font-size="31" font-weight="800">${escapeXml(label)}</text></g>`;
      })
      .join("");
  }
  if (plan.visualType === "COMPARISON" || plan.visualType === "RISK") {
    const labels = /高频|偶尔|小团队|适合人群/.test(text)
      ? ["偶尔使用", "高频团队"]
      : /开源|部署|模型要求|零门槛/.test(text)
        ? ["源码公开", "部署待验证"]
        : plan.visualType === "RISK"
          ? ["适合", "需要注意"]
          : ["原来的方式", "AI 方式"];
    return labels
      .map(
        (label, index) =>
          `<g transform="translate(${90 + index * 610} 275)"><rect width="500" height="275" rx="34" fill="${index ? accent : "#ffffff"}" fill-opacity="${index ? ".18" : ".07"}" stroke="${index ? accent : "#ffffff"}" stroke-opacity=".65"/><text x="250" y="78" text-anchor="middle" fill="${index ? accent : "#fff"}" font-family="PingFang SC,STHeiti,sans-serif" font-size="38" font-weight="900">${label}</text><path d="M90 135 H410 M90 190 H360 M90 240 H390" stroke="#fff" stroke-opacity=".55" stroke-width="14" stroke-linecap="round"/></g>`,
      )
      .join("");
  }
  return `<g transform="translate(120 270)"><rect width="1040" height="290" rx="40" fill="#ffffff" fill-opacity=".08" stroke="${accent}" stroke-width="4"/><circle cx="520" cy="105" r="66" fill="${accent}" fill-opacity=".9"/><path d="M482 105 H558 M520 67 V143" stroke="#111827" stroke-width="17" stroke-linecap="round"/><text x="520" y="230" text-anchor="middle" fill="#fff" font-family="PingFang SC,STHeiti,sans-serif" font-size="48" font-weight="900">${escapeXml(product)}</text></g>`;
}

function semanticSvg(title: string, scene: Scene, plan: VisualScenePlan, index: number) {
  const color = palettes[index % palettes.length];
  const accent = `#${color.accent.slice(2)}`;
  const heading = wrapText(scene.onScreenText || plan.functionFact, 28, 2);
  const claim = wrapText(scene.claim || scene.narration || plan.functionFact, 36, 3);
  const source = `${scene.visual || ""} ${scene.narration || ""}`;
  const product = productName(title, source);
  return Buffer.from(`<svg width="1280" height="720" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#071426"/><stop offset="1" stop-color="#111b35"/></linearGradient></defs>
    <rect width="1280" height="720" fill="url(#bg)"/>
    <rect x="56" y="48" width="1168" height="624" rx="28" fill="#0b1224" stroke="${accent}" stroke-opacity=".45"/>
    <text x="88" y="108" fill="${accent}" font-family="PingFang SC,sans-serif" font-size="22" font-weight="800">${escapeXml(product)} · 普通人能看懂的部分</text>
    ${svgRows(heading, 88, 190, 54, 66, "#ffe53a", 900)}
    ${svgRows(claim, 88, 360, 32, 44, "#e5e7eb", 700)}
    <text x="88" y="620" fill="#9ca3af" font-family="PingFang SC,sans-serif" font-size="22">无片源时只放观点卡，不放空科技背景</text>
  </svg>`);
}

export async function generateMotionGraphicSceneVideos(
  draftId: string,
  title: string,
  scenes: Scene[],
) {
  if (!scenes.length) throw new Error("没有可生成的动态图形分镜");
  const directory = path.join(process.cwd(), "storage", "motion-scenes", draftId);
  const policyFile = path.join(directory, "visual-policy.txt");
  const files = scenes.map((_, index) =>
    path.join(directory, `scene-${String(index + 1).padStart(2, "0")}.mp4`),
  );
  let cachedPolicy = "";
  if (existsSync(policyFile)) {
    const { readFile } = await import("node:fs/promises");
    cachedPolicy = (await readFile(policyFile, "utf8")).trim();
  }
  if (cachedPolicy === POLICY_VERSION && files.every(existsSync)) {
    await Promise.all(
      files.map((file, index) =>
        assertUsableVideo(file, `第 ${index + 1} 段缓存动态图形`),
      ),
    );
    return { files, dynamicCoverage: 1, staticRatio: 0 };
  }

  await mkdir(directory, { recursive: true });
  for (let index = 0; index < scenes.length; index += 1) {
    const plan = buildVisualScenePlan(title, scenes[index], index, scenes.length);
    const keyframe = path.join(
      directory,
      `scene-${String(index + 1).padStart(2, "0")}.png`,
    );
    await sharp(semanticSvg(title, scenes[index], plan, index)).png().toFile(keyframe);
    const duration = Math.max(
      4,
      Math.min(7, Math.round(Number(scenes[index].durationSeconds) || 5)),
    );
    await run(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostats",
        "-y",
        "-loop",
        "1",
        "-i",
        keyframe,
        "-t",
        String(duration),
        "-r",
        "30",
        "-vf",
        motionFilter(index),
        "-an",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "18",
        "-pix_fmt",
        "yuv420p",
        files[index],
      ],
      { timeout: 5 * 60_000, maxBuffer: 2 * 1024 * 1024 },
    );
    await assertUsableVideo(files[index], `第 ${index + 1} 段动态图形`);
  }
  await writeFile(policyFile, `${POLICY_VERSION}\n`, "utf8");
  return { files, dynamicCoverage: 1, staticRatio: 0 };
}
