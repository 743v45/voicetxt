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
    input: Blob
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
    post({
      type: 'error',
      id,
      message: err instanceof Error ? err.message : String(err),
    })
  }
}
