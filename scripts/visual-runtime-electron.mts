import {app, nativeImage, utilityProcess} from 'electron'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {mkdir, readFile, writeFile, copyFile, access} from 'node:fs/promises'
import fsPromises from 'node:fs/promises'
import childProcess from 'node:child_process'
import {syncBuiltinESMExports} from 'node:module'
import {join} from 'node:path'
import {pathToFileURL} from 'node:url'
const work = process.env.MEIJI_VISUAL_WORK!,
 results = process.env.MEIJI_VISUAL_RESULTS!,
 phase = process.env.MEIJI_VISUAL_PHASE!
if (!work || !results || !['capture', 'restart'].includes(phase)) throw new Error('Invalid visual fixture scope')
app.setName('Meiji Visual Runtime Fixture')
app.setPath('userData', join(work, 'electron-profile'))
const digest = async (path: string) =>
 createHash('sha256')
  .update(await readFile(path))
  .digest('hex')
type Capture = {
 id: string
 source: string
 sourceHash: string
 duration: number
 frames: Array<{path: string; time: number; hash: string}>
 gaps: unknown[]
}
async function run() {
 await app.whenReady()
 const checks: string[] = [],
  report: Record<string, unknown> = {status: 'running', phase, electron: process.versions.electron, checks}
 let owner: any
 const originalSpawn = childProcess.spawn
 const originalFork = utilityProcess.fork
 let utilityStarts = 0
 utilityProcess.fork = ((...args: Parameters<typeof utilityProcess.fork>) => {
  utilityStarts++
  return originalFork(...args)
 }) as typeof utilityProcess.fork
 let guardianStarts = 0
 childProcess.spawn = ((...args: Parameters<typeof childProcess.spawn>) => {
  if (Array.isArray(args[1]) && args[1].some(arg => String(arg).endsWith('media-process-guardian.js'))) guardianStarts++
  return originalSpawn(...args)
 }) as typeof childProcess.spawn
 syncBuiltinESMExports()
 try {
  const {MediaBackend, mediaCommand} = await import(pathToFileURL(join(work, 'owners.mjs')).href)
  const resources = join(work, 'resources'),
   data = join(work, 'data')
  await mkdir(data, {recursive: true})
  const newOwner = () =>
   new MediaBackend(resources, data, {
    readMedia: async () => {
     throw new Error('Unexpected external site request')
    }
   })
  owner = newOwner()
  const video = join(work, 'synthetic.mp4')
  if (phase === 'restart') {
   const saved = JSON.parse(await readFile(join(work, 'captures.json'), 'utf8')) as Capture[]
   for (const capture of saved) {
    const stored = JSON.parse(await readFile(join(data, 'native-visual', capture.id, 'source.json'), 'utf8'))
    assert.deepEqual(stored, capture)
    for (const frame of capture.frames) {
     assert.equal(await digest(frame.path), frame.hash)
     assert(!nativeImage.createFromPath(frame.path).isEmpty())
    }
   }
   checks.push(
    'persisted source.json and frame hashes readable in a second real Electron process; no restore API claimed'
   )
   const renewed: Capture = await owner.request('visual-frames', {
    id: '5'.repeat(32),
    path: video,
    expectedHash: await digest(video),
    cap: 2,
    policy: 'coverage'
   })
   assert.equal(renewed.frames.length, 2)
   checks.push('new capture through production facade succeeds after restart')
  } else {
   await mediaCommand(
    resources,
    'ffmpeg',
    [
     '-v',
     'error',
     '-f',
     'lavfi',
     '-i',
     'testsrc2=s=64x48:r=5',
     '-t',
     '6',
     '-c:v',
     'libx264',
     '-pix_fmt',
     'yuv420p',
     video
    ],
    new AbortController().signal
   )
   const hash = await digest(video),
    captures: Capture[] = []
   for (const [id, policy] of [
    ['1', 'coverage'],
    ['2', 'balanced']
   ]) {
    const capture: Capture = await owner.request('visual-frames', {
     id: id.repeat(32),
     path: video,
     expectedHash: hash,
     cap: 2,
     policy
    })
    assert.equal(capture.id, id.repeat(32))
    assert.equal(capture.source, video)
    assert.equal(capture.sourceHash, hash)
    assert.equal(capture.frames.length, 2)
    assert(capture.duration >= 5.9 && capture.duration <= 6.1)
    let previous = -1
    for (const [index, frame] of capture.frames.entries()) {
     assert.equal(await digest(frame.path), frame.hash)
     assert(frame.time >= 0 && frame.time < capture.duration && frame.time >= previous)
     previous = frame.time
     const image = nativeImage.createFromPath(frame.path)
     assert(!image.isEmpty())
     assert.equal(image.getSize().width, 1600)
     assert.equal(image.getSize().height, 1200)
     const bitmap = image.toBitmap()
     assert.equal(bitmap.length, 1600 * 1200 * 4)
     assert(new Set(bitmap.subarray(0, 4096)).size > 2)
     await copyFile(frame.path, join(results, policy + '-' + index + '.png'))
    }
    captures.push(capture)
    checks.push(
     'production ' + policy + ' capture: source identity, sorted times, nativeImage dimensions, pixel data and hashes'
    )
   }
   const imagePath = join(work, 'oversized.png')
   await writeFile(
    imagePath,
    nativeImage.createFromBitmap(Buffer.alloc(2000 * 1000 * 4, 127), {width: 2000, height: 1000}).toPNG()
   )
   const picture: Capture = await owner.request('visual-frames', {
    id: '3'.repeat(32),
    path: imagePath,
    expectedHash: await digest(imagePath),
    cap: 1,
    policy: 'coverage'
   })
   assert.equal(picture.frames.length, 1)
   assert.equal(picture.duration, 0)
   assert.equal(await digest(picture.frames[0].path), picture.frames[0].hash)
   assert(!nativeImage.createFromPath(picture.frames[0].path).isEmpty())
   assert.deepEqual(nativeImage.createFromPath(picture.frames[0].path).getSize(), {width: 1600, height: 800})
   captures.push(picture)
   checks.push('production nativeImage resizes a 2000x1000 still image to 1600x800')
   const before = guardianStarts
   await assert.rejects(
    owner.request('visual-frames', {
     id: '4'.repeat(32),
     path: video,
     expectedHash: '0'.repeat(64),
     cap: 2,
     policy: 'coverage'
    }),
    /原文件已改变/
   )
   assert.equal(guardianStarts, before)
   checks.push('wrong source hash rejected before any production guardian spawn')
   for (const action of ['visual-cancel', 'dispose']) {
    const id = (action === 'dispose' ? '7' : '6').repeat(32),
     original = fsPromises.lstat
    let entered!: () => void, release!: () => void
    const atBarrier = new Promise<void>(r => (entered = r)),
     gate = new Promise<void>(r => (release = r))
    fsPromises.lstat = (async (...args: Parameters<typeof fsPromises.lstat>) => {
     if (String(args[0]) === video) {
      entered()
      await gate
     }
     return original(...args)
    }) as typeof fsPromises.lstat
    syncBuiltinESMExports()
    const pending = owner.request('visual-frames', {id, path: video, expectedHash: hash, cap: 2, policy: 'coverage'}),
     rejected = assert.rejects(pending, /abort|cancel|取消/i)
    try {
     await atBarrier
     await assert.rejects(
      owner.request('visual-frames', {id, path: video, expectedHash: hash, cap: 2, policy: 'coverage'}),
      /已经在执行/
     )
     if (action === 'dispose') await owner.dispose()
     else await owner.request(action, {id})
     release()
     await rejected
     await assert.rejects(access(join(data, 'native-visual', id, 'source.json')))
     checks.push(action + ' during registered production task rejects without publishing source.json')
    } finally {
     release()
     fsPromises.lstat = original
     syncBuiltinESMExports()
    }
    if (action === 'dispose') owner = newOwner()
    const recovery: Capture = await owner.request('visual-frames', {
     id: (action === 'dispose' ? '9' : '8').repeat(32),
     path: video,
     expectedHash: hash,
     cap: 1,
     policy: 'coverage'
    })
    assert.equal(recovery.frames.length, 1)
    checks.push('subsequent capture not contaminated by ' + action)
   }
   assert(guardianStarts > 0)
   report.guardianStarts = guardianStarts
   await writeFile(join(work, 'captures.json'), JSON.stringify(captures))
  }
  assert.equal(utilityStarts, 0)
  checks.push('visual-only facade operations never start the download utilityProcess')
  assert.equal(owner.started, false)
  report.status = 'passed'
 } catch (error) {
  report.status = 'failed'
  report.error = error instanceof Error ? error.message : 'Unknown fixture failure'
 } finally {
  childProcess.spawn = originalSpawn
  utilityProcess.fork = originalFork
  syncBuiltinESMExports()
  try {
   await owner?.dispose()
  } catch {
   report.status = 'failed'
   report.error = 'Production owner disposal failed'
  }
  await writeFile(join(results, phase + '.json'), JSON.stringify(report, null, 2) + '\n')
  app.exit(report.status === 'passed' ? 0 : 1)
 }
}
void run().catch(async error => {
 await writeFile(join(results, phase + '.json'), JSON.stringify({status: 'failed', error: error.message}))
 app.exit(1)
})
