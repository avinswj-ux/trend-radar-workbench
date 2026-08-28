import type { ContentItem } from "@prisma/client";
import { AVIN_TOPIC_WEIGHTS } from "@/config/avin-content-dna";
import type { AnalysisResult, ScoreResult } from "./analysis/types";

const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

function matches(text: string, pattern: RegExp) {
  return pattern.test(text);
}

export function isGenericCompilation(text: string) {
  return /ai tools?( \w+){0,4} (20\d\d|guide|course|tutorial)|ai for productivity|interactive demos? 20\d\d|step by step guide|complete (course|guide|review|platform) 20\d\d|daily live demo|viral ai prompt|best ai tools|ai tools you need|honest review \+|vendor demo|feels like magic|unlimited free access|part \d+\b|#shorts|million hotel|一文看懂|盘点|合集/i.test(
    text,
  );
}

export function isDullB2b(text: string) {
  return /customer feedback|support platform|hackathon|firmware|enterprise|meeting intelligence|autopay|crm |invoice platform|theme-engine|media-saver|downloader|scraper|工单|固件|黑客松/i.test(
    text,
  );
}

export function isUnreadableForAudience(title: string) {
  if (/[\u0900-\u097F\u0C00-\u0C7F\u0B80-\u0BFF\u0A80-\u0AFF\u0600-\u06FF]/.test(title))
    return true;
  const compact = title.replace(/\s+/g, "");
  const foreign = compact.replace(
    /[A-Za-z0-9\u2E80-\u9FFF&:|,.!?'"()#+\-_/]/g,
    "",
  );
  return foreign.length / Math.max(1, compact.length) > 0.28;
}

export function isWowConsumerToy(text: string) {
  return /stop typing|just talk|recipe|self-organiz|builds entire apps|lovable|voice clone|3-?sec|background remov|talking photo|music3|generate song|ice making|no code app|一键|不用打字|对着说|冰箱|菜谱|克隆声线|生成歌曲|不用写代码/i.test(
    text,
  );
}

export function shortTopicHook(angle?: string | null, summary?: string | null) {
  const clean = (value?: string | null) =>
    (value || "").replace(/\s+/g, " ").trim();
  const source = clean(angle) || clean(summary);
  if (!source) return "";
  const sentence = source.split(/[。！？!?\n]/)[0]?.trim() || source;
  const clauses = sentence
    .split(/[，,；;：:]/)
    .map((part) => part.trim())
    .filter(Boolean);
  const hook =
    clauses[0] && clauses[0].length >= 8
      ? clauses[0]
      : clauses.slice(0, 2).join("，") || sentence;
  return hook.slice(0, 22);
}

export function scoreContent(
  item: Pick<ContentItem, "title" | "body" | "publishedAt">,
  analysis: AnalysisResult,
): ScoreResult {
  const corpus = [
    item.title,
    item.body ?? "",
    analysis.summary,
    analysis.chineseAngle,
    analysis.tags.join(" "),
    analysis.riskFlags.join(" "),
  ]
    .join(" ")
    .toLowerCase();
  const ageInDays = item.publishedAt
    ? (Date.now() - item.publishedAt.getTime()) / 86_400_000
    : 14;
  const novelty = clamp(100 - Math.max(0, ageInDays) * 5);

  const everydayThemes = new Set([
    "DAILY_LIFE",
    "WORKPLACE",
    "LEARNING_GROWTH",
    "SMALL_BUSINESS",
    "FUN_PROJECT",
    "CREATOR_WORKFLOW",
    "VOICE_AVATAR",
    "VIDEO_CREATION",
  ]);
  const generic = isGenericCompilation(`${item.title} ${corpus}`);
  const dullB2b = isDullB2b(`${item.title} ${corpus}`);
  const unreadable = isUnreadableForAudience(item.title);
  const wow = isWowConsumerToy(`${item.title} ${corpus}`);
  const funToy = matches(
    corpus,
    /fun|toy|demo app|playable|game|recipe|fitness|voice clone|avatar|one[- ]?click|好玩|试玩|玩具|菜谱|变声|数字人|一键生成|不用写代码/,
  );
  const concreteScene = matches(
    corpus,
    /meeting|email|document|spreadsheet|presentation|shopping|travel|study|teacher|student|customer|sales|marketing|video|voice|photo|resume|fitness|recipe|会议|邮件|文档|表格|购物|旅行|学习|老师|学生|客户|销售|营销|视频|语音|图片|简历|健身|菜谱|电商|办公|创作/,
  );
  const abilityChange = matches(
    corpus,
    /one[- ]?click|no[- ]?code|without coding|automate|replace|clone|predict|generate|turn .* into|save time|一键|不会.*也能|不用.*就能|自动|替你|帮你|克隆|预测|生成|复刻|省下|变成|获得.*能力|完成.*工作/,
  );
  const technicalResearch =
    analysis.topicTheme === "TECH_FRONTIER" ||
    matches(
      corpus,
      /benchmark|training|architecture|embedding|reinforcement learning|dataset|sdk|api integration|论文|训练|架构|基准|数据集|接口集成|底层框架/,
    );
  const audienceMismatch =
    analysis.riskFlags.includes("标题受众与真实用户错位") ||
    (matches(item.title.toLowerCase(), /狂喜|普通人|健身|设计|电商|学生|创作者/) &&
      matches(corpus, /dataset|sdk|api integration|for developers|数据集|接口集成|供开发者|模型训练/));

  // Existing database columns keep compatibility while carrying the new Avin dimensions:
  // utility=ability gain, momentum=emotional pull, shareability=visible outcome,
  // videoSuitability=first-person testability, confidence=credibility.
  const abilityGain = clamp(
    (everydayThemes.has(analysis.topicTheme) ? 62 : 36) +
      (analysis.topicTheme === "FUN_PROJECT" ? 12 : 0) +
      (funToy || wow ? 16 : 0) +
      (concreteScene ? 12 : 0) +
      (abilityChange ? 16 : 0) -
      (generic ? 28 : 0) -
      (dullB2b ? 22 : 0) -
      (unreadable ? 24 : 0) -
      (technicalResearch ? 28 : 0) -
      (audienceMismatch ? 30 : 0),
  );

  const emotionalSignals = [
    /free|open.source|no.code|one.click|replace|predict|clone|viral|免费|开源|白嫖|一键|不用|替代|预测|克隆|复刻|狂喜|焦虑|省钱|失业/,
    /普通人也能|不会.*也能|原来.*现在|从.*到|直接.*完成|突然获得/,
  ].filter((pattern) => matches(corpus, pattern)).length;
  const emotionalPull = clamp(
    36 +
      emotionalSignals * 16 +
      (wow ? 22 : 0) +
      (abilityChange ? 10 : 0) -
      (generic ? 32 : 0) -
      (dullB2b ? 18 : 0) -
      (unreadable ? 20 : 0) -
      (audienceMismatch ? 25 : 0),
  );

  const looksLikeDemo = matches(
    corpus,
    /demo|walkthrough|hands[- ]?on|live test|screen recording|before.after|output|result|实测|操作演示|工作流演示|界面演示|录屏|输出结果|前后对比|成品/,
  );
  const proofSignals = matches(
    corpus,
    /github|stars?|benchmark|official|investment|users?|官方|仓库|星标|跑分|榜单|投资|用户量|价格|许可证/,
  );
  const looksStatic = matches(
    corpus,
    /paper|podcast|slides?|论文|播客|幻灯片|纯概念|只有介绍/,
  );
  const visibleOutcome = clamp(
    38 + (looksLikeDemo ? 35 : 0) + (proofSignals ? 12 : 0) + (abilityChange ? 8 : 0) - (looksStatic ? 25 : 0),
  );

  const evidenceWeak =
    analysis.riskFlags.includes("证据不足或结果不可见") ||
    analysis.riskFlags.includes("普通用户场景不明确");
  const firstPersonTestability = clamp(
    40 +
      (looksLikeDemo ? 28 : 0) +
      (concreteScene ? 14 : 0) +
      (analysis.category === "TOOL" || analysis.category === "OPEN_SOURCE" ? 8 : 0) -
      (technicalResearch ? 18 : 0) -
      (evidenceWeak ? 18 : 0),
  );
  const credibility = clamp(
    (analysis.model === "heuristic-v1" ? 48 : 70) +
      (proofSignals ? 20 : 0) +
      (looksLikeDemo ? 8 : 0) -
      (evidenceWeak ? 18 : 0),
  );

  const total = clamp(
    abilityGain * AVIN_TOPIC_WEIGHTS.abilityGain +
      emotionalPull * AVIN_TOPIC_WEIGHTS.emotionalPull +
      visibleOutcome * AVIN_TOPIC_WEIGHTS.visibleOutcome +
      firstPersonTestability * AVIN_TOPIC_WEIGHTS.firstPersonTestability +
      novelty * AVIN_TOPIC_WEIGHTS.novelty +
      credibility * AVIN_TOPIC_WEIGHTS.credibility,
  );

  return {
    total,
    novelty,
    utility: abilityGain,
    momentum: emotionalPull,
    shareability: visibleOutcome,
    confidence: credibility,
    videoSuitability: firstPersonTestability,
    reasoning: `普通人能力获得感 ${abilityGain}、情绪拉力 ${emotionalPull}、结果可见 ${visibleOutcome}。${generic ? "合集/教程盘点，普通人停不下来的理由不足。" : dullB2b ? "偏 B2B 后台，不像能发给朋友的报料。" : unreadable ? "标题语言不适合中文观众。" : wow ? "有一眼能懂的结果，适合当选题。" : technicalResearch ? "偏底层技术。" : "按普通人能不能看懂、想不想点开排序。"}`,
  };
}
