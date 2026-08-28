import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { matchYoutubeForTopic } from "@/lib/topic-youtube-match";

export async function POST() {
  const start = new Date(); start.setUTCHours(0, 0, 0, 0);
  const candidates = await prisma.dailyCandidate.findMany({
    where: { date: start, contentItem: { source: { type: { not: "YOUTUBE" } }, youtubeMatches: { none: {} } } },
    orderBy: { rank: "asc" }, take: 8, select: { contentItemId: true },
  });
  const results = [];
  for (const candidate of candidates) {
    try { results.push({ contentItemId: candidate.contentItemId, matches: (await matchYoutubeForTopic(candidate.contentItemId)).length }); }
    catch (error) { results.push({ contentItemId: candidate.contentItemId, error: error instanceof Error ? error.message : "匹配失败" }); }
  }
  return NextResponse.json({ searched: candidates.length, results });
}
