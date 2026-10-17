import JSZip from 'jszip'
import {createReadStream, createWriteStream} from 'node:fs'
import {readdir, readFile, mkdir, stat} from 'node:fs/promises'
import {resolve, join, dirname, relative} from 'node:path'
import {fileURLToPath} from 'node:url'
import {pipeline} from 'node:stream/promises'
import {createHash} from 'node:crypto'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'),
 pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')),
 zip = new JSZip(),
 files: string[] = []
async function walk(folder: string) {
 for (const item of await readdir(folder, {withFileTypes: true})) {
  if (item.isSymbolicLink()) throw new Error('源码包不跟随链接')
  const path = join(folder, item.name)
  if (item.isDirectory()) await walk(path)
  else {
   const name = relative(root, path).replaceAll('\\', '/')
   if (/\.(?:py|pyc|cjs|ps1|db|sqlite|pdf|pptx?|srt|mp4|log)$/i.test(name))
    throw new Error('源码白名单目录出现历史实现或个人资料：' + name)
   files.push(name)
  }
 }
}
for (const folder of ['src', 'prompts']) await walk(join(root, folder))
for (const item of await readdir(join(root, 'scripts'), {withFileTypes: true}))
 if (
  item.isFile() &&
  item.name.endsWith('.mts') &&
  !item.name.startsWith('github-') &&
  !item.name.startsWith('retire-')
 )
  files.push('scripts/' + item.name)
for (const name of [
 'package.json',
 'pnpm-lock.yaml',
 'pnpm-workspace.yaml',
 'biome.jsonc',
 'electron.vite.config.ts',
 'tsconfig.json',
 'tsconfig.migrations.json',
 'README.md',
 'LICENSE',
 'NOTICE',
 'THIRD_PARTY_NOTICES.md',
 'resources/runtime-manifest.json',
 'resources/icon.ico',
 'resources/icon.png',
 'resources/icon.svg',
 'docs/架构.md',
 'docs/验收与排障.md',
 'docs/后台协议.md',
 'docs/0.1.85版本说明.md',
 'docs/跨平台适配清单.md'
])
 files.push(name)
for (const path of files) zip.file(path, createReadStream(join(root, path)))
const output = join(root, 'release/source')
await mkdir(output, {recursive: true})
const archive = join(output, `Meiji-Listening-Guide-${pkg.version}-source.zip`)
await pipeline(
 zip.generateNodeStream({
  type: 'nodebuffer',
  streamFiles: true,
  compression: 'DEFLATE',
  compressionOptions: {level: 6}
 }),
 createWriteStream(archive)
)
const hash = createHash('sha256')
for await (const bytes of createReadStream(archive)) hash.update(bytes)
const receipt = {
 version: pkg.version,
 path: archive,
 size: (await stat(archive)).size,
 sha256: hash.digest('hex'),
 files: files.length,
 userDataIncluded: false,
 legacyCodeIncluded: false
}
await import('node:fs/promises').then(fs => fs.writeFile(archive + '.json', JSON.stringify(receipt, null, 2)))
console.log(JSON.stringify(receipt))
