import { CandidateStatus } from "@prisma/client";
import { Studio } from "./studio";
import { prisma } from "@/lib/prisma";
import { readXhsVisuals } from "@/lib/xhs-visuals";

export default async function StudioPage() {
  const [candidates, drafts] = await Promise.all([
    prisma.dailyCandidate.findMany({
      where: { status: CandidateStatus.SELECTED },
      orderBy: { createdAt: "desc" },
      include: {
        contentItem: {
          include: {
            analysis: true,
            score: true,
            source: true,
            mediaAssets: { orderBy: { updatedAt: "desc" }, take: 3 },
          },
        },
      },
    }),
    prisma.contentDraft.findMany({
      orderBy: { updatedAt: "desc" },
      include: {
        narrationClips: { orderBy: { scene: "asc" } },
        publishReview: true,
        videoRender: true,
      },
    }),
  ]);
  const draftsWithVisuals = await Promise.all(
    drafts.map(async (draft) => ({
      ...draft,
      visuals: await readXhsVisuals(draft.id),
    })),
  );
  return (
    <Studio initialCandidates={candidates} initialDrafts={draftsWithVisuals} />
  );
}
