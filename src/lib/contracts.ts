import { z } from "zod";

export const candidateStatusSchema = z.enum(["PENDING", "SELECTED", "DISMISSED"]);

export const updateCandidateSchema = z.object({
  status: candidateStatusSchema.optional(),
  editorNote: z.string().trim().max(1000).optional(),
});

export const sourceSchema = z.object({
  name: z.string().trim().min(1).max(120),
  type: z.enum(["RSS", "GITHUB", "HUGGING_FACE", "PRODUCT_HUNT", "WEB", "X_BOOKMARK", "YOUTUBE"]),
  config: z.record(z.string(), z.unknown()),
  schedule: z.string().trim().max(120).optional(),
});

export const githubSourceConfigSchema = z.object({
  query: z.string().trim().min(1).max(500),
  perPage: z.number().int().min(1).max(100).default(30),
});

export const huggingFaceSourceConfigSchema = z.object({
  feed: z.enum(["daily_papers", "spaces"]),
  limit: z.number().int().min(1).max(50).default(20),
});

export const rssSourceConfigSchema = z.object({
  url: z.string().url().refine((url) => new URL(url).protocol === "https:", "RSS 地址必须使用 HTTPS"),
  limit: z.number().int().min(1).max(50).default(20),
});

export const xSourceConfigSchema = z.object({
  username: z.string().trim().min(1).max(80).transform((value) => value.replace(/^@/, "")),
  limit: z.number().int().min(1).max(30).default(8),
  minChars: z.number().int().min(12).max(80).default(24),
});

export const youtubeSourceConfigSchema = z.object({
  query: z.string().trim().min(1).max(500),
  limit: z.number().int().min(1).max(50).default(25),
  order: z.enum(["date", "relevance", "viewCount"]).default("date"),
  windowDays: z.number().int().min(1).max(30).default(7),
  relevanceLanguage: z.string().trim().length(2).default("en"),
  regionCode: z.string().trim().length(2).default("US"),
  videoLicense: z.enum(["creativeCommon"]).optional(),
});
