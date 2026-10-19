import {acquireDownloadQueue} from '@main/media/jobs/media-queue-lease'
import type {ParentPort} from 'electron'
import {z} from 'zod'
import {NativeDownloadService} from '@main/media/download/media-download-service'
import {BACKEND_PROTOCOL} from '@shared/backend-protocol'
import {MediaEncryptionClient} from '@main/security/worker-crypt'
const port = (process as NodeJS.Process & {parentPort: ParentPort}).parentPort
const [resources, root, mediaPermission] = process.argv.slice(2)
if (!port || !resources || !root || !['system-fallback', 'app-owned'].includes(mediaPermission))
 throw new Error('下载工作进程参数无效')
const ownerReady = acquireDownloadQueue(root)
void ownerReady.catch(() => {})
let sequence = 0
const pending = new Map<
 number,
 {resolve: (data: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout>}
>()
const api = {
 readMedia(
  path: '/x/web-interface/view' | '/x/player/wbi/playurl' | '/x/player/v2',
  params: Record<string, string>,
  signal: AbortSignal
 ): Promise<unknown> {
  return new Promise((resolve, reject) => {
   const key = ++sequence,
    timer = setTimeout(() => finish(new Error('站点读取超时')), 45000)
   const cancel = () => finish(new Error('站点读取已取消'))
   function finish(error?: Error, data?: unknown) {
    if (!pending.delete(key)) return
    clearTimeout(timer)
    signal.removeEventListener('abort', cancel)
    error ? reject(error) : resolve(data)
   }
   pending.set(key, {resolve: data => finish(undefined, data), reject: error => finish(error), timer})
   signal.addEventListener('abort', cancel, {once: true})
   port.postMessage({protocol: BACKEND_PROTOCOL, kind: 'bili-api', key, path, params})
   if (signal.aborted) cancel()
  })
 }
}
const encryption = new MediaEncryptionClient(message => port.postMessage(message))
const service = new NativeDownloadService(
 resources,
 root,
 api,
 fetch,
 encryption.protect,
 mediaPermission === 'system-fallback'
)
process.once('exit', () => encryption.close())
port.on('message', event => {
 void (async () => {
  const raw = event.data as {kind?: unknown}
  if (raw.kind === 'crypt-result') {
   encryption.receive(raw)
   return
  }
  if (raw.kind === 'bili-result') {
   const reply = z
    .object({
     kind: z.literal('bili-result'),
     key: z.number().int().positive(),
     ok: z.boolean(),
     data: z.unknown().optional(),
     error: z.string().optional()
    })
    .parse(raw)
   const request = pending.get(reply.key)
   if (request) reply.ok ? request.resolve(reply.data) : request.reject(new Error(reply.error || '站点读取失败'))
   return
  }
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
   if (request.action === 'shutdown') {
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
    error: error instanceof Error ? error.message : '下载请求失败'
   })
  }
 })().catch(() => {
  process.exitCode = 1
  process.exit(1)
 })
})
