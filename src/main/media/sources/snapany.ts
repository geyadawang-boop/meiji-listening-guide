import {BrowserWindow, net, session} from 'electron'
import {bilibiliUrl, videoMediaUrl} from '@main/media/bilibili/video-policy'
import {downloadVideoMedia} from '@main/media/sources/video-download'

export async function snapanyDownload(
 parent: BrowserWindow,
 input: string,
 destination: string,
 progress: (text: string) => void,
 signal: AbortSignal
) {
 const url = bilibiliUrl(input),
  ses = session.fromPartition('persist:snapany-video')
 ses.setPermissionRequestHandler((_wc, _p, cb) => cb(false))
 const win = new BrowserWindow({
  show: false,
  width: 1100,
  height: 850,
  title: 'SnapAny · 后台解析',
  webPreferences: {
   session: ses,
   nodeIntegration: false,
   contextIsolation: true,
   sandbox: true,
   backgroundThrottling: false
  }
 })
 const media = await new Promise<string>((resolve, reject) => {
  let finished = false,
   timer: ReturnType<typeof setInterval>,
   timeout: ReturnType<typeof setTimeout>
  function finish(value?: string, error?: Error) {
   if (finished) return
   finished = true
   clearInterval(timer)
   clearTimeout(timeout)
   signal.removeEventListener('abort', abort)
   win.removeListener('closed', closed)
   if (!win.isDestroyed()) win.close()
   error ? reject(error) : resolve(value!)
  }
  const abort = () => finish(undefined, new Error('任务已取消')),
   closed = () => finish(undefined, new Error('下载窗口已关闭，可以重试'))
  signal.addEventListener('abort', abort, {once: true})
  win.once('closed', closed)
  const allowed = (s: string) => {
   try {
    return new URL(s).origin === 'https://snapany.com'
   } catch {
    return false
   }
  }
  win.webContents.setWindowOpenHandler(({url}) => {
   if (videoMediaUrl(url)) finish(url)
   else if (allowed(url))
    void win.loadURL(url).catch(() => finish(undefined, new Error('后台解析页面无法打开，请检查网络后重试')))
   return {action: 'deny'}
  })
  win.webContents.on('will-navigate', (e, url) => {
   if (videoMediaUrl(url)) {
    e.preventDefault()
    finish(url)
   } else if (!allowed(url)) e.preventDefault()
  })
  // Background website session only. Never show or focus this window. The
  // website has no preload or access to assistant IPC or local account files.
  const fill = `(()=>{if(window.__meiPrefilled)return;const input=[...document.querySelectorAll('textarea,input:not([type]),input[type=url],input[type=text]')].find(e=>e.getBoundingClientRect().width>0);const button=[...document.querySelectorAll('button,[role=button]')].find(b=>b.textContent.includes('提取视频'));if(!input||!button)return;const setter=Object.getOwnPropertyDescriptor(input instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set;setter.call(input,${JSON.stringify(url)});input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));window.__meiPrefilled=true;button.click()})()`
  const scriptFailed = () =>
   finish(undefined, new Error('SnapAny 后台页面解析失败，网页结构可能已变化，请重试或导入已下载的视频'))
  win.webContents.once('did-finish-load', () => {
   void win.webContents.executeJavaScript(fill).catch(scriptFailed)
  })
  let polling = false
  timer = setInterval(() => {
   if (finished || polling || win.isDestroyed()) return
   polling = true
   void win.webContents
    .executeJavaScript(
     fill +
      `;(()=>{const links=[...document.querySelectorAll('a[href],video,source')].map(e=>e.href||e.currentSrc||e.src).filter(Boolean);if(!window.__meiDownloadClicked&&/720[Pp]|480[Pp]|360[Pp]/.test(document.body.innerText)){const b=[...document.querySelectorAll('button,[role=button]')].find(e=>e.textContent.trim()==='下载视频');if(b){window.__meiDownloadClicked=true;b.click()}}return links})()`
    )
    .then((links: string[]) => {
     const found = links.find(videoMediaUrl)
     if (found) finish(found)
    })
    .catch(scriptFailed)
    .finally(() => {
     polling = false
    })
  }, 1500)
  timeout = setTimeout(
   () => finish(undefined, new Error('SnapAny 暂未返回视频链接，网站可能需要验证；请稍后重试或导入已下载的视频')),
   3 * 60 * 1000
  )
  progress('正在后台通过 SnapAny 解析视频网址')
  void win
   .loadURL('https://snapany.com/zh/bilibili')
   .catch(() => finish(undefined, new Error('无法打开 SnapAny，请检查网络后重试')))
  if (signal.aborted) abort()
 })
 signal.throwIfAborted()
 progress('已取得视频链接，正在下载到本次任务目录')
 await downloadVideoMedia(media, destination, (url, init) => net.fetch(url, init), progress, signal)
}
