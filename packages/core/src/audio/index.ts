// 音频预处理模块：纯浏览器 Web Audio API 实现，零额外依赖。
// 提供解码 / 重采样到 16kHz 单声道 / 从视频提音轨 / 按片切片四项能力，
// 供 transcription 模块（Whisper）消费。Whisper 输入规范：16kHz 单声道 PCM。

/**
 * 解码任意音频格式的 Blob 为 AudioBuffer。
 * 用 `new AudioContext()` 的 `decodeAudioData` 解码；解码完即 close context 释放资源。
 *
 * 注意：依赖浏览器 Web Audio API，Node 环境下不可用（无 AudioContext）。
 */
export async function decodeAudio(blob: Blob): Promise<AudioBuffer> {
  const Ctor = getAudioContextCtor()
  const ctx = new Ctor()
  try {
    const arrayBuffer = await blob.arrayBuffer()
    return await ctx.decodeAudioData(arrayBuffer)
  } finally {
    // 用完即关，避免泄漏底层音频资源
    await ctx.close()
  }
}

/**
 * 将 AudioBuffer 重采样为 16kHz 单声道 Float32Array（Whisper 输入规范）。
 * 用离屏 OfflineAudioContext（1 通道 / 16kHz）渲染后取第 0 通道。
 *
 * ⚠️ 签名偏离：契约原文为同步 `Float32Array`，但 Web Audio 规范中
 * `OfflineAudioContext.startRendering()` 强制异步（返回 Promise），
 * 不存在同步重采样 API；故此处返回 `Promise<Float32Array>`。这是唯一正确实现。
 *
 * 注意：依赖浏览器 Web Audio API，Node 环境下不可用。
 */
export async function resampleTo16kMono(
  buffer: AudioBuffer,
): Promise<Float32Array> {
  const targetRate = 16000
  // 目标样本数；duration * 16000，向上取整，并保证至少 1 个样本
  const length = Math.max(1, Math.ceil(buffer.duration * targetRate))
  // 单声道离屏上下文：渲染时自动重采样 + 下混到 mono
  const offline = new OfflineAudioContext(1, length, targetRate)
  const source = offline.createBufferSource()
  source.buffer = buffer
  source.connect(offline.destination)
  source.start(0)
  // startRendering 是异步的（Web Audio 规范），故返回 Promise<Float32Array>
  const rendered = await offline.startRendering()
  return rendered.getChannelData(0)
}

/**
 * 从视频 Blob 提取音轨为 AudioBuffer。
 * 优先直接 `decodeAudioData`（多数 mp4/mov/webm 的音轨可直接解码），
 * 失败则兜底用 `<video>` 元素 + `MediaElementAudioSourceNode` 抓音轨再解码。
 *
 * 注意：兜底分支依赖浏览器 DOM / MediaRecorder，Node 环境下不可用。
 */
export async function extractAudioTrack(videoBlob: Blob): Promise<AudioBuffer> {
  // 优先：多数视频容器的音轨可直接被 decodeAudioData 解码
  try {
    return await decodeAudio(videoBlob)
  } catch {
    // 兜底：通过 <video> + Web Audio 抓音轨再解码
    return extractAudioViaMediaElement(videoBlob)
  }
}

/**
 * sliceAudio 的可选项。
 */
export interface SliceAudioOptions {
  /** 采样率，默认 16000 */
  sampleRate?: number
  /** 单片时长（秒），默认 30 */
  chunkSeconds?: number
  /** 相邻片重叠时长（秒），默认 1（防切断词） */
  overlapSeconds?: number
}

/**
 * 切片结果：起止秒数 + 对应样本子数组（subarray 视图，零拷贝）。
 */
export interface AudioSlice {
  /** 起始秒 */
  start: number
  /** 结束秒 */
  end: number
  /** 该片样本（Float32Array 视图） */
  data: Float32Array
}

