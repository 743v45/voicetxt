// audio 模块单元测试。
// 重点测 sliceAudio（纯函数，不依赖浏览器，可在 Node 直接运行）。
// decodeAudio / resampleTo16kMono / extractAudioTrack 依赖浏览器 Web Audio API
// （AudioContext / OfflineAudioContext / MediaRecorder / document），Node 下不可用，
// 故用 test.skip 占位并注明原因；真实环境由集成测试（integration-tests/）覆盖。

import { describe, expect, it } from 'vitest'
import {
  decodeAudio,
  extractAudioTrack,
  resampleTo16kMono,
  sliceAudio,
} from './index'

/** 构造长度为 n、值为 i/n 斜坡的 Float32Array（便于按索引校验切片边界）。 */
function ramp(n: number): Float32Array {
  const a = new Float32Array(n)
  for (let i = 0; i < n; i++) a[i] = i / n
  return a
}

/** 选项复用类型 */
interface AssertOpts {
  sampleRate: number
  overlapSeconds: number
}

/**
 * 通用不变量校验：覆盖性、无越界、data 为 subarray 视图、相邻片 overlap 正确。
 * 对任意合法切片结果都应成立，集中断言避免每个用例重复。
 */
function assertWellFormed(
  samples: Float32Array,
  chunks: ReturnType<typeof sliceAudio>,
  o: AssertOpts,
) {
  expect(chunks.length).toBeGreaterThan(0)
  const total = samples.length

  // 1) 起点对齐到 0，终点覆盖到末尾
  expect(chunks[0].start).toBeCloseTo(0, 6)
  expect(chunks[chunks.length - 1].end * o.sampleRate).toBeCloseTo(total, 0)

  for (const c of chunks) {
    // 2) 区间非空且在 [0, total] 内（无越界）
    expect(c.start).toBeGreaterThanOrEqual(0)
    expect(c.end * o.sampleRate).toBeLessThanOrEqual(total)
    expect(c.end).toBeGreaterThan(c.start)
    // 3) data 长度 = 区间对应的样本数
    expect(c.data.length).toBe(Math.round((c.end - c.start) * o.sampleRate))
    // 4) data 是 samples 的零拷贝视图（共享底层 buffer）
    expect(c.data.buffer).toBe(samples.buffer)
  }

  // 5) 相邻片：后片起点 = 前片终点 - overlap（末片可能更短，仅校验非末相邻对）
  const overlap = Math.round(o.overlapSeconds * o.sampleRate)
  for (let i = 0; i + 1 < chunks.length; i++) {
    const gapStart = Math.round(chunks[i + 1].start * o.sampleRate)
    const prevEnd = Math.round(chunks[i].end * o.sampleRate)
    // 步长一致 ⇒ 相邻片起点差 = 片长 - overlap，故前片终点 - 后片起点 = overlap
    expect(prevEnd - gapStart).toBe(overlap)
  }
}

describe('sliceAudio — 默认参数（16kHz / 30s / 1s overlap）', () => {
  it('60s 音频切成 3 片，区间为 [0,30]/[29,59]/[58,60]', () => {
    const sampleRate = 16000
    const samples = ramp(sampleRate * 60) // 960000 样本
    const chunks = sliceAudio(samples)

    expect(chunks).toHaveLength(3)
    expect(chunks[0].start).toBeCloseTo(0, 6)
    expect(chunks[0].end).toBeCloseTo(30, 6)
    expect(chunks[1].start).toBeCloseTo(29, 6)
    expect(chunks[1].end).toBeCloseTo(59, 6)
    expect(chunks[2].start).toBeCloseTo(58, 6)
    expect(chunks[2].end).toBeCloseTo(60, 6)

    assertWellFormed(samples, chunks, { sampleRate, overlapSeconds: 1 })
  })

  it('每片 data 长度正确：480000 / 480000 / 32000', () => {
    const chunks = sliceAudio(ramp(16000 * 60))
    expect(chunks[0].data).toHaveLength(480000)
    expect(chunks[1].data).toHaveLength(480000)
    expect(chunks[2].data).toHaveLength(32000) // 末片较短
  })

  it('相邻片 overlap 区间的样本完全一致（零拷贝视图共享内存）', () => {
    const sampleRate = 16000
    const samples = ramp(sampleRate * 60)
    const chunks = sliceAudio(samples)
    // chunk0=[0,480000) chunk1=[464000,944000)，重叠区 [464000,480000)
    const overlapSize = 16000
    const checkAt = [0, 1, 8000, overlapSize - 2, overlapSize - 1]
    for (const k of checkAt) {
      // chunk1 的前 overlapSize 个样本 = chunk0 的末 overlapSize 个样本
      expect(chunks[1].data[k]).toBe(chunks[0].data[464000 + k])
      // 且都等于全局 ramp 对应值
      expect(chunks[1].data[k]).toBe(samples[464000 + k])
    }
  })
})

