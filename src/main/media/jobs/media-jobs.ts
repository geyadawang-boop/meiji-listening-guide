import {recoverDownloadLocks} from '@main/media/jobs/media-lock-recovery'
import {createHash, randomUUID} from 'node:crypto'
import {createReadStream} from 'node:fs'
import {mkdir, lstat, readFile, readdir, realpath, rename, writeFile, unlink} from 'node:fs/promises'
import {isAbsolute, join, relative, resolve, sep} from 'node:path'
import {z} from 'zod'
import {mediaOptions} from '@main/media/core/media-options'
import {windowsProtect} from '@main/security/windows-native'
import type {MediaCrypt} from '@main/security/worker-crypt'

const idSchema = z.string().regex(/^[a-f0-9]{32}$/)
const receipt = z
 .object({
  relative: z.string().min(1),
  bytes: z.number().int().positive().safe(),
  hash: z.string().regex(/^[a-f0-9]{64}$/)
 })
 .strict()
const states = ['queued', 'running', 'completed', 'cancelled', 'interrupted', 'error'] as const
const schema = z
 .object({
  version: z.literal(1),
  id: idSchema,
  legacy: z.object({id: idSchema, recordHash: z.string().regex(/^[a-f0-9]{64}$/)}).optional(),
  revision: z.number().int().nonnegative(),
  identity: z.string().min(1).max(500),
  source_url: z.string().url().max(2000),
  title: z.string().max(240),
  recipe: z.record(z.string(), z.unknown()),
  recipeHash: z.string().regex(/^[a-f0-9]{64}$/),
  state: z.enum(states),
  stage: z.string().max(200),
  progress: z.object({
   downloaded: z.number().finite().nonnegative().optional(),
   total: z.number().finite().nonnegative().optional()
  }),
  error_message: z.string().max(1000),
  warning: z.string().max(1000),
  created: z.string(),
  updated: z.string(),
  outputs: z.array(receipt).max(1000),
  cleanup: z.array(z.string()).max(50000).default([])
 })
 .strict()
export type NativeDownloadJob = z.infer<typeof schema>
type Receipt = z.infer<typeof receipt>
const hashRecipe = (identity: string, source: string, recipe: unknown) =>
 createHash('sha256')
  .update(JSON.stringify([identity, source, recipe]))
  .digest('hex')
async function digest(path: string) {
 const hash = createHash('sha256')
 for await (const chunk of createReadStream(path)) hash.update(chunk)
 return hash.digest('hex')
}

