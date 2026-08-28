import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { ContentDraft, PublishReviewStatus } from "@prisma/client";

const run = promisify(execFile);
const ruleRoot = path.join(process.cwd(), "vendor", "yuwen-publish-precheck");

export type PrecheckIssue = {
  severity: "MUST_FIX" | "SHOULD_FIX" | "NOTICE";
  quote: string;
  rule: string;
  explanation: string;
  replacement: string;
};

export type PrecheckReport = {
  verdict: PublishReviewStatus;
  summary: string;
  platformConclusion: string;
  scope: string;
  issues: PrecheckIssue[];
  checklist: string[];
  revisedTitle: string;
  revisedHook: string;
  revisedScript: string;
  revisedCaption: string;
  lexicalCandidates: number;
  boundary: string;
};

type LexicalCandidate = { match?: string; rule?: string; title?: string; context?: string; severity?: string };
type LexicalScan = { candidates?: LexicalCandidate[]; personal_hits?: LexicalCandidate[]; myth_advisories?: unknown[]; note?: string };

function cleanJson(text: string) {
  return text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
}

export async function runPublishPrecheck(draft: ContentDraft, options: { commercial: boolean; industry: "general" | "medical" | "finance" }) {
  const fullText = [draft.title, draft.hook, draft.script, draft.caption, Array.isArray(draft.hashtags) ? draft.hashtags.map(String).join(" ") : ""].filter(Boolean).join("\n");
  const scanArgs = [path.join(ruleRoot, "scripts", "scan.py"), "--text", fullText, "--json"];
  if (options.commercial) scanArgs.push("--commercial");
  if (options.industry !== "general") scanArgs.push("--industry", options.industry);
  const { stdout } = await run("python3", scanArgs, { timeout: 30_000, maxBuffer: 2 * 1024 * 1024 });
  const lexical = JSON.parse(stdout) as LexicalScan;

  const platformFile = draft.platform === "DOUYIN" ? "platform-douyin.md" : "platform-xiaohongshu.md";
  const [judgment, common, platformRules, commercialRules] = await Promise.all([
    readFile(path.join(ruleRoot, "references", "judgment.md"), "utf8"),
    readFile(path.join(ruleRoot, "references", "rules-common.md"), "utf8"),
    readFile(path.join(ruleRoot, "references", platformFile), "utf8"),
    options.commercial ? readFile(path.join(ruleRoot, "references", "rules-commercial.md"), "utf8") : Promise.resolve("非商业内容，不加载商业规则。"),
  ]);

  const prompt = {
    system: "你是中国自媒体发布前合规审查员。词面命中只是候选，必须结合语境判定；零命中也要检查语义风险。不得编造平台规则，不承诺百分百过审，不给谐音、错字、拆字、遮挡等绕审方法。修改时保留原钩子、第一视角和信息量，只降低实质风险。只输出 JSON。",
    user: JSON.stringify({
      task: "审核稿件并给出保意修复稿。verdict 只能为 PASSED、NEEDS_CHANGES、DO_NOT_PUBLISH。issues 每项字段只能为 severity(MUST_FIX/SHOULD_FIX/NOTICE)、quote、rule、explanation、replacement。必须输出 summary、platformConclusion、scope、issues、checklist、revisedTitle、revisedHook、revisedScript、revisedCaption、boundary。没有风险时修复稿保持原文。",
      platform: draft.platform,
      commercial: options.commercial,
      industry: options.industry,
      draft: { title: draft.title, hook: draft.hook, script: draft.script, caption: draft.caption, hashtags: draft.hashtags },
      lexical,
      rules: { judgment, common, platform: platformRules, commercial: commercialRules },
    }),
  };
  const semantic = await reviewWithDeepSeek(prompt) ?? await reviewWithArk(prompt);
  if (!semantic) return lexicalOnlyReport(lexical, draft, options, "语义审查不可用");
  const { model, content } = semantic;
  let raw: Record<string, unknown>;
  try { raw = JSON.parse(cleanJson(content)) as Record<string, unknown>; }
  catch { return lexicalOnlyReport(lexical, draft, options, "语义审查返回了无法解析的报告"); }
  const verdict = normalizeVerdict(raw.verdict ?? raw.platformConclusion);
  const issues = Array.isArray(raw.issues) ? raw.issues as PrecheckIssue[] : [];
  const checklist = Array.isArray(raw.checklist) ? raw.checklist.map(String) : raw.checklist && typeof raw.checklist === "object" ? Object.entries(raw.checklist).map(([key, value]) => `${key}: ${String(value)}`) : [];
  if (!verdict) return lexicalOnlyReport(lexical, draft, options, "DeepSeek 语义审查返回结构不完整");
  const parsed: Omit<PrecheckReport, "lexicalCandidates"> = {
    verdict,
    summary: String(raw.summary ?? "语义审查已完成。"),
    platformConclusion: String(raw.platformConclusion ?? verdict),
    scope: typeof raw.scope === "string" ? raw.scope : JSON.stringify(raw.scope ?? options),
    issues,
    checklist,
    revisedTitle: String(raw.revisedTitle ?? draft.title),
    revisedHook: String(raw.revisedHook ?? draft.hook),
    revisedScript: String(raw.revisedScript ?? draft.script),
    revisedCaption: String(raw.revisedCaption ?? draft.caption),
    boundary: String(raw.boundary ?? "本次检查不代表平台最终判定，发布前仍需人工复核。"),
  };
  return {
    model,
    report: { ...parsed, lexicalCandidates: (lexical.candidates?.length ?? 0) + (lexical.personal_hits?.length ?? 0) } as PrecheckReport,
  };
}

