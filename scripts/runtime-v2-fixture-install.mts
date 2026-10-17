import {createHash, randomUUID} from 'node:crypto'
import {constants} from 'node:fs'
import {chmod, lstat, mkdir, open, readdir, realpath, rename} from 'node:fs/promises'
import {dirname, join, resolve} from 'node:path'
import {tmpdir} from 'node:os'
import {parseRuntimeManifestV2, type RuntimeTarget} from '../src/shared/runtime-manifest-v2.ts'
import {validateVideoDescriptor} from '../src/shared/runtime-descriptor-v2.ts'

function check(value: unknown, message: string): asserts value {
 if (!value) throw new Error(message)
}
async function plain(path: string, directory: boolean) {
 const target = resolve(path)
 for (let current = target; ; current = dirname(current)) {
  const info = await lstat(current)
  check(!info.isSymbolicLink(), 'Fixture paths cannot contain links')
  check(
   current !== target || directory ? info.isDirectory() : info.isFile() && info.nlink === 1,
   'Fixture requires regular non-hardlinked files'
  )
  if (dirname(current) === current) break
 }
 check(resolve(await realpath(target)) === target, 'Fixture requires canonical paths')
 return target
}
async function hashFile(path: string, expectedSize: number, signal: AbortSignal) {
 signal.throwIfAborted()
 await plain(path, false)
 const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0)),
  hash = createHash('sha256')
 let size = 0
 try {
  const before = await handle.stat()
  check(before.size === expectedSize, 'File size mismatch')
  for await (const bytes of handle.createReadStream({autoClose: false})) {
   signal.throwIfAborted()
   size += bytes.length
   check(size <= expectedSize, 'File grew during verification')
   hash.update(bytes)
  }
  const after = await handle.stat(),
   pathInfo = await lstat(path)
  check(
   before.dev === pathInfo.dev &&
    before.ino === pathInfo.ino &&
    before.mtimeMs === after.mtimeMs &&
    before.ctimeMs === after.ctimeMs &&
    after.size === size &&
    size === expectedSize,
   'File changed during verification'
  )
 } finally {
  await handle.close()
 }
 return hash.digest('hex')
}
async function exactFiles(root: string, paths: string[]) {
 const expected = new Set(paths),
  directories = new Set<string>()
 for (const path of paths) {
  const parts = path.split('/')
  for (let i = 1; i < parts.length; i++) directories.add(parts.slice(0, i).join('/'))
 }
 const seen = new Set<string>()
 async function walk(directory: string, prefix: string) {
  await plain(directory, true)
  for (const name of await readdir(directory)) {
   const relative = prefix ? prefix + '/' + name : name,
    path = join(directory, name),
    info = await lstat(path)
   check(!info.isSymbolicLink(), 'Payload link forbidden')
   if (info.isDirectory()) {
    check(directories.has(relative), 'Unexpected payload directory')
    await walk(path, relative)
   } else {
    check(expected.has(relative) && info.isFile() && info.nlink === 1, 'Unexpected payload file')
    seen.add(relative)
   }
  }
 }
 await walk(root, '')
 check(seen.size === expected.size, 'Payload file set is incomplete')
}
/** Fixture-only: caller-selected metadata is not application installation authority. */
export async function installVideoFixture(
 request: {
  callerManifest: unknown
  expectedTarget: RuntimeTarget
  expectedProductVersion: string
  descriptor: unknown
  payloadDirectory: string
 },
 signal: AbortSignal
) {
 signal.throwIfAborted()
 check(
  Object.keys(request).sort().join(',') ===
   'callerManifest,descriptor,expectedProductVersion,expectedTarget,payloadDirectory',
  'Unknown fixture request field'
 )
 check(
  process.platform === 'darwin' &&
   process.arch === 'arm64' &&
   request.expectedTarget.platform === process.platform &&
   request.expectedTarget.arch === process.arch,
  'Fixture requires actual macOS arm64 target'
 )
 const manifest = parseRuntimeManifestV2(request.callerManifest, request.expectedTarget)
 check(manifest.productVersion === request.expectedProductVersion, 'Fixture version differs from caller selection')
 validateVideoDescriptor(request.descriptor, manifest)
 const files = manifest.components[0].files
 check(files.length <= 1000 && manifest.components[0].bytes <= 256 * 1024 * 1024, 'Fixture payload budget exceeded')
 const input = await plain(request.payloadDirectory, true)
 const inputIdentity = await lstat(input)
 await exactFiles(
  input,
  files.map(file => file.path)
 )
 for (const file of files)
  check((await hashFile(join(input, file.path), file.size, signal)) === file.sha256, 'Input digest mismatch')
 signal.throwIfAborted()
 const temp = await plain(await realpath(tmpdir()), true),
  root = join(temp, 'meiji-v2-fixture-' + randomUUID())
 await mkdir(root, {mode: 0o700})
 const stage = join(root, 'stage'),
  published = join(root, 'published')
 await mkdir(stage, {mode: 0o700})
 const rootIdentity = await lstat(root),
  stageIdentity = await lstat(stage)
 const stableDirectories = async () => {
  for (const [path, identity] of [
   [input, inputIdentity],
   [root, rootIdentity],
   [stage, stageIdentity]
  ] as const) {
   await plain(path, true)
   const current = await lstat(path)
   check(current.dev === identity.dev && current.ino === identity.ino, 'Fixture directory identity changed')
  }
 }
 try {
  for (const file of files) {
   signal.throwIfAborted()
   await stableDirectories()
   const source = join(input, file.path),
    destination = join(stage, file.path)
   await plain(source, false)
   await mkdir(dirname(destination), {recursive: true, mode: 0o700})
   await plain(dirname(destination), true)
   const reader = await open(source, constants.O_RDONLY | (constants.O_NOFOLLOW || 0)),
    writer = await open(destination, 'wx', 0o600)
   let copied = 0
   try {
    for await (const bytes of reader.createReadStream({autoClose: false})) {
     signal.throwIfAborted()
     copied += bytes.length
     check(copied <= file.size, 'Source grew during copy')
     await writer.writeFile(bytes)
    }
    await writer.sync()
   } finally {
    await reader.close()
    await writer.close()
   }
   check(
    copied === file.size && (await hashFile(destination, file.size, signal)) === file.sha256,
    'Copied payload differs from manifest'
   )
   signal.throwIfAborted()
   await plain(destination, false)
   const permissionHandle = await open(destination, constants.O_RDONLY | (constants.O_NOFOLLOW || 0))
   try {
    const identity = await permissionHandle.stat(),
     current = await lstat(destination)
    check(
     identity.dev === current.dev && identity.ino === current.ino && identity.isFile() && identity.nlink === 1,
     'Permission target identity changed'
    )
    signal.throwIfAborted()
    await permissionHandle.chmod(file.mode === '0755' ? 0o755 : 0o644)
   } finally {
    await permissionHandle.close()
   }
  }
  // Last complete verification immediately precedes publish; cancellation remains active.
  await exactFiles(
   stage,
   files.map(file => file.path)
  )
  for (const file of files) {
   signal.throwIfAborted()
   const path = join(stage, file.path)
   check((await hashFile(path, file.size, signal)) === file.sha256, 'Final payload digest mismatch')
   check(((await lstat(path)).mode & 0o7777) === (file.mode === '0755' ? 0o755 : 0o644), 'Final POSIX mode mismatch')
  }
  await stableDirectories()
  try {
   await lstat(published)
   throw new Error('Fixture publish destination already exists')
  } catch (error) {
   if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  signal.throwIfAborted()
  await rename(stage, published)
  return {
   state: 'fixture_published',
   root,
   published,
   manifest,
   applicationInstaller: false,
   installationAuthority: false,
   scope:
    'Owned temporary fixture only; original payload permissions untouched, no binary execution or application installation.'
  }
 } catch (error) {
  throw new Error('Fixture failed; unpublished stage retained at ' + stage, {cause: error})
 }
}
