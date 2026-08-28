import type { SourceAdapter } from "./types";
import { githubAdapter } from "./github";
import { huggingFaceAdapter } from "./hugging-face";
import { rssAdapter } from "./rss";
import { youtubeAdapter } from "./youtube";
import { xAdapter } from "./x";

const adapters: SourceAdapter[] = [
  githubAdapter,
  huggingFaceAdapter,
  rssAdapter,
  youtubeAdapter,
  xAdapter,
];

export function getSourceAdapter(type: string) {
  const adapter = adapters.find((candidate) => candidate.type === type);
  if (!adapter) throw new Error(`No source adapter is configured for ${type}`);
  return adapter;
}
