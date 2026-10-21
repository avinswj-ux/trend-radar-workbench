import { describe, expect, it } from "vitest";
import { computeNewsFingerprint, fingerprintsOverlap, parseFingerprintKeys, titlesSimilar } from "@/lib/news-fingerprint";

describe("computeNewsFingerprint", () => {
  it("extracts a normalized GitHub repo key", () => {
    const { keys } = computeNewsFingerprint({ title: "New agent", body: "See https://github.com/Foo/Bar.git now" });
    expect(keys).toContain("github:foo/bar");
  });

  it("ignores non-repo GitHub paths such as topics", () => {
    const { keys } = computeNewsFingerprint({ title: "x", body: "https://github.com/topics/ai" });
    expect(keys.some((k) => k.startsWith("github:"))).toBe(false);
  });

  it("extracts X article ids from the payload", () => {
    const { keys } = computeNewsFingerprint({ title: "t", rawPayload: { articleUrl: "https://x.com/i/article/12345" } });
    expect(keys).toContain("article:12345");
  });

  it("detects known product mentions in the headline", () => {
    expect(computeNewsFingerprint({ title: "GPT-5 发布" }).keys).toContain("product:gpt-5");
    expect(computeNewsFingerprint({ title: "Kimi K2 上线" }).keys).toContain("product:kimi-k2");
  });

  it("normalizes external URLs and drops x.com / t.co links", () => {
    const { keys } = computeNewsFingerprint({
      title: "t",
      body: "https://www.example.com/blog/post/?utm=1 and https://t.co/abcdefghijk",
    });
    expect(keys).toContain("url:example.com/blog/post");
    expect(keys.some((k) => k.includes("t.co"))).toBe(false);
  });

  it("falls back to a title key when nothing strong is found", () => {
    const result = computeNewsFingerprint({ title: "Hello, World!" });
    expect(result.keys).toEqual([]);
    expect(result.fingerprint).toBe("title:hello world");
  });
});

describe("parseFingerprintKeys", () => {
  it("splits and trims, ignoring empties", () => {
    expect(parseFingerprintKeys(" a | b ||c ")).toEqual(["a", "b", "c"]);
    expect(parseFingerprintKeys(null)).toEqual([]);
  });
});

describe("fingerprintsOverlap", () => {
  it("matches on shared strong keys only", () => {
    expect(fingerprintsOverlap(["github:a/b", "title:x"], ["github:a/b"])).toBe(true);
    expect(fingerprintsOverlap(["title:x"], ["title:x"])).toBe(false);
    expect(fingerprintsOverlap(["url:a.com/x"], ["url:b.com/y"])).toBe(false);
  });
});

describe("titlesSimilar", () => {
  it("treats near-duplicate titles as similar", () => {
    expect(titlesSimilar("OpenAI releases new agent toolkit today", "OpenAI releases new agent toolkit")).toBe(true);
    expect(titlesSimilar("智谱发布全新视频生成模型", "智谱发布全新视频生成模型啦")).toBe(true);
  });

  it("does not match unrelated or too-short titles", () => {
    expect(titlesSimilar("OpenAI releases agent toolkit", "Google ships new phone camera")).toBe(false);
    expect(titlesSimilar("hi", "hi")).toBe(false);
  });
});
