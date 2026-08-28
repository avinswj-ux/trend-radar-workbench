import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { xSourceConfigSchema } from "@/lib/contracts";
import type { NormalizedDiscovery, SourceAdapter } from "./types";
import { enrichXStatus, fetchFxTweetCard } from "./x-media";

const run = promisify(execFile);

const nitterHosts = [
  "https://nitter.space",
  "https://nitter.net",
];

export const xAdapter: SourceAdapter = {
  type: "X_BOOKMARK",
  async discover(config: unknown): Promise<NormalizedDiscovery[]> {
    const { username, limit, minChars } = xSourceConfigSchema.parse(config);
    let entries = await discoverFromXProfile(username, limit, minChars);
    if (entries.length < Math.min(3, limit)) {
      try {
        const fromRss = await discoverFromNitter(username, limit, minChars);
        const seen = new Set(entries.map((entry) => entry.externalId));
        for (const entry of fromRss) {
          if (!seen.has(entry.externalId)) entries.push(entry);
        }
      } catch {
        // Nitter public instances shut down in Aug 2026; X profile is the primary path.
      }
    }
    const picked = entries.slice(0, limit);
    if (!picked.length) {
      throw new Error(`@${username} 没有可入库的新闻帖（X 主页未解析到帖子）`);
    }
    await Promise.all(picked.map((entry) => attachArticleImages(entry)));
    return picked;
  },
};

async function discoverFromNitter(username: string, limit: number, minChars: number) {
  const xml = await fetchFirstFeed(username);
  return parseItems(xml)
    .map((entry) => normalizeEntry(entry, username))
    .filter((entry) => isOriginalNewsPost(entry.title, entry.body))
    .filter((entry) => entry.title.replace(/\s+/g, "").length >= minChars)
    .slice(0, limit);
}

async function discoverFromXProfile(username: string, limit: number, minChars: number) {
  const ids = await fetchXProfileStatusIds(username, Math.max(limit * 3, 10));
  const entries: NormalizedDiscovery[] = [];
  for (const statusId of ids) {
    const entry = await discoveryFromFxTweet(username, statusId);
    if (!entry) continue;
    if (!isOriginalNewsPost(entry.title, entry.body)) continue;
    const dense = `${entry.title}\n${entry.body ?? ""}`.replace(/\s+/g, "");
    if (dense.length < minChars) continue;
    entries.push(entry);
    if (entries.length >= limit) break;
  }
  return entries;
}

async function fetchXProfileStatusIds(username: string, limit: number) {
  const html = await readPage(`https://x.com/${username}`);
  const escaped = username.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`/${escaped}/status/(\\d+)`, "gi");
  const ids = [...html.matchAll(pattern)].map((match) => match[1]);
  return [...new Set(ids)].slice(0, limit);
}

async function discoveryFromFxTweet(username: string, statusId: string): Promise<NormalizedDiscovery | null> {
  const card = await fetchFxTweetCard(statusId);
  if (!card) return null;
  if (card.username && card.username.toLowerCase() !== username.toLowerCase()) return null;
  if (card.isReply || card.isRetweet) return null;
  const titleSource =
    card.articleTitle ||
    card.text.replace(/https?:\/\/\S+/g, " ").replace(/\s+/g, " ").trim() ||
    card.text;
  const title = titleSource.split(/[。！？\n]/)[0].slice(0, 80) || titleSource.slice(0, 80);
  const body = card.articleText.replace(/\s+/g, "").length >= 40 ? card.articleText : card.text;
  return {
    externalId: statusId,
    canonicalUrl: `https://x.com/${username}/status/${statusId}`,
    title,
    body,
    author: username,
    publishedAt: card.createdAt,
    language: "zh",
    rawPayload: {
      kind: "x-news-remix",
      username,
      statusId,
      title,
      body,
      imageUrls: card.imageUrls,
      videoUrls: card.videoUrls,
      articleTitle: card.articleTitle,
      articleUrl: card.text.match(/article\/(\d+)/)
        ? `https://x.com/i/article/${card.text.match(/article\/(\d+)/)?.[1]}`
        : null,
    },
  };
}

async function fetchFirstFeed(username: string) {
  let lastError = "没有可用的 X 订阅源";
  for (const host of nitterHosts) {
    const url = `${host}/${username}/rss`;
    try {
      const xml = await readFeed(url);
      if (!/<item[\s>]/i.test(xml)) {
        lastError = `${host} 没有条目`;
        continue;
      }
      return xml;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  throw new Error(`读取 @${username} 失败：${lastError}`);
}

async function readPage(url: string) {
  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36",
      },
    });
    if (response.ok) return await response.text();
  } catch {
    // Node fetch may fail behind a local proxy; curl is more reliable.
  }
  const { stdout } = await run(
    "curl",
    [
      "-4",
      "-fsSL",
      "--max-time",
      "25",
      "-A",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36",
      url,
    ],
    { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 },
  );
  return stdout;
}

