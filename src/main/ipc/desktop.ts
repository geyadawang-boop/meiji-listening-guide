import {app, dialog, shell, net, nativeImage} from 'electron'
import {z} from 'zod'
import {ensureLibrary, folderName, reserveFile} from '@main/library/library'
import {studyEntries} from '@main/learning/study/study'
import {join, extname} from 'node:path'
import {readImageDeck} from '@main/documents/ppt-extract'
import {defaultVideoPrompt} from '@shared/video-ppt'
import {readFile, stat, rm} from 'node:fs/promises'
import {readTranscript} from '@main/documents/transcript'
import {parseCourseware, serializeCoursewareSourceCache} from '@main/documents/documents'
import {listLibrary, managedFile} from '@main/library/file-manager'
import {Api} from '@main/ai/api'
import {type Settings} from '@shared/types'
import {exportFile, validateExportFormat} from '@main/documents/exports'
import type {ApplicationContext} from '@main/app/context'
import type {IpcHandler} from '@main/ipc/handler'
export function createDesktopHandler(
 context: Pick<
  ApplicationContext,
  | 'runtime'
  | 'media'
  | 'knowledge'
  | 'api'
  | 'appearance'
  | 'db'
  | 'directory'
  | 'emit'
  | 'idSchema'
  | 'identity'
  | 'job'
  | 'jobs'
  | 'jobState'
  | 'libraryRoot'
  | 'root'
  | 'saveVideoPdf'
  | 'settings'
  | 'toolsBackend'
  | 'videoPpt'
  | 'videoProgress'
  | 'visualConnection'
  | 'window'
  | 'zhiyun'
  | 'zhiyunBrowser'
 >
): IpcHandler {
 const {
  runtime,
  media,
  knowledge,
  api,
  appearance,
  db,
  directory,
  emit,
  idSchema,
  identity,
  job,
  jobs,
  jobState,
  libraryRoot,
  root,
  saveVideoPdf,
  settings,
  toolsBackend,
  videoPpt,
  videoProgress,
  visualConnection,
  window,
  zhiyun,
  zhiyunBrowser
 } = context
 return {
  actions: new Set([
   'app:info',
   'runtime:status',
   'runtime:install',
   'library:open',
   'zhiyun:login',
   'zhiyun:refresh',
   'zhiyun:back',
   'zhiyun:bounds',
   'zhiyun:search',
   'zhiyun:lessons',
   'zhiyun:export',
   'library:list',
   'library:open-file',
   'library:reveal',
   'library:delete',
   'cancel',
   'job:current',
   'settings:get',
   'settings:models',
   'settings:probe',
   'appearance:get',
   'appearance:save',
   'appearance:clear',
   'appearance:image',
   'identity:get',
   'identity:save',
   'identity:avatar',
   'settings:save',
   'settings:test',
   'export',
   'external'
  ]),
  async invoke(action, object) {
   const id = () => z.string().uuid().parse(object.id),
    courseId = () => z.string().uuid().parse(object.courseId)
   switch (action) {
    case 'app:info':
     return {version: app.getVersion(), electron: process.versions.electron, platform: process.platform}
    case 'runtime:status':
     return runtime.status()
    case 'runtime:install':
     if (process.platform !== 'win32') throw new Error('运行组件目前仅支持 Windows，无法在当前平台安装')
     return job('安装运行组件', async signal => {
      if (toolsBackend.started || media.started || knowledge.started)
       throw new Error('请重启软件后先安装组件，再打开后台任务')
      const picked = await dialog.showOpenDialog(window, {title: '选择同版本组件文件夹', properties: ['openDirectory']})
      if (picked.canceled) return null
      return runtime.install(z.string().parse(object.id), picked.filePaths[0], signal, message =>
       emit({kind: 'progress', data: {stage: '安装组件', message}})
      )
     })
    case 'library:open': {
     const error = await shell.openPath(libraryRoot)
     if (error) throw new Error('无法打开资料文件夹')
     return libraryRoot
    }
    case 'zhiyun:login':
     await zhiyunBrowser.home()
     return true
    case 'zhiyun:refresh':
     zhiyunBrowser.refresh()
     return true
    case 'zhiyun:back':
     zhiyunBrowser.back()
     return true
    case 'zhiyun:bounds':
     zhiyunBrowser.bounds(
      z
       .object({
        x: z.number().min(0).max(10000),
        y: z.number().min(0).max(10000),
        width: z.number().min(0).max(10000),
        height: z.number().min(0).max(10000)
       })
       .parse(object.bounds),
      z.boolean().parse(object.visible)
     )
     return true
    case 'zhiyun:search':
     return zhiyun.search(
      z.string().trim().min(1).max(100).parse(object.keyword),
      z
       .number()
       .int()
       .min(1)
       .max(1000)
       .parse(object.page || 1)
     )
    case 'zhiyun:lessons':
     return (await zhiyun.lessons(z.string().regex(/^\d+$/).parse(object.courseId))).map(
      ({videoUrl, ...lesson}) => lesson
     )
    case 'zhiyun:export':
     return job('zhiyun', async signal => {
      const kind = z.enum(['transcript', 'ppt']).parse(object.kind),
       externalCourse = z.string().regex(/^\d+$/).parse(object.courseId),
       sub = z.string().regex(/^\d+$/).parse(object.subId)
      const lessons = await zhiyun.lessons(externalCourse),
       lesson = lessons.find(l => l.id === sub)
      if (!lesson) throw new Error('没有找到所选课次')
      const name = z
       .string()
       .trim()
       .min(1)
       .max(200)
       .parse(object.courseName || '智云课程 ' + externalCourse)
      const course = object.localCourseId
       ? db.course(idSchema.parse(object.localCourseId))
       : db.courses().find(c => c.name === name) || db.createCourse(name)
      await ensureLibrary(libraryRoot, [course.name])
      const planned = studyEntries(db).find(
        e => e.courseId === course.id && e.zhiyunCourseId === externalCourse && e.subId === sub
       ),
       title = planned?.title || lesson.title
      let path = '',
       fallback = false
      try {
       const resource = await zhiyun.resource(externalCourse, sub, kind, signal)
       path = await reserveFile(
        await directory(kind === 'transcript' ? '语音原文' : 'PPT', course.id),
        resource.filename.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
       )
       await zhiyun.download(resource.url, path, signal)
       if (kind === 'ppt' && extname(path).toLowerCase() === '.pptx') {
        try {
         const pages = await readImageDeck(path, signal)
         fallback = pages.every(p => {
          if (p.unavailable) return true
          const b = p.image.toBitmap()
          for (let i = 0; i < b.length; i += 4) if (b[i] >= 42 || b[i + 1] >= 42 || b[i + 2] >= 42) return false
          return true
         })
        } catch (error) {
         signal.throwIfAborted()
         if (!/纯图片型|编辑对象|旧版 PPT|分辨率|200 MB|500 页|多张图片/.test(String(error))) fallback = true
        }
       }
      } catch (error) {
       signal.throwIfAborted()
       if (kind !== 'ppt' || !/暂无可导出|未能生成PPT|PPT生成超时|文件格式暂不支持/.test(String(error))) throw error
       fallback = true
      }
      if (fallback) {
       if (!lesson.videoUrl) throw new Error('PPT 提取失败，且本课次暂无录像；已下载文件保留')
       videoProgress('智云课件无法读取或全黑，正在改用课程录像；全黑页未裁剪')
       const task = await videoPpt.create(title)
       await zhiyun.download(lesson.videoUrl, task.video, signal)
       const source = await videoPpt.prepare(task, signal)
       if (source.warning) throw new Error(source.warning + ' 视频已保留，可在视频提取页继续检查')
       const review = await videoPpt.extract(source.id, source.crop, defaultVideoPrompt, signal)
       if (review.warning) throw new Error(review.warning + ' 视频已保留，可继续检查')
       const result = await saveVideoPdf(
        source.id,
        course.name,
        review.pages.map(({page, keep, crop}) => ({page, keep, crop})),
        signal
       )
       const lecture = planned?.lectureId
        ? db.lecture(planned.lectureId)
        : db.detail(course.id).lectures.find(l => l.title === title) || db.createLecture(course.id, title, '', '', '')
       const generated = await parseCourseware(result.path)
       const generatedText = await serializeCoursewareSourceCache(
        result.path,
        generated.text,
        'local',
        generated.needsOcr,
        generated.omissions
       )
       db.db
        .prepare('UPDATE lectures SET ppt_path=?,ppt_text=?,ppt_processed=0 WHERE id=?')
        .run(result.path, generatedText, lecture.id)
       if (path) await rm(path, {force: true})
       return {path: result.path, lectureId: lecture.id, courseId: course.id, fromVideo: true}
      }
      try {
       const parsed = kind === 'transcript' ? await readTranscript(path) : await parseCourseware(path)
       const lecture = planned?.lectureId
        ? db.lecture(planned.lectureId)
        : db.detail(course.id).lectures.find(l => l.title === title) || db.createLecture(course.id, title, '', '', '')
       if (kind === 'transcript') {
        db.db
         .prepare('UPDATE lectures SET transcript_path=?,transcript_text=?,time_estimated=?,status=? WHERE id=?')
         .run(
          path,
          (parsed as Awaited<ReturnType<typeof readTranscript>>).text,
          (parsed as Awaited<ReturnType<typeof readTranscript>>).estimated ? 1 : 0,
          '待校订',
          lecture.id
         )
       } else {
        const courseware = parsed as Awaited<ReturnType<typeof parseCourseware>>
        const cachedText = await serializeCoursewareSourceCache(
         path,
         courseware.text,
         'local',
         courseware.needsOcr,
         courseware.omissions
        )
        db.db
         .prepare('UPDATE lectures SET ppt_path=?,ppt_text=?,ppt_processed=0 WHERE id=?')
         .run(path, cachedText, lecture.id)
       }
       db.db.prepare('DELETE FROM correction_checkpoints WHERE lecture_id=?').run(lecture.id)
       return {path, lectureId: lecture.id, courseId: course.id}
      } catch (error) {
       await rm(path, {force: true})
       throw error
      }
     })
    case 'library:list': {
     const courses = db.courses()
     return (await listLibrary(libraryRoot)).map(f => ({
      ...f,
      course: courses.find(c => folderName(c.name) === f.course)?.name || f.course
     }))
    }
    case 'library:open-file': {
     const path = await managedFile(libraryRoot, z.string().parse(object.path))
     if (!/\.(pdf|pptx?|docx?|txt|md|srt)$/i.test(path)) throw new Error('仅支持打开 PDF、课件和文档')
     const error = await shell.openPath(path)
     if (error) throw new Error('无法打开文件，请检查是否安装了 PDF 阅读器或 WPS')
     return true
    }
    case 'library:reveal': {
     const path = await managedFile(libraryRoot, z.string().parse(object.path))
     shell.showItemInFolder(path)
     return true
    }
    case 'library:delete': {
     if (jobs.size) throw new Error('请等待当前任务完成后再删除文件')
     if (object.confirmed !== true) throw new Error('请先确认删除文件')
     const path = await managedFile(libraryRoot, z.string().parse(object.path))
     await shell.trashItem(path)
     db.db.transaction(() => {
      for (const file of db.db.prepare('SELECT id,course_id FROM course_files WHERE path=?').all(path) as {
       id: string
       course_id: string
      }[])
       db.removeFile(file.course_id, file.id)
      db.db.prepare("UPDATE lectures SET ppt_path='',ppt_text='' WHERE ppt_path=?").run(path)
      db.db.prepare("UPDATE lectures SET transcript_path='',transcript_text='' WHERE transcript_path=?").run(path)
     })()
     db.db.pragma('wal_checkpoint(FULL)')
     return true
    }
    case 'cancel':
     for (const c of jobs.values()) c.abort()
     return true
    case 'job:current':
     return jobState()
    case 'settings:get':
     return settings.get()
    case 'appearance:get':
     return appearance.get()
    case 'appearance:save': {
     const cid = object.courseId ? z.string().uuid().parse(object.courseId) : undefined
     if (cid) db.course(cid)
     return appearance.save(object.value, cid)
    }
    case 'appearance:clear': {
     const cid = z.string().uuid().parse(object.courseId)
     db.course(cid)
     return appearance.clear(cid)
    }
    case 'appearance:image': {
     const selected = await dialog.showOpenDialog(window, {
      title: '选择聊天背景',
      properties: ['openFile'],
      filters: [{name: '背景图片', extensions: ['png', 'jpg', 'jpeg', 'webp']}]
     })
     if (selected.canceled || !selected.filePaths[0]) return null
     const path = selected.filePaths[0]
     if ((await stat(path)).size > 16 * 1024 * 1024) throw new Error('请选择小于 16 MB 的背景图片')
     let image = nativeImage.createFromBuffer(await readFile(path))
     if (image.isEmpty()) throw new Error('无法读取这张背景图片')
     const size = image.getSize()
     if (Math.max(size.width, size.height) > 1920)
      image = image.resize(size.width >= size.height ? {width: 1920} : {height: 1920})
     return 'data:image/jpeg;base64,' + image.toJPEG(85).toString('base64')
    }
    case 'identity:get':
     return identity.get()
    case 'identity:save':
     return identity.save(object.identity)
    case 'identity:avatar': {
     const selected = await dialog.showOpenDialog(window, {
      title: '选择头像',
      properties: ['openFile'],
      filters: [{name: '头像图片', extensions: ['png', 'jpg', 'jpeg', 'webp']}]
     })
     if (selected.canceled || !selected.filePaths[0]) return null
     const path = selected.filePaths[0]
     if ((await stat(path)).size > 5 * 1024 * 1024) throw new Error('请选择小于 5 MB 的头像图片')
     const avatar = nativeImage.createFromBuffer(await readFile(path))
     if (avatar.isEmpty()) throw new Error('无法读取这张图片，请选择 PNG、JPEG 或 WebP')
     const {width, height} = avatar.getSize(),
      side = Math.min(width, height)
     return avatar
      .crop({x: Math.floor((width - side) / 2), y: Math.floor((height - side) / 2), width: side, height: side})
      .resize({width: 256, height: 256})
      .toDataURL()
    }
    case 'settings:models':
     return job('qwen-models', async () => {
      const profile = settings.draft(object.profile as any)
      const models = await new Api(settings, net.fetch.bind(net)).models(profile)
      if (object.persist === true) settings.cacheModels(models)
      return models
     })
    case 'settings:probe':
     return job('test-qwen', async signal => {
      const profile = settings.draft(object.profile as any)
      return new Api(settings, net.fetch.bind(net)).chat(
       [{role: 'user', content: '请只回复：连接成功。'}],
       undefined,
       signal,
       profile
      )
     })
    case 'settings:save': {
     const next = object.settings as unknown as Settings,
      before = settings.connectionFingerprint()
     const changed =
      JSON.stringify(next.profiles.find(p => p.id === next.activeProfile) || next.profiles[0]) !==
      JSON.stringify(settings.get().profiles[0])
     if (changed && jobs.size) throw new Error('任务运行中，请完成或取消后再更换模型连接')
     const saved = settings.save(next)
     if (toolsBackend.started && before !== visualConnection())
      await toolsBackend.request('configure', {
       connection: visualConnection(),
       model: saved.profiles.find(item => item.id === saved.activeProfile)?.model || '未配置'
      })
     return saved
    }
    case 'settings:test':
     return job('test-qwen', signal => api.chat([{role: 'user', content: '请回复“连接成功”。'}], undefined, signal))
    case 'export': {
     const detail = db.lectureDetail(id()),
      kind = z.enum(['subtitles', 'notes', 'practice', 'evidence-bundle']).parse(object.kind),
      format = z.string().parse(object.format)
     validateExportFormat(kind, format)
     return exportFile(
      detail,
      kind,
      format,
      await directory(kind === 'practice' ? '历年卷' : '笔记', detail.lecture.course_id),
      kind === 'evidence-bundle' ? db.course(detail.lecture.course_id) : undefined
     )
    }
    case 'external': {
     const url = new URL(z.string().parse(object.url))
     if (!['http:', 'https:'].includes(url.protocol)) throw new Error('只允许网页链接')
     await shell.openExternal(url.href)
     return true
    }
    default:
     throw new Error('未知操作')
   }
  }
 }
}
