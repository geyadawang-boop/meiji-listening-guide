import Innertube, {Platform} from 'youtubei.js'
import {getQuickJS} from 'quickjs-emscripten'
import {z} from 'zod'
import {boundedMediaResponse, matchesSubtitleLanguage} from '@main/media/core/media-subtitle-download'
import type {MediaCatalog} from '@shared/media'
import type {NativeMediaSource, NativeMediaStream} from '@main/media/core/media-source'
import {mediaOptions} from '@main/media/core/media-options'
/** Remote signature code has no Node globals, file/network bindings or host callbacks. */
export async function youtubeSignature(script: string, env: Record<string, unknown> = {}) {
 if (script.length > 4 * 1024 * 1024 || Object.keys(env).length > 20) throw new Error('播放器签名脚本超过预算')
 const quick = await getQuickJS(),
  runtime = quick.newRuntime()
 runtime.setMemoryLimit(32 * 1024 * 1024)
 runtime.setMaxStackSize(1024 * 1024)
 const deadline = Date.now() + 1500
 runtime.setInterruptHandler(() => Date.now() > deadline)
 const context = runtime.newContext()
 try {
  for (const [name, value] of Object.entries(env)) {
   if (
    !/^[A-Za-z_$][A-Za-z0-9_$]{0,100}$/.test(name) ||
    (!['string', 'number', 'boolean', 'undefined'].includes(typeof value) && value !== null) ||
    (typeof value === 'string' && value.length > 65536)
   )
    throw new Error('签名参数无效')
   const handle =
    typeof value === 'string'
     ? context.newString(value)
     : typeof value === 'number'
       ? context.newNumber(value)
       : value === true
         ? context.true.dup()
         : value === false
           ? context.false.dup()
           : value === null
             ? context.null.dup()
             : context.undefined.dup()
   try {
    context.setProp(context.global, name, handle)
   } finally {
    handle.dispose()
   }
  }
  const result = context.evalCode('(()=>{' + script + '\n})()')
  if (result.error) {
   result.error.dispose()
   throw new Error('播放器签名处理失败或达到执行预算')
  }
  try {
   const data = context.dump(result.value) as unknown
   if (JSON.stringify(data)?.length > 65536) throw new Error('签名结果超出预算')
   return z.record(z.string(), z.unknown()).parse(data)
  } finally {
   result.value.dispose()
  }
 } finally {
  context.dispose()
  runtime.dispose()
 }
}
Platform.shim.eval = (data, env) => youtubeSignature(data.output, env)
export function youtubeInput(input: string) {
 const url = new URL(input),
  host = url.hostname.replace(/^www\./, '')
 if (
  url.protocol !== 'https:' ||
  url.port ||
  url.username ||
  url.password ||
  url.hash ||
  !['youtube.com', 'm.youtube.com', 'youtu.be', 'music.youtube.com'].includes(host)
 )
  throw new Error('YouTube 网址无效')
 const list = url.searchParams.getAll('list'),
  video = url.searchParams.getAll('v')
 if (list.length > 1 || video.length > 1) throw new Error('视频或播放列表标识有歧义')
 let id =
  host === 'youtu.be'
   ? url.pathname.slice(1)
   : url.pathname === '/watch'
     ? video[0] || ''
     : /^\/(?:shorts|embed)\/([A-Za-z0-9_-]{11})\/?$/.exec(url.pathname)?.[1] || ''
 if (
  (id && !/^[A-Za-z0-9_-]{11}$/.test(id)) ||
  (list[0] && !/^[A-Za-z0-9_-]{10,100}$/.test(list[0])) ||
  (!id && !list[0])
 )
  throw new Error('请使用具体视频或播放列表网址')
 return {
  id,
  list: list[0] || '',
  url: id
   ? 'https://www.youtube.com/watch?v=' + id + (list[0] ? '&list=' + list[0] : '')
   : 'https://www.youtube.com/playlist?list=' + list[0]
 }
}
function checked(raw: string, media = false) {
 const url = new URL(raw)
 if (
  url.protocol !== 'https:' ||
  url.port ||
  url.username ||
  url.password ||
  url.hash ||
  !(
   media ? ['googlevideo.com'] : ['youtube.com', 'youtubei.googleapis.com', 'ytimg.com', 'googlevideo.com', 'ggpht.com']
  ).some(host => url.hostname === host || url.hostname.endsWith('.' + host))
 )
  throw new Error('YouTube 服务地址未通过核验')
 return url.href
}
type Fetcher = (url: string, init?: RequestInit) => Promise<Response>
export class NativeYoutubeCatalog {
 constructor(private fetcher: Fetcher) {}
 async read(
  input: string,
  playlist: boolean,
  signal: AbortSignal,
  options: unknown = {}
 ): Promise<MediaCatalog | NativeMediaSource> {
  const selected = youtubeInput(input),
   settings = mediaOptions(options)
  const network: typeof fetch = async (input, init) => {
   const request = new Request(input, init),
    url = checked(request.url),
    body = ['GET', 'HEAD'].includes(request.method) ? undefined : await request.text()
   if (body && body.length > 1000000) throw new Error('YouTube 请求超出预算')
   const response = await this.fetcher(url, {
    method: request.method,
    headers: request.headers,
    body,
    signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
    redirect: 'error',
    credentials: 'omit'
   })
   const bytes = await boundedMediaResponse(response, 16 * 1024 * 1024)
   const result = new Response(bytes, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers
   })
   Object.defineProperty(result, 'url', {value: response.url || url})
   return result
  }
  const yt = await Innertube.create({
   fetch: network,
   generate_session_locally: true,
   retrieve_innertube_config: false,
   enable_session_cache: false,
   lang: 'zh-CN'
  })
  if (playlist) {
   if (!selected.list) throw new Error('请提供带播放列表标识的网址，单个视频不冒充整套课程')
   let page = await yt.getPlaylist(selected.list)
   const entries: {title: string; url: string}[] = [],
    seen = new Set<string>()
   const title = page.info.title || 'YouTube 播放列表'
   for (let index = 0; index < 10; index++) {
    for (const item of page.items) {
     const id = 'id' in item ? item.id : 'content_id' in item ? item.content_id : undefined
     if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{11}$/.test(id) || seen.has(id)) continue
     seen.add(id)
     entries.push({
      title: ('title' in item ? String(item.title) : id).slice(0, 240),
      url: 'https://www.youtube.com/watch?v=' + id
     })
     if (entries.length >= 100) break
    }
    if (entries.length >= 100 || !page.has_continuation) break
    signal.throwIfAborted()
    page = await page.getContinuation()
   }
   if (!entries.length) throw new Error('未取得可选择的公开视频')
   return {url: selected.url, title, playlist: true, entries, limited: page.has_continuation || entries.length >= 100}
  }
  if (!selected.id) throw new Error('请先选择播放列表中的具体视频')
  const info = await yt.getBasicInfo(selected.id),
   basic = info.basic_info
  if (basic.id !== selected.id || basic.is_live || basic.is_upcoming || info.playability_status?.status !== 'OK')
   throw new Error('此 YouTube 视频未确认可下载，或仍为直播')
  const duration = z.number().positive().finite().parse(basic.duration),
   formats = [...(info.streaming_data?.formats || []), ...(info.streaming_data?.adaptive_formats || [])],
   streams: NativeMediaStream[] = []
  for (const row of formats) {
   if (
    row.drm_families?.length ||
    row.drm_track_type ||
    row.is_type_otf ||
    (!row.has_video && !row.has_audio) ||
    streams.some(stream => stream.id === String(row.itag))
   )
    continue
   const url = checked(await row.decipher(yt.session.player), true),
    codec = /codecs="([^"]+)"/.exec(row.mime_type)?.[1] || '',
    extension = row.mime_type.includes('webm') ? 'webm' : row.has_video ? 'mp4' : 'm4a'
   streams.push({
    id: String(row.itag),
    kind: row.has_video ? (row.has_audio ? 'combined' : 'video') : 'audio',
    urls: [url],
    height: row.height || 0,
    codec,
    bandwidth: row.bitrate || 0,
    extension
   })
  }
  if (!streams.length && !settings.subtitle_only)
   throw new Error('YouTube 未返回可读取格式，请检查访问权限或站点验证要求')
  const tracks: NonNullable<NativeMediaSource['subtitleTracks']> = []
  for (const track of info.captions?.caption_tracks || []) {
   const url = new URL(checked(track.base_url))
   url.searchParams.set('fmt', 'json3')
   tracks.push({
    language: (track.kind === 'asr' ? 'ai-' : '') + track.language_code,
    url: url.href,
    automatic: track.kind === 'asr',
    format: 'youtube-json3'
   })
  }
  if (settings.translated_subtitles) {
   const original = info.captions?.caption_tracks?.find(track => track.is_translatable)
   if (original)
    for (const lang of info.captions?.translation_languages || []) {
     const name = 'ai-' + lang.language_code
     if (tracks.some(track => track.language === name) || !matchesSubtitleLanguage(name, settings.subtitle_languages))
      continue
     const url = new URL(checked(original.base_url))
     url.searchParams.set('fmt', 'json3')
     url.searchParams.set('tlang', lang.language_code)
     tracks.push({language: name, url: url.href, automatic: true, format: 'youtube-json3'})
    }
  }
  if (settings.format_ids && !settings.format_ids.split('+').every(id => streams.some(stream => stream.id === id)))
   throw new Error('YouTube 格式已改变，请重新读取')
  signal.throwIfAborted()
  return {
   platform: 'youtube',
   sourceId: selected.id,
   identity: 'youtube:' + selected.id,
   streams,
   subtitleTracks: tracks,
   description: basic.short_description || '',
   downloadHeaders: {Referer: 'https://www.youtube.com/', 'User-Agent': 'Mozilla/5.0'},
   thumbnail: basic.thumbnail?.at(-1)?.url ? checked(basic.thumbnail.at(-1)!.url) : undefined,
   catalog: {
    url: 'https://www.youtube.com/watch?v=' + selected.id,
    title: (basic.title || selected.id).slice(0, 240),
    playlist: false,
    duration,
    heights: [...new Set(streams.filter(row => row.kind !== 'audio').map(row => row.height))].sort((a, b) => a - b),
    subtitles: tracks.map(track => track.language),
    formats: streams.map(row => ({
     id: row.id,
     height: row.height || null,
     extension: row.extension,
     video_codec: row.kind === 'audio' ? 'none' : row.codec,
     audio_codec: row.kind === 'video' ? 'none' : row.codec
    }))
   }
  }
 }
}
