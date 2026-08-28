-- CreateEnum
CREATE TYPE "PublishReviewStatus" AS ENUM ('PASSED', 'NEEDS_CHANGES', 'DO_NOT_PUBLISH');

-- CreateTable
CREATE TABLE "PublishReview" (
    "id" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "status" "PublishReviewStatus" NOT NULL,
    "model" TEXT NOT NULL,
    "commercial" BOOLEAN NOT NULL DEFAULT false,
    "industry" TEXT NOT NULL DEFAULT 'general',
    "report" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PublishReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PublishReview_draftId_key" ON "PublishReview"("draftId");

-- CreateIndex
CREATE INDEX "PublishReview_status_updatedAt_idx" ON "PublishReview"("status", "updatedAt");

-- AddForeignKey
ALTER TABLE "PublishReview" ADD CONSTRAINT "PublishReview_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "ContentDraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;
