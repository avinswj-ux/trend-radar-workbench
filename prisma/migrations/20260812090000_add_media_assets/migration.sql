CREATE TYPE "AssetRights" AS ENUM ('OWNED', 'PERMISSION_GRANTED', 'CC_BY', 'RESEARCH_ONLY');
CREATE TYPE "MediaAssetStatus" AS ENUM ('QUEUED', 'DOWNLOADING', 'READY_FOR_ANALYSIS', 'FAILED');

CREATE TABLE "MediaAsset" (
    "id" TEXT NOT NULL,
    "contentItemId" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "rights" "AssetRights" NOT NULL,
    "status" "MediaAssetStatus" NOT NULL DEFAULT 'QUEUED',
    "localDir" TEXT,
    "videoPath" TEXT,
    "audioPath" TEXT,
    "subtitlePath" TEXT,
    "metadata" JSONB,
    "transcript" TEXT,
    "shotList" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MediaAsset_contentItemId_status_idx" ON "MediaAsset"("contentItemId", "status");
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "ContentItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
