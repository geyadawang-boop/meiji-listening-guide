import {readFile, writeFile, mkdir, rename, lstat} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'),
 directory = join(root, 'resources/knowledge/onnx-bge')
const revision = '75c43b069aac4d136ba6bc1122f995fedcfd2781'
const files = [
 ['README.md', 1057, 'e26ec7fcc01a7aff66171d44acff0a80fae865e1'],
 ['config.json', 716, 'd590a6643f5dcdd0cfb0477e3c291488c16fc2d7'],
 ['special_tokens_map.json', 125, 'a8b3208c2884c4efb86e49300fdd3dc877220cdf'],
 ['tokenizer.json', 439125, 'cdb3043fc938fc918c06e66cf704c2ba58f88747'],
 ['tokenizer_config.json', 367, '3a59388f0fd1bd22dec2ce7902c1be8e1fb84107'],
 ['vocab.txt', 109540, 'ca4f9781030019ab9b253c6dcb8c7878b6dc87a5'],
 ['onnx/model_quantized.onnx', 24010842, '15b717c382bcb518ba457b93ea6850ede7f4f1cd8937454aa06972366cd19bcc']
] as const
const saved = []
for (const [name, size, expected] of files) {
 const path = join(directory, name)
 await mkdir(dirname(path), {recursive: true})
 let bytes: Buffer
 try {
  const info = await lstat(path)
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('模型路径不可用')
  bytes = await readFile(path)
 } catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  const response = await fetch(`https://huggingface.co/Xenova/bge-small-zh-v1.5/resolve/${revision}/${name}`, {
   signal: AbortSignal.timeout(120000)
  })
  if (!response.ok) throw new Error(`模型下载失败：HTTP ${response.status}`)
  bytes = Buffer.from(await response.arrayBuffer())
 }
 const sha256 = createHash('sha256').update(bytes).digest('hex'),
  hash = expected.length === 64 ? sha256 : createHash('sha1').update(`blob ${size}\0`).update(bytes).digest('hex')
 if (bytes.length !== size || hash !== expected) throw new Error('模型固定版本校验失败：' + name)
 try {
  await lstat(path)
 } catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  await writeFile(path + '.partial', bytes, {flag: 'wx'})
  await rename(path + '.partial', path)
 }
 saved.push({path: name, size, sha256})
 console.log('语义模型已核验：' + name)
}
const licensePath = join(directory, 'MODEL-LICENSE.txt')
let license: string
try {
 license = await readFile(licensePath, 'utf8')
} catch (error) {
 if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
 const response = await fetch('https://raw.githubusercontent.com/FlagOpen/FlagEmbedding/master/LICENSE', {
  signal: AbortSignal.timeout(30000)
 })
 if (!response.ok) throw new Error('官方模型许可读取失败')
 license = await response.text()
}
if (!license.includes('MIT License')) throw new Error('原语义模型许可缺失')
await writeFile(join(directory, 'MODEL-LICENSE.txt'), license)
await writeFile(
 join(directory, 'acquisition.json'),
 JSON.stringify(
  {
   repository: 'Xenova/bge-small-zh-v1.5',
   revision,
   upstream: 'BAAI/bge-small-zh-v1.5',
   license: 'MIT',
   dtype: 'q8',
   files: saved,
   inferenceVerified: false
  },
  null,
  2
 )
)
console.log(JSON.stringify({directory, bytes: saved.reduce((sum, file) => sum + file.size, 0)}))
