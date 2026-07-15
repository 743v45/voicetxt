// voicetxt core 公共类型契约。所有子模块与消费者（web / 扩展）共用。

/** Whisper 模型档位 */
export type ModelId = 'tiny' | 'base' | 'small' | 'medium'

/** 推理后端 */
export type Device = 'webgpu' | 'wasm'

/** 识别语言；'auto' 自动检测 */
export type Language =
  | 'auto'
  | 'zh'
  | 'en'
  | 'ja'
  | 'ko'
  | 'fr'
  | 'de'
  | 'es'
  | 'ru'
  | 'it'
  | 'pt'
  | 'ar'

/** 单条字幕段 */
export interface Segment {
  start: number // 秒
  end: number // 秒
  text: string
  speaker?: string // 说话人区分时填充
}

/** 逐词（中文为逐字）时间戳，用于 karaoke 高亮 */
export interface WordTimestamp {
  word: string
  start: number
  end: number
  /** 置信度，0-1（如模型提供） */
  score?: number
}

/** 识别结果 */
export interface TranscribeResult {
  text: string
  segments: Segment[]
  words?: WordTimestamp[]
  language: string
  /** 检测到的语种置信度 */
  languageScore?: number
}

/** 进度回调 */
export interface Progress {
  /** 'download' 模型下载 | 'transcribe' 识别中 */
  phase: 'download' | 'transcribe'
  /** 0-1 */
  ratio: number
  /** 已处理 / 总数（如切片索引） */
  current?: number
  total?: number
  message?: string
}

/** 识别选项 */
export interface TranscribeOptions {
  language?: Language
  /** 逐词时间戳（karaoke 需要）；默认 false（逐句） */
  wordTimestamps?: boolean
  /** 说话人区分（实验性，默认关） */
  diarization?: boolean
  onProgress?: (p: Progress) => void
  signal?: AbortSignal
}

/** 引擎实例 */
export interface Engine {
  /** 输入支持 Blob / AudioBuffer / 16kHz 单声道 Float32Array */
  transcribe(
    input: Blob | AudioBuffer | Float32Array,
    opts?: TranscribeOptions,
  ): Promise<TranscribeResult>
  /** 取消当前识别 */
  cancel(): void
  /** 释放模型显存/内存 */
  dispose(): void
}

/** 模型元信息 */
export interface ModelInfo {
  id: ModelId
  /** HF 上的模型标识（Whisper 多语言） */
  hfId: string
  /** 估算体积（字节） */
  size: number
  /** 体积人类可读 */
  sizeLabel: string
  multilingual: boolean
  description: string
}

/** 模型缓存状态 */
export type ModelStatus = 'remote' | 'downloading' | 'cached'

/** Karaoke 高亮数据，供 UI 播放高亮 */
export interface KaraokeData {
  words: WordTimestamp[]
}

/** 能力检测结果 */
export interface Capabilities {
  webgpu: boolean
  wasm: boolean
  indexedDB: boolean
  mediaRecorder: boolean
  offscreen: boolean
}

/** 引擎创建选项 */
export interface EngineOptions {
  model: ModelId
  device?: Device
  onProgress?: (p: Progress) => void
}
