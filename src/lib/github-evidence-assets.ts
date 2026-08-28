import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";

const run = promisify(execFile);

export type OfficialEvidenceAsset = {
  path: string;
  kind: "IMAGE" | "VIDEO";
  score: number;
};

function githubRepo(url: string) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "github.com") return null;
    const [owner, repo] = parsed.pathname.split("/").filter(Boolean);
    if (!owner || !repo) return null;
    return { owner, repo: repo.replace(/\.git$/i, "") };
  } catch {
    return null;
  }
}

async function walk(directory: string): Promise<string[]> {
  const output: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if ([".git", "node_modules", ".next", "dist", "build"].includes(entry.name))
      continue;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...(await walk(target)));
    else output.push(target);
  }
  return output;
}

function evidenceScore(file: string) {
  const normalized = file.replaceAll("\\", "/").toLowerCase();
  let score = 0;
  if (/\/docs\/screenshot-/.test(normalized)) score += 120;
  if (/\/docs\/preview\./.test(normalized)) score += 80;
  if (/\/docs\/media\//.test(normalized)) score += 90;
  if (/screenshot|preview|demo|feature|showcase|media/.test(normalized)) score += 40;
  if (/docs?|readme|assets?/.test(normalized)) score += 18;
  if (/launch|studio|clone|dub|design|gallery|catalog|engine|workflow/.test(normalized))
    score += 14;
  if (/icon|favicon|logo|badge|avatar|test|fixture|sample/.test(normalized)) score -= 35;
  if (/src-tauri\/icons|\/favicon/.test(normalized)) score -= 200;
  return score;
}

export function isPreferredOfficialShot(file: string) {
  const normalized = file.replaceAll("\\", "/").toLowerCase();
  return /\/docs\/(screenshot-|preview\.|media\/)/.test(normalized);
}

export async function collectGithubEvidenceAssets(
  canonicalUrl: string,
): Promise<OfficialEvidenceAsset[]> {
  const repo = githubRepo(canonicalUrl);
  if (!repo) return [];
  const root = path.join(
    process.cwd(),
    "storage",
    "official-evidence",
    `${repo.owner}--${repo.repo}`,
  );
  const checkout = path.join(root, "repo");
  await mkdir(root, { recursive: true });
  if (!existsSync(path.join(checkout, ".git"))) {
    await run(
      "git",
      ["clone", "--depth", "1", canonicalUrl, checkout],
      { timeout: 5 * 60_000, maxBuffer: 4 * 1024 * 1024 },
    );
  }

  const candidates = (await walk(checkout)).filter((file) =>
    /\.(png|jpe?g|webp|gif|webm|mp4|mov)$/i.test(file),
  );
  const assets: OfficialEvidenceAsset[] = [];
  for (const file of candidates) {
    const extension = path.extname(file).toLowerCase();
    const kind = /\.(webm|mp4|mov|gif)$/i.test(extension) ? "VIDEO" : "IMAGE";
    if (kind === "IMAGE") {
      try {
        const metadata = await sharp(file).metadata();
        if ((metadata.width ?? 0) < 700 || (metadata.height ?? 0) < 360) continue;
      } catch {
        continue;
      }
    }
    assets.push({ path: file, kind, score: evidenceScore(file) });
  }
  return assets.sort((a, b) => b.score - a.score).slice(0, 24);
}
