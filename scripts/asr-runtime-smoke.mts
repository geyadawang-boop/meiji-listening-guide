import {build} from 'esbuild'
import {spawn, execFileSync} from 'node:child_process'
import {createRequire} from 'node:module'
import {createHash} from 'node:crypto'
import {chmod, copyFile, cp, mkdir, mkdtemp, readFile, realpath, writeFile} from 'node:fs/promises'
import {dirname, isAbsolute, join, resolve} from 'node:path'
import {tmpdir, release} from 'node:os'
import {fileURLToPath} from 'node:url'
import {prepareAsrModel} from './asr-model-prepare.mts'
import {packageVideoCandidate} from './video-candidate-package.mts'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'),
 require = createRequire(import.meta.url)
const [artifactDirectory, outputDirectory] = process.argv.slice(2)
if (!artifactDirectory || !outputDirectory)
 throw new Error('Usage: node scripts/asr-runtime-smoke.mts <fixed Mac candidate artifact> <results directory>')
if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('ASR CI requires actual macOS arm64')
const results = resolve(outputDirectory),
 work = await mkdtemp(join(await realpath(tmpdir()), 'meiji-asr-runtime-'))
await mkdir(results, {recursive: true})
const report: Record<string, unknown> = {
 status: 'running',
 chineseTranscription: 'unverified',
 scope:
  'Isolated actual Electron inference with fixed public model and system-installed Mandarin TTS; no voice downloads, application installation or user audio.'
}
const sourceFiles = [
 'scripts/asr-runtime-smoke.mts',
 'scripts/asr-runtime-electron.mts',
 'scripts/asr-model-prepare.mts',
 'scripts/video-candidate-package.mts',
 'src/main/asr/local-asr.ts',
 'src/main/workers/asr-worker.ts',
 'src/main/asr/asr-inference.ts',
 'src/main/asr/silero-vad.ts',
 'src/main/media/tools/media-executable.ts',
 'src/shared/srt.ts'
]
const bundleFiles = ['owner.mjs', 'asr-worker.js', 'fixture.mjs']
async function hashes(directory: string, files: string[]) {
 return Object.fromEntries(
  await Promise.all(
   files.map(async file => [
    file,
    createHash('sha256')
     .update(await readFile(join(directory, file)))
     .digest('hex')
   ])
  )
 )
}
const sourceBefore = await hashes(root, sourceFiles)
let bundleBefore: Record<string, string> | undefined
try {
 const voices = execFileSync('/usr/bin/say', ['-v', '?'], {encoding: 'utf8', timeout: 15000})
 const voice = voices
  .split('\n')
  .map(line => /^(.+?)\s+zh_CN\s+#/.exec(line))
  .find(Boolean)?.[1]
  ?.trim()
 if (!voice) {
  report.status = 'unverified'
  report.reason = 'No installed zh_CN Mandarin voice; no fallback to English and no voice download'
  throw new Error(String(report.reason))
 }
 report.voice = voice
 const text = '今天我们学习数学。请打开课本，认真听讲。下课以后，记得完成练习。'
 execFileSync('/usr/bin/say', ['-v', voice, '-r', '150', '-o', join(work, 'speech.aiff'), text], {timeout: 30000})
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
 await mkdir(join(resources, 'asr'), {recursive: true})
 for (const tool of ['ffmpeg', 'ffprobe']) {
  const path = join(resources, 'video', tool)
  await copyFile(join(candidate.stage, 'payload', tool), path)
  if (
   createHash('sha256')
    .update(await readFile(path))
    .digest('hex') !== candidate.manifest.components[0].files.find(f => f.path === tool)!.sha256
  )
   throw new Error('Fixture tool copy digest mismatch')
  await chmod(path, 0o755)
 }
 report.candidate = candidate.report
 report.toolHashes = Object.fromEntries(
  await Promise.all(
   ['ffmpeg', 'ffprobe'].map(async tool => [
    tool,
    createHash('sha256')
     .update(await readFile(join(resources, 'video', tool)))
     .digest('hex')
   ])
  )
 )
 const ffmpeg = join(resources, 'video', 'ffmpeg'),
  ffprobe = join(resources, 'video', 'ffprobe')
 execFileSync(
  ffmpeg,
  [
   '-v',
   'error',
   '-i',
   join(work, 'speech.aiff'),
   '-ac',
   '1',
   '-ar',
   '16000',
   '-c:a',
   'pcm_s16le',
   join(work, 'speech.wav')
  ],
  {timeout: 30000}
 )
 execFileSync(
  ffmpeg,
  [
   '-v',
   'error',
   '-f',
   'lavfi',
   '-i',
   'anullsrc=r=16000:cl=mono',
   '-t',
   '2',
   '-c:a',
   'pcm_s16le',
   join(work, 'silence.wav')
  ],
  {timeout: 30000}
 )
 const duration = Number(
  JSON.parse(
   execFileSync(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', join(work, 'speech.wav')], {
    encoding: 'utf8',
    timeout: 15000
   })
  ).format.duration
 )
 if (!Number.isFinite(duration) || duration < 3 || duration > 30)
  throw new Error('Unexpected synthetic speech duration')
 const audio = {
  voice,
  text,
  duration,
  sha256: createHash('sha256')
   .update(await readFile(join(work, 'speech.wav')))
   .digest('hex')
 }
 report.silenceAudio = {
  sha256: (await hashes(work, ['silence.wav']))['silence.wav'],
  duration: Number(
   JSON.parse(
    execFileSync(
     ffprobe,
     ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', join(work, 'silence.wav')],
     {encoding: 'utf8', timeout: 15000}
    )
   ).format.duration
  )
 }
 report.audio = audio
 await writeFile(join(work, 'audio.json'), JSON.stringify(audio))
 const model = await prepareAsrModel({
  repository: 'onnx-community/whisper-small',
  revision: '36050c46d777d46dc4b5f43f6d90574fc38f8732',
  productVersion: '0.1.85'
 })
 await cp(model.model, join(resources, 'asr/onnx-small'), {recursive: true, errorOnExist: true, force: false})
 report.model = model.report
 for (const file of model.report.files) {
  const bytes = await readFile(join(resources, 'asr/onnx-small', file.path))
  if (bytes.length !== file.size || createHash('sha256').update(bytes).digest('hex') !== file.sha256)
   throw new Error('Copied model differs from fixed manifest: ' + file.path)
 }
 const plugin = {
  name: 'external-runtime',
  setup(builder: import('esbuild').PluginBuild) {
   builder.onResolve({filter: /^[^./]/}, args => {
    if (isAbsolute(args.path)) return
    if (args.path.startsWith('@main/') || args.path.startsWith('@shared/')) return
    if (args.path === 'electron' || args.path.startsWith('node:')) return {path: args.path, external: true}
    return {path: import.meta.resolve(args.path), external: true}
   })
  }
 }
 const contents =
  'export {transcribeLocalVideo} from ' +
  JSON.stringify(join(root, 'src/main/asr/local-asr.ts').replaceAll('\\', '/')) +
  ';export {parseSrt} from ' +
  JSON.stringify(join(root, 'src/shared/srt.ts').replaceAll('\\', '/')) +
  ';'
 await build({
  stdin: {contents, resolveDir: root, loader: 'ts'},
  outfile: join(work, 'owner.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  plugins: [plugin]
 })
 await build({
  entryPoints: [join(root, 'src/main/workers/asr-worker.ts')],
  outfile: join(work, 'asr-worker.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  plugins: [plugin]
 })
 await writeFile(join(work, 'package.json'), JSON.stringify({type: 'module', main: 'fixture.mjs'}))
 await build({
  entryPoints: [join(root, 'scripts/asr-runtime-electron.mts')],
  outfile: join(work, 'fixture.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external'
 })
 bundleBefore = await hashes(work, bundleFiles)
 const env: NodeJS.ProcessEnv = {...process.env, MEIJI_ASR_WORK: work, MEIJI_ASR_RESULTS: results}
 delete env.ELECTRON_RUN_AS_NODE
 await new Promise<void>((done, fail) => {
  const child = spawn(require('electron') as string, [join(work, 'fixture.mjs')], {
   env,
   stdio: ['ignore', 'pipe', 'pipe']
  })
  let log = ''
  let timedOut = false
  let forceTimer: ReturnType<typeof setTimeout> | undefined
  const timer = setTimeout(() => {
   timedOut = true
   child.kill()
   forceTimer = setTimeout(() => child.kill('SIGKILL'), 5000)
  }, 300000)
  child.stdout.on('data', bytes => {
   log = (log + bytes.toString()).slice(-32000)
  })
  child.stderr.on('data', bytes => {
   log = (log + bytes.toString()).slice(-32000)
  })
  child.once('error', error => {
   clearTimeout(timer)
   clearTimeout(forceTimer)
   fail(error)
  })
  child.once('close', code => {
   clearTimeout(timer)
   clearTimeout(forceTimer)
   void (async () => {
    if (timedOut || code !== 0) {
     await writeFile(join(results, 'inference-failure.log'), log)
     throw new Error(timedOut ? 'Real ASR inference timed out; fixture closed' : 'Real ASR inference failed')
    }
    done()
   })().catch(fail)
  })
 })
 const inference = JSON.parse(await readFile(join(results, 'inference.json'), 'utf8'))
 if (inference.status !== 'passed') throw new Error('Inference report not passed')
 report.status = 'passed'
 report.chineseTranscription = 'verified'
 report.inference = inference
} catch (error) {
 if (report.status !== 'unverified') report.status = 'failed'
 report.error = error instanceof Error ? error.message : 'Unknown ASR failure'
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
   sourceBefore,
   sourceAfter: await hashes(root, sourceFiles),
   bundleBefore,
   bundleAfter: bundleBefore ? await hashes(work, bundleFiles) : undefined
  }
  const binding = report.binding as {sourceAfter: Record<string, string>; bundleAfter?: Record<string, string>}
  if (
   JSON.stringify(sourceBefore) !== JSON.stringify(binding.sourceAfter) ||
   JSON.stringify(bundleBefore) !== JSON.stringify(binding.bundleAfter)
  ) {
   report.chineseTranscription = 'unverified'
   report.bindingError = 'Source or execution bundle changed during verification'
   report.status = 'failed'
   process.exitCode = 1
  }
 } catch (error) {
  report.chineseTranscription = 'unverified'
  report.bindingError = String(error)
  report.status = 'failed'
  process.exitCode = 1
 }
 await writeFile(join(results, 'summary.json'), JSON.stringify(report, null, 2) + '\n')
 console.log(JSON.stringify({status: report.status, chineseTranscription: report.chineseTranscription, results}))
}
