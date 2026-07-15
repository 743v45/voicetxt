/// <reference lib="webworker" />
import { createEngine } from '@voicetxt/core'
import type { ModelId, TranscribeOptions } from '@voicetxt/core'

// 简化协议：每次 transcribe 新建 engine（模型权重走缓存，复用快），用完释放。
// 主线程 → { type:'transcribe', id, model, input, opts }
// Worker  → { type:'progress', id, progress } | { type:'result', id, result } | { type:'error', id, message }
self.onmessage = async (e: MessageEvent) => {
  const data = e.data
  if (data?.type !== 'transcribe') return
  const { id, model, input, opts } = data as {
    id: number
    model: ModelId
    input: Float32Array // 主线程已解码并重采样到 16kHz 单声道
    opts?: TranscribeOptions
  }

  const post = (msg: unknown) => (self as unknown as Worker).postMessage(msg)
  try {
    const engine = await createEngine({ model })
    const result = await engine.transcribe(input, {
      ...opts,
      onProgress: (p) => post({ type: 'progress', id, progress: p }),
    })
    post({ type: 'result', id, result })
    engine.dispose()
  } catch (err) {
    console.error('[transcribe.worker] error:', err)
    const raw = err instanceof Error ? err.message : String(err)
    const stack = err instanceof Error && err.stack ? err.stack : ''
    let message = raw
    // 识别 onnxruntime 内存分配失败，给友好提示
    if (/allocate|create a session|out of memory|heap/i.test(raw)) {
      message =
        '内存不足（浏览器 WASM 限制）：大模型(small/medium)或多并发易超内存。请换 base/tiny，或把并发设为 1 后重试。'
    }
    post({
      type: 'error',
      id,
      message,
      errorDetail: [raw, stack].filter(Boolean).join('\n'),
    })
  }
}
