import { execFile } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { ContentPlatform, MediaAssetStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { AVIN_ACCOUNT_DNA, AVIN_EVIDENCE_RULES, AVIN_VOICE_DIRECTION } from "@/config/avin-content-dna";
import {
  hasCompleteEvidenceMap,
  normalizeEvidenceStoryboard,
  type EvidenceMappedScene,
} from "@/lib/evidence-map";
import {
  assertUsableVideo,
  suitabilityScoreFromAudit,
} from "@/lib/video-policy";

const run = promisify(execFile);
type Storyboard = Array<EvidenceMappedScene & { avatarAction: string }>;
type ReferenceResult = {
  summary: string;
  style: {
    hook: string;
    pacing: string;
    structure: string;
    visualStyle: string;
  };
  shotList: Array<{
    order: number;
    startSeconds: number;
    endSeconds: number;
    visual: string;
    spokenPoint: string;
    editingNotes: string;
  }>;
  draft: {
    title: string;
    hook: string;
    script: string;
    caption: string;
    hashtags: string[];
    storyboard: Storyboard;
  };
};

export async function analyzeMediaAsset(
  assetId: string,
  options: { rewriteDraft?: boolean } = {},
) {
  const asset = await prisma.mediaAsset.findUniqueOrThrow({
    where: { id: assetId },
    include: { contentItem: { include: { analysis: true, score: true } } },
  });
  try {
    if (!asset.videoPath || !asset.audioPath)
      throw new Error("素材尚未就绪，无法分析");
    await prisma.mediaAsset.update({
      where: { id: asset.id },
      data: { status: MediaAssetStatus.ANALYZING, error: null },
    });
    const motionAudit = await assertUsableVideo(asset.videoPath);
    const objectiveSuitability = suitabilityScoreFromAudit(motionAudit);
    if (asset.contentItem.score) {
      const previous = asset.contentItem.score;
      const contentScore =
        (previous.total - previous.videoSuitability * 0.15) / 0.85;
      const total = Math.max(
        0,
        Math.min(
          100,
          Math.round(contentScore * 0.85 + objectiveSuitability * 0.15),
        ),
      );
      await prisma.trendScore.update({
        where: { contentItemId: asset.contentItemId },
        data: {
          total,
          videoSuitability: objectiveSuitability,
          reasoning: `第一人称实测与片源适合度 ${objectiveSuitability}（运动差异 ${motionAudit.averageDifference.toFixed(2)}，有效动态占比 ${(motionAudit.activeRatio * 100).toFixed(1)}%，占总分 15%）。${previous.reasoning}`,
        },
      });
    }
    const transcript = asset.transcript
      ? compactTimedSrt(asset.transcript)
      : "该视频没有可用字幕；请仅依据画面和公开视频元数据给出保守分析。";
    const durationSeconds = await probeDuration(asset.videoPath);
    const frames = await extractFrames(
      asset.videoPath,
      asset.localDir ?? path.dirname(asset.videoPath),
    );
    let visualSummary: string;
    try {
      visualSummary = await analyzeFrames(frames, asset.contentItem.title);
    } catch (cause) {
      const reason =
        cause instanceof Error ? cause.message : "未知视觉模型错误";
      // Do not pretend frames were understood when the provider declined the request.
      visualSummary = `视觉理解未验证（${reason.slice(0, 300)}）。仅可依据公开视频元数据、可用字幕与音频转写生成保守内容结构；不得臆测画面细节。`;
    }
    const result = await buildReferenceAnalysis({
      title: asset.contentItem.title,
      sourceUrl: asset.sourceUrl,
      transcript,
      visualSummary,
      sourceDescription: asset.contentItem.body ?? "",
      durationSeconds,
    });
    validateShotCoverage(result.shotList, durationSeconds);
    if (options.rewriteDraft === false) {
      const savedAsset = await prisma.mediaAsset.update({
        where: { id: asset.id },
        data: {
          status: MediaAssetStatus.ANALYZED,
          transcript,
          shotList: result as unknown as Prisma.InputJsonValue,
        },
      });
      return { analysis: savedAsset, draft: null };
    }
    const saved = await prisma.$transaction([
      prisma.narrationClip.deleteMany({
        where: {
          draft: {
            contentItemId: asset.contentItemId,
            platform: ContentPlatform.DOUYIN,
          },
        },
      }),
      prisma.publishReview.deleteMany({
        where: {
          draft: {
            contentItemId: asset.contentItemId,
            platform: ContentPlatform.DOUYIN,
          },
        },
      }),
      prisma.videoRender.deleteMany({
        where: {
          draft: {
            contentItemId: asset.contentItemId,
            platform: ContentPlatform.DOUYIN,
          },
        },
      }),
      prisma.mediaAsset.update({
        where: { id: asset.id },
        data: {
          status: MediaAssetStatus.ANALYZED,
          transcript,
          shotList: result as unknown as Prisma.InputJsonValue,
        },
      }),
      prisma.contentDraft.upsert({
        where: {
          contentItemId_platform: {
            contentItemId: asset.contentItemId,
            platform: ContentPlatform.DOUYIN,
          },
        },
        create: {
          contentItemId: asset.contentItemId,
          platform: ContentPlatform.DOUYIN,
          model: "deepseek:reference-rewrite",
          ...result.draft,
          hashtags: result.draft.hashtags,
          storyboard: result.draft
            .storyboard as unknown as Prisma.InputJsonValue,
        },
        update: {
          model: "deepseek:reference-rewrite",
          ...result.draft,
          hashtags: result.draft.hashtags,
          storyboard: result.draft
            .storyboard as unknown as Prisma.InputJsonValue,
        },
      }),
    ]);
    return { analysis: saved[3], draft: saved[4] };
  } catch (cause) {
    const error =
      cause instanceof Error
        ? cause.message.slice(0, 4_000)
        : "Media analysis failed";
    await prisma.mediaAsset.update({
      where: { id: asset.id },
      data: { status: MediaAssetStatus.FAILED, error },
    });
    throw cause;
  }
}

async function extractFrames(videoPath: string, localDir: string) {
  const frameDir = path.join(localDir, "frames");
  await mkdir(frameDir, { recursive: true });
  const duration = await probeDuration(videoPath);
  const timestamps = Array.from({ length: 12 }, (_, index) =>
    Math.round(duration * ((index + 0.5) / 12)),
  );
  const existing: string[] = [];
  for (const seconds of timestamps) {
    const output = path.join(
      frameDir,
      `frame-${String(seconds).padStart(4, "0")}s.jpg`,
    );
    await run(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-ss",
        String(seconds),
        "-i",
        videoPath,
        "-frames:v",
        "1",
        "-vf",
        "scale=640:-2",
        output,
      ],
      { timeout: 60_000, maxBuffer: 2 * 1024 * 1024 },
    );
    try {
      await readFile(output);
      existing.push(output);
    } catch {
      /* no frame */
    }
  }
  if (!existing.length) throw new Error("无法从视频提取分析帧");
  return existing;
}

