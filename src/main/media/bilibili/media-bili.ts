import {z} from 'zod'
import type {BiliResources} from '@main/media/bilibili/bili-resources'
import type {MediaCatalog} from '@shared/media'
import {mediaOptions, mediaTuning, type NativeMediaOptions} from '@main/media/core/media-options'
import {sortMediaStreams} from '@main/media/core/media-sort'
import type {NativeMediaStream, NativeMediaSource} from '@main/media/core/media-source'
export type {NativeMediaStream} from '@main/media/core/media-source'

const positive = z.number().int().positive().safe()
const pageSchema = z.object({
 cid: positive,
 page: positive,
 part: z.string(),
 duration: z.number().finite().nonnegative()
})
const viewSchema = z.object({
 bvid: z.string().regex(/^BV[A-Za-z0-9]{10}$/),
 title: z.string(),
 desc: z.string().max(1000000).optional(),
 pic: z.string().optional(),
 pages: z.array(pageSchema).min(1).max(10000)
})
const streamSchema = z.object({
 id: positive,
 baseUrl: z.string().optional(),
 base_url: z.string().optional(),
 backupUrl: z.array(z.string()).optional(),
 backup_url: z.array(z.string()).optional(),
 codecs: z.string().default(''),
 height: z.number().int().nonnegative().default(0),
 bandwidth: z.number().finite().nonnegative().default(0),
 mimeType: z.string().optional(),
 mime_type: z.string().optional(),
 codecid: z.number().int().nonnegative().default(0)
})
const playSchema = z.object({
 timelength: z.number().finite().nonnegative().optional(),
 quality: positive.optional(),
 dash: z
  .object({video: z.array(streamSchema).nullable().optional(), audio: z.array(streamSchema).nullable().optional()})
  .optional(),
 durl: z
  .array(
   z.object({
    url: z.string(),
    backup_url: z.array(z.string()).optional(),
    length: z.number().finite().nonnegative(),
    size: z.number().int().nonnegative()
   })
  )
  .optional()
})
export type BiliMediaSource = NativeMediaSource & {bvid: string; cid: number; page: number}

