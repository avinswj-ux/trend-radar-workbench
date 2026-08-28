import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export type XEnrichment = {
  imageUrls: string[];
  videoUrls: string[];
  articleTitle: string;
  articleText: string;
};

const emptyEnrichment: XEnrichment = { imageUrls: [], videoUrls: [], articleTitle: "", articleText: "" };

export type FxTweetCard = XEnrichment & {
  statusId: string;
  username: string;
  text: string;
  createdAt: Date | null;
  isReply: boolean;
  isRetweet: boolean;
};

export async function enrichXStatus(statusId: string): Promise<XEnrichment> {
  const card = await fetchFxTweetCard(statusId);
  if (!card) return emptyEnrichment;
  return {
    imageUrls: card.imageUrls,
    videoUrls: card.videoUrls,
    articleTitle: card.articleTitle,
    articleText: card.articleText,
  };
}

export async function fetchFxTweetCard(statusId: string): Promise<FxTweetCard | null> {
  if (!statusId) return null;
  const payload = await readFxTweet(statusId);
  if (!payload) return null;
  const tweet = (payload.tweet ?? payload) as Record<string, unknown>;
  if (!tweet || typeof tweet !== "object") return null;
  const author = (tweet.author as { screen_name?: string } | undefined)?.screen_name ?? "";
  const createdRaw = tweet.created_timestamp ?? tweet.created_at ?? tweet.date;
  const createdAt =
    typeof createdRaw === "number"
      ? new Date(createdRaw > 10_000_000_000 ? createdRaw : createdRaw * 1000)
      : typeof createdRaw === "string"
        ? new Date(createdRaw)
        : null;
  const urls: string[] = [];
  const videos: string[] = [];
  collectMedia(tweet.media, urls, videos);
  collectMedia((tweet.quote as Record<string, unknown> | undefined)?.media, urls, videos);
  const article = tweet.article as Record<string, unknown> | undefined;
  if (article) {
    collectEntity(article.cover_media, urls);
    const entities = article.media_entities;
    if (Array.isArray(entities)) for (const entity of entities) collectEntity(entity, urls);
  }
  const unique = [...new Set(urls.map(normalizeMediaUrl).filter(Boolean))];
  return {
    statusId,
    username: author.replace(/^@/, ""),
    text: String(
      tweet.text ??
        (typeof tweet.raw_text === "object" && tweet.raw_text
          ? (tweet.raw_text as { text?: string }).text
          : tweet.raw_text) ??
        "",
    ).trim(),
    createdAt: createdAt && !Number.isNaN(createdAt.getTime()) ? createdAt : null,
    isReply: Boolean(tweet.replying_to || tweet.in_reply_to_status || tweet.replying_to_status),
    isRetweet: Boolean(tweet.retweeted_tweet || tweet.retweet),
    imageUrls: unique.slice(0, 16),
    videoUrls: rankVideoUrls(videos).slice(0, 3),
    articleTitle: String(article?.title ?? "").trim(),
    articleText: extractArticleText(article) || String(tweet.text ?? "").trim(),
  };
}

export async function enrichXMedia(statusId: string) {
  return (await enrichXStatus(statusId)).imageUrls;
}

function extractArticleText(article: Record<string, unknown> | undefined) {
  if (!article) return "";
  const content = article.content as { blocks?: Array<{ text?: string; type?: string }> } | undefined;
  const paragraphs = (content?.blocks ?? [])
    .map((block) => String(block.text ?? "").trim())
    .filter((text) => text.length > 1);
  const joined = paragraphs.join("\n");
  if (joined.replace(/\s+/g, "").length >= 80) return joined.slice(0, 6000);
  return String(article.preview_text ?? "").trim();
}

function collectMedia(media: unknown, urls: string[], videos: string[] = []) {
  if (!media || typeof media !== "object") return;
  const record = media as {
    photos?: Array<{ url?: string }>;
    videos?: Array<{ url?: string; formats?: Array<{ url?: string }> }>;
    all?: Array<{ url?: string; type?: string; thumbnail_url?: string; formats?: Array<{ url?: string }> }>;
  };
  for (const photo of record.photos ?? []) if (photo.url) urls.push(photo.url);
  for (const video of record.videos ?? []) pushVideo(video, videos);
  for (const item of record.all ?? []) {
    if (item.type === "video") {
      pushVideo(item, videos);
      continue;
    }
    if (item.type && item.type !== "photo") continue;
    if (item.url) urls.push(item.url);
  }
}

function pushVideo(item: { url?: string; formats?: Array<{ url?: string }> }, videos: string[]) {
  if (item.url) videos.push(item.url);
  for (const format of item.formats ?? []) if (format.url) videos.push(format.url);
}

function isDirectVideo(url: string) {
  return /\.mp4(\?|$)/i.test(url) && /video\.twimg\.com|twimg\.com\/amplify_video/i.test(url);
}

function rankVideoUrls(urls: string[]) {
  const unique = [...new Set(urls.filter(isDirectVideo))];
  const score = (url: string) => {
    if (/720x960|640x/.test(url)) return 0;
    if (/1080x/.test(url)) return 2;
    return 1;
  };
  return unique.sort((left, right) => score(left) - score(right));
}

function collectEntity(entity: unknown, urls: string[]) {
  if (!entity || typeof entity !== "object") return;
  const info = (entity as { media_info?: { original_img_url?: string } }).media_info;
  if (info?.original_img_url) urls.push(info.original_img_url);
}

function normalizeMediaUrl(url: string) {
  const clean = url.replace(/&amp;/g, "&").split("?")[0];
  const match = clean.match(/\/media\/([A-Za-z0-9_-]+\.(?:jpg|jpeg|png|webp))$/i);
  if (match) return `https://nitter.net/pic/orig/media%2F${match[1]}`;
  if (/\/pic\/|pbs\.twimg\.com/i.test(clean)) return clean;
  return "";
}

async function readFxTweet(statusId: string) {
  const url = `https://api.fxtwitter.com/status/${statusId}`;
  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 TrendRadar" },
    });
    if (response.ok) return await response.json() as Record<string, unknown>;
  } catch {
    // Node fetch may fail behind a local proxy.
  }
  try {
    const { stdout } = await run(
      "curl",
      ["-4", "-fsSL", "--max-time", "20", "-A", "Mozilla/5.0 TrendRadar", url],
      { timeout: 25_000, maxBuffer: 4 * 1024 * 1024 },
    );
    return JSON.parse(stdout) as Record<string, unknown>;
  } catch {
    return null;
  }
}
