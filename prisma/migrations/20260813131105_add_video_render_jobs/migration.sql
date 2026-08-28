-- CreateEnum
CREATE TYPE "VideoRenderStatus" AS ENUM ('QUEUED', 'RENDERING', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "VideoRender" (
    "id" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "status" "VideoRenderStatus" NOT NULL DEFAULT 'QUEUED',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "outputUrl" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VideoRender_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VideoRender_draftId_key" ON "VideoRender"("draftId");

-- CreateIndex
CREATE INDEX "VideoRender_status_updatedAt_idx" ON "VideoRender"("status", "updatedAt");

-- AddForeignKey
ALTER TABLE "VideoRender" ADD CONSTRAINT "VideoRender_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "ContentDraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;
