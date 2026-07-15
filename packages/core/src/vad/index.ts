// voicetxt 语音活动检测（VAD）模块。
// 导出 detectSpeechSegments：供 transcription 实时模式动态 import，名字固定。
//
// 策略：优先尝试 @huggingface/transformers 的 silero-vad（精度高，需在线/已缓存）；
// 加载失败或不支持时回退能量阈值法（纯本地，保证离线可用）。

/** 语音段区间（秒） */
export interface VadSegment {
  start: number
  end: number
}

/** 检测选项 */
export interface DetectSpeechSegmentsOptions {
  /** 能量阈值：RMS 高于此值视为语音（能量法默认 0.02）；silero 时作为语音概率阈值（默认 0.5） */
  threshold?: number
  /** 最短段长（秒），短于此的段被丢弃，默认 0.5 */
  minSegmentSec?: number
  /** 相邻段间隔小于此值则合并（秒），默认 0.3 */
  padSec?: number
}

/**
 * 由布尔窗口序列（每窗是否含语音）合并出最终语音段。
 * 能量法与 silero 法共用此逻辑。
 *
 * 步骤：
 * 1. 连续语音窗口合并成原始段 [startIdx, endIdx)
 * 2. 间隔 < padSec 的相邻段合并
 * 3. 丢弃时长 < minSegmentSec 的段
 *
 * @param flags 每个窗口是否含语音
 * @param winSec 单个窗口时长（秒）
 * @param totalSec 音频总时长（秒），用于尾部 end 兜底
 */
function flagWindowsToSegments(
  flags: boolean[],
  winSec: number,
  totalSec: number,
  minSegmentSec: number,
  padSec: number,
): VadSegment[] {
  // 1) 连续语音窗口 -> 原始段
  const ranges: Array<[number, number]> = []
  let s = -1
  for (let i = 0; i < flags.length; i++) {
    if (flags[i]) {
      if (s === -1) s = i
    } else if (s !== -1) {
      ranges.push([s, i])
      s = -1
    }
  }
  if (s !== -1) ranges.push([s, flags.length])

  const raw: VadSegment[] = ranges.map(([a, b]) => ({
    start: a * winSec,
    end: Math.min(b * winSec, totalSec),
  }))

  // 2) 合并间隔 < padSec 的相邻段
  const merged: VadSegment[] = []
  for (const seg of raw) {
    const last = merged[merged.length - 1]
    if (last && seg.start - last.end < padSec) {
      last.end = seg.end
    } else {
      merged.push({ start: seg.start, end: seg.end })
    }
  }

  // 3) 丢弃过短段
  return merged.filter((seg) => seg.end - seg.start >= minSegmentSec)
}

/**
 * 能量阈值法 VAD（离线兜底，纯本地，可测试）。
 *
 * 对 samples 滑窗（默认 30ms）计算 RMS，连续高于 threshold 视为语音段；
 * 合并间隔 < padSec 的相邻段，丢弃短于 minSegmentSec 的段。
 */
export function detectSpeechSegmentsByEnergy(
  samples: Float32Array,
  sampleRate: number,
  opts: DetectSpeechSegmentsOptions = {},
): VadSegment[] {
  const threshold = opts.threshold ?? 0.02
  const minSegmentSec = opts.minSegmentSec ?? 0.5
  const padSec = opts.padSec ?? 0.3
  if (samples.length === 0 || sampleRate <= 0) return []

  const win = Math.max(1, Math.round(0.03 * sampleRate)) // 30ms 窗口
  const winSec = win / sampleRate
  const totalSec = samples.length / sampleRate

  // 滑窗算 RMS，标记每个窗口
  const flags: boolean[] = []
  for (let i = 0; i < samples.length; i += win) {
    const end = Math.min(i + win, samples.length)
    let sumSq = 0
    for (let j = i; j < end; j++) sumSq += samples[j] * samples[j]
    const n = end - i
    const rms = n > 0 ? Math.sqrt(sumSq / n) : 0
    flags.push(rms > threshold)
  }

  return flagWindowsToSegments(flags, winSec, totalSec, minSegmentSec, padSec)
}

