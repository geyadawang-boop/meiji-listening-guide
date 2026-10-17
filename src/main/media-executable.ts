import {constants} from 'node:fs'
import {access, lstat, realpath} from 'node:fs/promises'
import {dirname, isAbsolute, relative, resolve, sep} from 'node:path'

export type MediaTool = 'ffmpeg' | 'ffprobe'
export function mediaTool(value: unknown): MediaTool {
 if (value !== 'ffmpeg' && value !== 'ffprobe') throw new Error('媒体工具名称无效')
 return value
}
export function mediaExecutablePath(resources: string, tool: MediaTool, platform: NodeJS.Platform = process.platform) {
 mediaTool(tool)
 if (!isAbsolute(resources)) throw new Error('媒体资源目录必须是绝对路径')
 if (!['win32', 'darwin', 'linux'].includes(platform)) throw new Error('此平台尚未提供媒体执行组件')
 return resolve(resources, 'video', tool + (platform === 'win32' ? '.exe' : ''))
}
/** Resolve only app-owned tools; never search PATH or change executable permissions. */
export async function checkedMediaExecutable(
 resources: string,
 tool: MediaTool,
 platform: NodeJS.Platform = process.platform
) {
 try {
  const path = mediaExecutablePath(resources, tool, platform),
   item = await lstat(path)
  if (!item.isFile() || item.isSymbolicLink()) throw new Error('媒体执行文件必须是普通文件')
  for (let parent = dirname(path); ; parent = dirname(parent)) {
   const directory = await lstat(parent)
   if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error('媒体执行目录包含链接或无效路径')
   if (dirname(parent) === parent) break
  }
  const target = resolve(await realpath(path)),
   base = resolve(await realpath(resources)),
   compare = (value: string) => (platform === 'win32' ? value.toLowerCase() : value),
   inside = relative(base, target)
  if (
   compare(target) !== compare(path) ||
   !inside ||
   inside === '..' ||
   inside.startsWith('..' + sep) ||
   isAbsolute(inside)
  )
   throw new Error('媒体执行文件超出资源目录或路径已改变')
  if (platform !== 'win32') await access(target, constants.X_OK)
  return target
 } catch (error) {
  const code = (error as NodeJS.ErrnoException)?.code
  if (code === 'ENOENT' || code === 'ENOTDIR') throw new Error('未找到媒体处理组件', {cause: error})
  if (code === 'EACCES' || code === 'EPERM') throw new Error('媒体组件不可执行或无访问权限', {cause: error})
  throw error
 }
}
