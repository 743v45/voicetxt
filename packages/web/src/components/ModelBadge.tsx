import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { ModelId } from '@voicetxt/core'

/** 各档量化（与 core/transcription 的 dtypeFor 一致：medium/turbo 用 q4，其余 q8） */
export const MODEL_DTYPE: Record<ModelId, string> = {
  tiny: 'q8',
  base: 'q8',
  small: 'q8',
  medium: 'q4',
  turbo: 'q4',
}

// 按强度递进的高级配色（冷 → 暖）：
// tiny 灰（最轻）→ base 蓝 → small 紫 → medium 琥珀（最重/警示）
const STYLES: Record<ModelId, string> = {
  tiny: 'bg-slate-100 text-slate-600 dark:bg-slate-800/60 dark:text-slate-300',
  base: 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300',
  small: 'bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-300',
  medium:
    'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300',
  turbo: 'bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300',
}

export function ModelBadge({ id, className }: { id: ModelId; className?: string }) {
  return (
    <Badge variant="secondary" className={cn('border-transparent', STYLES[id], className)}>
      {id}
    </Badge>
  )
}
