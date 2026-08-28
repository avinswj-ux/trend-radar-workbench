# Trend Radar Workbench

**AI 趋势雷达 + 内容生产工作台 · AI trend radar and content production workbench**

[中文](#中文) | [English](#english)

---

## 中文

Trend Radar Workbench 从 GitHub、Hugging Face、RSS、X、YouTube 等公开来源自动发现 AI 相关动态，经过标准化、去重、大模型分析和评分，生成每日候选选题；再在「内容工作台」中把选题加工成口播稿、配音、分镜视觉和短视频，并在发布前做平台合规预检。

### 功能（均已在代码中实现）

- **多信息源采集**（`src/lib/sources/`）：GitHub 仓库搜索、Hugging Face（`daily_papers` / `spaces`）、任意 RSS 2.0 / Atom、X 账号动态（含媒体解析）、YouTube Data API。
- **队列与定时调度**：BullMQ + Redis Worker，按 cron 定时抓取，记录每次运行（运行中心 `/runs`）。
- **去重**：规范 URL 去重 + 新闻指纹 / 标题相似度去重（`news-fingerprint.ts`）。
- **AI 分析与评分**：DeepSeek（或百炼兼容接口）→ 火山方舟豆包回退 → 无密钥时规则分析；统一打分并生成当日候选列表。
- **素材理解**：素材入库与视觉分析，默认本机 Ollama `openbmb/minicpm-v4.6`，可切换 DashScope。
- **内容工作台**（`/studio`）：草稿生成、制作计划、分镜视觉 / 配图生成、火山引擎豆包 TTS 配音、基于 ffmpeg 的视频渲染、YouTube 素材匹配。
- **发布预检**：集成 [yuwen-publish-precheck](vendor/yuwen-publish-precheck)（MIT），按抖音 / 小红书 / 视频号规则检查文案并可一键应用修改建议。
- **健康检查**：`GET /api/health`。

### 截图

_暂无截图，欢迎补充。_

### 技术栈

Next.js 15 (App Router) · React 19 · TypeScript · Prisma 6 + PostgreSQL 16 · BullMQ + Redis 7 · Zod · sharp · ffmpeg · Python 3（预检脚本）

### 快速开始

前置：Node.js 20+、pnpm、Docker、ffmpeg、Python 3。

```bash
git clone https://github.com/avinswj-ux/trend-radar-workbench.git
cd trend-radar-workbench
pnpm install          # 推荐 pnpm（package-lock.json 目前与 npm ci 不兼容）
cp .env.example .env          # 按需填写密钥；不填则使用规则分析
touch .env.local              # worker 脚本会读取该文件，可为空
docker compose up -d          # Postgres :5434, Redis :6381
npm run db:generate && npm run db:migrate
npm run dev                   # http://localhost:3000
npm run worker                # 另开终端
```

### 配置

全部配置见 [`.env.example`](.env.example)（只含占位符）。主要变量：`DATABASE_URL`、`REDIS_URL`、`TEXT_ANALYSIS_PROVIDER`、`DEEPSEEK_API_KEY`、`ARK_API_KEY`、`DASHSCOPE_API_KEY`、`VISION_PROVIDER`、`GITHUB_TOKEN`、`YOUTUBE_API_KEY`、`VOLC_TTS_API_KEY` / `VOLC_TTS_APP_ID`、`FISHY_ASSETS_DIR`。

> 不要提交真实 `.env`、API Key、数据库、采集素材或生成视频。

### 添加信息源示例

`POST /api/radar/sources`，然后 `POST /api/radar/sources/:id/run`：

```json
{ "name": "GitHub AI projects", "type": "GITHUB",
  "config": { "query": "topic:artificial-intelligence pushed:>=2026-08-01", "perPage": 30 },
  "schedule": "0 8 * * *" }
```

```json
{ "name": "HF 每日趋势论文", "type": "HUGGING_FACE", "config": { "feed": "daily_papers", "limit": 20 }, "schedule": "0 8 * * *" }
```

```json
{ "name": "AI 新闻 RSS", "type": "RSS", "config": { "url": "https://example.com/feed.xml", "limit": 20 }, "schedule": "0 8 * * *" }
```

### 路线图

- [ ] 自动化测试与 CI（GitHub Actions）
- [ ] Product Hunt / 通用网页信息源（枚举已预留）
- [ ] 将品牌 / 形象配置（Avin）抽象为可替换配置
- [ ] 一键 Docker 部署（应用 + Worker）
- [ ] 英文界面

### 贡献

欢迎 issue 与 PR，详见 [CONTRIBUTING.md](CONTRIBUTING.md)。

---

## English

Trend Radar Workbench discovers AI-related updates from public sources (GitHub, Hugging Face, RSS, X, YouTube), normalizes and de-duplicates them, analyzes and scores them with LLMs, and produces a daily list of candidate topics. The **Studio** then turns a topic into a script, voice-over, visual storyboard and short video, with a platform compliance pre-check before publishing.

### Features (all implemented in code)

- **Multi-source ingestion** (`src/lib/sources/`): GitHub repo search, Hugging Face (`daily_papers` / `spaces`), any RSS 2.0 / Atom feed, X accounts (with media enrichment), YouTube Data API.
- **Queue & scheduling**: BullMQ + Redis worker with cron schedules; every crawl run is tracked (`/runs`).
- **De-duplication**: canonical-URL dedup plus news fingerprint / title-similarity dedup.
- **LLM analysis & scoring**: DeepSeek (or DashScope-compatible) → Volcengine Ark (Doubao) fallback → rule-based heuristic when no keys are set; scored into a daily candidate list.
- **Media understanding**: media ingest + vision analysis via local Ollama (`openbmb/minicpm-v4.6`) by default, or DashScope.
- **Content Studio** (`/studio`): draft generation, production plan, scene visuals / image generation, Volcengine Doubao TTS, ffmpeg video rendering, YouTube footage matching.
- **Publish pre-check**: bundled [yuwen-publish-precheck](vendor/yuwen-publish-precheck) (MIT) rules for Douyin / Xiaohongshu / WeChat Channels, with one-click fix application.
- **Health check**: `GET /api/health`.

### Screenshots

_None yet — contributions welcome._

### Tech stack

Next.js 15 · React 19 · TypeScript · Prisma 6 + PostgreSQL 16 · BullMQ + Redis 7 · Zod · sharp · ffmpeg · Python 3 (pre-check script)

### Quick start

Requires Node.js 20+, Docker, ffmpeg and Python 3. See the command block in the Chinese section above (`pnpm install` → `cp .env.example .env` → `touch .env.local` → `docker compose up -d` → `npm run db:generate && npm run db:migrate` → `npm run dev` + `npm run worker`).

### Configuration

All settings live in [`.env.example`](.env.example) (placeholders only). Without any LLM keys the radar still runs using the heuristic analyzer. Never commit real `.env` files or keys.

### Roadmap

- [ ] Automated tests and CI (GitHub Actions)
- [ ] Product Hunt / generic web sources (enum values already reserved)
- [ ] Make the brand/persona config (Avin) pluggable
- [ ] One-command Docker deployment (app + worker)
- [ ] English UI

### Contributing

Issues and PRs are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE) © 2026 avinswj-ux. Third-party code in `vendor/` retains its own license.
