import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { renderDraftVideo } from "@/lib/video-render";
import { generateNarrationClips, missingNarrationScenes } from "@/lib/narration-generation";
import { ensureDynamicSource } from "@/lib/dynamic-source-discovery";
import { hasCompleteEvidenceMap } from "@/lib/evidence-map";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return NextResponse.json({ render: await prisma.videoRender.findUnique({ where: { draftId: id } }) });
}

export async function POST(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const draft = await prisma.contentDraft.findUnique({
    where: { id },
    include: {
      publishReview: true,
      narrationClips: true,
      contentItem: { include: { source: true } },
    },
  });
  if (!draft) return NextResponse.json({ error: "稿件不存在" }, { status: 404 });
  if (draft.platform !== "DOUYIN") return NextResponse.json({ error: "小红书稿请使用图文图片，不生成伪视频" }, { status: 400 });
  if (draft.publishReview?.status !== "PASSED") return NextResponse.json({ error: "请先通过发布前审查" }, { status: 409 });
  if (!hasCompleteEvidenceMap(draft.storyboard)) return NextResponse.json({ error: "当前稿件缺少“口播观点—证据画面”映射，请先重新生成抖音脚本再成片" }, { status: 409 });
  const activeRender = await prisma.videoRender.findUnique({ where: { draftId: id } });
  if (activeRender && ["QUEUED", "RENDERING"].includes(activeRender.status)) {
    return NextResponse.json(activeRender, { status: 202 });
  }
  try {
    // A YouTube topic must use its selected source. Other topics first attempt to
    // acquire CC/official motion footage, then use local motion graphics.
    if (
      draft.contentItem.source.type !== "YOUTUBE" &&
      draft.contentItem.source.type !== "X_BOOKMARK"
    ) {
      await ensureDynamicSource(draft.contentItemId);
    }
    if (
      missingNarrationScenes(draft.storyboard, draft.narrationClips).length ||
      draft.narrationClips.length !== (Array.isArray(draft.storyboard) ? draft.storyboard.length : 0)
    ) {
      await generateNarrationClips(id);
    }
  } catch (cause) {
    return NextResponse.json(
      { error: cause instanceof Error ? cause.message : "动态素材准备失败" },
      { status: 422 },
    );
  }
  const render = await prisma.videoRender.upsert({ where: { draftId: id }, create: { draftId: id }, update: { status: "QUEUED", progress: 0, outputUrl: null, visualMode: null, error: null } });
  void renderDraftVideo(render.id);
  return NextResponse.json(render, { status: 202 });
}
