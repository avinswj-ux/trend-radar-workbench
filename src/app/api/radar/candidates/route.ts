import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const requestedDate = request.nextUrl.searchParams.get("date");
  const date = requestedDate ? new Date(`${requestedDate}T00:00:00.000Z`) : new Date();
  date.setUTCHours(0, 0, 0, 0);

  const candidates = await prisma.dailyCandidate.findMany({
    where: { date },
    orderBy: { rank: "asc" },
    include: {
      contentItem: { include: { analysis: true, score: true, source: true } },
    },
  });

  return NextResponse.json({ date: date.toISOString().slice(0, 10), candidates });
}
