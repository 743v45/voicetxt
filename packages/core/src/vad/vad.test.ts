// vad 模块单元测试。
// - 能量阈值分支：用合成 Float32Array（静音 + 正弦波）确定性验证分段 / 合并 / 过滤。
// - silero 分支：真实推理需从 HF 下载 'onnx-community/silero-vad'（需网络 + 模型缓存），
//   单元测试中不触发；改为 mock transformers 使其不可用，验证「silero 失败 -> 能量法回退」接线。
//   另用「采样率非 16kHz -> silero 直接跳过」验证回退路径（完全不触达 transformers）。
import { describe, expect, it, vi } from 'vitest'
import {
  detectSpeechSegments,
  detectSpeechSegmentsByEnergy,
} from './index'

// mock @huggingface/transformers：pipeline 永远 reject，模拟「模型不可用」
vi.mock('@huggingface/transformers', () => ({
  pipeline: vi.fn().mockRejectedValue(new Error('test: silero unavailable')),
}))

const SAMPLE_RATE = 16000

/** 生成指定时长、振幅、频率的正弦波 Float32Array */
function sine(
  amp: number,
  freq: number,
  durationSec: number,
  sr = SAMPLE_RATE,
): Float32Array {
  const n = Math.round(durationSec * sr)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    out[i] = amp * Math.sin((2 * Math.PI * freq * i) / sr)
  }
  return out
}

/** 生成指定时长的静音（全零） */
function silence(durationSec: number, sr = SAMPLE_RATE): Float32Array {
  return new Float32Array(Math.round(durationSec * sr))
}

/** 拼接多段 Float32Array */
function concat(...arrs: Float32Array[]): Float32Array {
  const len = arrs.reduce((s, a) => s + a.length, 0)
  const out = new Float32Array(len)
  let off = 0
  for (const a of arrs) {
    out.set(a, off)
    off += a.length
  }
  return out
}

describe('detectSpeechSegmentsByEnergy 能量阈值法', () => {
  it('静音 + 正弦 + 静音 -> 恰好 1 段，边界落在正弦起止附近', () => {
    // 1s 静音 + 1s 正弦(振幅 0.3, RMS≈0.21 >> 阈值 0.02) + 1s 静音
    const audio = concat(
      silence(1),
      sine(0.3, 440, 1),
      silence(1),
    )
    const segs = detectSpeechSegmentsByEnergy(audio, SAMPLE_RATE)
    expect(segs).toHaveLength(1)
    // 30ms 窗口分辨率：start 略早于 1.0s，end 略晚于 2.0s
    expect(segs[0].start).toBeGreaterThanOrEqual(0.9)
    expect(segs[0].start).toBeLessThanOrEqual(1.0)
    expect(segs[0].end).toBeGreaterThanOrEqual(1.95)
    expect(segs[0].end).toBeLessThanOrEqual(2.1)
    expect(segs[0].end - segs[0].start).toBeGreaterThanOrEqual(0.5)
  })

  it('minSegmentSec 过滤掉过短段', () => {
    const audio = concat(silence(1), sine(0.3, 440, 1), silence(1))
    // 段长约 1s，要求 ≥ 2s -> 全部丢弃
    expect(detectSpeechSegmentsByEnergy(audio, SAMPLE_RATE, { minSegmentSec: 2 })).toHaveLength(0)
  })

  it('padSec 合并间隔较小的相邻段', () => {
    // 两段正弦，中间 0.1s 静音间隔；minSegmentSec 调小避免被过滤
    const audio = concat(
      silence(0.2),
      sine(0.3, 440, 0.3),
      silence(0.1), // 间隔 0.1s
      sine(0.3, 440, 0.3),
      silence(0.2),
    )
    // padSec=0.3 > 0.1 -> 合并为 1 段
    const merged = detectSpeechSegmentsByEnergy(audio, SAMPLE_RATE, {
      minSegmentSec: 0.1,
      padSec: 0.3,
    })
    expect(merged).toHaveLength(1)
    // padSec=0.05 < 0.1 -> 不合并，保留 2 段
    const separate = detectSpeechSegmentsByEnergy(audio, SAMPLE_RATE, {
      minSegmentSec: 0.1,
      padSec: 0.05,
    })
    expect(separate).toHaveLength(2)
  })

  it('全静音 -> 0 段', () => {
    expect(detectSpeechSegmentsByEnergy(silence(2), SAMPLE_RATE)).toHaveLength(0)
  })

  it('空输入 -> 0 段', () => {
    expect(detectSpeechSegmentsByEnergy(new Float32Array(0), SAMPLE_RATE)).toHaveLength(0)
  })

  it('threshold 自定义：高阈值下小信号不被识别', () => {
    const audio = concat(silence(0.5), sine(0.03, 440, 1), silence(0.5))
    // 振幅 0.03 -> RMS≈0.021，略高于默认阈值 0.02 -> 默认能识别
    expect(detectSpeechSegmentsByEnergy(audio, SAMPLE_RATE)).toHaveLength(1)
    // 阈值提高到 0.05 -> 不识别
    expect(
      detectSpeechSegmentsByEnergy(audio, SAMPLE_RATE, { threshold: 0.05 }),
    ).toHaveLength(0)
  })
})

describe('detectSpeechSegments 回退接线', () => {
  it('采样率非 16kHz -> 跳过 silero，走能量法（不触达 transformers）', async () => {
    const audio = concat(silence(1, 8000), sine(0.3, 440, 1, 8000), silence(1, 8000))
    const segs = await detectSpeechSegments(audio, 8000)
    expect(segs.length).toBeGreaterThanOrEqual(1)
    expect(segs[0].end).toBeGreaterThan(segs[0].start)
  })

  it('silero 不可用（mock reject）-> 回退能量法', async () => {
    const audio = concat(silence(1), sine(0.3, 440, 1), silence(1))
    // 16kHz 会进入 silero 分支；pipeline 被 mock 为 reject -> 回退能量法
    const segs = await detectSpeechSegments(audio, SAMPLE_RATE)
    expect(segs.length).toBeGreaterThanOrEqual(1)
    expect(segs[0].end).toBeGreaterThan(segs[0].start)
  })

  it('全静音 + 回退路径 -> 0 段', async () => {
    const segs = await detectSpeechSegments(silence(2), SAMPLE_RATE)
    expect(segs).toHaveLength(0)
  })
})
