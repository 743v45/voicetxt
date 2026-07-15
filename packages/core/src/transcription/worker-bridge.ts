// Worker 桥：定义主线程 ↔ Worker 消息协议，并提供可在 Worker 入口复用的处理函数。
// web 侧的 worker 文件（packages/web/src/workers/transcribe.worker.ts）调用 runWorkerBridge。

import type {
  Engine,
  EngineOptions,
  TranscribeOptions,
  TranscribeResult,
  Progress,
} from '../types'
import { createTranscriptionEngine } from './index'

export type WorkerRequest =
  | { type: 'init'; id: number; opts: EngineOptions }
  | { type: 'transcribe'; id: number; input: Blob; opts?: TranscribeOptions }
  | { type: 'cancel'; id: number }
  | { type: 'dispose'; id: number }

export type WorkerResponse =
  | { type: 'ready'; id: number }
  | { type: 'progress'; id: number; progress: Progress }
  | { type: 'result'; id: number; result: TranscribeResult }
  | { type: 'error'; id: number; message: string }

interface BridgeState {
  engine: Engine | null
  opts: EngineOptions | null
}

/**
 * 在 Worker 内运行：接收消息、维护 engine 实例、回传进度与结果。
 * 用法（worker 入口）：
 *   import { runWorkerBridge } from '@voicetxt/core'
 *   runWorkerBridge(self as any)
 */
export function runWorkerBridge(worker: {
  addEventListener: (t: 'message', fn: (e: MessageEvent) => void) => void
  postMessage: (m: WorkerResponse) => void
}): void {
  const sessions = new Map<number, BridgeState>()

  worker.addEventListener('message', async (e: MessageEvent) => {
    const msg = e.data as WorkerRequest
    if (!msg || typeof msg !== 'object') return
    const id = msg.id

    try {
      if (msg.type === 'init') {
        const engine = await createTranscriptionEngine(msg.opts)
        sessions.set(id, { engine, opts: msg.opts })
        worker.postMessage({ type: 'ready', id })
        return
      }

      const state = sessions.get(id)
      if (!state?.engine) {
        worker.postMessage({ type: 'error', id, message: '引擎未初始化，请先 init' })
        return
      }

      if (msg.type === 'transcribe') {
        const result = await state.engine.transcribe(msg.input, {
          ...msg.opts,
          onProgress: (progress) => worker.postMessage({ type: 'progress', id, progress }),
        })
        worker.postMessage({ type: 'result', id, result })
      } else if (msg.type === 'cancel') {
        state.engine.cancel()
      } else if (msg.type === 'dispose') {
        state.engine.dispose()
        sessions.delete(id)
      }
    } catch (err) {
      worker.postMessage({
        type: 'error',
        id,
        message: err instanceof Error ? err.message : String(err),
      })
    }
  })
}

// 导出类型，便于 web 侧 worker 文件引用
export type { Engine }