export function biliMediaInput(input: string) {
 const value = input.trim()
 const url = new URL(/^BV[A-Za-z0-9]{10}$/.test(value) ? `https://www.bilibili.com/video/${value}/` : value)
 const match = /^\/video\/(BV[A-Za-z0-9]{10})\/?$/.exec(url.pathname)
 if (
  !['https:', 'http:'].includes(url.protocol) ||
  !['www.bilibili.com', 'bilibili.com'].includes(url.hostname) ||
  url.username ||
  url.password ||
  url.port ||
  !match
 )
  throw new Error('请使用 B 站 BV 视频网址')
 const raw = url.searchParams.getAll('p')
 if (raw.length > 1 || (raw.length === 1 && !/^[1-9]\d{0,4}$/.test(raw[0]))) throw new Error('分集编号无效')
 return {bvid: match[1], page: Number(raw[0] || 1)}
}
/** Only the platform API supplies these ephemeral addresses; they never enter UI or saved recipes. */
export function biliMediaAddress(input: string) {
 const url = new URL(input.startsWith('//') ? 'https:' + input : input)
 if (
  url.protocol !== 'https:' ||
  url.username ||
  url.password ||
  (url.port && url.port !== '443') ||
  !/(^|\.)(bilivideo\.com|bilivideo\.cn|hdslb\.com)$/.test(url.hostname)
 )
  throw new Error('B 站媒体地址不受信任')
 url.hash = ''
 return url.href
}
export class BiliMediaCatalog {
 constructor(private api: Pick<BiliResources, 'readMedia'>) {}
 async read(
  input: string,
  playlist: boolean,
  signal: AbortSignal,
  options: unknown = {}
 ): Promise<MediaCatalog | BiliMediaSource> {
  const selected = biliMediaInput(input),
   settings = mediaOptions(options)
  const view = viewSchema.parse(await this.api.readMedia('/x/web-interface/view', {bvid: selected.bvid}, signal))
  if (view.bvid !== selected.bvid) throw new Error('视频目录与所选视频不一致')
  if (
   new Set(view.pages.map(p => p.page)).size !== view.pages.length ||
   new Set(view.pages.map(p => p.cid)).size !== view.pages.length
  )
   throw new Error('分集目录重复，请稍后重试')
  const page = view.pages.find(p => p.page === selected.page)
  if (!page) throw new Error('所选分集不存在')
  const url = `https://www.bilibili.com/video/${view.bvid}/?p=${page.page}`
  if (playlist)
   return {
    url,
    title: view.title.slice(0, 240),
    playlist: true,
    limited: view.pages.length > 100,
    entries: view.pages
     .slice(0, 100)
     .map(p => ({title: p.part.slice(0, 240), url: `https://www.bilibili.com/video/${view.bvid}/?p=${p.page}`}))
   }
  const params = {bvid: view.bvid, cid: String(page.cid), qn: '127', fnval: '4048', fourk: '1'}
  const play = playSchema.parse(await this.api.readMedia('/x/player/wbi/playurl', params, signal)),
   streams: NativeMediaStream[] = []
  for (const [kind, rows] of [
   ['video', play.dash?.video],
   ['audio', play.dash?.audio]
  ] as const) {
   for (const row of rows || []) {
    const addresses = [row.baseUrl || row.base_url, ...(row.backupUrl || row.backup_url || [])].filter(
     (s): s is string => !!s
    )
    if (!addresses.length) throw new Error('媒体格式缺少下载地址')
    const mime = row.mimeType || row.mime_type || '',
     extension = mime.includes('webm') ? 'webm' : kind === 'audio' ? 'm4a' : 'mp4'
    streams.push({
     id: `${kind === 'video' ? 'v' : 'a'}${row.id}-${row.codecid}`,
     kind,
     urls: [...new Set(addresses.map(biliMediaAddress))],
     height: row.height,
     codec: row.codecs,
     bandwidth: row.bandwidth,
     extension
    })
   }
  }
  if (!streams.length && play.durl?.length) {
   // A segmented progressive file must be concatenated in this order, not treated as alternate mirrors.
   streams.push({
    id: `c${play.quality || 0}`,
    kind: 'combined',
    urls: play.durl.map(row => biliMediaAddress(row.url)),
    height: 0,
    codec: '',
    bandwidth: 0,
    extension: 'flv'
   })
  }
  if (!streams.length && !settings.subtitle_only) throw new Error('未取得可用音视频格式，请检查登录和访问权限')
  if (new Set(streams.map(s => s.id)).size !== streams.length) throw new Error('媒体格式编号重复')
  const player = z
   .object({
    subtitle: z
     .object({
      subtitles: z
       .array(z.object({lan: z.string(), subtitle_url: z.string().optional(), ai_type: z.number().optional()}))
       .default([])
     })
     .optional(),
    view_points: z
     .array(
      z.object({from: z.number().finite().nonnegative(), to: z.number().finite().positive(), content: z.string()})
     )
     .optional()
   })
   .parse(await this.api.readMedia('/x/player/v2', {bvid: view.bvid, cid: String(page.cid)}, signal))
  signal.throwIfAborted()
  const catalog: MediaCatalog = {
   url,
   title: (page.part || view.title).slice(0, 240),
   playlist: false,
   duration: page.duration,
   heights: [...new Set(streams.filter(s => s.kind === 'video').map(s => s.height))].sort((a, b) => a - b),
   subtitles: (player.subtitle?.subtitles || []).map(s => s.lan).filter(s => s !== 'danmaku'),
   formats: streams.map(s => ({
    id: s.id,
    height: s.height || null,
    extension: s.extension,
    video_codec: s.kind === 'audio' ? 'none' : s.codec,
    audio_codec: s.kind === 'audio' ? s.codec : 'none'
   }))
  }
  // Validate options now, but do not download or automatically select a whole playlist.
  if (settings.format_ids && !settings.format_ids.split('+').every(id => streams.some(s => s.id === id)))
   throw new Error('所选格式已改变，请重新读取格式')
  return {
   catalog,
   platform: 'bilibili',
   sourceId: `${view.bvid}-P${page.page}`,
   downloadHeaders: {Referer: 'https://www.bilibili.com/', 'User-Agent': 'Mozilla/5.0'},
   description: view.desc || '',
   bvid: view.bvid,
   cid: page.cid,
   page: page.page,
   identity: `${view.bvid}:${page.cid}:${page.page}`,
   streams,
   subtitleTracks: (player.subtitle?.subtitles || [])
    .filter(t => t.subtitle_url && t.lan !== 'danmaku')
    .map(t => ({
     language: t.lan,
     url: biliMediaAddress(t.subtitle_url!),
     automatic: /^ai-|^auto/i.test(t.lan) || !!t.ai_type
    })),
   thumbnail: view.pic ? biliMediaAddress(view.pic.replace(/^http:/, 'https:')) : undefined,
   chapters: (player.view_points || [])
    .filter(c => c.to > c.from && c.to <= page.duration + 1)
    .map(c => ({start: c.from, end: c.to, title: c.content}))
  }
 }
}
export function selectBiliStreams(source: NativeMediaSource, options: NativeMediaOptions) {
 if (options.format_ids) {
  const ids = options.format_ids.split('+'),
   chosen = ids.map(id => {
    const stream = source.streams.find(s => s.id === id)
    if (!stream) throw new Error('所选格式已失效')
    return stream
   })
  if (new Set(ids).size !== ids.length || (options.audio_only && chosen.some(s => s.kind === 'video')))
   throw new Error('精确格式与输出类型冲突')
  if (!options.audio_only && !chosen.some(s => s.kind !== 'audio')) throw new Error('请选择一个视频格式')
  return chosen
 }
 const free = mediaTuning(options.custom_args)['--prefer-free-formats'] === true
 const audio = sortMediaStreams(
  source.streams.filter(s => s.kind === 'audio'),
  options.format_sort,
  free
 )
 const cap = options.audio_quality === 'best' ? Infinity : Number(options.audio_quality) * 1000
 const pickedAudio = audio.find(s => s.bandwidth <= cap) || audio.at(-1)
 if (options.audio_only) {
  if (pickedAudio) return [pickedAudio]
  const combined = source.streams.find(s => s.kind === 'combined')
  if (combined) return [combined]
  throw new Error('此视频没有可用音轨')
 }
 let video = source.streams.filter(s => s.kind === 'video' && (!options.height || s.height <= options.height))
 const prefix = {auto: '', h264: 'avc', h265: 'hev', vp9: 'vp', av1: 'av01'}[options.video_codec]
 if (prefix) video = video.filter(s => s.codec.startsWith(prefix))
 video = sortMediaStreams(video, options.format_sort, free)
 if (video[0]) return pickedAudio ? [video[0], pickedAudio] : [video[0]]
 const combined = sortMediaStreams(
  source.streams.filter(
   s =>
    s.kind === 'combined' &&
    (s.transport === 'hls' ||
     ((!options.height || (s.height > 0 && s.height <= options.height)) && (!prefix || s.codec.startsWith(prefix))))
  ),
  options.format_sort,
  free
 )[0]
 if (combined) return [combined]
 throw new Error('没有符合画质和编码要求的格式，请调整选择')
}
