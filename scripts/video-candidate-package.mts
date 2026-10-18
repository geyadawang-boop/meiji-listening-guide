import {spawn, execFile, execFileSync} from 'node:child_process'
import {createHash, randomUUID} from 'node:crypto'
import {constants} from 'node:fs'
import {lstat, mkdir, open, readFile, realpath, writeFile} from 'node:fs/promises'
import {dirname, join, resolve} from 'node:path'
import {tmpdir} from 'node:os'
import {fileURLToPath} from 'node:url'
import {z} from 'zod'
import {inspectExecutable} from './media-source-stage.mts'
import {buildSources} from './media-build-source-lock.mts'
import {parseRuntimeManifestV2} from '../src/shared/runtime-manifest-v2.ts'
import {createVideoDescriptor, validateVideoDescriptor} from '../src/shared/runtime-descriptor-v2.ts'
const hex = z.string().regex(/^[a-f0-9]{64}$/)
const requestSchema = z
 .object({
  target: z.enum(['darwin-arm64', 'linux-x64']),
  productVersion: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?$/),
  archive: z.string(),
  buildReport: z.string(),
  expectedArchiveSha256: hex,
  expectedBuildReportSha256: hex,
  sourceBuildCommit: z.string().regex(/^[a-f0-9]{40}$/),
  sourceBuildRun: z.string().regex(/^[0-9]+$/)
 })
 .strict()
