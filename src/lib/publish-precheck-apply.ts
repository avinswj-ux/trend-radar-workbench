import { Prisma, type ContentDraft } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  runPublishPrecheck,
  type PrecheckIssue,
  type PrecheckReport,
} from "@/lib/publish-precheck";
import { repairStoryboardNarrations, splitTextToScenes } from "@/lib/scene-narration";
import { loadXNewsDraftContext } from "@/lib/x-news-assets";
import { generateXhsVisuals, invalidateXhsVisuals, readXhsVisuals } from "@/lib/xhs-visuals";

type AdoptedCopy = {
  title: string;
  hook: string;
  script: string;
  caption: string;
};

export function buildAdoptedCopy(draft: ContentDraft, report: PrecheckReport): AdoptedCopy | null {
  const patched: AdoptedCopy = {
    title: patchText(draft.title, report.issues),
    hook: patchText(draft.hook, report.issues),
    script: patchText(draft.script, report.issues),
    caption: patchText(draft.caption, report.issues),
  };
  const revisedTitle = report.revisedTitle?.trim() || draft.title;
  const revisedHook = report.revisedHook?.trim() || draft.hook;
  const revisedScript = report.revisedScript?.trim() || draft.script;
  const revisedCaption = report.revisedCaption?.trim() || draft.caption;
  const takeFullRevision = report.verdict === "NEEDS_CHANGES" || report.verdict === "DO_NOT_PUBLISH";
  const next: AdoptedCopy = {
    title: patchText(revisedTitle, report.issues),
    hook: patchText(revisedHook, report.issues),
    script: takeFullRevision || closeRevision(draft.script, revisedScript)
      ? patchText(revisedScript, report.issues)
      : patched.script,
    caption: takeFullRevision || closeRevision(draft.caption, revisedCaption)
      ? patchText(revisedCaption, report.issues)
      : patched.caption,
  };
  if (
    next.title === draft.title &&
    next.hook === draft.hook &&
    next.script === draft.script &&
    next.caption === draft.caption
  ) {
    return null;
  }
  return next;
}

function closeRevision(original: string, revised: string) {
  if (!revised || revised === original) return false;
  const ratio = revised.replace(/\s+/g, "").length / Math.max(1, original.replace(/\s+/g, "").length);
  return ratio >= 0.78 && ratio <= 1.22;
}

export async function applyPrecheckReport(draft: ContentDraft, report: PrecheckReport) {
  const adopted = buildAdoptedCopy(draft, report);
  if (!adopted) return draft;

  const storyboard = revisedStoryboard(draft, report, adopted);
  const beforeNarration = sceneNarrations(draft.storyboard);
  const afterNarration = storyboard.map((scene) => String(scene.narration ?? ""));
  const voiceStale = beforeNarration.join("\n") !== afterNarration.join("\n") || draft.script !== adopted.script || draft.hook !== adopted.hook;

  const updated = await prisma.$transaction(async (tx) => {
    if (voiceStale) {
      await tx.narrationClip.deleteMany({ where: { draftId: draft.id } });
      await tx.videoRender.deleteMany({ where: { draftId: draft.id } });
    }
    return tx.contentDraft.update({
      where: { id: draft.id },
      data: {
        title: adopted.title,
        hook: adopted.hook,
        script: adopted.script,
        caption: adopted.caption,
        storyboard: storyboard as Prisma.InputJsonValue,
      },
    });
  });

  await invalidateXhsVisuals(draft.id);
  if (updated.platform === "XIAOHONGSHU") {
    try {
      const extras = await loadXNewsDraftContext(updated.contentItemId);
      await generateXhsVisuals(updated, { sourceImages: extras.sourceImages });
    } catch {
      // 文字已经写回；封面失败时操作台会显示空图，用户可再点生成。
    }
  }
  return updated;
}

export async function runPrecheckAndAutoAdopt(
  draftId: string,
  options: { commercial: boolean; industry: "general" | "medical" | "finance" },
) {
  let draft = await prisma.contentDraft.findUnique({ where: { id: draftId } });
  if (!draft) return null;

  let autoApplied = 0;
  let last = await runPublishPrecheck(draft, options);
  await saveReview(draft.id, last, options, autoApplied);

  while (autoApplied < 2 && buildAdoptedCopy(draft, last.report)) {
    draft = await applyPrecheckReport(draft, last.report);
    autoApplied += 1;
    last = await runPublishPrecheck(draft, options);
    await saveReview(draft.id, last, options, autoApplied);
  }

  const saved = await prisma.contentDraft.findUniqueOrThrow({
    where: { id: draftId },
    include: {
      narrationClips: { orderBy: { scene: "asc" } },
      publishReview: true,
      videoRender: true,
    },
  });
  return { ...saved, visuals: await readXhsVisuals(saved.id), autoApplied };
}

function patchText(value: string, issues: PrecheckIssue[] | undefined) {
  let next = value;
  for (const issue of issues ?? []) {
    const quote = String(issue.quote ?? "").trim();
    const replacement = String(issue.replacement ?? "").trim();
    if (!quote || !usableReplacement(quote, replacement)) continue;
    if (next.includes(quote)) next = next.replaceAll(quote, replacement);
  }
  return next;
}

function usableReplacement(quote: string, replacement: string) {
  if (!replacement || replacement === quote) return false;
  return !/无需修改|保持原文|待语义|不建议直接发布|建议发布时/.test(replacement);
}

function sceneNarrations(storyboard: Prisma.JsonValue) {
  return (Array.isArray(storyboard) ? storyboard : []).map((raw) =>
    raw && typeof raw === "object" ? String((raw as { narration?: string }).narration ?? "") : "",
  );
}

function revisedStoryboard(draft: ContentDraft, report: PrecheckReport, adopted: AdoptedCopy) {
  const sourceStoryboard = Array.isArray(draft.storyboard) ? draft.storyboard : [];
  const patched = sourceStoryboard.map((raw) => {
    const scene = raw && typeof raw === "object" ? { ...(raw as Record<string, unknown>) } : {};
    return {
      ...scene,
      narration: patchText(String(scene.narration ?? ""), report.issues),
      onScreenText: patchText(String(scene.onScreenText ?? ""), report.issues),
    };
  });
  const repaired = repairStoryboardNarrations(patched, adopted.script);
  const stillCollapsed = repaired.length > 1 && String(repaired[0]?.narration ?? "").includes(String(repaired[1]?.narration ?? "").slice(0, 20));
  const mapped = stillCollapsed ? splitTextToScenes(adopted.script, repaired.length) : null;
  return repaired.map((scene, index) => ({
    ...scene,
    narration: mapped?.[index] || String(scene.narration ?? ""),
    onScreenText: index === 0 ? adopted.title.slice(0, 22) : String(scene.onScreenText ?? ""),
  }));
}

async function saveReview(
  draftId: string,
  checked: { model: string; report: PrecheckReport },
  options: { commercial: boolean; industry: string },
  autoApplied: number,
) {
  const report = {
    ...checked.report,
    summary:
      autoApplied > 0
        ? `已自动采用修复稿（第 ${autoApplied} 轮），正文、口播分镜和小红书封面已写回。${checked.report.summary}`
        : checked.report.summary,
  };
  await prisma.publishReview.upsert({
    where: { draftId },
    create: {
      draftId,
      status: report.verdict,
      model: checked.model,
      commercial: options.commercial,
      industry: options.industry,
      report: report as unknown as Prisma.InputJsonValue,
    },
    update: {
      status: report.verdict,
      model: checked.model,
      commercial: options.commercial,
      industry: options.industry,
      report: report as unknown as Prisma.InputJsonValue,
    },
  });
}
