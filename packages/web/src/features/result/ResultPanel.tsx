import { useRef, useState } from 'react'
import { Check, Copy, Download } from 'lucide-react'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import {
  toPlainText,
  toTimestampedLines,
  toSRT,
  toVTT,
  toJSON,
} from '@voicetxt/core'
import type { TranscribeResult } from '@voicetxt/core'
import { cn } from '@/lib/utils'

interface Props {
  result: TranscribeResult | null
  /** 用于 Karaoke 播放高亮的音频 URL（来自输入 blob） */
  audioUrl?: string
}

const FORMATS = [
  { id: 'text', label: '纯文本', ext: 'txt', fn: toPlainText },
  { id: 'lines', label: '逐句', ext: 'txt', fn: toTimestampedLines },
  { id: 'srt', label: 'SRT', ext: 'srt', fn: toSRT },
  { id: 'vtt', label: 'VTT', ext: 'vtt', fn: toVTT },
  { id: 'json', label: 'JSON', ext: 'json', fn: toJSON },
] as const

function download(text: string, ext: string) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `字幕-${Date.now()}.${ext}`
  a.click()
  URL.revokeObjectURL(url)
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        } catch {
          /* 剪贴板不可用时静默 */
        }
      }}
    >
      {copied ? <Check className="mr-1 h-4 w-4" /> : <Copy className="mr-1 h-4 w-4" />}
      {copied ? '已复制' : '复制'}
    </Button>
  )
}

function KaraokeView({
  result,
  audioUrl,
}: {
  result: TranscribeResult
  audioUrl?: string
}) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [cur, setCur] = useState(-1)
  const words = result.words ?? []

  const onTime = (e: React.SyntheticEvent<HTMLAudioElement>) => {
    const t = e.currentTarget.currentTime
    let idx = -1
    for (let k = 0; k < words.length; k++) {
      if (words[k].start <= t) idx = k
      else break
    }
    setCur(idx)
  }

  return (
    <div>
      {audioUrl ? (
        <audio ref={audioRef} src={audioUrl} controls onTimeUpdate={onTime} className="w-full" />
      ) : (
        <p className="text-sm text-muted-foreground">无音频可播放（实时录音模式可重放）。</p>
      )}
      <p className="mb-2 mt-4 text-xs text-muted-foreground">
        英文逐词高亮；中文为逐字高亮。需在识别时开启「逐词时间戳」。
      </p>
      <div className="max-h-[50vh] overflow-auto rounded-lg border p-4 leading-loose">
        {words.length ? (
          words.map((w, i) => (
            <span
              key={i}
              className={cn(
                'mx-0.5 rounded px-0.5',
                i === cur && 'bg-primary text-primary-foreground',
              )}
            >
              {w.word}
            </span>
          ))
        ) : (
          <span className="text-muted-foreground">未开启逐词时间戳，无逐词数据。</span>
        )}
      </div>
    </div>
  )
}

export function ResultPanel({ result, audioUrl }: Props) {
  if (!result) {
    return (
      <div className="flex h-full min-h-[300px] items-center justify-center rounded-lg border border-dashed text-muted-foreground">
        识别结果将显示在这里
      </div>
    )
  }

  return (
    <Tabs defaultValue="text" className="w-full">
      <TabsList className="grid w-full grid-cols-6">
        <TabsTrigger value="text">纯文本</TabsTrigger>
        <TabsTrigger value="lines">逐句</TabsTrigger>
        <TabsTrigger value="srt">SRT</TabsTrigger>
        <TabsTrigger value="vtt">VTT</TabsTrigger>
        <TabsTrigger value="json">JSON</TabsTrigger>
        <TabsTrigger value="karaoke">Karaoke</TabsTrigger>
      </TabsList>

      {FORMATS.map((f) => {
        const text = f.fn(result)
        return (
          <TabsContent key={f.id} value={f.id} className="mt-3">
            <div className="mb-2 flex justify-end gap-2">
              <CopyButton text={text} />
              <Button variant="outline" size="sm" onClick={() => download(text, f.ext)}>
                <Download className="mr-1 h-4 w-4" /> 导出
              </Button>
            </div>
            <pre className="max-h-[55vh] overflow-auto whitespace-pre-wrap rounded-lg border bg-muted/30 p-4 text-sm">
              {text}
            </pre>
          </TabsContent>
        )
      })}

      <TabsContent value="karaoke" className="mt-3">
        <KaraokeView result={result} audioUrl={audioUrl} />
      </TabsContent>
    </Tabs>
  )
}