/**
 * 按 chunk 切分 PCM 样本，相邻片带 overlap 防止切断词。
 * 纯函数，不依赖任何浏览器 API，可在 Node 环境直接单测。
 *
 * - 默认 sampleRate=16000 / chunkSeconds=30 / overlapSeconds=1
 * - 步长 = 片长 - 重叠；用 subarray 返回零拷贝视图
 * - 末片可能短于片长；overlap 不会越界（end 用 min 钳制）
 */
export function sliceAudio(
  samples: Float32Array,
  opts?: SliceAudioOptions,
): AudioSlice[] {
  const sampleRate = opts?.sampleRate ?? 16000
  const chunkSeconds = opts?.chunkSeconds ?? 30
  const overlapSeconds = opts?.overlapSeconds ?? 1

  // 各尺寸换算成样本数（取整避免浮点漂移）
  const chunkSize = Math.max(1, Math.round(sampleRate * chunkSeconds))
  const overlapSize = Math.max(0, Math.round(sampleRate * overlapSeconds))
  // 步长 = 片长 - 重叠；保证至少前进 1 个样本，避免 overlap >= 片长时死循环
  const step = Math.max(1, chunkSize - overlapSize)

  const total = samples.length
  const result: AudioSlice[] = []
  if (total === 0) return result // 空输入直接返回空数组

  let start = 0
  while (start < total) {
    // end 用 min 钳制，保证 overlap/末片都不越界
    const end = Math.min(start + chunkSize, total)
    result.push({
      start: start / sampleRate,
      end: end / sampleRate,
      data: samples.subarray(start, end), // 零拷贝视图
    })
    if (end >= total) break // 已覆盖到末尾，结束
    start += step // 前进一个步长
  }
  return result
}

// —— 内部辅助 ——

/** 取得 AudioContext 构造器（兼容旧 Safari 的 webkitAudioContext）。 */
function getAudioContextCtor(): typeof AudioContext {
  const g = globalThis as unknown as {
    AudioContext?: typeof AudioContext
    webkitAudioContext?: typeof AudioContext
  }
  const Ctor = g.AudioContext || g.webkitAudioContext
  if (!Ctor) {
    throw new Error('当前环境不支持 Web Audio API（AudioContext 不可用）')
  }
  return Ctor
}

/**
 * 兜底：用 <video> + MediaElementAudioSourceNode 抓取视频音轨再解码。
 * 仅在 decodeAudioData 解码失败时走此分支；属浏览器 best-effort 路径。
 */
async function extractAudioViaMediaElement(videoBlob: Blob): Promise<AudioBuffer> {
  const url = URL.createObjectURL(videoBlob)
  const video = document.createElement('video')
  video.src = url
  video.crossOrigin = 'anonymous'
  video.preload = 'auto'

  // 等待视频元数据加载
  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve()
    video.onerror = () => reject(new Error('无法加载视频元数据'))
  })

  const Ctor = getAudioContextCtor()
  const ctx = new Ctor()
  try {
    const sourceNode = ctx.createMediaElementSource(video)
    const dest = ctx.createMediaStreamDestination()
    sourceNode.connect(dest)
    // 不连接到 ctx.destination，避免播放出声

    const recorder = new MediaRecorder(dest.stream)
    const chunks: BlobPart[] = []
    recorder.ondataavailable = (ev) => {
      if (ev.data.size > 0) chunks.push(ev.data)
    }
    const stopped = new Promise<void>((resolve, reject) => {
      recorder.onstop = () => resolve()
      recorder.onerror = () => reject(new Error('录制音轨失败'))
    })

    recorder.start()
    // 播放以驱动音频流；autoplay 策略可能阻止，不阻塞流程
    video.play().catch(() => {
      /* 自动播放可能被阻止，忽略；部分环境仍能驱动音轨 */
    })
    await new Promise<void>((resolve) => {
      video.onended = () => resolve()
    })
    recorder.stop()
    await stopped

    const audioBlob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' })
    const arrayBuffer = await audioBlob.arrayBuffer()
    return await ctx.decodeAudioData(arrayBuffer)
  } finally {
    URL.revokeObjectURL(url)
    await ctx.close()
  }
}
