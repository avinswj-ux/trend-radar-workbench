import type { SourceType } from "@prisma/client";

export type NormalizedDiscovery = {
  externalId: string;
  canonicalUrl: string;
  title: string;
  body: string | null;
  author: string | null;
  publishedAt: Date | null;
  language: string | null;
  /** Provider-reported license when the discovery is a reusable media item. */
  mediaLicense?: string | null;
  rawPayload: Record<string, unknown>;
};

export type SourceAdapter = {
  type: SourceType;
  discover(config: unknown): Promise<NormalizedDiscovery[]>;
};
