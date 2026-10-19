import {LegacyDownloads} from '@main/media/jobs/media-legacy'
import {randomUUID} from 'node:crypto'
import {join} from 'node:path'
import {NativePlatformCatalog} from '@main/media/sources/media-platforms'
import type {NativeMediaSource} from '@main/media/core/media-source'
import {NativeDownloadJobs, type NativeDownloadJob} from '@main/media/jobs/media-jobs'
import {NativeBiliDownloadRunner} from '@main/media/download/media-download-runner'
import {NativeMediaMux} from '@main/media/tools/media-mux'
import {mediaOptionChoices, mediaOptions} from '@main/media/core/media-options'
import type {BiliResources} from '@main/media/bilibili/bili-resources'
import type {MediaCatalog, MediaJob} from '@shared/media'
import {z} from 'zod'
import {NativeMediaAuth} from '@main/media/auth/media-auth'
import type {MediaCrypt} from '@main/security/worker-crypt'
const idSchema = z.string().regex(/^[a-f0-9]{32}$/)
type Fetcher = (url: string, init?: RequestInit) => Promise<Response>
/** Queue control remains responsive while one native download runs in the background. */
export class NativeDownloadService {
 private jobs: NativeDownloadJobs
 private legacy: LegacyDownloads
 private catalog: NativePlatformCatalog
 private runner: NativeBiliDownloadRunner
 private auth: NativeMediaAuth
 private tokens = new Map<string, {source: NativeMediaSource; expires: number}>()
 private queue: string[] = []
 private active: {id: string; controller: AbortController; done: Promise<void>} | undefined
 private pumping: Promise<void> | undefined
 private control: Promise<unknown> = Promise.resolve()
 private stopped = false
 private cancelling = new Set<string>()
 private progress = new Map<string, MediaJob['progress']>()
 constructor(
  resources: string,
  private root: string,
  api: Pick<BiliResources, 'readMedia'>,
  fetcher: Fetcher,
  crypt?: MediaCrypt,
  allowSystemFallback = false
 ) {
  this.jobs = new NativeDownloadJobs(root, crypt)
  this.legacy = new LegacyDownloads(root)
  this.auth = new NativeMediaAuth(root, crypt)
  this.catalog = new NativePlatformCatalog(api, fetcher, this.auth)
  this.runner = new NativeBiliDownloadRunner(
   this.jobs,
   this.catalog,
   fetcher,
   new NativeMediaMux(resources, allowSystemFallback),
   (id, downloaded, total) => this.progress.set(id, {downloaded, ...(total === null ? {} : {total})}),
   this.auth
  )
 }
 private mutate<T>(run: () => Promise<T>) {
  const next = this.control.then(run)
  this.control = next.catch(() => {})
  return next
 }
 private pump() {
  if (this.pumping || this.stopped) return
  const run = async () => {
   while (this.queue.length && !this.stopped) {
    const id = this.queue.shift()!,
     row = await this.jobs.read(id)
    if (row.state !== 'queued' || this.cancelling.has(id)) continue
    const controller = new AbortController(),
     active = {id, controller, done: Promise.resolve()}
    this.active = active
    active.done = this.runner.run(id, controller.signal).then(
     () => {},
     () => {}
    )
    await active.done
    this.progress.delete(id)
    if (this.active === active) this.active = undefined
   }
  }
  this.pumping = run().finally(() => {
   this.pumping = undefined
   if (this.queue.length && !this.stopped) this.pump()
  })
 }
 private project(row: NativeDownloadJob): MediaJob {
  return {
   ...row,
   state: row.state === 'completed' && this.active?.id === row.id ? 'running' : row.state,
   stage: row.state === 'completed' && this.active?.id === row.id ? '正在整理结果' : row.stage,
   progress: row.state === 'running' ? this.progress.get(row.id) || row.progress : row.progress,
   output: row.outputs[0] ? join(this.root, 'native-downloads', row.id, row.outputs[0].relative) : '',
   files: row.outputs.map(o => o.relative)
  }
 }
 async execute(action: string, input: unknown = {}): Promise<unknown> {
  if (this.stopped) throw new Error('下载工作进程已关闭')
  if (action === 'options') return mediaOptionChoices()
  if (action === 'auth-list') return this.auth.list()
  if (action === 'auth-save') return this.auth.save(input)
  if (action === 'auth-remove') {
   const args = z.object({id: idSchema, confirmed: z.literal(true)}).parse(input)
   return this.auth.remove(args.id)
  }
  if (action === 'list') {
   const native = await this.jobs.list(),
    ids = new Set(native.map(row => row.id))
   return [...native.map(row => this.project(row)), ...(await this.legacy.list()).filter(row => !ids.has(row.id))]
  }
  const args = z.record(z.string(), z.unknown()).parse(input)
  if (action === 'catalog') {
   const request = z
    .object({url: z.string().max(2000), playlist: z.boolean().default(false), options: z.unknown().optional()})
    .parse(args)
   const result = await this.catalog.read(request.url, request.playlist, AbortSignal.timeout(60000), request.options)
   if (!('identity' in result)) return result
   for (const [key, item] of this.tokens) if (item.expires < Date.now()) this.tokens.delete(key)
   if (this.tokens.size >= 200) this.tokens.delete(this.tokens.keys().next().value!)
   const token = randomUUID().replaceAll('-', '')
   this.tokens.set(token, {source: result, expires: Date.now() + 15 * 60000})
   return {...result.catalog, token} satisfies MediaCatalog
  }
  if (action === 'file') {
   const id = idSchema.parse(args.id)
   return (await this.jobs.list()).some(row => row.id === id) ? this.jobs.file(id) : this.legacy.file(id)
  }
  if (action === 'cleanup') {
   const id = idSchema.parse(args.id)
   if (!(await this.jobs.list()).some(row => row.id === id)) throw new Error('旧任务原记录只读保留，未删除旧恢复材料')
   return {remaining: await this.jobs.cleanupCompleted(id)}
  }
  return this.mutate(async () => {
   if (this.stopped) throw new Error('下载工作进程已关闭')
   if (action === 'create') {
    const token = idSchema.parse(args.token),
     saved = this.tokens.get(token)
    if (!saved || saved.expires < Date.now()) throw new Error('格式目录已失效，请重新读取')
    const options = mediaOptions(args.options)
    const fresh = await this.catalog.read(saved.source.catalog.url, false, AbortSignal.timeout(60000), options)
    if (!('identity' in fresh) || fresh.identity !== saved.source.identity)
     throw new Error('视频分集身份已改变，请重新读取')
    if (options.skip_existing)
     for (const row of await this.jobs.list())
      if (
       row.state === 'completed' &&
       row.identity === fresh.identity &&
       row.source_url === fresh.catalog.url &&
       JSON.stringify(row.recipe) === JSON.stringify(options)
      ) {
       try {
        await this.jobs.file(row.id)
        return this.project(row)
       } catch {
        /* A changed output must not count as a verified duplicate. */
       }
      }
    if (options.skip_existing)
     for (const row of await this.legacy.list())
      if (row.state === 'completed') {
       try {
        const old = await this.legacy.recipe(row.id)
        if (old.identity === fresh.identity && JSON.stringify(old.options) === JSON.stringify(options)) {
         await this.legacy.file(row.id)
         return row
        }
       } catch {
        /* Invalid or differently configured legacy outputs are not reused. */
       }
      }
    const row = await this.jobs.create({
     identity: fresh.identity,
     url: fresh.catalog.url,
     title: fresh.catalog.title,
     options
    })
    this.queue.push(row.id)
    this.pump()
    return this.project(row)
   }
   const id = idSchema.parse(args.id)
   if (action === 'retry') {
    if (!(await this.jobs.list()).some(row => row.id === id)) {
     const original = await this.legacy.read(id)
     if (original.state === 'completed') {
      await this.legacy.file(id)
      return (await this.legacy.list()).find(row => row.id === id)
     }
     const saved = await this.legacy.recipe(id),
      fresh = await this.catalog.read(saved.url, false, AbortSignal.timeout(60000), saved.options)
     if (!('identity' in fresh) || fresh.identity !== saved.identity)
      throw new Error('旧任务与当前站点分集身份不一致，原记录保留')
     await this.legacy.unchanged(saved.row)
     const row = await this.jobs.create({
      identity: saved.identity,
      url: saved.url,
      title: saved.row.title,
      options: saved.options,
      legacy: {id, recordHash: saved.row.recordHash}
     })
     this.queue.push(id)
     this.pump()
     return this.project(row)
    }
    const row = await this.jobs.read(id)
    if (this.active?.id === id) throw new Error('该任务仍在执行')
    const queued = await this.jobs.transition(id, row.revision, 'queued', {stage: '等待继续下载'})
    this.cancelling.delete(id)
    this.queue.push(id)
    this.pump()
    return this.project(queued)
   }
   if (action === 'cancel') {
    if (!(await this.jobs.list()).some(row => row.id === id))
     throw new Error('旧任务以只读方式保留；请在旧程序停止实际任务，原记录未改写')
    this.cancelling.add(id)
    const active = this.active?.id === id ? this.active : undefined
    active?.controller.abort()
    if (active) await active.done
    const row = await this.jobs.read(id)
    if (row.state === 'queued') await this.jobs.transition(id, row.revision, 'cancelled', {stage: '已取消'})
    this.queue = this.queue.filter(value => value !== id)
    return this.project(await this.jobs.read(id))
   }
   throw new Error('未知下载操作')
  })
 }
 async dispose() {
  this.stopped = true
  this.queue = []
  this.tokens.clear()
  this.active?.controller.abort()
  await this.pumping
 }
}
