import {spawn, execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {copyFile, mkdir, open, readFile, writeFile} from 'node:fs/promises'
import {join, dirname, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {build} from 'esbuild'
import {prepareBuildSources} from './media-source-prepare.mts'
import {buildSources} from './media-build-source-lock.mts'
import {verifySourceCodecs} from './media-source-codecs.mts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
function check(value: unknown, message: string): asserts value {
 if (!value) throw new Error(message)
}
const outputIndex = process.argv.indexOf('--output')
check(
 outputIndex === 2 && process.argv.length === 4,
 'Usage: node scripts/media-source-build.mts --output <new artifact directory>'
)
check(
 process.platform === 'darwin' && process.arch === 'arm64' && process.env.GITHUB_ACTIONS === 'true',
 'Source build runs only on isolated macOS arm64 GitHub runners'
)
const artifacts = resolve(process.argv[3])
await mkdir(artifacts, {recursive: false})
const logs = join(artifacts, 'logs')
await mkdir(logs)
const report: Record<string, unknown> = {
 state: 'building',
 distribution_status: 'pending',
 scope:
  'Source-build candidate only, not installed or released. GPL corresponding-source review, Developer ID signing and notarization remain pending.',
 commands: []
}
const commands = report.commands as unknown[]
async function execute(
 file: string,
 args: string[],
 cwd: string,
 env: NodeJS.ProcessEnv,
 label: string,
 allowFailure = false
) {
 const log = await open(join(logs, label + '.log'), 'wx')
 let text = '',
  timedOut = false
 try {
  return await new Promise<{code: number | null; output: string}>((done, fail) => {
   // This Mac-only runner creates and owns this process group; never adopt external PIDs.
   const child = spawn(file, args, {cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe']})
   let escalation: ReturnType<typeof setTimeout> | undefined
   const stopOwnedGroup = (signal: NodeJS.Signals) => {
    if (!child.pid) return
    try {
     process.kill(-child.pid, signal)
    } catch (error) {
     if ((error as NodeJS.ErrnoException).code !== 'ESRCH') fail(error)
    }
   }
   const timer = setTimeout(
    () => {
     timedOut = true
     stopOwnedGroup('SIGTERM')
     escalation = setTimeout(() => stopOwnedGroup('SIGKILL'), 3000)
    },
    20 * 60 * 1000
   )
   const chunks: Buffer[] = []
   let total = 0
   const receive = (bytes: Buffer) => {
    total += bytes.length
    if (total <= 16 * 1024 * 1024) chunks.push(bytes)
    text = (text + bytes.toString()).slice(-256000)
   }
   child.stdout.on('data', receive)
   child.stderr.on('data', receive)
   child.once('error', error => {
    clearTimeout(timer)
    if (escalation) clearTimeout(escalation)
    fail(error)
   })
   child.once('close', code => {
    clearTimeout(timer)
    if (escalation) clearTimeout(escalation)
    void (async () => {
     await log.writeFile(Buffer.concat(chunks))
     commands.push({file, args, cwd, label, code, timedOut, logBytes: total, logTruncated: total > 16 * 1024 * 1024})
     check(!timedOut, 'Build command timed out: ' + label)
     check(allowFailure || code === 0, 'Build command failed: ' + label + ' (' + code + ')')
     done({code, output: text})
    })().catch(fail)
   })
  })
 } finally {
  await log.close()
 }
}
try {
 const prepared = await prepareBuildSources({sourceIds: buildSources.map(s => s.id)})
 report.preparation = prepared.report
 await writeFile(join(artifacts, 'source-report.json'), JSON.stringify(prepared.report, null, 2) + '\n')
 const prefix = join(prepared.work, 'prefix')
 await mkdir(prefix)
 const pkg = execFileSync('/usr/bin/which', ['pkg-config'], {encoding: 'utf8'}).trim()
 check(pkg.startsWith('/') && !pkg.includes('\n'), 'pkg-config path unavailable')
 const sdk = execFileSync('/usr/bin/xcrun', ['--sdk', 'macosx', '--show-sdk-path'], {encoding: 'utf8'}).trim()
 const env: NodeJS.ProcessEnv = {
  PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
  HOME: process.env.HOME,
  TMPDIR: process.env.TMPDIR,
  LC_ALL: 'C',
  LANG: 'C',
  CC: '/usr/bin/clang',
  CXX: '/usr/bin/clang++',
  AR: '/usr/bin/ar',
  RANLIB: '/usr/bin/ranlib',
  SDKROOT: sdk,
  MACOSX_DEPLOYMENT_TARGET: '14.0',
  CFLAGS: '-O2 -fPIC',
  CXXFLAGS: '-O2 -fPIC',
  CPPFLAGS: '-I' + prefix + '/include',
  LDFLAGS: '-L' + prefix + '/lib',
  PKG_CONFIG: pkg,
  PKG_CONFIG_PATH: '',
  PKG_CONFIG_LIBDIR: prefix + '/lib/pkgconfig',
  PKG_CONFIG_SYSROOT_DIR: ''
 }
 report.environment = {...env, HOME: '<runner-home>', TMPDIR: '<runner-temp>'}
 report.toolchain = {
  clang: (await execute('/usr/bin/clang', ['--version'], prepared.work, env, 'clang')).output,
  pkgConfig: (await execute(pkg, ['--version'], prepared.work, env, 'pkg-config')).output,
  sdk,
  platform: process.platform,
  arch: process.arch
 }
 const configs: Record<string, string[]> = {
  x264: ['--enable-static', '--enable-pic', '--disable-cli', '--disable-opencl', '--disable-asm'],
  vpx: [
   '--target=arm64-darwin-gcc',
   '--enable-vp9',
   '--enable-static',
   '--disable-shared',
   '--enable-pic',
   '--disable-examples',
   '--disable-tools',
   '--disable-docs',
   '--disable-unit-tests',
   '--disable-neon-asm'
  ],
  lame: ['--enable-static', '--disable-shared', '--disable-frontend', '--with-pic'],
  opus: [
   '--enable-static',
   '--disable-shared',
   '--with-pic',
   '--disable-extra-programs',
   '--disable-doc',
   '--disable-asm'
  ],
  ogg: ['--enable-static', '--disable-shared', '--with-pic'],
  vorbis: ['--enable-static', '--disable-shared', '--with-pic', '--disable-docs', '--disable-examples'],
  ffmpeg: [
   '--disable-autodetect',
   '--enable-gpl',
   '--disable-nonfree',
   '--enable-static',
   '--disable-shared',
   '--disable-ffplay',
   '--disable-doc',
   '--enable-ffmpeg',
   '--enable-ffprobe',
   '--enable-libx264',
   '--enable-libvpx',
   '--enable-libmp3lame',
   '--enable-libopus',
   '--enable-libvorbis',
   '--enable-zlib',
   '--pkg-config=' + pkg,
   '--pkg-config-flags=--static',
   '--extra-cflags=-I' + prefix + '/include',
   '--extra-ldflags=-L' + prefix + '/lib'
  ]
 }
 for (const id of ['x264', 'vpx', 'lame', 'opus', 'ogg', 'vorbis', 'ffmpeg']) {
  const receipt = prepared.report.receipts.find(r => r.source.id === id)!
  const cwd = join(prepared.work, receipt.path)
  console.log('Building source: ' + id)
  await execute(join(cwd, 'configure'), ['--prefix=' + prefix, ...configs[id]], cwd, env, id + '-configure')
  await execute('/usr/bin/make', ['-j3'], cwd, env, id + '-make')
  await execute('/usr/bin/make', ['install'], cwd, env, id + '-install')
 }
 const resources = join(prepared.work, 'runtime'),
  video = join(resources, 'video')
 await mkdir(video, {recursive: true})
 for (const tool of ['ffmpeg', 'ffprobe']) await copyFile(join(prefix, 'bin', tool), join(video, tool))
 const entry = join(prepared.work, 'guardian.mjs')
 await build({
  entryPoints: [join(root, 'src/main/media-process-guardian.ts')],
  outfile: entry,
  bundle: true,
  platform: 'node',
  format: 'esm'
 })
 const diagnostics: Record<string, unknown> = {}
 for (const tool of ['ffmpeg', 'ffprobe']) {
  const path = join(video, tool),
   version = await execute(path, ['-version'], prepared.work, env, tool + '-version'),
   config = await execute(path, ['-buildconf'], prepared.work, env, tool + '-buildconf')
  check(!/(?:^|\s)--enable-nonfree(?:\s|$)/.test(config.output), 'Nonfree build forbidden')
  const deps = await execute('/usr/bin/otool', ['-L', path], prepared.work, env, tool + '-dependencies')
  const dependencies = deps.output
   .split('\n')
   .slice(1)
   .map(line => line.trim())
   .filter(Boolean)
  check(
   dependencies.every(line => line.startsWith('/usr/lib/') || line.startsWith('/System/Library/')),
   'Non-system dynamic dependency detected'
  )
  const arch = await execute('/usr/bin/lipo', ['-archs', path], prepared.work, env, tool + '-arch')
  check(arch.output.trim() === 'arm64', 'Wrong binary architecture')
  diagnostics[tool] = {
   version: version.output,
   buildconf: config.output,
   dependencies: deps.output,
   arch: arch.output,
   sha256: createHash('sha256')
    .update(await readFile(path))
    .digest('hex'),
   signature: await execute(
    '/usr/bin/codesign',
    ['-d', '--verbose=4', path],
    prepared.work,
    env,
    tool + '-signature',
    true
   ),
   gatekeeper: await execute(
    '/usr/sbin/spctl',
    ['--assess', '--type', 'execute', '--verbose=4', path],
    prepared.work,
    env,
    tool + '-gatekeeper',
    true
   )
  }
 }
 report.diagnostics = diagnostics
 const fixtures = join(prepared.work, 'fixtures')
 await mkdir(fixtures)
 report.codecs = await verifySourceCodecs(entry, resources, fixtures)
 const archive = join(artifacts, 'source-build-candidate.tar.gz')
 // Explicit isolated candidate archive: fixed source tarballs, full sources/configuration and built prefix.
 await execute(
  '/usr/bin/tar',
  ['-czf', archive, '-C', prepared.work, 'archives', 'sources', 'prefix', 'source-report.json'],
  prepared.work,
  env,
  'archive'
 )
 report.archiveSha256 = createHash('sha256')
  .update(await readFile(archive))
  .digest('hex')
 report.state = 'source_build_candidate_verified'
} catch (error) {
 report.state = 'failed'
 report.error = error instanceof Error ? error.message : 'Unknown build failure'
 process.exitCode = 1
} finally {
 report.binding = {
  commit: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim(),
  dirty: !!execFileSync('git', ['status', '--porcelain'], {cwd: root, encoding: 'utf8'}).trim(),
  sourceHashes: Object.fromEntries(
   await Promise.all(
    [
     'media-source-build.mts',
     'media-source-codecs.mts',
     'media-source-prepare.mts',
     'media-build-source-lock.mts'
    ].map(async file => [
     file,
     createHash('sha256')
      .update(await readFile(join(root, 'scripts', file)))
      .digest('hex')
    ])
   )
  )
 }
 await writeFile(join(artifacts, 'build-result.json'), JSON.stringify(report, null, 2) + '\n')
 console.log(JSON.stringify({state: report.state, distribution_status: report.distribution_status, artifacts}))
}
