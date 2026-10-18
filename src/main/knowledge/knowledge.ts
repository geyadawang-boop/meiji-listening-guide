import {utilityProcess, type UtilityProcess} from 'electron'
import {fileURLToPath} from 'node:url'
import {basename, extname} from 'node:path'
import {readFile, stat} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {z} from 'zod'
import {backendRequest, BACKEND_PROTOCOL} from '@shared/backend-protocol'
import {parseDocument} from '@main/documents/documents'
import type {KnowledgeList, KnowledgeSearch, KnowledgeHit} from '@shared/knowledge'

const replySchema = z.discriminatedUnion('kind', [
 z.object({
  protocol: z.literal(BACKEND_PROTOCOL),
  id: z.number().int().positive(),
  kind: z.literal('progress'),
  message: z.string().max(4000)
 }),
 z.object({
  protocol: z.literal(BACKEND_PROTOCOL),
  id: z.number().int().positive(),
  kind: z.literal('result'),
  ok: z.boolean(),
  result: z.unknown().optional(),
  error: z.string().optional()
 })
])
/** Knowledge work runs in an isolated TypeScript/Node process, including CPU inference. */
export class KnowledgeBase {
 private worker: UtilityProcess | undefined
 private queue: Promise<unknown> = Promise.resolve()
 private sequence = 0
 private disposed = false
 private active: {id: number; finish: (error?: Error, result?: unknown) => void} | undefined
 get started() {
  return !!this.worker
 }
 constructor(
  private resources: string,
  private root: string,
  private progress: (message: string) => void = () => {}
 ) {}
 request<T>(action: string, args: unknown = {}, signal?: AbortSignal): Promise<T> {
  const next = this.queue.then(() => this.run<T>(action, args, signal))
  this.queue = next.catch(() => undefined)
  return next
 }
 private start() {
  if (this.worker) return this.worker
  const child = utilityProcess.fork(
   fileURLToPath(new URL('./knowledge-worker.js', import.meta.url)),
   [this.resources, this.root],
   {stdio: 'pipe', serviceName: '本地知识库'}
  )
  this.worker = child
  const fail = (error: Error) => {
   if (this.worker !== child) return
   this.worker = undefined
   child.kill()
   this.active?.finish(error)
  }
  child.stdout?.on('data', () => {})
  child.stderr?.on('data', () => {})
  child.once('exit', () => fail(new Error('知识库工作进程中断，已保存资料保留')))
  child.on('message', (input: unknown) => {
   try {
    const reply = replySchema.parse(input)
    if (reply.id !== this.active?.id) throw new Error('知识库响应与请求不一致')
    if (reply.kind === 'progress') this.progress(reply.message)
    else this.active.finish(reply.ok ? undefined : new Error(reply.error || '知识库处理失败'), reply.result)
   } catch (error) {
    fail(error instanceof Error ? error : new Error('知识库结果无法读取'))
   }
  })
  return child
 }
 private run<T>(action: string, args: unknown, signal?: AbortSignal): Promise<T> {
  if (this.disposed) return Promise.reject(new Error('知识库已关闭'))
  if (signal?.aborted) return Promise.reject(new Error('知识库任务已取消'))
  return new Promise((resolve, reject) => {
   const child = this.start(),
    id = ++this.sequence
   const abort = (error: Error) => {
    if (this.worker === child) this.worker = undefined
    child.kill()
    finish(error)
   }
   const cancel = () => abort(new Error('知识库处理已取消，已有资料保留'))
   const timer = setTimeout(
    () => abort(new Error('知识库处理超时，已有资料保留')),
    action === 'vector-rebuild' ? 900000 : action === 'search' ? 180000 : 120000
   )
   const finish = (error?: Error, result?: unknown) => {
    if (this.active?.id !== id) return
    this.active = undefined
    clearTimeout(timer)
    signal?.removeEventListener('abort', cancel)
    error ? reject(error) : resolve(result as T)
   }
   this.active = {id, finish}
   signal?.addEventListener('abort', cancel, {once: true})
   child.postMessage(backendRequest(id, action, args))
   if (signal?.aborted) cancel()
  })
 }
 dispose() {
  this.disposed = true
  this.active?.finish(new Error('知识库已关闭'))
  this.worker?.kill()
  this.worker = undefined
 }
 list() {
  return this.request<KnowledgeList>('list')
 }
 generation(locator: string) {
  return this.request<string | null>('generation', {locator})
 }
 importSubtitle(
  url: string,
  title: string,
  srt: string,
  category: string,
  signal: AbortSignal,
  sourceMethod = '站内字幕',
  expectedGeneration?: string | null
 ) {
  return this.request<{unchanged: boolean; entry: {generation_id: string}}>(
   'import',
   {
    title,
    text: srt,
    locator: url,
    sourceHash: createHash('sha256').update(srt).digest('hex'),
    category,
    origin: 'bilibili-subtitle',
    sourceMethod,
    expectedGeneration
   },
   signal
  )
 }
 search(query: string, ids?: string[]) {
  return this.request<KnowledgeSearch>('search', {query, ids})
 }
 async importFile(path: string, category: string) {
  if ((await stat(path)).size > 100000000) throw new Error('资料超过 100 MB，请按章节导入')
  const bytes = await readFile(path),
   sourceHash = createHash('sha256').update(bytes).digest('hex')
  const parsed =
   extname(path).toLowerCase() === '.srt' ? {text: bytes.toString('utf8'), needsOcr: false} : await parseDocument(path)
  if (parsed.needsOcr) throw new Error('这份 PDF 主要是图片，请先识别文字后再导入知识库')
  if (
   createHash('sha256')
    .update(await readFile(path))
    .digest('hex') !== sourceHash
  )
   throw new Error('导入期间资料已改变，请重新选择')
  return this.request('import', {title: basename(path), text: parsed.text, locator: path, sourceHash, category})
 }
 async verify(hits: KnowledgeHit[]) {
  for (const hit of hits) {
   const current = await this.request<KnowledgeHit>('citation', {evidenceId: hit.evidence_id})
   if (current.digest !== hit.digest || current.generation_id !== hit.generation_id)
    throw new Error('问答期间资料已改变，请重新检索')
  }
 }
}
