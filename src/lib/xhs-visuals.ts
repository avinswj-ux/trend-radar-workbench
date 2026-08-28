import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import avinBrand from "@/config/avin-brand.json";
import { xNewsHandlePattern } from "@/config/x-news-accounts";
import { parseSourceImageNumber } from "@/lib/x-news-scene-graphics";

export type XhsVisual = {
  scene: number;
  kind: "cover" | "card";
  url: string;
  title: string;
};

type StoryboardScene = {
  scene?: number;
  onScreenText?: string;
  narration?: string;
  visual?: string;
};

const width = 1080;
const height = 1440;

function escapeXml(value: string) {
  return value.replace(/[<>&'\"]/g, (character) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[character] ?? character);
}

function imageSafeText(value: string) {
  return value
    .replace(/https?:\/\/(?:www\.)?(?:x|twitter)\.com\/\S*/gi, "")
    .replace(xNewsHandlePattern(), "")
    .replace(/图源\s*[/／]?\s*信源[：:].*/g, "")
    .replace(/信源[：:].*/g, "")
    .replace(/想看原文去\s*X[。.]?/g, "")
    .replace(/去\s*X[。.]?/g, "")
    .replace(/原帖链接/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function unitWidth(value: string) {
  return [...value].reduce((sum, item) => sum + (/[\u2E80-\u9FFF]/.test(item) ? 2 : 1), 0);
}

function lines(value: string, limit: number, maxLines: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  const output: string[] = [];
  let current = "";
  const chars = [...normalized];
  for (let index = 0; index < chars.length; index += 1) {
    const character = chars[index];
    const wide = /[\u2E80-\u9FFF]/.test(character) ? 2 : 1;
    if (unitWidth(current) + wide > limit && current) {
      if (output.length >= maxLines - 1) {
        const rest = `${current}${chars.slice(index).join("")}`;
        output.push(trimToWidth(rest, limit, true));
        return output;
      }
      output.push(current);
      current = character;
    } else current += character;
  }
  if (current && output.length < maxLines) output.push(current);
  return output;
}

function trimToWidth(value: string, limit: number, ellipsis = false) {
  let output = "";
  for (const character of value) {
    const next = output + character;
    if (unitWidth(next) > (ellipsis ? limit - 2 : limit)) break;
    output = next;
  }
  return ellipsis && output.length < value.length ? `${output}…` : output;
}

function textRows(rows: string[], x: number, y: number, fontSize: number, lineHeight: number, color = "#fff", weight = 800) {
  return rows.map((row, index) => `<text x="${x}" y="${y + index * lineHeight}" fill="${color}" font-family="PingFang SC, Noto Sans CJK SC, sans-serif" font-size="${fontSize}" font-weight="${weight}">${escapeXml(row)}</text>`).join("");
}

async function fishyCutout() {
  const source = path.join(process.cwd(), "public/assets/fishy-happyhorse-source-v1.png");
  const { data, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let index = 0; index < data.length; index += 4) {
    const red = data[index];
    const green = data[index + 1];
    const blue = data[index + 2];
    const blueBackground = blue > 145 && blue > red * 1.55 && blue > green * 1.32;
    if (blueBackground) data[index + 3] = 0;
  }
  return sharp(data, { raw: info }).trim().resize({ width: 680, withoutEnlargement: true }).png().toBuffer();
}

function coverSvg(title: string) {
  const titleLines = lines(title, 21, 3);
  const colors = avinBrand.cover;
  return Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${colors.background}"/><stop offset="0.62" stop-color="#111827"/><stop offset="1" stop-color="#083b42"/></linearGradient><filter id="shadow"><feDropShadow dx="0" dy="16" stdDeviation="12" flood-opacity=".55"/></filter></defs>
    <rect width="1080" height="1440" fill="url(#bg)"/>
    <circle cx="900" cy="170" r="280" fill="${colors.primary}" opacity=".10"/><circle cx="90" cy="1220" r="360" fill="${colors.secondary}" opacity=".10"/>
    <rect x="72" y="60" rx="27" width="330" height="54" fill="${colors.primary}"/>
    <text x="237" y="98" text-anchor="middle" fill="#111827" font-family="PingFang SC, sans-serif" font-size="30" font-weight="900" letter-spacing="4">${avinBrand.seriesLabel}</text>
    ${textRows(titleLines, 72, 220, 82, 104, colors.text, 900)}
    <rect x="72" y="560" rx="32" width="590" height="80" fill="${colors.secondary}" filter="url(#shadow)"/>
    <text x="106" y="614" fill="#111827" font-family="PingFang SC, sans-serif" font-size="34" font-weight="900">我替你先跑一遍</text>
    <path d="M90 730 H550 M90 780 H460 M90 830 H510" stroke="${colors.primary}" stroke-width="12" stroke-linecap="round" opacity=".9"/>
    <text x="72" y="1348" fill="${colors.muted}" font-family="PingFang SC, sans-serif" font-size="27" font-weight="600">${avinBrand.contentPromise}</text>
  </svg>`);
}

function cardSvg(scene: StoryboardScene, index: number) {
  const heading = imageSafeText(scene.onScreenText?.trim() || `重点 ${index}`);
  const body = imageSafeText(scene.narration?.trim() || scene.visual?.trim() || "核心信息待补充");
  const headingLines = lines(heading, 21, 2);
  const bodyLines = lines(body, 34, 6);
  const accents = ["#66f3d0", "#ffd84a", "#ff7b78", "#8ba8ff", "#d2ff65"];
  const accent = accents[(index - 1) % accents.length];
  return Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#0b0d16"/><stop offset="1" stop-color="#17132d"/></linearGradient></defs>
    <rect width="1080" height="1440" fill="url(#bg)"/>
    <text x="72" y="92" fill="${accent}" font-family="PingFang SC, sans-serif" font-size="28" font-weight="800" letter-spacing="3">${avinBrand.seriesLabel} · ${String(index).padStart(2, "0")}</text>
    ${textRows(headingLines, 72, 220, 76, 98, "#ffffff", 900)}
    <rect x="72" y="410" width="150" height="12" rx="6" fill="${accent}"/>
    ${textRows(bodyLines, 72, 535, 42, 66, "#d9dce8", 600)}
    <g transform="translate(72 1080)"><rect width="936" height="215" rx="34" fill="#ffffff" opacity=".06" stroke="${accent}" stroke-opacity=".55"/><circle cx="92" cy="108" r="43" fill="${accent}"/><text x="80" y="123" fill="#11131c" font-family="sans-serif" font-size="42" font-weight="900">✓</text><text x="165" y="94" fill="#ffffff" font-family="PingFang SC, sans-serif" font-size="34" font-weight="800">先收藏，再验证</text><text x="165" y="145" fill="#aeb5c9" font-family="PingFang SC, sans-serif" font-size="27">AI 输出中的关键信息请独立核验</text></g>
    <text x="72" y="1375" fill="#72798e" font-family="PingFang SC, sans-serif" font-size="24">AI 情报雷达 / 小红书图文</text>
  </svg>`);
}

export async function generateXhsVisuals(
  draft: { id: string; title: string; storyboard: unknown; caption?: string },
  options: { sourceImages?: string[] } = {},
) {
  const directory = path.join(process.cwd(), "public/generated/xhs", draft.id);
  await mkdir(directory, { recursive: true });
  const sourceFiles = (options.sourceImages ?? [])
    .map((image) => resolveSourceImage(image))
    .filter(Boolean) as string[];
  const storyboard = Array.isArray(draft.storyboard) ? draft.storyboard as StoryboardScene[] : [];
  const coverTitle = imageSafeText(draft.title.split(/[：:]/)[0]).slice(0, 32);
  const coverPath = path.join(directory, "01-cover.png");

  if (sourceFiles[0]) {
    await composeRemixCover(sourceFiles[0], coverTitle, coverPath);
  } else {
    const cutout = await fishyCutout();
    await sharp(coverSvg(coverTitle)).composite([{ input: cutout, left: 420, top: 650 }]).png().toFile(coverPath);
  }

  const extraCards = Math.min(6, Math.max(5, storyboard.length ? storyboard.length - 1 : 5));
  const scenes = storyboard.slice(1, extraCards + 1);
  const visuals: XhsVisual[] = [{ scene: 1, kind: "cover", url: `/generated/xhs/${draft.id}/01-cover.png`, title: draft.title }];
  const usedFiles = new Set<string>();
  const coverFile = sourceFiles[0] ?? "";
  if (coverFile) usedFiles.add(coverFile);
  for (let index = 0; index < extraCards; index += 1) {
    const scene = scenes[index] ?? storyboard[index] ?? { onScreenText: `重点 ${index + 1}`, narration: draft.title };
    const number = index + 2;
    const filename = `${String(number).padStart(2, "0")}-card.png`;
    const source = pickStoryboardImage(sourceFiles, scene, usedFiles);
    const isLast = index === extraCards - 1;
    if (source && !isLast) {
      await composeRemixCard(source, scene, number, path.join(directory, filename));
    } else {
      await sharp(isLast ? sourceCardSvg(scene, draft.caption) : cardSvg(scene, number)).png().toFile(path.join(directory, filename));
    }
    visuals.push({ scene: number, kind: "card", url: `/generated/xhs/${draft.id}/${filename}`, title: scene.onScreenText || `重点 ${number}` });
  }
  await writeFile(path.join(directory, "manifest.json"), JSON.stringify({ draftId: draft.id, visuals, remix: sourceFiles.length > 0 }, null, 2), "utf8");
  return visuals;
}

function pickStoryboardImage(files: string[], scene: StoryboardScene, used: Set<string>) {
  const wanted = parseSourceImageNumber(scene);
  if (wanted) {
    const named = files.find((file) => {
      const match = file.match(/(\d+)\.(?:jpg|jpeg|png|webp)$/i);
      return match ? Number(match[1]) === wanted : false;
    });
    if (named) {
      used.add(named);
      return named;
    }
  }
  const next = files.find((file) => !used.has(file));
  if (next) {
    used.add(next);
    return next;
  }
  return files[0] ?? "";
}

function resolveSourceImage(image: string) {
  if (!image) return "";
  if (image.startsWith("/")) return path.join(process.cwd(), "public", image.replace(/^\//, ""));
  return image;
}

async function coverBackground(file: string) {
  return sharp(file)
    .rotate()
    .resize(width, height, { fit: "cover", position: "north" })
    .jpeg({ quality: 88 })
    .toBuffer();
}

const remixImageHeight = 820;

function remixCoverSvg(title: string) {
  const titleLines = lines(title, 22, 2);
  return Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect x="0" y="${remixImageHeight - 8}" width="1080" height="${height - remixImageHeight + 8}" fill="#111318"/>
    <rect x="64" y="62" rx="24" width="250" height="52" fill="${avinBrand.cover.primary}"/>
    <text x="189" y="98" text-anchor="middle" fill="#111827" font-family="PingFang SC, sans-serif" font-size="28" font-weight="900">${avinBrand.seriesLabel}</text>
    ${textRows(titleLines, 56, 900, 56, 72, "#ffffff", 900)}
    <rect x="56" y="1070" rx="22" width="360" height="52" fill="${avinBrand.cover.secondary}"/>
    <text x="74" y="1106" fill="#111827" font-family="PingFang SC, sans-serif" font-size="24" font-weight="900">我替你先跑一遍</text>
  </svg>`);
}

function remixCardSvg(scene: StoryboardScene, index: number) {
  const heading = imageSafeText(scene.onScreenText?.trim() || `重点 ${index}`);
  const body = imageSafeText(scene.narration?.trim() || scene.visual?.trim() || "");
  return Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect x="0" y="${remixImageHeight - 8}" width="1080" height="${height - remixImageHeight + 8}" fill="#111318"/>
    <text x="56" y="868" fill="#ffd84a" font-family="PingFang SC, sans-serif" font-size="24" font-weight="800">${avinBrand.seriesLabel} · ${String(index).padStart(2, "0")}</text>
    ${textRows(lines(heading, 22, 2), 56, 930, 48, 62, "#ffffff", 900)}
    ${textRows(lines(body, 34, 3), 56, 1078, 28, 40, "#d9dce8", 600)}
  </svg>`);
}

function sourceCardSvg(scene: StoryboardScene, caption?: string) {
  const heading = imageSafeText(scene.onScreenText?.trim() || "先核对");
  const rawBody = scene.narration?.trim() || caption?.split(/信源|图源/)[0] || "事实来自公开资料，文案是 Avin 的理解。";
  const body = imageSafeText(rawBody) || "事实来自公开资料，文案是 Avin 的理解。";
  return Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect width="1080" height="1440" fill="#111318"/>
    <text x="72" y="110" fill="#66f3d0" font-family="PingFang SC, sans-serif" font-size="28" font-weight="800">${avinBrand.seriesLabel} · 判断</text>
    ${textRows(lines(heading, 20, 2), 72, 240, 68, 88, "#ffffff", 900)}
    ${textRows(lines(body, 30, 7), 72, 460, 36, 54, "#d9dce8", 600)}
    <rect x="72" y="1180" width="936" height="150" rx="28" fill="#ffffff" opacity=".06"/>
    <text x="108" y="1244" fill="#ffd84a" font-family="PingFang SC, sans-serif" font-size="30" font-weight="800">先核对，再转发</text>
    <text x="108" y="1294" fill="#aeb5c9" font-family="PingFang SC, sans-serif" font-size="24">只讲能核验的事实，不照搬原句</text>
  </svg>`);
}

async function composeRemixCover(file: string, title: string, output: string) {
  const cutout = await sharp(await fishyCutout()).resize({ width: 300, withoutEnlargement: true }).png().toBuffer();
  const photo = await sharp(file)
    .rotate()
    .resize(width, remixImageHeight, { fit: "cover", position: "north" })
    .jpeg({ quality: 88 })
    .toBuffer();
  await sharp({
    create: { width, height, channels: 3, background: "#111318" },
  })
    .composite([
      { input: photo, top: 0, left: 0 },
      { input: remixCoverSvg(title), top: 0, left: 0 },
      { input: cutout, left: 780, top: 1160 },
    ])
    .png()
    .toFile(output);
}

async function composeRemixCard(file: string, scene: StoryboardScene, index: number, output: string) {
  const photo = await sharp(file)
    .rotate()
    .resize(width, remixImageHeight, { fit: "cover", position: "north" })
    .jpeg({ quality: 88 })
    .toBuffer();
  await sharp({
    create: { width, height, channels: 3, background: "#111318" },
  })
    .composite([
      { input: photo, top: 0, left: 0 },
      { input: remixCardSvg(scene, index), top: 0, left: 0 },
    ])
    .png()
    .toFile(output);
}

export async function readXhsVisuals(draftId: string): Promise<XhsVisual[]> {
  try {
    const raw = await readFile(path.join(process.cwd(), "public/generated/xhs", draftId, "manifest.json"), "utf8");
    return (JSON.parse(raw) as { visuals?: XhsVisual[] }).visuals ?? [];
  } catch {
    return [];
  }
}

export async function invalidateXhsVisuals(draftId: string) {
  const directory = path.join(process.cwd(), "public/generated/xhs", draftId);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "manifest.json"), JSON.stringify({ draftId, visuals: [], invalidatedAt: new Date().toISOString() }, null, 2), "utf8");
}
