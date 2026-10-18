import {z} from 'zod'
import {mediaSort} from '@main/media/core/media-sort'

export const mediaHeights = [0, 144, 240, 360, 480, 720, 1080, 1440, 2160, 4320]
export const mediaEnums = {
 folder_layout: ['source', 'type', 'date', 'type-date'],
 audio_quality: ['best', '320', '256', '192', '128', '96', '64'],
 subtitle_format: ['original', 'srt', 'vtt', 'ass', 'lrc'],
 container: ['mkv', 'mp4', 'webm'],
 audio_format: ['best', 'm4a', 'mp3', 'opus', 'flac', 'wav', 'aac', 'vorbis'],
 video_codec: ['auto', 'h264', 'h265', 'vp9', 'av1'],
 downloader: ['native', 'aria2c']
} as const
export const mediaSponsors = [
 'sponsor',
 'intro',
 'outro',
 'selfpromo',
 'preview',
 'filler',
 'interaction',
 'music_offtopic'
]
const text = (max: number) =>
 z
  .string()
  .max(max)
  .refine(value => !/[\x00-\x1f]/.test(value), '下载文本不能包含控制字符')
const mediaSchema = z
 .object({
  height: z
   .number()
   .int()
   .refine(value => mediaHeights.includes(value), '下载画质无效')
   .default(0),
  audio_quality: z.enum(mediaEnums.audio_quality).default('best'),
  audio_only: z.boolean().default(false),
  subtitle_only: z.boolean().default(false),
  subtitles: z.boolean().default(false),
  auto_subtitles: z.boolean().default(false),
  translated_subtitles: z.boolean().default(false),
  subtitle_languages: text(240)
   .regex(/^[A-Za-z0-9_.*,+\-]+$/)
   .default('zh.*,ai-zh.*,en.*,ai-en.*'),
  subtitle_format: z.enum(mediaEnums.subtitle_format).default('srt'),
  embed_subtitles: z.boolean().default(false),
  keep_subtitles: z.boolean().default(true),
  container: z.enum(mediaEnums.container).default('mkv'),
  audio_format: z.enum(mediaEnums.audio_format).default('m4a'),
  audio_bitrate: z.number().int().min(0).max(512).default(0),
  video_codec: z.enum(mediaEnums.video_codec).default('auto'),
  format_ids: text(300)
   .regex(/^(?:[A-Za-z0-9_.\-]+(?:\+[A-Za-z0-9_.\-]+){0,7})?$/)
   .default(''),
  format_sort: text(240)
   .regex(/^[A-Za-z0-9_+.:,~\-]*$/)
   .default(''),
  merge_audio: z.boolean().default(false),
  thumbnail: z.boolean().default(false),
  embed_thumbnail: z.boolean().default(false),
  crop_artwork: z.boolean().default(false),
  metadata: z.boolean().default(true),
  chapters: z.boolean().default(true),
  split_chapters: z.boolean().default(false),
  clip_start: z.number().finite().min(0).max(86400).nullable().default(null),
  clip_end: z.number().finite().min(0).max(86400).nullable().default(null),
  sponsorblock: text(150).default(''),
  rate_kbps: z.number().int().min(0).max(1000000).default(0),
  concurrent_fragments: z.number().int().min(1).max(16).default(1),
  retries: z.number().int().min(0).max(20).default(5),
  force_ipv4: z.boolean().default(false),
  proxy: text(300).default(''),
  cookie_profile: text(32)
   .regex(/^(?:[a-f0-9]{32})?$/)
   .default(''),
  use_cookies: z.boolean().default(false),
  restrict_filenames: z.boolean().default(false),
  skip_existing: z.boolean().default(true),
  filename_template: text(200).default('%(title).100B [%(id)s].%(ext)s'),
  custom_args: text(2000).default(''),
  downloader: z.enum(mediaEnums.downloader).default('native'),
  folder_layout: z.enum(mediaEnums.folder_layout).default('source'),
  privacy: z.boolean().default(false)
 })
 .strict()
