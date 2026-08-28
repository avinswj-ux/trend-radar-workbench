import { githubSourceConfigSchema } from "@/lib/contracts";
import type { NormalizedDiscovery, SourceAdapter } from "./types";

type GitHubRepository = {
  id: number;
  full_name: string;
  html_url: string;
  description: string | null;
  owner: { login: string };
  created_at: string;
  updated_at: string;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
  topics?: string[];
};

export const githubAdapter: SourceAdapter = {
  type: "GITHUB",
  async discover(config: unknown): Promise<NormalizedDiscovery[]> {
    const { query, perPage } = githubSourceConfigSchema.parse(config);
    const params = new URLSearchParams({ q: query, sort: "updated", order: "desc", per_page: String(perPage) });
    const response = await fetch(`https://api.github.com/search/repositories?${params}`, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
      },
      cache: "no-store",
    });

    if (!response.ok) throw new Error(`GitHub Search API failed: ${response.status} ${response.statusText}`);
    const body = await response.json() as { items: GitHubRepository[] };

    return body.items.map((repository) => ({
      externalId: String(repository.id),
      canonicalUrl: repository.html_url,
      title: repository.full_name,
      body: repository.description,
      author: repository.owner.login,
      publishedAt: new Date(repository.updated_at || repository.created_at),
      language: repository.language,
      rawPayload: repository as unknown as Record<string, unknown>,
    }));
  },
};
