import { useEffect, useState } from 'react'
import { Settings2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { Toaster } from '@/components/ui/sonner'
import { InputPanel } from '@/features/input/InputPanel'
import { QueuePanel } from '@/features/queue/QueuePanel'
import { ModelManager } from '@/features/models/ModelManager'
import { Onboarding } from '@/features/models/Onboarding'
import { useQueue } from '@/lib/use-queue'
import {
  MODEL_REGISTRY,
  getModelInfo,
  getModelStatus,
  detectCapabilities,
} from '@voicetxt/core'
import type { ModelId, Language, Capabilities } from '@voicetxt/core'

const LANGS: { value: Language; label: string }[] = [
  { value: 'auto', label: '自动检测' },
  { value: 'zh', label: '中文' },
  { value: 'en', label: 'English' },
  { value: 'ja', label: '日本語' },
  { value: 'ko', label: '한국어' },
  { value: 'fr', label: 'Français' },
  { value: 'de', label: 'Deutsch' },
  { value: 'es', label: 'Español' },
  { value: 'ru', label: 'Русский' },
  { value: 'it', label: 'Italiano' },
  { value: 'pt', label: 'Português' },
  { value: 'ar', label: 'العربية' },
]

function App() {
  const [model, setModel] = useState<ModelId>('base')
  const [lang, setLang] = useState<Language>('auto')
  const [wordTs, setWordTs] = useState(false)
  const [diar, setDiar] = useState(false)
  const [caps, setCaps] = useState<Capabilities | null>(null)
  const [mgrOpen, setMgrOpen] = useState(false)
  const [onboardOpen, setOnboardOpen] = useState(false)
  const queue = useQueue()
  const currentModel = getModelInfo(model)

  useEffect(() => {
    void detectCapabilities().then(setCaps)
  }, [])

  useEffect(() => {
    void (async () => {
      const s = await Promise.all(MODEL_REGISTRY.map((m) => getModelStatus(m.id)))
      if (!s.includes('cached')) setOnboardOpen(true)
    })()
  }, [])

  // 输入 → 加入队列（用当前任务设置；每个任务记住当时的模型/选项）
  const handleAdd = async (blob: Blob, name: string) => {
    if ((await getModelStatus(model)) !== 'cached') {
      toast.error(`模型 ${model} 未下载，已打开模型管理`)
      setMgrOpen(true)
      return
    }
    await queue.addTask(blob, name, model, {
      language: lang,
      wordTimestamps: wordTs,
      diarization: diar,
    })
    toast.success(`已加入队列：${name}`)
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b">
        <div className="container flex h-14 items-center justify-between">
          <div className="flex items-center gap-2 font-semibold">
            <span className="text-primary">●</span> voicetxt
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-muted-foreground">
              {caps?.webgpu ? 'WebGPU 加速' : caps ? 'CPU (WASM)' : '检测中…'}
            </span>
            <Button variant="outline" size="sm" onClick={() => setMgrOpen(true)}>
              <Settings2 className="mr-1 h-4 w-4" /> 模型管理
            </Button>
          </div>
        </div>
      </header>

      <main className="container grid gap-4 py-6 lg:grid-cols-[380px_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>输入与任务设置</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <InputPanel onBlob={handleAdd} />

            <div className="space-y-3 border-t pt-3">
              <p className="text-xs text-muted-foreground">
                以下设置应用于新加入队列的任务
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">模型</Label>
                  <Select value={model} onValueChange={(v) => setModel(v as ModelId)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {MODEL_REGISTRY.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.id} · {m.sizeLabel}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {currentModel.size >= 1e9 && (
                    <p className="text-xs font-medium text-amber-600 dark:text-amber-500">
                      ⚠️ 体积较大，移动端不建议
                    </p>
                  )}
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">语言</Label>
                  <Select value={lang} onValueChange={(v) => setLang(v as Language)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {LANGS.map((l) => (
                        <SelectItem key={l.value} value={l.value}>
                          {l.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={wordTs}
                    onChange={(e) => setWordTs(e.target.checked)}
                  />
                  逐词时间戳
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={diar}
                    onChange={(e) => setDiar(e.target.checked)}
                  />
                  说话人区分（实验性）
                </label>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>处理队列</CardTitle>
          </CardHeader>
          <CardContent>
            <QueuePanel queue={queue} />
          </CardContent>
        </Card>
      </main>

      <ModelManager
        open={mgrOpen}
        onOpenChange={setMgrOpen}
        selected={model}
        onSelect={(id) => {
          setModel(id)
          setMgrOpen(false)
        }}
      />
      <Onboarding open={onboardOpen} onOpenChange={setOnboardOpen} onReady={(id) => setModel(id)} />
      <Toaster richColors position="bottom-right" />
    </div>
  )
}

export default App
