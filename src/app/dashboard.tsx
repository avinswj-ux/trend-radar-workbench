"use client";

import { FormEvent, useMemo, useState } from "react";
import {
  everydayTopicThemes,
  topicThemeLabels,
  topicThemes,
  type TopicTheme,
} from "@/lib/topic-theme";
import { shortTopicHook } from "@/lib/scoring";
import { X_NEWS_ACCOUNTS } from "@/config/x-news-accounts";

type Candidate = {
  id: string;
  rank: number;
  status: "PENDING" | "SELECTED" | "DISMISSED";
  editorNote: string | null;
  contentItem: {
    id: string;
    title: string;
    canonicalUrl: string;
    category: string | null;
    topicTheme: string | null;
    publishedAt: Date | null;
    mediaLicense: string | null;
    source: { name: string; type: string };
    mediaAssets: Array<{
      id: string;
      rights: string;
      status:
        | "QUEUED"
        | "DOWNLOADING"
        | "READY_FOR_ANALYSIS"
        | "ANALYZING"
        | "ANALYZED"
        | "FAILED";
      error: string | null;
      shotList?: unknown;
    }>;
    analysis: {
      summary: string;
      tags: unknown;
      chineseAngle: string | null;
      model: string;
    } | null;
    score: {
      total: number;
      videoSuitability: number;
      reasoning: string;
    } | null;
  };
};

type Source = {
  id: string;
  name: string;
  type: string;
  enabled: boolean;
  schedule: string | null;
  config: unknown;
  _count: { runs: number; items: number };
};
type Run = {
  id: string;
  status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED";
  startedAt: Date | null;
  finishedAt: Date | null;
  error: string | null;
  stats: unknown;
  source: { name: string; type: string };
};
type SourceKind = "GITHUB" | "HUGGING_FACE" | "RSS" | "YOUTUBE" | "X_BOOKMARK";
type SourceInput = {
  name: string;
  type: SourceKind;
  config: Record<string, unknown>;
  schedule: string;
};

const sourcePresets: Array<SourceInput & { description: string }> = [
  ...X_NEWS_ACCOUNTS.map((account) => ({
    name: account.name,
    type: "X_BOOKMARK" as const,
    config: { username: account.username, limit: account.limit, minChars: account.minChars },
    schedule: account.schedule,
    description: account.description,
  })),
  {
    name: "Hugging Face Trending Spaces",
    type: "HUGGING_FACE",
    config: { feed: "spaces", limit: 20 },
    schedule: "0 8 * * *",
    description: "热门 AI 应用、演示与开源工具",
  },
  {
    name: "arXiv cs.AI",
    type: "RSS",
    config: { url: "https://export.arxiv.org/rss/cs.AI", limit: 20 },
    schedule: "0 8 * * *",
    description: "人工智能最新论文",
  },
  {
    name: "Hacker News",
    type: "RSS",
    config: { url: "https://news.ycombinator.com/rss", limit: 20 },
    schedule: "0 8 * * *",
    description: "开发者社区的技术信号",
  },
  {
    name: "Hugging Face Blog",
    type: "RSS",
    config: { url: "https://huggingface.co/blog/feed.xml", limit: 20 },
    schedule: "0 8 * * *",
    description: "模型、工具与研究动态",
  },
  {
    name: "GitHub 创作型 AI 项目",
    type: "GITHUB",
    config: {
      query:
        "(app OR tool OR editor OR clone OR remover OR recipe OR fitness OR avatar) stars:>200 pushed:>2025-01-01",
      perPage: 20,
    },
    schedule: "0 9 * * *",
    description: "视频、声音、数字人、工作流等更适合内容演示的开源项目",
  },
  {
    name: "YouTube AI 工具周热门",
    type: "YOUTUBE",
    config: {
      query: "AI recipe app OR AI voice typing OR AI music generator demo",
      limit: 25,
      order: "viewCount",
      windowDays: 7,
      relevanceLanguage: "en",
      regionCode: "US",
    },
    schedule: "0 10 * * *",
    description: "近 7 天播放增长较快、具有明确产品演示的 AI 工具视频",
  },
  {
    name: "YouTube CC BY AI 素材",
    type: "YOUTUBE",
    config: {
      query: "I tried this AI app demo no code",
      limit: 25,
      order: "viewCount",
      windowDays: 7,
      relevanceLanguage: "en",
      regionCode: "US",
      videoLicense: "creativeCommon",
    },
    schedule: "0 10 * * *",
    description: "近 7 天 CC BY AI 视频，下载前仍须核对署名要求",
  },
  {
    name: "YouTube 普通人 AI 实测",
    type: "YOUTUBE",
    config: {
      query: "AI cooking OR shopping OR photo editor demo 2026",
      limit: 25,
      order: "viewCount",
      windowDays: 7,
      relevanceLanguage: "en",
      regionCode: "US",
    },
    schedule: "0 9 * * *",
    description: "近 7 天生活、办公、学习和小生意里的 AI 使用体验",
  },
  {
    name: "YouTube 好玩 AI 项目",
    type: "YOUTUBE",
    config: {
      query: "this AI app is insane demo voice clone OR music OR recipe",
      limit: 25,
      order: "viewCount",
      windowDays: 7,
      relevanceLanguage: "en",
      regionCode: "US",
    },
    schedule: "30 9 * * *",
    description: "近 7 天有视觉效果、容易理解和分享的 AI 应用或 Agent",
  },
  {
    name: "GitHub 好玩 AI 应用",
    type: "GITHUB",
    config: {
      query:
        "(webui OR playground OR demo OR assistant) (image OR voice OR video OR chat) stars:>400",
      perPage: 20,
    },
    schedule: "0 9 * * *",
    description: "普通人能看懂、能试玩、容易展示效果的 AI 应用",
  },
];