function check(v: unknown, message: string): asserts v {
 if (!v) throw new Error(message)
}
async function plain(path: string, directory = false) {
 const target = resolve(path)
 for (let current = target; ; current = dirname(current)) {
  const s = await lstat(current)
  check(!s.isSymbolicLink(), 'Links forbidden')
  check(current !== target || directory ? s.isDirectory() : s.isFile() && s.nlink === 1, 'Invalid input file')
  if (dirname(current) === current) break
 }
 check(resolve(await realpath(target)) === target, 'Canonical path required')
 return target
}
async function sha(path: string) {
 const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0)),
  h = createHash('sha256')
 try {
  for await (const b of file.createReadStream({autoClose: false})) h.update(b)
 } finally {
  await file.close()
 }
 return h.digest('hex')
}
async function listing(archive: string) {
 return await new Promise<string>((done, fail) =>
  execFile(
   process.platform === 'darwin' ? '/usr/bin/tar' : process.platform === 'linux' ? '/usr/bin/bsdtar' : 'tar',
   ['-tvf', archive],
   {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    timeout: 120000,
    env: {...process.env, LC_ALL: 'C', LANG: 'C', TAR_OPTIONS: ''}
   },
   (e, out, err) => (e || err.trim() ? fail(new Error('Archive listing failed')) : done(out))
  )
 )
}
export function selectedMemberSize(text: string, name: string) {
 check(
  /^[A-Za-z0-9._+~/-]+$/.test(name) && !name.split('/').some(p => !p || p === '..' || p === '.'),
  'Unsafe selected archive member'
 )
 const lines = text
  .replaceAll('\r\n', '\n')
  .split('\n')
  .filter(
   line => line.endsWith(' ' + name) || line.includes(' ' + name + ' -> ') || line.includes(' ' + name + ' link to ')
  )
 check(lines.length === 1, 'Selected archive member missing or duplicated: ' + name)
 const m = /^-[rwx-]{9}\s+\d+\s+\S+\s+\S+\s+(\d+)\s+[A-Za-z]{3}\s+\d{1,2}\s+(?:\d{4}|\d{1,2}:\d{2})\s+(.+)$/.exec(
  lines[0]
 )
 check(m && m[2] === name, 'Selected archive member is not a plain regular file')
 const size = Number(m[1])
 check(Number.isSafeInteger(size) && size > 0 && size <= 256 * 1024 * 1024, 'Invalid selected member size')
 return size
}
async function extractMember(archive: string, name: string, destination: string, size: number) {
 const file = await open(destination, 'wx', 0o600),
  h = createHash('sha256')
 let count = 0
 try {
  await new Promise<void>((done, fail) => {
   const child = spawn(
    process.platform === 'darwin' ? '/usr/bin/tar' : process.platform === 'linux' ? '/usr/bin/bsdtar' : 'tar',
    ['-xOf', archive, name],
    {
     stdio: ['ignore', 'pipe', 'pipe'],
     env: {...process.env, LC_ALL: 'C', LANG: 'C', TAR_OPTIONS: ''}
    }
   )
   const timer = setTimeout(() => {
    child.kill()
    fail(new Error('Member read timed out'))
   }, 120000)
   let stderr = ''
   child.stderr.on('data', b => {
    stderr = (stderr + b.toString()).slice(-1000)
   })
   child.once('error', fail)
   const consume = (async () => {
    for await (const bytes of child.stdout) {
     count += bytes.length
     check(count <= size, 'Member exceeded declared size')
     h.update(bytes)
     await file.writeFile(bytes)
    }
   })()
   child.once('close', code => {
    clearTimeout(timer)
    void consume
     .then(() => {
      check(code === 0 && !stderr.trim() && count === size, 'Member read failed')
      done()
     })
     .catch(fail)
   })
   void consume.catch(error => {
    child.kill()
    fail(error)
   })
  })
 } finally {
  await file.close()
 }
 return h.digest('hex')
}
export async function packageVideoCandidate(value: unknown) {
 const request = requestSchema.parse(value),
  archive = await plain(request.archive),
  reportPath = await plain(request.buildReport)
 check(
  (await lstat(archive)).size > 0 && (await lstat(archive)).size <= 1024 * 1024 * 1024,
  'Candidate archive exceeds size budget'
 )
 check((await lstat(reportPath)).size <= 4 * 1024 * 1024, 'Build report too large')
 check((await sha(archive)) === request.expectedArchiveSha256, 'Caller archive digest mismatch')
 check((await sha(reportPath)) === request.expectedBuildReportSha256, 'Caller build report digest mismatch')
 const linux = request.target === 'linux-x64'
 const target = linux ? ({platform: 'linux', arch: 'x64'} as const) : ({platform: 'darwin', arch: 'arm64'} as const)
 const source = JSON.parse(await readFile(reportPath, 'utf8'))
 check(
  source.state === 'source_build_candidate_verified' && source.distribution_status === 'pending',
  'Only verified pending source-build candidates accepted'
 )
 check(
  source.binding?.commit === request.sourceBuildCommit &&
   source.binding?.dirty === false &&
   source.binding?.platform === target.platform &&
   source.binding?.arch === target.arch,
  'Source build identity/target mismatch'
 )
 check(source.archiveSha256 === request.expectedArchiveSha256, 'Build report archive mismatch')
 const table = await listing(archive),
  temp = await plain(await realpath(tmpdir()), true),
  stage = join(temp, 'meiji-video-candidate-' + randomUUID())
 await mkdir(stage, {mode: 0o700})
 const payload = join(stage, 'payload')
 await mkdir(payload)
 const files: Array<{path: string; size: number; sha256: string; mode: '0644' | '0755'}> = []
 const copy = async (member: string, path: string, expected?: string) => {
  const size = selectedMemberSize(table, member)
  await mkdir(dirname(join(payload, path)), {recursive: true})
  const hash = await extractMember(archive, member, join(payload, path), size)
  check(!expected || hash === expected, 'Member digest differs from source evidence: ' + member)
  check((await sha(join(payload, path))) === hash, 'Payload reread mismatch')
  files.push({path, size, sha256: hash, mode: path === 'ffmpeg' || path === 'ffprobe' ? '0755' : '0644'})
 }
 try {
  for (const tool of ['ffmpeg', 'ffprobe']) {
   await copy('prefix/bin/' + tool, tool, hex.parse(source.diagnostics?.[tool]?.sha256))
   if (linux) {
    const bytes = await readFile(join(payload, tool))
    inspectExecutable(bytes, bytes.length, 'linux')
    const diagnostic = source.diagnostics[tool]
    const allowed = new Set([
     'libc.so.6',
     'libm.so.6',
     'libz.so.1',
     'libpthread.so.0',
     'libdl.so.2',
     'librt.so.1',
     'libstdc++.so.6',
     'libgcc_s.so.1',
     'ld-linux-x86-64.so.2'
    ])
    check(
     Array.isArray(diagnostic.needed) &&
      diagnostic.needed.length > 0 &&
      diagnostic.needed.every((name: string) => allowed.has(name)),
     'Unexpected Linux build dependency'
    )
    check(
     Array.isArray(diagnostic.resolved) &&
      diagnostic.needed.every((name: string) =>
       diagnostic.resolved.some(
        (entry: {name: string; realpath: string}) =>
         entry.name === name && entry.realpath.startsWith('/usr/lib/x86_64-linux-gnu/')
       )
      ),
     'Unresolved Linux build dependency'
    )
    check(!/\((?:RPATH|RUNPATH)\)/.test(diagnostic.dynamic), 'Unexpected Linux library search path')
   }
  }
  await copy('source-report.json', 'evidence/source-ledger.json')
  const ledger = JSON.parse(await readFile(join(payload, 'evidence/source-ledger.json'), 'utf8'))
  check(ledger.receipts?.length === 7, 'Seven source receipts required')
  for (const locked of buildSources) {
   const receipt = ledger.receipts.find((r: {source?: {id?: string}}) => r.source?.id === locked.id)
   check(
    receipt?.source?.sha256 === locked.sha256 && receipt.source.size === locked.size,
    'Source ledger differs from fixed source lock'
   )
   const base = 'sources/' + locked.id + '/' + locked.root
   await copy('archives/' + locked.archive, 'sources/' + locked.archive, locked.sha256)
   for (const license of locked.licenseFiles) await copy(base + '/' + license, 'licenses/' + locked.id + '/' + license)
   await copy(
    base + '/' + (locked.id === 'ffmpeg' ? 'ffbuild/config.log' : 'config.log'),
    'evidence/' + locked.id + '-config.log'
   )
  }
  await copy('sources/ffmpeg/ffmpeg-8.1.3/ffbuild/config.mak', 'evidence/ffmpeg-config.mak')
  if (linux) {
   await copy('sources/ffmpeg/ffmpeg-8.1.3/config.h', 'evidence/ffmpeg-config.h')
   await copy('build-evidence.json', 'evidence/build-evidence.json')
  } else
   for (const file of ['configure', 'configure.ac'])
    await copy(
     'sources/vorbis/libvorbis-1.3.7/' + file,
     'evidence/vorbis-' + file,
     hex.parse(source.sourcePatches?.patches?.find((p: {file: string}) => p.file === file)?.afterSha256)
    )
  const reportBytes = await readFile(reportPath)
  await writeFile(join(payload, 'evidence/build-result.json'), reportBytes, {flag: 'wx', mode: 0o600})
  files.push({
   path: 'evidence/build-result.json',
   size: reportBytes.length,
   sha256: createHash('sha256').update(reportBytes).digest('hex'),
   mode: '0644'
  })
  check(
   (await sha(archive)) === request.expectedArchiveSha256 &&
    (await sha(reportPath)) === request.expectedBuildReportSha256,
   'Input changed during packaging'
  )
  const manifest = parseRuntimeManifestV2(
   {
    schema: 2,
    productVersion: request.productVersion,
    target,
    components: [
     {
      id: 'video',
      label: 'Video source-build candidate',
      directory: 'video',
      target,
      bytes: files.reduce((n, f) => n + f.size, 0),
      files
     }
    ]
   },
   target
  )
  const descriptor = createVideoDescriptor(manifest)
  validateVideoDescriptor(descriptor, manifest)
  await writeFile(join(stage, 'runtime-manifest.json'), JSON.stringify(manifest, null, 2) + '\n', {flag: 'wx'})
  await writeFile(join(stage, 'component.json'), JSON.stringify(descriptor, null, 2) + '\n', {flag: 'wx'})
  const report = {
   generator: {
    commit: execFileSync('git', ['rev-parse', 'HEAD'], {
     cwd: dirname(fileURLToPath(import.meta.url)),
     encoding: 'utf8'
    }).trim(),
    dirty: !!execFileSync('git', ['status', '--porcelain'], {
     cwd: dirname(fileURLToPath(import.meta.url)),
     encoding: 'utf8'
    }).trim(),
    sourceSha256: await sha(fileURLToPath(import.meta.url)),
    sourceHashes: Object.fromEntries(
     await Promise.all(
      [
       '../src/shared/runtime-descriptor-v2.ts',
       '../src/shared/runtime-manifest-v2.ts',
       './media-build-source-lock.mts'
      ].map(async path => [path, await sha(fileURLToPath(new URL(path, import.meta.url)))])
     )
    )
   },
   state: 'candidate_only',
   distribution_status: 'pending',
   trusted: false,
   installable: false,
   sourceBuildRun: request.sourceBuildRun,
   sourceBuildCommit: request.sourceBuildCommit,
   archiveSha256: request.expectedArchiveSha256,
   buildReportSha256: request.expectedBuildReportSha256,
   descriptor,
   scope:
    'ELF headers are inspected without execution; Linux dependency metadata is bound to the supplied build report, not rechecked against this host. Evidence-bound candidate generation only. Caller manifest validation is still required; no installation authority or binary execution.'
  }
  await writeFile(join(stage, 'candidate-report.json'), JSON.stringify(report, null, 2) + '\n', {flag: 'wx'})
  return {stage, report, manifest}
 } catch (error) {
  throw new Error('Candidate packaging failed; incomplete stage retained at ' + stage, {cause: error})
 }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
 try {
  check(process.argv.length === 3, 'Usage: node scripts/video-candidate-package.mts <request.json>')
  console.log(JSON.stringify(await packageVideoCandidate(JSON.parse(await readFile(process.argv[2], 'utf8')))))
 } catch (error) {
  console.error(error)
  process.exitCode = 1
 }
}
