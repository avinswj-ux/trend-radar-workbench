import type { ContentItem, AiAnalysis, ContentPlatform } from "@prisma/client";
import { varyAvatarActions, type FishyAction } from "@/lib/avatar/fishy";
import avinBrand from "@/config/avin-brand.json";
import { AVIN_ACCOUNT_DNA, AVIN_EVIDENCE_RULES, AVIN_VOICE_DIRECTION } from "@/config/avin-content-dna";
import {
  hasCompleteEvidenceMap,
  normalizeEvidenceStoryboard,
  type EvidenceMappedScene,
} from "@/lib/evidence-map";
import { repairStoryboardNarrations } from "@/lib/scene-narration";

export type DraftResult = {
  model: string;
  title: string;
  hook: string;
  script: string;
  caption: string;
  hashtags: string[];
  storyboard: Array<EvidenceMappedScene & { avatarAction: FishyAction }>;
};

type Input = ContentItem & {
  analysis: AiAnalysis | null;
  sourceImages?: string[];
  imageInventory?: Array<{ n: number; text: string }>;
  quote?: { author?: string | null; text?: string } | null;
  articleUrl?: string | null;
};

export async function generateDraft(item: Input, platform: ContentPlatform): Promise<DraftResult> {
  const prompt = buildDraftPrompt(item, platform);
  const needLongCopy = platform === "XIAOHONGSHU" || platform === "DOUYIN";
  const minScript = minScriptLength(item);
  const fromDeepSeek = await generateWithDeepSeek(prompt);
  if (fromDeepSeek && !(needLongCopy && tooThin(fromDeepSeek, minScript))) return finalizeDraft(fromDeepSeek);
  const fromArk = await generateWithArk(prompt);
  if (fromArk && !(needLongCopy && tooThin(fromArk, minScript))) return finalizeDraft(fromArk);
  return finalizeDraft(fallbackDraft(item, platform));
}

function buildDraftPrompt(item: Input, platform: ContentPlatform) {
  const isXNews = /x\.com\/\w+\/status\//i.test(item.canonicalUrl);
  const imageCount = item.sourceImages?.length ?? 0;
  const scenes = targetSceneCount(item);
  const scriptRange = platform === "DOUYIN" ? "450-750" : "480-850";
  const slideshowRule = imageCount >= 8
    ? `原图有 ${imageCount} 张，只是素材池，不必用完。storyboard 固定 ${scenes} 段，script ${scriptRange} 字。每段只配 1 张最能证明这句口播的图，visual 写成“原图N：……”。剩下的图直接丢掉。禁止为了用完图片而加段，否则成片会切图过快。`
    : `storyboard 恰好 ${scenes} 段。`;
  const platformGuide = isXNews && platform === "XIAOHONGSHU"
    ? `这是中文圈博主的长文图文，不是短微博。必须用 Avin 自己的理解重排，事实密度要够：script ${scriptRange} 字，caption 同样是可直接发的完整小红书笔记。每页 narration 70-140 字，讲清一个可核验事实。禁止复述原博主金句和段落结构，禁止压成 200 字短评。封面标题是我们的钩子。caption 可用文字注明信源 @${item.author ?? "原博主"}，不要把 X 用户名或 x.com 写进画面。有 ${imageCount} 张原图。${slideshowRule}`
    : platform === "XIAOHONGSHU"
    ? `小红书第一视角体验内容：script 和 caption 都要 450-800 字，能当完整笔记发出去。每页 narration 70-140 字。${slideshowRule}`
    : isXNews
    ? `这是中文圈图文改成抖音口播，信息量要覆盖原图，不要压成二十秒口号。script ${scriptRange} 字，每段 narration 60-130 字。前三秒具体麻烦或离谱结果；后面按图把数字和结论讲完。${slideshowRule}${AVIN_VOICE_DIRECTION}`
    : `抖音口播要和小红书一样把事情讲清楚：450-750 字，6 段，每段 60-130 字。${AVIN_VOICE_DIRECTION}`;
  return {
    system: `你是 Avin 的中文 AI 内容主编。Avin 的定位是：${avinBrand.positioning} 已确认的人设事实：${avinBrand.profileFacts.join("；")}。内容承诺：${avinBrand.contentPromise}。${AVIN_ACCOUNT_DNA} ${platformGuide} 任务是把外网好玩项目翻译成普通人听得懂、愿意看完的报料，不是拆对标账号，也不是给素材硬编角度。默认写给不懂技术的人：先点名日常生活、职场、学习、创作或小生意里的一件具体麻烦，再说这个项目替他做哪一步、能看见什么成品、谁别碰。不要从模型参数、安装命令、框架开场。抖音钩子之后最多自然带一句“${avinBrand.fixedOpening}”，不要背履历。封面标题必须是疑问、反差或具体结果，禁止教程体、盘点体、拆解体。title、hook、caption、hashtags 和第一幕 onScreenText 保留来源项目名的原始写法。第一视角必须匹配证据：有操作记录才能写“我试了”；只有官方页就写“我看完官方演示”；只有标题就写“我研究了现有信息”。禁止虚构亲测、数据、职业和客户案例。应用场景只能写成使用设想。${AVIN_EVIDENCE_RULES} 输出严格 JSON，字段只能是 title,hook,script,caption,hashtags,storyboard。script 不重复 hook。hashtags 是 3-7 个不含#的中文标签。storyboard 是 ${scenes} 段数组，每段仅含 scene(整数),durationSeconds(整数),claim,evidenceType,evidenceRequirement,visual,narration,onScreenText,avatarAction。evidenceType 仅可为 OFFICIAL_DEMO、PRODUCT_UI、GITHUB_PROOF、DATA_PROOF、RESULT_PROOF、LIMIT_PROOF、AVIN_COMMENTARY。avatarAction 仅可选 IDLE、TALK、POINT_LEFT、THINK、SURPRISED、EXPLAIN、QUESTION、LIKE、SMILE、SHAKE_HEAD。`,
    user: JSON.stringify({
      title: item.title,
      sourceUrl: item.canonicalUrl,
      sourceBody: item.body,
      sourceImages: item.sourceImages ?? [],
      imageInventory: item.imageInventory ?? [],
      requiredScenes: scenes,
      quote: item.quote ?? null,
      articleUrl: item.articleUrl ?? null,
      remixRule: isXNews
        ? "用原图，不用原文结构。先写自己的理解，再回看原帖核对事实。图片按口播选用，不必用完。"
        : null,
      analysis: item.analysis
        ? {
            summary: item.analysis.summary,
            tags: item.analysis.tags,
            chineseAngle: item.analysis.chineseAngle,
            riskFlags: item.analysis.riskFlags,
          }
        : null,
    }),
  };
}

