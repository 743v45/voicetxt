import { useEffect, useState } from 'react'

interface MemoryInfo {
  used: number
  limit: number
}

function formatMB(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(0)}MB`
}

/**
 * 内存用量指示（每 5s 刷新）。
 * 仅 Chrome/Edge 暴露 performance.memory（非标准 API）；其他浏览器不显示。
 * 注意：onnxruntime 在 Worker 内运行，此处为主线程 JS heap，仅作参考。
 */
export function MemoryIndicator() {
  const [mem, setMem] = useState<MemoryInfo | null>(null)

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const perf = performance as any
    if (!perf?.memory) return
    const update = () =>
      setMem({
        used: perf.memory.usedJSHeapSize,
        limit: perf.memory.jsHeapSizeLimit,
      })
    update()
    const t = setInterval(update, 5000)
    return () => clearInterval(t)
  }, [])

  if (!mem) return null
  const ratio = mem.limit > 0 ? mem.used / mem.limit : 0
  const warn = ratio > 0.8
  return (
    <span
      className={`text-xs ${warn ? 'font-medium text-amber-600 dark:text-amber-500' : 'text-muted-foreground'}`}
    >
      内存 {formatMB(mem.used)}/{formatMB(mem.limit)}
      {warn ? ' ⚠️' : ''}
    </span>
  )
}
