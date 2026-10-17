import {BrowserWindow, WebContentsView} from 'electron'
export class ZhiyunBrowser {
 private view: WebContentsView | null = null
 constructor(
  private window: BrowserWindow,
  private error: (message: string) => void
 ) {}
 private ensure() {
  if (this.view) return this.view
  const view = new WebContentsView({
   webPreferences: {partition: 'persist:zhiyun', contextIsolation: true, nodeIntegration: false, sandbox: true}
  })
  this.view = view
  view.setVisible(false)
  this.window.contentView.addChildView(view)
  const allowed = (value: string) => {
   try {
    const u = new URL(value)
    return u.protocol === 'https:' && /(^|\.)zju\.edu\.cn$/.test(u.hostname)
   } catch {
    return false
   }
  }
  view.webContents.setWindowOpenHandler(({url}) => {
   if (allowed(url)) void view.webContents.loadURL(url).catch(() => this.error('网页无法打开，请刷新重试'))
   return {action: 'deny'}
  })
  view.webContents.on('will-navigate', (event, url) => {
   if (!allowed(url)) event.preventDefault()
  })
  view.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  void view.webContents
   .loadURL('https://onlineroom.cmc.zju.edu.cn/')
   .catch(() => this.error('智云课堂无法打开，请检查网络后刷新'))
  return view
 }
 bounds(bounds: {x: number; y: number; width: number; height: number}, visible: boolean) {
  if (!visible) {
   this.view?.setVisible(false)
   return
  }
  const view = this.ensure()
  view.setBounds({
   x: Math.max(0, Math.round(bounds.x)),
   y: Math.max(0, Math.round(bounds.y)),
   width: Math.max(0, Math.round(bounds.width)),
   height: Math.max(0, Math.round(bounds.height))
  })
  view.setVisible(true)
 }
 refresh() {
  this.ensure().webContents.reload()
 }
 home() {
  return this.ensure().webContents.loadURL('https://onlineroom.cmc.zju.edu.cn/')
 }
 back() {
  const history = this.ensure().webContents.navigationHistory
  if (history.canGoBack()) history.goBack()
 }
 dispose() {
  this.view?.webContents.close()
 }
}
