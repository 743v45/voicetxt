import { useState } from 'react'
import {
  Eraser,
  Pause,
  Play,
  PlayCircle,
  RefreshCw,
  Trash2,
  Volume2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { ResultPanel } from '@/features/result/ResultPanel'
import { getModelInfo } from '@voicetxt/core'
import type { QueueTask, TaskStatus } from '@/lib/queue-store'
import type { QueueCounts } from '@/lib/use-queue'

/** useQueue 返回的、本组件需要的子集 */
export interface QueueApi {
  tasks: QueueTask[]
  concurrency: number
  paused: boolean
  counts: QueueCounts
  hasActive: boolean
  setConcurrency: (n: number) => void
  togglePause: () => void
  retryTask: (id: string) => void | Promise<void>
  removeTask: (id: string) => void | Promise<void>
  clearAudio: (id: string) => void | Promise<void>
  clearAll: () => void | Promise<void>
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function formatDuration(ms: number | null): string {
  if (ms == null) return '-'
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60000)}m${Math.round((ms % 60000) / 1000)}s`
}

const STATUS_LABEL: Record<TaskStatus, string> = {
  pending: '等待',
  running: '识别中',
  done: '完成',
  error: '失败',
}
const STATUS_VARIANT: Record<TaskStatus, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  pending: 'outline',
  running: 'default',
  done: 'secondary',
  error: 'destructive',
}

export function QueuePanel({ queue }: { queue: QueueApi }) {
  const [viewId, setViewId] = useState<string | null>(null)
  const [audioUrl, setAudioUrl] = useState<string | undefined>(undefined)

  const viewTask = queue.tasks.find((t) => t.id === viewId) ?? null

  const openView = (task: QueueTask) => {
    if (audioUrl) URL.revokeObjectURL(audioUrl)
    setAudioUrl(task.blob ? URL.createObjectURL(task.blob) : undefined)
    setViewId(task.id)
  }

  const closeView = () => {
    if (audioUrl) URL.revokeObjectURL(audioUrl)
    setAudioUrl(undefined)
    setViewId(null)
  }

  return (
    <div className="flex flex-col gap-3">
      {/* 工具栏 */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
        <div className="flex items-center gap-2 text-sm">
          <Badge variant="outline">等待 {queue.counts.pending}</Badge>
          <Badge>识别中 {queue.counts.running}</Badge>
          <Badge variant="secondary">完成 {queue.counts.done}</Badge>
          <Badge variant="destructive">失败 {queue.counts.error}</Badge>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="flex items-center gap-1">
            <Label className="text-xs text-muted-foreground">并发</Label>
            <Select
              value={String(queue.concurrency)}
              onValueChange={(v) => queue.setConcurrency(Number(v))}
            >
              <SelectTrigger className="h-8 w-16">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[1, 2, 3].map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={!queue.hasActive}
            onClick={queue.togglePause}
          >
            {queue.paused ? (
              <>
                <PlayCircle className="mr-1 h-4 w-4" /> 恢复
              </>
            ) : (
              <>
                <Pause className="mr-1 h-4 w-4" /> 暂停
              </>
            )}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={queue.tasks.length === 0}
            onClick={() => queue.clearAll()}
          >
            <Eraser className="mr-1 h-4 w-4" /> 清空
          </Button>
        </div>
      </div>

      {queue.paused && (
        <p className="text-xs text-amber-600 dark:text-amber-500">
          已暂停：当前识别中的任务跑完后，不再启动新任务。
        </p>
      )}

      {/* 列表 */}
      {queue.tasks.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-muted-foreground">
          暂无任务，从左侧添加音频/视频或录音
        </div>
      ) : (
        <div className="space-y-2">
          {[...queue.tasks].reverse().map((task) => {
            const model = getModelInfo(task.model)
            return (
              <div key={task.id} className="rounded-lg border p-3">
                <div className="flex items-center gap-2">
                  <span className="flex-1 truncate font-medium">{task.name}</span>
                  <Badge variant="secondary">{model.id}</Badge>
                  <Badge variant={STATUS_VARIANT[task.status]}>
                    {STATUS_LABEL[task.status]}
                  </Badge>
                </div>

                {task.status === 'running' && (
                  <Progress value={Math.round(task.progress * 100)} className="mt-2" />
                )}

                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span>添加 {formatTime(task.addedAt)}</span>
                  {task.startedAt && <span>开始 {formatTime(task.startedAt)}</span>}
                  {task.finishedAt && <span>完成 {formatTime(task.finishedAt)}</span>}
                  {task.durationMs != null && <span>耗时 {formatDuration(task.durationMs)}</span>}
                  {task.opts.language && task.opts.language !== 'auto' && (
                    <span>语种 {task.opts.language}</span>
                  )}
                  {task.blob ? (
                    <span className="text-emerald-600 dark:text-emerald-500">音频在</span>
                  ) : (
                    <span>音频已清理</span>
                  )}
                  {task.error && <span className="text-destructive">错误：{task.error}</span>}
                </div>

                <div className="mt-2 flex flex-wrap gap-2">
                  {task.status === 'done' && task.result && (
                    <Button size="sm" variant="outline" onClick={() => openView(task)}>
                      <Play className="mr-1 h-4 w-4" /> 查看结果
                    </Button>
                  )}
                  {task.status === 'error' && (
                    <Button size="sm" variant="outline" onClick={() => queue.retryTask(task.id)}>
                      <RefreshCw className="mr-1 h-4 w-4" /> 重试
                    </Button>
                  )}
                  {task.blob && task.status !== 'running' && (
                    <Button size="sm" variant="ghost" onClick={() => queue.clearAudio(task.id)}>
                      <Volume2 className="mr-1 h-4 w-4" /> 清理音频
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={task.status === 'running'}
                    onClick={() => queue.removeTask(task.id)}
                  >
                    <Trash2 className="mr-1 h-4 w-4" /> 删除
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* 结果查看 */}
      <Dialog open={!!viewTask} onOpenChange={(o) => !o && closeView()}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="truncate">{viewTask?.name} · 字幕</DialogTitle>
          </DialogHeader>
          {viewTask?.result && <ResultPanel result={viewTask.result} audioUrl={audioUrl} />}
        </DialogContent>
      </Dialog>
    </div>
  )
}
