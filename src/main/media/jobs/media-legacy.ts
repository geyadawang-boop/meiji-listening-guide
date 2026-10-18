import {createHash} from 'node:crypto'
import {lstat, readFile, readdir, realpath} from 'node:fs/promises'
import {basename, dirname, extname, isAbsolute, join, resolve} from 'node:path'
import {z} from 'zod'
import type {MediaJob} from '@shared/media'
import {mediaOptions} from '@main/media/core/media-options'
import {biliMediaInput} from '@main/media/bilibili/media-bili'

const hash = (text: string) => createHash('sha256').update(text).digest('hex')
const id = z.string().regex(/^[a-f0-9]{32}$/)
const recordSchema = z.object({
 id,
 kb_root_id: z.string(),
 title: z.string().max(1000),
 state: z.enum(['queued', 'running', 'interrupted', 'cancelled', 'error', 'completed', 'forgotten']),
 stage: z.string().optional(),
 progress: z
  .object({
   downloaded: z.number().finite().nonnegative().optional(),
   total: z.number().finite().nonnegative().optional()
  })
  .default({}),
 error: z.string().default(''),
 warning: z.string().default(''),
 source: z.object({
  url: z.string().url(),
  storage_id: z.string().regex(/^[A-Za-z0-9_-]{3,64}$/),
  bvid: z.string().optional(),
  cid: z.number().int().positive().safe().optional(),
  page: z.number().int().positive().optional()
 }),
 options: z.unknown(),
 download_root: z.string(),
 output: z.string().default(''),
 files: z.array(z.string()).default([])
})
export type LegacyDownloadRecord = z.infer<typeof recordSchema> & {recordHash: string}
const mediaExtensions = {
 video: ['.mp4', '.mkv', '.flv', '.webm', '.m4v', '.mov', '.ts'],
 audio: ['.m4a', '.mp3', '.aac', '.flac', '.ogg', '.opus', '.wav'],
 subtitle: ['.srt', '.vtt', '.ass', '.ssa', '.lrc', '.ttml', '.srv3', '.json3']
}
const manifestSchema = z.object({
 schema_version: z.literal(2),
 managed_by: z.literal('bilisum'),
 bvid: z.string(),
 ownership_id: id,
 download_root: z.string(),
 directory: z.string(),
 media_kind: z.enum(['video', 'audio', 'subtitle']).default('video')
})
async function canonical(path: string) {
 return resolve(await realpath(path)).toLowerCase()
}
async function checkedDirectory(path: string) {
 const target = resolve(path),
  info = await lstat(target)
 if (!info.isDirectory() || info.isSymbolicLink() || (await canonical(target)) !== target.toLowerCase())
  throw new Error('旧下载目录含链接或路径已改变')
 return target
}
async function jsonFile(path: string, max = 1024 * 1024) {
 const info = await lstat(path)
 if (!info.isFile() || info.isSymbolicLink() || info.size > max) throw new Error('旧下载记录文件无效')
 const text = await readFile(path, 'utf8')
 return {value: JSON.parse(text), hash: hash(text)}
}