function compactLen(value: string) {
  return value.replace(/\s+/g, "").length;
}

function targetSceneCount(item: Input) {
  const scriptChars = compactLen(item.body ?? "");
  if (scriptChars >= 1200) return 8;
  if (scriptChars >= 900) return 7;
  return 6;
}

function minScriptLength(item: Input) {
  return 360;
}

function tooThin(draft: DraftResult, minScript: number) {
  const scenes = Array.isArray(draft.storyboard) ? draft.storyboard.length : 0;
  return compactLen(draft.script) < minScript || scenes < Math.min(6, Math.round(minScript / 90));
}

function parseDraft(raw: string | null | undefined, model: string): DraftResult | null {
  if (!raw) return null;
  try {
    const result = JSON.parse(raw) as Omit<DraftResult, "model">;
    if (!result.title || !result.hook || !result.script || !result.caption || !Array.isArray(result.hashtags) || !hasCompleteEvidenceMap(result.storyboard)) {
      return null;
    }
    return {
      ...result,
      hashtags: result.hashtags.map(String).slice(0, 7),
      storyboard: normalizeStoryboard(result.storyboard as unknown as Array<Record<string, unknown>>),
      model,
    };
  } catch {
    return null;
  }
}

async function generateWithDeepSeek(prompt: { system: string; user: string }) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return null;
  const model = process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash-0731";
  const baseUrl = process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com";
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      max_tokens: 5000,
      response_format: { type: "json_object" },
      thinking: { type: "disabled" },
      messages: [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user },
      ],
    }),
  });
  if (!response.ok) {
    console.warn(`DeepSeek content generation failed: ${response.status}; trying Ark fallback.`);
    return null;
  }
  const payload = await response.json() as { choices?: Array<{ message?: { content?: string | null } }> };
  const parsed = parseDraft(payload.choices?.[0]?.message?.content, `deepseek:${model}`);
  if (!parsed) console.warn("DeepSeek content generation returned an invalid format; trying Ark fallback.");
  return parsed;
}

