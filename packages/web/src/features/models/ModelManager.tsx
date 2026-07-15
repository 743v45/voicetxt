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
            const isCurrent = selected === m.id
            return (
              <div
                key={m.id}
                className={cn(
                  'group flex items-center gap-3 rounded-lg border p-3',
                  isCurrent && 'border-primary',
                )}
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{m.id}</span>
                    <Badge variant="secondary">{m.sizeLabel}</Badge>
                    {isCurrent && <Badge>当前</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground">{m.description}</p>
                  {m.size >= 1e9 && (
                    <p className="mt-1 text-xs font-medium text-amber-600 dark:text-amber-500">
                      ⚠️ 体积较大（{m.sizeLabel}），下载与推理耗时/耗流量高，移动端不建议
                    </p>
                  )}
                  {st === 'downloading' && <Progress value={pct} className="mt-2" />}
                </div>

                <div className="flex items-center justify-end gap-2">
                  {/* 默认显示状态按钮；悬停行时切换为操作按钮 */}
                  <div className="flex items-center gap-2 group-hover:hidden">
                    {st === 'cached' && (
                      <Button variant="outline" size="sm">已下载</Button>
                    )}
                    {st === 'downloading' && (
                      <Button variant="outline" size="sm" disabled>
                        下载中 {pct}%
                      </Button>
                    )}
                    {st === 'remote' && (
                      <Button variant="outline" size="sm">未下载</Button>
                    )}
                  </div>

                  <div className="hidden items-center gap-1 group-hover:flex">
                    {!isCurrent && st === 'cached' && (
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
                      disabled={st === 'downloading' || busyId === m.id}
                      onClick={() => handleDownload(m.id)}
                    >
                      {busyId === m.id ? (
                        <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                      ) : (
                        <Download className="mr-1 h-4 w-4" />
                      )}
                      {st === 'cached' ? '重下' : '下载'}
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={st !== 'cached'}
                      onClick={() => handleRemove(m.id)}
                    >
                      <Trash2 className="mr-1 h-4 w-4" /> 删除
                    </Button>
                  </div>
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
