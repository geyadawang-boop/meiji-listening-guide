import {dispatch} from './ipc/handler'
import {RuntimeComponents} from './runtime-components'
import {diagnostic} from './diagnostics'
import {createKnowledgeHandler} from './ipc/knowledge'
import {createCoursewareHandler} from './ipc/courseware'
import {createResourcesHandler} from './ipc/resources'
import {createResearchHandler} from './ipc/research'
import {createStudyHandler} from './ipc/study'
import {createDesktopHandler} from './ipc/desktop'
import {createCoursesHandler} from './ipc/courses'
import {createLearningHandler} from './ipc/learning'
import {AppearanceStore} from './appearance'
import {KnowledgeBase} from './knowledge'
import {MediaBackend} from './media'
import {NativeResearchBackend} from './research'
import {VisualTasks} from './visual'
import {SubtitleSync, subtitleLocator} from './subtitle-sync'
import {SubtitleDerived} from './subtitle-derived'
import {BiliResources} from './bili-resources'
import {BiliDiscussion} from './bili-discussion'
import {PptExtractor} from './ppt-extract'
import {TextbookHighlighter} from './study'
import {VideoPpt} from './video-ppt'
import {readBiliSubtitles} from './bili-subtitles'
import {transcribeLocalVideo} from './local-asr'
import {summarizeVideo, summaryMode} from './video-summary'
import type {VideoSeries} from '../shared/video-ppt'
import {bilibiliUrl} from './video-policy'
import {IdentityStore} from './identity'
import {app, BrowserWindow, dialog, ipcMain, net, session} from 'electron'
import {join, extname, dirname, basename} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'
import {readFile, writeFile, rm} from 'node:fs/promises'
import {z} from 'zod'
import {Store} from './db'
import {openPortableLibrary} from './portable-library'
import {searchAnswers} from './practice-answer'
import {SettingsStore} from './settings'
import {Api} from './api'
import {CodexClient} from './codex'
import {modelRouter} from './model-router'
import {validateDeepSeek} from './deepseek'
import {Workflows} from './workflows'
import {type EventPayload} from '../shared/types'
import {parseSrt} from '../shared/srt'
import {markdown} from './exports'
import {ensureLibrary, libraryDirectory, folderName, reserveFile} from './library'
import {managedFile} from './file-manager'
import {Zhiyun} from './zhiyun'
import {ZhiyunBrowser} from './zhiyun-browser'
import {verifyGeneratedPdf} from './pdf-ppt-cleanup'
const mainDir = fileURLToPath(new URL('.', import.meta.url))
let store: Store | undefined, mainWindow: BrowserWindow | undefined
let shutdownBackends: (() => Promise<void>) | undefined,
 quitting = false
const jobs = new Map<string, AbortController>()
function showMainWindow() {
 if (mainWindow && !mainWindow.isDestroyed()) {
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
 }
}
app.setPath('userData', process.env.LISTENING_ASSISTANT_DATA || join(app.getPath('appData'), 'listening-assistant'))
if (!app.requestSingleInstanceLock()) app.quit()
else
 app
  .whenReady()
  .then(startApplication)
  .catch(error => {
   dialog.showErrorBox('梅酱的听课指南启动失败', error instanceof Error ? error.message : '未知错误')
   app.quit()
  })