const statusLabel = {
  PENDING: "待审核",
  SELECTED: "已选题",
  DISMISSED: "已忽略",
};
const rightsLabel = {
  OWNED: "自有素材",
  PERMISSION_GRANTED: "已获书面授权",
  CC_BY: "CC BY（需署名）",
  RESEARCH_ONLY: "仅作研究",
};
const youtubeLicenseLabel: Record<string, string> = {
  creativeCommon: "Creative Commons（可按 CC BY 处理并署名）",
  youtube: "标准 YouTube 许可（不可直接当作可复用素材）",
};

export function Dashboard({
  initialCandidates,
  initialSources,
  initialRuns,
  mode = "radar",
}: {
  initialCandidates: Candidate[];
  initialSources: Source[];
  initialRuns: Run[];
  mode?: "radar" | "sources" | "runs";
}) {
  const [candidates, setCandidates] = useState(initialCandidates);
  const [sources, setSources] = useState(initialSources);
  const [activeId, setActiveId] = useState(initialCandidates[0]?.id ?? null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showSourceForm, setShowSourceForm] = useState(false);
  const [sourceKind, setSourceKind] = useState<SourceKind>("GITHUB");
  const [error, setError] = useState<string | null>(null);
  const [themeFilter, setThemeFilter] = useState<
    | "EVERYDAY"
    | "X_NEWS"
    | "YOUTUBE_SOURCE"
    | "VIDEO_READY"
    | "ALL"
    | TopicTheme
  >("EVERYDAY");
  const [statusFilter, setStatusFilter] = useState<Candidate["status"] | "ALL">(
    "PENDING",
  );
  const [rights, setRights] = useState<keyof typeof rightsLabel>("OWNED");
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const visibleCandidates = useMemo(
    () =>
      candidates.filter((candidate) => {
        const themeMatches =
          themeFilter === "ALL" ||
          (themeFilter === "EVERYDAY"
            ? everydayTopicThemes.includes(
                candidate.contentItem.topicTheme as TopicTheme,
              ) || candidate.contentItem.source.type === "X_BOOKMARK"
            : themeFilter === "X_NEWS"
              ? candidate.contentItem.source.type === "X_BOOKMARK"
            : themeFilter === "YOUTUBE_SOURCE"
              ? candidate.contentItem.source.type === "YOUTUBE"
              : themeFilter === "VIDEO_READY"
                ? candidate.contentItem.source.type === "YOUTUBE" &&
                  candidate.contentItem.mediaAssets.some(
                    (asset) => asset.status === "ANALYZED",
                  ) &&
                  (candidate.contentItem.score?.videoSuitability ?? 0) >= 55
                : candidate.contentItem.topicTheme === themeFilter);
        return (
          themeMatches &&
          (statusFilter === "ALL" || candidate.status === statusFilter)
        );
      }),
    [candidates, themeFilter, statusFilter],
  );
  const active = useMemo(
    () =>
      visibleCandidates.find((candidate) => candidate.id === activeId) ??
      visibleCandidates[0],
    [activeId, visibleCandidates],
  );

  async function updateCandidate(id: string, status: Candidate["status"]) {
    setBusy(id);
    setError(null);
    try {
      const response = await fetch(`/api/radar/candidates/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) throw new Error("更新选题状态失败");
      const updated = (await response.json()) as {
        id: string;
        status: Candidate["status"];
      };
      setCandidates((all) =>
        all.map((candidate) =>
          candidate.id === updated.id
            ? { ...candidate, status: updated.status }
            : candidate,
        ),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "操作失败");
    } finally {
      setBusy(null);
    }
  }

  async function runSource(sourceId: string) {
    setBusy(sourceId);
    setError(null);
    try {
      const response = await fetch(`/api/radar/sources/${sourceId}/run`, {
        method: "POST",
      });
      if (!response.ok) throw new Error("未能创建采集任务");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "操作失败");
    } finally {
      setBusy(null);
    }
  }

  async function ingestVideo(candidate: Candidate) {
    setBusy(`ingest:${candidate.id}`);
    setError(null);
    try {
      const response = await fetch("/api/media/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contentItemId: candidate.contentItem.id,
          rights,
        }),
      });
      const payload = (await response.json()) as {
        id?: string;
        status?: Candidate["contentItem"]["mediaAssets"][number]["status"];
        error?: string;
      };
      if (!response.ok)
        throw new Error(payload.error ?? "素材拉取任务创建失败");
      setCandidates((all) =>
        all.map((item) =>
          item.id === candidate.id
            ? {
                ...item,
                contentItem: {
                  ...item.contentItem,
                  mediaAssets: [
                    {
                      id: payload.id ?? "",
                      rights,
                      status: payload.status ?? "QUEUED",
                      error: null,
                    },
                  ],
                },
              }
            : item,
        ),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "素材拉取任务创建失败");
    } finally {
      setBusy(null);
    }
  }

  async function analyzeVideo(candidate: Candidate) {
    const asset = candidate.contentItem.mediaAssets[0];
    if (!asset) return;
    setBusy(`analyze:${asset.id}`);
    setError(null);
    try {
      const response = await fetch(`/api/media/${asset.id}/analyze`, {
        method: "POST",
      });
      const payload = (await response.json()) as {
        status?: Candidate["contentItem"]["mediaAssets"][number]["status"];
        error?: string;
      };
      if (!response.ok)
        throw new Error(payload.error ?? "拉片分析任务创建失败");
      setCandidates((all) =>
        all.map((item) =>
          item.id === candidate.id
            ? {
                ...item,
                contentItem: {
                  ...item.contentItem,
                  mediaAssets: item.contentItem.mediaAssets.map((media) =>
                    media.id === asset.id
                      ? { ...media, status: payload.status ?? "ANALYZING" }
                      : media,
                  ),
                },
              }
            : item,
        ),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "拉片分析任务创建失败");
    } finally {
      setBusy(null);
    }
  }

  async function retryVideo(candidate: Candidate) {
    const asset = candidate.contentItem.mediaAssets[0];
    if (!asset) return;
    setBusy(`retry:${asset.id}`);
    setError(null);
    try {
      const response = await fetch(`/api/media/${asset.id}/retry`, {
        method: "POST",
      });
      const payload = (await response.json()) as {
        status?: Candidate["contentItem"]["mediaAssets"][number]["status"];
        error?: string;
      };
      if (!response.ok)
        throw new Error(payload.error ?? "素材重试任务创建失败");
      setCandidates((all) =>
        all.map((item) =>
          item.id === candidate.id
            ? {
                ...item,
                contentItem: {
                  ...item.contentItem,
                  mediaAssets: item.contentItem.mediaAssets.map((media) =>
                    media.id === asset.id
                      ? {
                          ...media,
                          status: payload.status ?? "QUEUED",
                          error: null,
                        }
                      : media,
                  ),
                },
              }
            : item,
        ),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "素材重试任务创建失败");
    } finally {
      setBusy(null);
    }
  }

  async function createSource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setBusy("create-source");
    const form = new FormData(event.currentTarget);
    const config =
      sourceKind === "GITHUB"
        ? {
            query: String(form.get("query") ?? "").trim(),
            perPage: Number(form.get("limit") ?? 10),
          }
        : sourceKind === "HUGGING_FACE"
          ? {
              feed: String(form.get("feed") ?? "daily_papers"),
              limit: Number(form.get("limit") ?? 20),
            }
          : sourceKind === "YOUTUBE"
            ? {
                query: String(form.get("query") ?? "").trim(),
                limit: Number(form.get("limit") ?? 25),
                order: String(form.get("order") ?? "viewCount"),
                windowDays: Number(form.get("windowDays") ?? 7),
                relevanceLanguage: String(
                  form.get("relevanceLanguage") ?? "en",
                ),
                regionCode: String(form.get("regionCode") ?? "US"),
                ...(form.get("ccByOnly") === "on"
                  ? { videoLicense: "creativeCommon" }
                  : {}),
              }
            : {
                url: String(form.get("url") ?? "").trim(),
                limit: Number(form.get("limit") ?? 20),
              };
    const input: SourceInput = {
      name: String(form.get("name") ?? "").trim(),
      type: sourceKind,
      config,
      schedule: String(form.get("schedule") ?? "0 8 * * *"),
    };
    try {
      await saveSource(input);
      setShowSourceForm(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "操作失败");
    } finally {
      setBusy(null);
    }
  }

  async function saveSource(input: SourceInput) {
    const response = await fetch("/api/radar/sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!response.ok) throw new Error("创建来源失败，请检查配置");
    const source = (await response.json()) as Source;
    setSources((all) => [{ ...source, _count: { runs: 0, items: 0 } }, ...all]);
  }

  async function addPreset(preset: SourceInput) {
    if (sources.some((source) => source.name === preset.name)) return;
    setBusy(`preset:${preset.name}`);
    setError(null);
    try {
      await saveSource(preset);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "添加预设来源失败");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      {error && <p className="notice">{error}</p>}
      {mode === "radar" && (
        <section id="today" className="candidates review-queue">
          <div className="section-heading">
            <div>
              <p className="eyebrow">TODAY + WEEKLY VIDEO</p>
              <h2>审核队列</h2>
            </div>
            <span className="candidate-count">
              {visibleCandidates.length} 条待处理
            </span>
          </div>
          <div className="review-tabs">
            <button
              className={statusFilter === "PENDING" ? "active" : ""}
              onClick={() => setStatusFilter("PENDING")}
            >
              待审核
            </button>
            <button
              className={statusFilter === "SELECTED" ? "active" : ""}
              onClick={() => setStatusFilter("SELECTED")}
            >
              已选题
            </button>
            <button
              className={statusFilter === "DISMISSED" ? "active" : ""}
              onClick={() => setStatusFilter("DISMISSED")}
            >
              已忽略
            </button>
            <button
              className={statusFilter === "ALL" ? "active" : ""}
              onClick={() => setStatusFilter("ALL")}
            >
              全部
            </button>
          </div>
          <div className="theme-filters">
            <button
              className={themeFilter === "EVERYDAY" ? "active" : ""}
              onClick={() => setThemeFilter("EVERYDAY")}
            >
              普通场景
            </button>
            <button
              className={themeFilter === "X_NEWS" ? "active" : ""}
              onClick={() => setThemeFilter("X_NEWS")}
            >
              中文圈图文
            </button>
            <button
              className={themeFilter === "VIDEO_READY" ? "active" : ""}
              onClick={() => setThemeFilter("VIDEO_READY")}
            >
              视频可成片
            </button>
            <button
              className={themeFilter === "YOUTUBE_SOURCE" ? "active" : ""}
              onClick={() => setThemeFilter("YOUTUBE_SOURCE")}
            >
              YouTube 来源（含待拉片）
            </button>
            <button
              className={themeFilter === "ALL" ? "active" : ""}
              onClick={() => setThemeFilter("ALL")}
            >
              全部
            </button>
            {topicThemes.map((theme) => (
              <button
                key={theme}
                className={themeFilter === theme ? "active" : ""}
                onClick={() => setThemeFilter(theme)}
              >
                {topicThemeLabels[theme]}
              </button>
            ))}
          </div>
          {candidates.length === 0 ? (
            <div className="empty-state">
              <div className="radar-mark">⌁</div>
              <h3>雷达等待第一次扫描</h3>
              <p>添加 GitHub 来源并运行一次采集任务，候选将自动出现在这里。</p>
            </div>
          ) : (
            <div className="candidate-layout">
              <div className="candidate-list">
                {visibleCandidates.length === 0 ? (
                  <p className="filter-empty">此方向今天暂无候选。</p>
                ) : (
                  visibleCandidates.map((candidate) => (
                    <button
                      className={`candidate-row ${active?.id === candidate.id ? "selected" : ""}`}
                      key={candidate.id}
                      onClick={() => setActiveId(candidate.id)}
                    >
                      <span className="rank">
                        {String(candidate.rank).padStart(2, "0")}
                      </span>
                      <span className="candidate-title">
                        <b>
                          {shortTopicHook(
                            candidate.contentItem.analysis?.chineseAngle,
                            candidate.contentItem.analysis?.summary,
                          ) || candidate.contentItem.title}
                        </b>
                        <small>
                          {candidate.contentItem.source.type === "X_BOOKMARK"
                            ? `${candidate.contentItem.source.name} · `
                            : ""}
                          {candidate.contentItem.title.slice(0, 42)}
                          {candidate.contentItem.topicTheme
                            ? ` · ${topicThemeLabels[candidate.contentItem.topicTheme as TopicTheme]}`
                            : ""}
                        </small>
                      </span>
                      <span className="score">
                        {candidate.contentItem.score?.total ?? "—"}
                      </span>
                    </button>
                  ))
                )}
              </div>
              {active && (
                <article className="candidate-detail">
                  <div className="detail-meta">
                    <span className="status">{statusLabel[active.status]}</span>
                    <span className="score-pill">
                      趋势分 {active.contentItem.score?.total ?? "—"}
                    </span>
                    <span className="score-pill">
                      片源适合度{" "}
                      {active.contentItem.score?.videoSuitability ?? "—"}
                    </span>
                  </div>
                  <h3>{active.contentItem.title}</h3>
                  <p className="summary">
                    {active.contentItem.analysis?.summary ?? "等待分析结果。"}
                  </p>
                  <div className="tag-list">
                    {Array.isArray(active.contentItem.analysis?.tags) &&
                      active.contentItem.analysis?.tags.map((tag) => (
                        <span key={String(tag)}>{String(tag)}</span>
                      ))}
                  </div>
                  {active.contentItem.analysis?.chineseAngle && (
                    <div className="angle">
                      <b>中文内容角度</b>
                      <p>{active.contentItem.analysis.chineseAngle}</p>
                    </div>
                  )}
                  <p className="reasoning">
                    {active.contentItem.score?.reasoning}
                  </p>
                  {active.contentItem.source.type === "YOUTUBE" && (
                    <div className="media-ingest">
                      <b>YouTube 素材拉片</b>
                      <p>
                        已具备素材使用权时，系统会拉取
                        MP4、WAV、SRT；再抽帧做视觉理解，并用 DeepSeek 输出拉片
                        JSON、改写口播和分镜。字幕为可选项，受平台限流时会自动跳过，不影响视频与音频入库。
                      </p>
                      <p className="reasoning">
                        YouTube 许可：
                        {active.contentItem.mediaLicense
                          ? (youtubeLicenseLabel[
                              active.contentItem.mediaLicense
                            ] ?? active.contentItem.mediaLicense)
                          : "历史数据未识别；请以原视频许可与授权证明为准。"}
                      </p>
                      {active.contentItem.mediaAssets[0] ? (
                        <div>
                          <p
                            className={`asset-status ${active.contentItem.mediaAssets[0].status.toLowerCase()}`}
                          >
                            任务状态：
                            {active.contentItem.mediaAssets[0].status ===
                            "READY_FOR_ANALYSIS"
                              ? "素材已就绪，待 AI 拉片"
                              : active.contentItem.mediaAssets[0].status ===
                                  "ANALYZING"
                                ? "正在视觉理解、ASR 与生成拉片 JSON"
                                : active.contentItem.mediaAssets[0].status ===
                                    "ANALYZED"
                                  ? "拉片 JSON 与抖音改写稿已生成，可到内容工作室查看"
                                  : active.contentItem.mediaAssets[0].status ===
                                      "DOWNLOADING"
                                    ? "正在拉取 MP4 / WAV / SRT"
                                    : active.contentItem.mediaAssets[0]
                                          .status === "FAILED"
                                      ? `失败：${active.contentItem.mediaAssets[0].error ?? "未知错误"}`
                                      : "已进入队列"}
                          </p>
                          {active.contentItem.mediaAssets[0].status ===
                            "FAILED" && (
                            <button
                              className="dark-button action"
                              disabled={busy !== null}
                              onClick={() => retryVideo(active)}
                            >
                              {busy ===
                              `retry:${active.contentItem.mediaAssets[0].id}`
                                ? "正在重试…"
                                : "重试素材拉取"}
                            </button>
                          )}
                          {active.contentItem.mediaAssets[0].status ===
                            "READY_FOR_ANALYSIS" && (
                            <button
                              className="dark-button action"
                              disabled={busy !== null}
                              onClick={() => analyzeVideo(active)}
                            >
                              {busy ===
                              `analyze:${active.contentItem.mediaAssets[0].id}`
                                ? "正在启动拉片…"
                                : "开始视觉理解与拉片"}
                            </button>
                          )}
                          {active.contentItem.mediaAssets[0].status ===
                            "ANALYZED" && (
                            <a className="primary button-link" href="/studio">
                              查看改写稿与分镜
                            </a>
                          )}
                        </div>
                      ) : (
                        <div>
                          <select
                            value={rights}
                            onChange={(event) =>
                              setRights(
                                event.target.value as keyof typeof rightsLabel,
                              )
                            }
                            aria-label="素材授权状态"
                          >
                            {Object.entries(rightsLabel).map(
                              ([value, label]) => (
                                <option
                                  value={value}
                                  key={value}
                                  disabled={
                                    value === "CC_BY" &&
                                    active.contentItem.mediaLicense !==
                                      "creativeCommon"
                                  }
                                >
                                  {label}
                                </option>
                              ),
                            )}
                          </select>
                          <button
                            className="dark-button action"
                            disabled={
                              busy !== null || rights === "RESEARCH_ONLY"
                            }
                            onClick={() => ingestVideo(active)}
                          >
                            {busy === `ingest:${active.id}`
                              ? "正在创建任务…"
                              : "拉取素材并开始拉片"}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                  <div className="detail-actions">
                    <a
                      className="source-link"
                      href={active.contentItem.canonicalUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      查看原项目 ↗
                    </a>
                    <button
                      className="secondary action"
                      disabled={busy === active.id}
                      onClick={() => updateCandidate(active.id, "DISMISSED")}
                    >
                      忽略
                    </button>
                    <button
                      className="primary action"
                      disabled={busy === active.id}
                      onClick={() => updateCandidate(active.id, "SELECTED")}
                    >
                      {busy === active.id ? "处理中" : "选为选题"}
                    </button>
                  </div>
                </article>
              )}
            </div>
          )}
        </section>
      )}

      {mode === "sources" && (
        <section id="sources" className="sources-panel operations-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">SOURCES</p>
              <h2>信息源</h2>
            </div>
            <button
              className="primary"
              onClick={() => setShowSourceForm((visible) => !visible)}
            >
              + 添加信息源
            </button>
          </div>
          <div className="preset-grid">
            {sourcePresets.map((preset) => {
              const exists = sources.some(
                (source) => source.name === preset.name,
              );
              const loading = busy === `preset:${preset.name}`;
              return (
                <article className="preset-card" key={preset.name}>
                  <div>
                    <p>{preset.type.replace("_", " ")}</p>
                    <h3>{preset.name}</h3>
                    <span>{preset.description}</span>
                  </div>
                  <button
                    className="secondary action"
                    disabled={exists || loading}
                    onClick={() => addPreset(preset)}
                  >
                    {exists ? "已添加" : loading ? "添加中" : "+ 一键添加"}
                  </button>
                </article>
              );
            })}
          </div>
          {showSourceForm && (
            <form className="source-form" onSubmit={createSource}>
              <input
                required
                name="name"
                placeholder="来源名称，例如：Hugging Face 每日论文"
              />
              <select
                value={sourceKind}
                onChange={(event) =>
                  setSourceKind(event.target.value as SourceKind)
                }
                aria-label="信息源类型"
              >
                <option value="GITHUB">GitHub 项目</option>
                <option value="HUGGING_FACE">Hugging Face</option>
                <option value="YOUTUBE">YouTube 视频</option>
                <option value="RSS">RSS 订阅</option>
              </select>
              {sourceKind === "GITHUB" && (
                <input
                  required
                  name="query"
                  defaultValue="topic:ai-agent stars:>500"
                  placeholder="GitHub 搜索语句"
                />
              )}
              {sourceKind === "HUGGING_FACE" && (
                <select name="feed" aria-label="Hugging Face 类型">
                  <option value="daily_papers">Daily Papers（趋势论文）</option>
                  <option value="spaces">Trending Spaces（热门工具）</option>
                </select>
              )}
              {sourceKind === "YOUTUBE" && (
                <>
                  <input
                    required
                    name="query"
                    defaultValue="AI tools demo productivity"
                    placeholder="YouTube 搜索词，例如：AI video workflow"
                  />
                  <select
                    name="order"
                    defaultValue="viewCount"
                    aria-label="YouTube 排序"
                  >
                    <option value="date">最新发布</option>
                    <option value="relevance">相关性</option>
                    <option value="viewCount">周播放热门</option>
                  </select>
                  <input
                    name="windowDays"
                    type="number"
                    min="1"
                    max="30"
                    defaultValue="7"
                    aria-label="搜索时间窗口（天）"
                  />
                  <input
                    name="relevanceLanguage"
                    defaultValue="en"
                    maxLength={2}
                    placeholder="语言，例如 en"
                  />
                  <input
                    name="regionCode"
                    defaultValue="US"
                    maxLength={2}
                    placeholder="地区，例如 US"
                  />
                  <label className="checkbox-label">
                    <input name="ccByOnly" type="checkbox" />
                    仅搜索 Creative Commons（CC BY）视频
                  </label>
                </>
              )}
              {sourceKind === "RSS" && (
                <input
                  required
                  name="url"
                  type="url"
                  placeholder="https://example.com/feed.xml"
                />
              )}
              <input
                required
                name="limit"
                type="number"
                min="1"
                max="50"
                defaultValue={sourceKind === "GITHUB" ? 10 : 20}
              />
              <input
                required
                name="schedule"
                defaultValue="0 8 * * *"
                title="Cron 表达式（Asia/Shanghai）"
              />
              <button className="primary" disabled={busy === "create-source"}>
                {busy === "create-source" ? "创建中" : "保存来源"}
              </button>
            </form>
          )}
          <div className="source-grid">
            {sources.map((source) => (
              <article className="source-card" key={source.id}>
                <div>
                  <p className="source-type">
                    {source.type} · {source.schedule ?? "未设置"}
                  </p>
                  <h3>{source.name}</h3>
                  <p>
                    {source._count.items} 条内容 · {source._count.runs} 次运行
                  </p>
                </div>
                <button
                  className="secondary action"
                  disabled={busy === source.id}
                  onClick={() => runSource(source.id)}
                >
                  {busy === source.id ? "已加入队列" : "立即运行"}
                </button>
              </article>
            ))}
          </div>
        </section>
      )}
      {mode === "runs" && (
        <section id="runs" className="runs-panel operations-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">RUN HISTORY</p>
              <h2>最近任务</h2>
              <p className="subtle">点击任务查看采集结果或完整错误。</p>
            </div>
            <span className="candidate-count">
              最近 {initialRuns.length} 次
            </span>
          </div>
          <div className="run-list">
            {initialRuns.map((run) => {
              const expanded = activeRunId === run.id;
              const stats =
                run.stats && typeof run.stats === "object"
                  ? (run.stats as Record<string, unknown>)
                  : null;
              return (
                <div
                  key={run.id}
                  className={`run-entry ${expanded ? "expanded" : ""}`}
                >
                  <button
                    type="button"
                    className="run-row"
                    aria-expanded={expanded}
                    onClick={() => setActiveRunId(expanded ? null : run.id)}
                  >
                    <span className={`run-status ${run.status.toLowerCase()}`}>
                      {run.status}
                    </span>
                    <span>
                      <b>{run.source.name}</b>
                      <small>
                        {run.startedAt
                          ? new Date(run.startedAt).toLocaleString("zh-CN", {
                              hour12: false,
                            })
                          : "等待执行"}
                      </small>
                    </span>
                    <span className="run-stats">
                      {run.error
                        ? "查看错误"
                        : stats
                          ? `发现 ${String(stats.discovered ?? 0)} · 新增 ${String(stats.created ?? 0)}`
                          : run.status === "RUNNING"
                            ? "采集中…"
                            : "等待执行"}{" "}
                      {expanded ? "⌃" : "⌄"}
                    </span>
                  </button>
                  {expanded && (
                    <div className="run-detail">
                      <div>
                        <span>来源类型</span>
                        <b>{run.source.type}</b>
                      </div>
                      <div>
                        <span>开始时间</span>
                        <b>
                          {run.startedAt
                            ? new Date(run.startedAt).toLocaleString("zh-CN", {
                                hour12: false,
                              })
                            : "尚未开始"}
                        </b>
                      </div>
                      <div>
                        <span>结束时间</span>
                        <b>
                          {run.finishedAt
                            ? new Date(run.finishedAt).toLocaleString("zh-CN", {
                                hour12: false,
                              })
                            : run.status === "RUNNING"
                              ? "运行中"
                              : "—"}
                        </b>
                      </div>
                      {stats && (
                        <>
                          <div>
                            <span>发现</span>
                            <b>{String(stats.discovered ?? 0)}</b>
                          </div>
                          <div>
                            <span>新增 / 跳过</span>
                            <b>
                              {String(stats.created ?? 0)} /{" "}
                              {String(stats.skipped ?? 0)}
                            </b>
                          </div>
                          <div>
                            <span>候选池</span>
                            <b>{String(stats.candidates ?? "—")}</b>
                          </div>
                        </>
                      )}
                      {run.error && <pre>{run.error}</pre>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}
    </>
  );
}
