import {writeFile, lstat, readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {z} from 'zod'
import {toSrt} from '@shared/srt'
import type {NativeMediaSource} from '@main/media/core/media-source'
import type {NativeMediaOptions} from '@main/media/core/media-options'
import {retimeMediaCues, type MediaInterval} from '@main/media/core/media-timeline'
import {decodeHTML} from 'entities'
type Fetcher = (url: string, init?: RequestInit) => Promise<Response>
const cueSchema = z.object({
 body: z
  .array(
   z.object({
    from: z.number().finite().nonnegative(),
    to: z.number().finite().positive(),
    content: z.string().max(2000)
   })
  )
  .min(1)
  .max(20000)
})
export function nativeVttCues(text: string) {
 const body = text.replace(/^\uFEFF/, '').replace(/\r/g, '')
 if (!/^WEBVTT(?:\s|$)/.test(body)) throw new Error('站点字幕不是有效 WebVTT')
 const seconds = (stamp: string) => {
  const match = /^(?:(\d{2,}):)?(\d{2}):(\d{2})\.(\d{3})$/.exec(stamp)
  if (!match || Number(match[2]) > 59 || Number(match[3]) > 59) throw new Error('站点字幕时间戳无效')
  return Number(match[1] || 0) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 1000
 }
 const cues: {from: number; to: number; content: string}[] = []
 for (const block of body.split(/\n\s*\n/)) {
  const lines = block.trim().split('\n')
  if (/^(?:WEBVTT|NOTE|STYLE|REGION)(?:\s|$)/.test(lines[0])) continue
  const index = lines.findIndex(line => line.includes('-->'))
  if (index < 0) continue
  const times = /^(\S+)\s+-->\s+(\S+)(?:\s+.*)?$/.exec(lines[index])
  if (!times) throw new Error('站点字幕时间戳无效')
  const content = decodeHTML(
   lines
    .slice(index + 1)
    .join(' ')
    .replace(/<[^>]*>/g, '')
  ).trim()
  if (content) cues.push({from: seconds(times[1]), to: seconds(times[2]), content})
 }
 return cueSchema.parse({body: cues})
}
export function matchesSubtitleLanguage(language: string, patterns: string) {
 const match = (pattern: string) =>
  new RegExp(
   '^' +
    pattern
     .replace(/\.\*/g, '*')
     .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
     .replace(/\*/g, '.*') +
    '$',
   'i'
  ).test(language)
 const tokens = patterns.split(','),
  include = tokens.filter(t => !t.startsWith('-')),
  exclude = tokens.filter(t => t.startsWith('-')).map(t => t.slice(1))
 return include.some(match) && !exclude.some(match)
}
export async function boundedMediaResponse(response: Response, max: number) {
 if (!response.ok || !response.body) throw new Error(`课件辅助文件下载失败（HTTP ${response.status}）`)
 if (Number(response.headers.get('content-length') || 0) > max) {
  await response.body.cancel()
  throw new Error('课件辅助文件超过大小上限')
 }
 const reader = response.body.getReader(),
  chunks: Uint8Array[] = []
 let size = 0
 try {
  while (true) {
   const {value, done} = await reader.read()
   if (done) break
   size += value.byteLength
   if (size > max) throw new Error('课件辅助文件超过大小上限')
   chunks.push(value)
  }
  return Buffer.concat(chunks, size)
 } finally {
  await reader.cancel().catch(() => {})
 }
}
async function save(path: string, body: string | Buffer) {
 try {
  const item = await lstat(path)
  if (!item.isFile() || item.isSymbolicLink() || !Buffer.from(body).equals(await readFile(path)))
   throw new Error('辅助成果已存在且内容不同，保留原文件')
  return
 } catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
 }
 await writeFile(path, body, {flag: 'wx'})
}
export async function downloadNativeSubtitles(
 source: NativeMediaSource,
 options: NativeMediaOptions,
 directory: string,
 fetcher: Fetcher,
 signal: AbortSignal,
 kept?: MediaInterval[]
) {
 const tracks = (source.subtitleTracks || []).filter(
  t => matchesSubtitleLanguage(t.language, options.subtitle_languages) && (!t.automatic || options.auto_subtitles)
 )
 if (!tracks.length) throw new Error('所选语言没有可下载字幕；原资料保留，可使用本地转写')
 const files: {relative: string; language: string; automatic: boolean; embedRelative?: string}[] = [],
  languages = new Set<string>()
 for (const track of tracks) {
  signal.throwIfAborted()
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(track.language) || languages.has(track.language))
   throw new Error('字幕语言编号无效或重复')
  languages.add(track.language)
  const bytes = await boundedMediaResponse(
   await fetcher(track.url, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
    redirect: 'error',
    credentials: 'omit',
    headers: source.downloadHeaders || {Referer: 'https://www.bilibili.com/'}
   }),
   4_000_000
  )
  const raw = track.format === 'webvtt' ? nativeVttCues(bytes.toString('utf8')) : JSON.parse(bytes.toString('utf8'))
  const parsed =
   track.format === 'youtube-json3'
    ? cueSchema.parse({
       body: z
        .object({
         events: z
          .array(
           z.object({
            tStartMs: z.number().finite().nonnegative(),
            dDurationMs: z.number().finite().positive().optional(),
            segs: z.array(z.object({utf8: z.string()})).optional()
           })
          )
          .max(20000)
        })
        .parse(raw)
        .events.filter(row => row.segs?.some(segment => segment.utf8.trim()) && row.dDurationMs)
        .map(row => ({
         from: row.tStartMs / 1000,
         to: (row.tStartMs + row.dDurationMs!) / 1000,
         content: row.segs!.map(segment => segment.utf8).join('')
        }))
      })
    : cueSchema.parse(raw)
  let cues = parsed.body
   .sort((a, b) => a.from - b.from)
   .map(c => {
    if (c.to <= c.from || !c.content.trim() || (source.catalog.duration && c.to > source.catalog.duration * 1.25 + 30))
     throw new Error('字幕时间或正文无效')
    return {
     start: Math.round(c.from * 1000),
     end: Math.round(c.to * 1000),
     text: c.content.replace(/[\x00-\x1f]/g, ' ').trim()
    }
   })
  if (kept) {
   cues = retimeMediaCues(
    cues,
    kept.map(range => ({start: Math.round(range.start * 1000), end: Math.round(range.end * 1000)}))
   ).filter(cue => cue.end > cue.start)
   if (!cues.length || cues.length > 20000) throw new Error('片段移除后的字幕为空或条目过多，请调整分类')
  }
  // Platform captions can legitimately overlap (for example two speakers).
  // Individual times and bodies are validated above; retain those overlaps.
  const srt = toSrt(cues)
  const clock = (ms: number) => {
   const hours = Math.floor(ms / 3600000),
    minutes = Math.floor(ms / 60000) % 60,
    seconds = Math.floor(ms / 1000) % 60
   return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`
  }
  const assTime = (ms: number) => clock(ms).replace(/^(\d+):(\d+):(\d+)\.(\d\d)\d$/, '$1:$2:$3.$4')
  const formats = {
   original: {
    ext: 'json',
    text: JSON.stringify(
     kept ? {body: cues.map(c => ({from: c.start / 1000, to: c.end / 1000, content: c.text}))} : parsed
    )
   },
   srt: {ext: 'srt', text: srt},
   vtt: {
    ext: 'vtt',
    text:
     'WEBVTT\n\n' + cues.map(c => `${clock(c.start)} --> ${clock(c.end)}\n${c.text.replace(/-->/g, '→')}\n`).join('\n')
   },
   lrc: {
    ext: 'lrc',
    text: cues
     .map(
      c =>
       `[${String(Math.floor(c.start / 60000)).padStart(2, '0')}:${String(Math.floor(c.start / 1000) % 60).padStart(2, '0')}.${String(Math.floor((c.start % 1000) / 10)).padStart(2, '0')}]${c.text}`
     )
     .join('\n')
   },
   ass: {
    ext: 'ass',
    text:
     '[Script Info]\nScriptType: v4.00+\nPlayResX: 1920\nPlayResY: 1080\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Microsoft YaHei,44,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,2,30,30,30,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n' +
     cues
      .map(c => `Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Default,,0,0,0,,${c.text.replace(/[{}\\]/g, '')}`)
      .join('\n')
   }
  }
  const format = formats[options.subtitle_format],
   relative = `subtitle-${track.language}.${format.ext}`
  await save(join(directory, relative), format.text)
  const embedRelative = options.embed_subtitles ? `embed-${track.language}.srt` : undefined
  if (embedRelative) await save(join(directory, embedRelative), srt)
  files.push({relative, language: track.language, automatic: track.automatic, embedRelative})
 }
 return files
}
