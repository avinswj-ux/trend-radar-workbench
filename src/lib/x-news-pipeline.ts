import { ContentPlatform, Prisma } from "@prisma/client";
import { xNewsLabel } from "@/config/x-news-accounts";
import { generateDraft, type DraftResult } from "@/lib/content-generation";
import { prisma } from "@/lib/prisma";
import { enrichAndAttachXNewsAssets, loadXNewsDraftContext } from "@/lib/x-news-assets";
import { generateXhsVisuals } from "@/lib/xhs-visuals";
import { readImageInventory } from "@/lib/x-news-image-text";

function xNewsNote(author?: string | null) {
  return `${xNewsLabel(author)}图文`;
}

async function savePlatformDraft(
  contentItemId: string,
  platform: ContentPlatform,
  generated: DraftResult,
) {
  return prisma.contentDraft.upsert({
    where: { contentItemId_platform: { contentItemId, platform } },
    create: {
      contentItemId,
      platform,
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
}

export async function produceXNewsDraft(contentItemId: string) {
  const images = await enrichAndAttachXNewsAssets(contentItemId);
  const extras = await loadXNewsDraftContext(contentItemId);
  const item = await prisma.contentItem.findUniqueOrThrow({
    where: { id: contentItemId },
    include: { analysis: true, rawItem: { select: { payload: true } } },
  });
  const imageInventory = await readImageInventory(extras.imageFiles);
  const draftInput = {
    ...item,
    sourceImages: extras.sourceImages,
    imageInventory,
    quote: extras.quote,
    articleUrl: extras.articleUrl,
  };
  const generated = await generateDraft(draftInput, "XIAOHONGSHU");
  const draft = await savePlatformDraft(contentItemId, "XIAOHONGSHU", generated);
  await generateXhsVisuals(draft, { sourceImages: extras.sourceImages });
  if (images.length) {
    const douyin = await generateDraft(draftInput, "DOUYIN");
    await savePlatformDraft(contentItemId, "DOUYIN", douyin);
  }
  const day = new Date();
  day.setUTCHours(0, 0, 0, 0);
  await prisma.dailyCandidate.upsert({
    where: { date_contentItemId: { date: day, contentItemId } },
    create: {
      date: day,
      contentItemId,
      rank: 1,
      status: "PENDING",
      editorNote: `${xNewsNote(item.author)}，待挑选`,
    },
    update: { editorNote: `${xNewsNote(item.author)}，待挑选` },
  });
  return { draft, images };
}
