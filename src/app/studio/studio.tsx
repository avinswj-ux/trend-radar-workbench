"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { fishyActions, type FishyAction } from "@/lib/avatar/fishy";
import { VIDEO_PRODUCTION_POLICY } from "@/lib/video-policy-config";
import { recommendBgmProfile } from "@/lib/bgm-profile";
import { shortTopicHook } from "@/lib/scoring";
import {
  topicThemeLabels,
  topicThemes,
  type TopicTheme,
} from "@/lib/topic-theme";

type Candidate = {
  id: string;
  contentItem: {
    id: string;
    title: string;
    canonicalUrl: string;
    analysis: { summary: string; chineseAngle: string | null } | null;
    score: { total: number } | null;
    source: { type: string; name?: string };
    mediaAssets: Array<{
      id: string;
      status: string;
      videoPath: string | null;
      error?: string | null;
      metadata?: unknown;
    }>;
  };
};
type Clip = { id: string; scene: number; voice: string; audioUrl: string };
type XhsVisual = {
  scene: number;
  kind: "cover" | "card";
  url: string;
  title: string;
};
type ReviewIssue = {
  severity: "MUST_FIX" | "SHOULD_FIX" | "NOTICE";
  quote: string;
  rule: string;
  explanation: string;
  replacement: string;
};
type ReviewReport = {
  verdict: "PASSED" | "NEEDS_CHANGES" | "DO_NOT_PUBLISH";
  summary: string;
  platformConclusion: string;
  scope: string;
  issues: ReviewIssue[];
  checklist: string[];
  lexicalCandidates: number;
  boundary: string;
  revisedTitle: string;
  revisedHook: string;
  revisedScript: string;
  revisedCaption: string;
};
type PublishReview = {
  id: string;
  status: ReviewReport["verdict"];
  model: string;
  commercial: boolean;
  industry: string;
  report: unknown;
  updatedAt: Date;
};
type VideoRender = {
  id: string;
  status: "QUEUED" | "RENDERING" | "SUCCEEDED" | "FAILED";
  progress: number;
  outputUrl: string | null;
  visualMode: string | null;
  error: string | null;
  updatedAt?: string | Date;
};
type Draft = {
  id: string;
  contentItemId: string;
  platform: "XIAOHONGSHU" | "DOUYIN";
  model: string;
  title: string;
  hook: string;
  script: string;
  caption: string;
  hashtags: unknown;
  storyboard: unknown;
  narrationClips: Clip[];
  visuals?: XhsVisual[];
  publishReview?: PublishReview | null;
  videoRender?: VideoRender | null;
  updatedAt: Date;
};
type ProductionPlan = {
  format: string;
  policy: string;
  scenes: Array<{
    scene: number;
    durationSeconds: number;
    subtitle: string;
    avatar: { action: string; asset: string };
    voice: { ready: boolean };
    primaryVisual: {
      type: "OFFICIAL_REFERENCE" | "AI_INFOGRAPHIC";
      instruction: string;
    };
  }>;
};
const platformName = { XIAOHONGSHU: "小红书", DOUYIN: "抖音" };

function sourceImageUrls(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata))
    return [] as string[];
  const images = (metadata as { images?: unknown }).images;
  if (!Array.isArray(images)) return [] as string[];
  return images.flatMap((image) => {
    if (!image || typeof image !== "object") return [];
    const publicUrl = (image as { publicUrl?: unknown }).publicUrl;
    return typeof publicUrl === "string" ? [publicUrl] : [];
  });
}

function deliveredVideoUrl(render: VideoRender) {
  if (!render.outputUrl) return "";
  const version = render.updatedAt
    ? new Date(render.updatedAt).getTime()
    : render.id;
  return `${render.outputUrl}?v=${version}`;
}

function douyinUploadUrl(render: VideoRender) {
  if (!render.outputUrl) return "";
  return deliveredVideoUrl({
    ...render,
    outputUrl: render.outputUrl.replace(/final\.mp4$/, "douyin-upload.mp4"),
  });
}

