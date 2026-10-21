import { describe, expect, it } from "vitest";
import { isDullB2b, isGenericCompilation, isUnreadableForAudience, isWowConsumerToy, scoreContent, shortTopicHook } from "@/lib/scoring";
import { analyzeWithHeuristics } from "@/lib/analysis/heuristic";

describe("content filters", () => {
  it("detects generic listicles", () => {
    expect(isGenericCompilation("Best AI tools you need")).toBe(true);
    expect(isGenericCompilation("AI 工具盘点")).toBe(true);
    expect(isGenericCompilation("Voice clone in 3 seconds")).toBe(false);
  });
  it("detects dull B2B topics", () => {
    expect(isDullB2b("Enterprise CRM automation")).toBe(true);
    expect(isDullB2b("Make a song from your photo")).toBe(false);
  });
  it("detects titles unreadable for a Chinese/English audience", () => {
    expect(isUnreadableForAudience("नया एआई टूल")).toBe(true);
    expect(isUnreadableForAudience("新的 AI 工具 v2")).toBe(false);
  });
  it("detects wow consumer toys", () => {
    expect(isWowConsumerToy("一键生成歌曲")).toBe(true);
    expect(isWowConsumerToy("kernel scheduler patch")).toBe(false);
  });
});

describe("shortTopicHook", () => {
  it("uses the first clause and caps at 22 chars", () => {
    expect(shortTopicHook("我把会议纪要交给它整理，结果省了一小时。后面还有")).toBe("我把会议纪要交给它整理");
    expect(shortTopicHook(null, "a".repeat(40))).toHaveLength(22);
    expect(shortTopicHook(null, null)).toBe("");
  });
});

describe("scoreContent", () => {
  const now = new Date();
  const score = (title: string, body: string, publishedAt: Date | null = now) => {
    const item = { title, body, publishedAt };
    const analysis = analyzeWithHeuristics({ ...item, author: null, canonicalUrl: "https://example.com/x", language: null });
    return scoreContent(item, analysis);
  };

  it("keeps every dimension within 0-100", () => {
    const r = score("Voice clone app", "一键克隆声线 demo video");
    for (const key of ["total", "novelty", "utility", "momentum", "shareability", "confidence", "videoSuitability"] as const) {
      expect(r[key]).toBeGreaterThanOrEqual(0);
      expect(r[key]).toBeLessThanOrEqual(100);
    }
    expect(typeof r.reasoning).toBe("string");
  });

  it("rewards freshness", () => {
    const old = new Date(Date.now() - 30 * 86_400_000);
    expect(score("tool", "demo", now).novelty).toBeGreaterThan(score("tool", "demo", old).novelty);
  });

  it("ranks a consumer demo above a dull enterprise research item", () => {
    const fun = score("一键生成歌曲 app", "Generate song from your photo, demo video, 普通人也能玩");
    const dull = score("Enterprise firmware benchmark dataset", "We propose a training architecture for enterprise CRM");
    expect(fun.total).toBeGreaterThan(dull.total);
  });
});
