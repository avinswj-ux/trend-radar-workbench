CREATE TABLE "TopicVideoMatch" (
    "id" TEXT NOT NULL,
    "contentItemId" TEXT NOT NULL,
    "youtubeVideoId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "channel" TEXT,
    "thumbnailUrl" TEXT,
    "publishedAt" TIMESTAMP(3),
    "viewCount" BIGINT NOT NULL DEFAULT 0,
    "likeCount" BIGINT NOT NULL DEFAULT 0,
    "duration" TEXT,
    "matchScore" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TopicVideoMatch_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TopicVideoMatch_contentItemId_youtubeVideoId_key" ON "TopicVideoMatch"("contentItemId", "youtubeVideoId");
CREATE INDEX "TopicVideoMatch_contentItemId_matchScore_idx" ON "TopicVideoMatch"("contentItemId", "matchScore");
ALTER TABLE "TopicVideoMatch" ADD CONSTRAINT "TopicVideoMatch_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "ContentItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
