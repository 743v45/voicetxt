import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  ModelId,
  Progress,
  TranscribeOptions,
  TranscribeResult,
} from '@voicetxt/core'

type Pending = {
  resolve: (r: TranscribeResult) => void
  reject: (e: Error) => void
} | null

/** 管理转录 Worker：发任务、收进度/结果、取消。 */
export function useTranscribe() {
  const workerRef = useRef<Worker | null>(null)
  const idRef = useRef(0)
  const pendingRef = useRef<Pending>(null)

  const [progress, setProgress] = useState<Progress | null>(null)
  const [result, setResult] = useState<TranscribeResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const ensureWorker = useCallback(() => {
    if (!workerRef.current) {
      workerRef.current = new Worker(
        new URL('../workers/transcribe.worker.ts', import.meta.url),
        { type: 'module' },
      )
      workerRef.current.onmessage = (e: MessageEvent) => {
        const m = e.data
        if (m.type === 'progress') {
          setProgress(m.progress)
        } else if (m.type === 'result') {
          setResult(m.result)
          setBusy(false)
          setProgress(null)
          pendingRef.current?.resolve(m.result)
          pendingRef.current = null
        } else if (m.type === 'error') {
          setError(m.message)
          setBusy(false)
          setProgress(null)
          pendingRef.current?.reject(new Error(m.message))
          pendingRef.current = null
        }
      }
    }
    return workerRef.current
  }, [])

  const transcribe = useCallback(
    async (model: ModelId, input: Blob, opts?: TranscribeOptions) => {
      setBusy(true)
      setError(null)
      setProgress(null)
      setResult(null)
      const w = ensureWorker()
      const id = ++idRef.current
      return new Promise<TranscribeResult>((resolve, reject) => {
        pendingRef.current = { resolve, reject }
        w.postMessage({ type: 'transcribe', id, model, input, opts })
      })
    },
    [ensureWorker],
  )

  const cancel = useCallback(() => {
    workerRef.current?.terminate()
    workerRef.current = null
    setBusy(false)
    setProgress(null)
    pendingRef.current?.reject(new Error('已取消'))
    pendingRef.current = null
  }, [])

  useEffect(
    () => () => {
      workerRef.current?.terminate()
    },
    [],
  )

  return { transcribe, cancel, progress, result, error, busy, setResult, setError }
}
