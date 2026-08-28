import type { ContentDraft, NarrationClip } from "@prisma/client";
import { fishyActions, type FishyAction } from "@/lib/avatar/fishy";

type StoryboardShot = { scene: number; durationSeconds: number; visual: string; narration: string; onScreenText: string; avatarAction?: FishyAction; claim?: string; evidenceType?: string; evidenceRequirement?: string };

export type ProductionScene = {
  scene: number;
  durationSeconds: number;
  narration: string;
  subtitle: string;
  avatar: { action: string; asset: string; chromaKey: boolean };
  voice: { ready: boolean; audioUrl: string | null };
  primaryVisual: { type: "OFFICIAL_REFERENCE" | "AI_INFOGRAPHIC"; instruction: string; sourceUrl: string | null };
  overlay: string;
};

export function buildProductionPlan(draft: Pick<ContentDraft, "storyboard" | "title">, sourceUrl: string, clips: NarrationClip[]) {
  const hasOfficialSource = /^https?:\/\//.test(sourceUrl);
  const scenes = (Array.isArray(draft.storyboard) ? draft.storyboard : []) as StoryboardShot[];
  return {
    format: "9:16 · 1080×1920 · 30fps",
    title: draft.title,
    policy: "产品真实界面优先使用官方来源；没有可核验来源时只生成抽象信息图，不伪造产品 UI。",
    scenes: scenes.map<ProductionScene>((shot, index) => {
      const action = fishyActions[shot.avatarAction ?? "TALK"];
      const clip = clips.find((item) => item.scene === shot.scene);
      return {
        scene: shot.scene || index + 1,
        durationSeconds: shot.durationSeconds,
        narration: shot.narration,
        subtitle: shot.onScreenText,
        avatar: { action: action.label, asset: action.asset, chromaKey: action.chromaKey },
        voice: { ready: Boolean(clip), audioUrl: clip?.audioUrl ?? null },
        primaryVisual: hasOfficialSource
          ? { type: "OFFICIAL_REFERENCE", instruction: `口播观点：“${shot.claim ?? shot.narration}”。证据类型：${shot.evidenceType ?? "待判断"}。从官方页面提取能满足“${shot.evidenceRequirement ?? shot.visual}”的可验证画面；保留来源标注。`, sourceUrl }
          : { type: "AI_INFOGRAPHIC", instruction: `口播观点：“${shot.claim ?? shot.narration}”。没有官方证据时只能将“${shot.evidenceRequirement ?? shot.visual}”标记为待验证并生成信息图，不得仿冒产品界面或把示意图当证据。`, sourceUrl: null },
        overlay: shot.onScreenText,
      };
    }),
  };
}
