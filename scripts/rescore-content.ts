import type { ContentCategory } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { scoreContent } from "@/lib/scoring";
import { rebuildTodayCandidates } from "@/lib/candidates";
import { inferTopicTheme, type TopicTheme } from "@/lib/topic-theme";

async function main() {
  const items = await prisma.contentItem.findMany({
    where: { analysis: { isNot: null } },
    include: { analysis: true },
  });

  for (const item of items) {
    if (!item.analysis) continue;
    const analysis = {
    category: (item.category ?? "TOOL") as ContentCategory,
    topicTheme: (item.topicTheme ?? inferTopicTheme(`${item.title} ${item.body ?? ""}`)) as TopicTheme,
    summary: item.analysis.summary,
    tags: Array.isArray(item.analysis.tags) ? item.analysis.tags.map(String) : [],
    entities: Array.isArray(item.analysis.entities)
      ? item.analysis.entities.map((entity) => {
          const value = entity && typeof entity === "object" ? entity as Record<string, unknown> : {};
          return {
            type: String(value.type ?? "source"),
            name: String(value.name ?? item.title),
            url: value.url ? String(value.url) : null,
          };
        })
      : [],
    chineseAngle: item.analysis.chineseAngle ?? "从普通人的真实任务验证它能带来什么能力。",
    riskFlags: Array.isArray(item.analysis.riskFlags) ? item.analysis.riskFlags.map(String) : [],
    model: item.analysis.model,
    };
    const score = scoreContent(item, analysis);
    await prisma.trendScore.upsert({
      where: { contentItemId: item.id },
      create: { contentItemId: item.id, ...score },
      update: score,
    });
  }

  const candidates = await rebuildTodayCandidates();
  console.info(`Rescored ${items.length} items; rebuilt ${candidates} candidates.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
