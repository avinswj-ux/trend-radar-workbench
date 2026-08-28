import { prisma } from "@/lib/prisma";
import { enrichAndAttachXNewsAssets, loadXNewsDraftContext } from "@/lib/x-news-assets";
import { generateXhsVisuals } from "@/lib/xhs-visuals";

async function main() {
  const items = await prisma.contentItem.findMany({
    where: { source: { type: "X_BOOKMARK" } },
    include: { drafts: { where: { platform: "XIAOHONGSHU" }, take: 1 } },
    orderBy: { createdAt: "desc" },
  });
  for (const item of items) {
    const images = await enrichAndAttachXNewsAssets(item.id);
    const extras = await loadXNewsDraftContext(item.id);
    const draft = item.drafts[0];
    if (draft) await generateXhsVisuals(draft, { sourceImages: extras.sourceImages });
    console.log(images.length, item.title.slice(0, 50));
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
