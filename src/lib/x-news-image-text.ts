import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { XNewsImage } from "@/lib/x-news-assets";

const run = promisify(execFile);

export type ImageCaption = {
  n: number;
  publicUrl: string;
  text: string;
};

export function slideshowSceneCount(_imageCount: number) {
  return 6;
}

export async function readImageInventory(images: XNewsImage[]) {
  const captions: ImageCaption[] = [];
  for (const [index, image] of images.slice(0, 16).entries()) {
    const text = await ocrImage(image.localPath);
    const compact = collapseOcr(text);
    if (!compact) continue;
    const previous = captions.at(-1);
    if (previous && similarText(previous.text, compact)) continue;
    captions.push({ n: index + 1, publicUrl: image.publicUrl, text: compact });
  }
  return captions;
}

async function ocrImage(file: string) {
  try {
    const { stdout } = await run(
      "tesseract",
      [file, "stdout", "-l", "chi_sim+eng", "--psm", "6"],
      { timeout: 20_000, maxBuffer: 1024 * 1024 },
    );
    return stdout;
  } catch {
    return "";
  }
}

function collapseOcr(raw: string) {
  return raw
    .replace(/[|]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}%./+\-×x≈~\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);
}

function similarText(left: string, right: string) {
  const a = new Set(left.slice(0, 80));
  let hit = 0;
  for (const char of right.slice(0, 80)) if (a.has(char)) hit += 1;
  return hit / Math.max(right.slice(0, 80).length, 1) > 0.72;
}

export function resolveLocalImage(publicUrl: string) {
  if (publicUrl.startsWith("/")) return path.join(process.cwd(), "public", publicUrl.replace(/^\//, ""));
  return publicUrl;
}
