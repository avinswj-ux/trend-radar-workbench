import { MediaAssetStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { startIngestThenAnalyze } from "@/lib/media-pipeline";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const asset = await prisma.mediaAsset.findUnique({ where: { id }, select: { id: true, status: true } });
  if (!asset) return NextResponse.json({ error: "素材任务不存在" }, { status: 404 });
  if (
    asset.status !== MediaAssetStatus.FAILED &&
    asset.status !== MediaAssetStatus.ANALYZING &&
    asset.status !== MediaAssetStatus.DOWNLOADING
  ) {
    return NextResponse.json({ error: "仅失败或卡住的素材任务可以重试" }, { status: 409 });
  }
  await prisma.mediaAsset.update({ where: { id }, data: { status: MediaAssetStatus.QUEUED, error: null } });
  startIngestThenAnalyze(id);
  return NextResponse.json({ id, status: MediaAssetStatus.QUEUED }, { status: 202 });
}
