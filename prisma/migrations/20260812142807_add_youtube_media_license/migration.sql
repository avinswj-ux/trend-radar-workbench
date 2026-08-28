-- DropIndex
DROP INDEX "ContentItem_topicTheme_idx";

-- AlterTable
ALTER TABLE "ContentItem" ADD COLUMN     "mediaLicense" TEXT;
