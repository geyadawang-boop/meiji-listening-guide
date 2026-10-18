import {join} from 'node:path'
import {selectBiliStreams} from '@main/media/bilibili/media-bili'
import type {NativeMediaCatalog} from '@main/media/core/media-source'
import {downloadNativeHls} from '@main/media/transfer/media-hls'
import {mediaOptions, mediaTuning} from '@main/media/core/media-options'
import {NativeDownloadJobs} from '@main/media/jobs/media-jobs'
import {NativeMediaMux} from '@main/media/tools/media-mux'
import {transferMediaRanges} from '@main/media/transfer/media-parallel-transfer'
import {boundedMediaResponse, downloadNativeSubtitles} from '@main/media/core/media-subtitle-download'
import {createMediaTransport, mediaDelay} from '@main/media/transfer/media-transport'
import {mediaSidecars} from '@main/media/core/media-sidecars'
import {publishMediaLayout} from '@main/media/core/media-layout'
import {mediaFilename} from '@main/media/core/media-filenames'
import {sponsorBlockPlan} from '@main/media/core/media-sponsorblock'
import type {NativeMediaAuth} from '@main/media/auth/media-auth'

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>
/** Native queue executor; each final output is verified before task intermediates are cleaned. */
export class NativeBiliDownloadRunner {
 constructor(
  private jobs: NativeDownloadJobs,
  private catalog: NativeMediaCatalog,
  private fetcher: Fetcher,
  private mux: NativeMediaMux,
  private progress?: (id: string, downloaded: number, total: number | null) => void,
  private auth?: NativeMediaAuth
 ) {}
 async run(id: string, signal: AbortSignal) {
  let row = await this.jobs.read(id)
  if (row.state !== 'queued') throw new Error('任务不在等待队列中')
  const options = mediaOptions(row.recipe),
   defaults = mediaOptions()
  const supported = new Set([
   'height',
   'audio_quality',
   'audio_only',
   'container',
   'audio_format',
   'audio_bitrate',
   'video_codec',
   'format_ids',
   'merge_audio',
   'metadata',
   'chapters',
   'clip_start',
   'clip_end',
   'skip_existing',
   'retries',
   'subtitle_only',
   'subtitles',
   'auto_subtitles',
   'translated_subtitles',
   'subtitle_languages',
   'subtitle_format',
   'embed_subtitles',
   'keep_subtitles',
   'thumbnail',
   'embed_thumbnail',
   'crop_artwork',
   'proxy',
   'force_ipv4',
   'rate_kbps',
   'concurrent_fragments',
   'filename_template',
   'restrict_filenames',
   'split_chapters'
  ])
  let transport: ReturnType<typeof createMediaTransport> | undefined

  row = await this.jobs.transition(id, row.revision, 'running', {stage: '重新核对分集身份'})
  try {
   supported.add('custom_args')
   supported.add('format_sort')
   supported.add('folder_layout')
   supported.add('sponsorblock')
   supported.add('cookie_profile')
   supported.add('use_cookies')
   supported.add('privacy')
   supported.add('downloader')
   for (const key of Object.keys(options) as (keyof typeof options)[])
    if (!supported.has(key) && options[key] !== defaults[key]) throw new Error('原生执行器尚未接入此选项：' + key)
   const tuning = mediaTuning(options.custom_args),
    allowedTuning = new Set([
     '--sleep-requests',
     '--sleep-interval',
     '--max-sleep-interval',
     '--socket-timeout',
     '--prefer-free-formats',
     '--force-keyframes-at-cuts',
     '--write-description',
     '--write-link',
     '--no-mtime',
     '--buffer-size',
     '--http-chunk-size'
    ])
   for (const key of Object.keys(tuning))
    if (!allowedTuning.has(key)) throw new Error('原生执行器尚未接入此调节参数：' + key)
   const minimum = Number(tuning['--sleep-interval'] || 0),
    maximum = Number(tuning['--max-sleep-interval'] || minimum)
   if (maximum < minimum) throw new Error('最长等待间隔不能小于最短间隔')
   await mediaDelay((minimum + (maximum - minimum) * Math.random()) * 1000, signal)
   if (options.cookie_profile && !this.auth) throw new Error('登录档案存储不可用')
   const scoped = this.auth ? await this.auth.scoped(row.source_url, options, this.fetcher) : this.fetcher
   transport = createMediaTransport(scoped, options)
   const fetcher = transport.fetcher
   if (options.downloader === 'aria2c')
    row = await this.jobs.transition(id, row.revision, 'running', {
     warning: [row.warning, '旧 aria2c 设置已改用 TypeScript 原生并行分段，不再调用外部下载器']
      .filter(Boolean)
      .join('；')
    })
   signal.throwIfAborted()
   const result = await this.catalog.read(row.source_url, false, signal, options)
   if (!('identity' in result) || result.identity !== row.identity) throw new Error('分集身份已改变，请重新读取视频')
   const source = result,
    directory = await this.jobs.taskDirectory(id)
   const sidecars = await mediaSidecars(directory, source, tuning)
   const removal = options.sponsorblock
    ? await sponsorBlockPlan(source, options, directory, fetcher, signal)
    : undefined
   const keepSegments = removal && (removal.removed.length || options.clip_start !== null) ? removal.kept : undefined
   if (removal) {
    sidecars.push(removal.relative)
    row = await this.jobs.transition(id, row.revision, 'running', {
     warning: removal.warning,
     stage: '已核验片段移除计划'
    })
   }
   if (options.split_chapters && !source.chapters?.length)
    throw new Error('此分集没有站点章节，无法按章节拆分；可指定时间片段')
   const subtitles = options.subtitles
    ? await downloadNativeSubtitles(source, options, directory, fetcher, signal, keepSegments)
    : []
   let cover: Awaited<ReturnType<NativeMediaMux['prepareCover']>> | undefined
   if (options.thumbnail || options.embed_thumbnail) {
    if (!source.thumbnail) throw new Error('此视频未提供封面，恢复资料保留')
    const bytes = await boundedMediaResponse(
     await fetcher(source.thumbnail, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
      redirect: 'error',
      credentials: 'omit'
     }),
     8_000_000
    )
    cover = await this.mux.prepareCover(directory, bytes, options.crop_artwork, signal)
   }
   if (subtitles.some(t => t.automatic))
    row = await this.jobs.transition(id, row.revision, 'running', {
     stage: '字幕已保存',
     warning: [row.warning, '包含站点自动字幕，可能存在识别错误'].filter(Boolean).join('；')
    })
   if (options.subtitle_only) {
    signal.throwIfAborted()
    const layout = await publishMediaLayout(
     directory,
     [...subtitles.map(s => s.relative), ...sidecars, ...(options.thumbnail && cover ? [cover.relative] : [])],
     options,
     row.created
    )
    const proofs = await Promise.all(layout.outputs.map(name => this.jobs.evidence(id, name)))
    row = await this.jobs.complete(id, row.revision, proofs, [...layout.cleanup, ...(cover?.intermediates || [])])
    const cleanupPending = await this.jobs.cleanupCompleted(id)
    return {
     job: row,
     output: {
      path: join(directory, proofs[0].relative),
      relative: proofs[0].relative,
      duration: source.catalog.duration || 0,
      video: 0,
      audio: 0,
      subtitles: subtitles.length,
      chapters: 0,
      covers: 0
     },
     cleanupPending
    }
   }
   const selected = selectBiliStreams(source, options)
   const tracks: {path: string; kind: 'audio' | 'video' | 'combined'}[] = []
   const transferKeys: string[] = [],
    concatFiles: string[] = []
   for (let index = 0; index < selected.length; index++) {
    row = await this.jobs.transition(id, row.revision, 'running', {
     stage: `下载音视频轨道 ${index + 1}/${selected.length}`
    })
    const stream = selected[index],
     segmented = stream.kind === 'combined' && stream.urls.length > 1,
     segments = segmented ? stream.urls.map(url => [url]) : [stream.urls],
     paths: string[] = []
    if (stream.transport === 'hls') {
     const result = await downloadNativeHls({
      directory,
      key: `track-${index}`,
      identity: row.identity,
      url: stream.urls[0],
      platform: source.platform || '',
      options,
      fetcher,
      signal,
      headers: source.downloadHeaders,
      progress: (bytes, total) => this.progress?.(id, bytes, total)
     })
     tracks.push(...result.tracks)
     concatFiles.push(...result.intermediates)
     continue
    }
    for (const [segment, urls] of segments.entries()) {
     const key = `track-${index}` + (segmented ? `-segment-${segment}` : ''),
      identity = `${row.identity}:${stream.id}:${segment}`
     transferKeys.push(key)
     let transfer: Awaited<ReturnType<typeof transferMediaRanges>> | undefined, error: unknown
     for (let attempt = 0; attempt <= options.retries && !transfer; attempt++) {
      signal.throwIfAborted()
      // Mirrors for DASH are alternatives. Progressive segments are handled separately above.
      const url = urls[attempt % urls.length]
      try {
       transfer = await transferMediaRanges(
        {
         directory,
         key,
         identity,
         url,
         fetcher,
         signal,
         writeBufferBytes: Number(tuning['--buffer-size'] || 65536),
         chunkBytes: Number(tuning['--http-chunk-size'] || 0),
         headers: source.downloadHeaders || {Referer: 'https://www.bilibili.com/', 'User-Agent': 'Mozilla/5.0'},
         progress: (downloaded, total) => this.progress?.(id, downloaded, total)
        },
        options.downloader === 'aria2c' ? Math.max(4, options.concurrent_fragments) : options.concurrent_fragments
       )
      } catch (reason) {
       error = reason
       signal.throwIfAborted()
       if (attempt < options.retries)
        await new Promise<void>((resolve, reject) => {
         const timer = setTimeout(done, Math.min(5000, 500 * (attempt + 1)))
         function done() {
          signal.removeEventListener('abort', abort)
          resolve()
         }
         function abort() {
          clearTimeout(timer)
          reject(new Error('下载已取消'))
         }
         signal.addEventListener('abort', abort, {once: true})
         if (signal.aborted) abort()
        })
      }
     }
     if (!transfer) throw error || new Error('轨道下载失败')
     concatFiles.push(...transfer.intermediates)
     if (transfer.warning)
      row = await this.jobs.transition(id, row.revision, 'running', {
       warning: [row.warning, transfer.warning].filter(Boolean).join('；')
      })
     paths.push(transfer.path)
    }
    if (segmented) {
     const concatenated = await this.mux.concatenate(directory, paths, `track-${index}`, signal)
     tracks.push({path: concatenated.path, kind: stream.kind})
     concatFiles.push(...concatenated.intermediates)
    } else tracks.push({path: paths[0], kind: stream.kind})
   }
   signal.throwIfAborted()
   row = await this.jobs.transition(id, row.revision, 'running', {stage: '合并并核对画面、音轨和完整时长'})
   const extension = options.audio_only
    ? ({best: 'mka', vorbis: 'ogg'} as Record<string, string>)[options.audio_format] || options.audio_format
    : options.container
   // Existing default task paths remain compatible. Explicit templates and simplified names are applied.
   const outputName =
    options.filename_template !== defaults.filename_template || options.restrict_filenames
     ? mediaFilename(options, row.title, source.sourceId || row.identity.replace(/[^A-Za-z0-9_-]/g, '-'), extension)
     : undefined
   const output = await this.mux.mux({
    directory,
    tracks,
    options,
    expectedDuration: source.catalog.duration || 0,
    title: row.title,
    signal,
    chapters: source.chapters,
    subtitles: subtitles
     .filter(s => s.embedRelative)
     .map(s => ({path: join(directory, s.embedRelative!), language: s.language})),
    cover: options.embed_thumbnail ? cover?.path : undefined,
    outputName,
    keepSegments
   })
   concatFiles.push(...output.intermediates)
   const chapterOutputs: string[] = []
   if (options.split_chapters)
    for (const [index, chapter] of source.chapters!.entries()) {
     signal.throwIfAborted()
     const part = await this.mux.mux({
      directory,
      tracks,
      options: {...options, clip_start: chapter.start, clip_end: chapter.end, split_chapters: false},
      expectedDuration: source.catalog.duration || 0,
      title: chapter.title,
      signal,
      subtitles: subtitles
       .filter(s => s.embedRelative)
       .map(s => ({path: join(directory, s.embedRelative!), language: s.language})),
      cover: options.embed_thumbnail ? cover?.path : undefined,
      outputName: `chapter-${String(index + 1).padStart(3, '0')}.${extension}`
     })
     chapterOutputs.push(part.relative)
     concatFiles.push(...part.intermediates)
    }
   signal.throwIfAborted()
   const keepSubtitles = options.keep_subtitles || !options.embed_subtitles
   const layout = await publishMediaLayout(
    directory,
    [
     output.relative,
     ...chapterOutputs,
     ...sidecars,
     ...(keepSubtitles ? subtitles.map(s => s.relative) : []),
     ...(options.thumbnail && cover ? [cover.relative] : [])
    ],
    options,
    row.created
   )
   const evidence = await Promise.all(layout.outputs.map(name => this.jobs.evidence(id, name)))
   const cleanup = [
    ...transferKeys.flatMap(key => ['.partial', '.resume.json', '.resume.json.writing'].map(suffix => key + suffix)),
    'chapters.ffmeta',
    ...concatFiles,
    ...(cover?.intermediates || []),
    ...(cover && !options.thumbnail ? [cover.relative] : []),
    ...subtitles.flatMap(s => [...(s.embedRelative ? [s.embedRelative] : []), ...(keepSubtitles ? [] : [s.relative])])
   ]
   row = await this.jobs.complete(id, row.revision, evidence, [...cleanup, ...layout.cleanup])
   const remaining = await this.jobs.cleanupCompleted(id)
   return {
    job: await this.jobs.read(id),
    output: {...output, path: join(directory, evidence[0].relative), relative: evidence[0].relative},
    cleanupPending: remaining.map(name => join(directory, name))
   }
  } catch (error) {
   const current = await this.jobs.read(id)
   if (current.state === 'running')
    await this.jobs.transition(id, current.revision, signal.aborted ? 'cancelled' : 'error', {
     stage: signal.aborted ? '已取消，恢复材料保留' : '未发布成果，恢复材料保留',
     error: signal.aborted ? '' : error instanceof Error ? error.message : '下载未完成'
    })
   throw error
  } finally {
   await transport?.close()
  }
 }
}
