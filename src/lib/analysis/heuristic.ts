import type { ContentCategory } from "@prisma/client";
import type { AnalysisResult } from "./types";
import { inferTopicTheme } from "@/lib/topic-theme";

type ContentForAnalysis = {
  title: string;
  body: string | null;
  author: string | null;
  canonicalUrl: string;
  language: string | null;
};

export function analyzeWithHeuristics(item: ContentForAnalysis): AnalysisResult {
  const corpus = `${item.title} ${item.body ?? ""}`.toLowerCase();
  const category: ContentCategory = corpus.includes("agent") ? "AGENT"
    : corpus.includes("skill") ? "SKILL"
    : corpus.includes("model") || corpus.includes("llm") ? "MODEL"
    : corpus.includes("tool") ? "TOOL"
    : "OPEN_SOURCE";
  const tags = [category.toLowerCase().replace("_", "-"), "github", "open-source"];
  if (item.language) tags.push(item.language.toLowerCase());
  if (corpus.includes("video")) tags.push("video");
  if (corpus.includes("voice") || corpus.includes("tts")) tags.push("voice");
  if (corpus.includes("workflow")) tags.push("workflow");
  if (corpus.includes("agent")) tags.push("agent");

  const description = item.body?.trim() || "该仓库尚未提供明确描述。";
  return {
    category,
    topicTheme: inferTopicTheme(corpus),
    summary: `${item.title}：${description}`.slice(0, 500),
    tags: [...new Set(tags)],
    entities: [{ type: "repository", name: item.title, url: item.canonicalUrl }],
    chineseAngle: `我会把 ${item.title} 放进一个普通人的真实任务里：先说我原来怎么做，再展示它替我完成了哪一步，最后说明它是否真的省事。`,
    riskFlags: [
      ...(inferTopicTheme(corpus) === "TECH_FRONTIER" ? ["普通用户场景不明确"] : []),
      ...(/dataset|sdk|api integration|数据集|接口集成/.test(corpus) && /狂喜|普通人|健身|设计|电商|学生|创作者/.test(corpus)
        ? ["标题受众与真实用户错位"]
        : []),
      ...(!/demo|walkthrough|output|result|screenshot|演示|录屏|输出|结果|截图/.test(corpus)
        ? ["证据不足或结果不可见"]
        : []),
    ],
    model: "heuristic-v1",
  };
}
