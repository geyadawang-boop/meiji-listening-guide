import {build} from 'esbuild'
import {_electron} from 'playwright'
import {createRequire} from 'node:module'
import {spawn, execFileSync} from 'node:child_process'
import {mkdir, readFile, writeFile} from 'node:fs/promises'
import {createHash, randomUUID} from 'node:crypto'
import {dirname, isAbsolute, join, resolve} from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'
import {release} from 'node:os'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'),
 require = createRequire(import.meta.url),
 outputIndex = process.argv.indexOf('--output'),
 output = resolve(outputIndex >= 0 ? process.argv[outputIndex + 1] : join(root, 'tmp/runtime-smoke')),
 run = Date.now() + '-' + randomUUID(),
 work = join(output, 'work', run),
 results = join(output, 'results', run),
 electron = require('electron') as string
await mkdir(join(work, 'electron-profile'), {recursive: true})
await mkdir(results, {recursive: true})
const commit = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim(),
 dirty = !!execFileSync('git', ['status', '--porcelain'], {cwd: root, encoding: 'utf8'}).trim(),
 files = new Set([
  ...execFileSync('git', ['ls-files', '-z'], {cwd: root, encoding: 'utf8'}).split('\0').filter(Boolean),
  'scripts/runtime-smoke.mts',
  'scripts/runtime-smoke-electron.mts'
 ]),
 sourceHash = createHash('sha256')
for (const path of [...files].sort()) sourceHash.update(path + '\0').update(await readFile(join(root, path)))
const source = {commit, dirty, sha256: sourceHash.digest('hex')}
const osProductVersion =
 process.platform === 'darwin'
  ? execFileSync('/usr/bin/sw_vers', ['-productVersion'], {encoding: 'utf8'}).trim()
  : undefined
const switches = process.platform === 'linux' ? ['--password-store=gnome-libsecret', '--no-sandbox'] : []
const environment: NodeJS.ProcessEnv = {
 ...process.env,
 MEIJI_SMOKE_ROOT: root,
 MEIJI_SMOKE_WORK: work,
 MEIJI_SMOKE_RESULTS: results,
 ...(osProductVersion ? {MEIJI_SMOKE_OS_PRODUCT_VERSION: osProductVersion} : {})
}
delete environment.ELECTRON_RUN_AS_NODE

