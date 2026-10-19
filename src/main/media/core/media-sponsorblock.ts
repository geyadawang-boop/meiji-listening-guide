import {createHash} from 'node:crypto'
import {lstat, readFile, writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {z} from 'zod'
import {mediaSponsors, type NativeMediaOptions} from '@main/media/core/media-options'
import type {NativeMediaSource} from '@main/media/core/media-source'
import {boundedMediaResponse} from '@main/media/core/media-subtitle-download'
import {removalTimeline} from '@main/media/core/media-timeline'

const segment = z.object({
 segment: z.tuple([z.number().finite().nonnegative(), z.number().finite().positive()]),
 category: z.string().max(50),
 actionType: z.string().max(20),
 videoDuration: z.number().finite().nonnegative(),
 UUID: z.string().max(100)
})
const segments = z.array(segment).max(200)
const receipt = z
 .object({
  version: z.literal(1),
  sourceId: z.string().regex(/^[A-Za-z0-9_-]{11}$/),
  duration: z.number().finite().positive(),
  categories: z.array(z.string()).max(8),
  segments,
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  attribution: z.literal('SponsorBlock community / CC BY-NC-SA 4.0'),
  source: z.literal('https://sponsor.ajay.app'),
  license: z.literal('https://creativecommons.org/licenses/by-nc-sa/4.0/')
 })
 .strict()
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
/** Read-only hash-prefix lookup. This never sends a complete video ID, account cookies or submissions. */
export async function sponsorBlockPlan(
 source: NativeMediaSource,
 options: NativeMediaOptions,
 directory: string,
 fetcher: (url: string, init?: RequestInit) => Promise<Response>,
 signal: AbortSignal
) {
 if (source.platform !== 'youtube' || !source.sourceId || !/^[A-Za-z0-9_-]{11}$/.test(source.sourceId))
  throw new Error('片段移除目前仅支持 YouTube；其它平台请使用时间片段')
 const categories = [...new Set(options.sponsorblock.split(','))].sort()
 if (!categories.length || categories.some(value => !mediaSponsors.includes(value))) throw new Error('片段移除分类无效')
 const duration = source.catalog.duration
 if (!duration || !Number.isFinite(duration)) throw new Error('缺少完整视频时长，不能核验片段位置')
 const relative = 'sponsorblock-plan.json',
  path = join(directory, relative)
 let rows: z.infer<typeof segments> | undefined
 try {
  const info = await lstat(path)
  if (!info.isFile() || info.isSymbolicLink() || info.size > 1_000_000) throw new Error('片段移除恢复记录无效')
  const saved = receipt.parse(JSON.parse(await readFile(path, 'utf8')))
  if (
   saved.sourceId !== source.sourceId ||
   saved.duration !== duration ||
   JSON.stringify(saved.categories) !== JSON.stringify(categories) ||
   saved.sha256 !== hash([saved.sourceId, saved.duration, saved.categories, saved.segments])
  )
   throw new Error('片段移除恢复记录已改变，原文件保留')
  rows = saved.segments
 } catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
 }
 if (!rows) {
  const url = new URL(
   'https://sponsor.ajay.app/api/skipSegments/' + createHash('sha256').update(source.sourceId).digest('hex').slice(0, 4)
  )
  url.searchParams.set('categories', JSON.stringify(categories))
  url.searchParams.set('actionTypes', '["skip"]')
  url.searchParams.set('service', 'YouTube')
  signal.throwIfAborted()
  const response = await fetcher(url.href, {
   signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]),
   redirect: 'error',
   credentials: 'omit',
   headers: {Accept: 'application/json'}
  })
  if (response.status === 404) {
   await response.body?.cancel()
   rows = []
  } else {
   const result = z
     .array(z.object({videoID: z.string(), segments: z.array(segment).max(1000)}))
     .max(1000)
     .parse(JSON.parse((await boundedMediaResponse(response, 1_000_000)).toString('utf8'))),
    matches = result.filter(row => row.videoID === source.sourceId)
   if (matches.length > 1) throw new Error('片段来源身份重复，未修改视频')
   rows = segments.parse(
    (matches[0]?.segments || []).filter(row => categories.includes(row.category) && row.actionType === 'skip')
   )
  }
  // A stale crowd-sourced range must not cut the corresponding timestamp from a different edit.
  for (const row of rows)
   if (
    (row.videoDuration > 0 && Math.abs(row.videoDuration - duration) > 1) ||
    row.segment[1] > duration ||
    row.segment[1] <= row.segment[0]
   )
    throw new Error('片段标注与当前视频时长不符，未执行裁剪')
  const value = receipt.parse({
   version: 1,
   sourceId: source.sourceId,
   duration,
   categories,
   segments: rows,
   sha256: hash([source.sourceId, duration, categories, rows]),
   attribution: 'SponsorBlock community / CC BY-NC-SA 4.0',
   source: 'https://sponsor.ajay.app',
   license: 'https://creativecommons.org/licenses/by-nc-sa/4.0/'
  })
  signal.throwIfAborted()
  await writeFile(path, JSON.stringify(value, null, 2), {flag: 'wx'})
 }
 for (const row of rows)
  if (
   (row.videoDuration > 0 && Math.abs(row.videoDuration - duration) > 1) ||
   row.segment[1] > duration ||
   row.segment[1] <= row.segment[0]
  )
   throw new Error('片段标注与当前视频时长不符，未执行裁剪')
 const plan = removalTimeline(
  duration,
  rows.map(row => ({start: row.segment[0], end: row.segment[1]})),
  options.clip_start !== null ? {start: options.clip_start, end: options.clip_end!} : undefined
 )
 return {
  ...plan,
  relative,
  warning: plan.removed.length
   ? `已按所选分类移除 ${plan.removed.length} 段，共 ${Number((duration - (options.clip_start === null ? 0 : options.clip_start) - (options.clip_end === null ? 0 : duration - options.clip_end) - plan.duration).toFixed(2))} 秒；标注来自 SponsorBlock 社区`
   : '所选范围没有匹配的社区片段标注，未额外移除内容'
 }
}
