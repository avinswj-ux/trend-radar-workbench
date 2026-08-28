import { Prisma } from "@prisma/client";
import { analyzeContent } from "@/lib/analysis";
import { generateDraft } from "@/lib/content-generation";
import { prisma } from "@/lib/prisma";
import { scoreContent } from "@/lib/scoring";
import { enrichAndAttachXNewsAssets, loadXNewsDraftContext } from "@/lib/x-news-assets";
import { generateXhsVisuals } from "@/lib/xhs-visuals";

async function main() {
  const items = await prisma.contentItem.findMany({
    where: { source: { type: "X_BOOKMARK" } },
    orderBy: { createdAt: "desc" },
  });
  for (const seed of items) {
    await enrichAndAttachXNewsAssets(seed.id);
    const item = await prisma.contentItem.findUniqueOrThrow({
      where: { id: seed.id },
      include: { analysis: true },
    });
    const analysis = await analyzeContent(item);
    const score = scoreContent(item, analysis);
    await prisma.$transaction([
      prisma.contentItem.update({
        where: { id: item.id },
        data: { category: analysis.category, topicTheme: analysis.topicTheme },
      }),
      prisma.aiAnalysis.upsert({
        where: { contentItemId: item.id },
        create: {
          contentItemId: item.id,
          model: analysis.model,
          summary: analysis.summary,
          tags: analysis.tags,
          entities: analysis.entities as Prisma.InputJsonValue,
          chineseAngle: analysis.chineseAngle,
          riskFlags: analysis.riskFlags,
        },
        update: {
          model: analysis.model,
          summary: analysis.summary,
          tags: analysis.tags,
          entities: analysis.entities as Prisma.InputJsonValue,
          chineseAngle: analysis.chineseAngle,
          riskFlags: analysis.riskFlags,
        },
      }),
      prisma.trendScore.upsert({
        where: { contentItemId: item.id },
        create: { contentItemId: item.id, ...score },
        update: score,
      }),
    ]);
    const extras = await loadXNewsDraftContext(item.id);
    const fresh = await prisma.contentItem.findUniqueOrThrow({
      where: { id: item.id },
      include: { analysis: true },
    });
    const generated = await generateDraft(
      {
        ...fresh,
        sourceImages: extras.sourceImages,
        quote: extras.quote,
        articleUrl: extras.articleUrl,
      },
      "XIAOHONGSHU",
    );
    const draft = await prisma.contentDraft.upsert({
      where: { contentItemId_platform: { contentItemId: item.id, platform: "XIAOHONGSHU" } },
      create: {
        contentItemId: item.id,
        platform: "XIAOHONGSHU",
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
    await generateXhsVisuals(draft, { sourceImages: extras.sourceImages });
    console.log((item.body ?? "").length, generated.script.replace(/\s+/g, "").length, generated.model, generated.title);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