async function analyzeFrames(framePaths: string[], title: string) {
  const provider = process.env.VISION_PROVIDER ?? "ollama";
  const labels = framePaths
    .map(
      (frame, index) =>
        `${index + 1}. ${path.basename(frame).match(/(\d+)s/)?.[1] ?? "?"} 秒`,
    )
    .join("；");
  const prompt = `你是视频视觉分析师。只描述可见事实：画面主体、屏幕文字、真实界面变化与可剪辑结构。严禁补写抽帧中不存在的人物、场景或操作。以下图片按全片时间均匀抽取：${labels}。分析参考视频《${title}》，逐个时间点说明可见内容，再给出简洁中文视觉摘要。`;
  if (provider === "ollama") return analyzeFramesWithOllama(framePaths, prompt);
  return analyzeFramesWithDashscope(framePaths, prompt);
}

async function analyzeFramesWithOllama(framePaths: string[], prompt: string) {
  const baseUrl = process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434";
  const model = process.env.OLLAMA_VISION_MODEL ?? "openbmb/minicpm-v4.6";
  const images = await Promise.all(
    framePaths.map(async (frame) => (await readFile(frame)).toString("base64")),
  );
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(45_000),
    body: JSON.stringify({
      model,
      stream: false,
      options: { temperature: 0.1, num_ctx: 4096 },
      messages: [{ role: "user", content: prompt, images }],
    }),
  });
  if (!response.ok)
    throw new Error(
      `本地 MiniCPM-V 视觉理解调用失败：${response.status} ${await response.text()}`,
    );
  const payload = (await response.json()) as { message?: { content?: string } };
  const content = payload.message?.content;
  if (!content) throw new Error("MiniCPM-V 没有返回视觉摘要");
  return content;
}

