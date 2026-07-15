# voicetxt 设计文档

> 纯前端（无后端）的语音转文字 + 字幕生成工具。部署到 Cloudflare Pages + GitHub Pages。
> 所有识别计算在浏览器本地完成（transformers.js + Whisper），数据绝不上传。
> STT 核心抽成独立包 `voicetxt-core`，网站与（后续的）浏览器扩展共用。

---

## 1. 概述与目标

**做什么**：把音频/视频/实时录音转成文字，生成多种排版的字幕，全部在浏览器本地完成。

**核心目标**：
- 纯静态、零后端、隐私安全（数据不出浏览器）
- 多语言识别（自动检测 + 手动指定）
- 三种输入：上传音频文件、上传视频文件（自动提音轨）、浏览器实时录音
- 多种字幕排版输出（含逐词/逐字 karaoke 高亮）
- 模型可运行时选择、可看下载状态、可清理，首次有引导
- 说话人区分作为可选开关（默认关）
- core 包可被浏览器扩展复用（本次只做 core + 网站，扩展为后续阶段）

**非目标（本次不做）**：
- 浏览器扩展本体（含 B 站视频数据获取）——后续阶段，core 留好接口
- 服务端、账号、云端识别

---

## 2. 技术栈

| 层 | 选型 |
|---|---|
| 包管理 / monorepo | pnpm workspaces |
| core 构建 | tsup（产出 ESM，供 web 与扩展 import） |
| web 构建 | Vite + React 18 + TypeScript |
| UI | shadcn/ui + Tailwind CSS（遵守"禁止手写 CSS"全局规则） |
| STT 引擎 | `@huggingface/transformers` + Whisper（多语言，WebGPU 优先、WASM 兜底） |
| 音频处理 | Web Audio API（解码 / 重采样 / 提音轨） |
| 实时录音 | `MediaRecorder` + VAD 分段 |
| 模型缓存 | IndexedDB（transformers.js 缓存） |
| 单元测试 | Vitest |
| E2E 测试 | Playwright（`integration-tests/`） |
| CI / 部署 | GitHub Actions → Cloudflare Pages + GitHub Pages |

---

## 3. 仓库结构（monorepo）

```
voicetxt/
├─ packages/
│  ├─ core/                    voicetxt-core：纯逻辑，零 UI 依赖，可在 offscreen/worker 跑
│  │   ├─ src/
│  │   │   ├─ audio/           解码/重采样16k单声道/提音轨/切片
│  │   │   ├─ transcription/   transformers.js 封装(Worker内)
│  │   │   ├─ models/          模型注册表/缓存查询/下载/清理
│  │   │   ├─ vad/             silero-vad 分段 + 能量阈值兜底
│  │   │   ├─ formats/         SRT/VTT/TXT/JSON/karaoke 生成
│  │   │   ├─ types.ts         公共类型
│  │   │   └─ index.ts         统一 API: createEngine().transcribe()
│  │   └─ tsup.config.ts
│  └─ web/                     网站：React + Vite + shadcn，import @voicetxt/core
│      ├─ src/
│      │   ├─ components/       shadcn 组件 + 业务组件
│      │   ├─ features/         input / models / result / recording
│      │   ├─ workers/          调用 core 的 Worker 桥
│      │   └─ App.tsx
│      └─ vite.config.ts
├─ integration-tests/          Playwright E2E
├─ .github/workflows/          ci.yml(测试) + deploy.yml(双部署)
├─ pnpm-workspace.yaml
└─ DESIGN.md
```

**依赖方向**：`web → core`；`core` 不依赖任何 React/DOM 强耦合（只用浏览器标准 API：Web Audio、IndexedDB、Worker、fetch）。

---

## 4. core 包设计

每个子模块单一职责，可独立测试。

### 4.1 audio（音频预处理）
- `decode(blob: Blob): Promise<AudioBuffer>` — 用 `AudioContext.decodeAudioData` 解码任意格式
- `resampleTo16kMono(buffer: AudioBuffer): Float32Array` — 离屏 AudioContext 重采样到 16kHz 单声道（Whister 输入规范）
- `extractAudioTrack(videoBlob: Blob): Promise<AudioBuffer>` — `<video>` + Web Audio 抓音轨
- `slice(Float32Array, opts): Segment[]` — 长音频按 30s 切片，带 overlap 防止切断词