async function startApplication() {
 const root = app.getPath('userData')
 const runtime = new RuntimeComponents(
  app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources'),
  app.getVersion()
 )
 diagnostic(root, 'application', 'startup', {code: app.getVersion()})
 const portable =
  process.env.LISTENING_ASSISTANT_DATA && !process.env.LISTENING_ASSISTANT_PORTABLE_TEST
   ? null
   : await openPortableLibrary(
      process.env.LISTENING_ASSISTANT_PORTABLE_TEST || (app.isPackaged ? dirname(process.execPath) : app.getAppPath()),
      root,
      process.env.LISTENING_ASSISTANT_PORTABLE_TEST
       ? join(root, '资料')
       : join(app.getPath('documents'), '听课助手资料')
     )
 store = portable?.store || new Store(root)
 const db = store,
  settings = new SettingsStore(root),
  identity = new IdentityStore(root),
  appearance = new AppearanceStore(root)
 const libraryRoot = portable?.libraryRoot || join(root, '资料')
 await ensureLibrary(
  libraryRoot,
  db.courses().map(c => c.name)
 )
 const directory = (category: 'PPT' | '语音原文' | '笔记' | '历年卷', courseId: string) =>
  libraryDirectory(libraryRoot, category, db.course(courseId).name)
 const saveNoteFile = async (lectureId: string) => {
  const detail = db.lectureDetail(lectureId)
  await writeFile(
   join(
    await directory('笔记', detail.lecture.course_id),
    folderName(detail.lecture.title) + '-' + lectureId + '-听课笔记.md'
   ),
   markdown(detail, 'notes'),
   'utf8'
  )
 }
 db.db
  .prepare("UPDATE lectures SET status='上次任务中断，可继续校订' WHERE status='预处理中' OR status LIKE '校订中%'")
  .run()
 const window = new BrowserWindow({
  width: 1500,
  height: 950,
  minWidth: 1050,
  minHeight: 700,
  title: '梅酱的听课指南',
  icon: join(app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources'), 'icon.png'),
  backgroundColor: '#f9fafb',
  webPreferences: {
   preload: join(mainDir, '../preload/preload.cjs'),
   contextIsolation: true,
   nodeIntegration: false,
   sandbox: true
  }
 })
 mainWindow = window
 const emit = (e: EventPayload) => {
  if (!window.isDestroyed()) window.webContents.send('assistant:event', e)
 }
 const zhiyunSession = session.fromPartition('persist:zhiyun')
 const zhiyunBrowser = new ZhiyunBrowser(window, message =>
  emit({kind: 'progress', data: {stage: '智云登录', message, error: true}})
 )
 const zhiyun = new Zhiyun(
  async (url, init) => {
   const headers = new Headers(init?.headers)
   if (new URL(url).origin === 'https://onlineroom.cmc.zju.edu.cn') {
    // Reuse the website's own session internally; credentials never enter renderer data or logs.
    const cookie = (await zhiyunSession.cookies.get({url: 'https://onlineroom.cmc.zju.edu.cn'})).find(
     c => c.name === '_token'
    )
    if (cookie) {
     let value = cookie.value
     try {
      value = decodeURIComponent(value)
     } catch {}
     const token = /{i:\d+;s:\d+:"_token";i:\d+;s:\d+:"(.+?)";}/.exec(value)?.[1]
     if (token) headers.set('Authorization', 'Bearer ' + token)
    }
   }
   return zhiyunSession.fetch(url, {...init, headers})
  },
  message => emit({kind: 'progress', data: {stage: '智云课堂', message}})
 )
 const codex = new CodexClient(
  process.env.LISTENING_ASSISTANT_CODEX_FIXTURE && process.env.LISTENING_ASSISTANT_DATA
   ? process.execPath
   : join(app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources'), 'codex', 'bin', 'codex.exe'),
  join(root, 'codex-account'),
  join(root, 'codex-workspace'),
  settings,
  message => emit({kind: 'progress', data: {stage: 'Codex', message}}),
  process.env.LISTENING_ASSISTANT_CODEX_FIXTURE && process.env.LISTENING_ASSISTANT_DATA
   ? [process.env.LISTENING_ASSISTANT_CODEX_FIXTURE]
   : []
 )
 const deepseek = new CodexClient(
  process.env.LISTENING_ASSISTANT_CODEX_FIXTURE && process.env.LISTENING_ASSISTANT_DATA
   ? process.execPath
   : join(app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources'), 'codex', 'bin', 'codex.exe'),
  join(root, 'deepseek-account'),
  join(root, 'deepseek-workspace'),
  settings,
  message => emit({kind: 'progress', data: {stage: 'DeepSeek', message: message.replace(/Codex/g, 'DeepSeek')}}),
  process.env.LISTENING_ASSISTANT_CODEX_FIXTURE && process.env.LISTENING_ASSISTANT_DATA
   ? [process.env.LISTENING_ASSISTANT_CODEX_FIXTURE]
   : [],
  () => validateDeepSeek(settings.profile())
 )
 const routed = modelRouter(() => (settings.get().connection === 'deepseek' ? deepseek : codex))
 const testApi =
  process.env.LISTENING_ASSISTANT_TEST_API === '1' && process.env.LISTENING_ASSISTANT_DATA
   ? new Api(settings, net.fetch.bind(net))
   : undefined
 const api = testApi || routed
 const knowledge = new KnowledgeBase(
  app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources'),
  join(libraryRoot, '知识库数据'),
  message => emit({kind: 'progress', data: {stage: '知识库', message}})
 )
 const visualConnection = () => {
  const value = settings.get(),
   connection = value.connection || 'codex',
   profile = value.profiles.some(item => item.id === value.activeProfile) ? settings.profile() : null
  return createHash('sha256')
   .update(JSON.stringify([connection, !testApi && connection === 'codex' ? value.codex : profile]))
   .digest('hex')
 }
 const toolsBackend = new NativeResearchBackend(
  join(libraryRoot, '知识库数据'),
  async (request, signal) => {
   if (request.connection !== visualConnection()) throw new Error('模型配置已改变，旧研究任务停止')
   return api.chat(
    [
     {role: 'system', content: request.system},
     {role: 'user', content: request.user}
    ],
    undefined,
    signal
   )
  },
  app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources')
 )
 const subtitleSync = new SubtitleSync(join(libraryRoot, '字幕同步记录'), libraryRoot)
 const subtitleDerived = new SubtitleDerived(join(libraryRoot, '笔记生成记录'), libraryRoot)
 const biliSession = session.fromPartition('persist:meijiang-bili-resources')
 biliSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
 const biliFixture =
  process.env.LISTENING_ASSISTANT_DATA &&
  /^http:\/\/127\.0\.0\.1:\d+$/.test(process.env.LISTENING_ASSISTANT_BILI_FIXTURE || '')
   ? process.env.LISTENING_ASSISTANT_BILI_FIXTURE
   : undefined
 const biliResources = new BiliResources(
  biliFixture
   ? (url, init) => {
      const target = new URL(url)
      return fetch(biliFixture + target.pathname + target.search, {...init, credentials: 'omit'})
     }
   : (biliSession.fetch.bind(biliSession) as typeof fetch)
 )
 const media = new MediaBackend(
  app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources'),
  join(libraryRoot, '媒体下载'),
  biliResources
 )
 const visual = new VisualTasks(join(libraryRoot, '画面识别成果'), media)
 const biliDiscussion = new BiliDiscussion(
  biliResources,
  biliFixture
   ? (url, init) => {
      const target = new URL(url)
      return fetch(biliFixture + target.pathname + target.search, {...init, credentials: 'omit'})
     }
   : (biliSession.fetch.bind(biliSession) as typeof fetch),
  join(libraryRoot, '媒体下载')
 )
 const answerDependencies = {
  search: async (query: string, signal?: AbortSignal) => {
   let key = ''
   try {
    key = settings.searchKey()
   } catch {}
   return searchAnswers(query, key, net.fetch.bind(net) as typeof fetch, signal)
  },
  json: api.json.bind(api),
  progress: (message: string) => emit({kind: 'progress', data: {stage: '题目答案', message}})
 }
 const flows = new Workflows(db, settings, api, p => emit({kind: 'progress', data: p}), answerDependencies, !!testApi)
 const highlighter = new TextbookHighlighter(api, (input, url, signal) =>
  routed.chat(
   [
    {role: 'system', content: '识别教材图片的可编辑划线位置，严格返回用户要求的 JSON。'},
    {role: 'user', content: input}
   ],
   undefined,
   signal,
   undefined,
   undefined,
   {images: [{label: '教材原页', url}]}
  )
 )
 window.webContents.setWindowOpenHandler(() => ({action: 'deny'}))
 window.webContents.on('will-navigate', e => e.preventDefault())
 const idSchema = z.string().uuid()
 const pptExtractor = new PptExtractor(routed, message => emit({kind: 'progress', data: {stage: '截取 PPT', message}}))
 const videoProgress = (message: string) => emit({kind: 'progress', data: {stage: '视频提取 PPT', message}})
 const videoPpt = new VideoPpt(join(libraryRoot, '视频提取临时任务'), routed, videoProgress)
 async function saveVideoPdf(
  videoId: string,
  selectedCourse: string | undefined,
  choices: Parameters<VideoPpt['export']>[1],
  signal: AbortSignal
 ) {
  videoProgress('正在生成 PDF 并逐页检查图片像素')
  const result = await videoPpt.export(videoId, choices, signal),
   path = await reserveFile(
    await libraryDirectory(libraryRoot, 'PPT', selectedCourse),
    folderName(result.sourceName.replace(/\.(mp4|mkv|mov|webm)$/i, '')) + '-视频课件.pdf'
   )
  try {
   await writeFile(path, result.buffer)
   signal.throwIfAborted()
   verifyGeneratedPdf(await readFile(path), result.kept)
  } catch (error) {
   await rm(path, {force: true})
   throw error
  }
  let cleaned = false,
   cleanupWarning = ''
  try {
   await videoPpt.cleanup(videoId, path, result.buffer, result.kept)
   cleaned = true
  } catch (error) {
   cleanupWarning = error instanceof Error ? error.message : '清理失败，视频和临时文件已保留'
  }
  videoProgress(cleaned ? 'PDF 已保存并检查成功，视频和临时文件已清理' : 'PDF 已保存，临时文件清理需要重试')
  return {path, kept: result.kept, removed: result.removed, cleaned, cleanupWarning}
 }
 async function saveTranscribedVideo(
  task: {
   id: string
   dir: string
   video: string
   name: string
  },
  name: string,
  selectedCourse: string | undefined,
  signal: AbortSignal,
  page = 1
 ) {
  const transcript = await transcribeLocalVideo(task.video, signal, videoProgress)
  const path = await reserveFile(await libraryDirectory(libraryRoot, '语音原文', selectedCourse), name)
  try {
   await writeFile(path, transcript.srt, 'utf8')
   if ((await readFile(path, 'utf8')) !== transcript.srt) throw new Error('保存字幕后校验失败')
   await videoPpt.markSubtitleSaved(task.id, path)
  } catch (error) {
   await rm(path, {force: true})
   throw error
  }
  let cleanupWarning = ''
  try {
   await transcript.cleanup()
   await videoPpt.discardCompleted(task.id)
  } catch (error) {
   cleanupWarning = '字幕已保存，但临时视频清理失败：' + (error instanceof Error ? error.message : String(error))
  }
  videoProgress(cleanupWarning ? '字幕已保存，临时视频需要手动检查' : '字幕已保存并检查，临时视频已清理')
  return {
   title: folderName(basename(task.name, extname(task.name))),
   page,
   source: '本地 Whisper 转写',
   warning: '自动转写可能有错，请核对后作为课堂原文使用。' + cleanupWarning,
   cleanupWarning,
   srt: transcript.srt,
   count: transcript.count,
   savedPath: path
  }
 }
 async function job<T>(key: string, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  if (jobs.size) throw new Error('当前已有任务运行，请等待完成或取消')
  const controller = new AbortController()
  jobs.set(key, controller)
  try {
   return await fn(controller.signal)
  } catch (error) {
   const message = controller.signal.aborted ? '任务已取消' : error instanceof Error ? error.message : '任务失败'
   emit({
    kind: 'progress',
    data: {lectureId: key.startsWith('lecture:') ? key.slice(8) : undefined, stage: '任务停止', message, error: true}
   })
   throw new Error(message)
  } finally {
   jobs.delete(key)
  }
 }
 const pick = async (kind: string, course?: string) => {
  const extensions =
   kind === 'srt'
    ? ['srt']
    : kind === 'transcript'
      ? ['docx', 'txt', 'md', 'srt']
      : kind === 'courseware'
        ? ['ppt', 'pptx', 'pdf', 'docx', 'txt', 'md']
        : ['pdf', 'docx', 'txt', 'md']
  const category = kind === 'transcript' ? '语音原文' : kind === 'courseware' ? 'PPT' : '笔记'
  const result = await dialog.showOpenDialog(window, {
   defaultPath: await libraryDirectory(libraryRoot, category, course ? db.course(course).name : undefined),
   properties: kind === 'srt' || kind === 'transcript' ? ['openFile'] : ['openFile', 'multiSelections'],
   filters: [{name: kind === 'transcript' ? '语音识别原文' : '资料', extensions}]
  })
  return result.canceled ? [] : result.filePaths
 }
 const videoSeriesCache = new Map<string, VideoSeries>()
 const fetchBiliSubtitle = (url: string, signal: AbortSignal) => {
  const ses = biliSession
  const userAgent = ses.getUserAgent().replace(/\s+(?:Electron|listening-assistant)\/\S+/g, '')
  return readBiliSubtitles(
   url,
   (target, init) => {
    const headers = new Headers(init?.headers)
    headers.set('User-Agent', userAgent)
    if (biliFixture) {
     const address = new URL(target)
     return fetch(biliFixture + address.pathname + address.search, {...init, headers, credentials: 'omit'})
    }
    return ses.fetch(target, {
     ...init,
     headers,
     credentials: new URL(target).hostname === 'api.bilibili.com' ? 'include' : 'omit'
    })
   },
   signal
  )
 }
 const saveBiliSubtitle = async (url: string, title: string, srt: string, selectedCourse: string | undefined) => {
  const parsed = new URL(bilibiliUrl(url))
  parseSrt(srt)
  const name =
   parsed.pathname.split('/').filter(Boolean).at(-1) +
   '-P' +
   (parsed.searchParams.get('p') || '1') +
   '-' +
   folderName(title) +
   '.srt'
  const path = await reserveFile(await libraryDirectory(libraryRoot, '语音原文', selectedCourse), name)
  try {
   await writeFile(path, srt, 'utf8')
   if ((await readFile(path, 'utf8')) !== srt) throw new Error('字幕保存校验失败')
  } catch (error) {
   await rm(path, {force: true})
   throw error
  }
  return path
 }
 const syncDependencies = (selectedCourse: string | undefined) => ({
  progress: videoProgress,
  generation: (url: string) => knowledge.generation(url),
  acquire: async (
   item: {
    url: string
    title: string
   },
   signal: AbortSignal
  ) => {
   // Sync does not silently download a long video. Missing subtitles remain
   // retryable; the existing offline-transcription button is a separate choice.
   const subtitle = await fetchBiliSubtitle(item.url, signal)
   const digest = createHash('sha256').update(subtitle.srt).digest('hex')
   const prior = (await subtitleSync.list())
    .flatMap(task => (task.courseName === selectedCourse ? task.items : []))
    .find(row => row.url === item.url && row.hash === digest && row.path)
   if (prior?.path) {
    try {
     const path = await managedFile(libraryRoot, prior.path)
     if ((await readFile(path, 'utf8')) === subtitle.srt) return {path, srt: subtitle.srt}
    } catch {
     /* A missing previous output needs a new verified file. */
    }
   }
   return {srt: subtitle.srt, path: await saveBiliSubtitle(item.url, item.title, subtitle.srt, selectedCourse)}
  },
  publish: (
   item: {
    url: string
    title: string
    page: number
    sourceMethod?: string
    generation?: string | null
   },
   srt: string,
   category: string,
   signal: AbortSignal
  ) =>
   knowledge.importSubtitle(
    subtitleLocator(item.url),
    `P${item.page} · ${item.title}`,
    srt,
    category,
    signal,
    item.sourceMethod,
    item.generation
   )
 })
 const derivedDependencies = {
  generation: (url: string) => knowledge.generation(url),
  summarize: (srt: string, mode: z.infer<typeof summaryMode>, signal: AbortSignal) =>
   summarizeVideo(
    srt,
    mode,
    (prompt, input, active) => api.json(prompt, input, value => value, active),
    videoProgress,
    signal
   ),
  progress: videoProgress
 }
 const context = {
  runtime,
  answerDependencies,
  api,
  appearance,
  biliFixture,
  biliDiscussion,
  biliResources,
  biliSession,
  codex,
  db,
  deepseek,
  derivedDependencies,
  directory,
  emit,
  fetchBiliSubtitle,
  flows,
  highlighter,
  idSchema,
  identity,
  job,
  jobs,
  knowledge,
  libraryRoot,
  media,
  pick,
  pptExtractor,
  root,
  routed,
  saveBiliSubtitle,
  saveNoteFile,
  saveTranscribedVideo,
  saveVideoPdf,
  settings,
  subtitleDerived,
  subtitleSync,
  syncDependencies,
  testApi,
  toolsBackend,
  videoPpt,
  videoProgress,
  videoSeriesCache,
  visual,
  visualConnection,
  window,
  zhiyun,
  zhiyunBrowser
 }
 const handlers = [
  createKnowledgeHandler(context),
  createCoursewareHandler(context),
  createResourcesHandler(context),
  createResearchHandler(context),
  createStudyHandler(context),
  createDesktopHandler(context),
  createCoursesHandler(context),
  createLearningHandler(context)
 ]
 ipcMain.handle('assistant:invoke', async (event, action: string, args: unknown) => {
  if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame)
   throw new Error('拒绝未知页面请求')
  const object = z.record(z.string(), z.unknown()).parse(args || {})
  const validated = z.string().min(1).max(100).parse(action)
  try {
   return await dispatch(handlers, validated, object)
  } catch (error) {
   diagnostic(root, 'ipc', 'request-failed', {
    action: validated,
    code: error instanceof z.ZodError ? 'INPUT_INVALID' : jobs.size ? 'TASK_FAILED' : 'REQUEST_FAILED'
   })
   throw error
  }
 })
 if (process.env.ELECTRON_RENDERER_URL) await window.loadURL(process.env.ELECTRON_RENDERER_URL)
 else await window.loadFile(join(mainDir, '../renderer/index.html'))
 showMainWindow()
 shutdownBackends = async () => {
  for (const c of jobs.values()) c.abort()
  knowledge.dispose()
  zhiyunBrowser.dispose()
  await Promise.allSettled([media.dispose(), toolsBackend.dispose()])
  codex.dispose()
  deepseek.dispose()
 }
 return context
}
export type ApplicationContext = Awaited<ReturnType<typeof startApplication>>
app.on('before-quit', event => {
 if (shutdownBackends && !quitting) {
  event.preventDefault()
  quitting = true
  void shutdownBackends().finally(() => app.quit())
 }
})
app.on('window-all-closed', () => app.quit())
app.on('second-instance', showMainWindow)
app.on('activate', showMainWindow)
app.on('will-quit', () => {
 store?.close()
})
