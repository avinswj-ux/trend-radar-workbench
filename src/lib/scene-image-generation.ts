import { mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { buildVisualScenePlan, type VisualScene } from "@/lib/visual-planner";

type Scene = VisualScene;

type ArkImagePayload = {
  data?: Array<{ url?: string }>;
  error?: { code?: string; message?: string };
};

function imageEndpoint() {
  const configured = process.env.DASHSCOPE_IMAGE_BASE_URL?.trim();
  if (configured) return configured;
  const base = process.env.DASHSCOPE_BASE_URL?.trim().replace(/\/compatible-mode\/v1\/?$/, "");
  if (!base) throw new Error("缺少 DASHSCOPE_BASE_URL，无法生成 AI 分镜图片");
  return `${base}/api/v1/services/aigc/multimodal-generation/generation`;
}

function buildPrompt(title: string, scenes: Scene[]) {
  return scenes
    .map((scene, index) => buildVisualScenePlan(title, scene, index, scenes.length).prompt)
    .join("\n\n--- 下一张分镜 ---\n\n");
}

function buildScenePrompt(
  title: string,
  scene: Scene,
  index: number,
  total: number,
) {
  return `${buildVisualScenePlan(title, scene, index, total).prompt}
画面必须独立完整，并与同主题的其他镜头保持统一视觉语言；不要在画面中标注镜头序号。`;
}

function extractImageUrls(payload: unknown) {
  const output = (payload as { output?: { choices?: Array<{ message?: { content?: Array<{ image?: string }> } }> } })?.output;
  return (output?.choices ?? []).flatMap((choice) => choice.message?.content ?? []).map((item) => item.image).filter((url): url is string => Boolean(url));
}

export async function generateSceneImages(draftId: string, title: string, scenes: Scene[]) {
  if (process.env.ARK_API_KEY?.trim()) {
    return generateSceneImagesWithArk(draftId, title, scenes);
  }
  return generateSceneImagesWithDashscope(draftId, title, scenes);
}

async function outputDirectory(draftId: string) {
  const dir = path.join(process.cwd(), "public", "generated", "video-scenes", draftId);
  await mkdir(dir, { recursive: true });
  return dir;
}

async function saveSceneImage(buffer: Buffer, dir: string, index: number) {
  if (buffer.byteLength > 25 * 1024 * 1024)
    throw new Error(`第 ${index + 1} 张 AI 分镜超过 25MB`);
  const file = path.join(dir, `scene-${String(index + 1).padStart(2, "0")}.jpg`);
  await sharp(buffer)
    .rotate()
    .resize(1080, 1920, { fit: "cover", position: "attention" })
    .jpeg({ quality: 92 })
    .toFile(file);
  return file;
}

async function generateSceneImagesWithArk(
  draftId: string,
  title: string,
  scenes: Scene[],
) {
  const key = process.env.ARK_API_KEY?.trim();
  if (!key) throw new Error("缺少 ARK_API_KEY，无法调用豆包 Seedream 生图");
  const base = (process.env.ARK_BASE_URL?.trim() || "https://ark.cn-beijing.volces.com/api/v3").replace(/\/$/, "");
  const model = process.env.ARK_IMAGE_MODEL?.trim() || "doubao-seedream-5-0-260128";
  const dir = await outputDirectory(draftId);
  const files: string[] = [];

  // Seedream 5.0 requires at least 3,686,400 source pixels. Generate native
  // 9:16 at 1440x2560, then normalize to the renderer's 1080x1920 canvas.
  for (let index = 0; index < scenes.length; index += 1) {
    const response = await fetch(`${base}/images/generations`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        prompt: buildScenePrompt(title, scenes[index], index, scenes.length),
        size: "1440x2560",
        response_format: "url",
        watermark: false,
      }),
      signal: AbortSignal.timeout(8 * 60_000),
    });
    const payload = (await response.json().catch(() => ({}))) as ArkImagePayload;
    const imageUrl = payload.data?.[0]?.url;
    if (!response.ok || !imageUrl) {
      throw new Error(
        `豆包 Seedream 第 ${index + 1} 张分镜生成失败（${response.status}）：${payload.error?.message || payload.error?.code || "未知错误"}`,
      );
    }
    const imageResponse = await fetch(imageUrl, {
      signal: AbortSignal.timeout(2 * 60_000),
    });
    if (!imageResponse.ok)
      throw new Error(`下载第 ${index + 1} 张豆包分镜失败（${imageResponse.status}）`);
    files.push(
      await saveSceneImage(
        Buffer.from(await imageResponse.arrayBuffer()),
        dir,
        index,
      ),
    );
  }
  return files;
}

async function generateSceneImagesWithDashscope(draftId: string, title: string, scenes: Scene[]) {
  const key = process.env.DASHSCOPE_API_KEY?.trim();
  if (!key) throw new Error("缺少 DASHSCOPE_API_KEY，无法生成 AI 分镜图片");
  const response = await fetch(imageEndpoint(), {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.DASHSCOPE_IMAGE_MODEL || "wan2.7-image",
      input: { messages: [{ role: "user", content: [{ text: buildPrompt(title, scenes) }] }] },
      parameters: { enable_sequential: true, n: scenes.length, size: "1080*1920", watermark: false },
    }),
    signal: AbortSignal.timeout(8 * 60_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`AI 分镜生图失败（${response.status}）：${JSON.stringify(payload).slice(0, 600)}`);
  const urls = extractImageUrls(payload);
  if (urls.length < scenes.length) throw new Error(`AI 分镜仅返回 ${urls.length}/${scenes.length} 张图片`);
  const dir = await outputDirectory(draftId);
  const files: string[] = [];
  for (let index = 0; index < scenes.length; index += 1) {
    const imageResponse = await fetch(urls[index], { signal: AbortSignal.timeout(2 * 60_000) });
    if (!imageResponse.ok) throw new Error(`下载第 ${index + 1} 张 AI 分镜失败（${imageResponse.status}）`);
    files.push(await saveSceneImage(Buffer.from(await imageResponse.arrayBuffer()), dir, index));
  }
  return files;
}
