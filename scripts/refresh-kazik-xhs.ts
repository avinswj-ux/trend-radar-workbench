import { Prisma } from "@prisma/client";
import { analyzeContent } from "@/lib/analysis";
import { rebuildTodayCandidates } from "@/lib/candidates";
import { prisma } from "@/lib/prisma";
import { scoreContent } from "@/lib/scoring";
import { xAdapter } from "@/lib/sources/x";
import { produceXNewsDraft } from "@/lib/x-news-pipeline";

const sourceId = "kazik-x-news";

async function main() {
  const source = await prisma.source.update({
    where: { id: sourceId },
    data: { config: { username: "Khazix0918", limit: 8, minChars: 28 } },
  });
  const discoveries = await xAdapter.discover(source.config);
  const run = await prisma.crawlRun.create({
    data: { sourceId, status: "RUNNING", startedAt: new Date() },
  });
  let created = 0;
  let skipped = 0;

  for (const discovery of discoveries) {
    const rawItem = await prisma.rawItem.create({
      data: {
        crawlRunId: run.id,
        externalId: discovery.externalId,
        payload: discovery.rawPayload as Prisma.InputJsonValue,
      },
    });
    const exists = await prisma.contentItem.findUnique({
      where: { canonicalUrl: discovery.canonicalUrl },
      select: { id: true },
    });
    if (exists) {
      await prisma.contentItem.update({
        where: { id: exists.id },
        data: {
          title: discovery.title,
          body: discovery.body,
          rawItem: { connect: { id: rawItem.id } },
        },
      });
      skipped += 1;
      continue;
    }
    const contentItem = await prisma.contentItem.create({
      data: {
        sourceId,
        rawItemId: rawItem.id,
        canonicalUrl: discovery.canonicalUrl,
        title: discovery.title,
        body: discovery.body,
        author: discovery.author,
        publishedAt: discovery.publishedAt,
        language: discovery.language,
        mediaLicense: discovery.mediaLicense,
      },
    });
    const analysis = await analyzeContent(contentItem);
    const score = scoreContent(contentItem, analysis);
    await prisma.$transaction([
      prisma.contentItem.update({
        where: { id: contentItem.id },
        data: { category: analysis.category, topicTheme: analysis.topicTheme },
      }),
      prisma.aiAnalysis.upsert({
        where: { contentItemId: contentItem.id },
        create: {
          contentItemId: contentItem.id,
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
        where: { contentItemId: contentItem.id },
        create: { contentItemId: contentItem.id, ...score },
        update: score,
      }),
    ]);
    created += 1;
    console.log("created", contentItem.title.slice(0, 60));
  }

  await prisma.crawlRun.update({
    where: { id: run.id },
    data: {
      status: "SUCCEEDED",
      finishedAt: new Date(),
      stats: { discovered: discoveries.length, created, skipped },
    },
  });

  const items = await prisma.contentItem.findMany({
    where: { source: { type: "X_BOOKMARK" } },
    include: { analysis: true },
    orderBy: { createdAt: "desc" },
  });
  for (const item of items) {
    const { draft, images } = await produceXNewsDraft(item.id);
    console.log(draft.model, images.length, draft.title);
  }

  const candidates = await rebuildTodayCandidates();
  console.log(JSON.stringify({ discovered: discoveries.length, created, skipped, drafts: items.length, candidates }));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
