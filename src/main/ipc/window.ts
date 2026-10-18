import type {ApplicationContext} from '@main/app/context'
import type {IpcHandler} from '@main/ipc/handler'

export function createWindowHandler(context: Pick<ApplicationContext, 'window'>): IpcHandler {
 return {
  actions: new Set(['window:minimize', 'window:toggle-maximize', 'window:close', 'window:is-maximized']),
  async invoke(action: string) {
   const {window} = context
   switch (action) {
    case 'window:minimize':
     window.minimize()
     return null
    case 'window:toggle-maximize':
     if (window.isMaximized()) window.unmaximize()
     else window.maximize()
     return window.isMaximized()
    case 'window:close':
     window.close()
     return null
    case 'window:is-maximized':
     return window.isMaximized()
    default:
     throw new Error('未知操作')
   }
  }
 }
}
