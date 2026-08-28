import { Queue } from "bullmq";
import IORedis from "ioredis";
import { prisma } from "@/lib/prisma";

const connection = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", { maxRetriesPerRequest: null });

export const radarQueue = new Queue("trend-radar", { connection });

export type CrawlJob = { sourceId: string; runId?: string };

const jobOptions = { attempts: 3, backoff: { type: "exponential" as const, delay: 30_000 }, removeOnComplete: 100, removeOnFail: 200 };

export async function enqueueCrawl(sourceId: string) {
  const run = await prisma.crawlRun.create({ data: { sourceId, status: "QUEUED" } });
  await radarQueue.add("crawl-source", { sourceId, runId: run.id }, { ...jobOptions, jobId: run.id });
  return run;
}

export async function enqueueXNewsProduce(contentItemId: string) {
  await radarQueue.add(
    "produce-x-news",
    { contentItemId },
    { ...jobOptions, jobId: `xnews:${contentItemId}` },
  );
}

export async function syncSourceSchedule(source: { id: string; enabled: boolean; schedule: string | null }) {
  const schedulerId = `source:${source.id}`;
  if (!source.enabled || !source.schedule || source.schedule === "manual") {
    await radarQueue.removeJobScheduler(schedulerId);
    return;
  }
  await radarQueue.upsertJobScheduler(schedulerId, { pattern: source.schedule, tz: "Asia/Shanghai" }, {
    name: "scheduled-crawl", data: { sourceId: source.id }, opts: jobOptions,
  });
}

export async function syncAllSourceSchedules() {
  const sources = await prisma.source.findMany({ select: { id: true, enabled: true, schedule: true } });
  await Promise.all(sources.map((source) => syncSourceSchedule(source)));
}
