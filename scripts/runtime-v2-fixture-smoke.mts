import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {execFileSync} from 'node:child_process'
import {chmod, lstat, mkdir, mkdtemp, readFile, readdir, realpath, symlink, link, writeFile} from 'node:fs/promises'
import {tmpdir, release} from 'node:os'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import fsPromises from 'node:fs/promises'
import {syncBuiltinESMExports} from 'node:module'
import {createVideoDescriptor} from '../src/shared/runtime-descriptor-v2.ts'
import {parseRuntimeManifestV2} from '../src/shared/runtime-manifest-v2.ts'
import {installVideoFixture} from './runtime-v2-fixture-install.mts'
const output = process.argv[2]
if (!output) throw new Error('Usage: node scripts/runtime-v2-fixture-smoke.mts <result.json>')
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'),
 checks: string[] = [],
 report: Record<string, unknown> = {
  status: 'running',
  scope: 'Synthetic four-file payload, actual OS only, never executes tools or installs the application.'
 }
try {
 assert.equal(process.platform, 'darwin')
 assert.equal(process.arch, 'arm64')
 const work = await mkdtemp(join(await realpath(tmpdir()), 'meiji-v2-input-')),
  target = {platform: 'darwin', arch: 'arm64'} as const
 const payload = async () => {
  const dir = await mkdtemp(join(work, 'payload-'))
  await mkdir(join(dir, 'evidence'))
  for (const path of ['ffmpeg', 'ffprobe', 'LICENSE.txt', 'evidence/source.json']) {
   await writeFile(join(dir, path), 'Synthetic inert file: ' + path)
   await chmod(join(dir, path), 0o600)
  }
  return dir
 }
 const input = await payload(),
  files = await Promise.all(
   ['ffmpeg', 'ffprobe', 'LICENSE.txt', 'evidence/source.json'].map(async path => {
    const bytes = await readFile(join(input, path))
    return {
     path,
     size: bytes.length,
     sha256: createHash('sha256').update(bytes).digest('hex'),
     mode: path === 'ffmpeg' || path === 'ffprobe' ? '0755' : '0644'
    }
   })
  )
 const manifest = parseRuntimeManifestV2(
  {
   schema: 2,
   productVersion: '0.0.0-fixture',
   target,
   components: [
    {id: 'video', label: 'Fixture', directory: 'video', target, files, bytes: files.reduce((n, f) => n + f.size, 0)}
   ]
  },
  target
 )
 const request = {
  callerManifest: manifest,
  expectedTarget: target,
  expectedProductVersion: manifest.productVersion,
  descriptor: createVideoDescriptor(manifest),
  payloadDirectory: input
 }
 const installed = await installVideoFixture(request, new AbortController().signal)
 for (const file of files) {
  assert.equal((await lstat(join(installed.published, file.path))).mode & 0o7777, file.mode === '0755' ? 0o755 : 0o644)
  assert.equal((await lstat(join(input, file.path))).mode & 0o7777, 0o600)
 }
 assert.deepEqual(await readdir(installed.root), ['published'])
 checks.push('actual POSIX modes set only in owned fixture and atomic stage renamed')
 const second = await installVideoFixture(request, new AbortController().signal)
 assert.notEqual(second.root, installed.root)
 checks.push('repeated runs use separate roots and do not overwrite prior publish')
 await assert.rejects(
  installVideoFixture({...request, expectedProductVersion: 'other'}, new AbortController().signal),
  /version/
 )
 checks.push('version mismatch rejected')
 await assert.rejects(
  installVideoFixture({...request, expectedTarget: {platform: 'linux', arch: 'x64'}}, new AbortController().signal),
  /actual macOS/
 )
 checks.push('target mismatch rejected without OS simulation')
 await assert.rejects(
  installVideoFixture(
   {...request, descriptor: {...request.descriptor, filesDigest: '0'.repeat(64)}},
   new AbortController().signal
  ),
  /Descriptor/
 )
 checks.push('descriptor mismatch rejected')
 for (const kind of ['extra', 'hash', 'symlink', 'hardlink']) {
  const dir = await payload()
  if (kind === 'extra') await writeFile(join(dir, 'extra'), 'x')
  if (kind === 'hash') await writeFile(join(dir, 'ffmpeg'), 'bad')
  if (kind === 'symlink') await symlink(join(dir, 'ffmpeg'), join(dir, 'extra'))
  if (kind === 'hardlink') await link(join(dir, 'ffmpeg'), join(work, 'hardlink'))
  await assert.rejects(installVideoFixture({...request, payloadDirectory: dir}, new AbortController().signal))
  checks.push(kind + ' payload rejected')
 }
 const abort = new AbortController()
 abort.abort()
 await assert.rejects(installVideoFixture(request, abort.signal))
 checks.push('pre-cancelled request rejected')
 // Deterministic barriers wrap builtin operations in this test process only.
 // The executor exposes no callback, path override or OS simulation hook.
 for (const scenario of [
  'copy-abort',
  'chmod-abort',
  'pre-publish-abort',
  'wrong-mode',
  'readback-mismatch',
  'existing-publish',
  'stage-directory-swap',
  'stage-directory-link'
 ]) {
  const controller = new AbortController(),
   originalOpen = fsPromises.open,
   originalStat = fsPromises.lstat,
   originalMode = fsPromises.chmod
  let stage = '',
   fired = false,
   publish = ''
  fsPromises.open = async (...args: Parameters<typeof fsPromises.open>) => {
   const handle = await originalOpen(...args)
   if (String(args[0]).includes('/stage/') && args[1] === 'wx') {
    const write = handle.writeFile.bind(handle)
    handle.writeFile = async (...writeArgs: Parameters<typeof handle.writeFile>) => {
     await write(...writeArgs)
     if (!fired && scenario === 'copy-abort') {
      fired = true
      controller.abort()
     }
     if (!fired && scenario === 'readback-mismatch') {
      fired = true
      await handle.write(Buffer.from('!'), 0, 1, 0)
     }
    }
   }
   if (String(args[0]).includes('/stage/')) {
    const setMode = handle.chmod.bind(handle)
    handle.chmod = async mode => {
     await setMode(mode)
     if (scenario === 'chmod-abort') {
      fired = true
      controller.abort()
     }
     if (scenario === 'wrong-mode') {
      fired = true
      await setMode(0o600)
     }
     if (!fired && (scenario === 'stage-directory-swap' || scenario === 'stage-directory-link')) {
      fired = true
      const stagePath = String(args[0]).split('/stage/')[0] + '/stage'
      await fsPromises.rename(stagePath, stagePath + '-original')
      if (scenario === 'stage-directory-swap') await mkdir(stagePath)
      else await symlink(input, stagePath)
     }
    }
   }
   return handle
  }
  fsPromises.chmod = async (...args: Parameters<typeof fsPromises.chmod>) => {
   await originalMode(...args)
   if (scenario === 'wrong-mode') {
    fired = true
    await originalMode(args[0], 0o600)
   }
  }
  fsPromises.lstat = (async (...args: Parameters<typeof fsPromises.lstat>) => {
   if (String(args[0]).endsWith('/published') && !fired) {
    if (scenario === 'pre-publish-abort') {
     fired = true
     controller.abort()
    }
    if (scenario === 'existing-publish') {
     fired = true
     publish = String(args[0])
     await mkdir(publish)
     await writeFile(join(publish, 'sentinel'), 'keep')
    }
   }
   return originalStat(...args)
  }) as typeof fsPromises.lstat
  syncBuiltinESMExports()
  try {
   await assert.rejects(installVideoFixture(request, controller.signal), error => {
    stage = (error as Error).message.split('retained at ')[1]
    return !!stage
   })
  } finally {
   fsPromises.open = originalOpen
   fsPromises.lstat = originalStat
   fsPromises.chmod = originalMode
   syncBuiltinESMExports()
  }
  assert(fired)
  assert(stage)
  if (scenario === 'existing-publish') assert.equal(await readFile(join(publish, 'sentinel'), 'utf8'), 'keep')
  else if (scenario.startsWith('stage-directory'))
   assert.deepEqual((await readdir(dirname(stage))).sort(), ['stage', 'stage-original'])
  else assert.deepEqual(await readdir(dirname(stage)), ['stage'])
  for (const file of files) {
   assert.equal((await lstat(join(input, file.path))).mode & 0o7777, 0o600)
   assert.equal(
    createHash('sha256')
     .update(await readFile(join(input, file.path)))
     .digest('hex'),
    file.sha256
   )
  }
  checks.push(scenario + ' deterministic barrier refuses publish and preserves input')
 }
 report.status = 'passed'
 report.checks = checks
} catch (error) {
 report.status = 'failed'
 report.error = error instanceof Error ? error.message : 'Unknown failure'
 process.exitCode = 1
} finally {
 report.binding = {
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
    [
     'scripts/runtime-v2-fixture-install.mts',
     'scripts/runtime-v2-fixture-smoke.mts',
     'src/shared/runtime-manifest-v2.ts',
     'src/shared/runtime-descriptor-v2.ts'
    ].map(async path => [
     path,
     createHash('sha256')
      .update(await readFile(join(root, path)))
      .digest('hex')
    ])
   )
  )
 }
 await writeFile(resolve(output), JSON.stringify(report, null, 2) + '\n')
 console.log(JSON.stringify(report))
}
