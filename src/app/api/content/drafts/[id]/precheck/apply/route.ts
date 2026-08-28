import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runPrecheckAndAutoAdopt } from "@/lib/publish-precheck-apply";

export async function POST(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const existing = await prisma.publishReview.findUnique({ where: { draftId: id } });
  const industry = (["general", "medical", "finance"].includes(existing?.industry ?? "")
    ? existing?.industry
    : "general") as "general" | "medical" | "finance";
  try {
    const draft = await runPrecheckAndAutoAdopt(id, {
      commercial: existing?.commercial ?? false,
      industry,
    });
    if (!draft) return NextResponse.json({ error: "稿件不存在" }, { status: 404 });
    return NextResponse.json(draft);
  } catch (cause) {
    return NextResponse.json({ error: cause instanceof Error ? cause.message : "采用修复稿失败" }, { status: 500 });
  }
}
