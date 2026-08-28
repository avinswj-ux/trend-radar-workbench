import { ContentPlatform, Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { generateDraft } from "@/lib/content-generation";
import { prisma } from "@/lib/prisma";
import { normalizeEvidenceStoryboard } from "@/lib/evidence-map";
import { loadXNewsDraftContext } from "@/lib/x-news-assets";
import { readImageInventory } from "@/lib/x-news-image-text";
import { invalidateXhsVisuals } from "@/lib/xhs-visuals";

const schema = z.object({
  contentItemId: z.string().min(1),
  platform: z.nativeEnum(ContentPlatform),
});

export async function GET(request: NextRequest) {
  const contentItemId = request.nextUrl.searchParams.get("contentItemId");
  return NextResponse.json({
    drafts: await prisma.contentDraft.findMany({
      where: contentItemId ? { contentItemId } : undefined,
      include: {
        contentItem: { select: { title: true, canonicalUrl: true } },
        narrationClips: { orderBy: { scene: "asc" } },
      },
      orderBy: { updatedAt: "desc" },
    }),
  });
}

export async function POST(request: NextRequest) {
  const input = schema.safeParse(await request.json());
  if (!input.success)
    return NextResponse.json({ error: input.error.flatten() }, { status: 400 });
  const item = await prisma.contentItem.findUnique({
    where: { id: input.data.contentItemId },
    include: {
      analysis: true,
      source: true,
      mediaAssets: {
        where: { status: "ANALYZED" },
        orderBy: { updatedAt: "desc" },
        take: 1,
      },
    },
  });
  if (!item) return NextResponse.json({ error: "选题不存在" }, { status: 404 });
  const reference = item.mediaAssets[0]?.shotList as {
    draft?: {
      title?: string;
      hook?: string;
      script?: string;
      caption?: string;
      hashtags?: unknown;
      storyboard?: unknown;
    };
  } | null;
  const isYouTubeVideo =
    item.source.type === "YOUTUBE" &&
    input.data.platform === ContentPlatform.DOUYIN;
  if (isYouTubeVideo && !reference?.draft) {
    return NextResponse.json(
      {
        error:
          "这是 YouTube 视频选题，请先完成素材下载、视觉理解与拉片，再生成脚本。",
      },
      { status: 409 },
    );
  }
  const generated = isYouTubeVideo
    ? {
        model: "deepseek:reference-rewrite",
        title: String(reference!.draft!.title ?? item.title),
        hook: String(reference!.draft!.hook ?? ""),
        script: String(reference!.draft!.script ?? ""),
        caption: String(reference!.draft!.caption ?? ""),
        hashtags: Array.isArray(reference!.draft!.hashtags)
          ? reference!.draft!.hashtags.map(String)
          : [],
        storyboard: Array.isArray(reference!.draft!.storyboard)
          ? normalizeEvidenceStoryboard(
              reference!.draft!.storyboard.map((raw) =>
                raw && typeof raw === "object"
                  ? (raw as Record<string, unknown>)
                  : {},
              ),
            )
          : [],
      }
    : await generateDraft(
        await (async () => {
          const extras = await loadXNewsDraftContext(item.id);
          return {
            ...item,
            ...extras,
            imageInventory: await readImageInventory(extras.imageFiles),
          };
        })(),
        input.data.platform,
      );
  const saved = await prisma.contentDraft.upsert({
    where: { contentItemId_platform: input.data },
    create: {
      contentItemId: item.id,
      platform: input.data.platform,
      ...generated,
      hashtags: generated.hashtags,
      storyboard: generated.storyboard as Prisma.InputJsonValue,
    },
    update: {
      ...generated,
      hashtags: generated.hashtags,
      storyboard: generated.storyboard as Prisma.InputJsonValue,
    },
  });
  // Any regenerated copy invalidates the previous review; stale approval must never carry over.
  await prisma.narrationClip.deleteMany({ where: { draftId: saved.id } });
  await prisma.publishReview.deleteMany({ where: { draftId: saved.id } });
  await prisma.videoRender.deleteMany({ where: { draftId: saved.id } });
  await invalidateXhsVisuals(saved.id);
  return NextResponse.json(
    await prisma.contentDraft.findUniqueOrThrow({
      where: { id: saved.id },
      include: {
        narrationClips: { orderBy: { scene: "asc" } },
        publishReview: true,
        videoRender: true,
      },
    }),
    { status: 201 },
  );
}
