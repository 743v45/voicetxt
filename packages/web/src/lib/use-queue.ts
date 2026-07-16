import { useCallback, useEffect, useRef, useState } from 'react'
import { decodeAudio, resampleTo16kMono, getModelInfo } from '@voicetxt/core'
import type { ModelId, TranscribeOptions } from '@voicetxt/core'
import {
  loadTasks,
  saveTask,
  deleteTask,
  clearTasks,
  type QueueTask,
} from './queue-store'

const CONCURRENCY_KEY = 'voicetxt-concurrency'
const MAX_CONCURRENCY = 3

// 闲置自动回收：worker 完成任务后空闲超过此时长则 terminate（唯一能回收 wasm heap 的手段）
const IDLE_TIMEOUT_MS = 60_000
// dev 测试钩子：?idleTimeout=N（秒）下调自动回收超时便于测试；仅 DEV 生效
const idleTimeoutMs = import.meta.env.DEV
  ? Math.max(1, Number(new URLSearchParams(location.search).get('idleTimeout')) || IDLE_TIMEOUT_MS)
  : IDLE_TIMEOUT_MS

function loadConcurrency(): number {
  const v = Number(localStorage.getItem(CONCURRENCY_KEY))
  return v >= 1 && v <= MAX_CONCURRENCY ? v : 1
}

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

export interface QueueCounts {
  pending: number
  running: number
  done: number
  error: number
}

/** worker 池可见状态（浏览器无标准 API 测 worker wasm heap，故只暴露存活数） */
export interface PoolStats {
  total: number
  busy: number
  idle: number
  sherpa: boolean
}

