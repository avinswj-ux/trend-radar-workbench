export type BgmProfile = {
  label: string;
  mood: string;
  bpm: string;
  searchTerms: string[];
  musicVolume: string;
  originalVolume: string;
  energyCurve: string;
};

const profiles = {
  practical: {
    label: "轻快实测型",
    mood: "轻电子、清爽、有推进感，不使用人声主唱",
    bpm: "108–118 BPM",
    searchTerms: ["科技感轻快", "AI工具卡点", "电子律动", "开源项目"],
    musicVolume: "8%–12%",
    originalVolume: "90%–100%",
    energyCurve: "开头两秒抬升 → 演示段压低 → 结果出现时回升 → 结论干净收尾",
  },
  suspense: {
    label: "悬念发现型",
    mood: "低频电子脉冲、轻悬疑、克制，不使用恐怖或轰鸣音色",
    bpm: "100–112 BPM",
    searchTerms: ["科技悬疑", "AI发现感", "电子脉冲", "未来探索"],
    musicVolume: "7%–11%",
    originalVolume: "92%–100%",
    energyCurve: "疑问开场渐强 → 证据段主动避让 → 反差结果短促抬升 → 限制段回落",
  },
  energetic: {
    label: "能力跃迁型",
    mood: "明亮数字节奏、短促鼓点、有获得感，不使用密集旋律",
    bpm: "116–126 BPM",
    searchTerms: ["AI科技感高能", "开源项目卡点", "数字节奏", "工具分享"],
    musicVolume: "9%–15%",
    originalVolume: "90%–100%",
    energyCurve: "结果先行 → 功能演示稳定推进 → 数据证据降低 → Avin 判断再次抬升",
  },
} satisfies Record<string, BgmProfile>;

export function recommendBgmProfile(text: string): BgmProfile {
  const normalized = text.toLowerCase();
  if (/安全|风险|骗局|隐私|监控|真相|失败|替代|失业/.test(normalized))
    return profiles.suspense;
  if (/狂喜|离谱|秒出|一键|自动|克隆|升级|爆|神器/.test(normalized))
    return profiles.energetic;
  return profiles.practical;
}
