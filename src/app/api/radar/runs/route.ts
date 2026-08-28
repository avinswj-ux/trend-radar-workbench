import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const runs = await prisma.crawlRun.findMany({
    orderBy: { startedAt: "desc" }, take: 20,
    include: { source: { select: { name: true, type: true } } },
  });
  return NextResponse.json({ runs });
}