async function electronPhase(phase: 'seed' | 'restart') {
 await new Promise<void>((resolvePhase, reject) => {
  const child = spawn(electron, [join(work, 'fixture.mjs'), ...switches], {
   env: {...environment, MEIJI_SMOKE_PHASE: phase},
   windowsHide: true,
   stdio: ['ignore', 'pipe', 'pipe']
  })
  let log = '',
   timedOut = false
  const timer = setTimeout(() => {
   timedOut = true
   child.kill()
  }, 120000)
  child.stdout.on('data', bytes => {
   log = (log + bytes.toString()).slice(-64000)
  })
  child.stderr.on('data', bytes => {
   log = (log + bytes.toString()).slice(-64000)
  })
  child.once('error', error => {
   clearTimeout(timer)
   reject(error)
  })
  child.once('close', code => {
   clearTimeout(timer)
   if (code === 0 && !timedOut) resolvePhase()
   else
    void writeFile(join(results, phase + '-failure.log'), log).then(
     () => reject(new Error(phase + (timedOut ? ' timed out' : ' failed') + '; see its result/log artifact')),
     reject
    )
  })
 })
 const result = JSON.parse(await readFile(join(results, phase + '.json'), 'utf8'))
 if (result.status !== 'passed') throw new Error(phase + ' did not produce a passing result')
}
async function navigation() {
 const application = await _electron.launch({
  executablePath: electron,
  args: [root, ...switches],
  env: {...environment, LISTENING_ASSISTANT_DATA: join(work, 'navigation-profile')},
  timeout: 60000
 })
 const checks: string[] = [],
  errors: string[] = []
 try {
  const page = await application.firstWindow()
  page.setDefaultTimeout(20000)
  page.on('pageerror', error => errors.push(error.message))
  await page.getByRole('heading', {name: '从一门课程开始'}).waitFor()
  await page.locator('nav.app-icon-rail').getByRole('button', {name: '模型库', exact: true}).click()
  await page.evaluate(async () => {
   await document.fonts.ready
  })
  const dialog = page.getByRole('dialog', {name: '设置', exact: true}),
   original = await dialog.boundingBox(),
   positions = await dialog.getByRole('navigation', {name: '设置导航'}).boundingBox()
  for (const name of ['搜索与主题', '提示词', '通义千问']) {
   await dialog.getByRole('button', {name, exact: true}).click()
   await page.evaluate(
    () => new Promise<void>(resolveFrame => requestAnimationFrame(() => requestAnimationFrame(() => resolveFrame())))
   )
   if ((await page.locator('.model-settings-window').count()) !== 1 || (await page.locator('.overlay').count()) !== 0)
    throw new Error('Settings section changed into a modal: ' + name)
   if (
    JSON.stringify(await dialog.boundingBox()) !== JSON.stringify(original) ||
    JSON.stringify(await dialog.getByRole('navigation', {name: '设置导航'}).boundingBox()) !== JSON.stringify(positions)
   )
    throw new Error('Settings section or navigation moved: ' + name)
   checks.push(name + ' retains the full-page layout and navigation position')
  }
  await page.screenshot({path: join(results, 'settings.png'), fullPage: true})
  await dialog.getByRole('button', {name: '关闭', exact: true}).click()
  if (await page.locator('.model-settings-window').count()) throw new Error('Settings did not close')
  if (errors.length) throw new Error('Renderer reported errors')
  await writeFile(join(results, 'navigation.json'), JSON.stringify({status: 'passed', checks, errors}, null, 2))
 } finally {
  await application.close()
 }
}
try {
 const exports = [
  ['systemProtect', 'system-encryption'],
  ['NativeMediaAuth', 'media-auth'],
  ['NativeDownloadJobs', 'media-jobs'],
  ['NativeDownloads', 'media-downloads'],
  ['NativeResearchBackend', 'research']
 ].map(
  ([symbol, file]) =>
   `export {${symbol}} from ${JSON.stringify(join(root, 'src/main', file + '.ts').replaceAll('\\', '/'))};`
 )
 exports.push("export {default as Database} from 'better-sqlite3';")
 await build({
  stdin: {contents: exports.join('\n'), resolveDir: root, loader: 'ts'},
  outfile: join(work, 'owners.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  define: {'import.meta.url': JSON.stringify(pathToFileURL(join(root, 'out/main/main.js')).href)},
  plugins: [
   {
    name: 'native-runtime-dependencies',
    setup(builder) {
     builder.onResolve({filter: /^[^./]/}, args => {
      if (isAbsolute(args.path)) return
      if (args.path === 'electron' || args.path.startsWith('node:')) return {path: args.path, external: true}
      return {path: import.meta.resolve(args.path), external: true}
     })
    }
   }
  ]
 })
 await build({
  entryPoints: [join(root, 'scripts/runtime-smoke-electron.mts')],
  outfile: join(work, 'fixture.mjs'),
  bundle: true,
  packages: 'external',
  platform: 'node',
  format: 'esm'
 })
 await electronPhase('seed')
 await electronPhase('restart')
 await navigation()
 await writeFile(
  join(results, 'summary.json'),
  JSON.stringify(
   {
    status: 'passed',
    source,
    platform: process.platform,
    arch: process.arch,
    osRelease: release(),
    osProductVersion,
    phases: ['seed', 'restart', 'navigation'],
    scope:
     'Synthetic isolated data; real OS vault and production utilityProcesses. Fixture model/media callbacks reject requests. Navigation checks layout only; background network absence is not asserted. No account login, installation or publishing.'
   },
   null,
   2
  )
 )
 console.log(JSON.stringify({status: 'passed', results, source}))
} catch (error) {
 await writeFile(
  join(results, 'summary.json'),
  JSON.stringify(
   {
    status: 'failed',
    source,
    platform: process.platform,
    arch: process.arch,
    error: error instanceof Error ? error.message : 'Unknown runtime failure'
   },
   null,
   2
  )
 )
 console.error('Runtime smoke failed; inspect ' + results)
 process.exitCode = 1
}
