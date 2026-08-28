import { Worker } from "bullmq";
import IORedis from "ioredis";
import { Prisma } from "@prisma/client";
import { enqueueXNewsProduce, syncAllSourceSchedules, type CrawlJob } from "@/lib/queue";
import { prisma } from "@/lib/prisma";
import { getSourceAdapter } from "@/lib/sources";
import { analyzeContent } from "@/lib/analysis";
import { scoreContent } from "@/lib/scoring";
import { rebuildTodayCandidates } from "@/lib/candidates";
import { produceXNewsDraft } from "@/lib/x-news-pipeline";
import {
  computeNewsFingerprint,
  fingerprintsOverlap,
  parseFingerprintKeys,
  titlesSimilar,
} from "@/lib/news-fingerprint";
import { xNewsLabel } from "@/config/x-news-accounts";

const connection = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", { maxRetriesPerRequest: null });
const X_NEWS_DEDUP_DAYS = 21;
const MAX_X_NEWS_PRODUCE_PER_RUN = 3;

type RadarJob = CrawlJob & { contentItemId?: string };

new Worker<RadarJob>("trend-radar", async (job) => {
  if (job.name === "produce-x-news") {
    const contentItemId = job.data.contentItemId;
    if (!contentItemId) throw new Error("produce-x-news 缺少 contentItemId");
    await produceXNewsDraft(contentItemId);
    return;
  }

  const { sourceId } = job.data;
  const runId = job.data.runId ?? (await prisma.crawlRun.create({ data: { sourceId, status: "QUEUED" } })).id;
  await prisma.crawlRun.update({ where: { id: runId }, data: { status: "RUNNING", startedAt: new Date() } });

  try {
    const source = await prisma.source.findUniqueOrThrow({ where: { id: sourceId } });
    const discoveries = await getSourceAdapter(source.type).discover(source.config);
    let created = 0;
    let skipped = 0;
    let produced = 0;
    const recentXNews = source.type === "X_BOOKMARK" ? await loadRecentXNews() : [];

    for (const discovery of discoveries) {
      const rawItem = await prisma.rawItem.create({
        data: { crawlRunId: runId, externalId: discovery.externalId, payload: discovery.rawPayload as Prisma.InputJsonValue },
      });
      const newsPrint = computeNewsFingerprint({
        title: discovery.title,
        body: discovery.body,
        canonicalUrl: discovery.canonicalUrl,
        rawPayload: discovery.rawPayload,
      });

      const exists = await prisma.contentItem.findUnique({ where: { canonicalUrl: discovery.canonicalUrl }, select: { id: true, mediaLicense: true, fingerprint: true } });
      if (exists) {
        const refresh: Prisma.ContentItemUpdateInput = {};
        if (discovery.mediaLicense && exists.mediaLicense !== discovery.mediaLicense) {
          refresh.mediaLicense = discovery.mediaLicense;
        }
        if (source.type === "X_BOOKMARK") {
          if (discovery.title) refresh.title = discovery.title;
          if ((discovery.body ?? "").replace(/\s+/g, "").length > 80) refresh.body = discovery.body;
          if (!exists.fingerprint) refresh.fingerprint = newsPrint.fingerprint;
          refresh.rawItem = { connect: { id: rawItem.id } };
        }
        if (Object.keys(refresh).length) {
          await prisma.contentItem.update({ where: { id: exists.id }, data: refresh });
        }
        skipped += 1;
        continue;
      }

      if (source.type === "X_BOOKMARK" && isDuplicateXNews(newsPrint.keys, discovery.title, discovery.author, recentXNews)) {
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
          fingerprint: newsPrint.fingerprint,
        },
      });
      recentXNews.unshift({ title: contentItem.title, fingerprint: newsPrint.fingerprint, author: contentItem.author });
      const analysis = await analyzeContent(contentItem);
      const score = scoreContent(contentItem, analysis);
      await prisma.$transaction([
        prisma.contentItem.update({ where: { id: contentItem.id }, data: { category: analysis.category, topicTheme: analysis.topicTheme } }),
        prisma.aiAnalysis.upsert({
          where: { contentItemId: contentItem.id },
          create: { contentItemId: contentItem.id, model: analysis.model, summary: analysis.summary, tags: analysis.tags, entities: analysis.entities as Prisma.InputJsonValue, chineseAngle: analysis.chineseAngle, riskFlags: analysis.riskFlags },
          update: { model: analysis.model, summary: analysis.summary, tags: analysis.tags, entities: analysis.entities as Prisma.InputJsonValue, chineseAngle: analysis.chineseAngle, riskFlags: analysis.riskFlags },
        }),
        prisma.trendScore.upsert({
          where: { contentItemId: contentItem.id },
          create: { contentItemId: contentItem.id, ...score },
          update: score,
        }),
      ]);
      if (source.type === "X_BOOKMARK" && produced < MAX_X_NEWS_PRODUCE_PER_RUN) {
        await enqueueXNewsProduce(contentItem.id);
        produced += 1;
      }
      created += 1;
    }

    const candidates = await rebuildTodayCandidates();

    await prisma.crawlRun.update({
      where: { id: runId },
      data: {
        status: "SUCCEEDED",
        finishedAt: new Date(),
        error: null,
        stats: { discovered: discoveries.length, created, skipped, produced, source: xNewsLabel(String((source.config as { username?: string } | null)?.username ?? "")), candidates },
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown crawl error";
    await prisma.crawlRun.update({ where: { id: runId }, data: { status: "FAILED", finishedAt: new Date(), error: message } });
    throw error;
  }
}, { connection, lockDuration: 10 * 60_000, stalledInterval: 60_000 });

async function loadRecentXNews() {
  const since = new Date();
  since.setDate(since.getDate() - X_NEWS_DEDUP_DAYS);
  return prisma.contentItem.findMany({
    where: { createdAt: { gte: since }, source: { type: "X_BOOKMARK" } },
    select: { title: true, fingerprint: true, author: true },
    orderBy: { createdAt: "desc" },
    take: 80,
  });
}

function isDuplicateXNews(
  keys: string[],
  title: string,
  author: string | null,
  existing: Array<{ title: string; fingerprint: string | null; author?: string | null }>,
) {
  return existing.some((item) => {
    if (author && item.author && author.toLowerCase() === item.author.toLowerCase()) return false;
    if (fingerprintsOverlap(keys, parseFingerprintKeys(item.fingerprint))) return true;
    return titlesSimilar(title, item.title);
  });
}

syncAllSourceSchedules().then(() => console.info("Trend Radar schedules are synchronized.")).catch((error) => console.error("Failed to synchronize schedules.", error));
console.info("Trend Radar worker is listening for jobs.");
