import {build} from 'esbuild'
import {fork, execFile, execFileSync} from 'node:child_process'
import {createHash, randomUUID} from 'node:crypto'
import {chmod, copyFile, mkdir, mkdtemp, open, readFile, realpath, writeFile} from 'node:fs/promises'
import {constants} from 'node:fs'
import {dirname, join, resolve} from 'node:path'
import {release, tmpdir} from 'node:os'
import {once} from 'node:events'
import {fileURLToPath} from 'node:url'
import {mediaSources} from './media-source-lock.mts'
import {stageMedia} from './media-source-stage.mts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
function check(value: unknown, message: string): asserts value {
 if (!value) throw new Error(message)
}
async function sha256(path: string) {
 const file = await open(path, 'r'),
  hash = createHash('sha256')
 try {
  for await (const bytes of file.createReadStream({autoClose: false})) hash.update(bytes)
 } finally {
  await file.close()
 }
 return hash.digest('hex')
}
async function command(file: string, args: string[]) {
 return await new Promise<{
  code: number | string | null
  stdout: string
  stderr: string
  error?: string
  signal?: string | null
 }>(done => {
  execFile(
   file,
   args,
   {encoding: 'utf8', timeout: 20000, maxBuffer: 256000, windowsHide: true},
   (error, stdout, stderr) => {
    done({
     code: error ? (error.code ?? null) : 0,
     stdout,
     stderr,
     ...(error ? {error: error.message, signal: error.signal} : {})
    })
   }
  )
 })
}
async function download(asset: (typeof mediaSources)[number]['files'][number], input: string) {
 let url = asset.url as string
 const abort = AbortSignal.timeout(180000)
 for (let redirects = 0; redirects <= 5; redirects++) {
  const parsed = new URL(url)
  check(
   parsed.protocol === 'https:' &&
    !parsed.username &&
    !parsed.password &&
    (!parsed.port || parsed.port === '443') &&
    ['github.com', 'release-assets.githubusercontent.com'].includes(parsed.hostname),
   'Download redirect outside locked HTTPS hosts'
  )
  const response = await fetch(url, {redirect: 'manual', signal: abort})
  if ([301, 302, 303, 307, 308].includes(response.status)) {
   const location = response.headers.get('location')
   await response.body?.cancel()
   check(location && redirects < 5, 'Missing or excessive download redirects')
   url = new URL(location, url).href
   continue
  }
  check(response.ok && response.body, 'Asset download failed with HTTP ' + response.status)
  const declared = response.headers.get('content-length')
  check(declared === null || Number(declared) === asset.size, 'Download Content-Length differs from lock')
  const file = await open(join(input, asset.inputName), 'wx', 0o600),
   hash = createHash('sha256')
  let size = 0
  try {
   for await (const chunk of response.body) {
    size += chunk.length
    check(size <= asset.size, 'Downloaded asset exceeds locked size')
    hash.update(chunk)
    let offset = 0
    while (offset < chunk.length) {
     const write = await file.write(chunk, offset, chunk.length - offset)
     check(write.bytesWritten > 0, 'Download write made no progress')
     offset += write.bytesWritten
    }
   }
  } finally {
   await file.close()
  }
  check(size === asset.size && hash.digest('hex') === asset.sha256, 'Downloaded asset digest/size mismatch')
  return {id: asset.id, assetId: asset.assetId, size, sha256: asset.sha256}
 }
 throw new Error('Download redirect limit exceeded')
}
async function noLongerRunning(pid: number) {
 const until = Date.now() + 5000
 while (Date.now() < until) {
  try {
   process.kill(pid, 0)
  } catch (error) {
   if ((error as NodeJS.ErrnoException).code === 'ESRCH') return
   throw error
  }
  await new Promise(resolveDelay => setTimeout(resolveDelay, 50))
 }
 throw new Error('The guardian-owned media process remained alive after shutdown')
}
async function guardian(
 entry: string,
 resources: string,
 tool: 'ffmpeg' | 'ffprobe',
 args: string[],
 stop?: 'cancel' | 'disconnect'
) {
 return await new Promise<{code: number; stdout: string; stderr: string; stop?: string; childExited?: boolean}>(
  (done, fail) => {
   const child = fork(entry, [resources, tool], {stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true})
   const streamsClosed = Promise.all([once(child.stdout!, 'close'), once(child.stderr!, 'close')])
   let stdout = '',
    stderr = '',
    pid: number | undefined,
    stopping = false,
    failure = ''
   const timer = setTimeout(() => {
    failure = 'Guardian timed out'
    if (child.connected) child.disconnect()
    child.kill()
    fail(new Error(failure))
   }, 30000)
   const capture = (target: 'stdout' | 'stderr', data: Buffer) => {
    if (failure) return
    if (target === 'stdout') stdout += data.toString()
    else stderr += data.toString()
    if (stdout.length + stderr.length > 256000) {
     failure = 'Guardian output exceeded budget'
     if (child.connected) child.disconnect()
    }
   }
   child.stdout!.on('data', data => capture('stdout', data))
   child.stderr!.on('data', data => capture('stderr', data))
   child.once('error', error => {
    clearTimeout(timer)
    fail(error)
   })
   void streamsClosed.catch(error => {
    clearTimeout(timer)
    fail(error)
   })
   child.on('message', value => {
    const message = value as {kind?: string; pid?: number}
    if (message.kind !== 'media-started') return
    if (!Number.isSafeInteger(message.pid) || message.pid! <= 0 || pid !== undefined) {
     failure = 'Invalid guardian child identity'
     if (child.connected) child.disconnect()
     return
    }
    pid = message.pid
    if (stop)
     setTimeout(() => {
      stopping = true
      if (stop === 'disconnect') {
       if (child.connected) child.disconnect()
      } else if (child.connected) child.send({kind: 'cancel'})
     }, 300)
   })
   // Explicit parent IPC disconnect can omit ChildProcess 'close' on Windows Node.
   // Await the process exit and both actual output pipes independently instead.
   child.once('exit', (code, signal) => {
    void (async () => {
     await streamsClosed
     clearTimeout(timer)
     check(!failure, failure)
     check(pid, 'Guardian did not confirm starting the real binary')
     check(
      signal === null && code === (stop ? 130 : 0),
      'Guardian failed: ' + code + '/' + signal + '\n' + stderr.slice(-3000)
     )
     if (stop) {
      check(stopping, 'Binary finished before requested shutdown')
      await noLongerRunning(pid)
     }
     done({code, stdout, stderr, ...(stop ? {stop, childExited: true} : {})})
    })().catch(fail)
   })
   child.send({kind: 'start', args})
  }
 )
}

