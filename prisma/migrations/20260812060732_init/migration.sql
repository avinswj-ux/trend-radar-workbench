-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('RSS', 'GITHUB', 'HUGGING_FACE', 'PRODUCT_HUNT', 'WEB', 'X_BOOKMARK');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "ContentCategory" AS ENUM ('AI_FEATURE', 'OPEN_SOURCE', 'AGENT', 'SKILL', 'MODEL', 'TOOL');

-- CreateEnum
CREATE TYPE "CandidateStatus" AS ENUM ('PENDING', 'SELECTED', 'DISMISSED');

-- CreateTable
CREATE TABLE "Source" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "SourceType" NOT NULL,
    "config" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "schedule" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Source_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrawlRun" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'QUEUED',
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "stats" JSONB,
    "error" TEXT,

    CONSTRAINT "CrawlRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RawItem" (
    "id" TEXT NOT NULL,
    "crawlRunId" TEXT NOT NULL,
    "externalId" TEXT,
    "payload" JSONB NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RawItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentItem" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "rawItemId" TEXT,
    "canonicalUrl" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "author" TEXT,
    "publishedAt" TIMESTAMP(3),
    "language" TEXT,
    "category" "ContentCategory",
    "fingerprint" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiAnalysis" (
    "id" TEXT NOT NULL,
    "contentItemId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "tags" JSONB NOT NULL,
    "entities" JSONB NOT NULL,
    "chineseAngle" TEXT,
    "riskFlags" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrendScore" (
    "id" TEXT NOT NULL,
    "contentItemId" TEXT NOT NULL,
    "total" INTEGER NOT NULL,
    "novelty" INTEGER NOT NULL,
    "utility" INTEGER NOT NULL,
    "momentum" INTEGER NOT NULL,
    "shareability" INTEGER NOT NULL,
    "confidence" INTEGER NOT NULL,
    "reasoning" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrendScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyCandidate" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "contentItemId" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "status" "CandidateStatus" NOT NULL DEFAULT 'PENDING',
    "editorNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CrawlRun_sourceId_status_idx" ON "CrawlRun"("sourceId", "status");

-- CreateIndex
CREATE INDEX "RawItem_externalId_idx" ON "RawItem"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX "ContentItem_rawItemId_key" ON "ContentItem"("rawItemId");

-- CreateIndex
CREATE UNIQUE INDEX "ContentItem_canonicalUrl_key" ON "ContentItem"("canonicalUrl");

-- CreateIndex
CREATE INDEX "ContentItem_sourceId_publishedAt_idx" ON "ContentItem"("sourceId", "publishedAt");

-- CreateIndex
CREATE INDEX "ContentItem_fingerprint_idx" ON "ContentItem"("fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "AiAnalysis_contentItemId_key" ON "AiAnalysis"("contentItemId");

-- CreateIndex
CREATE UNIQUE INDEX "TrendScore_contentItemId_key" ON "TrendScore"("contentItemId");

-- CreateIndex
CREATE INDEX "TrendScore_total_idx" ON "TrendScore"("total");

-- CreateIndex
CREATE INDEX "DailyCandidate_date_status_rank_idx" ON "DailyCandidate"("date", "status", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "DailyCandidate_date_contentItemId_key" ON "DailyCandidate"("date", "contentItemId");

-- AddForeignKey
ALTER TABLE "CrawlRun" ADD CONSTRAINT "CrawlRun_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RawItem" ADD CONSTRAINT "RawItem_crawlRunId_fkey" FOREIGN KEY ("crawlRunId") REFERENCES "CrawlRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentItem" ADD CONSTRAINT "ContentItem_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentItem" ADD CONSTRAINT "ContentItem_rawItemId_fkey" FOREIGN KEY ("rawItemId") REFERENCES "RawItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiAnalysis" ADD CONSTRAINT "AiAnalysis_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "ContentItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrendScore" ADD CONSTRAINT "TrendScore_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "ContentItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyCandidate" ADD CONSTRAINT "DailyCandidate_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "ContentItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
