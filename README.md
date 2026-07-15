# voicetxt

纯前端（无后端）的语音转文字 + 字幕生成工具。所有识别在浏览器本地完成（transformers.js + Whisper），数据绝不上传。

- 三种输入：上传音频、上传视频（自动提音轨）、浏览器实时录音
- 多语言识别（自动检测 + 手动指定）
- 多种字幕排版：纯文本 / 逐句带时间戳 / SRT / WebVTT / JSON / Karaoke 逐词高亮
- 模型运行时可选、可见下载状态、可清理，首次有引导
- 说话人区分（可选，默认关）
- 部署到 Cloudflare Pages + GitHub Pages

> 设计详见 [DESIGN.md](DESIGN.md)。

## 仓库结构

monorepo（pnpm workspaces）：

- `packages/core` — `@voicetxt/core`：STT 核心逻辑，零 UI 依赖，可被网站与浏览器扩展复用
- `packages/web` — 网站：React + Vite + shadcn/ui
- `integration-tests/` — Playwright E2E

## 快速开始

```bash
pnpm install
pnpm dev          # 启动网站
pnpm build        # 构建 core + web
pnpm test         # 单元测试
pnpm test:e2e     # E2E 测试
```

## 部署

`pnpm build` 产物为 `packages/web/dist`，纯静态。模型文件不进产物，首次从 Hugging Face CDN 下载并缓存到浏览器 IndexedDB。

- Cloudflare Pages：连 Git 自动构建，或 `wrangler pages deploy`
- GitHub Pages：GitHub Actions 推送 `dist`

两者皆免费。
