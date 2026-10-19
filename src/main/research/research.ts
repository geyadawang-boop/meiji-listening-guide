import {utilityProcess, type UtilityProcess} from 'electron'
import {fileURLToPath} from 'node:url'
import {z} from 'zod'
import {mediaCryptRequest, decodeMediaCrypt} from '@main/security/worker-crypt'
import {systemProtect} from '@main/security/system-encryption'
import {BACKEND_PROTOCOL, backendRequest} from '@shared/backend-protocol'
import type {ResearchModel} from '@main/research/research-engine'
const messageSchema = z.discriminatedUnion('kind', [
 mediaCryptRequest,
 z.object({
  protocol: z.literal(BACKEND_PROTOCOL),
  kind: z.literal('result'),
  id: z.number().int().positive(),
  ok: z.boolean(),
  result: z.unknown().optional(),
  error: z.string().max(4000).optional()
 }),
 z.object({
  protocol: z.literal(BACKEND_PROTOCOL),
  kind: z.literal('model'),
  key: z.number().int().positive(),
  connection: z.string().max(200),
  system: z.string().max(30000),
  user: z.string().max(250000)
 }),
 z.object({protocol: z.literal(BACKEND_PROTOCOL), kind: z.literal('model-cancel'), key: z.number().int().positive()})
])
/** Model credentials remain in the parent. Background research exchanges only selected text and connection fingerprints. */
export class NativeResearchBackend {
 private worker: UtilityProcess | undefined
 private sequence = 0
 private closed = false
 private pending = new Map<
  number,
  {resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout>}
 >()
 private models = new Map<number, AbortController>()
 constructor(
  private root: string,
  private model: ResearchModel,
  private resources = fileURLToPath(new URL('../../resources', import.meta.url))
 ) {}
 get started() {
  return !!this.worker
 }
 private start() {
  if (this.worker) return this.worker
  const worker = utilityProcess.fork(
   fileURLToPath(new URL('./research-worker.js', import.meta.url)),
   [this.root, this.resources],
   {stdio: 'pipe', serviceName: '原生研究工具'}
  )
  this.worker = worker
  worker.stdout?.on('data', () => {})
  worker.stderr?.on('data', () => {})
  const fail = () => {
   if (this.worker !== worker) return
   this.worker = undefined
   worker.kill()
   for (const controller of this.models.values()) controller.abort()
   this.models.clear()
   for (const item of this.pending.values()) {
    clearTimeout(item.timer)
    item.reject(new Error('研究工作进程中断，已保存资料与恢复记录保留'))
   }
   this.pending.clear()
  }
  let lastCryptKey = 0
  worker.once('exit', fail)
  worker.on('message', (raw: unknown) => {
   void (async () => {
    if (this.worker !== worker) return
    const reply = messageSchema.parse(raw)
    if (reply.kind === 'crypt') {
     if (reply.key <= lastCryptKey) throw new Error('系统加密请求编号无效')
     lastCryptKey = reply.key
     try {
      const data = systemProtect(decodeMediaCrypt(reply.data), reply.decrypt, 'im').toString('base64')
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
     return
    }
    if (reply.kind === 'result') {
     const item = this.pending.get(reply.id)
     if (!item) return
     this.pending.delete(reply.id)
     clearTimeout(item.timer)
     reply.ok ? item.resolve(reply.result) : item.reject(new Error(reply.error || '研究请求失败'))
     return
    }
    if (reply.kind === 'model-cancel') {
     this.models.get(reply.key)?.abort()
     return
    }
    if (this.models.has(reply.key) || this.models.size >= 8) throw new Error('研究模型请求编号冲突或数量过多')
    const controller = new AbortController()
    this.models.set(reply.key, controller)
    try {
     const text = await this.model(
      {connection: reply.connection, system: reply.system, user: reply.user},
      controller.signal
     )
     if (this.worker === worker) worker.postMessage({kind: 'model-result', key: reply.key, text})
    } catch (error) {
     if (this.worker === worker)
      worker.postMessage({
       kind: 'model-result',
       key: reply.key,
       error: error instanceof Error ? error.message.slice(0, 1000) : '模型请求失败'
      })
    } finally {
     this.models.delete(reply.key)
    }
   })().catch(fail)
  })
  return worker
 }
 request<T>(action: string, args: unknown = {}): Promise<T> {
  if (this.closed) return Promise.reject(new Error('研究后台已关闭'))
  const worker = this.start(),
   id = ++this.sequence
  return new Promise<T>((resolve, reject) => {
   const timer = setTimeout(() => {
    this.pending.delete(id)
    reject(new Error('研究控制请求超时，请刷新记录'))
   }, 120000)
   this.pending.set(id, {resolve: value => resolve(value as T), reject, timer})
   worker.postMessage(backendRequest(id, action, args))
  })
 }
 async dispose() {
  if (this.closed) return
  if (this.worker) {
   let timer: ReturnType<typeof setTimeout> | undefined
   const shutdown = this.request('shutdown')
   this.closed = true
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
  this.closed = true
  for (const controller of this.models.values()) controller.abort()
  this.models.clear()
  for (const item of this.pending.values()) {
   clearTimeout(item.timer)
   item.reject(new Error('研究后台已关闭'))
  }
  this.pending.clear()
 }
}
