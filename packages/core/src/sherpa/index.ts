// sherpa-onnx 引擎（浏览器 wasm）。
// 阶段1：骨架。wasm 动态加载与识别在阶段2实现。
//
// 集成方式（已调研，来自 k2-fsa/sherpa-onnx wasm/asr demo）：
// - 浏览器用 Emscripten wasm：sherpa-onnx-asr.js + .wasm（从 k2-fsa.github.io CDN 或自托管）
// - Module.locateFile 定位 wasm/模型文件
// - createOfflineRecognizer(Module) 创建识别器
// - recognizer.createStream() → stream.acceptWaveform(sr, samples) → recognizer.decode(stream) → recognizer.getResult(stream).text

import type { Engine, EngineOptions } from '../types'

export async function createSherpaEngine(_opts: EngineOptions): Promise<Engine> {
  // 阶段2 实现：动态加载 sherpa-onnx-asr.js + wasm、下载模型、createOfflineRecognizer、recognize
  throw new Error('Sherpa 引擎集成进行中（阶段2：wasm 加载与识别）。当前请使用 Whisper 模型。')
}
