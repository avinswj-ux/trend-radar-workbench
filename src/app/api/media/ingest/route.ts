import { AssetRights } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { startIngestThenAnalyze } from "@/lib/media-pipeline";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const schema = z.object({ contentItemId: z.string().min(1), rights: z.nativeEnum(AssetRights) });

export async function POST(request: NextRequest) {
  const input = schema.safeParse(await request.json());
  if (!input.success) return NextResponse.json({ error: input.error.flatten() }, { status: 400 });
  const item = await prisma.contentItem.findUnique({ where: { id: input.data.contentItemId }, select: { id: true, canonicalUrl: true, mediaLicense: true, source: { select: { type: true } } } });
  if (!item) return NextResponse.json({ error: "内容不存在" }, { status: 404 });
  if (item.source.type !== "YOUTUBE") return NextResponse.json({ error: "V1 仅支持从 YouTube 候选拉取素材" }, { status: 400 });
  if (input.data.rights === AssetRights.CC_BY && item.mediaLicense !== "creativeCommon") {
    return NextResponse.json({ error: "该视频的 YouTube 元数据显示并非 Creative Commons；请仅在拥有、获得书面授权时再处理素材。" }, { status: 403 });
  }
  const asset = await prisma.mediaAsset.create({ data: { contentItemId: item.id, sourceUrl: item.canonicalUrl, rights: input.data.rights } });
  startIngestThenAnalyze(asset.id);
  return NextResponse.json(asset, { status: 202 });
}

export async function GET(request: NextRequest) {
  const contentItemId = request.nextUrl.searchParams.get("contentItemId");
  return NextResponse.json({ assets: await prisma.mediaAsset.findMany({ where: contentItemId ? { contentItemId } : undefined, orderBy: { updatedAt: "desc" } }) });
}
