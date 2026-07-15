// sherpa-onnx paraformer 引擎（wasm）—— classic worker（需 importScripts）。
// 从 voicetxt-sherpa-assets release CDN 加载 main-asr.js + asr.js，识别。
//
// 协议与 transcribe.worker 一致：
// 主线程 → { type:'transcribe', id, input:Float32Array(16k mono), opts }
// Worker  → { type:'progress'|'result'|'error', id, ... }

// CDN base（GitHub release asset，支持 CORS 直 fetch）
const CDN =
  'https://github.com/743v45/voicetxt-sherpa-assets/releases/download/v1.13.4-paraformer-zh-en/'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let recognizer: any = null
let ready: Promise<void> | null = null

function loadSherpa(): Promise<void> {
  if (ready) return ready
  ready = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('sherpa 加载超时（检查 CDN/CORS 或网络）')),
      180000,
    )
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g = self as any
    g.Module = {
      locateFile: (path: string) => CDN + path,
      onRuntimeInitialized: () => {
        try {
          // tarball 版默认 type=1 paraformer（encoder.onnx/decoder.onnx/tokens.txt）
          recognizer = g.createOnlineRecognizer(g.Module)
          clearTimeout(timer)
          resolve()
        } catch (e) {
          clearTimeout(timer)
          ready = null
          reject(e)
        }
      },
    }
    try {
      // classic worker：importScripts 加载 Emscripten main + glue
      importScripts(CDN + 'sherpa-onnx-wasm-main-asr.js')
      importScripts(CDN + 'sherpa-onnx-asr.js')
    } catch (e) {
      clearTimeout(timer)
      ready = null
      reject(e)
    }
  })
  return ready
}

self.onmessage = async (e: MessageEvent) => {
  const data = e.data
  if (data?.type !== 'transcribe') return
  const { id, input, opts } = data as {
    id: number
    input: Float32Array
    opts?: { language?: string }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const post = (m: any) => (self as unknown as Worker).postMessage(m)

  try {
    post({ type: 'progress', id, progress: { phase: 'transcribe', ratio: 0.1 } })
    await loadSherpa()
    post({ type: 'progress', id, progress: { phase: 'transcribe', ratio: 0.5 } })

    const stream = recognizer.createStream()
    stream.acceptWaveform(16000, input)
    while (recognizer.isReady(stream)) recognizer.decode(stream)
    // paraformer 需要 tail padding 触发最终解码
    if (recognizer.config?.modelConfig?.paraformer?.encoder) {
      stream.acceptWaveform(16000, new Float32Array(16000))
      while (recognizer.isReady(stream)) recognizer.decode(stream)
    }
    const result = recognizer.getResult(stream)
    stream.free?.()

    const text = String(result?.text ?? '')
    post({
      type: 'result',
      id,
      result: {
        text,
        segments: [{ start: 0, end: 0, text }],
        language: opts?.language ?? 'zh',
      },
    })
  } catch (err) {
    console.error('[sherpa.worker] error:', err)
    const raw = err instanceof Error ? err.message : String(err)
    post({ type: 'error', id, message: raw, errorDetail: raw })
  }
}