### 4.2 transcription（识别引擎）
- 封装 `@huggingface/transformers` 的 `pipeline('automatic-speech-recognition', model)`
- 后端选择：`device: 'webgpu'`，不可用则 `'wasm'`
- 支持 `return_timestamps: 'word' | true`（逐词 / 逐句）
- 放进 **Web Worker**，UI 线程不阻塞
- API：`load(modelId, { onProgress })`、`transcribe(samples, opts)`、`cancel()`
- 进度回调：模型下载进度、识别进度（按切片计）

### 4.3 models（模型管理）
- 模型注册表（见 §10）：id / 体积 / 多语言标记 / 说明
- `getStatus(modelId): 'remote' | 'downloading' | 'cached'` — 读 IndexedDB 缓存键
- `download(modelId, { onProgress })`、`remove(modelId)`、`removeAll()`
- `getCacheSize()`

### 4.4 vad（语音活动检测）
- 主：transformers.js 的 `silero-vad` ONNX 模型
- 兜底：RMS 能量阈值（无需额外模型）
- 输出语音段区间，供实时录音分段送识别

### 4.5 formats（字幕排版）
- `toPlainText(result)` / `toTimestampedLines(result)` / `toSRT(result)` / `toVTT(result)` / `toJSON(result)` / `toKaraoke(result)`
- 纯函数，易测

### 4.6 统一 API
```ts
// packages/core/src/index.ts
export async function createEngine(opts: { model: ModelId; device?: 'webgpu'|'wasm' })
  : Promise<Engine>

interface Engine {
  transcribe(input: Blob | AudioBuffer | Float32Array, opts: TranscribeOptions): Promise<TranscribeResult>
  cancel(): void
  dispose(): void
}

interface TranscribeOptions {
  language?: 'auto' | 'zh' | 'en' | ...   // 默认 auto
  wordTimestamps?: boolean                  // karaoke 需要
  onProgress?: (p: Progress) => void
  signal?: AbortSignal
}

interface TranscribeResult {
  text: string
  segments: { start: number; end: number; text: string }[]
  words?: { word: string; start: number; end: number }[]   // wordTimestamps 时
  language: string
  toSRT(): string; toVTT(): string; toPlainText(): string; toJSON(): string; toKaraoke(): KaraokeData
}
```

**为零 UI 依赖**：core 不 import React；只用浏览器标准 API。扩展 offscreen document 可直接 `import { createEngine } from 'voicetxt-core'`。

---

## 5. web 应用设计

**页面/区域**：
- 主工作区：左输入（上传/拖拽/实时录音切换），右结果（字幕面板 + 排版切换 + 复制/导出）
- 模型管理（设置弹层）：档位列表 + 状态徽章 + 下载/清理/设默认 + 总占用
- 首次引导（onboarding modal）：无模型时触发，默认推荐 base

**Worker 桥**：web 通过 `workers/transcribe.worker.ts` 调用 core，主线程只发消息/收进度，UI 始终流畅。

**逐词高亮播放**：结果面板"播放"模式，`<audio>` 的 `timeupdate` 对照 `words[]` 高亮当前词（中文为逐字）。

---

## 6. 数据流

```
文件上传 ─→ <audio>/<video> 解码 → AudioBuffer
实时录音 ─→ MediaRecorder 采集   → AudioBuffer
                ↓
       重采样 16kHz 单声道 → 长音频切片(30s + overlap)
                ↓
       Whisper(Web Worker) 逐片识别 → 合并
                ↓
       TranscribeResult → 字幕面板 → 切换排版/复制/导出
```
全程支持 `AbortSignal` 取消。

---

## 7. 实时录音方案

Whisper 非流式，做不到无限连续输出。准实时方案：
- `MediaRecorder` 采集；`silero-vad` 检测说话段
- 每检测到一段完整语音（停顿 > 0.5s），立即送 Whisper 识别，结果**增量追加**到面板
- 延迟约 1–3s
- 同时录完整音频，结束可选"整体精校重跑"

---

