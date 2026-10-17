import {contextBridge, ipcRenderer, webUtils} from 'electron'
import type {EventPayload, Bridge} from '@shared/types'
const bridge: Bridge = {
 invoke: (action, args) => ipcRenderer.invoke('assistant:invoke', action, args),
 onEvent(callback) {
  const handler = (_event: Electron.IpcRendererEvent, data: EventPayload) => callback(data)
  ipcRenderer.on('assistant:event', handler)
  return () => ipcRenderer.removeListener('assistant:event', handler)
 },
 filePath: file => webUtils.getPathForFile(file)
}
contextBridge.exposeInMainWorld('assistant', bridge)
