import { NextResponse } from "next/server";
import { buildProductionPlan } from "@/lib/production-plan";
import { prisma } from "@/lib/prisma";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const draft = await prisma.contentDraft.findUnique({
    where: { id },
    include: { contentItem: { select: { canonicalUrl: true } }, narrationClips: { orderBy: { scene: "asc" } } },
  });
  if (!draft) return NextResponse.json({ error: "草稿不存在" }, { status: 404 });
  return NextResponse.json(buildProductionPlan(draft, draft.contentItem.canonicalUrl, draft.narrationClips));
}
