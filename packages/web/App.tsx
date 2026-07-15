import { useEffect, useState } from 'react'

function App() {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    // 后续接入 core 的能力检测；先占位
    setReady(true)
  }, [])

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b">
        <div className="container flex h-14 items-center justify-between">
          <div className="flex items-center gap-2 font-semibold">
            <span className="text-primary">●</span> voicetxt
          </div>
          <div className="text-sm text-muted-foreground">
            本地语音转字幕 · 数据不上传
          </div>
        </div>
      </header>

      <main className="container py-8">
        <h1 className="text-2xl font-bold tracking-tight">语音转文字 + 字幕</h1>
        <p className="mt-2 text-muted-foreground">
          上传音频/视频，或实时录音，在浏览器本地完成识别。
          {ready ? ' 骨架就绪，待接入 core。' : ' 加载中…'}
        </p>

        {/* TODO(features/input): 输入区（上传/拖拽/实时录音） */}
        {/* TODO(features/models): 模型管理 + 首次引导 */}
        {/* TODO(features/result): 结果展示（多排版/复制/导出/逐词高亮） */}
        <div className="mt-6 rounded-lg border border-dashed p-10 text-center text-muted-foreground">
          功能接入中
        </div>
      </main>
    </div>
  )
}

export default App
