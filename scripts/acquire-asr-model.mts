import {createHash} from 'node:crypto'
import {mkdir, open, readFile, lstat, rename, rm, writeFile} from 'node:fs/promises'
import {createReadStream} from 'node:fs'
import {dirname, join, resolve, sep} from 'node:path'
import {fileURLToPath} from 'node:url'
import {z} from 'zod'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const revision = '36050c46d777d46dc4b5f43f6d90574fc38f8732',
 repository = 'onnx-community/whisper-small'
const target = join(root, 'resources/asr/onnx-small')
if (process.argv.includes('--verify-local')) {
 const acquired = z
  .object({
   repository: z.literal(repository),
   revision: z.literal(revision),
   files: z
    .array(
     z.object({path: z.string(), size: z.number().int().nonnegative(), sha256: z.string().regex(/^[a-f0-9]{64}$/)})
    )
    .min(1)
  })
  .parse(JSON.parse(await readFile(join(target, 'acquisition.json'), 'utf8')))
 for (const file of acquired.files) {
  const path = resolve(target, file.path)
  if (!path.startsWith(target + sep)) throw new Error('模型记录路径越界')
  const item = await lstat(path)
  if (!item.isFile() || item.isSymbolicLink() || item.size !== file.size)
   throw new Error('本地模型大小或类型不符：' + file.path)
  const hash = createHash('sha256')
  for await (const bytes of createReadStream(path)) hash.update(bytes)
  if (hash.digest('hex') !== file.sha256) throw new Error('本地模型哈希不符：' + file.path)
 }
 const license = await readFile(join(target, 'VAD-LICENSE.txt'), 'utf8')
 if (!license.includes('MIT License')) throw new Error('缺少语音检测模型原许可')
 console.log(
  JSON.stringify({localOnly: true, verifiedFiles: acquired.files.length, legacyPythonResourcesRequired: false})
 )
 process.exit(0)
}
const weights: Record<string, {size: number; sha256: string}> = {
 'onnx/encoder_model_quantized.onnx': {
  size: 92326160,
  sha256: 'a43a83f3c5361cd591cfa7c36f14b43cf7cb22f47a415cc14a8d557be800fa92'
 },
 'onnx/decoder_model_merged_quantized.onnx': {
  size: 156750845,
  sha256: 'ec07c3cbb64172c39791e26ee870a65ac22b458c36722bfe2776b3dbf741e0c9'
 }
}
const selected = [
 'README.md',
 'config.json',
 'generation_config.json',
 'preprocessor_config.json',
 'tokenizer.json',
 'tokenizer_config.json',
 'special_tokens_map.json',
 'added_tokens.json',
 'normalizer.json',
 'merges.txt',
 'vocab.json',
 ...Object.keys(weights)
]
const source = await fetch(`https://huggingface.co/api/models/${repository}/revision/${revision}?blobs=true`, {
 signal: AbortSignal.timeout(30000)
})
if (!source.ok) throw new Error('模型元数据读取失败：HTTP ' + source.status)
const metadata = z
 .object({
  sha: z.literal(revision),
  siblings: z.array(
   z.object({
    rfilename: z.string(),
    size: z.number().int().nonnegative(),
    blobId: z.string().optional(),
    lfs: z.object({sha256: z.string(), size: z.number()}).optional()
   })
  )
 })
 .parse(await source.json())