/** An isolated journal format; reading it never mutates the Python queue's existing records. */
export class NativeDownloadJobs {
 private serial: Promise<unknown> = Promise.resolve()
 private records = new Map<string, NativeDownloadJob>()
 private initialized: Promise<void> | undefined
 constructor(
  private root: string,
  private crypt: MediaCrypt = windowsProtect
 ) {}
 private exclusive<T>(run: () => Promise<T>): Promise<T> {
  const operation = this.serial.then(run)
  this.serial = operation.catch(() => {})
  return operation
 }
 private async base() {
  const base = resolve(this.root, 'native-downloads')
  await mkdir(base, {recursive: true})
  if ((await lstat(base)).isSymbolicLink() || resolve(await realpath(base)).toLowerCase() !== base.toLowerCase())
   throw new Error('下载记录目录无效')
  return base
 }
 private async directory(id: string) {
  idSchema.parse(id)
  const base = await this.base(),
   path = join(base, id)
  await mkdir(path, {recursive: true})
  if ((await lstat(path)).isSymbolicLink() || (await realpath(path)).toLowerCase() !== path.toLowerCase())
   throw new Error('下载任务目录无效')
  return path
 }
 private async save(job: NativeDownloadJob) {
  const directory = await this.directory(job.id),
   encrypted = job.recipe.privacy === true,
   path = join(directory, encrypted ? 'job.dpapi' : 'job.json'),
   tmp = join(directory, encrypted ? 'job.writing.dpapi' : 'job.writing')
  for (const target of [path, tmp]) {
   try {
    const item = await lstat(target)
    if (item.isSymbolicLink() || !item.isFile()) throw new Error('下载记录文件无效')
   } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
   }
  }
  const serialized = Buffer.from(JSON.stringify(job))
  await writeFile(tmp, encrypted ? await this.crypt(serialized) : serialized)
  await rename(tmp, path)
  this.records.set(job.id, job)
 }
 initialize() {
  return (this.initialized ??= this.exclusive(async () => {
   const base = await this.base()
   for (const entry of await readdir(base, {withFileTypes: true})) {
    if (!idSchema.safeParse(entry.name).success || !entry.isDirectory() || entry.isSymbolicLink()) continue
    const directory = await this.directory(entry.name),
     privatePath = join(directory, 'job.dpapi'),
     publicPath = join(directory, 'job.json')
    let encrypted = false
    try {
     await lstat(privatePath)
     encrypted = true
    } catch (error) {
     if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    if (encrypted) {
     try {
      await lstat(publicPath)
      throw new Error('下载任务同时存在明文与加密记录，未选择其中一个覆盖')
     } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
     }
    }
    const path = encrypted ? privatePath : publicPath
    const item = await lstat(path)
    if (item.isSymbolicLink() || !item.isFile()) throw new Error('下载恢复记录文件无效')
    const bytes = await readFile(path),
     row = schema.parse(JSON.parse((encrypted ? await this.crypt(bytes, true) : bytes).toString('utf8')))
    if (encrypted !== (row.recipe.privacy === true)) throw new Error('下载记录加密方式与任务设置不一致')
    if (row.id !== entry.name || row.recipeHash !== hashRecipe(row.identity, row.source_url, mediaOptions(row.recipe)))
     throw new Error('下载恢复记录与任务不一致')
    const locks = await recoverDownloadLocks(directory, row.identity)
    if (locks.preserved.length) row.warning = '保留无法确认归属的分段锁，请核对原下载进程后再继续'
    if (row.state === 'running' || row.state === 'queued')
     await this.save({
      ...row,
      revision: row.revision + 1,
      state: 'interrupted',
      stage: '上次中断，等待手动继续',
      updated: new Date().toISOString()
     })
    else {
     this.records.set(row.id, row)
     if (row.state === 'completed' && row.cleanup.length) {
      try {
       await this.clearIntermediates(row)
      } catch {
       const warned = {...row, warning: '成果或清理记录未通过核对，原中间文件保留'}
       this.records.set(row.id, warned)
      }
     }
    }
   }
  }))
 }
 async create(input: {
  identity: string
  url: string
  title: string
  options?: unknown
  legacy?: {id: string; recordHash: string}
 }) {
  await this.initialize()
  return this.exclusive(async () => {
   const recipe = mediaOptions(input.options),
    now = new Date().toISOString()
   if (input.legacy && this.records.has(idSchema.parse(input.legacy.id)))
    throw new Error('此旧任务已经迁入原生队列，请刷新记录')
   const row = schema.parse({
    version: 1,
    id: input.legacy?.id || randomUUID().replaceAll('-', ''),
    legacy: input.legacy,
    revision: 0,
    identity: input.identity,
    source_url: input.url,
    title: input.title.slice(0, 240),
    recipe,
    recipeHash: hashRecipe(input.identity, input.url, recipe),
    state: 'queued',
    stage: '等待下载',
    progress: {},
    error_message: '',
    warning: '',
    created: now,
    updated: now,
    outputs: []
   })
   await this.save(row)
   return structuredClone(row)
  })
 }
 async list() {
  await this.initialize()
  await this.serial
  return [...this.records.values()].sort((a, b) => b.created.localeCompare(a.created)).map(row => structuredClone(row))
 }
 async read(id: string) {
  await this.initialize()
  await this.serial
  idSchema.parse(id)
  const row = this.records.get(id)
  if (!row) throw new Error('下载任务不存在')
  return structuredClone(row)
 }
 async transition(
  id: string,
  revision: number,
  state: NativeDownloadJob['state'],
  details: {stage?: string; error?: string; warning?: string; progress?: NativeDownloadJob['progress']} = {}
 ) {
  await this.initialize()
  return this.exclusive(async () => {
   const current = this.records.get(idSchema.parse(id))
   if (!current) throw new Error('下载任务不存在')
   if (current.revision !== revision) throw new Error('下载记录已改变，请刷新后继续')
   const allowed: Record<NativeDownloadJob['state'], NativeDownloadJob['state'][]> = {
    queued: ['running', 'cancelled'],
    running: ['running', 'cancelled', 'interrupted', 'error'],
    interrupted: ['queued'],
    cancelled: ['queued'],
    error: ['queued'],
    completed: []
   }
   if (!allowed[current.state].includes(state)) throw new Error('下载状态转换无效')
   const next = schema.parse({
    ...current,
    revision: revision + 1,
    state,
    stage: details.stage ?? current.stage,
    error_message: details.error ?? '',
    warning: details.warning ?? current.warning,
    progress: details.progress ?? current.progress,
    updated: new Date().toISOString()
   })
   await this.save(next)
   return structuredClone(next)
  })
 }
 private async ownedFile(id: string, name: string) {
  const directory = await this.directory(id),
   path = resolve(directory, name),
   part = relative(directory, path)
  if (
   isAbsolute(name) ||
   !part ||
   part === '..' ||
   part.startsWith('..' + sep) ||
   isAbsolute(part) ||
   part
    .split(/[\\/]/)
    .some(piece => ['job.json', 'job.writing', 'job.dpapi', 'job.writing.dpapi'].includes(piece.toLowerCase()))
  )
   throw new Error('成果路径不属于下载任务')
  const info = await lstat(path)
  if (!info.isFile() || info.isSymbolicLink() || (await realpath(path)).toLowerCase() !== path.toLowerCase())
   throw new Error('下载成果文件不可用')
  return {path, info}
 }
 async evidence(id: string, name: string): Promise<Receipt> {
  const {path, info} = await this.ownedFile(id, name)
  return receipt.parse({relative: name, bytes: info.size, hash: await digest(path)})
 }
 async complete(id: string, revision: number, outputs: Receipt[], cleanup: string[] = []) {
  await this.initialize()
  return this.exclusive(async () => {
   const row = this.records.get(idSchema.parse(id))
   if (!row || row.revision !== revision || row.state !== 'running')
    throw new Error('任务已取消、改变或不在运行，拒绝发布旧成果')
   if (!outputs.length || new Set(outputs.map(o => o.relative.toLowerCase())).size !== outputs.length)
    throw new Error('成果清单为空或重复')
   for (const raw of outputs) {
    const expected = receipt.parse(raw),
     actual = await this.evidence(id, expected.relative)
    if (actual.bytes !== expected.bytes || actual.hash !== expected.hash)
     throw new Error('下载成果校验失败，保留恢复文件')
   }
   const names = [...new Set(cleanup)]
   this.checkCleanup(names, outputs)
   const next = schema.parse({
    ...row,
    revision: revision + 1,
    state: 'completed',
    stage: '成果已核验',
    outputs,
    cleanup: names,
    error_message: '',
    updated: new Date().toISOString()
   })
   await this.save(next)
   return structuredClone(next)
  })
 }
 private checkCleanup(names: string[], outputs: Receipt[]) {
  if (
   names.some(
    name =>
     !name ||
     /[\\/:\x00-\x1f]/.test(name) ||
     /[. ]$/.test(name) ||
     name.trim() !== name ||
     ['job.json', 'job.writing', 'job.dpapi', 'job.writing.dpapi'].includes(name.toLowerCase()) ||
     outputs.some(output => output.relative.toLowerCase() === name.toLowerCase())
   )
  )
   throw new Error('清理清单包含非中间文件')
 }
 private async clearIntermediates(row: NativeDownloadJob) {
  this.checkCleanup(row.cleanup, row.outputs)
  for (const expected of row.outputs) {
   const actual = await this.evidence(row.id, expected.relative)
   if (actual.bytes !== expected.bytes || actual.hash !== expected.hash) throw new Error('成果已改变，原中间文件保留')
  }
  const remaining: string[] = []
  for (const name of row.cleanup) {
   try {
    const {path} = await this.ownedFile(row.id, name)
    await unlink(path)
   } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') remaining.push(name)
   }
  }
  await this.save({
   ...row,
   revision: row.revision + 1,
   cleanup: remaining,
   warning: remaining.length
    ? [row.warning, '部分中间文件未能清理，已保留恢复记录'].filter(Boolean).join('；')
    : row.warning,
   updated: new Date().toISOString()
  })
  return remaining
 }
 async cleanupCompleted(id: string) {
  await this.initialize()
  return this.exclusive(async () => {
   const row = this.records.get(idSchema.parse(id))
   if (!row || row.state !== 'completed') throw new Error('成果未完成，不能清理')
   if (!row.cleanup.length) return []
   try {
    return await this.clearIntermediates(row)
   } catch {
    await this.save({...row, revision: row.revision + 1, warning: '成果或清理记录未通过核对，原中间文件保留'})
    return row.cleanup
   }
  })
 }
 async file(id: string) {
  const row = await this.read(id)
  if (row.state !== 'completed' || !row.outputs.length) throw new Error('此任务尚无已核验成果')
  for (const expected of row.outputs) {
   const actual = await this.evidence(id, expected.relative)
   if (actual.hash !== expected.hash || actual.bytes !== expected.bytes) throw new Error('成果已改变或缺失，请重新检查')
  }
  return (await this.ownedFile(id, row.outputs[0].relative)).path
 }
 async taskDirectory(id: string) {
  await this.read(id)
  return this.directory(id)
 }
}