## 8. 验收清单与测试覆盖（第 8 章）

| # | 验收项 | 测试类型 | 覆盖 |
|---|---|---|---|
| 8.1 | 上传音频 → 出字幕 → 切排版 → 导出 | E2E | `integration-tests/transcribe-file.spec.ts` |
| 8.2 | 上传视频 → 自动提音轨 → 出字幕 | E2E | 同上（视频样本） |
| 8.3 | 实时录音 → 增量出字 | E2E(mock mic) | `integration-tests/recording.spec.ts` |
| 8.4 | 多语言：自动检测 + 手动指定 | 单元 + E2E | formats 单元 + 上面 E2E |
| 8.5 | 5+1 种排版正确生成（SRT/VTT/TXT/JSON/timestamped/karaoke） | 单元 | `core/formats/*.test.ts` |
| 8.6 | 模型下载状态徽章 / 进度 / 清理 | 单元 + E2E(mock 小模型) | `core/models/*.test.ts` + `models.spec.ts` |
| 8.7 | 首次引导默认 base | E2E | `onboarding.spec.ts` |
| 8.8 | 无 WebGPU 自动退回 WASM，不阻塞 | 单元(能力检测) | `capabilities.test.ts` |
| 8.9 | 长音频切片 + 进度 + 可取消 | 单元(audio切片) + E2E | `audio.test.ts` |
| 8.10 | 推理异常可重试 | E2E | `error-retry.spec.ts` |
| 8.11 | 说话人区分开关（默认关，开则标注） | 单元 | `diarization.test.ts` |
| 8.12 | 双部署 CI 通过（CF Pages + GH Pages） | CI | `.github/workflows/deploy.yml` |

### 8.2 审查/测试轮次记录

| 日期 | 轮次 | 结果 | 发现的问题与修复 |
|---|---|---|---|
| 2026-07-15 | 首轮实现 | core 单测 39 通过 / 3 skip；E2E 4 通过；web build 通过 | ① 并发 agent 触发账户限流(429/503)→ 改主 session 串行实现 models/transcription/web。② `resampleTo16kMono` 实为 async，transcription 漏 await；`words` union 需 `?? []` 兜底。③ E2E 首跑 3 失败：首次访问无模型 → Onboarding modal 拦截点击 → `beforeEach` 用 Escape 关闭引导后全绿。④ `tsconfig` composite/references 与 `tsc --noEmit` 冲突(TS6310)→ 去掉 references。⑤ `vite.config.ts` 用 `__dirname` 但项目 ESM → 改 `import.meta.dirname`。 |

**待覆盖**：含真实模型下载/识别的完整 E2E（需模型缓存或较长耗时）；说话人区分端到端；CI（推送远程后由 GitHub Actions 触发）。
**已知优化点**：onnxruntime wasm(~21MB)目前进了产物（CF Pages 25MB 单文件限制内可用），可后续配置 `env.backends.onnx.wasm.wasmPaths` 走 CDN 以减小产物。

---

## 9. 字幕排版格式

| # | 排版 | 示例 | 用途 |
|---|---|---|---|
| 1 | 纯文本 | `你好世界` | 阅读/笔记 |
| 2 | 逐句带时间戳 | `[00:00:02] 你好世界` | 可读+定位 |
| 3 | SRT | 序号+时间码+文本 | 播放器字幕 |
| 4 | WebVTT | `WEBVTT` + 时间码 | HTML5 video |
| 5 | JSON | 时间戳/置信度/语种 | 二次开发 |
| 6 | Karaoke | 逐词/逐字 + 时间戳 | 播放高亮（英文逐词，中文逐字） |

---

## 10. 模型管理与首次引导

**模型注册表**：

| id | 多语言体积 | 定位 |
|---|---|---|
| tiny | ~75MB | 最快，质量最低，实时预览 |
| base | ~145MB | **引导默认**，平衡 |
| small | ~460MB | 推荐主力 |
| medium | ~1.5GB | 最高质量，算力高（移动端慎用） |

模型文件**不打进产物**，首次从 Hugging Face CDN 下载，缓存到 IndexedDB，二次免下载。清理 = 删缓存键。

---

## 11. 说话人区分（可选，默认关）

