import path from "node:path";
import sharp from "sharp";

export type SceneHint = {
  narration?: string;
  onScreenText?: string;
  claim?: string;
  evidenceType?: string;
  evidenceRequirement?: string;
  visual?: string;
};

export type SceneGraphicPlan = {
  imageNumber: number | null;
  punch: "none" | "north" | "center" | "east" | "south";
  label: string;
  style: "clean" | "callout" | "verdict";
};

function escapeXml(value: string) {
  return value.replace(/[<>&'"]/g, (character) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[character] ?? character,
  );
}

function compact(value: string, limit: number) {
  return value.replace(/\s+/g, " ").trim().slice(0, limit);
}

export function parseSourceImageNumber(scene: SceneHint) {
  const text = `${scene.visual ?? ""} ${scene.evidenceRequirement ?? ""}`;
  const match = text.match(/原图\s*(\d+)|第\s*(\d+)\s*张/i);
  if (!match) return null;
  const value = Number(match[1] || match[2]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function planSceneGraphic(scene: SceneHint): SceneGraphicPlan {
  const visual = scene.visual ?? "";
  const quoted = visual.match(/标注[:：]?\s*['“"'‘](.+?)['”"'’]/)?.[1]
    ?? visual.match(/写着[:：]?\s*['“"'‘](.+?)['”"'’]/)?.[1]
    ?? "";
  const commentary = scene.evidenceType === "AVIN_COMMENTARY";
  const label = compact(quoted || (commentary ? scene.onScreenText || "" : ""), 14);
  const wantsCloseup = /特写|放大|近景|框选/.test(visual);
  const punch = commentary
    ? "none"
    : /侧边栏|右侧|左边栏/.test(visual)
      ? "east"
      : /顶部|状态栏|在线/.test(visual)
        ? "north"
        : /底部|相册|预览/.test(visual)
          ? "south"
        : wantsCloseup
          ? "center"
          : "none";
  return {
    imageNumber: parseSourceImageNumber(scene),
    punch,
    label,
    style: commentary ? "verdict" : label ? "callout" : "clean",
  };
}

export function pickSceneImage<T extends { path: string }>(
  images: T[],
  scene: SceneHint,
  used: Set<string>,
) {
  const wanted = parseSourceImageNumber(scene);
  if (wanted) {
    const named = images.find((image) => {
      const match = image.path.match(/(\d+)\.(?:jpg|jpeg|png|webp)$/i);
      return match ? Number(match[1]) === wanted : false;
    });
    if (named) return named;
  }
  return images.find((image) => !used.has(image.path)) ?? images[0];
}

function overlaySvg(plan: SceneGraphicPlan) {
  if (plan.style === "clean" || !plan.label) {
    return Buffer.from(`<svg width="1280" height="720" xmlns="http://www.w3.org/2000/svg"></svg>`);
  }
  if (plan.style === "verdict") {
    const rows = [plan.label];
    return Buffer.from(`<svg width="1280" height="720" xmlns="http://www.w3.org/2000/svg">
      <rect width="1280" height="720" fill="#05070c" fill-opacity=".28"/>
      <rect x="80" y="280" width="1120" height="160" rx="24" fill="#050505" fill-opacity=".72"/>
      <text x="640" y="376" text-anchor="middle" fill="#ffe53a" font-family="PingFang SC, sans-serif" font-size="48" font-weight="900">${escapeXml(rows[0])}</text>
    </svg>`);
  }
  const width = Math.min(620, 48 + plan.label.length * 42);
  return Buffer.from(`<svg width="1280" height="720" xmlns="http://www.w3.org/2000/svg">
    <g transform="translate(48 48)">
      <rect width="${width}" height="64" rx="16" fill="#ffe53a"/>
      <text x="22" y="43" fill="#111827" font-family="PingFang SC, sans-serif" font-size="30" font-weight="900">${escapeXml(plan.label)}</text>
    </g>
  </svg>`);
}

async function fitFrame(imagePath: string, punch: SceneGraphicPlan["punch"]) {
  const meta = await sharp(imagePath).rotate().metadata();
  const wide = (meta.width ?? 1280) / Math.max(1, meta.height ?? 720) > 2.1;
  const tiny = (meta.width ?? 0) < 700 || (meta.height ?? 0) < 360;
  if (wide || tiny || punch === "none") {
    return sharp(imagePath)
      .rotate()
      .resize(1280, 720, { fit: "contain", background: "#0b0d12" });
  }
  const position =
    punch === "north" ? "north" : punch === "south" ? "south" : punch === "east" ? "east" : "centre";
  if (punch === "center") {
    return sharp(imagePath)
      .rotate()
      .resize(1500, 844, { fit: "cover", position: "centre" })
      .extract({ left: 110, top: 62, width: 1280, height: 720 });
  }
  return sharp(imagePath).rotate().resize(1280, 720, { fit: "cover", position });
}

export async function annotateXNewsStill(
  imagePath: string,
  scene: SceneHint,
  workDir: string,
  index: number,
) {
  const frames = await renderXNewsSceneFrames(imagePath, scene, workDir, index, 4);
  return frames[0]?.path ?? imagePath;
}

export async function renderXNewsSceneFrames(
  imagePath: string,
  scene: SceneHint,
  workDir: string,
  index: number,
  seconds: number,
) {
  const plan = planSceneGraphic(scene);
  const prefix = String(index + 1).padStart(2, "0");
  const cleanPath = path.join(workDir, `scene-${prefix}-clean.png`);
  await (await fitFrame(imagePath, plan.punch)).png().toFile(cleanPath);
  if (plan.style === "clean" || !plan.label) {
    return [{ path: cleanPath, seconds }];
  }
  const markedPath = path.join(workDir, `scene-${prefix}-mark.png`);
  await sharp(cleanPath)
    .composite([{ input: overlaySvg(plan), top: 0, left: 0 }])
    .png()
    .toFile(markedPath);
  const flash = Math.min(1.35, Math.max(0.85, seconds * 0.26));
  if (plan.style === "verdict") {
    return [
      { path: cleanPath, seconds: Number((seconds - flash).toFixed(3)) },
      { path: markedPath, seconds: flash },
    ];
  }
  return [
    { path: markedPath, seconds: flash },
    { path: cleanPath, seconds: Number((seconds - flash).toFixed(3)) },
  ];
}
