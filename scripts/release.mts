// Full executables are rebuilt by electron-builder; never patch an old EXE.
import {copyFile, mkdir, readFile, readdir, rm, writeFile} from 'node:fs/promises'
import {existsSync} from 'node:fs'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {build, Platform, type Configuration} from 'electron-builder'
import {z} from 'zod'
import {generate} from './runtime-manifest.mts'
import type {RuntimeManifest} from '../src/shared/runtime.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const profile = z.enum(['full', 'lite', 'components', 'portable']).parse(process.argv[2])
const requested = z
 .enum(['win', 'mac', 'linux'])
 .optional()
 .parse(process.argv.find(argument => argument.startsWith('--platform='))?.slice('--platform='.length))
const platform =
 requested === 'win'
  ? Platform.WINDOWS
  : requested === 'mac'
    ? Platform.MAC
    : requested === 'linux'
      ? Platform.LINUX
      : Platform.current()
const active = requested || (process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux')
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as {
 version: string
 devDependencies: {electron: string}
 build: Configuration
}
const manifest: RuntimeManifest = process.argv.includes('--prepared')
 ? JSON.parse(await readFile(join(root, 'resources/runtime-manifest.json'), 'utf8'))
 : await generate(root)
if (manifest.schema !== 1 || manifest.productVersion !== pkg.version) throw new Error('运行清单与产品版本不一致')
const output = join(root, 'release', profile)
if (profile === 'components') {
 await mkdir(output, {recursive: true})
 for (const component of manifest.components) {
  const directory = join(output, component.id + '-' + pkg.version),
   payload = join(directory, 'payload')
  await mkdir(payload, {recursive: true})
  for (const file of component.files) {
   const target = join(payload, ...file.path.split('/'))
   await mkdir(dirname(target), {recursive: true})
   await copyFile(join(root, 'resources', component.directory, ...file.path.split('/')), target)
  }
  await writeFile(
   join(directory, 'component.json'),
   JSON.stringify({schema: 1, id: component.id, productVersion: pkg.version, bytes: component.bytes}, null, 2)
  )
 }
 console.log('同版本本地组件包已生成')
} else {
 if (profile === 'full' && platform !== Platform.WINDOWS)
  throw new Error('完整发布仅支持 Windows；macOS/Linux 请使用 lite')
 const optional = new Set(manifest.components.map(component => component.directory))
 const entries = pkg.build.extraResources
 if (!Array.isArray(entries)) throw new Error('发布资源配置必须为数组')
 const missing = new Set(
  manifest.components
   .map(component => component.directory)
   .filter(directory => !existsSync(join(root, 'resources', directory)))
 )
 if (profile === 'full' && missing.size) throw new Error('完整发布缺少组件目录：' + [...missing].join('、'))
 const resources = entries.filter(entry => {
  if (typeof entry === 'string' || !entry.from) return true
  if (entry.to && optional.has(entry.to)) {
   if (profile === 'lite') return false
   if (missing.has(entry.to)) {
    console.warn('缺少组件目录，已跳过：' + entry.to)
    return false
   }
  }
  return true
 })
 const targets =
  profile === 'portable'
   ? ['dir']
   : platform === Platform.WINDOWS
     ? ['nsis']
     : platform === Platform.MAC
       ? ['dmg', 'zip']
       : ['AppImage', 'deb']
 const configPath = join(root, 'tmp', 'release-' + profile + '.json')
 await rm(join(output, 'release-info.json'), {force: true})
 await mkdir(dirname(configPath), {recursive: true})
 const config: Configuration = {
  ...pkg.build,
  extends: null,
  npmRebuild: false,
  electronVersion: pkg.devDependencies.electron,
  electronDist: join(root, 'node_modules/electron/dist'),
  directories: {output},
  extraResources: resources,
  artifactName: '梅酱的听课指南-' + pkg.version + '-' + profile + '-${arch}.${ext}',
  publish: null
 }
 await writeFile(configPath, JSON.stringify(config))
 await build({targets: platform.createTarget(targets), config: configPath})
 const files = await readdir(output)
 await writeFile(
  join(output, 'release-info.json'),
  JSON.stringify(
   {
    productVersion: pkg.version,
    electronVersion: pkg.devDependencies.electron,
    profile,
    platform: active,
    optionalComponents: profile === 'lite' ? manifest.components.map(component => component.id) : [],
    artifacts: files.filter(file => /\.(?:exe|dmg|zip|AppImage|deb)$/.test(file))
   },
   null,
   2
  )
 )
 console.log(`已构建 ${profile} ${pkg.version}（${active}）`)
}
