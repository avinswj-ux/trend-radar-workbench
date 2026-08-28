import "server-only";

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { prisma } from "@/lib/prisma";
import { synthesizeWithVolcengine } from "@/lib/tts/volcengine";
import { narrationCollapsed, repairStoryboardNarrations } from "@/lib/scene-narration";
import { Prisma } from "@prisma/client";

const run = promisify(execFile);

export function avinTtsTempo() {
  return Math.max(0.85, Math.min(1.25, Number(process.env.AVIN_TTS_TEMPO) || 1));
}

export function avinTtsSpeechRate() {
  return 28;
}

export function avinVoiceSignature() {
  return "zh_male_dayi_uranus_bigtts@sr28-shortform-v3";
}

type StoryboardScene = { narration?: unknown };
type ExistingClip = { scene: number; text: string; audioUrl: string; voice?: string };

export function narrationScenes(storyboard: unknown) {
  if (!Array.isArray(storyboard)) return [];
  return storyboard.map((raw, index) => ({
    scene: index + 1,
    narration:
      raw && typeof raw === "object"
        ? String((raw as StoryboardScene).narration ?? "").trim()
        : "",
  }));
}

export function missingNarrationScenes(
  storyboard: unknown,
  clips: ExistingClip[],
  expectedVoice?: string,
) {
  const scenes = narrationScenes(storyboard);
  return scenes.filter((scene) => {
    const clip = clips.find((item) => item.scene === scene.scene);
    if (
      !clip ||
      clip.text.trim() !== scene.narration ||
      (expectedVoice && clip.voice !== expectedVoice)
    )
      return true;
    const audioPath = path.join(
      process.cwd(),
      "public",
      clip.audioUrl.replace(/^\//, ""),
    );
    return !existsSync(audioPath);
  });
}

export async function generateNarrationClips(
  draftId: string,
  options: { force?: boolean } = {},
) {
  let draft = await prisma.contentDraft.findUnique({
    where: { id: draftId },
    include: { narrationClips: { orderBy: { scene: "asc" } } },
  });
  if (!draft) throw new Error("内容稿不存在");
  if (draft.platform !== "DOUYIN") {
    throw new Error("小红书图文复用内容母稿，不单独生成 TTS；请在抖音稿生成旁白");
  }

  const current = narrationScenes(draft.storyboard);
  if (!current.length) throw new Error("内容稿没有可合成的分镜");
  if (narrationCollapsed(current.map((scene) => scene.narration), draft.script)) {
    const repaired = repairStoryboardNarrations(
      (Array.isArray(draft.storyboard) ? draft.storyboard : []) as Array<{ narration?: unknown }>,
      draft.script,
    );
    draft = await prisma.contentDraft.update({
      where: { id: draft.id },
      data: {
        storyboard: repaired as Prisma.InputJsonValue,
        script: repaired.map((scene) => String(scene.narration ?? "")).filter(Boolean).join("\n\n"),
      },
      include: { narrationClips: { orderBy: { scene: "asc" } } },
    });
  }

  const scenes = narrationScenes(draft.storyboard);
  if (!scenes.length) throw new Error("内容稿没有可合成的分镜");
  const empty = scenes.find((scene) => !scene.narration);
  if (empty) throw new Error(`第 ${empty.scene} 段缺少旁白，请先完善分镜`);

  const lengths = scenes.map((scene) => scene.narration.length);
  const totalLength = lengths.reduce((sum, length) => sum + length, 0);
  const abnormalIndex = lengths.findIndex(
    (length) => length > 260 || (scenes.length > 1 && length > totalLength * 0.45),
  );
  if (abnormalIndex >= 0) {
    throw new Error(
      `第 ${abnormalIndex + 1} 段旁白仍然过长，请先把口播拆到各分镜再生成 TTS`,
    );
  }

  const voice = avinVoiceSignature();
  const missing = options.force
    ? scenes
    : missingNarrationScenes(draft.storyboard, draft.narrationClips);
  if (!missing.length && draft.narrationClips.length === scenes.length) {
    return draft.narrationClips;
  }

  const outputDir = path.join(process.cwd(), "public", "generated", "tts", draft.id);
  await mkdir(outputDir, { recursive: true });

  for (const scene of missing) {
    const audio = await synthesizeWithVolcengine(scene.narration);
    const filename = `scene-${scene.scene}.mp3`;
    const outputPath = path.join(outputDir, filename);
    const rawPath = path.join(outputDir, `scene-${scene.scene}.raw.mp3`);
    await writeFile(rawPath, audio);
    await run(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        rawPath,
        "-filter:a",
        "highpass=f=75,equalizer=f=2600:t=q:w=1.1:g=2.2,acompressor=threshold=-20dB:ratio=2.6:attack=8:release=90:makeup=1.5,loudnorm=I=-16:TP=-1.5:LRA=7",
        "-codec:a",
        "libmp3lame",
        "-b:a",
        "160k",
        outputPath,
      ],
      { timeout: 120_000, maxBuffer: 2 * 1024 * 1024 },
    );
    await rm(rawPath, { force: true });
    const audioUrl = `/generated/tts/${draft.id}/${filename}`;
    await prisma.narrationClip.upsert({
      where: { draftId_scene: { draftId: draft.id, scene: scene.scene } },
      create: {
        draftId: draft.id,
        scene: scene.scene,
        text: scene.narration,
        voice,
        audioUrl,
      },
      update: { text: scene.narration, voice, audioUrl },
    });
  }

  await prisma.narrationClip.deleteMany({
    where: { draftId: draft.id, scene: { gt: scenes.length } },
  });
  return prisma.narrationClip.findMany({
    where: { draftId: draft.id },
    orderBy: { scene: "asc" },
  });
}
