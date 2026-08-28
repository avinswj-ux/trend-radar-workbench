export type XNewsAccount = {
  username: string;
  name: string;
  label: string;
  schedule: string;
  limit: number;
  minChars: number;
  description: string;
};

/** 中文圈 AI 图文信源。对标卡兹克的「国外项目/模型新闻」，互补而不是同质搬运。 */
export const X_NEWS_ACCOUNTS: XNewsAccount[] = [
  {
    username: "Khazix0918",
    name: "卡兹克 AI 新闻",
    label: "卡兹克",
    schedule: "0 8 * * *",
    limit: 8,
    minChars: 28,
    description: "每天采集 @Khazix0918 的图文，用原图加上自己的理解重排成小红书稿",
  },
  {
    username: "op7418",
    name: "歸藏 AIGC 工具",
    label: "歸藏",
    schedule: "15 8 * * *",
    limit: 5,
    minChars: 28,
    description: "图像/视频与工具实测，补卡兹克较少覆盖的 AIGC 创作向",
  },
  {
    username: "dotey",
    name: "宝玉 工程向拆解",
    label: "宝玉",
    schedule: "30 8 * * *",
    limit: 5,
    minChars: 32,
    description: "Claude、模型能力和工程实践拆解，信息密度高、和快讯错开",
  },
  {
    username: "vista8",
    name: "向阳乔木 产品工具",
    label: "乔木",
    schedule: "45 8 * * *",
    limit: 8,
    minChars: 36,
    description: "产品经理视角的 AI 工具和工作流，少报模型参数、多讲怎么用",
  },
];

export function xNewsAccountByUsername(username?: string | null) {
  const handle = (username ?? "").replace(/^@/, "");
  return X_NEWS_ACCOUNTS.find((account) => account.username.toLowerCase() === handle.toLowerCase()) ?? null;
}

export function xNewsLabel(username?: string | null) {
  return xNewsAccountByUsername(username)?.label ?? (username ? `@${username.replace(/^@/, "")}` : "中文圈图文");
}

export function xNewsHandlePattern() {
  const names = X_NEWS_ACCOUNTS.map((account) => account.username.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`@?(?:${names.join("|")})`, "gi");
}
