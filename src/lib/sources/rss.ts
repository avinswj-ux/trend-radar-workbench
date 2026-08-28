import { rssSourceConfigSchema } from "@/lib/contracts";
import type { NormalizedDiscovery, SourceAdapter } from "./types";

type FeedEntry = { title: string; url: string; id: string; body: string; author: string; publishedAt: string; language: string; xml: string };

export const rssAdapter: SourceAdapter = {
  type: "RSS",
  async discover(config: unknown): Promise<NormalizedDiscovery[]> {
    const { url, limit } = rssSourceConfigSchema.parse(config);
    const response = await fetch(url, { cache: "no-store", redirect: "error", headers: { Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" } });
    if (!response.ok) throw new Error(`RSS feed failed: ${response.status} ${response.statusText}`);
    const entries = parseFeed(await response.text()).slice(0, limit);
    if (!entries.length) throw new Error("RSS feed does not contain readable items");
    return entries.map((entry, index) => {
      const canonicalUrl = entry.url;
      const title = entry.title || canonicalUrl || `RSS item ${index + 1}`;
      return {
        externalId: entry.id || canonicalUrl || `${url}#${index}`,
        canonicalUrl: canonicalUrl || `${url}#item-${index}`,
        title,
        body: entry.body || null,
        author: entry.author || null,
        publishedAt: dateOrNull(entry.publishedAt),
        language: entry.language || null,
        rawPayload: { xml: entry.xml, title, canonicalUrl },
      };
    });
  },
};

function parseFeed(xml: string): FeedEntry[] {
  const blocks = [...xml.matchAll(/<(?:item|entry)\b[^>]*>([\s\S]*?)<\/(?:item|entry)>/gi)].map((match) => match[1]);
  return blocks.map((block) => ({
    title: field(block, "title"),
    url: atomLink(block) || field(block, "link"),
    id: field(block, "guid") || field(block, "id"),
    body: field(block, "description") || field(block, "summary") || field(block, "content"),
    author: field(block, "author") || field(block, "dc:creator"),
    publishedAt: field(block, "pubDate") || field(block, "published") || field(block, "updated"),
    language: field(block, "language"),
    xml: block,
  }));
}
function field(block: string, name: string) {
  const escaped = name.replace(":", "\\:");
  const match = block.match(new RegExp(`<${escaped}\\b[^>]*>([\\s\\S]*?)<\\/${escaped}>`, "i"));
  return clean(match?.[1] ?? "");
}
function atomLink(block: string) {
  const links = [...block.matchAll(/<link\b([^>]*)\/?>(?:<\/link>)?/gi)];
  for (const link of links) {
    const href = link[1].match(/\bhref=["']([^"']+)["']/i)?.[1];
    const rel = link[1].match(/\brel=["']([^"']+)["']/i)?.[1];
    if (href && (!rel || rel === "alternate")) return href;
  }
  return "";
}
function clean(value: string) { return value.replace(/<!\[CDATA\[([\s\S]*?)]]>/g, "$1").replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim(); }
function dateOrNull(value: string) { const date = new Date(value); return value && !Number.isNaN(date.getTime()) ? date : null; }
