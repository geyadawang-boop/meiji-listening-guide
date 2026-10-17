import {createHash, randomUUID} from 'node:crypto'
import {createReadStream} from 'node:fs'
import {lstat, readFile, rename, writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {z} from 'zod'
export async function mediaFileHash(path: string) {
 const hash = createHash('sha256')
 for await (const bytes of createReadStream(path)) hash.update(bytes)
 return hash.digest('hex')
}
const hash = z.string().regex(/^[a-f0-9]{64}$/)
const reservation = z
 .object({
  version: z.literal(1),
  owner: z.string().uuid(),
  name: z.string(),
  plan: hash,
  prior: z.array(z.string()).max(1000)
 })
 .strict()
const receipt = z
 .object({version: z.literal(1), owner: z.string().uuid(), plan: hash, bytes: z.number().int().positive().safe(), hash})
 .strict()
async function exists(path: string) {
 try {
  const info = await lstat(path)
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('媒体成果记录不是普通文件')
  return info
 } catch (error) {
  if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
  throw error
 }
}
async function json(path: string) {
 const info = await exists(path)
 if (!info || info.size > 256000) throw new Error('媒体成果记录缺失或无效')
 return JSON.parse(await readFile(path, 'utf8'))
}
async function atomic(path: string, value: unknown) {
 await exists(path)
 await exists(path + '.writing')
 await writeFile(path + '.writing', JSON.stringify(value))
 await rename(path + '.writing', path)
}
/** Reservation precedes FFmpeg. Incomplete app-owned output is retained until a verified successor exists. */
export class OwnedMediaArtifact {
 readonly path: string
 private owner: z.infer<typeof reservation> | undefined
 private reserve: string
 private proof: string
 constructor(
  private directory: string,
  private name: string,
  private plan: string
 ) {
  if (
   !name ||
   /[\\/<>:"|?*\x00-\x1f]/.test(name) ||
   name.includes('..') ||
   ['job.json', 'job.writing', 'job.dpapi', 'job.writing.dpapi'].includes(name)
  )
   throw new Error('媒体成果文件名无效')
  hash.parse(plan)
  this.path = join(directory, name)
  this.reserve = this.path + '.reservation.json'
  this.proof = this.path + '.receipt.json'
 }
 async prepare() {
  const file = await exists(this.path),
   reserved = await exists(this.reserve),
   proved = await exists(this.proof)
  let owner: z.infer<typeof reservation> | undefined
  if (reserved) {
   owner = reservation.parse(await json(this.reserve))
   if (
    owner.name !== this.name ||
    owner.plan !== this.plan ||
    owner.prior.some(
     name =>
      !name.startsWith('.incomplete-') ||
      !name.endsWith('-' + this.name) ||
      !z
       .string()
       .uuid()
       .safeParse(name.slice('.incomplete-'.length, -('-' + this.name).length)).success
    )
   )
    throw new Error('已有媒体恢复记录与本次设置不同，原文件保留')
  }
  if (proved) {
   const proof = receipt.parse(await json(this.proof))
   if (
    !owner ||
    !file ||
    proof.owner !== owner.owner ||
    proof.plan !== this.plan ||
    proof.bytes !== file.size ||
    proof.hash !== (await mediaFileHash(this.path))
   )
    throw new Error('已有待发布成果被修改或缺失，原文件保留')
   this.owner = owner
   return {reused: true, path: this.path}
  }
  if (file) {
   if (!owner) throw new Error('媒体输出已经存在，未覆盖原文件')
   const archived = `.incomplete-${owner.owner}-${this.name}`
   if (await exists(join(this.directory, archived))) throw new Error('媒体恢复备份已存在，保留当前文件')
   await rename(this.path, join(this.directory, archived))
   owner = {...owner, owner: randomUUID(), prior: [...owner.prior, archived]}
   await atomic(this.reserve, owner)
  } else if (owner) {
   const archived = `.incomplete-${owner.owner}-${this.name}`
   if (await exists(join(this.directory, archived))) {
    owner = {...owner, owner: randomUUID(), prior: [...owner.prior, archived]}
    await atomic(this.reserve, owner)
   }
  }
  if (!owner) {
   owner = {version: 1, owner: randomUUID(), name: this.name, plan: this.plan, prior: []}
   await atomic(this.reserve, owner)
  }
  this.owner = owner
  return {reused: false, path: this.path}
 }
 async finish() {
  if (!this.owner) throw new Error('成果尚未预留')
  const file = await exists(this.path)
  if (!file || !file.size) throw new Error('媒体成果为空')
  const value = {
   version: 1 as const,
   owner: this.owner.owner,
   plan: this.plan,
   bytes: file.size,
   hash: await mediaFileHash(this.path)
  }
  if (await exists(this.proof)) {
   const prior = receipt.parse(await json(this.proof))
   if (JSON.stringify(prior) !== JSON.stringify(value)) throw new Error('媒体核验记录已改变')
  } else await atomic(this.proof, value)
  return value
 }
 intermediates() {
  if (!this.owner) throw new Error('成果尚未预留')
  return [
   this.name + '.reservation.json',
   this.name + '.reservation.json.writing',
   this.name + '.receipt.json',
   this.name + '.receipt.json.writing',
   ...this.owner.prior
  ]
 }
}