export function useQueue() {
  const [tasks, setTasks] = useState<QueueTask[]>([])
  const [concurrency, setConcurrencyState] = useState<number>(loadConcurrency)
  const [paused, setPaused] = useState(false)

  // 同步引用，供调度/worker 回调读取最新值，避免闭包陈旧
  const tasksRef = useRef<QueueTask[]>([])
  const workersRef = useRef<Worker[]>([]) // whisper module worker 池
  const workerTaskRef = useRef<Map<Worker, string>>(new Map()) // whisper worker → task id
  const sherpaWorkerRef = useRef<Worker | null>(null) // sherpa classic worker（单）
  const sherpaBusyRef = useRef(false)
  const pausedRef = useRef(false)
  const concurrencyRef = useRef(concurrency)

  const [pool, setPool] = useState<PoolStats>({ total: 0, busy: 0, idle: 0, sherpa: false })
  const idleTimersRef = useRef<Map<Worker, ReturnType<typeof setTimeout>>>(new Map())

  useEffect(() => {
    tasksRef.current = tasks
  }, [tasks])
  useEffect(() => {
    pausedRef.current = paused
  }, [paused])
  useEffect(() => {
    concurrencyRef.current = concurrency
  }, [concurrency])

  /** 仅更新内存 state（轻量，进度频繁更新用这个，不写 IDB） */
  const patchTask = useCallback((id: string, patch: Partial<QueueTask>) => {
    setTasks((prev) => {
      const next = prev.map((t) => (t.id === id ? { ...t, ...patch } : t))
      tasksRef.current = next
      return next
    })
  }, [])

  /** 把某任务当前状态写入 IndexedDB（状态关键节点调用） */
  const persistTask = useCallback(async (id: string) => {
    const t = tasksRef.current.find((x) => x.id === id)
    if (t) await saveTask(t)
  }, [])

  // —— 启动加载（running → pending，重启续跑）——
  useEffect(() => {
    void (async () => {
      const loaded = (await loadTasks()).map((t) =>
        t.status === 'running'
          ? { ...t, status: 'pending' as const, progress: 0, startedAt: null }
          : t,
      )
      setTasks(loaded)
      tasksRef.current = loaded
    })()
  }, [])

  // —— worker 池内存回收：闲置计时器 + 状态重算 ——
  // recomputePool：把池存活/忙闲数同步到 UI state（在所有池结构变化点调用）
  const recomputePool = useCallback(() => {
    setPool((prev) => {
      const total = workersRef.current.length
      const busy = workerTaskRef.current.size
      const next = { total, busy, idle: total - busy, sherpa: sherpaWorkerRef.current != null }
      return prev.total === next.total &&
        prev.busy === next.busy &&
        prev.idle === next.idle &&
        prev.sherpa === next.sherpa
        ? prev
        : next
    })
  }, [])

  // clearIdleTimer：取消某 worker 的闲置计时（变 busy 或被移除时）
  const clearIdleTimer = useCallback((w: Worker) => {
    const t = idleTimersRef.current.get(w)
    if (t !== undefined) {
      clearTimeout(t)
      idleTimersRef.current.delete(w)
    }
  }, [])

  // armIdleTimer：worker 变 idle 时启动闲置计时，到期 terminate 该 worker（真正回收 wasm heap）
  const armIdleTimer = useCallback(
    (w: Worker) => {
      clearIdleTimer(w)
      const id = setTimeout(() => {
        // 防御二次校验：clear 可能调晚（回调已入队），此时 worker 可能已被分配为 busy
        if (workersRef.current.includes(w) && !workerTaskRef.current.has(w)) {
          w.terminate()
          workersRef.current = workersRef.current.filter((x) => x !== w)
          recomputePool()
        }
        // 无论是否 terminate 都清掉自己，防 map 泄漏
        idleTimersRef.current.delete(w)
      }, idleTimeoutMs)
      idleTimersRef.current.set(w, id)
    },
    [clearIdleTimer, recomputePool],
  )

  // —— Whisper Worker 创建（module worker，统一消息路由 by task id）——
  const createWorker = useCallback((): Worker => {
    const w = new Worker(
      new URL('../workers/transcribe.worker.ts', import.meta.url),
      { type: 'module' },
    )
    w.onmessage = (e: MessageEvent) => {
      const m = e.data
      if (m.type === 'progress') {
        patchTask(m.id, { progress: m.progress?.ratio ?? 0 })
      } else if (m.type === 'result') {
        const task = tasksRef.current.find((t) => t.id === m.id)
        const now = Date.now()
        const duration = task?.startedAt ? now - task.startedAt : null
        patchTask(m.id, {
          status: 'done',
          progress: 1,
          result: m.result,
          finishedAt: now,
          durationMs: duration,
        })
        void persistTask(m.id)
        workerTaskRef.current.delete(w)
        armIdleTimer(w)
        recomputePool()
      } else if (m.type === 'error') {
        patchTask(m.id, {
          status: 'error',
          error: m.message,
          errorDetail: m.errorDetail ?? null,
          finishedAt: Date.now(),
        })
        void persistTask(m.id)
        workerTaskRef.current.delete(w)
        armIdleTimer(w)
        recomputePool()
      }
    }
    return w
  }, [patchTask, persistTask, armIdleTimer, recomputePool])

  // —— Sherpa Worker 创建（classic worker，importScripts 加载 wasm）——
  const createSherpaWorker = useCallback((): Worker => {
    const w = new Worker(new URL('../workers/sherpa.worker.ts', import.meta.url), {
      type: 'classic',
    })
    w.onmessage = (e: MessageEvent) => {
      const m = e.data
      if (m.type === 'progress') {
        patchTask(m.id, { progress: m.progress?.ratio ?? 0 })
      } else if (m.type === 'result') {
        const task = tasksRef.current.find((t) => t.id === m.id)
        const now = Date.now()
        const duration = task?.startedAt ? now - task.startedAt : null
        patchTask(m.id, {
          status: 'done',
          progress: 1,
          result: m.result,
          finishedAt: now,
          durationMs: duration,
        })
        void persistTask(m.id)
        sherpaBusyRef.current = false
      } else if (m.type === 'error') {
        patchTask(m.id, {
          status: 'error',
          error: m.message,
          errorDetail: m.errorDetail ?? null,
          finishedAt: Date.now(),
        })
        void persistTask(m.id)
        sherpaBusyRef.current = false
      }
    }
    return w
  }, [patchTask, persistTask])

  // —— Whisper Worker 池随 concurrency 调整（增补；减时只回收 idle 的）——
  useEffect(() => {
    const ws = workersRef.current
    while (ws.length < concurrencyRef.current) ws.push(createWorker())
    const excess = ws.length - concurrencyRef.current
    if (excess > 0) {
      let removed = 0
      for (let i = ws.length - 1; i >= 0 && removed < excess; i--) {
        const w = ws[i]
        if (!workerTaskRef.current.has(w)) {
          clearIdleTimer(w)
          w.terminate()
          ws.splice(i, 1)
          removed++
        }
      }
    }
    recomputePool()
  }, [concurrency, createWorker, clearIdleTimer, recomputePool])

  // —— Whisper 任务执行（主线程解码 + 重采样 → 传 module worker 推理）——
  const runTask = useCallback(
    async (task: QueueTask, worker: Worker) => {
      workerTaskRef.current.set(worker, task.id)
      clearIdleTimer(worker)
      recomputePool()
      patchTask(task.id, {
        status: 'running',
        startedAt: Date.now(),
        progress: 0,
        error: null,
      })
      try {
        if (!task.blob) throw new Error('音频已清理，无法识别')
        const samples = await resampleTo16kMono(await decodeAudio(task.blob))
        worker.postMessage(
          { type: 'transcribe', id: task.id, model: task.model, input: samples, opts: task.opts },
          [samples.buffer],
        )
      } catch (e) {
        console.error('[queue] decode/launch error:', e)
        patchTask(task.id, {
          status: 'error',
          error: e instanceof Error ? e.message : String(e),
          finishedAt: Date.now(),
        })
        void persistTask(task.id)
        workerTaskRef.current.delete(worker)
        armIdleTimer(worker)
        recomputePool()
      }
    },
    [patchTask, persistTask, clearIdleTimer, armIdleTimer, recomputePool],
  )

  // —— Sherpa 任务执行（单 classic worker，串行）——
  const runSherpaTask = useCallback(
    async (task: QueueTask) => {
      if (!sherpaWorkerRef.current) {
        sherpaWorkerRef.current = createSherpaWorker()
      }
      const worker = sherpaWorkerRef.current
      sherpaBusyRef.current = true
      patchTask(task.id, {
        status: 'running',
        startedAt: Date.now(),
        progress: 0,
        error: null,
      })
      try {
        if (!task.blob) throw new Error('音频已清理，无法识别')
        const samples = await resampleTo16kMono(await decodeAudio(task.blob))
        worker.postMessage(
          { type: 'transcribe', id: task.id, input: samples, opts: task.opts },
          [samples.buffer],
        )
      } catch (e) {
        console.error('[queue] sherpa decode/launch error:', e)
        patchTask(task.id, {
          status: 'error',
          error: e instanceof Error ? e.message : String(e),
          finishedAt: Date.now(),
        })
        void persistTask(task.id)
        sherpaBusyRef.current = false
      }
    },
    [createSherpaWorker, patchTask, persistTask],
  )

  // —— 调度：sherpa 任务（单 worker 串行）+ whisper 任务（弹性补池 + 每轮分配一个）——
  const schedule = useCallback(() => {
    const isSherpa = (t: QueueTask) => getModelInfo(t.model).engine === 'sherpa'
    // sherpa：idle 时取一个 sherpa pending
    if (!sherpaBusyRef.current) {
      const sherpaNext = tasksRef.current.find((t) => t.status === 'pending' && isSherpa(t))
      if (sherpaNext) {
        void runSherpaTask(sherpaNext)
        return
      }
    }
    // whisper 弹性补池：按 min(并发, 待处理数) 建够 worker（只建 worker，可循环）
    const whisperPending = tasksRef.current.filter(
      (t) => t.status === 'pending' && !isSherpa(t),
    ).length
    const target = Math.min(concurrencyRef.current, whisperPending)
    while (workersRef.current.length < target) {
      workersRef.current.push(createWorker())
    }
    recomputePool()
    // 分配：池内取 idle worker + 一个 whisper pending（每轮一个，禁止循环，防同任务双发）
    if (workerTaskRef.current.size >= concurrencyRef.current) return
    const idle = workersRef.current.find((w) => !workerTaskRef.current.has(w))
    if (!idle) return
    const whisperNext = tasksRef.current.find(
      (t) => t.status === 'pending' && !isSherpa(t),
    )
    if (!whisperNext) return
    void runTask(whisperNext, idle)
  }, [createWorker, runSherpaTask, runTask, recomputePool])

  useEffect(() => {
    if (paused) return
    schedule()
  }, [tasks, paused, concurrency, schedule])

  // —— 手动释放内存：terminate 所有 idle whisper worker + 非忙 sherpa（busy 保留）——
  const releaseMemory = useCallback(() => {
    let released = 0
    for (let i = workersRef.current.length - 1; i >= 0; i--) {
      const w = workersRef.current[i]
      if (!workerTaskRef.current.has(w)) {
        clearIdleTimer(w)
        w.terminate()
        workersRef.current.splice(i, 1)
        released++
      }
    }
    if (sherpaWorkerRef.current && !sherpaBusyRef.current) {
      sherpaWorkerRef.current.terminate()
      sherpaWorkerRef.current = null
      released++
    }
    recomputePool()
    // 未暂停时才补池重分配，避免在 paused 下启动任务
    if (!pausedRef.current) schedule()
    return released
  }, [clearIdleTimer, recomputePool, schedule])

  // —— 对外 API ——
  const addTask = useCallback(
    async (blob: Blob, name: string, model: ModelId, opts: TranscribeOptions) => {
      const task: QueueTask = {
        id: genId(),
        name,
        blob,
        model,
        opts,
        status: 'pending',
        progress: 0,
        result: null,
        error: null,
        addedAt: Date.now(),
        startedAt: null,
        finishedAt: null,
        durationMs: null,
      }
      setTasks((prev) => {
        const next = [...prev, task]
        tasksRef.current = next
        return next
      })
      await saveTask(task)
    },
    [],
  )

  const retryTask = useCallback(
    async (id: string) => {
      patchTask(id, {
        status: 'pending',
        progress: 0,
        error: null,
        result: null,
        startedAt: null,
        finishedAt: null,
        durationMs: null,
      })
      await persistTask(id)
    },
    [patchTask, persistTask],
  )

  const removeTask = useCallback(async (id: string) => {
    setTasks((prev) => {
      const next = prev.filter((t) => t.id !== id)
      tasksRef.current = next
      return next
    })
    await deleteTask(id)
  }, [])

  const clearAudio = useCallback(
    async (id: string) => {
      patchTask(id, { blob: null })
      await persistTask(id)
    },
    [patchTask, persistTask],
  )

  const clearAll = useCallback(async () => {
    setTasks([])
    tasksRef.current = []
    await clearTasks()
  }, [])

  const setConcurrency = useCallback((n: number) => {
    const v = Math.max(1, Math.min(MAX_CONCURRENCY, Math.round(n)))
    setConcurrencyState(v)
    localStorage.setItem(CONCURRENCY_KEY, String(v))
  }, [])

  const togglePause = useCallback(() => setPaused((p) => !p), [])

  // 卸载时清理 worker 与闲置计时器
  useEffect(
    () => () => {
      idleTimersRef.current.forEach((t) => clearTimeout(t))
      idleTimersRef.current.clear()
      workersRef.current.forEach((w) => w.terminate())
      workersRef.current = []
      sherpaWorkerRef.current?.terminate()
      sherpaWorkerRef.current = null
    },
    [],
  )

  const counts: QueueCounts = {
    pending: tasks.filter((t) => t.status === 'pending').length,
    running: tasks.filter((t) => t.status === 'running').length,
    done: tasks.filter((t) => t.status === 'done').length,
    error: tasks.filter((t) => t.status === 'error').length,
  }

  const hasActive = counts.pending > 0 || counts.running > 0

  return {
    tasks,
    concurrency,
    paused,
    counts,
    hasActive,
    pool,
    addTask,
    retryTask,
    removeTask,
    clearAudio,
    clearAll,
    setConcurrency,
    togglePause,
    releaseMemory,
  }
}