async function analyzeFramesWithDashscope(
  framePaths: string[],
  prompt: string,
) {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  const baseUrl = process.env.DASHSCOPE_BASE_URL;
  const model = process.env.DASHSCOPE_VISION_MODEL;
  if (!apiKey || !baseUrl || !model)
    throw new Error(
      "视觉理解未配置 DASHSCOPE_API_KEY、DASHSCOPE_BASE_URL 或 DASHSCOPE_VISION_MODEL",
    );
  const images = (
    await Promise.all(
      framePaths.map(async (frame, index) => [
        {
          type: "text",
          text: `第 ${index + 1} 张：${path.basename(frame).match(/(\d+)s/)?.[1] ?? "?"} 秒`,
        },
        {
          type: "image_url",
          image_url: {
            url: `data:image/jpeg;base64,${(await readFile(frame)).toString("base64")}`,
          },
        },
      ]),
    )
  ).flat();
  const response = await fetch(
    `${baseUrl.replace(/\/$/, "")}/chat/completions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(45_000),
      body: JSON.stringify({
        model,
        max_tokens: 1000,
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: prompt }, ...images],
          },
        ],
      }),
    },
  );
  if (!response.ok)
    throw new Error(
      `视觉理解调用失败：${response.status} ${await response.text()}`,
    );
  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error("视觉模型没有返回分析结果");
  return content;
}

async function buildReferenceAnalysis(input: {
  title: string;
  sourceUrl: string;
  transcript: string;
  visualSummary: string;
  sourceDescription: string;
  durationSeconds: number;
}): Promise<ReferenceResult> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  const baseUrl = process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com";
  const model = process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash";
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY 未配置");
  const response = await fetch(
    `${baseUrl.replace(/\/$/, "")}/chat/completions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        stream: false,
        max_tokens: 3000,
        response_format: { type: "json_object" },
        thinking: { type: "disabled" },
        messages: [
          {
            role: "system",
            content:
              `你是 Avin 的短视频策划与拉片编辑。${AVIN_ACCOUNT_DNA} ${AVIN_VOICE_DIRECTION} 分析参考素材的节奏、结构和可见表达，但不得逐句抄写、复刻原作者文案、可识别声纹或仿制产品界面。请基于给定事实写一条全新的中文科普口播。必须采用有证据的第一视角体验：可以说‘我把这段演示拆了一遍、我在画面里看到、我真正关心的是、我会把它用在’，不能声称实际注册、付费或使用了来源没有证明的功能。结构固定为：普通人痛点→反常识结果→可信证据→实际演示→使用限制→Avin 判断。shotList 必须使用字幕中真实存在的时间码，并覆盖全片不同操作阶段；visual 与 storyboard.visual 只能描述抽帧摘要明确可见的原视频画面，禁止补写不存在的生活化 B-roll。${AVIN_EVIDENCE_RULES} 避免百科式功能罗列、教程腔和‘效率神器/快去试试’。仅输出 JSON：summary、style({hook,pacing,structure,visualStyle})、shotList([{order,startSeconds,endSeconds,visual,spokenPoint,editingNotes}])、draft({title,hook,script,caption,hashtags,storyboard})。storyboard 4-6 段，每段含 scene,durationSeconds,claim,evidenceType,evidenceRequirement,visual,narration,onScreenText,avatarAction。evidenceType 仅可为 OFFICIAL_DEMO、PRODUCT_UI、GITHUB_PROOF、DATA_PROOF、RESULT_PROOF、LIMIT_PROOF、AVIN_COMMENTARY；avatarAction 只能为 IDLE、TALK、POINT_LEFT、THINK、SURPRISED、EXPLAIN、QUESTION、LIKE、SMILE、SHAKE_HEAD。`,
          },
          { role: "user", content: JSON.stringify(input) },
        ],
      }),
    },
  );
  if (!response.ok)
    throw new Error(
      `DeepSeek 拉片生成失败：${response.status} ${await response.text()}`,
    );
  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const raw = payload.choices?.[0]?.message?.content;
  if (!raw) throw new Error("DeepSeek 没有返回拉片结果");
  const result = JSON.parse(raw) as ReferenceResult;
  if (
    !result.summary ||
    !result.draft?.title ||
    !Array.isArray(result.shotList) ||
    !hasCompleteEvidenceMap(result.draft.storyboard)
  )
    throw new Error("拉片 JSON 格式无效");
  result.draft.hashtags = Array.isArray(result.draft.hashtags)
    ? result.draft.hashtags.map(String).slice(0, 7)
    : [];
  result.draft.storyboard = normalizeEvidenceStoryboard(
    result.draft.storyboard as unknown as Array<Record<string, unknown>>,
  ).map((scene, index) => ({
    ...scene,
    scene: index + 1,
    avatarAction: String(scene.avatarAction || "TALK"),
  }));
  return result;
}

