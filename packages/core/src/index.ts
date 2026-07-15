// voicetxt core 统一入口。
// 各子模块由实现阶段填充后在此接入。契约见 ./types。

export * from './types'

// —— 子模块（实现阶段接入）——
export {
  MODEL_REGISTRY,
  getModelInfo,
  getModelStatus,
  downloadModel,
  removeModel,
  removeAllModels,
  getCacheSize,
} from './models'
export {
  decodeAudio,
  resampleTo16kMono,
  extractAudioTrack,
  sliceAudio,
} from './audio'
export {
  toPlainText,
  toTimestampedLines,
  toSRT,
  toVTT,
  toJSON,
  toKaraoke,
} from './formats'
export { detectCapabilities } from './capabilities'
export { runWorkerBridge } from './transcription/worker-bridge'

import type { Engine, EngineOptions } from './types'
import { getModelStatus } from './models'

/**
 * 创建识别引擎。零 UI 依赖，可在主线程、Worker、或扩展 offscreen document 调用。
 * 实现细节在 transcription 模块；此处为编排入口。
 */
export async function createEngine(opts: EngineOptions): Promise<Engine> {
  const status = await getModelStatus(opts.model)
  if (status !== 'cached') {
    throw new Error(
      `模型 ${opts.model} 尚未下载（当前状态：${status}）。请先调用 downloadModel。`,
    )
  }
  // transcription 引擎实例化由 ./transcription 提供，集成阶段接入。
  const { createTranscriptionEngine } = await import('./transcription')
  return createTranscriptionEngine(opts)
}
