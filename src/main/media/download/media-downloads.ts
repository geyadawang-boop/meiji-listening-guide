import {app, utilityProcess, type UtilityProcess} from 'electron'
import {fileURLToPath} from 'node:url'
import {z} from 'zod'
import {mediaCryptRequest, decodeMediaCrypt} from '@main/security/worker-crypt'
import {systemProtect} from '@main/security/system-encryption'
import type {BiliResources} from '@main/media/bilibili/bili-resources'
import {backendRequest, BACKEND_PROTOCOL} from '@shared/backend-protocol'
import {mediaFallbackAllowed} from '@main/media/tools/media-executable'
const apiPaths = ['/x/web-interface/view', '/x/player/wbi/playurl', '/x/player/v2'] as const
const replySchema = z.discriminatedUnion('kind', [
 mediaCryptRequest,
 z.object({
  protocol: z.literal(BACKEND_PROTOCOL),
  kind: z.literal('bili-api'),
  key: z.number().int().positive(),
  path: z.enum(apiPaths),
  params: z.record(z.string(), z.string())
 }),
 z.object({
  protocol: z.literal(BACKEND_PROTOCOL),
  kind: z.literal('result'),
  id: z.number().int().positive(),
  ok: z.boolean(),
  result: z.unknown().optional(),
  error: z.string().optional()
 })
])
/** The parent owns platform login; worker receives API data without exported cookie files. */
export class NativeDownloads {
 private worker: UtilityProcess | undefined
 private sequence = 0
 private disposed = false
 private pending = new Map<
  number,
  {resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout>}
 >()
 private apiCalls = new Set<AbortController>()
 constructor(
  private resources: string,
  private root: string,
  private api: Pick<BiliResources, 'readMedia'>
 ) {}
 get started() {
  return !!this.worker
 }
 private start() {
  if (this.worker) return this.worker
  const worker = utilityProcess.fork(
   fileURLToPath(new URL('./media-download-worker.js', import.meta.url)),
   [this.resources, this.root, mediaFallbackAllowed(app.isPackaged) ? 'system-fallback' : 'app-owned'],
   {stdio: 'pipe', serviceName: '原生媒体下载'}
  )
  this.worker = worker
  worker.stdout?.on('data', () => {})
  worker.stderr?.on('data', () => {})
  const fail = () => {
   if (this.worker !== worker) return
   this.worker = undefined
   worker.kill()
   for (const controller of this.apiCalls) controller.abort()
   this.apiCalls.clear()
   for (const item of this.pending.values()) {
    clearTimeout(item.timer)
    item.reject(new Error('下载工作进程中断，恢复记录保留'))
   }
   this.pending.clear()
  }
  let lastCryptKey = 0
  worker.once('exit', fail)
  worker.on('message', (raw: unknown) => {
   void (async () => {
    if (this.worker !== worker) return
    const reply = replySchema.parse(raw)
    if (reply.kind === 'crypt') {
     if (reply.key <= lastCryptKey) throw new Error('系统加密请求编号无效')
     lastCryptKey = reply.key
     try {
      const data = systemProtect(decodeMediaCrypt(reply.data), reply.decrypt).toString('base64')
      if (this.worker === worker) worker.postMessage({kind: 'crypt-result', key: reply.key, ok: true, data})
     } catch {
      if (this.worker === worker)
       worker.postMessage({
        kind: 'crypt-result',
        key: reply.key,
        ok: false,
        error: '系统密钥库不可用或凭据格式无效，未写入凭据'
       })
     }
    } else if (reply.kind === 'bili-api') {
     const controller = new AbortController()
     this.apiCalls.add(controller)
     try {
      const data = await this.api.readMedia(
       reply.path,
       reply.params,
       AbortSignal.any([controller.signal, AbortSignal.timeout(40000)])
      )
      if (this.worker === worker) worker.postMessage({kind: 'bili-result', key: reply.key, ok: true, data})
     } catch (error) {
      if (this.worker === worker)
       worker.postMessage({
        kind: 'bili-result',
        key: reply.key,
        ok: false,
        error: error instanceof Error ? error.message : '站点读取失败'
       })
     } finally {
      this.apiCalls.delete(controller)
     }
    } else {
     const item = this.pending.get(reply.id)
     if (!item) return
     this.pending.delete(reply.id)
     clearTimeout(item.timer)
     reply.ok ? item.resolve(reply.result) : item.reject(new Error(reply.error || '下载处理失败'))
    }
   })().catch(fail)
  })
  return worker
 }
 request<T>(action: string, args: unknown = {}): Promise<T> {
  if (this.disposed) return Promise.reject(new Error('下载队列已关闭'))
  const worker = this.start(),
   id = ++this.sequence
  return new Promise<T>((resolve, reject) => {
   const timer = setTimeout(() => {
    this.pending.delete(id)
    reject(new Error('下载控制请求超时，请刷新记录核对状态'))
   }, 120000)
   this.pending.set(id, {resolve: result => resolve(result as T), reject, timer})
   worker.postMessage(backendRequest(id, action, args))
  })
 }
 async dispose() {
  if (this.disposed) return
  if (this.worker) {
   let timer: ReturnType<typeof setTimeout> | undefined
   const shutdown = this.request('shutdown')
   this.disposed = true
   try {
    await Promise.race([
     shutdown,
     new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('后台关闭超时，恢复记录保留')), 10000)
     })
    ])
   } catch {
   } finally {
    clearTimeout(timer)
   }
   this.worker?.kill()
   this.worker = undefined
  }
  this.disposed = true
  for (const controller of this.apiCalls) controller.abort()
  this.apiCalls.clear()
  for (const item of this.pending.values()) {
   clearTimeout(item.timer)
   item.reject(new Error('下载队列已关闭'))
  }
  this.pending.clear()
 }
}
