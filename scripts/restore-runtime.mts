import {createReadStream, constants} from 'node:fs'
import {copyFile, lstat, mkdir, readFile, writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {join, resolve, dirname} from 'node:path'
import {fileURLToPath} from 'node:url'
import {z} from 'zod'
export const componentFile = z.object({
 path: z
  .string()
  .min(1)
  .refine(
   path => !/[\\:\x00-\x1f]/.test(path) && path.split('/').every(part => !!part && part !== '.' && part !== '..')
  ),
 size: z.number().int().nonnegative().safe(),
 sha256: z.string().regex(/^[a-f0-9]{64}$/)
})
const manifestSchema = z.object({
 schema: z.literal(1),
 productVersion: z.string(),
 components: z.array(z.object({id: z.string(), directory: z.string().regex(/^[a-z]+$/), files: z.array(componentFile)}))
})
async function noLinks(base: string, relative: string, missing = false) {
 let current = resolve(base)
 for (const part of ['', ...relative.split('/')]) {
  if (part) current = join(current, part)
  try {
   if ((await lstat(current)).isSymbolicLink()) throw new Error('运行资源不能经过目录链接')
  } catch (error) {
   if (missing && (error as NodeJS.ErrnoException).code === 'ENOENT') return
   throw error
  }
 }
}
async function hash(path: string) {
 const digest = createHash('sha256')
 for await (const bytes of createReadStream(path)) digest.update(bytes)
 return digest.digest('hex')
}
export async function restoreNativeComponent(root: string, id: string, pack: string) {
 const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')),
  manifest = manifestSchema.parse(JSON.parse(await readFile(join(root, 'resources/runtime-manifest.json'), 'utf8'))),
  component = manifest.components.find(item => item.id === id)
 await noLinks(pack, 'component.json')
 const descriptor = z
  .object({schema: z.literal(1), id: z.string(), productVersion: z.string()})
  .parse(JSON.parse(await readFile(join(pack, 'component.json'), 'utf8')))
 if (
  !component ||
  manifest.productVersion !== pkg.version ||
  descriptor.productVersion !== pkg.version ||
  descriptor.id !== id
 )
  throw new Error('组件或版本与当前源码不符')
 const missing: {input: string; output: string; file: z.infer<typeof componentFile>}[] = []
 // Validate every source and existing destination before copying any missing file.
 for (const file of component.files) {
  await noLinks(pack, 'payload/' + file.path)
  await noLinks(root, 'resources/' + component.directory + '/' + file.path, true)
  const input = join(pack, 'payload', ...file.path.split('/')),
   output = join(root, 'resources', component.directory, ...file.path.split('/')),
   item = await lstat(input)
  if (!item.isFile() || item.size !== file.size || (await hash(input)) !== file.sha256)
   throw new Error('组件文件哈希或大小不符：' + file.path)
  try {
   const old = await lstat(output)
   if (!old.isFile() || old.size !== file.size || (await hash(output)) !== file.sha256)
    throw new Error('已有资源被修改，原文件保留：' + file.path)
  } catch (error) {
   if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
   missing.push({input, output, file})
  }
 }
 for (const row of missing) {
  await mkdir(dirname(row.output), {recursive: true})
  await noLinks(root, 'resources/' + component.directory + '/' + row.file.path, true)
  await copyFile(row.input, row.output, constants.COPYFILE_EXCL)
  if ((await hash(row.output)) !== row.file.sha256) throw new Error('恢复后校验失败：' + row.file.path)
 }
 return {
  id,
  version: pkg.version,
  verified: component.files.length,
  restored: missing.length,
  existingFilesPreserved: true
 }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
 console.log(
  JSON.stringify(
   await restoreNativeComponent(
    resolve(dirname(fileURLToPath(import.meta.url)), '..'),
    process.argv[2],
    resolve(process.argv[3] || '')
   )
  )
 )
