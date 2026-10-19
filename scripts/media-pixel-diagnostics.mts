import {spawn, execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {createReadStream} from 'node:fs'
import {chmod, mkdir, mkdtemp, readFile, realpath, writeFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
import {tmpdir} from 'node:os'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {build} from 'esbuild'
import {selectedMemberSize} from './video-candidate-package.mts'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'),
 require = createRequire(import.meta.url)
const profiles = {
 '39107720545': {
  artifact: '12128894879',
  archiveSha256: '2f4080d1643839e42e8ab2b9291e9bc84b7de51b3145da7c7d4ce471956277ba',
  reportSha256: 'e6c51891e751bb910aadffdd5679e839d692c97d5a174f86d66a6bcd48317c05',
  commit: '2a6f16c09c80ded635fae20e9f076823b84466d5',
  tools: {
   ffmpeg: '16b4d908f4fd11e6bb1b2d46d7bce39eae57ce24431dd5473a381f0bea1fb894',
   ffprobe: '7e955d1ec7c2488733676b50358764ba99f0a32f3ca2ba93625c56e7d4b1275e'
  }
 },
 '39109258520': {
  artifact: '12129619803',
  archiveSha256: 'ef851d22918a28b5cf04343a7e5016b1de9cad27fd41020b001f4ffd2646a06d',
  reportSha256: 'a6e74fac28111961075ab62d5dbb7598a7adfa3767953f424fea36903bb8b1e3',
  commit: '3b0682b0f21a1a2c4d90aefbf913df83df982919',
  tools: {
   ffmpeg: 'f5c900558c777cb6e9a33f8b3b425a79f2d9c19662bfb2f68cdd14fb8f02cd1f',
   ffprobe: '437ed76ecac601052e065cc62346e1de0485b4167233424303e75a139190d0ff'
  }
 }
} as const
const [input, destination, run = '39107720545'] = process.argv.slice(2)
function check(value: unknown, message: string): asserts value {
 if (!value) throw new Error(message)
}
check(
 input && destination && (process.argv.length === 4 || process.argv.length === 5),
 'Usage: media-pixel-diagnostics.mts <fixed artifact directory> <new results directory> [fixed run ID]'
)
check(run === '39107720545' || run === '39109258520', 'Unknown fixed candidate run ID')
const profile = profiles[run]
check(
 process.platform === 'linux' && process.arch === 'x64' && process.env.GITHUB_ACTIONS === 'true',
 'Isolated Linux x64 runner required'
)
const work = await mkdtemp(join(await realpath(tmpdir()), 'meiji-pixel-diagnostics-')),
 results = resolve(destination)
await mkdir(results)
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
async function fileHash(path: string) {
 const digest = createHash('sha256')
 for await (const bytes of createReadStream(path)) digest.update(bytes)
 return digest.digest('hex')
}
const sourceFiles = [
 'scripts/media-pixel-diagnostics.mts',
 'scripts/video-candidate-package.mts',
 'src/main/workers/media-process-guardian.ts',
 'src/main/media/tools/media-executable.ts'
]
async function sourceHashes() {
 return Object.fromEntries(await Promise.all(sourceFiles.map(async file => [file, await fileHash(join(root, file))])))
}
const report: Record<string, unknown> = {
 status: 'running',
 scope:
  'Fixed Linux candidate pixel diagnosis only; generated synthetic media, no installation or production parameter change.',
 sourceBefore: await sourceHashes(),
 probes: []
}
const probes = report.probes as unknown[]
async function execute(file: string, args: string[], budget = 1024 * 1024, guardianArgs?: string[]) {
 return await new Promise<{stdout: Buffer; stderr: string}>((done, fail) => {
  const child = spawn(file, args, {
   detached: true,
   stdio: guardianArgs ? ['ignore', 'pipe', 'pipe', 'ipc'] : ['ignore', 'pipe', 'pipe'],
   env: {...process.env, LC_ALL: 'C', LANG: 'C', TAR_OPTIONS: ''}
  })
  const chunks: Buffer[] = [],
   errors: Buffer[] = []
  let bytes = 0,
   failure = '',
   escalation: ReturnType<typeof setTimeout> | undefined
  const stop = () => {
   if (!child.pid) return
   try {
    process.kill(-child.pid, 'SIGTERM')
   } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ESRCH') failure += String(e)
   }
   escalation ??= setTimeout(() => {
    try {
     if (child.pid) process.kill(-child.pid, 'SIGKILL')
    } catch {}
   }, 3000)
  }
  const timer = setTimeout(() => {
   failure = 'Probe timed out'
   stop()
  }, 60000)
  const capture = (target: Buffer[], chunk: Buffer) => {
   bytes += chunk.length
   if (bytes > budget) {
    failure = 'Probe byte budget exceeded'
    stop()
   } else target.push(chunk)
  }
  child.stdout!.on('data', b => capture(chunks, b))
  child.stderr!.on('data', b => capture(errors, b))
  child.once('error', error => {
   clearTimeout(timer)
   clearTimeout(escalation)
   fail(error)
  })
  child.once('close', code => {
   clearTimeout(timer)
   clearTimeout(escalation)
   const stderr = Buffer.concat(errors).toString('utf8')
   if (failure || code !== 0) fail(new Error(failure || 'Probe failed: ' + code + ' ' + stderr.slice(-2000)))
   else done({stdout: Buffer.concat(chunks), stderr})
  })
  if (guardianArgs) child.once('spawn', () => child.send!({kind: 'start', args: guardianArgs}))
 })
}
function stats(bytes: Buffer, width: number, height: number, channels = 1) {
 const frameSize = width * height * channels,
  histogram = Array<number>(256).fill(0)
 let min = 255,
  max = 0
 for (const value of bytes) {
  histogram[value]++
  min = Math.min(min, value)
  max = Math.max(max, value)
 }
 const frames = []
 for (let offset = 0; offset + frameSize <= bytes.length; offset += frameSize) {
  const rows = []
  for (let y = 0; y < height; y++) {
   const row = bytes.subarray(offset + y * width * channels, offset + (y + 1) * width * channels)
   rows.push({y, sha256: hash(row), min: Math.min(...row), max: Math.max(...row)})
  }
  const frame = bytes.subarray(offset, offset + frameSize),
   abnormal = []
  for (let i = 0; channels === 1 && i < frame.length; i++)
   if (Math.abs(frame[i] - 76) > 1 && abnormal.length < 64)
    abnormal.push({x: i % width, y: Math.floor(i / width), value: frame[i]})
  frames.push({sha256: hash(frame), rows, abnormalSample: abnormal})
 }
 return {
  bytes: bytes.length,
  width,
  height,
  channels,
  frameSize,
  frameCount: bytes.length / frameSize,
  sha256: hash(bytes),
  min,
  max,
  histogram,
  utf8RoundtripBytes: Buffer.byteLength(bytes.toString('utf8')),
  frames
 }
}
try {
 const osRelease = await readFile('/etc/os-release', 'utf8')
 check(/^ID=ubuntu$/m.test(osRelease) && /^VERSION_ID="24\.04"$/m.test(osRelease), 'Ubuntu 24.04 required')
 report.osRelease = osRelease
 const archive = join(resolve(input), 'source-build-candidate.tar.gz'),
  buildReport = join(resolve(input), 'build-result.json')
 check((await fileHash(archive)) === profile.archiveSha256, 'Fixed archive mismatch')
 check((await fileHash(buildReport)) === profile.reportSha256, 'Fixed build report mismatch')
 const candidate = JSON.parse(await readFile(buildReport, 'utf8'))
 check(
  candidate.binding?.commit === profile.commit &&
   candidate.binding?.dirty === false &&
   candidate.binding?.platform === 'linux' &&
   candidate.binding?.arch === 'x64' &&
   candidate.state === 'source_build_candidate_verified',
  'Candidate binding mismatch'
 )
 const probeSources = []
 for (const [historical, current] of [
  ['src/main/media-process-guardian.ts', 'src/main/workers/media-process-guardian.ts'],
  ['src/main/media-executable.ts', 'src/main/media/tools/media-executable.ts']
 ]) {
  // Verify the immutable build source at its original locator; the migrated probe is recorded separately.
  // A shallow checkout without this commit fails explicitly instead of substituting current source bytes.
  const historicalSha256 = hash(execFileSync('git', ['show', profile.commit + ':' + historical], {cwd: root})),
   currentSha256 = await fileHash(join(root, current))
  check(historicalSha256 === candidate.binding.sourceHashes[historical], 'Fixed build source mismatch: ' + historical)
  probeSources.push({
   historical,
   current,
   historicalSha256,
   currentSha256,
   identical: historicalSha256 === currentSha256
  })
 }
 report.probeSources = {
  scope: 'Current production probe; not byte-identical to the historical build probe',
  files: probeSources
 }
 report.candidate = {
  run,
  artifact: profile.artifact,
  reportSha256: profile.reportSha256,
  archiveSha256: candidate.archiveSha256,
  binding: candidate.binding
 }
 check(candidate.archiveSha256 === (await fileHash(archive)), 'Report/archive binding mismatch')
 const resources = join(work, 'resources')
 await mkdir(join(resources, 'video'), {recursive: true})
 const listing = (await execute('/usr/bin/bsdtar', ['-tvf', archive], 32 * 1024 * 1024)).stdout.toString('utf8')
 for (const [tool, expected] of Object.entries(profile.tools)) {
  const member = 'prefix/bin/' + tool,
   size = selectedMemberSize(listing, member),
   path = join(resources, 'video', tool)
  const data = (await execute('/usr/bin/bsdtar', ['-xOf', archive, member], 256 * 1024 * 1024)).stdout
  check(
   data.length === size && hash(data) === expected && candidate.diagnostics[tool].sha256 === expected,
   'Extracted tool identity mismatch'
  )
  await writeFile(path, data, {flag: 'wx'})
  await chmod(path, 0o755)
 }
 const ffmpeg = join(resources, 'video/ffmpeg'),
  ffprobe = join(resources, 'video/ffprobe'),
  entry = join(work, 'guardian.mjs')
 await build({
  entryPoints: [join(root, 'src/main/workers/media-process-guardian.ts')],
  outfile: entry,
  bundle: true,
  platform: 'node',
  format: 'esm'
 })
 const bundleBefore = await fileHash(entry)
 report.guardianBundleBefore = bundleBefore
 const canvasRequire = createRequire(require.resolve('pdfjs-dist/package.json'))
 const canvas = canvasRequire('@napi-rs/canvas') as {
  createCanvas: (
   w: number,
   h: number
  ) => {
   getContext: (type: '2d') => {
    drawImage: (image: unknown, x: number, y: number) => void
    getImageData: (x: number, y: number, w: number, h: number) => {data: Uint8ClampedArray}
   }
  }
  loadImage: (bytes: Buffer) => Promise<{width: number; height: number}>
 }
 report.pngDecoder = {package: '@napi-rs/canvas', version: canvasRequire('@napi-rs/canvas/package.json').version}
 const video = join(work, 'red.mp4')
 await execute(ffmpeg, [
  '-v',
  'error',
  '-f',
  'lavfi',
  '-i',
  'color=c=red:s=32x32:r=10',
  '-f',
  'lavfi',
  '-i',
  'sine=frequency=440:sample_rate=48000',
  '-t',
  '1',
  '-c:v',
  'libx264',
  '-preset',
  'fast',
  '-c:a',
  'aac',
  video
 ])
 report.inputProbe = JSON.parse(
  (await execute(ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', video])).stdout.toString(
   'utf8'
  )
 )
 report.inputSha256 = await fileHash(video)
 const modes = [
  {name: 'default', args: []},
  {name: 'single-thread', args: ['-threads', '1', '-filter_threads', '1']},
  {name: 'cpu-flags-zero', args: ['-cpuflags', '0']}
 ] as const
 const filters = [
  {name: 'gray', vf: 'fps=2,format=gray', w: 32, h: 32},
  {name: 'crop', vf: 'fps=2,crop=16:16,format=gray', w: 16, h: 16},
  {name: 'scale', vf: 'fps=2,scale=32:18,format=gray', w: 32, h: 18},
  {name: 'crop-scale', vf: 'fps=2,crop=16:16,scale=32:18,format=gray', w: 32, h: 18},
  {name: 'gray-first', vf: 'fps=2,format=gray,crop=16:16,scale=32:18', w: 32, h: 18}
 ]
 for (const source of ['h264', 'lavfi']) {
  const inputs = source === 'h264' ? ['-i', video] : ['-f', 'lavfi', '-i', 'color=c=red:s=32x32:r=10:d=1']
  const redPng = (
   await execute(ffmpeg, ['-v', 'error', ...inputs, '-frames:v', '1', '-f', 'image2pipe', '-c:v', 'png', 'pipe:1'])
  ).stdout
  const redImage = await canvas.loadImage(redPng),
   redCanvas = canvas.createCanvas(redImage.width, redImage.height),
   redContext = redCanvas.getContext('2d')
  redContext.drawImage(redImage, 0, 0)
  const redPixels = redContext.getImageData(0, 0, redImage.width, redImage.height).data
  let redCorrect = redImage.width === 32 && redImage.height === 32
  for (let i = 0; i < redPixels.length; i += 4)
   redCorrect &&= redPixels[i] >= 250 && redPixels[i + 1] <= 3 && redPixels[i + 2] <= 3 && redPixels[i + 3] === 255
  await writeFile(join(results, source + '-input.png'), redPng)
  probes.push({source, stage: 'independent-input-png', redCorrect, pixels: stats(Buffer.from(redPixels), 32, 32, 4)})
  for (const mode of modes)
   for (const filter of filters) {
    const args = ['-v', 'error', ...mode.args, ...inputs, '-an', '-vf', filter.vf, '-f', 'rawvideo', 'pipe:1']
    const direct = await execute(ffmpeg, args)
    const mediated = await execute(process.execPath, [entry, resources, 'ffmpeg'], 1024 * 1024, args)
    const detail = stats(direct.stdout, filter.w, filter.h)
    const png = (
     await execute(ffmpeg, [
      '-v',
      'error',
      ...mode.args,
      ...inputs,
      '-an',
      '-vf',
      filter.vf,
      '-frames:v',
      '1',
      '-c:v',
      'png',
      '-f',
      'image2pipe',
      'pipe:1'
     ])
    ).stdout
    const image = await canvas.loadImage(png),
     surface = canvas.createCanvas(image.width, image.height),
     context = surface.getContext('2d')
    context.drawImage(image, 0, 0)
    const pixels = context.getImageData(0, 0, image.width, image.height).data
    let pngCorrect = image.width === filter.w && image.height === filter.h
    for (let i = 0; i < pixels.length; i += 4)
     pngCorrect &&=
      Math.abs(pixels[i] - 76) <= 1 &&
      pixels[i] === pixels[i + 1] &&
      pixels[i] === pixels[i + 2] &&
      pixels[i + 3] === 255
    const name = source + '-' + mode.name + '-' + filter.name
    await writeFile(join(results, name + '.png'), png)
    probes.push({
     source,
     mode: mode.name,
     filter: filter.vf,
     args,
     raw: detail,
     expectedBytes: 2 * filter.w * filter.h,
     expectedUniformGray: 76,
     byteCountCorrect: detail.bytes === 2 * filter.w * filter.h,
     uniformGrayCorrect: detail.min >= 75 && detail.max <= 77,
     guardianMatches: mediated.stdout.equals(direct.stdout),
     guardianSha256: hash(mediated.stdout),
     pngCorrect,
     pngPixels: stats(Buffer.from(pixels), image.width, image.height, 4)
    })
    await writeFile(join(results, 'partial.json'), JSON.stringify(report, null, 2) + '\n')
   }
 }
 report.guardianBundleAfter = await fileHash(entry)
 check(report.guardianBundleAfter === bundleBefore, 'Guardian bundle changed')
 report.status = 'diagnosed'
 report.pixelOraclesPassed = (probes as Array<Record<string, unknown>>).every(p =>
  p.stage ? p.redCorrect : p.byteCountCorrect && p.uniformGrayCorrect && p.guardianMatches && p.pngCorrect
 )
 if (!report.pixelOraclesPassed) process.exitCode = 1
} catch (error) {
 report.status = 'failed'
 report.error = error instanceof Error ? error.message : String(error)
 process.exitCode = 1
} finally {
 report.sourceAfter = await sourceHashes()
 if (JSON.stringify(report.sourceBefore) !== JSON.stringify(report.sourceAfter)) {
  report.status = 'failed'
  report.bindingError = 'Source changed'
  process.exitCode = 1
 }
 report.binding = {
  commit: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim(),
  dirty: !!execFileSync('git', ['status', '--porcelain'], {cwd: root, encoding: 'utf8'}).trim(),
  platform: process.platform,
  arch: process.arch
 }
 await writeFile(join(results, 'pixel-diagnostics.json'), JSON.stringify(report, null, 2) + '\n')
 console.log(JSON.stringify({status: report.status, pixelOraclesPassed: report.pixelOraclesPassed, results}))
}
