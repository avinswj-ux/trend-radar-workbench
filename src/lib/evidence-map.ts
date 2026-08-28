export const evidenceTypes = [
  "OFFICIAL_DEMO",
  "PRODUCT_UI",
  "GITHUB_PROOF",
  "DATA_PROOF",
  "RESULT_PROOF",
  "LIMIT_PROOF",
  "AVIN_COMMENTARY",
] as const;

export type EvidenceType = (typeof evidenceTypes)[number];

export type EvidenceMappedScene = {
  scene: number;
  durationSeconds: number;
  visual: string;
  narration: string;
  onScreenText: string;
  avatarAction?: unknown;
  claim: string;
  evidenceType: EvidenceType;
  evidenceRequirement: string;
};

const evidenceSet = new Set<string>(evidenceTypes);

function compact(value: unknown, limit = 300) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function inferEvidenceType(text: string): EvidenceType {
  if (/stars?|github|仓库|开源|许可证|license/i.test(text)) return "GITHUB_PROOF";
  if (/跑分|榜单|投资|用户量|统计|数据|成本|价格|数字/i.test(text)) return "DATA_PROOF";
  if (/限制|风险|隐私|门槛|失败|不适合|安装|付费/i.test(text)) return "LIMIT_PROOF";
  if (/结果|输出|生成后|报告|成品|对比|完成/i.test(text)) return "RESULT_PROOF";
  if (/界面|按钮|输入|上传|导入|操作|流程/i.test(text)) return "PRODUCT_UI";
  if (/官方|演示|demo|readme/i.test(text)) return "OFFICIAL_DEMO";
  return "AVIN_COMMENTARY";
}

export function normalizeEvidenceStoryboard(
  storyboard: Array<Record<string, unknown>>,
) {
  return storyboard.slice(0, 12).map<EvidenceMappedScene>((shot, index) => {
    const narration = compact(shot.narration, 800);
    const visual = compact(shot.visual, 500);
    const claim = compact(shot.claim || narration, 260);
    const rawEvidenceType = compact(shot.evidenceType, 40);
    const evidenceType = evidenceSet.has(rawEvidenceType)
      ? (rawEvidenceType as EvidenceType)
      : inferEvidenceType(`${claim} ${visual}`);
    const evidenceRequirement = compact(
      shot.evidenceRequirement || visual || `需要找到能证明“${claim}”的来源画面`,
      400,
    );
    return {
      ...shot,
      scene: Number(shot.scene) || index + 1,
      durationSeconds: Math.max(
        2,
        Math.min(20, Number(shot.durationSeconds) || 5),
      ),
      visual,
      narration,
      onScreenText: compact(shot.onScreenText, 80),
      claim,
      evidenceType,
      evidenceRequirement,
    } as EvidenceMappedScene;
  });
}

export function hasCompleteEvidenceMap(storyboard: unknown) {
  return (
    Array.isArray(storyboard) &&
    storyboard.length >= 4 &&
    storyboard.every((raw) => {
      if (!raw || typeof raw !== "object") return false;
      const scene = raw as Record<string, unknown>;
      return (
        compact(scene.claim).length >= 4 &&
        evidenceSet.has(compact(scene.evidenceType, 40)) &&
        compact(scene.evidenceRequirement).length >= 6
      );
    })
  );
}
