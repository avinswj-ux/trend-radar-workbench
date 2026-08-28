-- CreateTable
CREATE TABLE "NarrationClip" (
    "id" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "scene" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "voice" TEXT NOT NULL,
    "audioUrl" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NarrationClip_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NarrationClip_draftId_scene_key" ON "NarrationClip"("draftId", "scene");

-- AddForeignKey
ALTER TABLE "NarrationClip" ADD CONSTRAINT "NarrationClip_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "ContentDraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;