type Diagnostic = Awaited<ReturnType<typeof command>>
type ToolMetadata = {
 version: Diagnostic
 buildconf: Diagnostic
 dependencies: Diagnostic
 signatureDetails?: Diagnostic
 signatureVerification?: Diagnostic
 gatekeeperAssessment?: Diagnostic
 loader?: Diagnostic
}
function distributionFindings(metadata: Record<string, ToolMetadata>, lockedReasons: readonly string[]) {
 const reasons = new Set(lockedReasons)
 for (const info of Object.values(metadata)) {
  if (/(?:^|\s)--enable-nonfree(?:\s|$)/.test(info.buildconf.stdout + '\n' + info.buildconf.stderr))
   reasons.add('nonfree_build')
  if (
   info.signatureDetails &&
   /Signature=adhoc/i.test(info.signatureDetails.stdout + '\n' + info.signatureDetails.stderr)
  )
   reasons.add('ad_hoc_signature')
  if (info.gatekeeperAssessment && info.gatekeeperAssessment.code !== 0) reasons.add('gatekeeper_rejected')
 }
 return {distribution_status: reasons.size ? 'blocked' : 'pending', distribution_reasons: [...reasons]}
}

const outputArg = process.argv.indexOf('--output'),
 sourceArg = process.argv.indexOf('--source')
check(
 outputArg >= 0 && sourceArg >= 0 && process.argv.length === 6,
 'Usage: node scripts/media-candidate-smoke.mts --source <lockedSourceId> --output <resultsDirectory>'
)
const source = mediaSources.find(item => item.id === process.argv[sourceArg + 1])
check(source, 'Unknown locked source')
check(
 source.platform === process.platform && source.arch === process.arch,
 'Candidate must run on its actual target OS and architecture'
)
check(
 process.env.CI === 'true' && process.env.GITHUB_ACTIONS === 'true',
 'This execution tool is restricted to isolated GitHub CI runners'
)
const results = resolve(process.argv[outputArg + 1]),
 temp = await realpath(tmpdir())
await mkdir(results, {recursive: true})
const work = await mkdtemp(join(temp, 'meiji-media-candidate-')),
 input = join(work, 'input')
