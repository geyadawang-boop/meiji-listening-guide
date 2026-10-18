import {BrowserWindow} from 'electron'
import {join} from 'node:path'

/** 主窗口：Windows/Linux 无边框自绘标题栏；macOS 隐藏标题栏但保留红绿灯。 */
export function createMainWindow({mainDir, icon}: {mainDir: string; icon: string}) {
 const window = new BrowserWindow({
  width: 1500,
  height: 950,
  minWidth: 1050,
  minHeight: 700,
  title: '摘云',
  icon,
  backgroundColor: '#f9fafb',
  ...(process.platform === 'darwin' ? {titleBarStyle: 'hiddenInset' as const} : {frame: false}),
  webPreferences: {
   preload: join(mainDir, '../preload/preload.cjs'),
   contextIsolation: true,
   nodeIntegration: false,
   sandbox: true
  }
 })
 window.webContents.setWindowOpenHandler(() => ({action: 'deny'}))
 window.webContents.on('will-navigate', e => e.preventDefault())
 return window
}