/** A read-only view of the original Python queue. Never upgrades markers or starts old workers. */
export class LegacyDownloads {
 constructor(private root: string) {}
 async scope() {
  const kb = resolve(this.root, 'knowledge_base')
  let normalized: string
  try {
   normalized = await canonical(await checkedDirectory(kb))
  } catch (error) {
   if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
   normalized = kb.toLowerCase()
  }
  return 'kbr_' + hash(JSON.stringify(['kbr', normalized])).slice(0, 32)
 }
 private async base() {
  const records = await checkedDirectory(join(this.root, 'records'))
  return checkedDirectory(join(records, await this.scope()))
 }
 async read(value: string): Promise<LegacyDownloadRecord> {
  id.parse(value)
  const directory = await checkedDirectory(join(await this.base(), value)),
   raw = await jsonFile(join(directory, 'state.json')),
   row = recordSchema.parse(raw.value)
  if (row.id !== value || row.kb_root_id !== (await this.scope())) throw new Error('旧任务来源目录不一致')
  return {...row, recordHash: raw.hash}
 }
 async list(): Promise<MediaJob[]> {
  let base: string
  try {
   base = await this.base()
  } catch (error) {
   if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
   try {
    const records = await checkedDirectory(join(this.root, 'records'))
    for (const folder of await readdir(records))
     if (/^kbr_[a-f0-9]{32}$/.test(folder)) {
      const path = await checkedDirectory(join(records, folder))
      for (const child of await readdir(path, {withFileTypes: true}))
       if (child.isDirectory() && !child.isSymbolicLink() && id.safeParse(child.name).success) {
        try {
         const info = await lstat(join(path, child.name, 'state.json'))
         if (info.isFile()) throw new Error('旧下载记录属于另一资料路径，需确认迁移位置；原文件保留')
        } catch (missing) {
         if ((missing as NodeJS.ErrnoException).code !== 'ENOENT') throw missing
        }
       }
     }
   } catch (other) {
    if ((other as NodeJS.ErrnoException).code !== 'ENOENT') throw other
   }
   return []
  }
  const rows: MediaJob[] = []
  for (const entry of await readdir(base, {withFileTypes: true})) {
   if (!entry.isDirectory() || entry.isSymbolicLink() || !id.safeParse(entry.name).success) continue
   try {
    const row = await this.read(entry.name)
    if (row.state === 'forgotten') continue
    rows.push({
     id: row.id,
     title: row.title,
     state: ['queued', 'running'].includes(row.state) ? 'interrupted' : row.state,
     stage: row.stage || '',
     progress: row.progress,
     error_message: row.error ? '旧下载未完成，请核对后继续' : '',
     warning: row.warning,
     source_url: row.source.url,
     output: row.output,
     files: row.files
    })
   } catch {
    rows.push({
     id: entry.name,
     title: '无法读取的旧下载任务',
     state: 'error',
     stage: '保留原始记录',
     progress: {},
     error_message: '旧任务记录无法核对，未改写或删除；请检查记录来源和格式',
     warning: '',
     source_url: '',
     output: '',
     files: []
    })
   }
  }
  return rows
 }
 async unchanged(row: LegacyDownloadRecord) {
  if ((await this.read(row.id)).recordHash !== row.recordHash) throw new Error('读取期间旧下载记录已改变，请重新读取')
 }
 async file(value: string) {
  const row = await this.read(value)
  if (row.state !== 'completed' || !isAbsolute(row.download_root) || !isAbsolute(row.output))
   throw new Error('旧任务尚无可确认成果')
  const root = await checkedDirectory(row.download_root),
   directory = await checkedDirectory(row.output)
  if (dirname(directory).toLowerCase() !== root.toLowerCase()) throw new Error('旧成果不属于声明的下载目录')
  const marker = await jsonFile(join(directory, '.bilisum-download.json')),
   manifest = manifestSchema.parse(marker.value),
   name = basename(directory).toLowerCase(),
   storage = row.source.storage_id.toLowerCase()
  if (
   manifest.bvid !== row.source.storage_id ||
   manifest.download_root !== (await canonical(root)) ||
   manifest.directory !== (await canonical(directory)) ||
   !(name === storage || name.endsWith('_' + storage))
  )
   throw new Error('旧下载成果所有权标记不匹配')
  let primary = false
  for (const entry of await readdir(directory, {withFileTypes: true})) {
   if (entry.isSymbolicLink() || !entry.isFile()) throw new Error('旧成果包含未确认文件或链接')
   const file = await lstat(join(directory, entry.name))
   if (['.part', '.ytdl', '.tmp'].includes(extname(entry.name).toLowerCase())) throw new Error('旧成果仍有未完成分段')
   if (mediaExtensions[manifest.media_kind].includes(extname(entry.name).toLowerCase()) && file.size > 0) primary = true
  }
  if (!primary) throw new Error('旧成果缺少有效媒体或字幕')
  await this.unchanged(row)
  if ((await jsonFile(join(directory, '.bilisum-download.json'))).hash !== marker.hash)
   throw new Error('旧成果所有权标记已改变')
  return directory
 }
 async recipe(value: string) {
  const row = await this.read(value)
  if (!/^BV[A-Za-z0-9]{10}$/.test(row.source.bvid || '') || !row.source.cid || !row.source.page)
   throw new Error('此旧任务需先重新读取站点格式，原记录保留')
  const selected = biliMediaInput(row.source.url)
  if (
   selected.bvid !== row.source.bvid ||
   selected.page !== row.source.page ||
   row.source.storage_id !== row.source.bvid
  )
   throw new Error('旧任务网址与分集身份不一致，原记录保留')
  const options = mediaOptions(row.options)
  if (options.format_ids) throw new Error('旧下载器的精确格式编号不可直接沿用，请重新读取格式；原记录保留')
  if (options.cookie_profile || options.privacy || options.use_cookies)
   throw new Error('旧登录档案不能直接迁移，请在原生下载中重新选择；原记录保留')
  return {
   row,
   identity: `${row.source.bvid}:${row.source.cid}:${row.source.page}`,
   url: `https://www.bilibili.com/video/${row.source.bvid}/?p=${row.source.page}`,
   options
  }
 }
}
