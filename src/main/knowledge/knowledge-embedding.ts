import {env, pipeline, type FeatureExtractionPipeline} from '@huggingface/transformers'
import {createHash} from 'node:crypto'
import {createReadStream} from 'node:fs'
import {readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {z} from 'zod'

export class KnowledgeEmbedding {
 private extractor: FeatureExtractionPipeline | undefined
 constructor(private directory: string) {}
 async load() {
  if (this.extractor) return
  const manifest = z
   .object({
    revision: z.literal('75c43b069aac4d136ba6bc1122f995fedcfd2781'),
    files: z.array(
     z.object({path: z.string(), size: z.number().int().nonnegative(), sha256: z.string().regex(/^[a-f0-9]{64}$/)})
    )
   })
   .parse(JSON.parse(await readFile(join(this.directory, 'acquisition.json'), 'utf8')))
  for (const file of manifest.files) {
   if (
    file.path.includes('\\') ||
    file.path.startsWith('/') ||
    file.path.includes(':') ||
    file.path.split('/').includes('..')
   )
    throw new Error('语义模型路径无效')
   const hash = createHash('sha256')
   let size = 0
   for await (const bytes of createReadStream(join(this.directory, file.path))) {
    hash.update(bytes)
    size += bytes.length
   }
   if (size !== file.size || hash.digest('hex') !== file.sha256) throw new Error('本地语义模型校验失败')
  }
  env.allowRemoteModels = false
  env.allowLocalModels = true
  env.useFSCache = false
  this.extractor = await pipeline('feature-extraction', this.directory.replaceAll('\\', '/'), {
   local_files_only: true,
   dtype: 'q8',
   device: 'cpu',
   session_options: {intraOpNumThreads: 4, interOpNumThreads: 1}
  })
 }
 async encode(text: string, query = false): Promise<number[]> {
  await this.load()
  const points = Array.from(text),
   windows: string[] = []
  for (let offset = 0; offset < points.length; offset += 320)
   windows.push((query ? '为这个句子生成表示以用于检索相关文章：' : '') + points.slice(offset, offset + 400).join(''))
  if (!windows.length) throw new Error('语义检索文字为空')
  const combined = Array<number>(512).fill(0)
  for (const window of windows) {
   const output = await this.extractor!(window, {pooling: 'cls', normalize: true})
   if (output.data.length !== 512) throw new Error('中文语义模型维度不符')
   for (let index = 0; index < 512; index++) combined[index] += Number(output.data[index])
  }
  const length = Math.sqrt(combined.reduce((sum, value) => sum + value * value, 0))
  if (!Number.isFinite(length) || !length) throw new Error('语义向量无效')
  return combined.map(value => value / length)
 }
 async dispose() {
  await this.extractor?.dispose()
  this.extractor = undefined
 }
}
