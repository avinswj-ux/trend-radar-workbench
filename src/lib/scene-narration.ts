export function compactLen(value: string) {
  return value.replace(/\s+/g, "").length;
}

export function splitTextToScenes(text: string, sceneCount: number) {
  const count = Math.max(1, sceneCount);
  const sentences = String(text ?? "")
    .split(/(?<=[。！？；\n])/)
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  if (!sentences.length) return Array.from({ length: count }, () => "");
  if (sentences.length <= count) {
    const padded = sentences.slice();
    while (padded.length < count) padded.push(padded.at(-1) ?? "");
    return padded.slice(0, count);
  }
  const buckets = Array.from({ length: count }, () => [] as string[]);
  sentences.forEach((sentence, index) => {
    const slot = Math.min(count - 1, Math.floor((index * count) / sentences.length));
    buckets[slot].push(sentence);
  });
  return buckets.map((bucket) => bucket.join(""));
}

export function narrationCollapsed(scenes: string[], script: string) {
  if (scenes.length < 2) return false;
  const first = compactLen(scenes[0] ?? "");
  const all = scenes.reduce((sum, item) => sum + compactLen(item), 0);
  const scriptLen = compactLen(script);
  if (first >= 220 && scriptLen > 0 && first >= scriptLen * 0.7) return true;
  if (first > 0 && all > 0 && first >= all * 0.45) return true;
  const later = scenes.slice(1).join("");
  return first > 80 && later.length > 40 && scenes[0].includes(later.slice(0, 24));
}

export function repairStoryboardNarrations<T extends { narration?: unknown }>(
  storyboard: T[],
  script: string,
): T[] {
  const current = storyboard.map((scene) => String(scene.narration ?? "").trim());
  if (!storyboard.length) return storyboard;
  if (!narrationCollapsed(current, script)) return storyboard;
  const split = splitTextToScenes(script || current[0], storyboard.length);
  return storyboard.map((scene, index) => ({ ...scene, narration: split[index] || String(scene.narration ?? "") }));
}
