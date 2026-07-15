import { useState } from 'react'
import { Loader2, Rocket } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { MODEL_REGISTRY, downloadModel } from '@voicetxt/core'
import type { ModelId } from '@voicetxt/core'
import { cn } from '@/lib/utils'

interface Props {
  open: boolean
  onOpenChange: (v: boolean) => void
  onReady: (id: ModelId) => void
}

/** 首次引导：无已下载模型时触发，默认 base。 */
export function Onboarding({ open, onOpenChange, onReady }: Props) {
  const [pick, setPick] = useState<ModelId>('base')
  const [downloading, setDownloading] = useState(false)
  const [pct, setPct] = useState(0)

  const start = async () => {
    setDownloading(true)
    setPct(0)
    try {
      await downloadModel(pick, {
        onProgress: (p) => setPct(Math.round(p.ratio * 100)),
      })
      onReady(pick)
      onOpenChange(false)
    } catch {
      // 失败留在引导页，用户可重试
    }
    setDownloading(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Rocket className="h-5 w-5" /> 欢迎使用 voicetxt
          </DialogTitle>
          <DialogDescription>
            首次使用需下载一个识别模型（仅缓存到本机）。推荐 base，体积小、够用，可随时在「模型管理」更换。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {MODEL_REGISTRY.map((m) => (
            <button
              key={m.id}
              disabled={downloading}
              onClick={() => setPick(m.id)}
              className={cn(
                'flex w-full items-center gap-2 rounded-lg border p-3 text-left',
                pick === m.id ? 'border-primary' : 'hover:bg-accent',
              )}
            >
              <span className="flex-1">
                <span className="font-medium">{m.id}</span>{' '}
                <span className="text-xs text-muted-foreground">{m.description}</span>
              </span>
              <Badge variant="secondary">{m.sizeLabel}</Badge>
              {m.size >= 1e9 && <Badge variant="destructive">⚠️ 体积大</Badge>}
            </button>
          ))}
        </div>

        {downloading && <Progress value={pct} className="mt-2" />}

        <DialogFooter>
          <Button onClick={start} disabled={downloading}>
            {downloading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {downloading ? `下载中 ${pct}%` : '下载并开始'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
