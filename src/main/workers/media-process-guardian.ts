import {spawn, type ChildProcessWithoutNullStreams} from 'node:child_process'
import {z} from 'zod'
import {checkedMediaExecutable, mediaTool} from '@main/media/tools/media-executable'
const [resources, name, fallback] = process.argv.slice(2)
if (!process.send || !resources) throw new Error('媒体守护进程启动参数无效')
const tool = mediaTool(name)
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
  const path = await checkedMediaExecutable(resources, tool, process.platform, fallback === 'system-fallback')
  if (stopped) return
  child = spawn(path, value.args, {windowsHide: true, stdio: 'pipe'})
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
