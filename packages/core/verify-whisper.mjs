// 主动验收脚本：用 Node 直接跑 transformers.js，隔离 web 层验证模型/参数。
// 用法: node verify-whisper.mjs [modelId] [dtype]
//   默认 Xenova/whisper-base / q8（与 web 线上一致）
// 测试音频: JFK 演讲，正确文本 "and so my fellow Americans ..."
import { pipeline, env } from '@huggingface/transformers'

env.allowLocalModels = false // 走 HF CDN

const model = process.argv[2] || 'Xenova/whisper-base'
const dtype = process.argv[3] || 'q8'
console.log(`[verify] model=${model} dtype=${dtype}`)

console.log('[verify] 加载模型（首次需下载，请等待）…')
const transcriber = await pipeline('automatic-speech-recognition', model, { dtype })
console.log('[verify] 模型已加载')

const url =
  'https://huggingface.co/datasets/Xenova/transformers.js-docs/resolve/main/jfk.wav'
console.log('[verify] 下载测试音频 jfk.wav …')
const out = await transcriber(url, {
  language: 'en',
  task: 'transcribe',
  return_timestamps: true,
  chunk_length_s: 30,
  stride_length_s: 5,
  condition_on_previous_text: false,
})

console.log('[verify] === text ===')
console.log(out.text)
console.log('[verify] === full ===')
console.log(JSON.stringify(out, null, 2))
