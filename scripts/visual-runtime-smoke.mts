import {build} from 'esbuild'
import {spawn, execFileSync} from 'node:child_process'
import {createRequire} from 'node:module'
import {createHash} from 'node:crypto'
import {chmod, copyFile, mkdir, mkdtemp, readFile, realpath, writeFile} from 'node:fs/promises'
import {dirname, isAbsolute, join, resolve} from 'node:path'
import {tmpdir, release} from 'node:os'
import {fileURLToPath, pathToFileURL} from 'node:url'
import {packageVideoCandidate} from './video-candidate-package.mts'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'),
 require = createRequire(import.meta.url)
const [artifactDirectory, outputDirectory] = process.argv.slice(2)
if (!artifactDirectory || !outputDirectory)
 throw new Error('Usage: node scripts/visual-runtime-smoke.mts <fixed artifact directory> <results directory>')
if (process.platform !== 'darwin' || process.arch !== 'arm64')
 throw new Error('Visual candidate runtime requires actual macOS arm64')
const results = resolve(outputDirectory),
 work = await mkdtemp(join(await realpath(tmpdir()), 'meiji-visual-runtime-'))
await mkdir(results, {recursive: true})
const report: Record<string, unknown> = {
 status: 'running',
 artifact: {id: '12108250900', run: '39051917827'},
 scope:
  'Real Electron production media facade and nativeImage, isolated synthetic files only; no installation or distribution approval.'
}
try {
 const candidate = await packageVideoCandidate({
  target: 'darwin-arm64',
  productVersion: '0.1.85',
  archive: join(resolve(artifactDirectory), 'source-build-candidate.tar.gz'),
  buildReport: join(resolve(artifactDirectory), 'build-result.json'),
  expectedArchiveSha256: '81375a75e36d74db16e18ead0de7e61e9d067eb9db434df442559790a2ca8bb4',
  expectedBuildReportSha256: '5acba42ea6367ba002f4fb5d107a1ba04322af9211cb13e05765a9adf47447b4',
  sourceBuildCommit: '4a53801d5485983742ff48fc9d547e8e0077f774',
  sourceBuildRun: '39051917827'
 })
 const resources = join(work, 'resources')
 await mkdir(join(resources, 'video'), {recursive: true})
 for (const tool of ['ffmpeg', 'ffprobe']) {
  const path = join(resources, 'video', tool)
  await copyFile(join(candidate.stage, 'payload', tool), path)
  const file = candidate.manifest.components[0].files.find(f => f.path === tool)!
  if (
   createHash('sha256')
    .update(await readFile(path))
    .digest('hex') !== file.sha256
  )
   throw new Error('Runtime tool copy digest mismatch')
  await chmod(path, 0o755)
 }
 report.candidate = candidate.report
 const exports =
  'export {MediaBackend} from ' +
  JSON.stringify(join(root, 'src/main/media.ts').replaceAll('\\', '/')) +
  ';export {mediaCommand} from ' +
  JSON.stringify(join(root, 'src/main/media-command.ts').replaceAll('\\', '/')) +
  ';'
 await build({
  stdin: {contents: exports, resolveDir: root, loader: 'ts'},
  outfile: join(work, 'owners.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  define: {'import.meta.url': JSON.stringify(pathToFileURL(join(work, 'owners.mjs')).href)},
  plugins: [
   {
    name: 'native-dependencies',
    setup(builder) {
     builder.onResolve({filter: /^[^./]/}, args => {
      if (isAbsolute(args.path)) return
      if (args.path === 'electron' || args.path.startsWith('node:')) return {path: args.path, external: true}
      return {path: import.meta.resolve(args.path), external: true}
     })
    }
   }
  ]
 })
 await build({
  entryPoints: [join(root, 'src/main/media-process-guardian.ts')],
  outfile: join(work, 'media-process-guardian.js'),
  bundle: true,
  platform: 'node',
  format: 'esm'
 })
 await writeFile(join(work, 'package.json'), JSON.stringify({type: 'module'}))
 await build({
  entryPoints: [join(root, 'scripts/visual-runtime-electron.mts')],
  outfile: join(work, 'fixture.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external'
 })
 for (const phase of ['capture', 'restart']) {
  const env: NodeJS.ProcessEnv = {
   ...process.env,
   MEIJI_VISUAL_WORK: work,
   MEIJI_VISUAL_RESULTS: results,
   MEIJI_VISUAL_PHASE: phase
  }
  delete env.ELECTRON_RUN_AS_NODE
  await new Promise<void>((done, fail) => {
   const child = spawn(require('electron') as string, [join(work, 'fixture.mjs')], {
    env,
    stdio: ['ignore', 'pipe', 'pipe']
   })
   let log = ''
   const timer = setTimeout(() => {
    child.kill()
    fail(new Error('Electron visual phase timed out: ' + phase))
   }, 120000)
   child.stdout.on('data', b => {
    log = (log + b.toString()).slice(-32000)
   })
   child.stderr.on('data', b => {
    log = (log + b.toString()).slice(-32000)
   })
   child.once('error', error => {
    clearTimeout(timer)
    fail(error)
   })
   child.once('close', code => {
    clearTimeout(timer)
    void (async () => {
     if (code !== 0) {
      await writeFile(join(results, phase + '-failure.log'), log)
      throw new Error('Electron visual phase failed: ' + phase)
     }
     done()
    })().catch(fail)
   })
  })
  const phaseReport = JSON.parse(await readFile(join(results, phase + '.json'), 'utf8'))
  if (phaseReport.status !== 'passed') throw new Error('Visual phase report failed')
  report[phase] = phaseReport
 }
 // Separate baseline: observe the unchanged PPT helper after its real parent dies.
 await build({
  entryPoints: [join(root, 'src/main/video-ppt.ts')],
  outfile: join(work, 'ppt-owner.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external',
  plugins: [
   {
    name: 'resolve-native',
    setup(builder) {
     builder.onResolve({filter: /^[^./]/}, args => {
      if (isAbsolute(args.path)) return
      if (args.path === 'electron' || args.path.startsWith('node:')) return {path: args.path, external: true}
      return {path: import.meta.resolve(args.path), external: true}
     })
    }
   }
  ]
 })
 await build({
  entryPoints: [join(root, 'scripts/ppt-parent-exit-electron.mts')],
  outfile: join(work, 'parent-exit.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external'
 })
 const baseline: Record<string, unknown> = {
  scope:
   'Forced termination of one owned Electron fixture calling the unchanged production PPT helper. An observed exit is not a universal process-tree guarantee.'
 }
 const environment: NodeJS.ProcessEnv = {...process.env, MEIJI_VISUAL_WORK: work}
 delete environment.ELECTRON_RUN_AS_NODE
 const parent = spawn(require('electron') as string, [join(work, 'parent-exit.mjs')], {
  env: environment,
  stdio: ['ignore', 'pipe', 'pipe']
 })
 let ownedPid: number | undefined,
  parentExited = false,
  diagnostic = ''
 const exited = new Promise<void>(resolveExit => {
  const finish = () => {
   parentExited = true
   resolveExit()
  }
  parent.once('exit', finish)
  parent.once('close', finish)
 })
 const gone = (pid: number) => {
  try {
   process.kill(pid, 0)
   return false
  } catch (error) {
   if ((error as NodeJS.ErrnoException).code === 'ESRCH') return true
   throw error
  }
 }
 const waitGone = async (pid: number) => {
  const deadline = Date.now() + 3000
  do {
   if (gone(pid)) return true
   await new Promise(r => setTimeout(r, 25))
  } while (Date.now() < deadline)
  return gone(pid)
 }
 try {
  await new Promise<void>((ready, fail) => {
   let buffer = ''
   const timer = setTimeout(() => fail(new Error('PPT baseline did not report owned PID and frame data')), 20000)
   const finish = (error?: Error) => {
    clearTimeout(timer)
    error ? fail(error) : ready()
   }
   parent.once('error', finish)
   parent.once('exit', () => finish(new Error('PPT baseline parent exited before readiness: ' + diagnostic)))
   parent.stderr.on('data', bytes => {
    diagnostic = (diagnostic + bytes.toString()).slice(-4000)
   })
   parent.stdout.on('data', bytes => {
    buffer += bytes.toString()
    if (buffer.length > 16000) {
     finish(new Error('Baseline readiness output exceeded limit'))
     return
    }
    for (const line of buffer.split('\n').slice(0, -1)) {
     try {
      const message = JSON.parse(line)
      if (
       message.kind === 'ppt-owned-started' &&
       message.parentPid === parent.pid &&
       Number.isSafeInteger(message.pid) &&
       message.pid > 0
      )
       ownedPid = message.pid
      if (
       message.kind === 'ppt-owned-ready' &&
       message.parentPid === parent.pid &&
       Number.isSafeInteger(message.pid) &&
       message.pid > 0 &&
       message.bytes >= 384 &&
       message.frameBytes === 384 &&
       message.pid === ownedPid
      ) {
       finish()
      }
     } catch {}
    }
    buffer = buffer.slice(buffer.lastIndexOf('\n') + 1)
   })
  })
  if (!ownedPid) throw new Error('No owned FFmpeg PID')
  baseline.parentPid = parent.pid
  baseline.ownedChildPid = ownedPid
  baseline.stdoutReady = true
  baseline.frameBytes = 384
  if (parentExited || parent.exitCode !== null || parent.signalCode !== null)
   throw new Error('Fixture parent already exited before forced termination')
  if (!parent.kill('SIGKILL')) throw new Error('Could not terminate owned fixture parent')
  await exited
  if (parent.signalCode !== 'SIGKILL') throw new Error('Fixture parent exit was not SIGKILL')
  baseline.parentExitSignal = parent.signalCode
  baseline.parentExitObserved = true
  baseline.naturalObservationLimitMs = 3000
  baseline.childAliveAfterParentExit = !(await waitGone(ownedPid))
 } catch (error) {
  baseline.error = error instanceof Error ? error.message : 'Parent baseline failed'
 } finally {
  try {
   if (!parentExited) {
    parent.kill('SIGKILL')
    await exited
   }
   if (ownedPid && !gone(ownedPid)) {
    process.kill(ownedPid, 'SIGTERM')
    baseline.ownedChildCleanup = (await waitGone(ownedPid))
     ? 'SIGTERM then ESRCH confirmed'
     : 'cleanup failed: still alive'
    if (baseline.ownedChildCleanup === 'cleanup failed: still alive')
     baseline.cleanupError = 'Owned FFmpeg cleanup did not complete'
   }
  } catch (error) {
   baseline.cleanupError = error instanceof Error ? error.message : 'Cleanup failed'
  }
  await writeFile(join(results, 'parent-exit.json'), JSON.stringify(baseline, null, 2) + '\n')
 }
 if (baseline.error || baseline.cleanupError) throw new Error(String(baseline.error || baseline.cleanupError))
 report.parentExit = baseline
 report.status = 'passed'
} catch (error) {
 report.status = 'failed'
 report.error = error instanceof Error ? error.message : 'Unknown failure'
 process.exitCode = 1
} finally {
 try {
  report.binding = {
   commit: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim(),
   dirty: !!execFileSync('git', ['status', '--porcelain'], {cwd: root, encoding: 'utf8'}).trim(),
   platform: process.platform,
   arch: process.arch,
   osRelease: release(),
   osProductVersion: execFileSync('/usr/bin/sw_vers', ['-productVersion'], {encoding: 'utf8'}).trim(),
   sourceHashes: Object.fromEntries(
    await Promise.all(
     [
      'scripts/visual-runtime-smoke.mts',
      'scripts/visual-runtime-electron.mts',
      'scripts/ppt-parent-exit-electron.mts',
      'src/main/video-ppt.ts',
      'src/main/ppt-extract.ts',
      'src/main/image-pdf.ts',
      'src/main/pdf-ppt-cleanup.ts',
      'src/main/video-policy.ts',
      'scripts/video-candidate-package.mts',
      'src/shared/runtime-descriptor-v2.ts',
      'src/shared/runtime-manifest-v2.ts',
      'scripts/media-build-source-lock.mts',
      'src/main/media.ts',
      'src/main/media-downloads.ts',
      'src/main/visual-frames.ts',
      'src/main/media-command.ts',
      'src/main/media-executable.ts',
      'src/main/media-process-guardian.ts'
     ].map(async path => [
      path,
      createHash('sha256')
       .update(await readFile(join(root, path)))
       .digest('hex')
     ])
    )
   )
  }
 } catch (error) {
  report.bindingError = error instanceof Error ? error.message : 'Source binding failed'
  report.status = 'failed'
  process.exitCode = 1
 }
 await writeFile(join(results, 'summary.json'), JSON.stringify(report, null, 2) + '\n')
 console.log(JSON.stringify({status: report.status, results}))
}
