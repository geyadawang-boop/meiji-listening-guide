import {createHash, randomUUID} from 'node:crypto'
import {createReadStream, existsSync} from 'node:fs'
import {readFile, mkdir, lstat, copyFile, rename, rm} from 'node:fs/promises'
import {join, resolve, sep, dirname} from 'node:path'
import {z} from 'zod'
import type {RuntimeManifest, RuntimeStatus} from '../shared/runtime'
const file = z.object({
 path: z.string().min(1).max(500),
 size: z.number().int().nonnegative(),
 sha256: z.string().regex(/^[a-f0-9]{64}$/)
})
const manifest = z.object({
 schema: z.literal(1),
 productVersion: z.string(),
 components: z
  .array(
   z.object({
    id: z.string(),
    label: z.string(),
    directory: z.string(),
    files: z.array(file).max(50000),
    bytes: z.number()
   })
  )
  .max(10)
})
export function contained(root: string, relative: string) {
 if (
  !relative ||
  relative.includes('\\') ||
  relative.includes(':') ||
  relative.split('/').some(x => !x || x === '.' || x === '..')
 )
  throw new Error('组件路径无效')
 const target = resolve(root, relative)
 if (!target.startsWith(resolve(root) + sep)) throw new Error('组件路径越界')
 return target
}
async function regular(root: string, relative: string) {
 const target = contained(root, relative)
 let current = resolve(root)
 if ((await lstat(current)).isSymbolicLink()) throw new Error('组件目录不能是链接')
 for (const part of relative.split('/')) {
  current = join(current, part)
  if ((await lstat(current)).isSymbolicLink()) throw new Error('组件不能包含链接')
 }
 if (!(await lstat(target)).isFile()) throw new Error('组件文件无效')
 return target
}
export async function hashFile(path: string) {
 const hash = createHash('sha256')
 if ((await lstat(path)).size < 1048576) hash.update(await readFile(path))
 else for await (const chunk of createReadStream(path, {highWaterMark: 1048576})) hash.update(chunk)
 return hash.digest('hex')
}
export class RuntimeComponents {
 constructor(
  private resources: string,
  private version: string
 ) {}
 private async manifest(): Promise<RuntimeManifest> {
  const result = manifest.parse(JSON.parse(await readFile(join(this.resources, 'runtime-manifest.json'), 'utf8')))
  if (result.productVersion !== this.version) throw new Error('组件清单与应用版本不一致')
  return result
 }
 async status(): Promise<RuntimeStatus> {
  const data = await this.manifest()
  return {
   version: this.version,
   components: data.components.map(c => ({
    id: c.id,
    label: c.label,
    bytes: c.bytes,
    installed: c.files.every(f => existsSync(contained(join(this.resources, c.directory), f.path)))
   }))
  }
 }
 async install(id: string, source: string, signal: AbortSignal, progress: (message: string) => void) {
  const catalog = await this.manifest(),
   component = catalog.components.find(c => c.id === id)
  if (!component) throw new Error('未知组件')
  const target = contained(this.resources, component.directory)
  if (existsSync(target)) throw new Error('组件目录已存在；请使用完整更新包修复，避免覆盖正在使用的文件')
  const descriptor = JSON.parse(await readFile(await regular(source, 'component.json'), 'utf8'))
  if (descriptor.id !== id || descriptor.productVersion !== this.version)
   throw new Error('请选择与当前应用版本一致的组件包')
  const payload = join(source, 'payload'),
   stage = join(this.resources, '.component-' + randomUUID())
  await mkdir(stage)
  let published = false
  try {
   let cursor = 0,
    done = 0,
    halt = false
   const results = await Promise.allSettled(
    Array.from({length: 8}, async () => {
     try {
      while (!halt && cursor < component.files.length) {
       signal.throwIfAborted()
       const entry = component.files[cursor++],
        input = await regular(payload, entry.path)
       if ((await lstat(input)).size !== entry.size || (await hashFile(input)) !== entry.sha256)
        throw new Error('组件校验失败：' + entry.path)
       const output = contained(stage, entry.path)
       await mkdir(dirname(output), {recursive: true})
       await copyFile(input, output)
       if ((await hashFile(output)) !== entry.sha256) throw new Error('组件复制校验失败')
       if (++done % 200 === 0) progress(`正在校验组件 ${done}/${component.files.length}`)
      }
     } catch (error) {
      halt = true
      throw error
     }
    })
   )
   const failed = results.find(r => r.status === 'rejected')
   if (failed?.status === 'rejected') throw failed.reason
   signal.throwIfAborted()
   await rename(stage, target)
   published = true
   return {installed: true, id}
  } finally {
   if (!published) await rm(stage, {recursive: true, force: true})
  }
 }
}
