import {app, nativeImage} from 'electron'
import {mediaCommand} from '@main/media/tools/media-command'
import {mediaFallbackAllowed, type MediaTool} from '@main/media/tools/media-executable'
import {createHash} from 'node:crypto'
import {createReadStream} from 'node:fs'
import {mkdir, lstat, readFile, realpath, rm, writeFile} from 'node:fs/promises'
import {extname, join, resolve, sep} from 'node:path'
import {z} from 'zod'

async function digest(path: string) {
 const hash = createHash('sha256')
 for await (const bytes of createReadStream(path)) hash.update(bytes)
 return hash.digest('hex')
}
const requestSchema = z.object({
 id: z.string().regex(/^[a-f0-9]{32}$/),
 path: z.string().min(1),
 expectedHash: z.string().regex(/^[a-f0-9]{64}$/),
 cap: z.number().int().min(1).max(12),
 policy: z.enum(['balanced', 'coverage'])
})
type Capture = {
 id: string
 source: string
 sourceHash: string
 duration: number
 frames: {path: string; time: number; hash: string}[]
 gaps: unknown[]
}
export function coverageTimes(duration: number, cap: number): number[] {
 const count = Math.min(cap, Math.max(1, Math.ceil(duration / 5)))
 return Array.from({length: count}, (_, index) =>
  Math.min(Math.max(0, duration - 0.05), (duration * (index + 0.5)) / count)
 )
}
export class NativeVisualFrames {
 private cancels = new Map<string, AbortController>()
 constructor(
  private resources: string,
  private root: string
 ) {}
 get started() {
  return this.cancels.size > 0
 }
 private command(executable: MediaTool, args: string[], signal: AbortSignal, stream?: (bytes: Buffer) => void) {
  return mediaCommand(this.resources, executable, args, signal, stream, undefined, mediaFallbackAllowed(app.isPackaged))
 }
 dispose() {
  for (const controller of this.cancels.values()) controller.abort()
 }
 cancel(id: string) {
  z.string()
   .regex(/^[a-f0-9]{32}$/)
   .parse(id)
  this.cancels.get(id)?.abort()
  return true
 }
 async cleanup(id: string) {
  z.string()
   .regex(/^[a-f0-9]{32}$/)
   .parse(id)
  if (this.cancels.has(id)) throw new Error('画面仍在提取，请稍后清理')
  const base = resolve(this.root, 'native-visual'),
   directory = join(base, id)
  try {
   const item = await lstat(directory)
   if (
    item.isSymbolicLink() ||
    !item.isDirectory() ||
    !(await realpath(directory)).startsWith((await realpath(base)) + sep)
   )
    throw new Error('画面清理目录无效')
  } catch (error) {
   if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true
   throw error
  }
  await rm(directory, {recursive: true, force: true})
  return true
 }
 async capture(input: unknown): Promise<Capture> {
  const request = requestSchema.parse(input),
   controller = new AbortController()
  if (this.cancels.has(request.id)) throw new Error('该画面任务已经在执行')
  this.cancels.set(request.id, controller)
  try {
   const source = resolve(request.path),
    item = await lstat(source)
   if (item.isSymbolicLink() || !item.isFile()) throw new Error('所选源文件不可用')
   const hash = await digest(source)
   if (hash !== request.expectedHash) throw new Error('原文件已改变，请重新建立任务')
   const directory = join(this.root, 'native-visual', request.id)
   await mkdir(directory, {recursive: true})
   if (
    (await lstat(directory)).isSymbolicLink() ||
    !(await realpath(directory)).startsWith((await realpath(join(this.root, 'native-visual'))) + sep)
   )
    throw new Error('画面暂存目录无效')
   const frames: Capture['frames'] = []
   let duration = 0
   if (['.png', '.jpg', '.jpeg', '.webp'].includes(extname(source).toLowerCase())) {
    const image = nativeImage.createFromPath(source),
     size = image.getSize()
    if (image.isEmpty()) throw new Error('图片无法读取')
    const ratio = Math.min(1, 1600 / Math.max(size.width, size.height))
    const path = join(directory, 'frame-1.png')
    await writeFile(
     path,
     image.resize({width: Math.round(size.width * ratio), height: Math.round(size.height * ratio)}).toPNG()
    )
    frames.push({path, time: 0, hash: await digest(path)})
   } else {
    const metadata = JSON.parse(
     await this.command(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,duration', '-of', 'json', source],
      controller.signal
     )
    )
    duration = z.coerce.number().positive().finite().parse(metadata.format?.duration)
    if (
     !Array.isArray(metadata.streams) ||
     !metadata.streams.some((stream: {codec_type?: string}) => stream.codec_type === 'video')
    )
     throw new Error('源文件没有视频画面')
    let times = coverageTimes(duration, request.cap)
    if (request.policy === 'balanced') {
     const bins = times.map(time => ({time, score: -1}))
     let pending = Buffer.alloc(0),
      previous: Buffer | undefined,
      index = 0
     await this.command(
      'ffmpeg',
      [
       '-hide_banner',
       '-loglevel',
       'error',
       '-nostdin',
       '-i',
       source,
       '-an',
       '-vf',
       'fps=1/5,scale=32:18,format=gray',
       '-f',
       'rawvideo',
       'pipe:1'
      ],
      controller.signal,
      bytes => {
       pending = Buffer.concat([pending, bytes])
       while (pending.length >= 576) {
        const pixels = Buffer.from(pending.subarray(0, 576))
        pending = pending.subarray(576)
        const time = Math.min(duration - 0.05, index++ * 5)
        let change = 0,
         light = 0
        for (let point = 0; point < pixels.length; point++) {
         light += pixels[point]
         change += previous ? Math.abs(pixels[point] - previous[point]) : 0
        }
        const bin = bins[Math.min(bins.length - 1, Math.floor((time / duration) * bins.length))],
         score = previous ? change / 576 : 1
        if (light / 576 > 4 && score > bin.score) {
         bin.time = Math.max(0, time)
         bin.score = score
        }
        previous = pixels
       }
      }
     )
     times = bins.map(bin => bin.time)
    }
    for (const [index, time] of times.entries()) {
     const path = join(directory, `frame-${index + 1}.png`)
     await this.command(
      'ffmpeg',
      [
       '-hide_banner',
       '-loglevel',
       'error',
       '-nostdin',
       '-ss',
       String(time),
       '-i',
       source,
       '-frames:v',
       '1',
       '-vf',
       'scale=1600:1600:force_original_aspect_ratio=decrease',
       '-y',
       path
      ],
      controller.signal
     )
     if (nativeImage.createFromPath(path).isEmpty()) throw new Error('截取的画面无法读取')
     frames.push({path, time, hash: await digest(path)})
    }
   }
   controller.signal.throwIfAborted()
   if ((await digest(source)) !== hash) throw new Error('提取期间源文件改变，请重新选择')
   const result: Capture = {id: request.id, source, sourceHash: hash, duration, frames, gaps: []}
   await writeFile(join(directory, 'source.json'), JSON.stringify(result))
   return result
  } finally {
   this.cancels.delete(request.id)
  }
 }
}
