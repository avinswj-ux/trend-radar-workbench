import { describe, expect, it } from "vitest";
import { inferTopicTheme } from "@/lib/topic-theme";
import { analyzeWithHeuristics } from "@/lib/analysis/heuristic";

describe("inferTopicTheme", () => {
  it("prioritizes research signals over everyday words", () => {
    expect(inferTopicTheme("We propose a benchmark for student essays")).toBe("TECH_FRONTIER");
  });
  it("maps concrete scenarios", () => {
    expect(inferTopicTheme("AI recipe planner for family meals")).toBe("DAILY_LIFE");
    expect(inferTopicTheme("Summarize every meeting into email")).toBe("WORKPLACE");
    expect(inferTopicTheme("开源 TTS 配音工具")).toBe("VOICE_AVATAR");
    expect(inferTopicTheme("text-to-video generator")).toBe("VIDEO_CREATION");
  });
  it("defaults to TECH_FRONTIER", () => {
    expect(inferTopicTheme("quantum compiler internals")).toBe("TECH_FRONTIER");
  });
});

const base = { author: null, canonicalUrl: "https://github.com/a/b", language: null };

describe("analyzeWithHeuristics", () => {
  it("classifies agents and tags them", () => {
    const r = analyzeWithHeuristics({ ...base, title: "my-agent", body: "An agent that runs your workflow", language: "TypeScript" });
    expect(r.category).toBe("AGENT");
    expect(r.tags).toEqual(expect.arrayContaining(["agent", "workflow", "typescript", "github"]));
    expect(new Set(r.tags).size).toBe(r.tags.length);
    expect(r.model).toBe("heuristic-v1");
    expect(r.entities[0]).toEqual({ type: "repository", name: "my-agent", url: "https://github.com/a/b" });
  });

  it("falls back to OPEN_SOURCE with a placeholder description", () => {
    const r = analyzeWithHeuristics({ ...base, title: "misc", body: null });
    expect(r.category).toBe("OPEN_SOURCE");
    expect(r.summary).toContain("该仓库尚未提供明确描述");
  });

  it("flags missing evidence and unclear audience", () => {
    const r = analyzeWithHeuristics({ ...base, title: "x", body: "quantum stuff" });
    expect(r.riskFlags).toContain("证据不足或结果不可见");
    expect(r.riskFlags).toContain("普通用户场景不明确");
  });

  it("does not flag evidence when a demo is present", () => {
    const r = analyzeWithHeuristics({ ...base, title: "x", body: "recipe app with demo screenshot" });
    expect(r.riskFlags).not.toContain("证据不足或结果不可见");
  });

  it("caps the summary at 500 characters", () => {
    const r = analyzeWithHeuristics({ ...base, title: "t", body: "a".repeat(2000) });
    expect(r.summary.length).toBeLessThanOrEqual(500);
  });
});
