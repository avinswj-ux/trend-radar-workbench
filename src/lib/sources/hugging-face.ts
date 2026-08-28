import { huggingFaceSourceConfigSchema } from "@/lib/contracts";
import type { NormalizedDiscovery, SourceAdapter } from "./types";

type Paper = {
  id: string;
  title: string;
  summary?: string;
  publishedAt?: string;
  submittedOnDailyAt?: string;
  authors?: { name: string }[];
  ai_keywords?: string[];
};
type DailyPaper = { paper: Paper };
type Space = { id: string; likes?: number; trendingScore?: number; sdk?: string; tags?: string[]; createdAt?: string; lastModified?: string };

export const huggingFaceAdapter: SourceAdapter = {
  type: "HUGGING_FACE",
  async discover(config: unknown): Promise<NormalizedDiscovery[]> {
    const { feed, limit } = huggingFaceSourceConfigSchema.parse(config);
    if (feed === "daily_papers") {
      const response = await fetch(`https://huggingface.co/api/daily_papers?limit=${limit}&sort=trending`, { cache: "no-store" });
      if (!response.ok) throw new Error(`Hugging Face Daily Papers API failed: ${response.status} ${response.statusText}`);
      const rows = await response.json() as DailyPaper[];
      return rows.map(({ paper }) => ({
        externalId: `paper:${paper.id}`,
        canonicalUrl: `https://huggingface.co/papers/${paper.id}`,
        title: paper.title,
        body: paper.summary ?? null,
        author: paper.authors?.map((author) => author.name).join(", ") ?? null,
        publishedAt: dateOrNull(paper.submittedOnDailyAt ?? paper.publishedAt),
        language: "en",
        rawPayload: paper as unknown as Record<string, unknown>,
      }));
    }

    const params = new URLSearchParams({ sort: "trendingScore", limit: String(limit) });
    const response = await fetch(`https://huggingface.co/api/spaces?${params}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`Hugging Face Spaces API failed: ${response.status} ${response.statusText}`);
    const spaces = await response.json() as Space[];
    return spaces.filter((space) => Boolean(space.id)).map((space) => ({
      externalId: `space:${space.id}`,
      canonicalUrl: `https://huggingface.co/spaces/${space.id}`,
      title: space.id,
      body: ["Hugging Face Space", space.sdk, space.likes !== undefined ? `${space.likes} likes` : null, space.trendingScore !== undefined ? `trending score ${space.trendingScore}` : null, space.tags?.join(", ")].filter(Boolean).join(" · "),
      author: space.id.split("/")[0] ?? null,
      publishedAt: dateOrNull(space.lastModified ?? space.createdAt),
      language: "en",
      rawPayload: space as unknown as Record<string, unknown>,
    }));
  },
};

function dateOrNull(value: string | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
