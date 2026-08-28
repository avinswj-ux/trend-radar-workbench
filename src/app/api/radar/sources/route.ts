import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { sourceSchema } from "@/lib/contracts";
import { prisma } from "@/lib/prisma";
import { syncSourceSchedule } from "@/lib/queue";

export async function GET() {
  const sources = await prisma.source.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { runs: true, items: true } } },
  });
  return NextResponse.json({ sources });
}

export async function POST(request: NextRequest) {
  const input = sourceSchema.safeParse(await request.json());
  if (!input.success) return NextResponse.json({ error: input.error.flatten() }, { status: 400 });

  const source = await prisma.source.create({
    data: { ...input.data, config: input.data.config as Prisma.InputJsonValue },
  });
  await syncSourceSchedule(source);
  return NextResponse.json(source, { status: 201 });
}
