// core/transcription：transformers.js + Whisper 封装。
// 推理应由调用方放在 Web Worker 中执行（见 ./worker-bridge）。

import { pipeline, env } from '@huggingface/transformers'
import type {
  Engine,
  EngineOptions,
  TranscribeOptions,
  TranscribeResult,
  Segment,
  WordTimestamp,
} from '../types'
import { getModelInfo } from '../models'
import { decodeAudio, resampleTo16kMono } from '../audio'

env.allowLocalModels = false // 走 Hugging Face CDN

function pickDevice(opts: EngineOptions): 'webgpu' | 'wasm' {
  if (opts.device) return opts.device
  // 默认 WASM（CPU）：transformers.js 的 Whisper 在 WebGPU 后端对部分模型/GPU
  // 会输出乱码，且无 GPU 适配器时直接报 "no available backend found"。
  // WASM 质量稳定可靠（慢于 WebGPU，但不乱码）。
  return 'wasm'
}

/** 把 word 级时间戳聚合成句子级 segments（按停顿分组），供 SRT/VTT 使用。 */
function aggregateWordsToSegments(words: WordTimestamp[]): Segment[] {
  const segments: Segment[] = []
  let cur: Segment | null = null
  const GAP = 0.5 // 秒
  for (const w of words) {
    const text = w.word ?? ''
    if (!cur || (cur.end !== undefined && w.start - cur.end > GAP)) {
      cur = { start: w.start, end: w.end, text }
      segments.push(cur)
    } else {
      cur.text += text
      cur.end = w.end
    }
  }
  return segments
}

export async function createTranscriptionEngine(opts: EngineOptions): Promise<Engine> {
  const info = getModelInfo(opts.model)
  const device = pickDevice(opts)

  // 量化策略：仅 medium 用 q4（约一半内存，更可能在 WASM 跑通）；其余 q8（质量优先）
  const dtype = opts.model === 'medium' ? 'q4' : 'q8'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const transcriber: any = await pipeline('automatic-speech-recognition', info.hfId, {
    device,
    dtype,
  })

  let aborted = false

  async function run(
    input: Blob | AudioBuffer | Float32Array,
    topts?: TranscribeOptions,
  ): Promise<TranscribeResult> {
    aborted = false
    if (topts?.signal?.aborted) throw new DOMException('Aborted', 'AbortError')

    // 输入归一化到 16kHz 单声道 Float32Array
    let samples: Float32Array
    if (input instanceof Blob) {
      const buf = await decodeAudio(input)
      samples = await resampleTo16kMono(buf)
    } else if (typeof AudioBuffer !== 'undefined' && input instanceof AudioBuffer) {
      samples = await resampleTo16kMono(input)
    } else {
      samples = input as Float32Array
    }

    if (topts?.signal?.aborted) throw new DOMException('Aborted', 'AbortError')

    const wantWords = !!topts?.wordTimestamps
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out: any = await (transcriber as any)(samples, {
      language: topts?.language && topts.language !== 'auto' ? topts.language : undefined,
      task: 'transcribe',
      return_timestamps: wantWords ? 'word' : true,
      chunk_length_s: 30,
      stride_length_s: 5,
      // 抑制 Whisper 幻觉：禁止用上一窗口的文本作为下一窗口的提示，
      // 否则一旦某段产生幻觉/重复，会"种子化"后续窗口，级联出
      // 同 token 重复（如 "col deadareaingu col deadareaingu..."）与多语言乱词。
      condition_on_previous_text: false,
      callback: () => {
        if (aborted) throw new DOMException('Aborted', 'AbortError')
      },
    })

    if (aborted) throw new DOMException('Aborted', 'AbortError')

    // 映射 transformers.js 输出 → TranscribeResult
    let words: WordTimestamp[] | undefined
    let segments: Segment[]

    if (wantWords) {
      // word 级：chunks 为词
      const chunks = Array.isArray(out?.chunks) ? out.chunks : []
      words = chunks.map(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (c: any) => ({
          word: String(c.text ?? '').trim(),
          start: c.timestamp?.[0] ?? 0,
          end: c.timestamp?.[1] ?? c.timestamp?.[0] ?? 0,
          score: typeof c.score === 'number' ? c.score : undefined,
        }),
      )
      segments = aggregateWordsToSegments(words ?? [])
    } else {
      // 句子级：chunks 为段
      const chunks = Array.isArray(out?.chunks) ? out.chunks : []
      segments = chunks.map(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (c: any) => ({
          start: c.timestamp?.[0] ?? 0,
          end: c.timestamp?.[1] ?? c.timestamp?.[0] ?? 0,
          text: String(c.text ?? '').trim(),
        }),
      )
      if (segments.length === 0 && out?.text) {
        segments = [{ start: 0, end: 0, text: String(out.text) }]
      }
    }

    return {
      text: String(out?.text ?? segments.map((s) => s.text).join('')),
      segments,
      words,
      language: String(out?.language ?? topts?.language ?? 'unknown'),
    }
  }

  return {
    transcribe: run,
    cancel() {
      aborted = true
    },
    dispose() {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(transcriber as any)?.dispose?.()
    },
  }
}
