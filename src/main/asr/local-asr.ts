import {app, utilityProcess} from 'electron'
import {spawn} from 'node:child_process'
import {checkedMediaExecutable, mediaFallbackAllowed} from '@main/media/tools/media-executable'
import {join, resolve, sep} from 'node:path'
import {fileURLToPath} from 'node:url'
import {existsSync} from 'node:fs'
import {mkdir, rm, stat, writeFile} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import {z} from 'zod'
import {parseSrt, toSrt} from '@shared/srt'

const replySchema = z.discriminatedUnion('kind', [
 z.object({kind: z.literal('progress'), message: z.string().max(2000)}),
 z.object({kind: z.literal('error'), message: z.string().max(4000)}),
 z.object({
  kind: z.literal('result'),
  duration: z.number().positive(),
  cues: z
   .array(z.object({from: z.number().nonnegative(), to: z.number().positive(), content: z.string().trim().min(1)}))
   .max(100000)
 })
])
export async function transcribeLocalVideo(video: string, signal: AbortSignal, progress: (message: string) => void) {
 const resources = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources')
 const model = join(resources, 'asr/onnx-small')
 if (!existsSync(join(model, 'acquisition.json')))
  throw new Error('本地字幕模型或视频组件未安装，请在「运行组件」中安装同版本组件')
 signal.throwIfAborted()
 const ffmpeg = await checkedMediaExecutable(
  resources,
  'ffmpeg',
  process.platform,
  mediaFallbackAllowed(app.isPackaged)
 )
 signal.throwIfAborted()
 const root = resolve(app.getPath('userData'), 'asr-tasks'),
  directory = join(root, randomUUID()),
  pcm = join(directory, 'audio.f32')
 const before = await stat(video)
 await mkdir(directory, {recursive: true})
 await writeFile(
  join(directory, 'recovery.json'),
  JSON.stringify({
   source: video,
   size: before.size,
   modified: before.mtimeMs,
   state: 'decoding',
   model: 'whisper-small-onnx-q8'
  })
 )
 progress('正在读取完整视频音频')
 await checkedMediaExecutable(resources, 'ffmpeg', process.platform, mediaFallbackAllowed(app.isPackaged))
 signal.throwIfAborted()
 await new Promise<void>((resolve, reject) => {
  const child = spawn(
   ffmpeg,
   [
    '-hide_banner',
    '-loglevel',
    'error',
    '-nostdin',
    '-i',
    video,
    '-vn',
    '-ac',
    '1',
    '-ar',
    '16000',
    '-f',
    'f32le',
    '-n',
    pcm
   ],
   {windowsHide: true, stdio: 'ignore'}
  )
  const abort = () => child.kill()
  signal.addEventListener('abort', abort, {once: true})
  child.once('error', () => {
   signal.removeEventListener('abort', abort)
   reject(new Error('视频处理组件无法启动'))
  })
  child.once('close', code => {
   signal.removeEventListener('abort', abort)
   signal.aborted
    ? reject(new Error('字幕转写已取消，原视频与恢复记录保留'))
    : code === 0
      ? resolve()
      : reject(new Error('完整音频读取失败，原视频保留'))
  })
  if (signal.aborted) abort()
 })
 signal.throwIfAborted()
 await writeFile(
  join(directory, 'recovery.json'),
  JSON.stringify({
   source: video,
   size: before.size,
   modified: before.mtimeMs,
   state: 'transcribing',
   model: 'whisper-small-onnx-q8'
  })
 )
 const cues = await new Promise<{from: number; to: number; content: string}[]>((resolve, reject) => {
  const child = utilityProcess.fork(fileURLToPath(new URL('./asr-worker.js', import.meta.url)), [model, pcm], {
   stdio: 'pipe',
   serviceName: '本地字幕转写'
  })
  let settled = false
  const finish = (error?: Error, cues?: {from: number; to: number; content: string}[]) => {
   if (settled) return
   settled = true
   signal.removeEventListener('abort', abort)
   child.kill()
   error ? reject(error) : resolve(cues!)
  }
  const abort = () => finish(new Error('字幕转写已取消，原视频与恢复记录保留'))
  signal.addEventListener('abort', abort, {once: true})
  child.stdout?.on('data', () => {})
  child.stderr?.on('data', () => {})
  child.once('exit', () => finish(new Error('转写工作进程中断，原视频与恢复记录保留')))
  child.on('message', (message: unknown) => {
   try {
    const reply = replySchema.parse(message)
    if (reply.kind === 'progress') progress(reply.message)
    else if (reply.kind === 'error') finish(new Error(reply.message))
    else {
     if (reply.cues.some(cue => cue.to <= cue.from || cue.to > reply.duration + 0.1)) throw new Error('字幕时间点无效')
     finish(undefined, reply.cues)
    }
   } catch (error) {
    finish(error instanceof Error ? error : new Error('字幕结果无法读取'))
   }
  })
  if (signal.aborted) abort()
 })
 const after = await stat(video)
 if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error('转写期间原视频改变，请重新选择')
 const segments = cues
  .sort((a, b) => a.from - b.from)
  .map((cue, index) => ({
   start: Math.round(cue.from * 1000),
   end: Math.round(Math.min(cue.to, cues[index + 1]?.from ?? cue.to) * 1000),
   text: cue.content
  }))
  .filter(cue => cue.end > cue.start)
 if (!segments.length) throw new Error('未识别到完整语音，原视频保留')
 const srt = toSrt(segments)
 parseSrt(srt)
 await writeFile(join(directory, 'result.srt'), srt)
 await writeFile(
  join(directory, 'recovery.json'),
  JSON.stringify({source: video, state: 'ready-to-save', count: segments.length})
 )
 return {
  srt,
  count: segments.length,
  cleanup: async () => {
   if (!resolve(directory).startsWith(root + sep)) throw new Error('字幕暂存目录超出清理范围')
   await rm(directory, {recursive: true, force: true})
  }
 }
}
