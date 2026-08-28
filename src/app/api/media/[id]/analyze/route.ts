import { MediaAssetStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { analyzeMediaAsset } from "@/lib/media-analysis";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const asset = await prisma.mediaAsset.findUnique({ where: { id } });
  if (!asset) return NextResponse.json({ error: "素材不存在" }, { status: 404 });
  if (
    asset.status !== MediaAssetStatus.READY_FOR_ANALYSIS &&
    asset.status !== MediaAssetStatus.FAILED &&
    asset.status !== MediaAssetStatus.ANALYZING
  ) {
    return NextResponse.json({ error: "素材尚未处于可分析状态" }, { status: 409 });
  }
  void analyzeMediaAsset(asset.id);
  return NextResponse.json({ id: asset.id, status: MediaAssetStatus.ANALYZING }, { status: 202 });
}
