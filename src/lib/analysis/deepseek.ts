import type { ContentCategory } from "@prisma/client";
import type { AnalysisResult } from "./types";
import { topicThemes } from "@/lib/topic-theme";
import { AVIN_ACCOUNT_DNA } from "@/config/avin-content-dna";

type ContentForAnalysis = {
  title: string;
  body: string | null;
  author: string | null;
  canonicalUrl: string;
  language: string | null;
};

const categories = new Set<ContentCategory>(["AI_FEATURE", "OPEN_SOURCE", "AGENT", "SKILL", "MODEL", "TOOL"]);
const themes = new Set<string>(topicThemes);

export async function analyzeWithDeepSeek(item: ContentForAnalysis): Promise<AnalysisResult> {
  const apiKey = process.env.DEEPSEEK_API_KEY || process.env.DASHSCOPE_API_KEY;
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY or DASHSCOPE_API_KEY is not configured");
  const model = process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash-0731";
  const baseUrl = process.env.DEEPSEEK_BASE_URL ?? process.env.DASHSCOPE_BASE_URL ?? "https://api.deepseek.com";
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      max_tokens: 1400,
      response_format: { type: "json_object" },
      thinking: { type: "disabled" },
      messages: [
        {
          role: "system",
          content: `你是面向普通用户的 AI 情报主编。${AVIN_ACCOUNT_DNA} 只拆外来项目本身：它解决谁的什么麻烦、普通人三秒能看懂什么结果。不要从对标账号拆角度，也不要为了发片硬编五种形态。仅基于给定来源判断，不得编造功能、数据或链接。必须输出合法 JSON，且只包含 category、topicTheme、summary、tags、entities、chineseAngle、riskFlags。category 仅可为 AI_FEATURE、OPEN_SOURCE、AGENT、SKILL、MODEL、TOOL。topicTheme 仅可为 DAILY_LIFE、WORKPLACE、LEARNING_GROWTH、SMALL_BUSINESS、FUN_PROJECT、CREATOR_WORKFLOW、VOICE_AVATAR、VIDEO_CREATION、PRODUCTIVITY、TECH_FRONTIER。summary 必须像给不懂技术的朋友解释：原来谁被什么具体事卡住 → 这个项目替他做哪一步 → 最后能看见什么成品。chineseAngle 必须是一句能当标题的普通人说法，禁止“趋势/教程/拆解/一文看懂”。tags 优先受众、输入、输出结果。论文、训练、评测、数据集、基础设施归 TECH_FRONTIER。没有生活或创作场景时加“普通用户场景不明确”；看不到成品或界面时加“证据不足或结果不可见”；标题面向普通人但只服务开发者时加“标题受众与真实用户错位”。entities 是 {type,name,url} 数组，url 可为 null。`,
        },
        { role: "user", content: JSON.stringify(item) },
      ],
    }),
  });
  if (!response.ok) throw new Error(`DeepSeek Chat API failed: ${response.status} ${await response.text()}`);
  const payload = await response.json() as { choices?: Array<{ message?: { content?: string | null } }> };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error("DeepSeek response did not contain message content");
  const parsed = JSON.parse(content) as Omit<AnalysisResult, "model">;
  if (!categories.has(parsed.category) || !themes.has(parsed.topicTheme) || !Array.isArray(parsed.tags) || !Array.isArray(parsed.entities) || !Array.isArray(parsed.riskFlags)) {
    throw new Error("DeepSeek response did not match the required analysis structure");
  }
  return { ...parsed, model: `deepseek:${model}` };
}
