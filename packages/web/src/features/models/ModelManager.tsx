import { useEffect, useState } from 'react'
import { Check, Download, Loader2, Trash2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import {
  MODEL_REGISTRY,
  getModelStatus,
  downloadModel,
  removeModel,
  removeAllModels,
  getCacheSize,
} from '@voicetxt/core'
import type { ModelId, ModelStatus } from '@voicetxt/core'
import { cn } from '@/lib/utils'

function formatBytes(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(1) + ' GB'
  if (n >= 1e6) return (n / 1e6).toFixed(0) + ' MB'
  return (n / 1e3).toFixed(0) + ' KB'
}

interface Props {
  open: boolean
  onOpenChange: (v: boolean) => void
  selected: ModelId
  onSelect: (id: ModelId) => void
}

/** 模型管理：列出档位、状态徽章、下载/删除/选用、缓存占用与清理。 */
export function ModelManager({ open, onOpenChange, selected, onSelect }: Props) {
  const [statuses, setStatuses] = useState<Record<string, ModelStatus>>({})
  const [dl, setDl] = useState<Record<string, number>>({})
  const [cache, setCache] = useState(0)
  const [busyId, setBusyId] = useState<string | null>(null)

  const refresh = async () => {
    const entries = await Promise.all(
      MODEL_REGISTRY.map(async (m) => [m.id, await getModelStatus(m.id)] as const),
    )
    setStatuses(Object.fromEntries(entries))
    setCache(await getCacheSize())
  }

  useEffect(() => {
    if (open) void refresh()
  }, [open])

  const handleDownload = async (id: ModelId) => {
    setBusyId(id)
    setDl((d) => ({ ...d, [id]: 0 }))
    try {
      await downloadModel(id, {
        onProgress: (p) => setDl((d) => ({ ...d, [id]: p.ratio })),
      })
    } catch {
      // 下载失败：刷新状态即可，徽章会回到 remote
    }
    setBusyId(null)
    void refresh()
  }

  const handleRemove = async (id: ModelId) => {
    await removeModel(id)
    void refresh()
  }

  const handleRemoveAll = async () => {
    await removeAllModels()
    void refresh()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>模型管理</DialogTitle>
          <DialogDescription>
            选择、下载或清理识别模型。模型仅缓存到本机，不上传。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {MODEL_REGISTRY.map((m) => {
            const st = statuses[m.id] ?? 'remote'
            const pct = dl[m.id] ? Math.round(dl[m.id] * 100) : 0
            return (
              <div
                key={m.id}
                className={cn(
                  'flex items-center gap-3 rounded-lg border p-3',
                  selected === m.id && 'border-primary',
                )}
              >
                <div className="flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{m.id}</span>
                    <Badge variant="secondary">{m.sizeLabel}</Badge>
                    {st === 'cached' && <Badge>已下载</Badge>}
                    {st === 'downloading' && (
                      <Badge variant="outline">下载中 {pct}%</Badge>
                    )}
                    {st === 'remote' && <Badge variant="outline">未下载</Badge>}
                    {selected === m.id && <Badge>当前</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground">{m.description}</p>
                  {st === 'downloading' && <Progress value={pct} className="mt-2" />}
                </div>

                <div className="flex gap-2">
                  {st === 'cached' ? (
                    <>
                      {selected !== m.id && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => onSelect(m.id)}
                        >
                          <Check className="mr-1 h-4 w-4" /> 选用
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleRemove(m.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="sm"
                      disabled={busyId === m.id}
                      onClick={() => handleDownload(m.id)}
                    >
                      {busyId === m.id ? (
                        <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                      ) : (
                        <Download className="mr-1 h-4 w-4" />
                      )}
                      下载
                    </Button>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        <div className="flex items-center justify-between border-t pt-3 text-sm text-muted-foreground">
          <span>缓存占用：约 {formatBytes(cache)}</span>
          <Button size="sm" variant="ghost" onClick={handleRemoveAll}>
            全部清理
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
