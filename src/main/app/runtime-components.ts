import {createHash, randomUUID} from 'node:crypto'
import {createReadStream, existsSync, constants} from 'node:fs'
import {readFile, mkdir, lstat, copyFile, rename, rm, open, realpath} from 'node:fs/promises'
import {join, resolve, sep, dirname} from 'node:path'
import {z} from 'zod'
import type {RuntimeManifest, RuntimeStatus} from '@shared/runtime'
import {runtimeManifestV2Schema} from '@shared/runtime-manifest-v2'
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
 private statusRequest?: Promise<RuntimeStatus>
 constructor(
  private resources: string,
  private version: string
 ) {}
 private async manifest(): Promise<RuntimeManifest> {
  const raw = JSON.parse(await readFile(join(this.resources, 'runtime-manifest.json'), 'utf8'))
  if (raw?.schema === 2) throw new Error('v2 组件仅支持只读校验，尚未开放安装')
  const result = manifest.parse(raw)
  if (result.productVersion !== this.version) throw new Error('组件清单与应用版本不一致')
  return result
 }
 status(): Promise<RuntimeStatus> {
  if (!this.statusRequest) {
   const request = this.readStatus()
   this.statusRequest = request
   void request
    .finally(() => {
     if (this.statusRequest === request) this.statusRequest = undefined
    })
    .catch(() => {})
  }
  return this.statusRequest
 }
 private async readStatus(): Promise<RuntimeStatus> {
  let raw: unknown
  try {
   const path = join(this.resources, 'runtime-manifest.json'),
    item = await lstat(path)
   if (!item.isFile() || item.isSymbolicLink() || item.nlink !== 1 || item.size > 16 * 1024 * 1024)
    throw new Error('invalid')
   for (let parent = dirname(path); ; parent = dirname(parent)) {
    const directory = await lstat(parent)
    if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error('invalid')
    if (dirname(parent) === parent) break
   }
   const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0)),
    chunks: Buffer[] = []
   let size = 0
   try {
    const before = await handle.stat()
    if (before.dev !== item.dev || before.ino !== item.ino) throw new Error('invalid')
    for await (const bytes of handle.createReadStream({autoClose: false})) {
     size += bytes.length
     if (size > 16 * 1024 * 1024) throw new Error('invalid')
     chunks.push(bytes)
    }
    const after = await handle.stat(),
     current = await lstat(path)
    if (
     before.mtimeMs !== after.mtimeMs ||
     before.ctimeMs !== after.ctimeMs ||
     before.size !== size ||
     current.dev !== before.dev ||
     current.ino !== before.ino
    )
     throw new Error('invalid')
   } finally {
    await handle.close()
   }
   raw = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
   return {version: this.version, validation: 'invalid', reason: '组件清单无法读取或格式无效', components: []}
  }
  if ((raw as {schema?: unknown})?.schema === 2) {
   const parsed = runtimeManifestV2Schema.safeParse(raw)
   if (!parsed.success || parsed.data.productVersion !== this.version)
    return {version: this.version, validation: 'invalid', reason: 'v2 组件清单格式或应用版本不符', components: []}
   const data = parsed.data,
    compatible = data.target.platform === process.platform && data.target.arch === process.arch
   const components: RuntimeStatus['components'] = []
   for (const component of data.components) {
    let validation: 'verified' | 'missing' | 'invalid' | 'unsupported_target' = compatible
     ? 'verified'
     : 'unsupported_target'
    let reason = compatible ? '文件完整性与权限已校验；v2 安装尚未开放' : '组件目标与当前系统或架构不符'
    if (compatible)
     try {
      for (const file of component.files) {
       const path = contained(contained(this.resources, component.directory), file.path)
       for (let parent = dirname(path); ; parent = dirname(parent)) {
        const directory = await lstat(parent)
        if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error('invalid')
        if (dirname(parent) === parent) break
       }
       const item = await lstat(path)
       if (
        !item.isFile() ||
        item.isSymbolicLink() ||
        item.nlink !== 1 ||
        item.size !== file.size ||
        resolve(await realpath(path)) !== resolve(path)
       )
        throw new Error('invalid')
       if (process.platform !== 'win32' && (item.mode & 0o7777) !== (file.mode === '0755' ? 0o755 : 0o644))
        throw new Error('invalid')
       const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0)),
        hash = createHash('sha256')
       let size = 0
       try {
        const before = await handle.stat()
        if (before.dev !== item.dev || before.ino !== item.ino) throw new Error('invalid')
        for await (const bytes of handle.createReadStream({autoClose: false})) {
         size += bytes.length
         if (size > file.size) throw new Error('invalid')
         hash.update(bytes)
        }
        const after = await handle.stat(),
         current = await lstat(path)
        if (
         before.mtimeMs !== after.mtimeMs ||
         before.ctimeMs !== after.ctimeMs ||
         after.size !== file.size ||
         before.dev !== current.dev ||
         before.ino !== current.ino ||
         !current.isFile() ||
         current.isSymbolicLink() ||
         current.nlink !== 1 ||
         (process.platform !== 'win32' && (current.mode & 0o7777) !== (file.mode === '0755' ? 0o755 : 0o644))
        )
         throw new Error('invalid')
       } finally {
        await handle.close()
       }
       if (size !== file.size || hash.digest('hex') !== file.sha256) throw new Error('invalid')
      }
     } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      validation = code === 'ENOENT' || code === 'ENOTDIR' ? 'missing' : 'invalid'
      reason = validation === 'missing' ? '组件文件缺失；v2 安装尚未开放' : '组件文件类型、摘要、大小或权限校验失败'
     }
    components.push({
     id: component.id,
     label: component.label,
     bytes: component.bytes,
     installed: validation === 'verified',
     validation,
     installable: false,
     reason
    })
   }
   return {version: this.version, components}
  }
  let data: RuntimeManifest
  try {
   data = manifest.parse(raw)
   if (data.productVersion !== this.version) throw new Error('version')
  } catch {
   return {version: this.version, validation: 'invalid', reason: '组件清单格式或应用版本不符', components: []}
  }
  return {
   version: this.version,
   validation: 'legacy',
   components: data.components.map(c => ({
    id: c.id,
    label: c.label,
    bytes: c.bytes,
    validation: 'legacy',
    installed:
     c.files.length > 0 && c.files.every(f => existsSync(contained(join(this.resources, c.directory), f.path)))
   }))
  }
 }
 async install(id: string, source: string, signal: AbortSignal, progress: (message: string) => void) {
  const catalog = await this.manifest(),
   component = catalog.components.find(c => c.id === id)
  if (!component) throw new Error('未知组件')
  if (!component.files.length) throw new Error('组件文件清单为空，未安装')
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
