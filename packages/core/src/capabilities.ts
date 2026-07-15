// 能力检测：决定推理后端与功能开关。

import type { Capabilities } from './types'

export async function detectCapabilities(): Promise<Capabilities> {
  const nav = typeof navigator !== 'undefined' ? navigator : (undefined as unknown as Navigator)
  return {
    webgpu: !!nav && 'gpu' in nav,
    wasm: typeof WebAssembly !== 'undefined',
    indexedDB: typeof indexedDB !== 'undefined',
    mediaRecorder: typeof MediaRecorder !== 'undefined',
    offscreen: typeof OffscreenCanvas !== 'undefined' || typeof document !== 'undefined',
  }
}