describe('sliceAudio — 边界与参数', () => {
  it('不足一片（10s）返回单片，完整覆盖', () => {
    const sampleRate = 16000
    const samples = ramp(sampleRate * 10)
    const chunks = sliceAudio(samples)
    expect(chunks).toHaveLength(1)
    expect(chunks[0].start).toBeCloseTo(0, 6)
    expect(chunks[0].end).toBeCloseTo(10, 6)
    expect(chunks[0].data).toHaveLength(160000)
  })

  it('空输入返回空数组', () => {
    expect(sliceAudio(new Float32Array(0))).toEqual([])
  })

  it('overlap=0 时相邻片首尾相接、无重叠', () => {
    const sampleRate = 16000
    const samples = ramp(sampleRate * 70) // 70s
    const chunks = sliceAudio(samples, { chunkSeconds: 30, overlapSeconds: 0 })
    // step=30s ⇒ [0,30]/[30,60]/[60,70]
    expect(chunks).toHaveLength(3)
    expect(chunks[1].start).toBeCloseTo(chunks[0].end, 6)
    expect(chunks[2].start).toBeCloseTo(chunks[1].end, 6)
    assertWellFormed(samples, chunks, { sampleRate, overlapSeconds: 0 })
  })

  it('自定义 sampleRate=8000 / chunkSeconds=5 / overlapSeconds=1', () => {
    const sampleRate = 8000
    const samples = ramp(sampleRate * 12) // 96000 样本
    const chunks = sliceAudio(samples, {
      sampleRate,
      chunkSeconds: 5,
      overlapSeconds: 1,
    })
    // chunkSize=40000 overlapSize=8000 step=32000 ⇒ [0,5]/[4,9]/[8,12]
    expect(chunks).toHaveLength(3)
    expect(chunks[0].start).toBe(0)
    expect(chunks[0].end).toBe(5)
    expect(chunks[1].start).toBe(4)
    expect(chunks[1].end).toBe(9)
    expect(chunks[2].start).toBe(8)
    expect(chunks[2].end).toBe(12)
    assertWellFormed(samples, chunks, { sampleRate, overlapSeconds: 1 })
  })

  it('恰好整除（60s / step 29s 无尾余时仍完整覆盖）', () => {
    // 29s 恰为一片步长 ⇒ 1 片覆盖全部
    const sampleRate = 16000
    const samples = ramp(sampleRate * 29)
    const chunks = sliceAudio(samples, { chunkSeconds: 30, overlapSeconds: 1 })
    expect(chunks).toHaveLength(1)
    expect(chunks[0].end).toBeCloseTo(29, 6)
  })

  it('overlap >= 片长时降级为步长 1，不死循环且完整覆盖', () => {
    // sampleRate=10 / chunkSeconds=1（chunkSize=10）/ overlapSeconds=5（overlapSize=50>10）
    // step 降为 1；100 样本 ⇒ start 取 0..90 共 91 片
    const sampleRate = 10
    const samples = ramp(100)
    const chunks = sliceAudio(samples, {
      sampleRate,
      chunkSeconds: 1,
      overlapSeconds: 5,
    })
    expect(chunks).toHaveLength(91) // 不死循环的铁证
    expect(chunks[0].start).toBeCloseTo(0, 6)
    expect(chunks[chunks.length - 1].end).toBeCloseTo(10, 6)
    // 无越界
    for (const c of chunks) {
      expect(c.end * sampleRate).toBeLessThanOrEqual(samples.length)
    }
  })
})

// —— Web Audio 相关：Node 环境无对应 API，test.skip 占位，注明原因 ——

describe.skip('decodeAudio（依赖浏览器 AudioContext）', () => {
  // 跳过原因：decodeAudio 内部 new AudioContext() + decodeAudioData，
  // Node 测试环境无 Web Audio API；需在真实浏览器/集成测试中验证。
  it('解码音频 Blob 为 AudioBuffer', async () => {
    await decodeAudio(new Blob([]))
    expect(true).toBe(true)
  })
})

describe.skip('resampleTo16kMono（依赖浏览器 OfflineAudioContext）', () => {
  // 跳过原因：依赖 OfflineAudioContext.startRendering()，
  // Node 测试环境无 Web Audio API；需在真实浏览器/集成测试中验证。
  // 另：其返回为 Promise<Float32Array>（详见实现注释），消费方需 await。
  it('重采样到 16kHz 单声道', async () => {
    await resampleTo16kMono({} as AudioBuffer)
    expect(true).toBe(true)
  })
})

describe.skip('extractAudioTrack（依赖浏览器 DOM + MediaRecorder）', () => {
  // 跳过原因：兜底分支使用 document.createElement('video') + MediaRecorder，
  // Node 测试环境无 DOM / 媒体 API；需在真实浏览器/集成测试中验证。
  it('从视频 Blob 提取音轨', async () => {
    await extractAudioTrack(new Blob([]))
    expect(true).toBe(true)
  })
})