export function Studio({
  initialCandidates,
  initialDrafts,
}: {
  initialCandidates: Candidate[];
  initialDrafts: Draft[];
}) {
  const [candidates, setCandidates] = useState(initialCandidates);
  const [drafts, setDrafts] = useState(initialDrafts);
  const [activeId, setActiveId] = useState(
    () => initialCandidates[0]?.contentItem.id ?? null,
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manualTitle, setManualTitle] = useState("");
  const [manualUrl, setManualUrl] = useState("");
  const [manualNotes, setManualNotes] = useState("");
  const [manualTheme, setManualTheme] = useState<TopicTheme>("FUN_PROJECT");
  const [commercial, setCommercial] = useState(false);
  const [reviewIndustry, setReviewIndustry] = useState<
    "general" | "medical" | "finance"
  >("general");
  const [plans, setPlans] = useState<Record<string, ProductionPlan>>({});
  const orderedCandidates = useMemo(() => {
    const latestDraftAt = (contentItemId: string) => {
      const stamps = drafts
        .filter((draft) => draft.contentItemId === contentItemId)
        .map((draft) => new Date(draft.updatedAt).getTime());
      return stamps.length ? Math.max(...stamps) : 0;
    };
    return [...candidates].sort((left, right) => {
      const leftProduced = latestDraftAt(left.contentItem.id);
      const rightProduced = latestDraftAt(right.contentItem.id);
      if (leftProduced !== rightProduced) return rightProduced - leftProduced;
      return 0;
    });
  }, [candidates, drafts]);
  const active = orderedCandidates.find(
    (candidate) => candidate.contentItem.id === activeId,
  );
  const activeIsYouTube = active?.contentItem.source.type === "YOUTUBE";
  const activeIsXNews = active?.contentItem.source.type === "X_BOOKMARK";
  const activeSourceImages = (active?.contentItem.mediaAssets ?? [])
    .flatMap((asset) => sourceImageUrls(asset.metadata));
  const activeVideoReady = active?.contentItem.mediaAssets.some(
    (asset) => asset.status === "ANALYZED" && Boolean(asset.videoPath),
  );
  const activeAsset = active?.contentItem.mediaAssets[0];
  const activeVideoStatus = activeAsset?.status;
  const analyzeKickoff = useRef<string | null>(null);

  useEffect(() => {
    if (!activeId || !activeIsYouTube || activeVideoReady) return;
    const timer = window.setInterval(async () => {
      const response = await fetch(
        `/api/media/ingest?contentItemId=${activeId}`,
      );
      if (!response.ok) return;
      const payload = (await response.json()) as {
        assets?: Candidate["contentItem"]["mediaAssets"];
      };
      if (!payload.assets) return;
      setCandidates((all) =>
        all.map((candidate) =>
          candidate.contentItem.id === activeId
            ? {
                ...candidate,
                contentItem: {
                  ...candidate.contentItem,
                  mediaAssets: payload.assets ?? [],
                },
              }
            : candidate,
        ),
      );
      const latest = payload.assets[0];
      if (
        latest?.status === "READY_FOR_ANALYSIS" &&
        analyzeKickoff.current !== latest.id
      ) {
        analyzeKickoff.current = latest.id;
        await fetch(`/api/media/${latest.id}/analyze`, { method: "POST" });
      }
    }, 4_000);
    return () => window.clearInterval(timer);
  }, [activeId, activeIsYouTube, activeVideoReady]);
  const activeDrafts = useMemo(
    () => drafts.filter((draft) => draft.contentItemId === activeId),
    [drafts, activeId],
  );
  const videoJobs = drafts.filter(
    (draft) => draft.platform === "DOUYIN" && draft.videoRender,
  );

  async function startYoutubePull() {
    if (!activeId) return;
    setBusy("ingest");
    setError(null);
    try {
      const existing = activeAsset;
      if (existing && (existing.status === "FAILED" || existing.status === "ANALYZING")) {
        const response = await fetch(`/api/media/${existing.id}/retry`, {
          method: "POST",
        });
        const payload = (await response.json()) as { error?: string };
        if (!response.ok) throw new Error(payload.error ?? "重试拉片失败");
        return;
      }
      const response = await fetch("/api/media/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentItemId: activeId, rights: "OWNED" }),
      });
      const payload = (await response.json()) as {
        id?: string;
        status?: string;
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error ?? "创建拉片任务失败");
      setCandidates((all) =>
        all.map((candidate) =>
          candidate.contentItem.id === activeId
            ? {
                ...candidate,
                contentItem: {
                  ...candidate.contentItem,
                  mediaAssets: [
                    {
                      id: payload.id ?? "",
                      status: payload.status ?? "QUEUED",
                      videoPath: null,
                      error: null,
                    },
                  ],
                },
              }
            : candidate,
        ),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "拉片任务创建失败");
    } finally {
      setBusy(null);
    }
  }

  async function generate(platform: Draft["platform"]) {
    if (!activeId) return;
    setBusy(platform);
    setError(null);
    try {
      const response = await fetch("/api/content/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentItemId: activeId, platform }),
      });
      const payload = (await response.json()) as Draft | { error?: string };
      if (!response.ok)
        throw new Error(
          "error" in payload ? payload.error : "生成失败，请检查模型连接后重试",
        );
      const draft = payload as Draft;
      setDrafts((all) => [
        draft,
        ...all.filter((item) => item.id !== draft.id),
      ]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "生成失败");
    } finally {
      setBusy(null);
    }
  }

  async function generateTts(draftId: string, force = false) {
    setBusy(`tts:${draftId}`);
    setError(null);
    try {
      const response = await fetch(
        `/api/content/drafts/${draftId}/tts${force ? "?force=1" : ""}`,
        {
          method: "POST",
        },
      );
      const result = (await response.json()) as { clips?: Clip[]; error?: string };
      if (!response.ok) throw new Error(result.error || "avin-2 旁白生成失败，请检查火山引擎配置");
      setDrafts((all) =>
        all.map((draft) =>
          draft.id === draftId
            ? { ...draft, narrationClips: result.clips ?? [] }
            : draft,
        ),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "旁白生成失败");
    } finally {
      setBusy(null);
    }
  }

  async function generateVisuals(draftId: string) {
    setBusy(`visuals:${draftId}`);
    setError(null);
    try {
      const response = await fetch(`/api/content/drafts/${draftId}/visuals`, {
        method: "POST",
      });
      const result = (await response.json()) as {
        visuals?: XhsVisual[];
        error?: string;
      };
      if (!response.ok) throw new Error(result.error || "小红书图片生成失败");
      setDrafts((all) =>
        all.map((draft) =>
          draft.id === draftId
            ? { ...draft, visuals: result.visuals ?? [] }
            : draft,
        ),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "小红书图片生成失败");
    } finally {
      setBusy(null);
    }
  }

  async function precheck(draftId: string) {
    setBusy(`precheck:${draftId}`);
    setError(null);
    try {
      const response = await fetch(`/api/content/drafts/${draftId}/precheck`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commercial, industry: reviewIndustry }),
      });
      const result = (await response.json()) as Draft | { error?: string };
      if (!response.ok)
        throw new Error("error" in result ? result.error : "发布前审查失败");
      setDrafts((all) =>
        all.map((draft) =>
          draft.id === draftId
            ? {
                ...draft,
                ...(result as Draft),
                visuals: (result as Draft).visuals ?? [],
                narrationClips: (result as Draft).narrationClips ?? [],
              }
            : draft,
        ),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "发布前审查失败");
    } finally {
      setBusy(null);
    }
  }

  async function applyPrecheckFix(draftId: string) {
    setBusy(`apply-fix:${draftId}`);
    setError(null);
    try {
      const response = await fetch(
        `/api/content/drafts/${draftId}/precheck/apply`,
        { method: "POST" },
      );
      const result = (await response.json()) as Draft | { error?: string };
      if (!response.ok)
        throw new Error("error" in result ? result.error : "采用修复稿失败");
      setDrafts((all) =>
        all.map((draft) =>
          draft.id === draftId
            ? {
                ...(result as Draft),
                visuals: (result as Draft).visuals ?? [],
                narrationClips: (result as Draft).narrationClips ?? [],
              }
            : draft,
        ),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "采用修复稿失败");
    } finally {
      setBusy(null);
    }
  }

  async function generateVideo(draftId: string) {
    setBusy(`video:${draftId}`);
    setError(null);
    try {
      const response = await fetch(`/api/content/drafts/${draftId}/video`, {
        method: "POST",
      });
      const queued = (await response.json()) as
        | VideoRender
        | { error?: string };
      if (!response.ok)
        throw new Error(
          ("error" in queued && queued.error) || "视频任务创建失败",
        );
      setDrafts((all) =>
        all.map((draft) =>
          draft.id === draftId
            ? { ...draft, videoRender: queued as VideoRender }
            : draft,
        ),
      );
      for (let attempt = 0; attempt < 300; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 2_000));
        const poll = await fetch(`/api/content/drafts/${draftId}/video`);
        const payload = (await poll.json()) as { render: VideoRender | null };
        if (payload.render)
          setDrafts((all) =>
            all.map((draft) =>
              draft.id === draftId
                ? { ...draft, videoRender: payload.render }
                : draft,
            ),
          );
        if (payload.render?.status === "SUCCEEDED") return;
        if (payload.render?.status === "FAILED")
          throw new Error(payload.render.error || "视频生成失败");
      }
      throw new Error("视频仍在后台渲染，请稍后刷新查看");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "视频生成失败");
    } finally {
      setBusy(null);
    }
  }

  async function createManualTopic(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("manual");
    setError(null);
    try {
      const response = await fetch("/api/content/topics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: manualTitle,
          sourceUrl: manualUrl,
          notes: manualNotes,
          topicTheme: manualTheme,
        }),
      });
      const payload = (await response.json()) as Candidate | { error?: string };
      if (!response.ok)
        throw new Error(
          "error" in payload ? payload.error : "手动选题保存失败",
        );
      const candidate = payload as Candidate;
      setCandidates((all) => [candidate, ...all]);
      setActiveId(candidate.contentItem.id);
      setManualTitle("");
      setManualUrl("");
      setManualNotes("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "手动选题保存失败");
    } finally {
      setBusy(null);
    }
  }

  async function loadProductionPlan(draftId: string) {
    setBusy(`plan:${draftId}`);
    setError(null);
    try {
      const response = await fetch(
        `/api/content/drafts/${draftId}/production-plan`,
      );
      if (!response.ok) throw new Error("无法生成素材计划");
      const plan = (await response.json()) as ProductionPlan;
      setPlans((all) => ({ ...all, [draftId]: plan }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法生成素材计划");
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="studio-shell">
      <header className="studio-header">
        <div>
          <a href="/" className="back-link">
            ← 返回 Trend Radar
          </a>
          <p className="eyebrow">REMIX LINE · 系统驱动，不是灵感驱动</p>
          <h1>二创不是剪辑问题，是生产线问题</h1>
          <p>
            去外网找好玩的项目，拆成普通人听得懂的话。对标账号只学风格，不搬它的选题。口播要停得下来，无片源就出观点卡，成片一键带 BGM。
          </p>
        </div>
      </header>
      {error && <p className="notice">{error}</p>}
      <section className="studio-flow studio-flow-7" aria-label="二创生产线">
        {[
          ["01", "原始资料", active ? "已入库" : "待入库"],
          ["02", "内容拆解", active?.contentItem.analysis ? "已拆解" : "待拆解"],
          ["03", "选题库", candidates.length ? `${candidates.length} 条` : "空"],
          ["04", "可剪辑脚本", activeDrafts.length ? "已出稿" : "下一步"],
          ["05", "素材清单", Object.keys(plans).length ? "已建单" : "待生成"],
          ["06", "发布包", activeDrafts.some((draft) => draft.publishReview?.status === "PASSED") ? "可发布" : "待审查"],
          ["07", "复盘表", "待接入数据"],
        ].map(([number, label, status]) => (
          <div key={number}>
            <b>{number}</b>
            <span>{label}</span>
            <small>{status}</small>
          </div>
        ))}
      </section>
      <p className="studio-principle">
        换壳搬运不做。真正能长期做的二创，至少要有解说、评论、反驳、补背景、提炼方法或拆成普通人能看懂的版本。
      </p>
      <details className="studio-utility">
        <summary>
          <b>固定视频规则</b>
          <span>系统自动执行，通常无需手动设置</span>
        </summary>
        <section className="video-policy">
        <div>
          <p className="eyebrow">FIXED VIDEO RULES</p>
          <h2>固定视频生产规则</h2>
          <span>以 Grok Bot 动态实测素材为基准，对所有后续视频自动执行。</span>
        </div>
        <ol>
          {VIDEO_PRODUCTION_POLICY.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ol>
        </section>
      </details>
      <details className="studio-utility">
        <summary>
          <b>06 发布包 / 成片</b>
          <span>{videoJobs.length ? `${videoJobs.length} 个视频任务` : "暂无视频任务"}</span>
        </summary>
        <section className="delivery-hub">
        <div className="section-heading">
          <div>
            <p className="eyebrow">PUBLISH PACK</p>
            <h2>发布包，不是剪完就结束</h2>
            <p>下载成片已混免版权底，可直接听。抖音待配乐版仍是纯口播，方便你在站内换曲。</p>
          </div>
          <a href="/runs">查看采集任务</a>
        </div>
        {videoJobs.length === 0 ? (
          <p className="delivery-empty">
            暂无有效视频任务。稿件修复后需重新生成 TTS，再创建视频。
          </p>
        ) : (
          <div className="delivery-list">
            {videoJobs.map((draft) => (
              <article key={draft.id}>
                <div>
                  <b>{draft.title}</b>
                  <span>
                    {draft.videoRender?.visualMode === "SOURCE_VIDEO"
                      ? "真实视频剪辑"
                      : draft.videoRender?.visualMode === "X_NEWS_EVIDENCE"
                        ? "原图口播"
                        : draft.videoRender?.visualMode === "OFFICIAL_EVIDENCE"
                          ? "官方证据画面"
                          : draft.videoRender?.visualMode === "AI_STORYBOARD"
                            ? "AI 分镜视觉"
                            : draft.videoRender?.visualMode === "MOTION_GRAPHICS"
                              ? "动态信息图"
                              : "等待确定视觉模式"}{" "}
                    ·{" "}
                    {draft.videoRender?.status === "SUCCEEDED"
                      ? "已完成"
                      : draft.videoRender?.status === "FAILED"
                        ? "失败"
                        : `渲染中 ${draft.videoRender?.progress ?? 0}%`}
                  </span>
                </div>
                {draft.videoRender?.status === "SUCCEEDED" &&
                draft.videoRender.outputUrl ? (
                  <>
                    <video
                      key={deliveredVideoUrl(draft.videoRender)}
                      controls
                      preload="metadata"
                      src={deliveredVideoUrl(draft.videoRender)}
                    />
                    <a
                      className="primary button-link"
                      href={deliveredVideoUrl(draft.videoRender)}
                      download
                    >
                      下载成片
                    </a>
                  </>
                ) : (
                  <small>
                    {draft.videoRender?.error ?? "任务正在后台处理"}
                  </small>
                )}
              </article>
            ))}
          </div>
        )}
        </section>
      </details>
      <details className="studio-utility">
        <summary>
          <b>07 复盘表</b>
          <span>先记录，再判断，不要只看播放量</span>
        </summary>
        <section className="review-hub">
          <p className="eyebrow">REVIEW LOOP</p>
          <h2>发完不是结束</h2>
          <p>
            播放量高可能只是标题刺激。收藏看工具价值，评论看争议，完播看结构。每周只回答三件事：哪类选题更容易被点开，哪类结构更容易被看完，哪类观点更容易引发评论和收藏。
          </p>
          <a href="/runs">查看采集与任务记录 ↗</a>
        </section>
      </details>
      <details className="studio-utility">
        <summary>
          <b>03 选题库 · 手动入库</b>
          <span>临时灵感、客户需求或自己发现的原视频</span>
        </summary>
        <section className="manual-topic">
        <div>
          <p className="eyebrow">TOPIC POOL</p>
          <h2>先入库，再剪</h2>
          <p>
            进入新领域别急着出片。先把原视频、链接和可二创角度放进选题池。稳定产出靠的是能增长的库，不是某一条爆款灵感。
          </p>
        </div>
        <form onSubmit={createManualTopic}>
          <input
            value={manualTitle}
            onChange={(event) => setManualTitle(event.target.value)}
            placeholder="选题标题，例如：这个开源视频工作流为什么火了？"
            required
            maxLength={180}
          />
          <select
            value={manualTheme}
            onChange={(event) =>
              setManualTheme(event.target.value as TopicTheme)
            }
            aria-label="内容方向"
          >
            {topicThemes.map((theme) => (
              <option value={theme} key={theme}>
                {topicThemeLabels[theme]}
              </option>
            ))}
          </select>
          <input
            value={manualUrl}
            onChange={(event) => setManualUrl(event.target.value)}
            placeholder="参考链接（可选）"
            type="url"
          />
          <textarea
            value={manualNotes}
            onChange={(event) => setManualNotes(event.target.value)}
            placeholder="补充事实、目标受众、想强调的角度或素材要点（可选）"
            maxLength={8000}
            rows={3}
          />
          <button className="primary" disabled={busy !== null}>
            {busy === "manual" ? "正在加入…" : "加入选题库"}
          </button>
        </form>
        </section>
      </details>
      {candidates.length === 0 ? (
        <section className="studio-empty">
          <h2>选题库还是空的</h2>
          <p>先回雷达选原视频入库，或在上面手动加入一条。不要从空白页开始写脚本。</p>
          <a className="primary button-link" href="/">
            回到今日雷达
          </a>
        </section>
      ) : (
        <div className="studio-layout">
          <aside className="studio-list">
            <p>选题库 · {candidates.length}</p>
            {orderedCandidates.map((candidate) => (
              <button
                key={candidate.id}
                className={
                  candidate.contentItem.id === activeId ? "active" : ""
                }
                onClick={() => setActiveId(candidate.contentItem.id)}
              >
                <b>
                  {shortTopicHook(
                    candidate.contentItem.analysis?.chineseAngle,
                    candidate.contentItem.analysis?.summary,
                  ) || candidate.contentItem.title}
                </b>
                <span>
                  {candidate.contentItem.source.type === "X_BOOKMARK"
                    ? `${candidate.contentItem.source.name ?? "中文圈图文"} · `
                    : ""}
                  {candidate.contentItem.title.length > 36
                    ? `${candidate.contentItem.title.slice(0, 36)}…`
                    : candidate.contentItem.title}
                </span>
              </button>
            ))}
          </aside>
          {active && (
            <section className="studio-main">
              <div className="topic-card">
                <div>
                  <p className="eyebrow">01 原始资料 · 02 内容拆解</p>
                  <h2>{active.contentItem.title}</h2>
                  <p>
                    {active.contentItem.analysis?.summary ?? "尚无拆解。不要只总结原视频讲了什么，要找出哪里值得重新讲。"}
                  </p>
                  {active.contentItem.analysis?.chineseAngle && (
                    <p className="increment-value">
                      增量价值：{active.contentItem.analysis.chineseAngle}
                    </p>
                  )}
                  {activeSourceImages.length > 0 && (
                    <div className="source-thumbs">
                      {activeSourceImages.slice(0, 12).map((url) => (
                        <img key={url} src={url} alt="原图" />
                      ))}
                    </div>
                  )}
                </div>
                <a
                  href={active.contentItem.canonicalUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  {activeIsXNews ? "原帖 ↗" : "原视频 ↗"}
                </a>
              </div>
              <div className="generate-row">
                <b className="step-label">04 一个素材拆成多种形态 · 先出可剪辑脚本，不是作文</b>
                <button
                  className="primary"
                  disabled={busy !== null}
                  onClick={() => generate("XIAOHONGSHU")}
                >
                  {busy === "XIAOHONGSHU"
                    ? "正在生成…"
                    : activeIsXNews
                      ? "重排中文圈图文"
                      : "收藏型 · 小红书图文"}
                </button>
                <button
                  className="dark-button"
                  disabled={
                    busy !== null ||
                    Boolean(activeIsYouTube && !activeVideoReady)
                  }
                  onClick={() => generate("DOUYIN")}
                >
                  {busy === "DOUYIN"
                    ? "正在生成…"
                    : activeIsYouTube
                      ? "曝光型 · 从拉片出抖音脚本"
                      : activeIsXNews
                        ? "曝光型 · 原图口播脚本"
                        : "曝光型 · 抖音可剪辑脚本"}
                </button>
                {activeIsXNews && (
                  <small>
                    抖音成片会用原帖图片做画面，再配口播。先出脚本，审查通过后生成旁白和成片。
                  </small>
                )}
                {activeIsYouTube && !activeVideoReady && (
                  <>
                    <button
                      className="dark-button"
                      disabled={
                        busy !== null ||
                        activeVideoStatus === "DOWNLOADING" ||
                        activeVideoStatus === "QUEUED" ||
                        activeVideoStatus === "ANALYZING" ||
                        activeVideoStatus === "READY_FOR_ANALYSIS"
                      }
                      onClick={() => void startYoutubePull()}
                    >
                      {busy === "ingest"
                        ? "正在启动拉片…"
                        : activeVideoStatus === "FAILED"
                          ? "重试拉片"
                          : activeVideoStatus === "DOWNLOADING" ||
                              activeVideoStatus === "QUEUED"
                            ? "正在下载原片…"
                            : activeVideoStatus === "ANALYZING" ||
                                activeVideoStatus === "READY_FOR_ANALYSIS"
                              ? "正在拉片…"
                              : "下载原片并拉片"}
                    </button>
                    <small>
                      {activeVideoStatus === "ANALYZING"
                        ? "素材正在视觉理解与拉片，完成后按钮自动启用"
                        : activeVideoStatus === "READY_FOR_ANALYSIS"
                          ? "原片已下载，正在生成拉片报告"
                          : activeVideoStatus === "DOWNLOADING" ||
                              activeVideoStatus === "QUEUED"
                            ? "正在从 YouTube 拉取 MP4，完成后自动拉片"
                            : activeVideoStatus === "FAILED"
                              ? `拉片失败：${activeAsset?.error ?? "请重试"}`
                              : "这条还没有片源。先拉片，再出抖音口播脚本。"}
                    </small>
                  </>
                )}
              </div>
              <div className="draft-grid">
                {activeDrafts.map((draft) => {
                  const report = draft.publishReview?.report as
                    | ReviewReport
                    | undefined;
                  const sceneCount = Array.isArray(draft.storyboard)
                    ? draft.storyboard.length
                    : 0;
                  const ttsReady =
                    draft.platform === "DOUYIN" &&
                    sceneCount > 0 &&
                    draft.narrationClips.length === sceneCount;
                  const bgm = recommendBgmProfile(
                    `${draft.title}\n${draft.hook}\n${draft.script}`,
                  );
                  return (
                    <article className="draft-card" key={draft.id}>
                      <div className="draft-head">
                        <span>{platformName[draft.platform]}</span>
                        <small>{draft.model}</small>
                      </div>
                      <h3>{draft.title}</h3>
                      <p className="hook">{draft.hook}</p>
                      <pre>{draft.script}</pre>
                      <p className="caption">{draft.caption}</p>
                      <div className="draft-tags">
                        {Array.isArray(draft.hashtags) &&
                          draft.hashtags.map((tag) => (
                            <span key={String(tag)}>#{String(tag)}</span>
                          ))}
                      </div>
                      {draft.platform === "DOUYIN" && (
                        <section className="bgm-card">
                          <div>
                            <b>抖音曲库选配 · {bgm.label}</b>
                            <span>{bgm.bpm}</span>
                          </div>
                          <p>{bgm.mood}</p>
                          <div className="bgm-terms">
                            {bgm.searchTerms.map((term) => (
                              <span key={term}>{term}</span>
                            ))}
                          </div>
                          <small>
                            成片不烧歌。发布时在抖音搜索这些词加音乐 {bgm.musicVolume} · 原声 {bgm.originalVolume}
                            <br />{bgm.energyCurve}
                          </small>
                        </section>
                      )}
                      <section className="precheck-panel">
                        <div>
                          <b>发布前审查</b>
                          <span>词面预检 + 语义判定，修复稿自动写回</span>
                        </div>
                        <div className="precheck-options">
                          <label>
                            <input
                              type="checkbox"
                              checked={commercial}
                              onChange={(event) =>
                                setCommercial(event.target.checked)
                              }
                            />{" "}
                            含广告 / 带货 / 引流
                          </label>
                          <select
                            value={reviewIndustry}
                            onChange={(event) =>
                              setReviewIndustry(
                                event.target.value as typeof reviewIndustry,
                              )
                            }
                            aria-label="审查行业"
                          >
                            <option value="general">通用内容</option>
                            <option value="medical">医疗健康</option>
                            <option value="finance">金融理财</option>
                          </select>
                          <button
                            className="secondary action"
                            disabled={busy !== null}
                            onClick={() => precheck(draft.id)}
                          >
                            {busy === `precheck:${draft.id}`
                              ? "正在审查并自动采用…"
                              : draft.publishReview
                                ? "重新审查并采用"
                                : "审查并自动采用"}
                          </button>
                        </div>
                        {report && (
                          <div
                            className={`precheck-result ${report.verdict.toLowerCase()}`}
                          >
                            <strong>
                              {report.verdict === "PASSED"
                                ? "本次检查未发现阻断问题"
                                : report.verdict === "NEEDS_CHANGES"
                                  ? "修改后再发布"
                                  : "不建议发布"}
                            </strong>
                            <p>{report.summary}</p>
                            <small>
                              {report.platformConclusion} · 词面候选{" "}
                              {report.lexicalCandidates} 处
                            </small>
                            {report.issues.length > 0 && (
                              <div className="precheck-issues">
                                {report.issues.map((issue, index) => (
                                  <div key={`${issue.rule}-${index}`}>
                                    <b>
                                      {issue.severity === "MUST_FIX"
                                        ? "必改"
                                        : issue.severity === "SHOULD_FIX"
                                          ? "建议改"
                                          : "提示"}{" "}
                                      · {issue.rule}
                                    </b>
                                    <p>
                                      “{issue.quote}”——{issue.explanation}
                                    </p>
                                    <span>建议：{issue.replacement}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                            <p className="review-boundary">{report.boundary}</p>
                            {report.summary.includes("已自动采用修复稿") ? (
                              <small>修复稿已写回标题、正文、口播分镜；旧旁白和成片已作废，需重新合成。</small>
                            ) : (
                              <small>这次没有可写回的修复稿：要么原文已可发，要么审查没给出不同的改稿。</small>
                            )}
                            {report.verdict === "DO_NOT_PUBLISH" && (
                              <button
                                className="primary review-fix"
                                disabled={busy !== null}
                                onClick={() => applyPrecheckFix(draft.id)}
                              >
                                {busy === `apply-fix:${draft.id}`
                                  ? "正在采用并复检…"
                                  : "仍要采用这版修复稿"}
                              </button>
                            )}
                          </div>
                        )}
                      </section>
                      <div className="draft-actions">
                        <b>下一步</b>
                        {draft.platform === "XIAOHONGSHU" && (
                          <button
                            className="secondary"
                            disabled={busy !== null}
                            onClick={async () => {
                              const tags = Array.isArray(draft.hashtags)
                                ? draft.hashtags.map((tag) => `#${tag}`).join(" ")
                                : "";
                              await navigator.clipboard.writeText(
                                `${draft.title}\n\n${draft.caption}\n\n${tags}`.trim(),
                              );
                            }}
                          >
                            复制小红书文案
                          </button>
                        )}
                        {draft.platform === "XIAOHONGSHU" && (
                          <button
                            className="primary"
                            disabled={busy !== null}
                            onClick={() => generateVisuals(draft.id)}
                          >
                            {busy === `visuals:${draft.id}`
                              ? "正在生成 6 张图片…"
                              : draft.visuals?.length
                                ? "重新生成图文图片"
                                : "生成 6 张图文图片"}
                          </button>
                        )}
                        {draft.platform === "DOUYIN" ? (
                          <>
                            <button
                              className="dark-button"
                              disabled={
                                busy !== null ||
                                draft.publishReview?.status !== "PASSED"
                              }
                              onClick={() =>
                                generateTts(
                                  draft.id,
                                  ttsReady,
                                )
                              }
                            >
                              {busy === `tts:${draft.id}`
                                ? "旁白合成中…"
                                : ttsReady
                                  ? "旁白已就绪 · 点此才重录"
                                  : draft.narrationClips.length
                                    ? `继续合成口播 ${draft.narrationClips.length}/${sceneCount}`
                                    : "合成一次口播"}
                            </button>
                            <button
                              className="primary"
                              disabled={
                                busy !== null ||
                                draft.publishReview?.status !== "PASSED" ||
                                Boolean(activeIsYouTube && !activeVideoReady)
                              }
                              onClick={() => generateVideo(draft.id)}
                            >
                              {busy === `video:${draft.id}`
                                ? `生成中 ${draft.videoRender?.progress ?? 0}%`
                                : draft.videoRender?.status === "SUCCEEDED"
                                  ? "重新生成成片"
                                  : "生成抖音成片"}
                            </button>
                          </>
                        ) : (
                          <span>图文复用内容母稿，无需生成 TTS</span>
                        )}
                        <button
                          className="secondary action"
                          disabled={busy !== null}
                          onClick={() => loadProductionPlan(draft.id)}
                        >
                          {busy === `plan:${draft.id}`
                            ? "正在规划…"
                            : "生成素材清单"}
                        </button>
                        {draft.platform === "DOUYIN" && (
                          <span>
                            {!draft.publishReview
                              ? "先完成发布前审查"
                              : draft.publishReview.status !== "PASSED"
                                ? "审查未通过，点上方审查并自动采用"
                                : !ttsReady
                                  ? `口播 ${draft.narrationClips.length}/${sceneCount} 段，点成片会自动补齐`
                                  : "口播已锁定，重渲成片不会重录"}
                          </span>
                        )}
                      </div>
                      {draft.videoRender?.status === "FAILED" && (
                        <p className="video-error">失败：{draft.videoRender.error}</p>
                      )}
                      {draft.videoRender?.status === "SUCCEEDED" &&
                        draft.videoRender.outputUrl && (
                          <div className="video-delivery">
                            <video
                              key={deliveredVideoUrl(draft.videoRender)}
                              controls
                              preload="metadata"
                              src={deliveredVideoUrl(draft.videoRender)}
                            />
                            <a
                              className="primary button-link"
                              href={deliveredVideoUrl(draft.videoRender)}
                              download
                            >
                              下载成片（含 BGM）
                            </a>
                            <a
                              className="secondary button-link"
                              href={douyinUploadUrl(draft.videoRender)}
                              download
                            >
                              下载抖音待配乐版（纯口播）
                            </a>
                          </div>
                        )}
                      {draft.visuals && draft.visuals.length > 0 && (
                        <section className="xhs-visuals">
                          <div>
                            <b>小红书图片组 · {draft.visuals.length} 张</b>
                            <span>首图已结合 Avin 形象</span>
                          </div>
                          <div className="xhs-visual-grid">
                            {draft.visuals.map((visual) => (
                              <a href={visual.url} download key={visual.url}>
                                <img src={visual.url} alt={visual.title} />
                                <small>
                                  {visual.scene === 1
                                    ? "封面"
                                    : `第 ${visual.scene} 张`}{" "}
                                  · 点击下载
                                </small>
                              </a>
                            ))}
                          </div>
                        </section>
                      )}
                      {plans[draft.id] && (
                        <section className="production-plan">
                          <b>05 素材清单 · {plans[draft.id].format}</b>
                          <p>{plans[draft.id].policy}</p>
                          {plans[draft.id].scenes.map((scene) => (
                            <div key={scene.scene}>
                              <em>
                                {String(scene.scene).padStart(2, "0")} ·{" "}
                                {scene.durationSeconds}s
                              </em>
                              <span>
                                {scene.primaryVisual.type ===
                                "OFFICIAL_REFERENCE"
                                  ? "官方画面"
                                  : "AI 信息图"}
                                ：{scene.primaryVisual.instruction}
                              </span>
                              <small>
                                Avin {scene.avatar.action} ·{" "}
                                {scene.voice.ready
                                  ? "旁白已就绪"
                                  : "待生成旁白"}{" "}
                                · 字幕「{scene.subtitle}」
                              </small>
                            </div>
                          ))}
                        </section>
                      )}
                      <div className="storyboard">
                        <b>可剪辑脚本 · 口播 / 画面 / 素材 / 备注</b>
                        {Array.isArray(draft.storyboard) &&
                          draft.storyboard.map((scene) => {
                            const shot = scene as {
                              scene: number;
                              durationSeconds: number;
                              visual: string;
                              narration: string;
                              onScreenText: string;
                              avatarAction?: FishyAction;
                              claim?: string;
                              evidenceType?: string;
                              evidenceRequirement?: string;
                            };
                            const action = shot.avatarAction
                              ? fishyActions[shot.avatarAction]
                              : fishyActions.TALK;
                            const clip = draft.narrationClips.find(
                              (item) => item.scene === shot.scene,
                            );
                            return (
                              <div key={shot.scene} className="cut-script">
                                <em>
                                  {String(shot.scene).padStart(2, "0")} ·{" "}
                                  {shot.durationSeconds}s
                                </em>
                                <p>
                                  <b>口播</b>
                                  {shot.narration}
                                </p>
                                <p>
                                  <b>画面</b>
                                  {shot.visual}
                                </p>
                                <p>
                                  <b>素材</b>
                                  {shot.evidenceType ?? "待判断"} ·{" "}
                                  {shot.evidenceRequirement ?? shot.visual}
                                </p>
                                <p>
                                  <b>备注</b>
                                  字幕「{shot.onScreenText}」· Avin {action.label}
                                  {action.chromaKey ? " · 蓝幕抠像" : ""}
                                  {shot.claim ? ` · 观点：${shot.claim}` : ""}
                                </p>
                                {clip && (
                                  <audio
                                    controls
                                    preload="none"
                                    src={clip.audioUrl}
                                  >
                                    旁白音频
                                  </audio>
                                )}
                              </div>
                            );
                          })}
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      )}
    </main>
  );
}