await mkdir(target, {recursive: true})
const files: {path: string; size: number; sha256: string}[] = []
for (const name of selected) {
 const entry = metadata.siblings.find(item => item.rfilename === name)
 if (!entry) throw new Error('模型缺少必要文件：' + name)
 const weight = weights[name]
 if (weight && (entry.size !== weight.size || entry.lfs?.sha256 !== weight.sha256))
  throw new Error('模型权重与固定校验值不符')
 const path = resolve(target, name)
 if (!path.startsWith(target + sep)) throw new Error('模型文件路径超出目标目录')
 await mkdir(dirname(path), {recursive: true})
 const digest = async () => {
  const hash = createHash('sha256')
  for await (const bytes of createReadStream(path)) hash.update(bytes)
  return hash.digest('hex')
 }
 let existing = false
 try {
  const item = await lstat(path)
  if (item.isSymbolicLink() || !item.isFile()) throw new Error('模型路径已有其他文件')
  if (item.size !== entry.size) throw new Error('已有模型长度不符，保留当前文件')
  const hash = await digest()
  if (weight && hash !== weight.sha256) throw new Error('已有模型校验失败，保留当前文件')
  if (!weight && entry.blobId) {
   const git = createHash('sha1')
    .update(`blob ${item.size}\0`)
    .update(await readFile(path))
    .digest('hex')
   if (git !== entry.blobId) throw new Error('已有模型配置与固定修订不符')
  }
  files.push({path: name, size: item.size, sha256: hash})
  existing = true
 } catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
 }
 if (existing) continue
 const partial = path + '.partial'
 // Only an interrupted download at this exact owned path is replaceable.
 try {
  const item = await lstat(partial)
  if (item.isSymbolicLink() || !item.isFile()) throw new Error('模型暂存路径无效')
  await rm(partial)
 } catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
 }
 const response = await fetch(`https://huggingface.co/${repository}/resolve/${revision}/${name}`, {
  signal: AbortSignal.timeout(300000)
 })
 if (!response.ok || !response.body) throw new Error('模型下载失败：HTTP ' + response.status)
 const handle = await open(partial, 'wx'),
  sha = createHash('sha256'),
  git = createHash('sha1').update(`blob ${entry.size}\0`)
 const reader = response.body.getReader()
 let size = 0
 try {
  while (true) {
   const {value, done} = await reader.read()
   if (done) break
   size += value.length
   if (size > entry.size) throw new Error('模型下载超过固定长度')
   sha.update(value)
   git.update(value)
   await handle.writeFile(value)
  }
  await handle.sync()
 } finally {
  await handle.close()
  await reader.cancel().catch(() => undefined)
  reader.releaseLock()
 }
 const hash = sha.digest('hex')
 if (size !== entry.size || (weight ? hash !== weight.sha256 : entry.blobId && git.digest('hex') !== entry.blobId))
  throw new Error('模型下载校验失败，暂存保留待检查')
 await rename(partial, path)
 files.push({path: name, size, sha256: hash})
 console.log('模型文件已核验：' + name)
}
const base = await fetch('https://huggingface.co/api/models/openai/whisper-small', {signal: AbortSignal.timeout(30000)})
if (!base.ok) throw new Error('上游模型许可读取失败')
const license = z
 .object({id: z.literal('openai/whisper-small'), cardData: z.object({license: z.literal('apache-2.0')})})
 .parse(await base.json())
const licenseText = await readFile(join(root, 'node_modules/@huggingface/transformers/LICENSE'), 'utf8')
if (!licenseText.includes('Apache License')) throw new Error('缺少 Apache 2.0 许可全文')
await writeFile(join(target, 'MODEL-LICENSE.txt'), licenseText)
// VAD is a standalone ONNX resource. Restoring a clean checkout uses the native release component,
// never a Python wheel or an old interpreter directory.
const vad = await readFile(join(target, 'silero-vad-v6.onnx'))
const vadHash = createHash('sha256').update(vad).digest('hex')
if (vadHash !== '4cbf549b8326f60f80f2536d9eefeb450a9abe83365a098031c89719f1be17d2')
 throw new Error('已有语音检测模型校验失败')
await writeFile(join(target, 'silero-vad-v6.onnx'), vad)
const vadLicense = await readFile(join(target, 'VAD-LICENSE.txt'), 'utf8')
if (!vadLicense.includes('MIT License')) throw new Error('缺少独立语音检测模型许可，请恢复同版本原生模型组件')
files.push({path: 'silero-vad-v6.onnx', size: vad.length, sha256: vadHash})
await writeFile(
 join(target, 'acquisition.json'),
 JSON.stringify(
  {
   repository,
   revision,
   baseModel: license.id,
   license: license.cardData.license,
   dtype: 'q8',
   files,
   transcriptionVerified: false
  },
  null,
  2
 )
)
console.log(
 JSON.stringify({target, verifiedBytes: files.reduce((sum, file) => sum + file.size, 0), transcriptionVerified: false})
)
