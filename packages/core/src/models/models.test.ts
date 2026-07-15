import { describe, it, expect } from 'vitest'
import { MODEL_REGISTRY, getModelInfo } from './index'

describe('MODEL_REGISTRY', () => {
  it('含 tiny/base/small/medium 四档', () => {
    expect(MODEL_REGISTRY.map((m) => m.id)).toEqual([
      'tiny',
      'base',
      'small',
      'medium',
    ])
  })

  it('各档有 hfId / 体积 / 多语言标记', () => {
    for (const m of MODEL_REGISTRY) {
      expect(m.hfId).toMatch(/^Xenova\/whisper-/)
      expect(m.size).toBeGreaterThan(0)
      expect(m.sizeLabel.length).toBeGreaterThan(0)
      expect(m.multilingual).toBe(true)
    }
  })

  it('体积随档位递增', () => {
    const sizes = MODEL_REGISTRY.map((m) => m.size)
    for (let i = 1; i < sizes.length; i++) {
      expect(sizes[i]).toBeGreaterThan(sizes[i - 1])
    }
  })
})

describe('getModelInfo', () => {
  it('返回对应档位信息', () => {
    expect(getModelInfo('base').id).toBe('base')
    expect(getModelInfo('base').hfId).toBe('Xenova/whisper-base')
  })

  it('未知档位抛错', () => {
    expect(() => getModelInfo('huge' as never)).toThrow(/未知模型/)
  })
})

// 注：getModelStatus / downloadModel / removeModel 依赖浏览器 IndexedDB，
// 需 fake-indexeddb 或浏览器环境，纳入 E2E 覆盖。
