import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { enqueueCrawl } from "@/lib/queue";

export async function POST(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id: sourceId } = await context.params;
  const source = await prisma.source.findUnique({ where: { id: sourceId }, select: { id: true, enabled: true } });
  if (!source) return NextResponse.json({ error: "Source not found" }, { status: 404 });
  if (!source.enabled) return NextResponse.json({ error: "Source is disabled" }, { status: 409 });

  const run = await enqueueCrawl(sourceId);

  return NextResponse.json(run, { status: 202 });
}
