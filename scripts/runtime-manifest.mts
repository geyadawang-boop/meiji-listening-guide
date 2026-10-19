import {readdir, readFile, stat, writeFile} from 'node:fs/promises'
import {createReadStream, existsSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import type {RuntimeFile, RuntimeManifest} from '../src/shared/runtime.ts'

const catalog = [
 ['knowledge', '知识库、研究与通讯后台', 'knowledge'],
 ['asr', '离线字幕模型', 'asr'],
 ['video', '视频下载与处理工具', 'video']
] as const
function included(id: string, path: string, platform: NodeJS.Platform) {
 if (id === 'knowledge')
  return path.startsWith('onnx-bge/') || ['vendor/NapCat.Shell.Windows.Node.zip', 'BiliSum-LICENSE'].includes(path)
 if (id === 'asr') return path.startsWith('onnx-small/')
 if (id === 'video')
  return [
   'ffmpeg' + (platform === 'win32' ? '.exe' : ''),
   'ffprobe' + (platform === 'win32' ? '.exe' : ''),
   'LICENSE-ffmpeg-static.txt',
   'LICENSE-ffprobe.txt'
  ].includes(path)
 return !/\.(?:py|pyc)$/i.test(path)
}
export async function generate(root: string): Promise<RuntimeManifest> {
 const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as {version: string}
 const components: RuntimeManifest['components'] = []
 for (const [id, label, directory] of catalog) {
  const base = join(root, 'resources', directory),
   pending: {path: string; source: string}[] = [],
   files: RuntimeFile[] = []
  if (!existsSync(base)) {
   throw new Error('缺少组件目录，未改写运行清单：' + directory + '；使用已审核清单构建 lite/portable 请加 --prepared')
  }
  async function walk(path: string, prefix = ''): Promise<void> {
   for (const entry of await readdir(path, {withFileTypes: true})) {
    if (entry.name === '__pycache__' || entry.name.endsWith('.pyc')) continue
    const relative = prefix + entry.name,
     source = join(path, entry.name)
    if (entry.isSymbolicLink()) throw new Error('运行资源不能包含目录链接：' + relative)
    if (entry.isDirectory()) {
     if (
      id === 'knowledge' &&
      !['onnx-bge/', 'vendor/'].some(prefix => prefix.startsWith(relative + '/') || relative.startsWith(prefix))
     )
      continue
     if (id === 'asr' && relative !== 'onnx-small' && !relative.startsWith('onnx-small/')) continue
     await walk(source, relative + '/')
    } else if (included(id, relative, process.platform)) pending.push({path: relative, source})
   }
  }
  await walk(base)
  if (!pending.length) throw new Error('组件没有可用文件，未改写运行清单：' + directory)
  console.log(`校验 ${id}（${pending.length} 个文件）`)
  let cursor = 0
  await Promise.all(
   Array.from({length: Math.min(16, pending.length)}, async () => {
    while (cursor < pending.length) {
     const entry = pending[cursor++],
      before = await stat(entry.source),
      hash = createHash('sha256')
     for await (const bytes of createReadStream(entry.source, {highWaterMark: 1048576})) hash.update(bytes)
     const after = await stat(entry.source)
     if (before.size !== after.size || before.mtimeMs !== after.mtimeMs)
      throw new Error('清单生成期间运行资源改变：' + entry.path)
     files.push({path: entry.path, size: before.size, sha256: hash.digest('hex')})
    }
   })
  )
  files.sort((a, b) => a.path.localeCompare(b.path))
  components.push({id, label, directory, files, bytes: files.reduce((sum, file) => sum + file.size, 0)})
 }
 const manifest: RuntimeManifest = {schema: 1, productVersion: pkg.version, components}
 await writeFile(join(root, 'resources/runtime-manifest.json'), JSON.stringify(manifest))
 return manifest
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
 const manifest = await generate(resolve(dirname(fileURLToPath(import.meta.url)), '..'))
 console.log(
  manifest.components.map(component => `${component.id}: ${(component.bytes / 1048576).toFixed(1)} MiB`).join('\n')
 )
}