function arkOutputText(payload: unknown) {
  const response = payload as {
    output_text?: string;
    output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
  };
  if (response.output_text) return response.output_text;
  const message = response.output?.find((item) => item.type === "message");
  return message?.content?.find((item) => item.type === "output_text")?.text;
}

async function generateWithArk(prompt: { system: string; user: string }) {
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
      max_output_tokens: 5000,
    }),
  });
  if (!response.ok) {
    console.warn(`Ark content generation failed: ${response.status}; using the verified-source template instead.`);
    return null;
  }
  const parsed = parseDraft(arkOutputText(await response.json()), `ark:${model}`);
  if (!parsed) console.warn("Ark content generation returned an invalid format; using the verified-source template instead.");
  return parsed;
}

function pairSlidesWithFacts(inventory: Array<{ n: number; text: string }>, body: string) {
  const facts = extractFactBeats(body);
  const used = new Set<number>();
  return inventory.map((image) => {
    const index = facts.findIndex((fact, factIndex) => !used.has(factIndex) && factMatchesSlide(image.text, fact));
    const chosen = index >= 0 ? index : facts.findIndex((_, factIndex) => !used.has(factIndex));
    if (chosen >= 0) used.add(chosen);
    return { n: image.n, fact: chosen >= 0 ? facts[chosen] : cleanSlideLabel(image.text) };
  });
}

function extractFactBeats(body: string) {
  const seeded = [
    ...body.split(/[。！？\n]/),
    ...[...body.matchAll(/[^。！？\n]{8,80}(?:%|万|天|星|页|个|比|行)/g)].map((match) => match[0]),
  ]
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length >= 12 && line.length <= 80);
  const unique: string[] = [];
  for (const line of seeded) {
    if (unique.some((item) => factMatchesSlide(item, line))) continue;
    unique.push(line);
  }
  return unique.slice(0, 12);
}

function factMatchesSlide(slide: string, fact: string) {
  const hay = slide.toLowerCase();
  return ["koishi", "codex", "65", "84", "star", "插件", "测试", "schema", "52", "pi", "论文", "tui", "web", "1425", "211"].some(
    (token) => hay.includes(token) && fact.toLowerCase().includes(token),
  );
}

function cleanSlideLabel(text: string) {
  return text
    .replace(/[A-Za-z]{8,}/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40) || "图上的可核验数字";
}