async function readFeed(url: string) {
  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: {
        Accept: "application/rss+xml, application/xml, text/xml",
        "User-Agent": "Mozilla/5.0 TrendRadar",
      },
    });
    if (response.ok) return await response.text();
  } catch {
    // Node fetch may fail behind a local proxy; curl is more reliable.
  }
  const { stdout } = await run(
    "curl",
    ["-fsSL", "--max-time", "8", "-A", "Mozilla/5.0 TrendRadar", url],
    { timeout: 25_000, maxBuffer: 2 * 1024 * 1024 },
  );
  return stdout;
}

function parseItems(xml: string) {
  return [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map((match) => {
    const block = match[1];
    const html = rawField(block, "description");
    return {
      title: field(block, "title"),
      link: field(block, "link"),
      description: clean(html),
      html,
      pubDate: field(block, "pubDate"),
      guid: field(block, "guid"),
    };
  });
}

function normalizeEntry(
  entry: {
    title: string;
    link: string;
    description: string;
    html: string;
    pubDate: string;
    guid: string;
  },
  username: string,
) {
  const statusId =
    entry.link.match(/status\/(\d+)/)?.[1] ||
    entry.guid.match(/status\/(\d+)/)?.[1];
  const canonicalUrl = statusId
    ? `https://x.com/${username}/status/${statusId}`
    : entry.link.replace(/nitter\.[^/]+/i, "x.com").replace(/#m$/, "");
  const title = entry.title.split(/[。！？\n]/)[0].slice(0, 80) || entry.title.slice(0, 80);
  const quote = extractQuote(entry.html);
  const articleUrl = extractArticleUrl(entry.html);
  const imageUrls = extractImages(entry.html);
  const body = [
    entry.description,
    quote ? `引用 @${quote.author}：${quote.text}` : "",
    articleUrl ? `原文长文：${articleUrl}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  return {
    externalId: statusId || entry.guid || canonicalUrl,
    canonicalUrl,
    title,
    body,
    author: username,
    publishedAt: dateOrNull(entry.pubDate),
    language: "zh",
    rawPayload: {
      kind: "x-news-remix",
      username,
      statusId,
      title: entry.title,
      body,
      html: entry.html,
      imageUrls,
      articleUrl,
      quote,
    },
  };
}

function rawField(block: string, name: string) {
  const match = block.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, "i"));
  return decodeEntities((match?.[1] ?? "").replace(/<!\[CDATA\[([\s\S]*?)]]>/g, "$1"));
}

function field(block: string, name: string) {
  return clean(rawField(block, name));
}

function extractImages(html: string) {
  const found = [...html.matchAll(/src=["']([^"']+)["']/gi)].map((match) => decodeEntities(match[1]));
  const unique = new Set<string>();
  for (const raw of found) {
    const url = absolutize(raw);
    if (!url) continue;
    if (/profile_images|avatar|\.svg(\?|$)/i.test(url)) continue;
    if (!/\/pic\/|pbs\.twimg\.com|twimg/i.test(url)) continue;
    unique.add(preferOriginal(url));
  }
  return [...unique].slice(0, 8);
}

function extractQuote(html: string) {
  const block = html.match(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/i)?.[1];
  if (!block) return null;
  const author =
    block.match(/@([A-Za-z0-9_]+)/)?.[1] ||
    clean(block.match(/<b>([\s\S]*?)<\/b>/i)?.[1] ?? "") ||
    null;
  const text = clean(block).replace(/^@?[A-Za-z0-9_\s()（）-]+/, "").trim();
  if (!text) return null;
  return { author, text: text.slice(0, 600) };
}

function extractArticleUrl(html: string) {
  const match = html.match(/\/i\/article\/(\d+)/i);
  return match ? `https://x.com/i/article/${match[1]}` : null;
}

function absolutize(url: string) {
  if (!url) return "";
  if (url.startsWith("//")) return `https:${url}`;
  if (url.startsWith("/")) return `https://nitter.net${url}`;
  return url;
}

function preferOriginal(url: string) {
  return url.replace(/\/pic\/(?!orig\/)/i, "/pic/orig/");
}

function decodeEntities(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function clean(value: string) {
  return decodeEntities(value)
    .replace(/<!\[CDATA\[([\s\S]*?)]]>/g, "$1")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
async function attachArticleImages(entry: NormalizedDiscovery) {
  const payload = entry.rawPayload as {
    statusId?: string;
    imageUrls?: string[];
    videoUrls?: string[];
    articleTitle?: string;
    body?: string;
  };
  const extra = await enrichXStatus(payload.statusId ?? "");
  payload.imageUrls = [...new Set([...(payload.imageUrls ?? []), ...extra.imageUrls])].slice(0, 16);
  payload.videoUrls = extra.videoUrls;
  if (extra.articleTitle) payload.articleTitle = extra.articleTitle;
  if (extra.articleText.replace(/\s+/g, "").length > (entry.body ?? "").replace(/\s+/g, "").length) {
    entry.body = extra.articleText;
    payload.body = extra.articleText;
  }
}

function isOriginalNewsPost(title: string, body: string | null) {
  const text = `${title}\n${body ?? ""}`.trim();
  if (/^R to @/i.test(title) || /^RT by /i.test(title)) return false;
  if (/^R to @/i.test(text)) return false;
  return true;
}

function dateOrNull(value: string) {
  const date = new Date(value);
  return value && !Number.isNaN(date.getTime()) ? date : null;
}
