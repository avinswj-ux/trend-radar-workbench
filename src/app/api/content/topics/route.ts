import { CandidateStatus, SourceType } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { topicThemes } from "@/lib/topic-theme";
import { fetchReferenceContent } from "@/lib/reference-content";
import { analyzeContent } from "@/lib/analysis";
import { scoreContent } from "@/lib/scoring";

const inputSchema = z.object({
  title: z.string().trim().min(2, "请输入至少 2 个字的选题标题").max(180),
  sourceUrl: z.string().trim().url("来源链接格式不正确").optional().or(z.literal("")),
  notes: z.string().trim().max(8_000).optional(),
  topicTheme: z.enum(topicThemes).optional(),
});

export async function POST(request: NextRequest) {
  const parsed = inputSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "输入不正确" }, { status: 400 });
  const { title, sourceUrl, notes, topicTheme } = parsed.data;
  let referenceText = "";
  let referenceNotice = "";
  if (sourceUrl) {
    try { referenceText = (await fetchReferenceContent(sourceUrl)).text; }
    catch (cause) { referenceNotice = `参考链接暂时无法读取：${cause instanceof Error ? cause.message : "未知错误"}`; }
  }
  const body = [notes?.trim(), referenceText && `参考链接正文：${referenceText}`, referenceNotice]
    .filter(Boolean)
    .join("\n\n") || "这是一个手动录入的选题。当前只有标题信息，分析与创作必须保持保守，不得补充未经确认的事实。";
  const source = await prisma.source.findFirst({ where: { name: "手动选题", type: SourceType.WEB } })
    ?? await prisma.source.create({ data: { name: "手动选题", type: SourceType.WEB, config: { mode: "manual" }, enabled: false } });
  const item = await prisma.contentItem.create({
    data: {
      sourceId: source.id,
      title,
      canonicalUrl: sourceUrl || `manual://topic/${crypto.randomUUID()}`,
      body,
      topicTheme,
      language: "zh",
      publishedAt: new Date(),
    },
  });
  const analysis = await analyzeContent(item);
  const score = scoreContent(item, analysis);
  await prisma.$transaction([
    prisma.contentItem.update({ where: { id: item.id }, data: { category: analysis.category, topicTheme: topicTheme ?? analysis.topicTheme } }),
    prisma.aiAnalysis.create({ data: { contentItemId: item.id, model: analysis.model, summary: analysis.summary, tags: analysis.tags, entities: analysis.entities, chineseAngle: analysis.chineseAngle, riskFlags: analysis.riskFlags } }),
    prisma.trendScore.create({ data: { contentItemId: item.id, ...score } }),
  ]);
  const candidate = await prisma.dailyCandidate.create({
    data: { date: new Date(), contentItemId: item.id, rank: 999, status: CandidateStatus.SELECTED, editorNote: "手动录入" },
    include: { contentItem: { include: { analysis: true, score: true } } },
  });
  return NextResponse.json(candidate, { status: 201 });
}