async function probeDuration(videoPath: string) {
  const { stdout } = await run("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=nw=1:nk=1",
    videoPath,
  ]);
  return Math.max(1, Number(stdout.trim()) || 1);
}

function validateShotCoverage(
  shots: ReferenceResult["shotList"],
  durationSeconds: number,
) {
  const valid = shots.filter(
    (shot) =>
      Number.isFinite(Number(shot.startSeconds)) &&
      Number.isFinite(Number(shot.endSeconds)) &&
      shot.startSeconds >= 0 &&
      shot.endSeconds > shot.startSeconds &&
      shot.endSeconds <= durationSeconds + 3,
  );
  const minShots =
    durationSeconds <= 25 ? 2 : durationSeconds <= 60 ? 3 : 4;
  const bucketWidth = Math.max(3, durationSeconds / Math.max(6, minShots * 2));
  const buckets = new Set(
    valid.map((shot) => Math.floor(shot.startSeconds / bucketWidth)),
  );
  const laterThreshold = durationSeconds <= 25 ? 0.35 : 0.55;
  const coversLaterVideo =
    Math.max(...valid.map((shot) => shot.startSeconds), 0) >=
    durationSeconds * laterThreshold;
  if (valid.length < minShots || buckets.size < minShots || !coversLaterVideo)
    throw new Error(
      `拉片时间码质量校验失败：视频 ${durationSeconds.toFixed(0)} 秒，但镜头未覆盖全片多个真实阶段。已阻止错误拉片进入成片流程。`,
    );
}

function compactTimedSrt(value: string) {
  const blocks = value.split(/\r?\n\s*\r?\n/);
  const rows: string[] = [];
  let previous = "";
  for (const block of blocks) {
    const lines = block
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const timing = lines.find((line) => line.includes("-->"));
    if (!timing) continue;
    const text = lines
      .filter((line) => !/^\d+$/.test(line) && !line.includes("-->"))
      .join(" ")
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!text || text === previous) continue;
    previous = text;
    const start = timing
      .split("-->")[0]
      .trim()
      .replace(/^00:/, "")
      .replace(/,\d+$/, "");
    rows.push(`[${start}] ${text}`);
  }
  return rows.join("\n").slice(0, 30_000);
}