async function reviewWithDeepSeek(prompt: { system: string; user: string }) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return null;
  const model = process.env.DEEPSEEK_MODEL ?? "deepseek-chat";
  const baseUrl = process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com";
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      temperature: 0.1,
      max_tokens: 5000,
      response_format: { type: "json_object" },
      thinking: { type: "disabled" },
      messages: [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user },
      ],
    }),
  });
  if (!response.ok) return null;
  const payload = await response.json() as { choices?: Array<{ message?: { content?: string | null } }> };
  const content = payload.choices?.[0]?.message?.content;
  return content ? { model: `deepseek:${model}`, content } : null;
}

function arkOutputText(payload: unknown) {
  const response = payload as {
    output_text?: string;
    output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
  };
  if (response.output_text) return response.output_text;
  const message = response.output?.find((item) => item.type === "message");
  return message?.content?.find((item) => item.type === "output_text")?.text ?? null;
}

async function reviewWithArk(prompt: { system: string; user: string }) {
  const apiKey = process.env.ARK_API_KEY;
  if (!apiKey) return null;
  const model = process.env.ARK_MODEL ?? "doubao-seed-2-0-lite-260215";
  const baseUrl = process.env.ARK_BASE_URL ?? "https://ark.cn-beijing.volces.com/api/v3";
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/responses`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      input: [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user },
      ],
      text: { format: { type: "json_object" } },
    }),
  });
  if (!response.ok) return null;
  const content = arkOutputText(await response.json());
  return content ? { model: `ark:${model}`, content } : null;
}

function normalizeVerdict(value: unknown): PublishReviewStatus | null {
  const text = String(value ?? "").toUpperCase();
  if (text.includes("DO_NOT_PUBLISH") || text.includes("不建议")) return "DO_NOT_PUBLISH";
  if (text.includes("NEEDS_CHANGES") || text.includes("改后") || text.includes("修改")) return "NEEDS_CHANGES";
  if (text.includes("PASSED") || text.includes("可以发") || text.includes("通过")) return "PASSED";
  return null;
}

function lexicalOnlyReport(lexical: LexicalScan, draft: ContentDraft, options: { commercial: boolean; industry: string }, reason: string) {
  const candidates = [...(lexical.candidates ?? []), ...(lexical.personal_hits ?? [])];
  const issues: PrecheckIssue[] = candidates.slice(0, 12).map((candidate) => ({
    severity: candidate.severity === "critical" || candidate.severity === "high" ? "MUST_FIX" : "SHOULD_FIX",
    quote: candidate.match ?? candidate.context ?? "词面候选",
    rule: candidate.rule ?? candidate.title ?? "本地规则",
    explanation: "本地预检发现需要结合上下文复核的表达；这只是风险线索，不直接等于违规。",
    replacement: "待语义审查恢复后给出保意修改，当前不建议直接发布。",
  }));
  const report: PrecheckReport = {
    verdict: "NEEDS_CHANGES",
    summary: `${reason}。本地预检已完成，但系统不会在缺少语义判断时错误标记为“通过”。`,
    platformConclusion: `${draft.platform === "DOUYIN" ? "抖音" : "小红书"}：等待 AI 语义复核`,
    scope: `${options.commercial ? "商业" : "非商业"} · ${options.industry}`,
    issues,
    checklist: ["确认 AI 语义审查恢复", "核对素材版权与 AI 生成标注", "人工复核标题、封面文字、字幕和评论区引导"],
    revisedTitle: draft.title,
    revisedHook: draft.hook,
    revisedScript: draft.script,
    revisedCaption: draft.caption,
    lexicalCandidates: candidates.length,
    boundary: "当前只有词面预检结果，不代表平台最终判定，也不能替代人工复核。",
  };
  return { model: "local:yuwen-publish-precheck", report };
}
