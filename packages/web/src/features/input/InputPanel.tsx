import { useRef, useState } from 'react'
import { Mic, Upload, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'

interface Props {
  onBlob: (b: Blob, name: string) => void
  disabled?: boolean
}

/** 输入面板：上传文件 / 实时录音。 */
export function InputPanel({ onBlob, disabled }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [drag, setDrag] = useState(false)
  const [recording, setRecording] = useState(false)
  const recRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])

  const handleFile = (f: File | undefined | null) => {
    if (!f) return
    onBlob(f, f.name)
  }

  const startRec = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const mr = new MediaRecorder(stream)
    chunksRef.current = []
    mr.ondataavailable = (e) => {
      if (e.data.size) chunksRef.current.push(e.data)
    }
    mr.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
      onBlob(blob, `录音-${Date.now()}.webm`)
      stream.getTracks().forEach((t) => t.stop())
    }
    mr.start()
    recRef.current = mr
    setRecording(true)
  }

  const stopRec = () => {
    recRef.current?.stop()
    setRecording(false)
  }

  return (
    <Tabs defaultValue="upload" className="w-full">
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="upload" disabled={disabled}>上传文件</TabsTrigger>
        <TabsTrigger value="record" disabled={disabled}>实时录音</TabsTrigger>
      </TabsList>

      <TabsContent value="upload" className="mt-4">
        <div
          onDragOver={(e) => {
            e.preventDefault()
            setDrag(true)
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDrag(false)
            handleFile(e.dataTransfer.files?.[0])
          }}
          onClick={() => fileRef.current?.click()}
          className={cn(
            'flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed p-10 hover:bg-accent',
            drag && 'border-primary bg-accent',
          )}
        >
          <Upload className="mb-2 h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">拖入或点击选择音频 / 视频文件</p>
          <input
            ref={fileRef}
            type="file"
            accept="audio/*,video/*"
            className="hidden"
            onChange={(e) => handleFile(e.target.files?.[0])}
          />
        </div>
      </TabsContent>

      <TabsContent value="record" className="mt-4">
        <div className="flex flex-col items-center justify-center rounded-lg border p-10">
          {recording ? (
            <Button variant="destructive" onClick={stopRec}>
              <Square className="mr-2 h-4 w-4" /> 停止录音
            </Button>
          ) : (
            <Button onClick={startRec} disabled={disabled}>
              <Mic className="mr-2 h-4 w-4" /> 开始录音
            </Button>
          )}
          <p className="mt-2 text-sm text-muted-foreground">
            {recording ? '录音中…' : '使用麦克风实时录音'}
          </p>
        </div>
      </TabsContent>
    </Tabs>
  )
}
