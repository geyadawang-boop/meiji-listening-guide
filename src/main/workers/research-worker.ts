import type {ParentPort} from 'electron'
import {z} from 'zod'
import {NativeResearchService} from '@main/research/research-service'
import {BACKEND_PROTOCOL} from '@shared/backend-protocol'
import {acquireDownloadQueue} from '@main/media/jobs/media-queue-lease'
import {MediaEncryptionClient} from '@main/security/worker-crypt'
const port = (process as NodeJS.Process & {parentPort: ParentPort}).parentPort
const [root, resources] = process.argv.slice(2)
if (!port || !root) throw new Error('研究工作进程参数无效')
let key = 0,
 closed = false
const ownerReady = acquireDownloadQueue(root, 'native-research-owner.sqlite')
void ownerReady.catch(() => {})
const pending = new Map<number, {resolve: (text: string) => void; reject: (error: Error) => void; cancel: () => void}>()
const encryption = new MediaEncryptionClient(message => port.postMessage(message))
process.once('exit', () => encryption.close())
const service = new NativeResearchService(
 root,
 (input, signal) =>
  new Promise<string>((resolve, reject) => {
   const id = ++key,
    timer = setTimeout(() => finish(new Error('模型请求超时，未确认结果保留')), 180000)
   function finish(error?: Error, text?: string) {
    if (!pending.delete(id)) return
    clearTimeout(timer)
    signal.removeEventListener('abort', cancel)
    if (error) {
     port.postMessage({protocol: BACKEND_PROTOCOL, kind: 'model-cancel', key: id})
     reject(error)
    } else resolve(text!)
   }
   function cancel() {
    finish(new Error('研究模型请求已取消'))
   }
   pending.set(id, {resolve: text => finish(undefined, text), reject: error => finish(error), cancel})
   signal.addEventListener('abort', cancel, {once: true})
   port.postMessage({protocol: BACKEND_PROTOCOL, kind: 'model', key: id, ...input})
   if (signal.aborted) cancel()
  }),
 resources,
 encryption.protect
)
port.on('message', event => {
 const raw = event.data as {kind?: string}
 if (raw.kind === 'crypt-result') {
  try {
   encryption.receive(raw)
  } catch {
   encryption.close()
   process.exit(1)
  }
  return
 }
 if (raw.kind === 'model-result') {
  try {
   const reply = z
     .object({
      kind: z.literal('model-result'),
      key: z.number().int().positive(),
      text: z.string().max(200000).optional(),
      error: z.string().max(1000).optional()
     })
     .parse(raw),
    request = pending.get(reply.key)
   if (request)
    reply.error
     ? request.reject(new Error(reply.error))
     : reply.text !== undefined
       ? request.resolve(reply.text)
       : request.reject(new Error('模型结果缺失'))
  } catch {
   process.exit(1)
  }
  return
 }
 void (async () => {
  let id: number | undefined
  try {
   const request = z
    .object({
     protocol: z.literal(BACKEND_PROTOCOL),
     id: z.number().int().positive(),
     action: z.string(),
     args: z.unknown()
    })
    .parse(raw)
   id = request.id
   const owner = await ownerReady
   if (closed) throw new Error('研究后台已关闭')
   if (request.action === 'shutdown') {
    closed = true
    try {
     await service.dispose()
    } finally {
     encryption.close()
    }
    owner.close()
    port.postMessage({protocol: BACKEND_PROTOCOL, kind: 'result', id, ok: true, result: true})
    return
   }
   const result = await service.execute(request.action, request.args)
   port.postMessage({protocol: BACKEND_PROTOCOL, kind: 'result', id, ok: true, result})
  } catch (error) {
   port.postMessage({
    protocol: BACKEND_PROTOCOL,
    kind: 'result',
    id,
    ok: false,
    error: error instanceof Error ? error.message : '研究操作未完成'
   })
  }
 })().catch(() => {
  process.exit(1)
 })
})
