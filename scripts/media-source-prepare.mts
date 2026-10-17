import {execFile, execFileSync} from 'node:child_process'
import {createHash, randomUUID} from 'node:crypto'
import {constants} from 'node:fs'
import {copyFile, lstat, mkdir, open, readFile, readdir, realpath, writeFile} from 'node:fs/promises'
import {basename, dirname, join, resolve} from 'node:path'
import {tmpdir, release} from 'node:os'
import {fileURLToPath} from 'node:url'
import {buildSources} from './media-build-source-lock.mts'

type Source = (typeof buildSources)[number]
function check(value: unknown, message: string): asserts value {
 if (!value) throw new Error(message)
}
async function plain(path: string, directory: boolean) {
 const target = resolve(path)
 for (let current = target; ; current = dirname(current)) {
  const item = await lstat(current)
  check(!item.isSymbolicLink(), 'Links or junctions are not allowed')
  check(
   current !== target || directory ? item.isDirectory() : item.isFile() && item.nlink === 1,
   'Unexpected file type'
  )
  if (dirname(current) === current) break
 }
 check(resolve(await realpath(target)) === target, 'Use canonical paths')
 return target
}
async function digest(path: string, source: Source) {
 await plain(path, false)
 const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0)),
  hash = createHash('sha256')
 let size = 0
 try {
  check((await file.stat()).size === source.size, 'Archive size mismatch: ' + source.id)
  for await (const bytes of file.createReadStream({autoClose: false})) {
   size += bytes.length
   check(size <= source.size, 'Archive grew during verification')
   hash.update(bytes)
  }
 } finally {
  await file.close()
 }
 check(size === source.size && hash.digest('hex') === source.sha256, 'Archive digest mismatch: ' + source.id)
}
export async function downloadSource(source: Source, destination: string) {
 let url = source.url as string
 const signal = AbortSignal.timeout(180000)
 for (let count = 0; count <= 5; count++) {
  const parsed = new URL(url)
  check(
   parsed.protocol === 'https:' &&
    !parsed.username &&
    !parsed.password &&
    (!parsed.port || parsed.port === '443') &&
    (source.hosts as readonly string[]).includes(parsed.hostname),
   'Source redirect outside fixed HTTPS hosts'
  )
  const response = await fetch(url, {redirect: 'manual', signal})
  if ([301, 302, 303, 307, 308].includes(response.status)) {
   const next = response.headers.get('location')
   await response.body?.cancel()
   check(next && count < 5, 'Invalid source redirect chain')
   url = new URL(next, url).href
   continue
  }
  check(response.ok && response.body, 'Source download HTTP ' + response.status)
  const declared = response.headers.get('content-length')
  check(declared === null || Number(declared) === source.size, 'Unexpected source Content-Length')
  const file = await open(destination, 'wx', 0o600)
  let size = 0
  try {
   for await (const bytes of response.body) {
    size += bytes.length
    check(size <= source.size, 'Source download exceeds fixed size')
    let offset = 0
    while (offset < bytes.length) {
     const result = await file.write(bytes, offset, bytes.length - offset)
     check(result.bytesWritten > 0, 'Download made no progress')
     offset += result.bytesWritten
    }
   }
  } finally {
   await file.close()
  }
  await digest(destination, source)
  return
 }
 throw new Error('Source redirect limit exceeded')
}
async function tar(args: string[]) {
 return await new Promise<string>((done, fail) => {
  execFile(
   process.platform === 'darwin' ? '/usr/bin/tar' : 'tar',
   args,
   {
    encoding: 'utf8',
    timeout: 120000,
    maxBuffer: 16 * 1024 * 1024,
    env: {...process.env, LC_ALL: 'C', LANG: 'C', TAR_OPTIONS: ''},
    windowsHide: true
   },
   (error, stdout, stderr) =>
    error || stderr.trim()
     ? fail(new Error('Archive tool failed: ' + (error?.message || stderr.slice(0, 1000))))
     : done(stdout)
  )
 })
}
export function inspectArchiveListing(namesText: string, verboseText: string, expectedRoot: string) {
 const lines = (text: string) => text.replaceAll('\r\n', '\n').replace(/\n$/, '').split('\n')
 const names = lines(namesText),
  details = lines(verboseText),
  entries = new Map<string, {directory: boolean; size: number}>()
 check(
  names.length > 0 && names.length <= 20000 && names.length === details.length,
  'Archive entry budget/listing mismatch'
 )
 let total = 0
 for (let index = 0; index < names.length; index++) {
  const name = names[index],
   parts = name.replace(/\/$/, '').split('/')
  check(
   /^[A-Za-z0-9._+~/-]+$/.test(name) &&
    parts[0] === expectedRoot &&
    parts.every(part => part && part !== '.' && part !== '..'),
   'Unsafe archive path'
  )
  const key = name.replace(/\/$/, '')
  check(!entries.has(key), 'Duplicate archive path')
  // Strict BSD tar C-locale listing. Unsupported formats fail before extraction.
  const match =
   /^([-d])[rwxstST-]{9}\s+\d+\s+\S+\s+\S+\s+(\d+)\s+[A-Za-z]{3}\s+\d{1,2}\s+(?:\d{4}|\d{1,2}:\d{2})\s+(.+)$/.exec(
    details[index]
   )
  check(match && match[3] === name, 'Unsupported archive type or verbose listing')
  const directory = match[1] === 'd',
   size = Number(match[2])
  check(
   Number.isSafeInteger(size) && size >= 0 && (directory ? name.endsWith('/') && size === 0 : !name.endsWith('/')),
   'Invalid archive entry size/type'
  )
  total += size
  check(total <= 1024 * 1024 * 1024, 'Archive expansion exceeds budget')
  entries.set(key, {directory, size})
 }
 check(entries.get(expectedRoot)?.directory, 'Archive root directory missing')
 for (const path of entries.keys()) {
  let parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
  while (parent) {
   check(entries.get(parent)?.directory, 'Missing or non-directory archive parent')
   parent = parent.includes('/') ? parent.slice(0, parent.lastIndexOf('/')) : ''
  }
 }
 return {entries, total}
}
async function inspectExtracted(base: string, expected: Map<string, {directory: boolean; size: number}>) {
 const seen = new Set<string>()
 async function visit(path: string, relative: string) {
  await plain(path, true)
  for (const name of await readdir(path)) {
   const itemPath = join(path, name),
    key = relative ? relative + '/' + name : name,
    item = await lstat(itemPath),
    wanted = expected.get(key)
   check(wanted && !item.isSymbolicLink(), 'Unexpected extracted entry')
   check(
    wanted.directory ? item.isDirectory() : item.isFile() && item.nlink === 1 && item.size === wanted.size,
    'Extracted type/size mismatch'
   )
   seen.add(key)
   if (wanted.directory) await visit(itemPath, key)
  }
 }
 await visit(base, '')
 check(seen.size === expected.size, 'Extracted entry count mismatch')
}
export async function prepareBuildSources(request: {sourceIds: string[]; offlineDirectory?: string}) {
 check(
  Object.keys(request).every(key => ['sourceIds', 'offlineDirectory'].includes(key)),
  'Unknown preparation field'
 )
 check(
  Array.isArray(request.sourceIds) &&
   request.sourceIds.length > 0 &&
   new Set(request.sourceIds).size === request.sourceIds.length,
  'Source IDs must be nonempty and unique'
 )
 const selected = request.sourceIds.map(id => {
  const source = buildSources.find(item => item.id === id)
  check(source, 'Unknown build source')
  return source
 })
 const temp = await plain(await realpath(tmpdir()), true)
 const work = join(temp, 'meiji-media-sources-' + randomUUID())
 if (request.offlineDirectory) await plain(request.offlineDirectory, true)
 await mkdir(work, {mode: 0o700})
 const archives = join(work, 'archives'),
  unpacked = join(work, 'sources')
 await mkdir(archives, {mode: 0o700})
 await mkdir(unpacked, {mode: 0o700})
 try {
  const tarVersion = await tar(['--version'])
  check(tarVersion.startsWith('bsdtar '), 'This bounded source preparer requires BSD tar')
  const receipts = []
  for (const source of selected) {
   const archive = join(archives, source.archive)
   if (request.offlineDirectory) {
    const input = join(request.offlineDirectory, source.archive)
    await digest(input, source)
    await copyFile(input, archive, constants.COPYFILE_EXCL)
   } else await downloadSource(source, archive)
   await digest(archive, source)
   const listing = inspectArchiveListing(await tar(['-tf', archive]), await tar(['-tvf', archive]), source.root)
   const destination = join(unpacked, source.id)
   await mkdir(destination, {mode: 0o700})
   await plain(destination, true)
   await digest(archive, source)
   await tar(['-xf', archive, '-C', destination, '--no-same-owner', '--no-same-permissions'])
   await inspectExtracted(destination, listing.entries)
   for (const license of source.licenseFiles)
    check(listing.entries.get(source.root + '/' + license)?.directory === false, 'Locked license file absent')
   check(listing.entries.get(source.root + '/configure')?.directory === false, 'Expected configure entry absent')
   receipts.push({
    source,
    path: 'sources/' + source.id + '/' + source.root,
    archive: 'archives/' + source.archive,
    entries: listing.entries.size,
    expandedBytes: listing.total
   })
  }
  const report = {
   schema: 1,
   state: 'sources_prepared',
   tarVersion: tarVersion.trim(),
   receipts,
   pending: [
    'source_signature_review',
    'build',
    'codec_runtime',
    'corresponding_source_review',
    'signing',
    'distribution_review'
   ],
   scope: 'Fixed source archives verified and extracted only. No configure, make, installation or binary execution.'
  }
  await writeFile(join(work, 'source-report.json'), JSON.stringify(report, null, 2) + '\n', {flag: 'wx', mode: 0o600})
  return {work, report}
 } catch (error) {
  throw new Error('Source preparation failed; incomplete work retained in ' + work, {cause: error})
 }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
 const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
 const binding = {
  commit: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim(),
  dirty: !!execFileSync('git', ['status', '--porcelain'], {cwd: root, encoding: 'utf8'}).trim(),
  platform: process.platform,
  arch: process.arch,
  osRelease: release(),
  osProductVersion:
   process.platform === 'darwin'
    ? execFileSync('/usr/bin/sw_vers', ['-productVersion'], {encoding: 'utf8'}).trim()
    : undefined,
  sourceHashes: Object.fromEntries(
   await Promise.all(
    ['media-build-source-lock.mts', 'media-source-prepare.mts'].map(async file => [
     file,
     createHash('sha256')
      .update(await readFile(join(root, 'scripts', file)))
      .digest('hex')
    ])
   )
  )
 }
 try {
  check(
   process.argv.length === 2 || (process.argv.length === 4 && process.argv[2] === '--offline'),
   'Usage: node scripts/media-source-prepare.mts [--offline <canonical archive directory>]'
  )
  console.log(
   JSON.stringify({
    binding,
    ...(await prepareBuildSources({
     sourceIds: buildSources.map(source => source.id),
     ...(process.argv.length === 4 ? {offlineDirectory: process.argv[3]} : {})
    }))
   })
  )
 } catch (error) {
  console.log(
   JSON.stringify({
    binding,
    state: 'failed',
    error: error instanceof Error ? error.message : 'Unknown failure',
    cause: error instanceof Error && error.cause instanceof Error ? error.cause.message : undefined
   })
  )
  console.error(error)
  process.exitCode = 1
 }
}