- 开关在识别选项里，默认关
- 用 transformers.js speaker-diarization 模型，给 segments 标注 `speaker`
- 标注"实验性"，准确率有限

---

## 12. 浏览器扩展复用预留

本次不实现扩展，但 core 满足复用前提：
- 零 UI 依赖、稳定 API（`createEngine().transcribe()`）
- 只用浏览器标准 API，可在 MV3 **offscreen document** 跑（Service Worker 不可用）
- core 接受 Blob/AudioBuffer/Float32Array，不关心数据来源（B 站数据源后续实现）
- 后续扩展数据流：扩展拿音频 blob → offdocument → `createEngine().transcribe()` → 字幕

---

## 13. 错误处理与能力检测

| 场景 | 处理 |
|---|---|
| 无 WebGPU | 自动退回 WASM，提示"较慢"，不阻塞 |
| 模型下载失败/中断 | 可重试，保留已下载部分 |
| 不支持格式 | 上传校验 + 友好提示 |
| 超长音频 | 分片 + 进度 + 可取消 + 内存监控 |
| 推理异常 | Worker 内捕获，回传错误，可重试 |
| 浏览器不支持 | 启动能力检测，明确提示 |

**能力检测**：启动检测 WebGPU / WASM / IndexedDB / MediaRecorder，决定后端与功能开关。

---

## 14. 部署（CF Pages + GitHub Pages）

- 模型走 HF CDN，**不进产物**；产物仅前端代码（几 MB）
- `pnpm build` → `packages/web/dist`
- GitHub Actions：
  - `ci.yml`：PR/push 跑 lint + Vitest + Playwright
  - `deploy.yml`：main 推送时 → 部署 GitHub Pages + 触发 Cloudflare Pages（或 CF 直连 Git 自动构建）
- 两者皆免费

---

## 15. 已知限制

- 首次需下载模型；缓存后可离线
- 实时录音 1–3s 延迟
- 中文 karaoke 为逐字高亮（非逐词）
- 说话人分区分准确率有限（实验性）
- 移动端 medium/large 谨慎（算力/内存）

---

## 16. 处理队列

多任务排队处理：默认串行、可配并发 1-3，支持暂停、持久化、进度，每任务独立模型。

### 数据模型（QueueTask，IndexedDB `voicetxt-tasks`）
`id / name / blob(可清理) / model / opts / status(pending|running|done|error) / progress / result / error / addedAt / startedAt / finishedAt / durationMs`

### 调度（`lib/use-queue.ts`）
- concurrency 个常驻 Worker（默认 1，设置 1–3），从 `pending` 按序取任务；实际并发不超设置。
- **暂停**：`paused` 时不取新任务，当前 `running` 跑完；暂停按钮仅 `hasActive`（有 pending/running）时可用。
- 解码 + 重采样在**主线程**（Web Audio 仅主线程可用），PCM 传 Worker 推理。
- 进度更新只走 state；状态变更（添加/完成/失败/清理/重试）才写 IndexedDB（避免大 blob 频繁回写）。
- 重启时 `running` 回退 `pending`，续跑。

### UI（`features/queue/QueuePanel.tsx`）
工具栏（计数 Badge + concurrency 设置 + 暂停/恢复 + 清空）+ 任务列表（模型/状态/进度条/各时间戳 + 查看结果/重试/清理音频/删除）。结果从任务点开 Dialog 查看（复用 ResultPanel）。

### 每任务独立模型
添加任务时用左侧"任务设置"（模型/语言/逐词/说话人），任务记住当时的设置。

### 验收补充
- 添加任务入队、按序处理、完成出字幕；并发 1-3 可配且不超限
- 暂停：不启动新任务、当前跑完；恢复后继续
- 刷新/重启：任务与字幕保留，running 回退 pending
- 清理音频：blob 置空、字幕保留；进度条识别中实时更新
- medium(1.5GB) 在管理/引导/选择器三处体积警告

---

## 17. 后续阶段（不在本次范围）

- 浏览器扩展（MV3）：popup + offdocument + 与 core 接线
- B 站视频数据获取（分片 dash 抓取/合并/解码），作为扩展的数据源
- 基于 core 的其他消费者
