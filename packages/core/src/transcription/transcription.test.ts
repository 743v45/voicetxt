import { describe, it, expect, vi, beforeEach } from 'vitest'

// mock transformers.js：pipeline 返回我们构造的伪 transcriber
// 用 vi.hoisted 确保 mockPipeline 在 vi.mock factory（会被提升）中可访问
const { mockPipeline } = vi.hoisted(() => ({
  mockPipeline: vi.fn(),
}))

vi.mock('@huggingface/transformers', () => ({
  pipeline: (...args: unknown[]) => mockPipeline(...args),
  env: { allowLocalModels: false },
}))

// mock models.getModelInfo（避免依赖真实注册表）
vi.mock('../models', () => ({
  getModelInfo: (id: string) => ({
    id,
    hfId: 'Xenova/whisper-' + id,
    size: 1,
    sizeLabel: '1 MB',
    multilingual: true,
    description: '',
  }),
}))

// mock audio（避免触达 Web Audio）
vi.mock('../audio', () => ({
  decodeAudio: vi.fn(),
  resampleTo16kMono: vi.fn(async () => new Float32Array(8)),
}))

import { createTranscriptionEngine } from './index'

describe('createTranscriptionEngine', () => {
  beforeEach(() => mockPipeline.mockReset())

  it('用 q8 dtype 创建 pipeline', async () => {
    mockPipeline.mockResolvedValue(async () => ({ text: '', chunks: [] }))
    await createTranscriptionEngine({ model: 'base' })
    expect(mockPipeline).toHaveBeenCalledTimes(1)
    const args = mockPipeline.mock.calls[0] as [
      string,
      string,
      { dtype: string; device: string },
    ]
    expect(args[0]).toBe('automatic-speech-recognition')
    expect(args[1]).toBe('Xenova/whisper-base')
    expect(args[2].dtype).toBe('q8')
  })

  it('句子级结果映射为 segments', async () => {
    mockPipeline.mockResolvedValue(async () => ({
      text: '你好',
      chunks: [{ timestamp: [0, 1.5], text: '你好' }],
    }))
    const engine = await createTranscriptionEngine({ model: 'base' })
    const r = await engine.transcribe(new Float32Array(8), {})
    expect(r.text).toBe('你好')
    expect(r.segments[0]).toEqual({ start: 0, end: 1.5, text: '你好' })
    expect(r.words).toBeUndefined()
  })

  it('逐词结果映射并按停顿聚合为 segments', async () => {
    mockPipeline.mockResolvedValue(async () => ({
      text: 'a b',
      chunks: [
        { timestamp: [0, 0.5], text: 'a' },
        { timestamp: [1.2, 1.5], text: 'b' }, // 与上一词间隔 0.7s > 0.5 -> 新段
      ],
    }))
    const engine = await createTranscriptionEngine({ model: 'base' })
    const r = await engine.transcribe(new Float32Array(8), { wordTimestamps: true })
    expect(r.words?.map((w) => w.word)).toEqual(['a', 'b'])
    expect(r.segments.length).toBe(2)
  })

  it('cancel / dispose 不抛错', async () => {
    mockPipeline.mockResolvedValue({ dispose: vi.fn() })
    const engine = await createTranscriptionEngine({ model: 'base' })
    expect(() => engine.cancel()).not.toThrow()
    expect(() => engine.dispose()).not.toThrow()
  })
})
