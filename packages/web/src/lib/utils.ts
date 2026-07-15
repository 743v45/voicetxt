import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** shadcn 标准 cn 工具：合并 Tailwind 类 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
