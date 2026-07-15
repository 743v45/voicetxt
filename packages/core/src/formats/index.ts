// voicetxt 字幕格式化模块：纯函数，输入 TranscribeResult 输出各字幕格式字符串。
// 零副作用、零 IO，便于单元测试与在 Worker / 扩展中复用。

import type { KaraokeData, Segment, TranscribeResult } from '../types'

// ---- 基础工具 ----

/** 两位补零 */
const pad2 = (n: number): string => String(n).padStart(2, '0')
/** 三位补零（毫秒） */
const pad3 = (n: number): string => String(n).padStart(3, '0')

/** 段起始时间，缺失兜底为 0 */
const startOf = (s: Segment): number => s.start ?? 0
/**
 * 段结束时间兜底：end 缺失（undefined / null）时用 start 兜底，再缺失用 0。
 * 契约要求：对 undefined / end 为 null 用 start 兜底或 0。
 */
const endOf = (s: Segment): number => s.end ?? s.start ?? 0

// ---- 时间格式化（内部辅助，导出以便测试）----

/**
 * 把秒格式化为 SRT 时间码 `HH:MM:SS,mmm`（逗号分隔毫秒）。
 * t 为 undefined / null 时按 0 处理。
 */
export function formatSrtTime(t: number | undefined | null): string {
  const ms = Math.round((t ?? 0) * 1000)
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  const s = Math.floor((ms % 60_000) / 1000)
  const mm = ms % 1000
  return `${pad2(h)}:${pad2(m)}:${pad2(s)},${pad3(mm)}`
}

/**
 * 把秒格式化为 VTT 时间码 `HH:MM:SS.mmm`（点号分隔毫秒）。
 * t 为 undefined / null 时按 0 处理。
 */
export function formatVttTime(t: number | undefined | null): string {
  const ms = Math.round((t ?? 0) * 1000)
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  const s = Math.floor((ms % 60_000) / 1000)
  const mm = ms % 1000
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}.${pad3(mm)}`
}

/** 把秒格式化为 `HH:MM:SS`（无毫秒），用于时间戳行 */
const formatClock = (t: number): string => {
  const total = Math.floor(t)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}`
}

// ---- 公共格式化 API ----

/** 纯文本：拼接各段 text，中间以空格分隔 */
export function toPlainText(r: TranscribeResult): string {
  return r.segments.map((s) => s.text).join(' ')
}

/** 带时间戳行：每段一行 `[HH:MM:SS] text` */
export function toTimestampedLines(r: TranscribeResult): string {
  return r.segments
    .map((s) => `[${formatClock(startOf(s))}] ${s.text}`)
    .join('\n')
}

/** 标准 SRT：序号从 1 起，`HH:MM:SS,mmm --> HH:MM:SS,mmm`，条目间空行分隔 */
export function toSRT(r: TranscribeResult): string {
  return r.segments
    .map(
      (s, i) =>
        `${i + 1}\n${formatSrtTime(startOf(s))} --> ${formatSrtTime(endOf(s))}\n${s.text}`,
    )
    .join('\n\n')
}

/** WebVTT：首行 `WEBVTT`，空行，`HH:MM:SS.mmm --> HH:MM:SS.mmm`，条目间空行分隔 */
export function toVTT(r: TranscribeResult): string {
  const body = r.segments
    .map(
      (s) => `${formatVttTime(startOf(s))} --> ${formatVttTime(endOf(s))}\n${s.text}`,
    )
    .join('\n\n')
  return `WEBVTT\n\n${body}`
}

/** JSON 序列化（缩进 2 空格） */
export function toJSON(r: TranscribeResult): string {
  return JSON.stringify(r, null, 2)
}

/** Karaoke 数据：透传逐词时间戳，words 缺失时返回空数组 */
export function toKaraoke(r: TranscribeResult): KaraokeData {
  return { words: r.words ?? [] }
}
