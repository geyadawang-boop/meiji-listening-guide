import assert from 'node:assert/strict'
import {build} from 'esbuild'
import {createHash} from 'node:crypto'
import {execFileSync} from 'node:child_process'
import {chmod, mkdir, mkdtemp, open, readFile, readdir, realpath, rename, symlink, writeFile} from 'node:fs/promises'
import {tmpdir, release} from 'node:os'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'),
 output = process.argv[2]
assert(output, 'Result path required')
const checks: string[] = [],
 report: Record<string, unknown> = {
  status: 'running',
  scope:
   'Production RuntimeComponents API with isolated synthetic resources; no application installation or real user state.'
 }
try {
 if (process.env.GITHUB_ACTIONS === 'true') {
  assert.equal(process.platform, 'darwin')
  assert.equal(process.arch, 'arm64')
 }
 const work = await mkdtemp(join(await realpath(tmpdir()), 'meiji-runtime-status-'))
 await build({
  entryPoints: [join(root, 'src/main/app/runtime-components.ts')],
  outfile: join(work, 'service.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm'
 })
 const {RuntimeComponents} = await import(pathToFileURL(join(work, 'service.mjs')).href)
 const target = {platform: process.platform, arch: process.arch},
  names = process.platform === 'win32' ? ['ffmpeg.exe', 'ffprobe.exe'] : ['ffmpeg', 'ffprobe']
 const resources = join(work, 'resources')
 await mkdir(join(resources, 'video'), {recursive: true})
 const files = []
 for (const name of [...names, 'LICENSE.txt']) {
  const bytes = Buffer.from('Synthetic inert ' + name),
   mode = names.includes(name) && process.platform !== 'win32' ? '0755' : '0644'
  await writeFile(join(resources, 'video', name), bytes)
  await chmod(join(resources, 'video', name), mode === '0755' ? 0o755 : 0o644)
  files.push({path: name, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), mode})
 }
 const manifest = {
  schema: 2,
  productVersion: '0.0.0-test',
  target,
  components: [
   {id: 'video', label: 'Video', directory: 'video', target, files, bytes: files.reduce((n, f) => n + f.size, 0)}
  ]
 }
 const save = async (value: unknown) => writeFile(join(resources, 'runtime-manifest.json'), JSON.stringify(value))
 await save(manifest)
 const service = new RuntimeComponents(resources, '0.0.0-test'),
  first = service.status(),
  second = service.status()
 assert.equal(first, second)
 assert.equal((await first).components[0].validation, 'verified')
 checks.push('concurrent reads share one verification and valid actual target verifies')
 const before = await readdir(resources)
 await assert.rejects(
  service.install('video', join(work, 'nonexistent'), new AbortController().signal, () => {}),
  /尚未开放安装/
 )
 assert.deepEqual(await readdir(resources), before)
 checks.push('v2 installation refuses before source access or writes')
 const tool = join(resources, 'video', names[0])
 await rename(tool, tool + '.saved')
 assert.equal((await service.status()).components[0].validation, 'missing')
 await rename(tool + '.saved', tool)
 checks.push('missing tool reports missing')
 const original = await readFile(tool)
 await writeFile(tool, Buffer.alloc(original.length))
 assert.equal((await service.status()).components[0].validation, 'invalid')
 await writeFile(tool, original)
 checks.push('same-size tamper reports invalid on fresh refresh')
 if (process.platform !== 'win32') {
  await chmod(tool, 0o600)
  assert.equal((await service.status()).components[0].validation, 'invalid')
  await chmod(tool, 0o755)
  checks.push('actual POSIX wrong mode rejected')
 }
 const other = {
  platform: process.platform === 'darwin' ? 'linux' : 'darwin',
  arch: process.platform === 'darwin' ? 'x64' : 'arm64'
 }
 await save({
  ...manifest,
  target: other,
  components: manifest.components.map(c => ({
   ...c,
   target: other,
   files: c.files.map((f, index) => ({
    ...f,
    path: index < 2 ? ['ffmpeg', 'ffprobe'][index] : f.path,
    mode: index < 2 ? '0755' : '0644'
   }))
  }))
 })
 assert.equal((await service.status()).components[0].validation, 'unsupported_target')
 checks.push('valid foreign target returns unsupported without crashing')
 await save({...manifest, productVersion: 'wrong'})
 assert.equal((await service.status()).validation, 'invalid')
 checks.push('version mismatch returns invalid')
 await save({schema: 2, bad: 'value'})
 const invalid = await service.status()
 assert.equal(invalid.validation, 'invalid')
 assert(!JSON.stringify(invalid).includes(work))
 checks.push('malformed schema returns sanitized Chinese reason')
 const manifestPath = join(resources, 'runtime-manifest.json'),
  large = await open(manifestPath, 'w')
 await large.truncate(16 * 1024 * 1024 + 1)
 await large.close()
 assert.equal((await service.status()).validation, 'invalid')
 checks.push('oversized manifest refused before unbounded read')
 if (process.platform !== 'win32') {
  await rename(manifestPath, manifestPath + '.saved')
  await symlink(manifestPath + '.saved', manifestPath)
  assert.equal((await service.status()).validation, 'invalid')
  checks.push('manifest symlink rejected')
  await rename(manifestPath, manifestPath + '.link')
  await rename(manifestPath + '.saved', manifestPath)
 }
 await save(manifest)
 const sibling = join(work, 'source')
 await mkdir(sibling)
 await writeFile(join(sibling, 'file'), 'x')
 await rename(join(resources, 'video'), join(resources, 'video.saved'))
 await symlink(sibling, join(resources, 'video'), process.platform === 'win32' ? 'junction' : 'dir')
 assert.equal((await service.status()).components[0].validation, 'invalid')
 checks.push('component directory link rejected')
 const legacyRoot = join(work, 'legacy')
 await mkdir(legacyRoot)
 const legacy = {
  schema: 1,
  productVersion: 'legacy',
  components: [{id: 'video', label: 'Video', directory: 'video', files: [], bytes: 0}]
 }
 await writeFile(join(legacyRoot, 'runtime-manifest.json'), JSON.stringify(legacy))
 const legacyStatus = await new RuntimeComponents(legacyRoot, 'legacy').status()
 assert.equal(legacyStatus.validation, 'legacy')
 assert.equal(legacyStatus.components[0].installed, false)
 checks.push('legacy status stays existence-based and is not called verified')
 const realLegacy = JSON.parse(await readFile(join(root, 'resources/runtime-manifest.json'), 'utf8'))
 await writeFile(join(legacyRoot, 'runtime-manifest.json'), JSON.stringify(realLegacy))
 for (const component of realLegacy.components)
  for (const file of component.files) {
   const path = join(legacyRoot, component.directory, file.path)
   await mkdir(dirname(path), {recursive: true})
   await writeFile(path, 'legacy presence fixture')
  }
 const presentLegacy = await new RuntimeComponents(legacyRoot, realLegacy.productVersion).status()
 assert(
  presentLegacy.components.every(
   (c: {installed: boolean; validation: string}) => c.installed && c.validation === 'legacy'
  )
 )
 checks.push('real existing v1 manifest retains existence-only behavior without claiming integrity')
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
     'src/main/app/runtime-components.ts',
     'src/shared/runtime.ts',
     'src/shared/runtime-manifest-v2.ts',
     'src/renderer/src/features/tools/RuntimePanel.tsx',
     'scripts/runtime-v2-status-smoke.mts'
    ].map(async file => [
     file,
     createHash('sha256')
      .update(await readFile(join(root, file)))
      .digest('hex')
    ])
   )
  )
 }
 await writeFile(resolve(output), JSON.stringify(report, null, 2) + '\n')
 console.log(JSON.stringify(report))
}
