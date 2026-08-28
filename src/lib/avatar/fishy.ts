export const fishyActions = {
  IDLE: { label: "待机眨眼", asset: "Fishy-01-待机眨眼-透明.mov", chromaKey: false, use: "开场、停顿、转场" },
  TALK: { label: "普通讲话", asset: "Fishy-07-普通讲话-蓝幕.mp4", chromaKey: true, use: "主体讲解" },
  POINT_LEFT: { label: "指向左侧", asset: "Fishy-02-指向左侧-蓝幕.mp4", chromaKey: true, use: "强调左侧标题或截图" },
  THINK: { label: "思考", asset: "Fishy-06-思考-蓝幕.mp4", chromaKey: true, use: "提问、分析和转折" },
  SURPRISED: { label: "震惊反应", asset: "Fishy-04-震惊反应-蓝幕.mp4", chromaKey: true, use: "反差数据或强钩子" },
  EXPLAIN: { label: "举手解释", asset: "Fishy-08-举手解释-蓝幕.mp4", chromaKey: true, use: "关键原理或步骤" },
  QUESTION: { label: "疑惑", asset: "Fishy-09-疑惑-蓝幕.mp4", chromaKey: true, use: "风险与边界" },
  LIKE: { label: "点赞挥手", asset: "Fishy-05-点赞挥手-蓝幕.mp4", chromaKey: true, use: "结尾互动" },
  SMILE: { label: "笑", asset: "Fishy-10-笑-蓝幕.mp4", chromaKey: true, use: "正向结论" },
  SHAKE_HEAD: { label: "嫌弃摇头", asset: "Fishy-03-嫌弃摇头-蓝幕.mp4", chromaKey: true, use: "反例或避坑" },
} as const;

export type FishyAction = keyof typeof fishyActions;
const allowed = new Set<string>(Object.keys(fishyActions));

const sceneCycle: FishyAction[] = [
  "SURPRISED",
  "POINT_LEFT",
  "EXPLAIN",
  "THINK",
  "QUESTION",
  "LIKE",
  "SMILE",
  "SHAKE_HEAD",
  "TALK",
];

export function chooseFishyAction(scene: number, text: string, proposed?: unknown): FishyAction {
  if (typeof proposed === "string" && allowed.has(proposed) && proposed !== "IDLE") {
    return proposed as FishyAction;
  }
  if (scene === 1 || /居然|没想到|离谱|咋办|敢信/.test(text)) return "SURPRISED";
  if (/风险|边界|别碰|门槛|注意|避坑/.test(text)) return "QUESTION";
  if (/原理|步骤|怎么|解释|因为|操作/.test(text)) return "EXPLAIN";
  if (/收藏|关注|点赞|评论|下期/.test(text)) return "LIKE";
  if (/推荐|值得|好用|开心|香/.test(text)) return "SMILE";
  if (/嫌|不行|别信|假/.test(text)) return "SHAKE_HEAD";
  if (/想|如果|会不会/.test(text)) return "THINK";
  if (scene === 2) return "POINT_LEFT";
  return sceneCycle[(Math.max(1, scene) - 1) % sceneCycle.length];
}

export function varyAvatarActions<T extends { scene?: number; narration?: string; onScreenText?: string; avatarAction?: unknown }>(
  shots: T[],
): Array<Omit<T, "avatarAction"> & { avatarAction: FishyAction }> {
  const used = new Set<FishyAction>();
  return shots.map((shot, index) => {
    let action = chooseFishyAction(
      Number(shot.scene) || index + 1,
      `${shot.narration ?? ""} ${shot.onScreenText ?? ""}`,
      shot.avatarAction,
    );
    if (used.has(action)) {
      action = sceneCycle.find((item) => !used.has(item)) ?? sceneCycle[index % sceneCycle.length];
    }
    used.add(action);
    return { ...shot, avatarAction: action };
  });
}
