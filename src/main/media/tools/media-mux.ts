import {mediaCommand} from '@main/media/tools/media-command'
import type {MediaTool} from '@main/media/tools/media-executable'
import {lstat, realpath, writeFile, readFile} from 'node:fs/promises'
import {basename, dirname, extname, join, resolve} from 'node:path'
import {z} from 'zod'
import {createHash} from 'node:crypto'
import {OwnedMediaArtifact, mediaFileHash} from '@main/media/core/media-artifact'
import type {NativeMediaOptions} from '@main/media/core/media-options'
import {checkedMediaIntervals, retimeMediaCues, type MediaInterval} from '@main/media/core/media-timeline'

type LocalTrack = {path: string; kind: 'video' | 'audio' | 'combined'}
export type MediaProbe = {
 duration: number
 video: number
 audio: number
 subtitles: number
 chapters: number
 covers: number
}
const probeSchema = z.object({
 format: z.object({duration: z.coerce.number().finite().positive()}),
 streams: z.array(
  z.object({
   codec_type: z.string(),
   disposition: z.object({attached_pic: z.number().optional()}).optional(),
   tags: z.object({filename: z.string().optional()}).optional()
  })
 ),
 chapters: z.array(z.unknown()).default([])
})
async function localFile(path: string) {
 const target = resolve(path),
  item = await lstat(target)
 if (!item.isFile() || item.isSymbolicLink() || resolve(await realpath(target)).toLowerCase() !== target.toLowerCase())
  throw new Error('媒体输入不是可验证的本地文件')
 return target
}
/** No remote URL is ever passed to FFmpeg. All downloaded tracks are local owned files. */
export class NativeMediaMux {
 constructor(
  private resources: string,
  private allowSystemFallback = false
 ) {}
 private command(name: MediaTool, args: string[], signal: AbortSignal) {
  return mediaCommand(this.resources, name, args, signal, undefined, undefined, this.allowSystemFallback)
 }
 async probe(path: string, signal: AbortSignal): Promise<MediaProbe> {
  const source = await localFile(path),
   raw = await this.command(
    'ffprobe',
    [
     '-v',
     'error',
     '-protocol_whitelist',
     'file,pipe',
     '-format_whitelist',
     'mov,matroska,webm,flv,mp3,aac,ogg,wav,flac,mpegts',
     '-show_entries',
     'format=duration:stream=codec_type:stream_disposition=attached_pic:stream_tags=filename:chapter',
     '-of',
     'json',
     source
    ],
    signal
   ),
   data = probeSchema.parse(JSON.parse(raw))
  return {
   duration: data.format.duration,
   video: data.streams.filter(s => s.codec_type === 'video' && !s.disposition?.attached_pic).length,
   audio: data.streams.filter(s => s.codec_type === 'audio').length,
   subtitles: data.streams.filter(s => s.codec_type === 'subtitle').length,
   chapters: data.chapters.length,
   covers: data.streams.filter(
    s => s.disposition?.attached_pic || (s.codec_type === 'attachment' && s.tags?.filename === 'cover.jpg')
   ).length
  }
 }
 async prepareCover(directory: string, bytes: Buffer, crop: boolean, signal: AbortSignal) {
  if (bytes.length > 8_000_000) throw new Error('封面文件过大')
  const extension = bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
   ? 'jpg'
   : bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
     ? 'png'
     : bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP'
       ? 'webp'
       : undefined
  if (!extension) throw new Error('封面不是可识别的图片')
  const base = resolve(directory)
  if ((await lstat(base)).isSymbolicLink() || resolve(await realpath(base)).toLowerCase() !== base.toLowerCase())
   throw new Error('封面目录无效')
  const source = join(base, 'cover-source.' + extension),
   output = join(base, 'cover.jpg'),
   artifact = new OwnedMediaArtifact(
    base,
    'cover.jpg',
    createHash('sha256')
     .update(JSON.stringify(['cover-v1', createHash('sha256').update(bytes).digest('hex'), crop]))
     .digest('hex')
   )
  try {
   await writeFile(source, bytes, {flag: 'wx'})
  } catch (error) {
   if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
   await localFile(source)
   if (!bytes.equals(await readFile(source))) throw new Error('封面恢复文件已改变')
  }
  const raw = await this.command(
   'ffprobe',
   [
    '-v',
    'error',
    '-protocol_whitelist',
    'file,pipe',
    '-f',
    'image2',
    '-show_entries',
    'stream=width,height',
    '-of',
    'json',
    source
   ],
   signal
  )
  const size = z
   .object({
    streams: z.array(z.object({width: z.number().int().positive(), height: z.number().int().positive()})).min(1)
   })
   .parse(JSON.parse(raw)).streams[0]
  if (size.width * size.height > 40_000_000) throw new Error('封面图片像素过大')
  const filter =
   (crop ? 'crop=min(iw\\,ih):min(iw\\,ih),' : '') +
   'scale=w=min(1200\\,iw):h=min(1200\\,ih):force_original_aspect_ratio=decrease'
  const prepared = await artifact.prepare()
  if (!prepared.reused)
   await this.command(
    'ffmpeg',
    [
     '-hide_banner',
     '-loglevel',
     'error',
     '-nostdin',
     '-n',
     '-protocol_whitelist',
     'file,pipe',
     '-f',
     'image2',
     '-i',
     source,
     '-vf',
     filter,
     '-frames:v',
     '1',
     '-q:v',
     '2',
     '-update',
     '1',
     output
    ],
    signal
   )
  if (!(await lstat(output)).size) throw new Error('封面转换未生成结果')
  await artifact.finish()
  return {path: output, relative: 'cover.jpg', intermediates: [basename(source), ...artifact.intermediates()]}
 }
 async concatenate(directory: string, paths: string[], key: string, signal: AbortSignal) {
  if (!/^track-\d+$/.test(key) || paths.length < 2 || paths.length > 1000) throw new Error('视频分段列表无效')
  const base = resolve(directory),
   lines: string[] = []
  for (const path of paths) {
   const target = await localFile(path)
   if (
    dirname(target).toLowerCase() !== base.toLowerCase() ||
    !/^track-\d+-segment-\d+\.partial$/.test(basename(target))
   )
    throw new Error('视频分段不属于该任务')
   lines.push(`file '${basename(target)}'`)
  }
  const list = join(base, key + '.ffconcat'),
   body = 'ffconcat version 1.0\n' + lines.join('\n') + '\n'
  try {
   await writeFile(list, body, {flag: 'wx'})
  } catch (error) {
   if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
   await localFile(list)
   if ((await readFile(list, 'utf8')) !== body) throw new Error('视频拼接列表已改变')
  }
  const output = join(base, 'joined-' + key + '.mkv'),
   artifact = new OwnedMediaArtifact(
    base,
    basename(output),
    createHash('sha256')
     .update(JSON.stringify(['concat-v1', lines, await Promise.all(paths.map(mediaFileHash))]))
     .digest('hex')
   )
  const prepared = await artifact.prepare()
  if (!prepared.reused)
   await this.command(
    'ffmpeg',
    [
     '-hide_banner',
     '-loglevel',
     'error',
     '-nostdin',
     '-n',
     '-protocol_whitelist',
     'file,pipe',
     '-format_whitelist',
     'concat,mov,matroska,webm,flv,mp3,aac,ogg,wav,flac,mpegts',
     '-f',
     'concat',
     '-safe',
     '1',
     '-i',
     list,
     '-map',
     '0',
     '-c',
     'copy',
     output
    ],
    signal
   )
  const proof = await this.probe(output, signal)
  if (!proof.video) throw new Error('拼接结果没有画面')
  await artifact.finish()
  return {path: output, intermediates: [basename(list), basename(output), ...artifact.intermediates()]}
 }
 async mux(input: {
  directory: string
  tracks: LocalTrack[]
  options: NativeMediaOptions
  expectedDuration: number
  title: string
  signal: AbortSignal
  subtitles?: {path: string; language: string}[]
  chapters?: {start: number; end: number; title: string}[]
  cover?: string
  outputName?: string
  keepSegments?: MediaInterval[]
 }) {
  const directory = resolve(input.directory),
   item = await lstat(directory)
  if (
   !item.isDirectory() ||
   item.isSymbolicLink() ||
   resolve(await realpath(directory)).toLowerCase() !== directory.toLowerCase()
  )
   throw new Error('媒体成果目录无效')
  if (!input.tracks.length || input.tracks.length > 8 || input.options.subtitle_only)
   throw new Error('音视频合并输入无效')
  const tracks: LocalTrack[] = []
  for (const track of input.tracks) {
   const path = await localFile(track.path)
   if (
    !path.toLowerCase().startsWith((directory + '\\').toLowerCase()) &&
    !path.toLowerCase().startsWith((directory + '/').toLowerCase())
   )
    throw new Error('媒体输入不属于该任务')
   tracks.push({...track, path})
  }
  const o = input.options,
   audio = o.audio_only,
   extension = audio
    ? ({best: 'mka', vorbis: 'ogg'} as Record<string, string>)[o.audio_format] || o.audio_format
    : o.container
  const kept = input.keepSegments ? checkedMediaIntervals(input.keepSegments, input.expectedDuration) : undefined
  const chapters = kept && input.chapters ? retimeMediaCues(input.chapters, kept) : input.chapters
  if (!['mkv', 'mp4', 'webm', 'mka', 'm4a', 'mp3', 'opus', 'flac', 'wav', 'aac', 'ogg'].includes(extension))
   throw new Error('媒体输出格式无效')
  const cover = input.cover ? await localFile(input.cover) : undefined
  if (cover && dirname(cover).toLowerCase() !== directory.toLowerCase()) throw new Error('封面不属于该任务')
  if (cover && !['mkv', 'mka', 'mp4', 'm4a', 'mp3', 'flac'].includes(extension))
   throw new Error('此格式不能嵌入封面，请改用 MKV、MP4、M4A、MP3 或 FLAC')
  if (
   input.outputName &&
   (!input.outputName.endsWith('.' + extension) ||
    /[\\/<>:"|?*\x00-\x1f]/.test(input.outputName) ||
    input.outputName === '.' ||
    input.outputName === '..')
  )
   throw new Error('媒体输出名称无效')
  const output = join(directory, input.outputName || 'result.' + extension)
  const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-n']
  for (const track of tracks)
   args.push(
    '-protocol_whitelist',
    'file,pipe',
    '-format_whitelist',
    'mov,matroska,webm,flv,mp3,aac,ogg,wav,flac,mpegts',
    '-i',
    track.path
   )
  const subtitleInputs = input.subtitles || []
  if (subtitleInputs.length > 100) throw new Error('字幕轨道过多')
  for (const subtitle of subtitleInputs) {
   const path = await localFile(subtitle.path)
   if (dirname(path).toLowerCase() !== directory.toLowerCase() || !/^[-\w]{1,64}$/.test(subtitle.language))
    throw new Error('字幕文件不属于该任务')
   args.push('-protocol_whitelist', 'file,pipe', '-f', 'srt', '-i', path)
  }
  let chapterIndex: number | undefined
  if (o.chapters && chapters?.length && (o.clip_end === null || kept)) {
   const escape = (value: string) => value.replace(/\\/g, '\\\\').replace(/[=;#\n\r]/g, c => '\\' + c)
   const metadata = chapters
    .map(c => {
     if (
      !Number.isFinite(c.start) ||
      !Number.isFinite(c.end) ||
      c.start < 0 ||
      c.end <= c.start ||
      c.end > input.expectedDuration + 1
     )
      throw new Error('章节时间无效')
     return `[CHAPTER]\nTIMEBASE=1/1000\nSTART=${Math.round(c.start * 1000)}\nEND=${Math.round(c.end * 1000)}\ntitle=${escape(c.title.slice(0, 300))}\n`
    })
    .join('\n')
   const path = join(directory, 'chapters.ffmeta'),
    body = ';FFMETADATA1\n' + metadata
   try {
    await writeFile(path, body, {flag: 'wx'})
   } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    await localFile(path)
    if ((await readFile(path, 'utf8')) !== body) throw new Error('章节恢复文件已改变，请核验后继续')
   }
   chapterIndex = tracks.length + subtitleInputs.length
   args.push('-protocol_whitelist', 'file,pipe', '-f', 'ffmetadata', '-i', path)
  }
  const attachedCover = cover && ['mkv', 'mka'].includes(extension),
   coverInput = tracks.length + subtitleInputs.length + (chapterIndex === undefined ? 0 : 1)
  if (cover && !attachedCover) args.push('-protocol_whitelist', 'file,pipe', '-f', 'image2', '-i', cover)
  if (!kept && o.clip_start !== null && o.clip_end !== null)
   args.push('-ss', String(o.clip_start), '-t', String(o.clip_end - o.clip_start))
  const videoIndex = tracks.findIndex(t => t.kind !== 'audio'),
   audioIndices = tracks.map((t, i) => (t.kind !== 'video' ? i : -1)).filter(i => i >= 0)
  if ((audio && !audioIndices.length) || (!audio && videoIndex < 0)) throw new Error('没有可用音轨或画面')
  let filterFile: string | undefined
  if (kept) {
   const audioTracks = audio ? audioIndices.slice(0, 1) : o.merge_audio ? audioIndices : audioIndices.slice(0, 1),
    filters: string[] = [],
    labels: string[] = []
   kept.forEach((range, i) => {
    const group: string[] = []
    if (!audio) {
     filters.push(`[${videoIndex}:v:0]trim=start=${range.start}:end=${range.end},setpts=PTS-STARTPTS[v${i}]`)
     group.push(`[v${i}]`)
    }
    audioTracks.forEach((track, j) => {
     filters.push(`[${track}:a:0]atrim=start=${range.start}:end=${range.end},asetpts=PTS-STARTPTS[a${i}_${j}]`)
     group.push(`[a${i}_${j}]`)
    })
    labels.push(group.join(''))
   })
   const outputs = (audio ? '' : '[edited_v]') + audioTracks.map((_, i) => `[edited_a${i}]`).join('')
   filters.push(labels.join('') + `concat=n=${kept.length}:v=${audio ? 0 : 1}:a=${audioTracks.length}` + outputs)
   filterFile = basename(output) + '.filter.txt'
   const path = join(directory, filterFile),
    body = filters.join(';\n')
   try {
    await writeFile(path, body, {flag: 'wx'})
   } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    await localFile(path)
    if ((await readFile(path, 'utf8')) !== body) throw new Error('片段拼接恢复文件已改变')
   }
   args.push('-filter_complex_script', path)
   if (!audio) args.push('-map', '[edited_v]')
   for (const [i] of audioTracks.entries()) args.push('-map', `[edited_a${i}]`)
   if (audio && !cover) args.push('-vn')
  } else if (audio) {
   args.push('-map', `${audioIndices[0]}:a:0`)
   if (!cover) args.push('-vn')
  } else {
   args.push('-map', `${videoIndex}:v:0`)
   for (const index of o.merge_audio ? audioIndices : audioIndices.slice(0, 1)) args.push('-map', `${index}:a:0?`)
  }
  for (const [index, subtitle] of subtitleInputs.entries())
   args.push('-map', `${tracks.length + index}:s:0`, '-metadata:s:s:' + index, 'language=' + subtitle.language)
  if (subtitleInputs.length) args.push('-c:s', 'srt')
  const cut = o.clip_end !== null || !!kept
  if (!audio) {
   args.push('-c:v', o.container === 'webm' ? 'libvpx-vp9' : cut ? 'libx264' : 'copy')
   if (cut && o.container !== 'webm') args.push('-preset', 'fast', '-crf', '18')
  }
  if (cover) {
   if (attachedCover)
    args.push('-attach', cover, '-metadata:s:t', 'mimetype=image/jpeg', '-metadata:s:t', 'filename=cover.jpg')
   else
    args.push(
     '-map',
     `${coverInput}:v:0`,
     `-c:v:${audio ? 0 : 1}`,
     'mjpeg',
     `-disposition:v:${audio ? 0 : 1}`,
     'attached_pic'
    )
  }
  const audioCodec = audio
   ? (
      {
       best: kept ? 'aac' : 'copy',
       m4a: 'aac',
       mp3: 'libmp3lame',
       opus: 'libopus',
       flac: 'flac',
       wav: 'pcm_s16le',
       aac: 'aac',
       vorbis: 'libvorbis'
      } as Record<string, string>
     )[o.audio_format]
   : o.container === 'webm'
     ? 'libopus'
     : o.container === 'mp4' || cut
       ? 'aac'
       : 'copy'
  args.push('-c:a', audioCodec)
  if (o.audio_bitrate && audioCodec !== 'copy' && audioCodec !== 'flac' && audioCodec !== 'pcm_s16le')
   args.push('-b:a', `${o.audio_bitrate}k`)
  if (o.metadata) args.push('-metadata', `title=${input.title.replace(/[\x00-\x1f]/g, ' ').slice(0, 240)}`)
  else args.push('-map_metadata', '-1')
  if (!o.chapters) args.push('-map_chapters', '-1')
  else if (chapterIndex !== undefined) args.push('-map_chapters', String(chapterIndex))
  args.push(output)
  const inputs = [...tracks.map(t => t.path), ...subtitleInputs.map(s => s.path), ...(cover ? [cover] : [])]
  const artifact = new OwnedMediaArtifact(
    directory,
    basename(output),
    createHash('sha256')
     .update(
      JSON.stringify([
       'mux-v1',
       args,
       input.expectedDuration,
       input.chapters,
       ...(kept ? [kept] : []),
       await Promise.all(inputs.map(mediaFileHash))
      ])
     )
     .digest('hex')
   ),
   prepared = await artifact.prepare()
  if (!prepared.reused) await this.command('ffmpeg', args, input.signal)
  const proof = await this.probe(output, input.signal),
   expected = kept
    ? kept.reduce((sum, range) => sum + range.end - range.start, 0)
    : cut
      ? o.clip_end! - o.clip_start!
      : input.expectedDuration
  if ((!audio && !proof.video) || (audio && !proof.audio) || (audioIndices.length > 0 && !proof.audio))
   throw new Error('成果缺少所选音轨或画面，保留恢复文件')
  if (proof.subtitles !== subtitleInputs.length || (chapterIndex !== undefined && proof.chapters !== chapters!.length))
   throw new Error('成果字幕或章节数量不符，保留恢复文件')
  if (cover && !proof.covers) throw new Error('成果未保留封面，恢复文件保留')
  if (
   !Number.isFinite(expected) ||
   expected <= 0 ||
   Math.abs(proof.duration - expected) > Math.max(1.5, expected * 0.015)
  )
   throw new Error('成果时长与所选分集不一致，保留恢复文件')
  await artifact.finish()
  return {
   path: output,
   relative: basename(output),
   ...proof,
   intermediates: [...artifact.intermediates(), ...(filterFile ? [filterFile] : [])],
   reused: prepared.reused
  }
 }
}