export type NativeMediaOptions = z.infer<typeof mediaSchema>

/** Kept as structured settings, never concatenated into a shell command. */
export function mediaTuning(value: string) {
 const switches = new Set([
  '--prefer-free-formats',
  '--force-keyframes-at-cuts',
  '--write-description',
  '--write-link',
  '--no-mtime'
 ])
 const ranges: Record<string, [number, number]> = {
  '--sleep-requests': [0, 60],
  '--sleep-interval': [0, 120],
  '--max-sleep-interval': [0, 120],
  '--socket-timeout': [1, 180],
  '--buffer-size': [1024, 10485760],
  '--http-chunk-size': [0, 104857600]
 }
 const tokens = value.trim() ? value.trim().split(/\s+/) : [],
  result: Record<string, number | true> = {}
 for (let i = 0; i < tokens.length; i++) {
  const key = tokens[i]
  if (switches.has(key)) {
   result[key] = true
   continue
  }
  const range = ranges[key],
   raw = tokens[++i]
  if (!range || !raw || !/^\d+$/.test(raw)) throw new Error('此模板参数未接入或不是整数：' + key)
  const number = Number(raw)
  if (!Number.isSafeInteger(number) || number < range[0] || number > range[1])
   throw new Error('模板参数超出范围：' + key)
  result[key] = number
 }
 return result
}
export function mediaOptions(input: unknown = {}): NativeMediaOptions {
 const v = mediaSchema.parse(input)
 if (v.cookie_profile && !v.use_cookies) throw new Error('选择登录档案时需启用使用登录档案')
 if ((v.clip_start === null) !== (v.clip_end === null) || (v.clip_end !== null && v.clip_end <= v.clip_start!))
  throw new Error('片段结束时间必须大于开始时间')
 if (v.sponsorblock && !v.sponsorblock.split(',').every(value => mediaSponsors.includes(value)))
  throw new Error('SponsorBlock 分类无效')
 if (v.sponsorblock && (v.subtitle_only || v.split_chapters))
  throw new Error('片段移除与仅字幕或章节拆分请分别建立任务')
 if (v.proxy) {
  let url: URL
  try {
   url = new URL(v.proxy)
  } catch {
   throw new Error('代理地址无效')
  }
  if (
   !['http:', 'https:', 'socks5:', 'socks5h:'].includes(url.protocol) ||
   !url.hostname ||
   url.username ||
   url.password ||
   url.search ||
   url.hash ||
   (url.pathname && url.pathname !== '/')
  )
   throw new Error('代理需为不含密码的 HTTP/SOCKS 地址')
 }
 if (
  !v.filename_template ||
  /[\/\\<>:"|?*]/.test(v.filename_template) ||
  v.filename_template.includes('..') ||
  !v.filename_template.endsWith('.%(ext)s')
 )
  throw new Error('文件名模板须为单层文件名，以 .%(ext)s 结尾')
 if (v.translated_subtitles) v.auto_subtitles = true
 if (v.auto_subtitles) v.subtitles = true
 if (v.subtitle_only) {
  if (v.audio_only || v.embed_subtitles || v.clip_end !== null) throw new Error('仅字幕不能同时选纯音频、嵌入或裁剪')
  v.subtitles = true
 }
 if (v.embed_subtitles) {
  if (v.audio_only || !v.subtitles) throw new Error('嵌入字幕需选择视频及下载字幕')
  v.container = 'mkv'
 }
 if (v.split_chapters && v.clip_end !== null) throw new Error('章节拆分和时间片段请分别建立任务')
 if (v.crop_artwork && !v.embed_thumbnail) throw new Error('裁剪封面需启用嵌入封面')
 if (v.subtitle_only && v.embed_thumbnail) throw new Error('仅字幕没有可嵌入封面的媒体，可单独下载封面')
 mediaTuning(v.custom_args)
 mediaSort(v.format_sort)
 return v
}
export function mediaOptionChoices() {
 return {defaults: mediaOptions(), enums: mediaEnums, heights: [...mediaHeights], sponsors: [...mediaSponsors]}
}
