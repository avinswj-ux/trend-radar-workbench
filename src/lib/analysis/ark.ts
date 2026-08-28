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

function outputText(payload: unknown) {
  const response = payload as { output_text?: string; output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }> };
  if (response.output_text) return response.output_text;
  const message = response.output?.find((item) => item.type === "message");
  return message?.content?.find((item) => item.type === "output_text")?.text;
}

export async function analyzeWithArk(item: ContentForAnalysis): Promise<AnalysisResult> {
  const apiKey = process.env.ARK_API_KEY;
  if (!apiKey) throw new Error("ARK_API_KEY is not configured");
  const model = process.env.ARK_MODEL ?? "doubao-seed-2-0-lite-260215";
  const baseUrl = process.env.ARK_BASE_URL ?? "https://ark.cn-beijing.volces.com/api/v3";
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/responses`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "system",
          content: `你是面向普通用户的 AI 情报主编。${AVIN_ACCOUNT_DNA} 仅基于提供的来源判断，不得编造功能、数据或链接。只返回合法 JSON，字段必须为 category、topicTheme、summary、tags、entities、chineseAngle、riskFlags。category 只能是 AI_FEATURE、OPEN_SOURCE、AGENT、SKILL、MODEL、TOOL。topicTheme 只能是 DAILY_LIFE、WORKPLACE、LEARNING_GROWTH、SMALL_BUSINESS、FUN_PROJECT、CREATOR_WORKFLOW、VOICE_AVATAR、VIDEO_CREATION、PRODUCTIVITY、TECH_FRONTIER。summary 必须用普通中文依次说明“原来谁做什么很麻烦 → 产品替他完成哪一步 → 最终能看到什么结果”。chineseAngle 必须包含第一视角可验证动作和判断标准，不写参数解读或开发教程。tags 优先加入具体受众、输入对象与输出结果。只有论文、训练、评测、数据集和基础设施归 TECH_FRONTIER。没有明确普通场景时在 riskFlags 加“普通用户场景不明确”；看不到实际结果时加“证据不足或结果不可见”；标题面向普通人但产品实际只供开发者、API 集成或训练使用时加“标题受众与真实用户错位”。entities 是 {type,name,url} 数组，url 可以为 null。`,
        },
        { role: "user", content: JSON.stringify(item) },
      ],
      text: { format: { type: "json_object" } },
    }),
  });
  if (!response.ok) throw new Error(`Volcengine Ark Responses API failed: ${response.status} ${await response.text()}`);
  const text = outputText(await response.json());
  if (!text) throw new Error("Ark response did not contain output text");
  const parsed = JSON.parse(text) as Omit<AnalysisResult, "model">;
  if (!categories.has(parsed.category) || !themes.has(parsed.topicTheme) || !Array.isArray(parsed.tags) || !Array.isArray(parsed.entities) || !Array.isArray(parsed.riskFlags)) {
    throw new Error("Ark response did not match the required analysis structure");
  }
  return { ...parsed, model: `ark:${model}` };
}
