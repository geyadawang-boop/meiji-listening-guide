import {spawn} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {mediaExecutablePath, type MediaTool} from '@main/media/tools/media-executable'
/** The guardian owns the OS child handle; IPC disconnect kills FFmpeg even if the caller is terminated. */
export function mediaCommand(
 resources: string,
 name: MediaTool,
 args: string[],
 signal: AbortSignal,
 stream?: (bytes: Buffer) => void,
 onStarted?: (pid: number) => void,
 allowSystemFallback = false
) {
 signal.throwIfAborted()
 mediaExecutablePath(resources, name)
 return new Promise<string>((resolve, reject) => {
  const guardian = spawn(
   process.execPath,
   [
    fileURLToPath(new URL('./media-process-guardian.js', import.meta.url)),
    resources,
    name,
    allowSystemFallback ? 'system-fallback' : 'app-owned'
   ],
   {windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: {...process.env, ELECTRON_RUN_AS_NODE: '1'}}
  )
  let output = '',
   failure: Error | undefined
  const cancel = () => {
   if (guardian.connected) guardian.send({kind: 'cancel'}, () => {})
  }
  guardian.on('message', raw => {
   const value = raw as {kind?: string; pid?: number}
   if (value.kind === 'media-started' && Number.isSafeInteger(value.pid) && value.pid! > 0) onStarted?.(value.pid!)
  })
  guardian.once('spawn', () => {
   if (guardian.connected)
    guardian.send(signal.aborted ? {kind: 'cancel'} : {kind: 'start', args}, error => {
     if (error) {
      failure = new Error('媒体进程通讯失败')
      cancel()
     }
    })
  })
  signal.addEventListener('abort', cancel, {once: true})
  guardian.stdout!.on('data', (bytes: Buffer) => {
   try {
    if (stream) stream(bytes)
    else {
     output += bytes.toString('utf8')
     if (output.length > 2000000) throw new Error('媒体检查响应过大')
    }
   } catch (error) {
    failure = error instanceof Error ? error : new Error('媒体读取失败')
    cancel()
   }
  })
  guardian.stderr!.on('data', () => {})
  guardian.once('error', () => {
   signal.removeEventListener('abort', cancel)
   reject(new Error('媒体守护进程无法启动'))
  })
  guardian.once('close', code => {
   signal.removeEventListener('abort', cancel)
   if (signal.aborted) reject(new Error('媒体处理已取消，恢复文件保留'))
   else if (failure) reject(failure)
   else if (code !== 0) reject(new Error('媒体处理失败，未发布成果'))
   else resolve(output)
  })
 })
}
