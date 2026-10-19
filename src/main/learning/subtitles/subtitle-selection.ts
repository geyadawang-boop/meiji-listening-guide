import {z} from 'zod'
import {bilibiliUrl} from '@main/media/bilibili/video-policy'
import type {VideoSeries} from '@shared/video-ppt'
import {subtitleLocator} from '@main/learning/subtitles/subtitle-sync'
/** Resolve only directories actually loaded by the native picker. */
export function selectedSubtitles(input: unknown, cache: Map<string, VideoSeries>) {
 const selections = z
  .array(
   z.object({
    url: z.string(),
    title: z.string().min(1).max(200).optional(),
    pages: z.array(z.number().int().positive()).min(1).max(1000)
   })
  )
  .min(1)
  .max(100)
  .parse(input)
 const items = []
 for (const selection of selections) {
  const series = cache.get(bilibiliUrl(selection.url))
  if (!series) throw new Error('视频目录已失效，请重新读取分集')
  if (
   new Set(selection.pages).size !== selection.pages.length ||
   selection.pages.some(page => !series.episodes.some(item => item.page === page))
  )
   throw new Error('所选分集无效')
  for (const episode of series.episodes.filter(item => selection.pages.includes(item.page)))
   items.push({
    ...episode,
    title: `${selection.title || series.title} · ${episode.title}`.slice(0, 200),
    url: subtitleLocator(episode.url)
   })
 }
 if (items.length > 1000 || new Set(items.map(item => item.url)).size !== items.length)
  throw new Error('分集重复或所选总数超过 1000')
 return items
}
