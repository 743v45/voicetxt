import { useEffect, useState } from 'react'
import { Loader2, Settings2 } from 'lucide-react'
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
import { Badge } from '@/components/ui/badge'
import { InputPanel } from '@/features/input/InputPanel'
import { ResultPanel } from '@/features/result/ResultPanel'
import { ModelManager } from '@/features/models/ModelManager'
import { Onboarding } from '@/features/models/Onboarding'
import { useTranscribe } from '@/lib/use-transcribe'
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
  const [modelReady, setModelReady] = useState(false)
  const [audioUrl, setAudioUrl] = useState<string | undefined>(undefined)
  const t = useTranscribe()
  const currentModel = getModelInfo(model)

  useEffect(() => {
    void detectCapabilities().then(setCaps)
  }, [])

  const checkReady = async (id: ModelId) => {
    setModelReady((await getModelStatus(id)) === 'cached')
  }

  useEffect(() => {
    void checkReady(model)
  }, [model])

  useEffect(() => {
    // 首次：若没有任何已下载模型，弹引导
    void (async () => {
      const statuses = await Promise.all(MODEL_REGISTRY.map((m) => getModelStatus(m.id)))
      if (!statuses.includes('cached')) setOnboardOpen(true)
    })()
  }, [])

  const handleBlob = async (blob: Blob) => {
    if ((await getModelStatus(model)) !== 'cached') {
      setMgrOpen(true)
      return
    }
    if (audioUrl) URL.revokeObjectURL(audioUrl)
    setAudioUrl(URL.createObjectURL(blob))
    try {
      await t.transcribe(model, blob, {
        language: lang,
        wordTimestamps: wordTs,
        diarization: diar,
      })
    } catch {
      /* 错误已在 hook 的 error 中暴露 */
    }
  }

  const pct = t.progress ? Math.round((t.progress.ratio ?? 0) * 100) : 0

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

      <main className="container grid gap-4 py-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>输入</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <InputPanel onBlob={handleBlob} disabled={t.busy} />

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
                <div className="flex flex-wrap items-center gap-1.5">
                  {modelReady ? (
                    <Badge>已就绪</Badge>
                  ) : (
                    <Badge variant="outline">未下载</Badge>
                  )}
                  {currentModel.size >= 1e9 && (
                    <span className="text-xs font-medium text-amber-600 dark:text-amber-500">
                      ⚠️ 体积较大，移动端不建议
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">{currentModel.description}</p>
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

            {t.busy && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t.progress?.message ? `${t.progress.message} ` : '识别中…'}
                {pct > 0 && `${pct}%`}
              </div>
            )}
            {t.error && <p className="text-sm text-destructive">错误：{t.error}</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>结果</CardTitle>
          </CardHeader>
          <CardContent>
            <ResultPanel result={t.result} audioUrl={audioUrl} />
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
      <Onboarding
        open={onboardOpen}
        onOpenChange={setOnboardOpen}
        onReady={(id) => {
          setModel(id)
          void checkReady(id)
        }}
      />
    </div>
  )
}

export default App
