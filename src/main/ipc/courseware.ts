import {z} from 'zod'
import {subtitleLocator} from '@main/learning/subtitles/subtitle-sync'
import type {DerivedSource} from '@shared/subtitle-derived'
import {summarizeVideo, summaryMode} from '@main/learning/video/video-summary'
import {libraryDirectory, folderName, reserveFile} from '@main/library/library'
import {dialog, shell} from 'electron'
import {readFile, stat, writeFile, rm} from 'node:fs/promises'
import {parseSrt} from '@shared/srt'
import {managedFile} from '@main/library/file-manager'
import {extname, dirname, basename} from 'node:path'
import {bilibiliUrl} from '@main/media/bilibili/video-policy'
import {selectedSubtitles} from '@main/learning/subtitles/subtitle-selection'
import {readVideoSeries, parseVideoSeries} from '@main/media/bilibili/bilibili-series'
import {exportVideoNotes, saveTextExport} from '@main/documents/video-exports'
import type {VideoBatchItem} from '@shared/video-ppt'
import {snapanyDownload} from '@main/media/sources/snapany'
import {noteTitles} from '@shared/video-notes'
import {createHash} from 'node:crypto'
import {defaultVideoPrompt} from '@shared/video-ppt'
import {VideoPpt} from '@main/learning/video/video-ppt'
import {defaultPptExtractPrompt} from '@shared/ppt-extract'
import {deleteConvertedPpt, verifyGeneratedPdf} from '@main/documents/pdf-ppt-cleanup'
import type {ApplicationContext} from '@main/app/context'
import type {IpcHandler} from '@main/ipc/handler'
export function createCoursewareHandler(
 context: Pick<
  ApplicationContext,
  | 'api'
  | 'biliFixture'
  | 'db'
  | 'derivedDependencies'
  | 'emit'
  | 'fetchBiliSubtitle'
  | 'idSchema'
  | 'job'
  | 'libraryRoot'
  | 'pptExtractor'
  | 'saveBiliSubtitle'
  | 'saveTranscribedVideo'
  | 'saveVideoPdf'
  | 'subtitleDerived'
  | 'subtitleSync'
  | 'syncDependencies'
  | 'videoPpt'
  | 'videoProgress'
  | 'videoSeriesCache'
  | 'window'
 >
): IpcHandler {
 const {
  api,
  biliFixture,
  db,
  derivedDependencies,
  emit,
  fetchBiliSubtitle,
  idSchema,
  job,
  libraryRoot,
  pptExtractor,
  saveBiliSubtitle,
  saveTranscribedVideo,
  saveVideoPdf,
  subtitleDerived,
  subtitleSync,
  syncDependencies,
  videoPpt,
  videoProgress,
  videoSeriesCache,
  window
 } = context
 return {
  actions: new Set([
   'subtitle-sync:list',
   'subtitle-derived:list',
   'subtitle-derived:resume',
   'subtitle-derived:start',
   'subtitle-sync:attach',
   'subtitle-sync:resume',
   'subtitle-sync:start',
   'subtitle-sync:mixed',
   'video-ppt:pending',
   'video-ppt:restore',
   'video-ppt:reveal',
   'video-ppt:series',
   'video-ppt:subtitle',
   'video-ppt:subtitle-import',
   'video-ppt:subtitle-save',
   'video-ppt:subtitle-export',
   'video-ppt:notes-export',
   'video-ppt:batch-subtitles',
   'video-ppt:summary',
   'video-ppt:subtitle-transcribe',
   'video-ppt:subtitle-transcribe-local',
   'video-ppt:resume-subtitle',
   'video-ppt:batch',
   'video-ppt:auto',
   'video-ppt:pick',
   'video-ppt:source',
   'video-ppt:extract',
   'video-ppt:export',
   'ppt-extract:pick',
   'ppt-extract:analyze',
   'ppt-extract:export'
  ]),
  async invoke(action, object) {
   const id = () => z.string().uuid().parse(object.id),
    courseId = () => z.string().uuid().parse(object.courseId)
   switch (action) {
    case 'subtitle-sync:list':
     return subtitleSync.list()
    case 'subtitle-derived:list':
     return subtitleDerived.list()
    case 'subtitle-derived:resume':
     return job('批量课程笔记', signal => subtitleDerived.run(id(), derivedDependencies, signal))
    case 'subtitle-derived:start':
     return job('批量课程笔记', async signal => {
      const task = (await subtitleSync.list()).find(task => task.id === id())
      if (!task) throw new Error('同步记录不存在')
      const urls = z.array(z.string()).min(1).max(1000).parse(object.urls).map(subtitleLocator)
      if (new Set(urls).size !== urls.length) throw new Error('不要重复选择分集')
      const sources: DerivedSource[] = urls.map(url => {
       const item = task.items.find(item => item.url === url)
       if (!item || item.status !== '已完成' || !item.path || !item.hash || !item.generation)
        throw new Error('请选择已成功同步的分集')
       return {url, title: item.title, path: item.path, hash: item.hash, generation: item.generation}
      })
      const modes = z.array(summaryMode).min(1).max(4).parse(object.modes)
      const derived = await subtitleDerived.create(sources, modes, task.courseName)
      return subtitleDerived.run(derived.id, derivedDependencies, signal)
     })
    case 'subtitle-sync:attach':
     return job('指定同步字幕', async signal => {
      const task = (await subtitleSync.list()).find(task => task.id === id()),
       selector = object.url
        ? subtitleLocator(z.string().parse(object.url))
        : z.number().int().positive().parse(object.page)
      const matches =
       task?.items.filter(item => (typeof selector === 'string' ? item.url === selector : item.page === selector)) || []
      if (!task || matches.length !== 1) throw new Error('请按视频网址明确选择本次同步的分集')
      const item = matches[0],
       page = item.page
      const directory = await libraryDirectory(libraryRoot, '语音原文', task.courseName)
      const result = await dialog.showOpenDialog(window, {
       title: `为 P${page} 选择已有字幕`,
       defaultPath: directory,
       properties: ['openFile'],
       filters: [{name: '字幕 SRT', extensions: ['srt']}]
      })
      if (result.canceled || !result.filePaths[0]) return null
      signal.throwIfAborted()
      const input = result.filePaths[0]
      if ((await stat(input)).size > 4000000) throw new Error('字幕文件过大')
      const text = await readFile(input, 'utf8')
      parseSrt(text)
      let path: string
      try {
       path = await managedFile(libraryRoot, input)
      } catch {
       path = await reserveFile(directory, basename(input))
       try {
        await writeFile(path, text, 'utf8')
        if ((await readFile(path, 'utf8')) !== text) throw new Error('字幕保存校验失败')
       } catch (error) {
        await rm(path, {force: true})
        throw error
       }
      }
      await subtitleSync.attach(task.id, selector, path)
      return subtitleSync.run(task.id, syncDependencies(task.courseName), signal)
     })
    case 'subtitle-sync:resume':
     return job('字幕同步知识库', async signal => {
      const task = (await subtitleSync.list()).find(task => task.id === id())
      if (!task) throw new Error('同步记录不存在')
      return subtitleSync.run(task.id, syncDependencies(task.courseName), signal)
     })
    case 'subtitle-sync:start':
     return job('字幕同步知识库', async signal => {
      const url = bilibiliUrl(z.string().parse(object.url)),
       series = videoSeriesCache.get(url)
      if (!series) throw new Error('请先读取课程列表，再选择分集')
      const pages = z.array(z.number().int().positive()).min(1).max(1000).parse(object.pages)
      if (new Set(pages).size !== pages.length || pages.some(page => !series.episodes.some(item => item.page === page)))
       throw new Error('所选分集无效')
      const selectedCourse = object.courseId ? db.course(idSchema.parse(object.courseId)).name : undefined
      const category = z
       .string()
       .trim()
       .max(100)
       .parse(object.category || '')
      const task = await subtitleSync.create(
       series.episodes.filter(item => pages.includes(item.page)),
       category,
       selectedCourse
      )
      return subtitleSync.run(task.id, syncDependencies(selectedCourse), signal)
     })
    case 'subtitle-sync:mixed':
     return job('批量字幕同步知识库', async signal => {
      const items = selectedSubtitles(object.selections, videoSeriesCache)
      const selectedCourse = object.courseId ? db.course(idSchema.parse(object.courseId)).name : undefined
      const category = z
       .string()
       .trim()
       .max(100)
       .parse(object.category || '')
      const task = await subtitleSync.create(items, category, selectedCourse)
      return subtitleSync.run(task.id, syncDependencies(selectedCourse), signal)
     })
    case 'video-ppt:pending':
     return videoPpt.pending()
    case 'video-ppt:restore':
     return videoPpt.restore(id())
    case 'video-ppt:reveal': {
     const error = await shell.openPath(await videoPpt.location(id()))
     if (error) throw new Error('任务文件夹无法打开')
     return true
    }
    case 'video-ppt:series':
     return job('video-directory', async signal => {
      const url = bilibiliUrl(z.string().parse(object.url))
      const series = biliFixture
       ? parseVideoSeries(url, {
          pages: (
           await fetch(
            biliFixture + '/x/player/pagelist?bvid=' + new URL(url).pathname.split('/').filter(Boolean).at(-1),
            {signal}
           ).then(response => response.json())
          ).data
         })
       : await readVideoSeries(url, signal)
      videoSeriesCache.set(url, series)
      return series
     })
    case 'video-ppt:subtitle':
     return job('video-subtitle', signal => fetchBiliSubtitle(z.string().parse(object.url), signal))
    case 'video-ppt:subtitle-import': {
     const selectedCourse = object.courseId ? db.course(idSchema.parse(object.courseId)).name : undefined
     const result = await dialog.showOpenDialog(window, {
      title: '载入已保存的字幕',
      defaultPath: await libraryDirectory(libraryRoot, '语音原文', selectedCourse),
      properties: ['openFile'],
      filters: [{name: '字幕 SRT', extensions: ['srt']}]
     })
     if (result.canceled || !result.filePaths[0]) return null
     const path = result.filePaths[0]
     if ((await stat(path)).size > 4000000) throw new Error('字幕文件过大')
     const srt = await readFile(path, 'utf8'),
      segments = parseSrt(srt)
     return {
      title: basename(path, extname(path)),
      page: 1,
      source: '已有 SRT 字幕',
      warning: '原文按文件内容载入，未自动校正。',
      srt,
      count: segments.length,
      savedPath: path
     }
    }
    case 'video-ppt:subtitle-save': {
     const url = z.string().parse(object.url),
      srt = z.string().min(1).max(4000000).parse(object.srt)
     const selectedCourse = object.courseId ? db.course(idSchema.parse(object.courseId)).name : undefined
     return saveBiliSubtitle(url, z.string().min(1).max(200).parse(object.title), srt, selectedCourse)
    }
    case 'video-ppt:subtitle-export': {
     const format = z.enum(['txt', 'md', 'vtt']).parse(object.format),
      srt = z.string().min(1).max(4000000).parse(object.srt)
     const title = folderName(z.string().min(1).max(200).parse(object.title))
     const selectedCourse = object.courseId ? db.course(idSchema.parse(object.courseId)).name : undefined
     return saveTextExport(await libraryDirectory(libraryRoot, '语音原文', selectedCourse), title, srt, format)
    }
    case 'video-ppt:notes-export': {
     const source = await managedFile(libraryRoot, z.string().parse(object.path))
     if (!source.endsWith('.md')) throw new Error('请先生成并保存课程笔记')
     return exportVideoNotes(source, dirname(source), z.enum(['docx', 'pdf', 'svg']).parse(object.format))
    }
    case 'video-ppt:batch-subtitles':
     return job('video-subtitles', async signal => {
      const url = bilibiliUrl(z.string().parse(object.url)),
       series = videoSeriesCache.get(url)
      if (!series) throw new Error('请先读取课程列表，再选择分集')
      const pages = z.array(z.number().int().positive()).min(1).max(1000).parse(object.pages)
      if (new Set(pages).size !== pages.length || pages.some(p => !series.episodes.some(e => e.page === p)))
       throw new Error('所选分集无效')
      const selectedCourse = object.courseId ? db.course(idSchema.parse(object.courseId)).name : undefined
      const selected = series.episodes.filter(e => pages.includes(e.page)),
       results: VideoBatchItem[] = []
      for (const [index, episode] of selected.entries()) {
       signal.throwIfAborted()
       videoProgress(`正在取得所选字幕 ${index + 1}/${selected.length} · P${episode.page} ${episode.title}`)
       try {
        let subtitle: Awaited<ReturnType<typeof fetchBiliSubtitle>> | undefined
        try {
         subtitle = await fetchBiliSubtitle(episode.url, signal)
        } catch {
         signal.throwIfAborted()
        }
        let path: string,
         cleanupWarning = ''
        if (subtitle) path = await saveBiliSubtitle(episode.url, episode.title, subtitle.srt, selectedCourse)
        else {
         videoProgress(`P${episode.page} 无可用站内字幕，正在下载并离线转写`)
         const videoId = new URL(episode.url).pathname.split('/').filter(Boolean).at(-1)!
         const outputName = videoId + '-P' + episode.page + '-离线转写.srt'
         const task = await videoPpt.create(videoId + '-P' + episode.page + '-字幕转写', {
          kind: 'subtitle',
          outputName,
          courseName: selectedCourse,
          url: episode.url,
          page: episode.page
         })
         await snapanyDownload(window, episode.url, task.video, videoProgress, signal)
         const saved = await saveTranscribedVideo(task, outputName, selectedCourse, signal, episode.page)
         path = saved.savedPath
         cleanupWarning = saved.cleanupWarning
        }
        results.push({
         page: episode.page,
         title: episode.title,
         status: '已完成',
         path,
         ...(cleanupWarning ? {error: cleanupWarning} : {})
        })
       } catch (error) {
        signal.throwIfAborted()
        results.push({
         page: episode.page,
         title: episode.title,
         status: '失败',
         error: error instanceof Error ? error.message : '字幕处理失败'
        })
       }
      }
      return results
     })
    case 'video-ppt:summary':
     return job('video-summary', async signal => {
      const mode = summaryMode.parse(object.mode),
       srt = z.string().min(1).max(4000000).parse(object.srt)
      const title = folderName(z.string().min(1).max(200).parse(object.title))
      const selectedCourse = object.courseId ? db.course(idSchema.parse(object.courseId)).name : undefined
      const result = await summarizeVideo(
       srt,
       mode,
       (prompt, input, active) => api.json(prompt, input, value => value, active),
       videoProgress,
       signal
      )
      const suffix = noteTitles[mode]
      const path = await reserveFile(
       await libraryDirectory(libraryRoot, '笔记', selectedCourse),
       title + '-' + suffix + '.md'
      )
      const evidence = path.replace(/\.md$/i, '.json'),
       record = JSON.stringify(result.points, null, 2)
      try {
       await writeFile(path, result.markdown, 'utf8')
       await writeFile(evidence, record, 'utf8')
       if ((await readFile(path, 'utf8')) !== result.markdown || (await readFile(evidence, 'utf8')) !== record)
        throw new Error('摘要保存校验失败')
      } catch (error) {
       await rm(path, {force: true})
       await rm(evidence, {force: true})
       throw error
      }
      return {path, count: result.count, markdown: result.markdown, points: result.points}
     })
    case 'video-ppt:subtitle-transcribe':
     return job('video-subtitle', async signal => {
      const url = bilibiliUrl(z.string().parse(object.url))
      const selectedCourse = object.courseId ? db.course(idSchema.parse(object.courseId)).name : undefined
      const page = new URL(url).searchParams.get('p') || '1'
      const videoId = new URL(url).pathname.split('/').filter(Boolean).at(-1)!
      const outputName = videoId + '-P' + page + '-离线转写.srt'
      const task = await videoPpt.create(videoId + '-P' + page + '-字幕转写', {
       kind: 'subtitle',
       outputName,
       courseName: selectedCourse,
       url,
       page: Number(page)
      })
      videoProgress('正在下载视频用于离线字幕转写')
      await snapanyDownload(window, url, task.video, videoProgress, signal)
      return saveTranscribedVideo(task, outputName, selectedCourse, signal, Number(page))
     })
    case 'video-ppt:subtitle-transcribe-local': {
     const selectedCourse = object.courseId ? db.course(idSchema.parse(object.courseId)).name : undefined
     const result = await dialog.showOpenDialog(window, {
      title: '选择要转写的本地视频',
      properties: ['openFile'],
      filters: [{name: '视频', extensions: ['mp4', 'mkv', 'mov', 'webm']}]
     })
     if (result.canceled || !result.filePaths[0]) return null
     return job('video-subtitle', async signal => {
      const input = result.filePaths[0]
      videoProgress('正在复制本地视频用于字幕转写；原文件保持不变')
      const outputName = folderName(basename(input, extname(input))) + '-离线转写.srt'
      const task = await videoPpt.local(input, signal, {
       kind: 'subtitle',
       outputName,
       courseName: selectedCourse,
       page: 1
      })
      return saveTranscribedVideo(task, outputName, selectedCourse, signal)
     })
    }
    case 'video-ppt:resume-subtitle':
     return job('video-subtitle', async signal => {
      const meta = await videoPpt.subtitleTask(id())
      if (meta.saved) {
       const path = await managedFile(await libraryDirectory(libraryRoot, '语音原文', meta.courseName), meta.saved.path)
       const bytes = await readFile(path),
        hash = createHash('sha256').update(bytes).digest('hex')
       if (hash !== meta.saved.sha256) throw new Error('已保存字幕与任务记录不一致，临时视频已保留')
       const srt = bytes.toString('utf8'),
        segments = parseSrt(srt)
       await videoPpt.discardCompleted(meta.id)
       return {
        title: meta.name,
        page: meta.page,
        source: '已保存的字幕',
        warning: '已核对原有字幕并清理本次临时视频。',
        srt,
        count: segments.length,
        savedPath: path,
        cleanupWarning: ''
       }
      }
      try {
       if (!(await stat(meta.video)).isFile()) throw new Error('视频文件无效')
      } catch (error) {
       if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
       if (!meta.url) throw new Error('本地视频副本尚未准备完成，请重新选择原视频')
       videoProgress('视频尚未完整下载，正在重新下载本分集')
       await snapanyDownload(window, meta.url, meta.video, videoProgress, signal)
      }
      return saveTranscribedVideo(
       {id: meta.id, dir: meta.dir, video: meta.video, name: meta.name},
       meta.outputName,
       meta.courseName,
       signal,
       meta.page
      )
     })
    case 'video-ppt:batch':
     return job('video-batch', async signal => {
      const url = bilibiliUrl(z.string().parse(object.url)),
       series = videoSeriesCache.get(url)
      if (!series) throw new Error('请先读取课程列表，再选择分集')
      const pages = z.array(z.number().int().positive()).min(1).max(1000).parse(object.pages)
      if (new Set(pages).size !== pages.length || pages.some(p => !series.episodes.some(e => e.page === p)))
       throw new Error('所选分集无效')
      const selectedCourse = object.courseId ? db.course(idSchema.parse(object.courseId)).name : undefined,
       prompt = z
        .string()
        .trim()
        .min(1)
        .max(6000)
        .parse(object.prompt ?? defaultVideoPrompt)
      const selected = series.episodes.filter(e => pages.includes(e.page)),
       items: VideoBatchItem[] = selected.map(e => ({page: e.page, title: e.title, status: '等待处理'}))
      const notify = () => emit({kind: 'video-batch', items: items.map(i => ({...i}))})
      notify()
      for (const [index, episode] of selected.entries()) {
       signal.throwIfAborted()
       const item = items[index]
       item.status = '处理中'
       notify()
       videoProgress(`正在处理所选课程 ${index + 1}/${selected.length} · P${episode.page} ${episode.title}`)
       try {
        const task = await videoPpt.create(`P${String(episode.page).padStart(3, '0')}-${episode.title}`)
        await snapanyDownload(window, episode.url, task.video, videoProgress, signal)
        const source = await videoPpt.prepare(task, signal)
        if (source.warning) throw new Error(source.warning)
        const review = await videoPpt.extract(source.id, source.crop, prompt, signal)
        if (review.warning) throw new Error(review.warning)
        const result = await saveVideoPdf(
         source.id,
         selectedCourse,
         review.pages.map(({page, keep, crop}) => ({page, keep, crop})),
         signal
        )
        item.status = '已完成'
        item.path = result.path
        if (result.cleanupWarning) item.error = result.cleanupWarning
       } catch (e) {
        item.status = '失败'
        item.error = e instanceof Error ? e.message : String(e)
        notify()
        signal.throwIfAborted()
       }
       notify()
      }
      return items
     })
    case 'video-ppt:auto':
     return job('video-ppt', async signal => {
      const selectedCourse = object.courseId ? db.course(idSchema.parse(object.courseId)).name : undefined,
       prompt = z
        .string()
        .trim()
        .min(1)
        .max(6000)
        .parse(object.prompt ?? defaultVideoPrompt)
      let task: Awaited<ReturnType<VideoPpt['create']>>
      if (object.path) task = await videoPpt.local(z.string().min(1).parse(object.path), signal)
      else {
       const url = bilibiliUrl(z.string().parse(object.url))
       task = await videoPpt.create(
        new URL(url).pathname.split('/').filter(Boolean).at(-1) + '-P' + (new URL(url).searchParams.get('p') || '1')
       )
       await snapanyDownload(window, url, task.video, videoProgress, signal)
      }
      const source = await videoPpt.prepare(task, signal)
      if (source.warning) throw new Error(source.warning + ' 可在“未完成的任务”继续检查；视频已保留。')
      const review = await videoPpt.extract(source.id, source.crop, prompt, signal)
      if (review.warning) throw new Error(review.warning + ' 可在“未完成的任务”继续检查；视频已保留。')
      return saveVideoPdf(
       source.id,
       selectedCourse,
       review.pages.map(({page, keep, crop}) => ({page, keep, crop})),
       signal
      )
     })
    case 'video-ppt:pick': {
     const result = await dialog.showOpenDialog(window, {
      title: '选择已下载的视频',
      properties: ['openFile'],
      filters: [{name: '视频', extensions: ['mp4', 'mkv', 'mov', 'webm']}]
     })
     return result.canceled ? null : result.filePaths[0]
    }
    case 'video-ppt:source':
     return job('video-ppt', async signal => {
      if (object.path)
       return videoPpt.prepare(await videoPpt.local(z.string().min(1).parse(object.path), signal), signal)
      const url = bilibiliUrl(z.string().parse(object.url)),
       task = await videoPpt.create(
        new URL(url).pathname.split('/').filter(Boolean).at(-1) + '-P' + (new URL(url).searchParams.get('p') || '1')
       )
      await snapanyDownload(window, url, task.video, videoProgress, signal)
      return videoPpt.prepare(task, signal)
     })
    case 'video-ppt:extract':
     return job('video-ppt', signal =>
      videoPpt.extract(
       id(),
       z.object({left: z.number(), right: z.number(), top: z.number(), bottom: z.number()}).parse(object.crop),
       z
        .string()
        .trim()
        .min(1)
        .max(6000)
        .parse(object.prompt ?? defaultVideoPrompt),
       signal
      )
     )
    case 'video-ppt:export':
     return job('video-ppt', async signal => {
      if (object.checked !== true) throw new Error('请先检查课件预览，再确认导出')
      const choices = z
       .array(
        z.object({
         page: z.number().int().positive(),
         keep: z.boolean(),
         crop: z.object({left: z.number(), right: z.number(), top: z.number(), bottom: z.number()})
        })
       )
       .parse(object.pages)
      return saveVideoPdf(
       id(),
       object.courseId ? db.course(idSchema.parse(object.courseId)).name : undefined,
       choices,
       signal
      )
     })
    case 'ppt-extract:pick': {
     const result = await dialog.showOpenDialog(window, {
      title: '选择需要截取的 PPT',
      properties: ['openFile'],
      filters: [{name: '图片型 PowerPoint', extensions: ['pptx']}]
     })
     return result.canceled ? null : result.filePaths[0]
    }
    case 'ppt-extract:analyze':
     return job('ppt-extract', signal =>
      pptExtractor.analyze(
       z.string().min(1).parse(object.path),
       z
        .string()
        .trim()
        .min(1)
        .max(6000)
        .parse(object.prompt ?? defaultPptExtractPrompt),
       signal
      )
     )
    case 'ppt-extract:export':
     return job('ppt-extract', async signal => {
      const choices = z
       .array(
        z.object({
         page: z.number().int().positive(),
         keep: z.boolean(),
         crop: z.object({left: z.number(), right: z.number(), top: z.number(), bottom: z.number()})
        })
       )
       .max(500)
       .parse(object.pages)
      const result = await pptExtractor.export(idSchema.parse(object.id), choices, signal)
      signal.throwIfAborted()
      const selectedCourse = object.courseId ? db.course(idSchema.parse(object.courseId)).name : undefined
      const dir = await libraryDirectory(libraryRoot, 'PPT', selectedCourse),
       path = await reserveFile(dir, result.sourceName.replace(/\.pptx$/i, '') + '-截取.' + result.extension)
      try {
       await writeFile(path, result.buffer)
       signal.throwIfAborted()
      } catch (error) {
       await rm(path, {force: true})
       throw error
      }
      let sourceDeleted = false,
       cleanupWarning = ''
      try {
       await deleteConvertedPpt(result.sourcePath, result.sourceHash, path, result.buffer, result.kept, () => {
        db.db.transaction(() => {
         db.db.prepare('UPDATE lectures SET ppt_path=? WHERE ppt_path=?').run(path, result.sourcePath)
         db.db
          .prepare('UPDATE course_files SET path=?,filename=? WHERE path=?')
          .run(path, result.sourceName.replace(/\.pptx?$/i, '') + '-截取.pdf', result.sourcePath)
        })()
        db.db.pragma('wal_checkpoint(FULL)')
       })
       sourceDeleted = true
       pptExtractor.markSourceDeleted(idSchema.parse(object.id))
      } catch (error) {
       if (result.sourceDeleted && (error as NodeJS.ErrnoException).code === 'ENOENT') {
        verifyGeneratedPdf(await readFile(path), result.kept)
        sourceDeleted = true
       } else cleanupWarning = error instanceof Error ? error.message : 'PDF 已保存，但 PPT 清理失败'
      }
      return {path, kept: result.kept, removed: result.removed, sourceDeleted, cleanupWarning}
     })
    default:
     throw new Error('未知操作')
   }
  }
 }
}
