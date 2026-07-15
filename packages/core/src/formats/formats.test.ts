// formats 模块单元测试：断言每种字幕格式完全正确。
import { describe, expect, it } from 'vitest'
import type { TranscribeResult } from '../types'
import {
  formatSrtTime,
  formatVttTime,
  toJSON,
  toKaraoke,
  toPlainText,
  toSRT,
  toTimestampedLines,
  toVTT,
} from './index'

// 构造含 3 段（已知 start/end）的识别结果，用于断言每种格式
const result: TranscribeResult = {
  text: 'Hello world. This is a test.',
  language: 'en',
  languageScore: 0.99,
  segments: [
    { start: 0, end: 1.5, text: 'Hello world.' },
    { start: 1.5, end: 2.5, text: 'This is' },
    { start: 2.5, end: 4.0, text: 'a test.' },
  ],
  words: [
    { word: 'Hello', start: 0, end: 0.5, score: 0.9 },
    { word: 'world', start: 0.5, end: 1.5 },
  ],
}

describe('formats 时间格式化', () => {
  it('formatSrtTime 产出 HH:MM:SS,mmm（逗号毫秒）', () => {
    expect(formatSrtTime(0)).toBe('00:00:00,000')
    expect(formatSrtTime(1.5)).toBe('00:00:01,500')
    expect(formatSrtTime(4)).toBe('00:00:04,000')
    // 进位到分、时
    expect(formatSrtTime(3661.5)).toBe('01:01:01,500')
    // 四舍五入到毫秒
    expect(formatSrtTime(1.9995)).toBe('00:00:02,000')
  })

  it('formatSrtTime 对 undefined / null 兜底为 0', () => {
    expect(formatSrtTime(undefined)).toBe('00:00:00,000')
    expect(formatSrtTime(null)).toBe('00:00:00,000')
  })

  it('formatVttTime 产出 HH:MM:SS.mmm（点号毫秒）', () => {
    expect(formatVttTime(0)).toBe('00:00:00.000')
    expect(formatVttTime(1.5)).toBe('00:00:01.500')
    expect(formatVttTime(3661.5)).toBe('01:01:01.500')
    expect(formatVttTime(undefined)).toBe('00:00:00.000')
    expect(formatVttTime(null)).toBe('00:00:00.000')
  })
})

describe('formats toPlainText', () => {
  it('拼接各段 text，中间空格', () => {
    expect(toPlainText(result)).toBe('Hello world. This is a test.')
  })

  it('空 segments 返回空串', () => {
    expect(toPlainText({ ...result, segments: [] })).toBe('')
  })
})

describe('formats toTimestampedLines', () => {
  it('每段一行 [HH:MM:SS] text', () => {
    expect(toTimestampedLines(result)).toBe(
      ['[00:00:00] Hello world.', '[00:00:01] This is', '[00:00:02] a test.'].join(
        '\n',
      ),
    )
  })
})

describe('formats toSRT', () => {
  it('标准 SRT：序号从1、逗号毫秒、空行分隔', () => {
    const expected = [
      '1',
      '00:00:00,000 --> 00:00:01,500',
      'Hello world.',
      '',
      '2',
      '00:00:01,500 --> 00:00:02,500',
      'This is',
      '',
      '3',
      '00:00:02,500 --> 00:00:04,000',
      'a test.',
    ].join('\n')
    expect(toSRT(result)).toBe(expected)
  })
})

describe('formats toVTT', () => {
  it('首行 WEBVTT、空行、点号毫秒、空行分隔', () => {
    const expected = [
      'WEBVTT',
      '',
      '00:00:00.000 --> 00:00:01.500',
      'Hello world.',
      '',
      '00:00:01.500 --> 00:00:02.500',
      'This is',
      '',
      '00:00:02.500 --> 00:00:04.000',
      'a test.',
    ].join('\n')
    expect(toVTT(result)).toBe(expected)
    // 头部断言
    expect(toVTT(result).startsWith('WEBVTT\n\n')).toBe(true)
  })
})

describe('formats toJSON', () => {
  it('可反序列化且与原对象深相等', () => {
    const json = toJSON(result)
    expect(JSON.parse(json)).toEqual(result)
  })

  it('缩进 2 空格（含换行缩进）', () => {
    expect(toJSON(result)).toContain('\n  "language"')
  })
})

describe('formats toKaraoke', () => {
  it('透传 words', () => {
    expect(toKaraoke(result)).toEqual({
      words: [
        { word: 'Hello', start: 0, end: 0.5, score: 0.9 },
        { word: 'world', start: 0.5, end: 1.5 },
      ],
    })
  })

  it('words 缺失时返回空数组', () => {
    const noWords = { ...result, words: undefined }
    expect(toKaraoke(noWords)).toEqual({ words: [] })
  })
})
