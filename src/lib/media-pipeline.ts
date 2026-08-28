import { MediaAssetStatus } from "@prisma/client";
import { analyzeMediaAsset } from "@/lib/media-analysis";
import { ingestMediaAsset } from "@/lib/media-ingest";
import { prisma } from "@/lib/prisma";

export async function ingestThenAnalyze(assetId: string) {
  await ingestMediaAsset(assetId);
  const latest = await prisma.mediaAsset.findUnique({
    where: { id: assetId },
    select: { status: true },
  });
  if (latest?.status === MediaAssetStatus.READY_FOR_ANALYSIS) {
    await analyzeMediaAsset(assetId);
  }
}

export function startIngestThenAnalyze(assetId: string) {
  void ingestThenAnalyze(assetId).catch((cause) => {
    console.error("ingestThenAnalyze failed", assetId, cause);
  });
}
