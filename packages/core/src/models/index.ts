// core/models：模型注册表 + 缓存管理。
// 自有 IndexedDB store 记录「已成功下载」标记；transformers.js 实际模型权重走浏览器 Cache API。

import type { ModelId, ModelInfo, ModelStatus } from '../types'

export const MODEL_REGISTRY: ModelInfo[] = [
  {
    id: 'tiny',
    hfId: 'Xenova/whisper-tiny',
    size: 78_643_200,
    sizeLabel: '75 MB',
    multilingual: true,
    description: '最快，质量最低，适合实时预览',
  },
  {
    id: 'base',
    hfId: 'Xenova/whisper-base',
    size: 152_043_520,
    sizeLabel: '145 MB',
    multilingual: true,
    description: '引导默认，体验/质量平衡',
  },
  {
    id: 'small',
    hfId: 'Xenova/whisper-small',
    size: 483_183_820,
    sizeLabel: '460 MB',
    multilingual: true,
    description: '推荐主力，质量较好',
  },
  {
    id: 'medium',
    hfId: 'Xenova/whisper-medium',
    size: 1_612_398_080,
    sizeLabel: '1.5 GB',
    multilingual: true,
    description: '最高质量，算力要求高（移动端慎用）',
  },
  {
    id: 'turbo',
    hfId: 'onnx-community/whisper-large-v3-turbo',
    size: 838_860_800,
    sizeLabel: '800 MB',
    multilingual: true,
    description: 'large-v3-turbo，多语言，比 medium 更准更快（q4 省内存）',
  },
  {
    id: 'sensevoice',
    hfId: 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17',
    size: 550_000_000,
    sizeLabel: '550 MB',
    multilingual: true,
    description: 'SenseVoice（阿里），中/英/日/韩/粤，中文很强（sherpa 引擎）',
    engine: 'sherpa',
  },
  {
    id: 'paraformer',
    hfId: 'sherpa-onnx-paraformer-zh-2023-09-14',
    size: 220_000_000,
    sizeLabel: '220 MB',
    multilingual: false,
    description: 'Paraformer（阿里），中文普通话，非自回归快（sherpa 引擎）',
    engine: 'sherpa',
  },
]

const DB_NAME = 'voicetxt-models'
const STORE = 'models'
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

interface ModelRecord {
  id: ModelId
  downloadedAt: number
}

async function dbGet(id: ModelId): Promise<ModelRecord | undefined> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const r = tx.objectStore(STORE).get(id)
    r.onsuccess = () => resolve(r.result as ModelRecord | undefined)
    r.onerror = () => reject(r.error)
  })
}

async function dbPut(id: ModelId): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put({ id, downloadedAt: Date.now() } as ModelRecord)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

async function dbDelete(id: ModelId): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

async function dbGetAll(): Promise<ModelRecord[]> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const r = tx.objectStore(STORE).getAll()
    r.onsuccess = () => resolve(r.result as ModelRecord[])
    r.onerror = () => reject(r.error)
  })
}

/** 内存中的下载中标记（跨调用） */
const downloadingSet = new Set<ModelId>()

export function getModelInfo(id: ModelId): ModelInfo {
  const info = MODEL_REGISTRY.find((m) => m.id === id)
  if (!info) throw new Error(`未知模型: ${id}`)
  return info
}

export async function getModelStatus(id: ModelId): Promise<ModelStatus> {
  if (downloadingSet.has(id)) return 'downloading'
  try {
    const rec = await dbGet(id)
    return rec ? 'cached' : 'remote'
  } catch {
    return 'remote'
  }
}

/**
 * 触发 transformers.js 加载该模型（从 HF CDN 下载并缓存到浏览器）。
 * 成功后在 IndexedDB 写入「已下载」标记。
 */
export async function downloadModel(
  id: ModelId,
  opts?: { onProgress?: (p: { phase: 'download'; ratio: number; message?: string }) => void },
): Promise<void> {
  const info = getModelInfo(id)
  downloadingSet.add(id)
  try {
    const { pipeline, env } = await import('@huggingface/transformers')
    env.allowLocalModels = false
    // 按文件聚合进度，避免多文件各自 0-100% 导致进度条乱跳
    const fileProgress: Record<string, number> = {}
    let prevRatio = 0
    await pipeline('automatic-speech-recognition', info.hfId, {
      dtype: 'q8',
      progress_callback: (e: { status?: string; progress?: number; file?: string }) => {
        if (!opts?.onProgress) return
        // 各文件取已达到的最大值，总体取均值，且单调递增不回退
        if (typeof e.progress === 'number' && e.file) {
          fileProgress[e.file] = Math.max(fileProgress[e.file] ?? 0, e.progress)
        }
        const vals = Object.values(fileProgress)
        const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length / 100 : 0
        prevRatio = Math.max(prevRatio, avg)
        opts.onProgress({
          phase: 'download',
          ratio: prevRatio,
          message: e.file ? `${e.status ?? ''} ${e.file}` : (e.status ?? ''),
        })
      },
    })
    await dbPut(id)
  } finally {
    downloadingSet.delete(id)
  }
}

/**
 * 删除模型：移除自有标记 + 尽力清理浏览器 Cache API 中的模型权重。
 * 注：transformers.js 用 Cache API 缓存权重，按 URL 精确删除较难，
 *     这里删除能匹配到该 model repo 前缀的缓存条目；无法保证 100% 清空。
 */
export async function removeModel(id: ModelId): Promise<void> {
  await dbDelete(id)
  await tryCleanCache(getModelInfo(id).hfId)
}

export async function removeAllModels(): Promise<void> {
  const all = await dbGetAll()
  await Promise.all(all.map((r) => tryCleanCache(getModelInfo(r.id).hfId)))
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).clear()
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

/** 估算缓存占用：累加状态为 cached 的模型体积（精确测 Cache API 较难，故为估算）。 */
export async function getCacheSize(): Promise<number> {
  const all = await dbGetAll()
  return all.reduce((sum, r) => sum + getModelInfo(r.id).size, 0)
}

async function tryCleanCache(hfId: string): Promise<void> {
  try {
    if (typeof caches === 'undefined') return
    // transformers.js 默认使用 'transformers-cache' 之类的缓存名，遍历所有 cache 清理匹配项
    const names = await caches.keys()
    await Promise.all(
      names.map(async (name) => {
        const cache = await caches.open(name)
        const keys = await cache.keys()
        await Promise.all(
          keys
            .filter((k) => k.url.includes('/' + hfId + '/'))
            .map((k) => cache.delete(k)),
        )
      }),
    )
  } catch {
    // 清理失败不阻断流程
  }
}
