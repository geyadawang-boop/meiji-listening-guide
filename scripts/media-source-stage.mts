import {createHash, randomUUID} from 'node:crypto'
import {constants} from 'node:fs'
import {lstat, mkdir, open, realpath, readdir, writeFile} from 'node:fs/promises'
import {basename, dirname, isAbsolute, join, relative, resolve} from 'node:path'
import {tmpdir} from 'node:os'
import {fileURLToPath} from 'node:url'
import {mediaSources} from './media-source-lock.mts'

// Offline preparation only. No download, execution, chmod or installer integration.
type Source = (typeof mediaSources)[number]
type Asset = Source['files'][number]
function requireCheck(value: unknown, message: string): asserts value {
 if (!value) throw new Error(message)
}
function contains(root: string, path: string) {
 const part = relative(root, path)
 return (
  part === '' ||
  (part !== '..' && !part.startsWith('..' + (process.platform === 'win32' ? '\\' : '/')) && !isAbsolute(part))
 )
}
async function plainPath(path: string, directory: boolean) {
 let current = resolve(path)
 const target = current
 for (;;) {
  const info = await lstat(current)
  requireCheck(!info.isSymbolicLink(), 'Links and junctions are not allowed: ' + current)
  if (current !== target || directory) requireCheck(info.isDirectory(), 'Expected a directory: ' + current)
  else requireCheck(info.isFile() && info.nlink === 1, 'Expected a regular, non-hardlinked file: ' + current)
  const parent = dirname(current)
  if (parent === current) break
  current = parent
 }
 requireCheck(resolve(await realpath(target)) === target, 'Path must use its canonical spelling: ' + target)
 return target
}

export function inspectExecutable(bytes: Buffer, totalSize: number, platform: 'linux' | 'darwin') {
 requireCheck(totalSize >= bytes.length, 'Header exceeds file size')
 if (platform === 'linux') {
  requireCheck(
   bytes.length >= 64 && bytes.subarray(0, 4).equals(Buffer.from([127, 69, 76, 70])),
   'Invalid or truncated ELF header'
  )
  requireCheck(bytes[4] === 2 && bytes[5] === 1 && bytes[6] === 1, 'Expected ELF64 little-endian version 1')
  requireCheck(bytes.readUInt16LE(18) === 62 && bytes.readUInt32LE(20) === 1, 'Expected x86-64 ELF')
  const type = bytes.readUInt16LE(16)
  requireCheck(type === 2 || type === 3, 'Expected executable or PIE ELF')
  requireCheck(bytes.readUInt16LE(52) === 64, 'Invalid ELF header size')
  const offset = bytes.readBigUInt64LE(32),
   count = bytes.readUInt16LE(56),
   entrySize = bytes.readUInt16LE(54)
  requireCheck(count > 0 && count !== 65535 && entrySize === 56 && offset >= 64n, 'Invalid ELF program headers')
  requireCheck(offset + BigInt(count * entrySize) <= BigInt(totalSize), 'ELF program headers exceed file size')
  return {format: 'ELF64', machine: 'x86-64', type: type === 2 ? 'executable' : 'pie-or-shared'}
 }
 requireCheck(bytes.length >= 32 && bytes.readUInt32LE(0) === 0xfeedfacf, 'Expected thin little-endian Mach-O64')
 requireCheck(bytes.readUInt32LE(4) === 0x0100000c && bytes.readUInt32LE(12) === 2, 'Expected arm64 MH_EXECUTE')
 const count = bytes.readUInt32LE(16),
  size = bytes.readUInt32LE(20),
  end = 32 + size
 requireCheck(
  count > 0 && count <= size / 8 && end <= totalSize && end <= bytes.length,
  'Invalid Mach-O command bounds'
 )
 let offset = 32
 for (let index = 0; index < count; index++) {
  requireCheck(offset + 8 <= end, 'Truncated Mach-O command')
  const length = bytes.readUInt32LE(offset + 4)
  requireCheck(length >= 8 && length % 8 === 0 && offset + length <= end, 'Invalid Mach-O command size')
  offset += length
 }
 requireCheck(offset === end, 'Mach-O command size mismatch')
 return {format: 'Mach-O64', machine: 'arm64', type: 'executable'}
}

