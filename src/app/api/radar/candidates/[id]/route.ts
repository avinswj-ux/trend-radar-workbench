import { NextRequest, NextResponse } from "next/server";
import { updateCandidateSchema } from "@/lib/contracts";
import { prisma } from "@/lib/prisma";

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const body = updateCandidateSchema.safeParse(await request.json());
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });

  const { id } = await context.params;
  const candidate = await prisma.dailyCandidate.update({
    where: { id },
    data: body.data,
    include: { contentItem: { include: { analysis: true, score: true } } },
  });

  return NextResponse.json(candidate);
}
