import {BrowserWindow, session} from 'electron'
import {bilibiliUrl} from '@main/media/bilibili/video-policy'
import type {VideoEpisode, VideoSeries} from '@shared/video-ppt'

export function parseVideoSeries(input: string, value: unknown): VideoSeries {
 const url = new URL(bilibiliUrl(input)),
  v = value as {title?: unknown; pages?: unknown}
 if (!v || !Array.isArray(v.pages) || !v.pages.length || v.pages.length > 1000)
  throw new Error('未能读取视频分集目录，请稍后重试')
 const episodes: VideoEpisode[] = v.pages.map((p: {page?: unknown; part?: unknown; duration?: unknown}, i) => {
  if (p.page !== i + 1 || typeof p.part !== 'string' || !p.part.trim())
   throw new Error('视频分集目录不完整，请重新读取')
  const part = new URL(url)
  part.searchParams.set('p', String(i + 1))
  return {
   page: i + 1,
   title: p.part.trim().slice(0, 200),
   duration: typeof p.duration === 'number' && Number.isFinite(p.duration) ? Math.max(0, p.duration) : 0,
   url: part.href
  }
 })
 return {
  title: typeof v.title === 'string' ? v.title.slice(0, 200) : url.pathname.split('/').filter(Boolean).at(-1)!,
  episodes
 }
}

export async function readVideoSeries(input: string, signal: AbortSignal): Promise<VideoSeries> {
 const url = new URL(bilibiliUrl(input))
 url.hostname = 'www.bilibili.com'
 const pageUrl = new URL(url)
 pageUrl.search = ''
 const ses = session.fromPartition('bilibili-directory')
 ses.setPermissionRequestHandler((_w, _p, cb) => cb(false))
 signal.throwIfAborted()
 const userAgent = ses.getUserAgent().replace(/\s+(?:Electron|listening-assistant)\/\S+/g, '')
 // Public part-directory endpoint avoids depending on video-player hydration.
 const videoId = url.pathname.split('/').filter(Boolean).at(-1)!,
  api = new URL('https://api.bilibili.com/x/player/pagelist')
 api.searchParams.set(videoId.startsWith('BV') ? 'bvid' : 'aid', videoId.startsWith('BV') ? videoId : videoId.slice(2))
 try {
  const response = await ses.fetch(api.href, {
   credentials: 'omit',
   redirect: 'error',
   headers: {'User-Agent': userAgent, Referer: 'https://www.bilibili.com/'},
   signal: AbortSignal.any([signal, AbortSignal.timeout(20000)])
  })
  if (response.ok) {
   const result = (await response.json()) as {
    code?: number
    data?: Array<{page: number; part: string; duration: number}>
   }
   if (result.code === 0 && Array.isArray(result.data) && result.data.length) {
    const first = result.data[0].part,
     title = typeof first === 'string' ? first.replace(/^\d+[.、\s]+/, '').split('-')[0] : videoId
    return parseVideoSeries(url.href, {title, pages: result.data})
   }
  }
 } catch {
  signal.throwIfAborted()
 }
 const win = new BrowserWindow({
  show: false,
  webPreferences: {
   session: ses,
   nodeIntegration: false,
   contextIsolation: true,
   sandbox: true,
   backgroundThrottling: false
  }
 })
 win.webContents.setUserAgent(userAgent)
 win.webContents.setWindowOpenHandler(() => ({action: 'deny'}))
 win.webContents.on('will-navigate', (e, target) => {
  if (new URL(target).origin !== 'https://www.bilibili.com') e.preventDefault()
 })
 const abort = () => {
  if (!win.isDestroyed()) win.close()
 }
 signal.addEventListener('abort', abort, {once: true})
 try {
  await win.loadURL(pageUrl.href)
  for (let attempt = 0; attempt < 15; attempt++) {
   signal.throwIfAborted()
   const state = await win.webContents.executeJavaScript(
    `(()=>{const v=window.__INITIAL_STATE__?.videoData;return v?.pages?.length?{title:v.title,pages:v.pages}:null})()`
   )
   if (state) return parseVideoSeries(url.href, state)
   await new Promise<void>(resolve => setTimeout(resolve, 1000))
  }
  throw new Error('视频页面暂未提供分集目录')
 } catch (e) {
  signal.throwIfAborted()
  throw new Error('无法读取课程列表，请检查网络或稍后重试。' + (e instanceof Error ? e.message : ''))
 } finally {
  signal.removeEventListener('abort', abort)
  if (!win.isDestroyed()) win.close()
 }
}
