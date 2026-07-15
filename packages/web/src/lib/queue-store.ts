// 队列任务持久化（IndexedDB）。
// 任务记录含：模型、选项、字幕结果、状态/进度、各时间戳、原始音频 blob（可清理）。
// 重启浏览器后恢复；重启前处于 running 的由 use-queue 回退为 pending。

import type { ModelId, TranscribeOptions, TranscribeResult } from '@voicetxt/core'

export type TaskStatus = 'pending' | 'running' | 'done' | 'error'

export interface QueueTask {
  id: string
  name: string
  /** 原始音频；清理音频后置 null（字幕结果保留） */
  blob: Blob | null
  model: ModelId
  opts: TranscribeOptions
  status: TaskStatus
  /** 识别进度 0-1 */
  progress: number
  result: TranscribeResult | null
  error: string | null
  /** 任务添加时间（ms 时间戳） */
  addedAt: number
  /** 开始执行时间 */
  startedAt: number | null
  /** 完成时间 */
  finishedAt: number | null
  /** 处理耗时（ms） */
  durationMs: number | null
}

const DB_NAME = 'voicetxt-tasks'
const STORE = 'tasks'
const DB_VER = 1

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('当前环境不支持 IndexedDB'))
  }
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VER)
      req.onupgradeneeded = () => {
        req.result.createObjectStore(STORE, { keyPath: 'id' })
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  }
  return dbPromise
}

/** 读取全部任务，按添加时间升序 */
export async function loadTasks(): Promise<QueueTask[]> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const r = tx.objectStore(STORE).getAll()
    r.onsuccess = () => {
      const tasks = (r.result as QueueTask[]).sort((a, b) => a.addedAt - b.addedAt)
      resolve(tasks)
    }
    r.onerror = () => reject(r.error)
  })
}

/** 新增或更新任务（按 id 覆盖） */
export async function saveTask(task: QueueTask): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(task)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function deleteTask(id: string): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function clearTasks(): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).clear()
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}