function fallbackDraft(item: Input, platform: ContentPlatform): DraftResult {
  const isXNews = /x\.com\/\w+\/status\//i.test(item.canonicalUrl);
  const summary = item.analysis?.summary ?? item.body ?? "一项值得关注的 AI 新动态。";
  const angle = item.analysis?.chineseAngle ?? "从实际工作流中验证它是否真的有用。";
  const product = item.title.split("/").at(-1) ?? item.title;
  const inventory = item.imageInventory ?? [];
  if (isXNews && inventory.length >= 8) {
    const paired = pairSlidesWithFacts(inventory, item.body ?? summary).slice(0, 6);
    const hook = `一组图把项目拆成能核对的数字，比口号吓人：${paired[0]?.fact.slice(0, 24) || item.title}`;
    const lines = paired.map((slide, index) => `${index + 1}. 原图${slide.n}：${slide.fact}`);
    const script = `${hook}\n\n${lines.join("\n")}\n\n这不是给普通人装来玩的驾驶舱。数字先当线索，自己跑通才算数。`;
    const storyboard = paired.map((slide, index) => ({
      scene: index + 1,
      durationSeconds: 8,
      claim: slide.fact,
      evidenceType: index === paired.length - 1 ? "LIMIT_PROOF" : "DATA_PROOF",
      evidenceRequirement: `原图${slide.n}上可核验的数字或标题`,
      visual: `原图${slide.n}：${slide.fact.slice(0, 36)}`,
      narration:
        index === 0
          ? `一组图把项目拆成能核对的数字。${slide.fact}`
          : index === paired.length - 1
            ? `${slide.fact}。热归热，先核对再转发。`
            : `原图${slide.n}：${slide.fact}`,
      onScreenText: slide.fact.slice(0, 18),
    }));
    return {
      model: "template:x-news-slideshow-v2",
      title: (item.analysis?.chineseAngle ?? "这些数字比口号吓人").slice(0, 24),
      hook,
      script,
      caption: `${script}\n\n信源：@${item.author ?? "原博主"}`,
      hashtags: ["AI新闻", "效率工具", "Avin"],
      storyboard: normalizeStoryboard(storyboard),
    };
  }
  if (isXNews && platform === "XIAOHONGSHU") {
    const facts = (item.body || summary)
      .split(/\n+/)
      .map((line) => line.trim())
      .filter((line) => line.length > 12)
      .slice(0, 6);
    const hook = `刷到一篇长图文，我按自己的理解重排了一遍：${(item.analysis?.chineseAngle || item.title).slice(0, 28)}`;
    const middle = facts.length
      ? facts.map((fact, index) => `${index + 1}. ${fact.slice(0, 120)}`).join("\n")
      : summary;
    const script = `${hook}\n\n原文里真正能核验的点：\n${middle}\n\n我关心的是普通人能不能用上：${angle}\n\n信源：@${item.author ?? "原博主"}`;
    return {
      model: "template:x-news-remix-v3",
      title: (item.analysis?.chineseAngle ?? item.title).slice(0, 24),
      hook,
      script,
      caption: `${script}\n\n#AI新闻 #效率工具 #Avin`,
      hashtags: ["AI新闻", "效率工具", "Avin"],
      storyboard: normalizeStoryboard([
        { scene: 1, durationSeconds: 6, claim: item.title, evidenceType: "OFFICIAL_DEMO", evidenceRequirement: "原帖标题与核心事实", visual: "原帖关键句和项目名", narration: hook, onScreenText: item.title.slice(0, 16) },
        { scene: 2, durationSeconds: 8, claim: "这件事跟普通人有什么关系", evidenceType: "PRODUCT_UI", evidenceRequirement: "原帖里可核验的能力或产品", visual: "对应产品或发布页", narration: summary.slice(0, 60), onScreenText: "跟你有什么关系" },
        { scene: 3, durationSeconds: 8, claim: angle, evidenceType: "RESULT_PROOF", evidenceRequirement: "可见结果或使用设想", visual: "结果或使用场景卡", narration: angle.slice(0, 60), onScreenText: "我真正关心的" },
        { scene: 4, durationSeconds: 7, claim: "先核对再转发", evidenceType: "LIMIT_PROOF", evidenceRequirement: "原帖限制或待验证点", visual: "门槛或注意项", narration: "我不会原文照搬，先看它是不是真能用。", onScreenText: "先核对" },
        { scene: 5, durationSeconds: 6, claim: "信源", evidenceType: "GITHUB_PROOF", evidenceRequirement: "原帖链接", visual: "原帖链接卡片", narration: "信源放评论，想看原文去 X。", onScreenText: "信源" },
        { scene: 6, durationSeconds: 5, claim: "Avin 判断", evidenceType: "AVIN_COMMENTARY", evidenceRequirement: "不新增事实", visual: "结论卡", narration: "新闻当线索，自己跑通才算数。", onScreenText: "当线索" },
      ]),
    };
  }
  if (platform === "DOUYIN") {
    const facts = (item.body || summary)
      .split(/\n+/)
      .map((line) => line.trim())
      .filter((line) => line.length > 12)
      .slice(0, 5);
    const hook = `先说麻烦：${(item.analysis?.chineseAngle || item.title).slice(0, 28)}`;
    const beats = facts.length ? facts.map((fact) => fact.slice(0, 110)) : [summary.slice(0, 110), angle.slice(0, 110)];
    const script = [hook, ...beats, `门槛也说清楚：${angle.slice(0, 80)}`, "我只把它当线索，自己跑通才算数。"].join("\n");
    return {
      model: "template:douyin-rich-v1",
      title: (item.analysis?.chineseAngle ?? item.title).slice(0, 24),
      hook,
      script,
      caption: `${script}\n\n来源：${item.canonicalUrl}`,
      hashtags: [product, "AI工具", "Avin实测"],
      storyboard: normalizeStoryboard([
        { scene: 1, durationSeconds: 10, claim: hook, evidenceType: "OFFICIAL_DEMO", evidenceRequirement: "原帖或官方页能证明这个麻烦", visual: "原图1：对应麻烦或产品名", narration: hook, onScreenText: product.slice(0, 16) },
        { scene: 2, durationSeconds: 12, claim: beats[0] ?? summary, evidenceType: "PRODUCT_UI", evidenceRequirement: "可见功能", visual: "原图2：核心功能界面", narration: beats[0] ?? summary, onScreenText: "它替我做哪一步" },
        { scene: 3, durationSeconds: 12, claim: beats[1] ?? angle, evidenceType: "RESULT_PROOF", evidenceRequirement: "可见结果", visual: "原图3：结果或演示", narration: beats[1] ?? angle, onScreenText: "结果看得见" },
        { scene: 4, durationSeconds: 10, claim: beats[2] ?? "先看门槛", evidenceType: "LIMIT_PROOF", evidenceRequirement: "价格、安装或限制", visual: "原图4：限制或价格", narration: beats[2] ?? `门槛也说清楚：${angle.slice(0, 80)}`, onScreenText: "先看门槛" },
        { scene: 5, durationSeconds: 10, claim: beats[3] ?? "谁适合谁别碰", evidenceType: "DATA_PROOF", evidenceRequirement: "适用对象", visual: "原图5：使用对象", narration: beats[3] ?? "适合愿意自己核对的人，不想动手的别点。", onScreenText: "谁适合" },
        { scene: 6, durationSeconds: 8, claim: "当线索", evidenceType: "AVIN_COMMENTARY", evidenceRequirement: "不新增事实", visual: "结论卡", narration: "我只把它当线索，自己跑通才算数。", onScreenText: "当线索" },
      ]),
    };
  }
  const title = platform === "XIAOHONGSHU" ? `我发现 ${product} 最吸引人的不是“又一个 AI 工具”` : `${product} 真能接住一整套工作流吗？`;
  const hook = `我最近一直在用 Claude 和 Codex 搭工作流，所以看到 ${product} 时，我最关心的不是它会不会聊天，而是生成后的东西还能不能继续改。`;
  const conclusion = `我的判断是：先把它列入实测清单，但在真正安装跑通前，我不会把官方描述当成自己的使用结果。`;
  return { model: "template:verified-source-v3", title, hook, script: `${hook}\n\n${summary}\n\n放到我的工作流里，我真正想验证的是：${angle}\n\n${conclusion}`, caption: `${hook}\n\n${summary}\n\n${conclusion}\n\n来源：${item.canonicalUrl}`, hashtags: [product, "AI工作台", "AI工作流", "Avin实测"], storyboard: normalizeStoryboard([
    { scene: 1, durationSeconds: 6, claim: `${product} 是否能给普通人带来可见的新能力`, evidenceType: "OFFICIAL_DEMO", evidenceRequirement: "官方项目首页与一句话产品定位", visual: "官方项目页标题与定位区域，缓慢推近并标出产品名", narration: hook, onScreenText: `${product} 能替我做什么？` },
    { scene: 2, durationSeconds: 9, claim: "产品解决的具体任务", evidenceType: "PRODUCT_UI", evidenceRequirement: "官方 README 中能证明核心输入、处理动作和输出的功能段落或界面", visual: "README 核心功能区域，逐项框选输入、处理动作与输出结果", narration: summary, onScreenText: "它替我完成哪一步" },
    { scene: 3, durationSeconds: 9, claim: "最终结果是否真实可见", evidenceType: "RESULT_PROOF", evidenceRequirement: "官方演示、输出文件、报告或真实成品；若缺失则明确标记待验证", visual: "官方结果示例或待验证清单，重点放大最终输出对象", narration: angle, onScreenText: "结果必须看得见" },
    { scene: 4, durationSeconds: 8, claim: "使用门槛与限制", evidenceType: "LIMIT_PROOF", evidenceRequirement: "安装说明、价格、许可证、硬件要求或官方限制", visual: "官方安装与限制说明，标出费用、环境或许可条件", narration: "我还会检查它的安装门槛、成本、隐私和限制，而不是只看演示效果。", onScreenText: "别忽略真实门槛" },
    { scene: 5, durationSeconds: 7, claim: "Avin 的最终判断", evidenceType: "AVIN_COMMENTARY", evidenceRequirement: "前述证据汇总与待测试项，不新增事实主张", visual: "Avin 结论卡，左侧列已证实能力，右侧列待验证问题", narration: conclusion, onScreenText: "先证实，再推荐" },
  ]) };
}

function normalizeStoryboard(storyboard: Array<Record<string, unknown>>): DraftResult["storyboard"] {
  return varyAvatarActions(normalizeEvidenceStoryboard(storyboard));
}

function finalizeDraft(draft: DraftResult): DraftResult {
  const storyboard = repairStoryboardNarrations(draft.storyboard, draft.script);
  return {
    ...draft,
    storyboard,
    script: storyboard.map((scene) => scene.narration).filter(Boolean).join("\n\n"),
  };
}
