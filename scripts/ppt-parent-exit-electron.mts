import {app} from 'electron'
import childProcess from 'node:child_process'
import {syncBuiltinESMExports} from 'node:module'
import {join, resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
const work = process.env.MEIJI_VISUAL_WORK
if (!work) throw new Error('Missing isolated fixture directory')
app.setName('Meiji PPT Parent Exit Baseline')
app.setPath('userData', join(work, 'parent-exit-profile'))
async function run() {
 await app.whenReady()
 if (resolve(app.getAppPath()) !== resolve(work!) || app.isPackaged) throw new Error('Unexpected fixture resource root')
 const original = childProcess.spawn
 let ownedPid: number | undefined,
  reported = false,
  receivedBytes = 0
 childProcess.spawn = ((...args: Parameters<typeof childProcess.spawn>) => {
  const child = original(...args)
  if (resolve(String(args[0])) === resolve(join(work!, 'resources/video/ffmpeg')))
   child.once('spawn', () => {
    ownedPid = child.pid
    process.stdout.write(JSON.stringify({kind: 'ppt-owned-started', pid: ownedPid, parentPid: process.pid}) + '\n')
   })
  return child
 }) as typeof childProcess.spawn
 syncBuiltinESMExports()
 const {ffmpeg} = await import(pathToFileURL(join(work!, 'ppt-owner.mjs')).href)
 await ffmpeg(
  ['-v', 'error', '-re', '-f', 'lavfi', '-i', 'color=s=16x16:r=5', '-pix_fmt', 'yuv420p', '-f', 'rawvideo', 'pipe:1'],
  new AbortController().signal,
  (bytes: Buffer) => {
   receivedBytes += bytes.length
   if (!reported && ownedPid && receivedBytes >= 384) {
    reported = true
    process.stdout.write(
     JSON.stringify({
      kind: 'ppt-owned-ready',
      pid: ownedPid,
      parentPid: process.pid,
      bytes: receivedBytes,
      frameBytes: 384
     }) + '\n'
    )
   }
  }
 )
 throw new Error('Baseline input unexpectedly completed')
}
void run().catch(error => {
 console.error(error instanceof Error ? error.message : 'Baseline failed')
 app.exit(1)
})
