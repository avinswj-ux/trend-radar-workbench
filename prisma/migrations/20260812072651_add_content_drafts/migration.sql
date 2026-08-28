-- CreateEnum
CREATE TYPE "ContentPlatform" AS ENUM ('XIAOHONGSHU', 'DOUYIN');

-- CreateTable
CREATE TABLE "ContentDraft" (
    "id" TEXT NOT NULL,
    "contentItemId" TEXT NOT NULL,
    "platform" "ContentPlatform" NOT NULL,
    "model" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "hook" TEXT NOT NULL,
    "script" TEXT NOT NULL,
    "caption" TEXT NOT NULL,
    "hashtags" JSONB NOT NULL,
    "storyboard" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContentDraft_platform_updatedAt_idx" ON "ContentDraft"("platform", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ContentDraft_contentItemId_platform_key" ON "ContentDraft"("contentItemId", "platform");

-- AddForeignKey
ALTER TABLE "ContentDraft" ADD CONSTRAINT "ContentDraft_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "ContentItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