/**
 * 尝试 silero-vad 推理。返回 null 表示不可用（调用方回退能量法）。
 * silero-vad 严格要求 16kHz 单声道；其余采样率直接回退。
 *
 * 注：真实推理需从 HuggingFace 下载 'onnx-community/silero-vad' 模型；
 * 无网络 / 未缓存时 pipeline 抛错，此处捕获并返回 null。
 */
async function trySileroVad(
  samples: Float32Array,
  sampleRate: number,
  opts: DetectSpeechSegmentsOptions,
): Promise<VadSegment[] | null> {
  // silero-vad 固定 16kHz，不在此重采样（输入按引擎契约应为 16kHz 单声道）
  if (sampleRate !== 16000) return null

  const threshold = opts.threshold ?? 0.5 // silero 语音概率阈值
  const minSegmentSec = opts.minSegmentSec ?? 0.5
  const padSec = opts.padSec ?? 0.3

  // 动态 import，失败则回退（离线环境无此模块时）
  const mod = (await import('@huggingface/transformers').catch(() => null)) as
    | { pipeline?: unknown }
    | null
  if (!mod?.pipeline) return null

  let classifier: (audio: unknown) => Promise<unknown>
  try {
    classifier = (await (
      mod.pipeline as (
        task: string,
        model: string,
      ) => Promise<(audio: unknown) => Promise<unknown>>
    )('audio-classification', 'onnx-community/silero-vad')) as (
      audio: unknown,
    ) => Promise<unknown>
  } catch {
    // 模型加载失败（无网络 / 未缓存）-> 回退
    return null
  }

  // silero 固定 512 样本上下文（16kHz 下约 32ms）
  const winSize = 512
  const winSec = winSize / sampleRate
  const totalSec = samples.length / sampleRate

  // 构造滑窗（512 样本步进，无重叠）
  const windows: Float32Array[] = []
  for (let i = 0; i + winSize <= samples.length; i += winSize) {
    windows.push(samples.subarray(i, i + winSize))
  }
  if (windows.length === 0) return []

  // 分批推理，避免一次性输入过长导致内存暴涨
  const batchSize = 32
  const flags: boolean[] = []
  for (let i = 0; i < windows.length; i += batchSize) {
    const chunk = windows.slice(i, i + batchSize)
    const out = (await classifier(chunk)) as
      | Array<Array<{ label: string; score: number }>>
      | Array<{ label: string; score: number }>
    // 单输入返回单结果数组，多输入返回数组的数组 -> 归一化为数组的数组
    const results: Array<Array<{ label: string; score: number }>> = Array.isArray(
      out,
    )
      ? out.length > 0 && Array.isArray(out[0])
        ? (out as Array<Array<{ label: string; score: number }>>)
        : [out as Array<{ label: string; score: number }>]
      : []
    for (const res of results) {
      const prob = res.find((r) => r.label === 'SPEECH')?.score ?? 0
      flags.push(prob > threshold)
    }
  }

  return flagWindowsToSegments(flags, winSec, totalSec, minSegmentSec, padSec)
}

/**
 * 检测语音段。优先 silero-vad，失败 / 不支持时回退能量阈值法。
 *
 * @param samples 16kHz 单声道 PCM（Float32Array，[-1,1]）
 * @param sampleRate 采样率
 * @param opts 检测选项
 * @returns 语音段区间数组（秒，升序）
 */
export async function detectSpeechSegments(
  samples: Float32Array,
  sampleRate: number,
  opts?: DetectSpeechSegmentsOptions,
): Promise<VadSegment[]> {
  // 先试 silero-vad；任何异常都回退能量法
  try {
    const silero = await trySileroVad(samples, sampleRate, opts ?? {})
    if (silero !== null) return silero
  } catch {
    // 保守起见：silero 路径任何未预期异常都回退
  }
  return detectSpeechSegmentsByEnergy(samples, sampleRate, opts ?? {})
}
