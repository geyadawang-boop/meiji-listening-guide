import {spawn, type ChildProcessWithoutNullStreams} from 'node:child_process'
import {lstat, realpath} from 'node:fs/promises'
import {join, resolve} from 'node:path'
import {z} from 'zod'
const [resources, name] = process.argv.slice(2)
if (!process.send || !resources || !['ffmpeg.exe', 'ffprobe.exe'].includes(name))
 throw new Error('媒体守护进程启动参数无效')
let child: ChildProcessWithoutNullStreams | undefined,
 stopped = false,
 started = false
function stop() {
 stopped = true
 if (child && !child.killed) child.kill()
 if (!child) {
  process.exitCode = 130
  if (process.connected) process.disconnect()
 }
}
process.on('disconnect', stop)
process.on('message', raw => {
 void (async () => {
  const value = z
   .discriminatedUnion('kind', [
    z.object({kind: z.literal('start'), args: z.array(z.string().max(32768)).max(500)}),
    z.object({kind: z.literal('cancel')})
   ])
   .parse(raw)
  if (value.kind === 'cancel') {
   stop()
   return
  }
  if (started || stopped) throw new Error('媒体守护进程重复启动或已停止')
  started = true
  const path = resolve(resources, 'video', name),
   item = await lstat(path)
  if (!item.isFile() || item.isSymbolicLink() || resolve(await realpath(path)).toLowerCase() !== path.toLowerCase())
   throw new Error('媒体执行文件路径无效')
  if (stopped) return
  child = spawn(join(resources, 'video', name), value.args, {windowsHide: true, stdio: 'pipe'})
  child.once('spawn', () => {
   if (process.connected) process.send!({kind: 'media-started', pid: child!.pid})
  })
  child.stdin.end()
  child.stdout.pipe(process.stdout, {end: false})
  child.stderr.pipe(process.stderr, {end: false})
  child.once('error', () => {
   process.exitCode = 1
   if (process.connected) process.disconnect()
  })
  child.once('close', code => {
   process.exitCode = stopped ? 130 : (code ?? 1)
   if (process.connected) process.disconnect()
  })
 })().catch(() => {
  stop()
  process.exitCode = 1
 })
})
