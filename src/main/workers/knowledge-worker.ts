import type {ParentPort} from 'electron'
import {z} from 'zod'
import {NativeKnowledgeService} from '@main/knowledge/knowledge-service'
import {BACKEND_PROTOCOL} from '@shared/backend-protocol'
const port = (process as NodeJS.Process & {parentPort: ParentPort}).parentPort
const [resources, root] = process.argv.slice(2)
if (!port || !resources || !root) throw new Error('知识库工作进程参数无效')
let activeId = 0,
 queue: Promise<unknown> = Promise.resolve()
const service = new NativeKnowledgeService(resources, root, message =>
 port.postMessage({protocol: BACKEND_PROTOCOL, id: activeId, kind: 'progress', message})
)
port.on('message', event => {
 queue = queue.then(async () => {
  let id: number | undefined
  try {
   const request = z
    .object({
     protocol: z.literal(BACKEND_PROTOCOL),
     id: z.number().int().positive(),
     action: z.string(),
     args: z.unknown()
    })
    .parse(event.data)
   id = request.id
   activeId = id
   const result = await service.execute(request.action, request.args)
   port.postMessage({protocol: BACKEND_PROTOCOL, id, kind: 'result', ok: true, result})
  } catch (error) {
   port.postMessage({
    protocol: BACKEND_PROTOCOL,
    id,
    kind: 'result',
    ok: false,
    error: error instanceof Error ? error.message : '知识库处理失败'
   })
  }
 })
})
