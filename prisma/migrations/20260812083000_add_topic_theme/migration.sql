ALTER TABLE "ContentItem" ADD COLUMN "topicTheme" TEXT;

CREATE INDEX "ContentItem_topicTheme_idx" ON "ContentItem"("topicTheme");
