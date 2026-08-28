import type { ContentCategory } from "@prisma/client";
import type { TopicTheme } from "@/lib/topic-theme";

export type AnalysisResult = {
  category: ContentCategory;
  topicTheme: TopicTheme;
  summary: string;
  tags: string[];
  entities: { type: string; name: string; url: string | null }[];
  chineseAngle: string;
  riskFlags: string[];
  model: string;
};

export type ScoreResult = {
  total: number;
  novelty: number;
  utility: number;
  momentum: number;
  shareability: number;
  confidence: number;
  videoSuitability: number;
  reasoning: string;
};
