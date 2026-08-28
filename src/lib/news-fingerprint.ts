export type NewsFingerprintInput = {
  title: string;
  body?: string | null;
  canonicalUrl?: string | null;
  rawPayload?: Record<string, unknown> | null;
};

const PRODUCT_PATTERNS: Array<{ key: string; pattern: RegExp }> = [
  { key: "product:glm-5.3", pattern: /glm[\s-]?5\.3|智谱\s*5\.3/i },
  { key: "product:glm-5.2", pattern: /glm[\s-]?5\.2|智谱\s*5\.2/i },
  { key: "product:deepseek-harness", pattern: /deepseek\s*harness|\bdsh\b/i },
  { key: "product:claude-mythos", pattern: /claude\s*mythos/i },
  { key: "product:gpt-5", pattern: /\bgpt[\s-]?5(?:\.\d+)?\b/i },
  { key: "product:kimi-k2", pattern: /kimi\s*k2\b/i },
  { key: "product:workbuddy", pattern: /workbuddy/i },
];

const TITLE_STOP = new Set(
  "的了是在我有和与一个这那你他她它为对把被从到也还就都及或但而且着过么吗呢啊不没有可以如何怎么什么为什么因为所以以及来了详细阐述可能最近看到最好项目充分说明大家虽然喜欢真的没人官方发了一篇关于".split(""),
);

export function computeNewsFingerprint(input: NewsFingerprintInput) {
  const keys = collapseKeys(collectFingerprintKeys(input));
  return {
    fingerprint: keys.join("|") || titleKey(input.title),
    keys,
  };
}

export function parseFingerprintKeys(value: string | null | undefined) {
  return (value ?? "")
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function fingerprintsOverlap(left: string[], right: string[]) {
  const strongLeft = left.filter((key) => !key.startsWith("title:"));
  const strongRight = new Set(right.filter((key) => !key.startsWith("title:")));
  if (!strongLeft.length || !strongRight.size) return false;
  return strongLeft.some((key) => strongRight.has(key));
}

export function titlesSimilar(left: string, right: string) {
  const a = titleTokens(left);
  const b = titleTokens(right);
  if (a.size < 3 || b.size < 3) return false;
  let overlap = 0;
  for (const token of a) if (b.has(token)) overlap += 1;
  return overlap / (a.size + b.size - overlap) >= 0.52;
}

function collectFingerprintKeys(input: NewsFingerprintInput) {
  const payload = input.rawPayload ?? {};
  const tweet = headlineText(input);
  const articleUrl = typeof payload.articleUrl === "string" ? payload.articleUrl : "";
  const idBlob = `${tweet}\n${(input.body ?? "").slice(0, 400)}\n${articleUrl}\n${input.canonicalUrl ?? ""}`;
  const keys = new Set<string>();

  for (const match of idBlob.matchAll(/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/gi)) {
    const repo = match[1].replace(/\.git$/i, "").toLowerCase();
    if (!/^(topics|orgs|settings|features|about|sponsors)\b/.test(repo)) keys.add(`github:${repo}`);
  }

  for (const match of idBlob.matchAll(/(?:x\.com|twitter\.com)\/i\/article\/(\d+)/gi)) {
    keys.add(`article:${match[1]}`);
  }

  const articleId = articleUrl.match(/article\/(\d+)/)?.[1];
  if (articleId) keys.add(`article:${articleId}`);

  for (const match of idBlob.matchAll(/https?:\/\/([A-Za-z0-9.-]+(?:\/[A-Za-z0-9._~/-]*)?)/gi)) {
    const normalized = normalizeExternalUrl(match[1]);
    if (normalized) keys.add(`url:${normalized}`);
  }

  for (const product of PRODUCT_PATTERNS) {
    if (product.pattern.test(tweet)) keys.add(product.key);
  }

  return [...keys];
}

function headlineText(input: NewsFingerprintInput) {
  const payload = input.rawPayload ?? {};
  const quote = payload.quote && typeof payload.quote === "object" ? (payload.quote as { text?: string }).text ?? "" : "";
  const originalTitle = typeof payload.title === "string" ? payload.title : "";
  return [input.title, originalTitle, quote].filter(Boolean).join("\n").slice(0, 500);
}

function collapseKeys(keys: string[]) {
  const github = keys.filter((key) => key.startsWith("github:")).sort((a, b) => b.length - a.length);
  const keptGithub = new Set<string>();
  for (const key of github) {
    const repo = key.slice("github:".length);
    if ([...keptGithub].some((kept) => kept.slice("github:".length).startsWith(repo))) continue;
    keptGithub.add(key);
  }
  return [...new Set([...keptGithub, ...keys.filter((key) => !key.startsWith("github:"))])];
}

function normalizeExternalUrl(raw: string) {
  const cleaned = raw.replace(/[),.;\\]+$/g, "").replace(/\/+$/g, "").replace(/\?.*$/, "").replace(/#.*$/, "").toLowerCase();
  if (/^(?:www\.)?(?:x|twitter|nitter\.[^/]+|t\.co|pic\.twitter)\b/.test(cleaned)) return "";
  if (cleaned.length < 12 || cleaned.length > 120) return "";
  if (/[\u4e00-\u9fff]/.test(cleaned)) return "";
  return cleaned.replace(/^www\./, "");
}

function titleKey(title: string) {
  return `title:${normalizeTitle(title).slice(0, 48)}`;
}

function normalizeTitle(title: string) {
  return title
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleTokens(title: string) {
  const normalized = normalizeTitle(title);
  const tokens = new Set<string>();
  for (const word of normalized.match(/[a-z0-9][a-z0-9.+-]{1,}/g) ?? []) tokens.add(word);
  const compact = [...normalized].filter((char) => !TITLE_STOP.has(char) && char !== " ").join("");
  for (let index = 0; index < compact.length - 1; index += 1) {
    const gram = compact.slice(index, index + 2);
    if (/[\u2E80-\u9FFF]/.test(gram)) tokens.add(gram);
  }
  return tokens;
}