async function copyVerified(input: string, output: string, asset: Asset, platform: Source['platform']) {
 await plainPath(input, false)
 const source = await open(input, constants.O_RDONLY | (constants.O_NOFOLLOW || 0))
 try {
  const before = await source.stat()
  requireCheck(
   before.isFile() && before.nlink === 1 && before.size === asset.size,
   'Source size/type mismatch: ' + asset.id
  )
  const target = await open(output, 'wx', 0o600)
  const hash = createHash('sha256'),
   buffer = Buffer.alloc(1024 * 1024)
  // A bounded prefix covers Mach-O load commands; reject larger command regions.
  const prefix = Buffer.alloc(Math.min(asset.size, 1024 * 1024))
  let size = 0
  try {
   for (;;) {
    const {bytesRead} = await source.read(buffer, 0, buffer.length, null)
    if (!bytesRead) break
    requireCheck(size + bytesRead <= asset.size, 'Source grew during copy')
    if (size < prefix.length) buffer.copy(prefix, size, 0, Math.min(bytesRead, prefix.length - size))
    hash.update(buffer.subarray(0, bytesRead))
    let written = 0
    while (written < bytesRead) {
     const result = await target.write(buffer, written, bytesRead - written)
     requireCheck(result.bytesWritten > 0, 'Copy made no progress')
     written += result.bytesWritten
    }
    size += bytesRead
   }
   await target.sync()
  } finally {
   await target.close()
  }
  const after = await source.stat()
  await plainPath(input, false)
  const current = await lstat(input)
  requireCheck(
   before.dev === current.dev &&
    before.ino === current.ino &&
    before.size === after.size &&
    before.mtimeMs === after.mtimeMs &&
    before.ctimeMs === after.ctimeMs,
   'Source changed during copy'
  )
  requireCheck(size === asset.size && hash.digest('hex') === asset.sha256, 'Source digest mismatch: ' + asset.id)
  const copy = await open(output, constants.O_RDONLY | (constants.O_NOFOLLOW || 0))
  const copyHash = createHash('sha256')
  try {
   requireCheck((await copy.stat()).size === asset.size, 'Copy size mismatch')
   for await (const chunk of copy.createReadStream({autoClose: false})) copyHash.update(chunk)
  } finally {
   await copy.close()
  }
  requireCheck(copyHash.digest('hex') === asset.sha256, 'Copy digest mismatch')
  const executable = asset.id === 'ffmpeg' || asset.id === 'ffprobe'
  return {
   id: asset.id,
   path: asset.outputName,
   size,
   sha256: asset.sha256,
   desiredMode: asset.desiredMode,
   ...(executable ? {header: inspectExecutable(prefix, size, platform)} : {})
  }
 } finally {
  await source.close()
 }
}

export async function stageMedia(request: {sourceId: string; inputDirectory: string; stagingRoot: string}) {
 requireCheck(
  Object.keys(request).sort().join(',') === 'inputDirectory,sourceId,stagingRoot',
  'Unknown stage request field'
 )
 const source = mediaSources.find(item => item.id === request.sourceId)
 requireCheck(source, 'Unknown locked source')
 requireCheck(
  source.files
   .map(file => file.id)
   .sort()
   .join(',') === 'LICENSE,README,ffmpeg,ffprobe' &&
   new Set(source.files.map(file => file.inputName)).size === 4 &&
   new Set(source.files.map(file => file.outputName)).size === 4 &&
   source.files.every(
    file =>
     file.outputName === file.id &&
     /^[a-zA-Z0-9.-]+$/.test(file.inputName) &&
     Number.isSafeInteger(file.size) &&
     file.size > 0 &&
     /^[a-f0-9]{64}$/.test(file.sha256)
   ),
  'Incomplete source lock'
 )
 requireCheck(
  [request.inputDirectory, request.stagingRoot].every(path => isAbsolute(path) && !path.split(/[\\/]/).includes('..')),
  'Paths must be absolute without traversal segments'
 )
 const input = await plainPath(request.inputDirectory, true),
  staging = resolve(request.stagingRoot)
 // Canonicalize only the OS-provided temporary root (macOS /var is a system alias).
 // User paths still pass the complete no-link parent-chain check.
 const temp = await plainPath(await realpath(tmpdir()), true)
 requireCheck(
  dirname(staging) === temp && /^meiji-media-stage-[a-zA-Z0-9_-]+$/.test(basename(staging)),
  'Staging must be a new meiji-media-stage-* direct child of the system temporary directory'
 )
 requireCheck(!contains(input, staging) && !contains(staging, input), 'Input and staging cannot overlap')
 const entries = await readdir(input)
 requireCheck(
  entries.length === source.files.length && source.files.every(file => entries.includes(file.inputName)),
  'Input must contain exactly the four locked artifacts'
 )
 for (const asset of source.files) await plainPath(join(input, asset.inputName), false)
 await mkdir(staging, {mode: 0o700}) // Must not exist; never reuse or overwrite a directory.
 const run = join(staging, randomUUID())
 await mkdir(run, {mode: 0o700})
 try {
  const files = []
  for (const asset of source.files) {
   await plainPath(run, true)
   files.push(await copyVerified(join(input, asset.inputName), join(run, asset.outputName), asset, source.platform))
  }
  await plainPath(run, true)
  const report = {
   schema: 1,
   state: 'staged_verified',
   sourceId: source.id,
   target: {platform: source.platform, arch: source.arch},
   upstream: {repository: source.repository, tag: source.tag, evidence: source.evidence},
   files,
   checks: {integrity: 'pass', architecture: 'pass'},
   pending: ['actual_version', 'license_review', 'corresponding_source', 'dependencies', 'signing', 'target_runtime'],
   scope:
    'Offline integrity and header validation only; not installable or runtime verified. File modes are desired metadata, not applied.'
  }
  await writeFile(join(run, 'stage-report.json'), JSON.stringify(report, null, 2) + '\n', {flag: 'wx', mode: 0o600})
  return {run, report}
 } catch (error) {
  throw new Error('Stage failed; incomplete files retained in ' + run, {cause: error})
 }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
 try {
  requireCheck(
   process.argv.length === 5,
   'Usage: node scripts/media-source-stage.mts <sourceId> <inputDirectory> <newTemporaryStagingRoot>'
  )
  const result = await stageMedia({
   sourceId: process.argv[2],
   inputDirectory: process.argv[3],
   stagingRoot: process.argv[4]
  })
  console.log(JSON.stringify(result))
 } catch (error) {
  console.error(error)
  process.exitCode = 1
 }
}
