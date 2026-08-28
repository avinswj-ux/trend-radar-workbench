import { Prisma } from "@prisma/client";
import { generateDraft } from "@/lib/content-generation";
import { prisma } from "@/lib/prisma";
import { runPublishPrecheck } from "@/lib/publish-precheck";
import { loadXNewsDraftContext, loadXNewsImages } from "@/lib/x-news-assets";

async function main() {
  const items = await prisma.contentItem.findMany({
    where: { source: { type: "X_BOOKMARK" } },
    include: { analysis: true, drafts: true },
    orderBy: { createdAt: "desc" },
  });
  const ranked = [];
  for (const item of items) {
    ranked.push({ item, images: await loadXNewsImages(item.id) });
  }
  ranked.sort((a, b) => b.images.length - a.images.length);
  const picked = ranked[0];
  if (!picked?.images.length) throw new Error("没有带原图的卡兹克选题");
  const extras = await loadXNewsDraftContext(picked.item.id);
  const generated = await generateDraft(
    {
      ...picked.item,
      sourceImages: extras.sourceImages,
      quote: extras.quote,
      articleUrl: extras.articleUrl,
    },
    "DOUYIN",
  );
  const draft = await prisma.contentDraft.upsert({
    where: {
      contentItemId_platform: {
        contentItemId: picked.item.id,
        platform: "DOUYIN",
      },
    },
    create: {
      contentItemId: picked.item.id,
      platform: "DOUYIN",
      ...generated,
      hashtags: generated.hashtags,
      storyboard: generated.storyboard as Prisma.InputJsonValue,
    },
    update: {
      ...generated,
      hashtags: generated.hashtags,
      storyboard: generated.storyboard as Prisma.InputJsonValue,
    },
  });
  console.log("draft", draft.id, generated.model, generated.title, "images", picked.images.length);
  const checked = await runPublishPrecheck(draft, { commercial: false, industry: "general" });
  await prisma.publishReview.upsert({
    where: { draftId: draft.id },
    create: {
      draftId: draft.id,
      status: checked.report.verdict,
      model: checked.model,
      commercial: false,
      industry: "general",
      report: checked.report,
    },
    update: {
      status: checked.report.verdict,
      model: checked.model,
      commercial: false,
      industry: "general",
      report: checked.report,
    },
  });
  console.log("precheck", checked.report.verdict, checked.report.summary);
  if (checked.report.verdict !== "PASSED") {
    console.log("stop before tts/video because review did not pass");
    return;
  }
  const response = await fetch(`http://127.0.0.1:3001/api/content/drafts/${draft.id}/video`, {
    method: "POST",
  });
  const queued = await response.json() as { error?: string; id?: string; status?: string };
  console.log("video enqueue", response.status, queued);
  if (!response.ok) return;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 8000));
    const job = await prisma.videoRender.findUnique({ where: { draftId: draft.id } });
    console.log("render", job?.status, job?.progress, job?.visualMode, job?.error ?? "");
    if (job && ["SUCCEEDED", "FAILED"].includes(job.status)) {
      console.log("output", job.outputUrl);
      break;
    }
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
