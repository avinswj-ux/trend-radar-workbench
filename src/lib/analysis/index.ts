import type { ContentItem } from "@prisma/client";
import { analyzeWithHeuristics } from "./heuristic";
import { analyzeWithArk } from "./ark";
import { analyzeWithDeepSeek } from "./deepseek";
import type { AnalysisResult } from "./types";

type AnalysableContent = Pick<ContentItem, "title" | "body" | "author" | "canonicalUrl" | "language">;

export async function analyzeContent(item: AnalysableContent): Promise<AnalysisResult> {
  const primary = process.env.TEXT_ANALYSIS_PROVIDER ?? "deepseek";
  if (primary === "deepseek" && process.env.DEEPSEEK_API_KEY) {
    try { return await analyzeWithDeepSeek(item); }
    catch (error) { console.warn("DeepSeek analysis failed; trying Ark fallback.", error); }
  }
  if (process.env.ARK_API_KEY) {
    try { return await analyzeWithArk(item); }
    catch (error) { console.warn("Ark analysis failed; using deterministic fallback.", error); }
  }
  return analyzeWithHeuristics(item);
}
