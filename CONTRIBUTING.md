# Contributing / 贡献指南

Thanks for your interest in Trend Radar Workbench! 欢迎贡献！

## Getting started / 开始

1. Fork and clone the repo / Fork 并克隆仓库
2. `pnpm install` then follow **Quick Start** in [README.md](README.md)
3. Create a branch: `git checkout -b feat/my-change`

## Before opening a PR / 提交 PR 前

- `npm run lint` and `npm run build` should pass / 确保 lint 与构建通过
- If you change `prisma/schema.prisma`, add a migration with `npm run db:migrate`
- Keep PRs focused; describe what changed and how you tested it / PR 保持聚焦并说明测试方式

## Adding a source adapter / 新增信息源

Source adapters live in `src/lib/sources/`. Implement the interface in `types.ts`,
register it in `index.ts`, and add the enum value in `prisma/schema.prisma`.

## Security / 安全

**Never commit real `.env` files, API keys, tokens, cookies or generated media.**
Only `.env.example` with empty placeholders belongs in the repo.
请勿提交任何真实密钥、Cookie、数据库或生成的素材。发现安全问题请私下联系维护者，不要公开提 issue。

## License

By contributing you agree your contributions are licensed under the MIT License.