await mkdir(input)
const report: Record<string, unknown> = {
 status: 'running',
 runtime_status: 'running',
 distribution_status: source.distribution.status,
 distribution_reasons: source.distribution.reasons,
 source_distribution: source.distribution,
 sourceId: source.id,
 platform: process.platform,
 arch: process.arch,
 osRelease: release(),
 osProductVersion:
  process.platform === 'darwin'
   ? execFileSync('/usr/bin/sw_vers', ['-productVersion'], {encoding: 'utf8'}).trim()
   : undefined,
 commit: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim(),
 dirty: !!execFileSync('git', ['status', '--porcelain'], {cwd: root, encoding: 'utf8'}).trim(),
 pending: ['license_review', 'corresponding_source', 'distribution_signing', 'notarization', 'installer_integration'],
 scope:
  'Isolated third-party candidate execution on this runner only; local synthetic media, production guardian cancel and IPC disconnect. Not all POSIX process trees, external tools, signing or distribution approval.'
}
try {
 report.sourceHashes = Object.fromEntries(
  await Promise.all(
   [
    'scripts/media-candidate-smoke.mts',
    'scripts/media-source-lock.mts',
    'scripts/media-source-stage.mts',
    'src/main/workers/media-process-guardian.ts',
    'src/main/media/tools/media-executable.ts'
   ].map(async file => [file, await sha256(join(root, file))])
  )
 )
 const downloads = []
 for (const asset of source.files) downloads.push(await download(asset, input))
 report.downloads = downloads
 const staged = await stageMedia({
  sourceId: source.id,
  inputDirectory: input,
  stagingRoot: join(temp, 'meiji-media-stage-' + randomUUID())
 })
 report.staging = staged.report
 const resources = join(work, 'resources'),
  video = join(resources, 'video')
 await mkdir(video, {recursive: true})
 for (const asset of source.files) {
  const target = join(video, asset.outputName)
  await copyFile(join(staged.run, asset.outputName), target, constants.COPYFILE_EXCL)
  check((await sha256(target)) === asset.sha256, 'Execution payload digest changed')
  if (asset.id === 'ffmpeg' || asset.id === 'ffprobe') await chmod(target, 0o755)
 }
 const entry = join(work, 'guardian.mjs')
 await build({
  entryPoints: [join(root, 'src/main/workers/media-process-guardian.ts')],
  outfile: entry,
  bundle: true,
  platform: 'node',
  format: 'esm'
 })
 const metadata: Record<string, ToolMetadata> = {}
 for (const tool of ['ffmpeg', 'ffprobe'] as const) {
  const path = join(video, tool)
  metadata[tool] = {
   version: await guardian(entry, resources, tool, ['-version']),
   buildconf: await guardian(entry, resources, tool, ['-buildconf']),
   dependencies:
    process.platform === 'darwin'
     ? await command('/usr/bin/otool', ['-L', path])
     : await command('readelf', ['-h', '-l', '-d', path]),
   ...(process.platform === 'darwin'
    ? {
       signatureDetails: await command('/usr/bin/codesign', ['-d', '--verbose=4', path]),
       signatureVerification: await command('/usr/bin/codesign', [
        '--verify',
        '--deep',
        '--strict',
        '--verbose=2',
        path
       ]),
       gatekeeperAssessment: await command('/usr/sbin/spctl', ['--assess', '--type', 'execute', '--verbose=4', path])
      }
    : {loader: await command('ldd', [path])})
  }
 }
 report.metadata = metadata
 Object.assign(report, distributionFindings(metadata, source.distribution.reasons))
 const generated = join(work, 'generated.mkv'),
  transcoded = join(work, 'transcoded.avi')
 report.generate = await guardian(entry, resources, 'ffmpeg', [
  '-hide_banner',
  '-loglevel',
  'error',
  '-f',
  'lavfi',
  '-i',
  'color=c=red:s=16x16:r=5',
  '-frames:v',
  '5',
  '-c:v',
  'ffv1',
  generated
 ])
 report.transcode = await guardian(entry, resources, 'ffmpeg', [
  '-hide_banner',
  '-loglevel',
  'error',
  '-i',
  generated,
  '-c:v',
  'mpeg4',
  transcoded
 ])
 const probe = await guardian(entry, resources, 'ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', transcoded])
 const streams = JSON.parse(probe.stdout).streams as Array<{width: number; height: number; codec_name: string}>
 check(
  streams.some(stream => stream.width === 16 && stream.height === 16 && stream.codec_name === 'mpeg4'),
  'Probe did not confirm the synthetic transcode'
 )
 report.probe = probe
 const infinite = [
  '-hide_banner',
  '-loglevel',
  'error',
  '-re',
  '-f',
  'lavfi',
  '-i',
  'color=c=black:s=16x16:r=5',
  '-f',
  'null',
  '-'
 ]
 report.cancel = await guardian(entry, resources, 'ffmpeg', infinite, 'cancel')
 report.disconnect = await guardian(entry, resources, 'ffmpeg', infinite, 'disconnect')
 report.status = 'runtime_checks_passed'
 report.runtime_status = 'passed'
} catch (error) {
 report.status = 'failed'
 report.runtime_status = 'failed'
 report.error = error instanceof Error ? error.message : 'Unknown candidate failure'
 if (error instanceof Error && error.cause instanceof Error) report.cause = error.cause.message
 process.exitCode = 1
} finally {
 await writeFile(join(results, 'candidate.json'), JSON.stringify(report, null, 2) + '\n')
 console.log(
  JSON.stringify({
   status: report.status,
   runtime_status: report.runtime_status,
   distribution_status: report.distribution_status,
   results
  })
 )
}
