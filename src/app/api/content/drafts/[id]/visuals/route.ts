import { ContentPlatform } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { loadXNewsDraftContext } from "@/lib/x-news-assets";
import { generateXhsVisuals, readXhsVisuals } from "@/lib/xhs-visuals";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return NextResponse.json({ visuals: await readXhsVisuals(id) });
}

export async function POST(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const draft = await prisma.contentDraft.findUnique({ where: { id } });
  if (!draft) return NextResponse.json({ error: "内容草稿不存在" }, { status: 404 });
  if (draft.platform !== ContentPlatform.XIAOHONGSHU) return NextResponse.json({ error: "图片组仅用于小红书草稿" }, { status: 400 });
  const extras = await loadXNewsDraftContext(draft.contentItemId);
  return NextResponse.json(
    { visuals: await generateXhsVisuals(draft, { sourceImages: extras.sourceImages }) },
    { status: 201 },
  );
}
