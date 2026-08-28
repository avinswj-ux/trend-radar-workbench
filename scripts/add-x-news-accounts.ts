import { Prisma } from "@prisma/client";
import { X_NEWS_ACCOUNTS } from "@/config/x-news-accounts";
import { computeNewsFingerprint } from "@/lib/news-fingerprint";
import { prisma } from "@/lib/prisma";
import { enqueueCrawl, radarQueue, syncSourceSchedule } from "@/lib/queue";

const crawlNew = process.argv.includes("--crawl");

async function main() {
  const sources = [];
  for (const account of X_NEWS_ACCOUNTS) {
    const config = { username: account.username, limit: account.limit, minChars: account.minChars };
    const existingSources = await prisma.source.findMany({ where: { type: "X_BOOKMARK" } });
    const existing = existingSources.find((source) => {
      const username = (source.config as { username?: string } | null)?.username;
      return source.name === account.name || username === account.username;
    });
    const source = existing
      ? await prisma.source.update({
          where: { id: existing.id },
          data: {
            name: account.name,
            type: "X_BOOKMARK",
            config: config as Prisma.InputJsonValue,
            schedule: account.schedule,
            enabled: true,
          },
        })
      : await prisma.source.create({
          data: {
            name: account.name,
            type: "X_BOOKMARK",
            config: config as Prisma.InputJsonValue,
            schedule: account.schedule,
            enabled: true,
          },
        });
    await syncSourceSchedule(source);
    sources.push({ account, source, created: !existing });
  }

  const items = await prisma.contentItem.findMany({
    where: { source: { type: "X_BOOKMARK" } },
    include: { rawItem: { select: { payload: true } } },
  });
  let fingerprinted = 0;
  for (const item of items) {
    const print = computeNewsFingerprint({
      title: item.title,
      body: item.body,
      canonicalUrl: item.canonicalUrl,
      rawPayload: (item.rawItem?.payload as Record<string, unknown> | null) ?? null,
    });
    if (item.fingerprint !== print.fingerprint) {
      await prisma.contentItem.update({ where: { id: item.id }, data: { fingerprint: print.fingerprint } });
      fingerprinted += 1;
    }
  }

  console.info(
    JSON.stringify(
      {
        sources: sources.map((entry) => ({
          id: entry.source.id,
          name: entry.source.name,
          username: entry.account.username,
          schedule: entry.account.schedule,
          created: entry.created,
        })),
        fingerprinted,
        existingXNews: items.length,
      },
      null,
      2,
    ),
  );

  if (!crawlNew) return;
  for (const entry of sources) {
    if (entry.account.username === "Khazix0918") continue;
    const run = await enqueueCrawl(entry.source.id);
    console.info(`queued ${entry.account.username} crawl ${run.id}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await radarQueue.close();
    await prisma.$disconnect();
  });
