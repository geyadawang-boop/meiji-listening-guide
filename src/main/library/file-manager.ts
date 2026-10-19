import {readdir, realpath, lstat} from 'node:fs/promises'
import {join, relative, isAbsolute, resolve} from 'node:path'
import {categories} from '@main/library/library'
import type {LibraryFile} from '@shared/types'

export async function managedFile(root: string, path: string) {
 const base = await realpath(root),
  target = resolve(root, path),
  rel = relative(base, target)
 if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('只能管理听课助手资料文件夹中的文件')
 const info = await lstat(target),
  actual = await realpath(target),
  actualRel = relative(base, actual)
 if (info.isSymbolicLink() || !info.isFile() || actualRel.startsWith('..') || isAbsolute(actualRel))
  throw new Error('不能操作文件夹、链接或资料目录以外的文件')
 return target
}
export async function listLibrary(root: string): Promise<LibraryFile[]> {
 const result: LibraryFile[] = []
 async function walk(dir: string, category: string, course = '') {
  for (const entry of await readdir(dir, {withFileTypes: true})) {
   if (entry.isSymbolicLink()) continue
   const path = join(dir, entry.name)
   if (entry.isDirectory()) await walk(path, category, course || entry.name)
   else if (entry.isFile()) {
    const info = await lstat(path)
    result.push({
     path: relative(root, path),
     name: entry.name,
     category,
     course,
     size: info.size,
     modified: info.mtime.toISOString()
    })
   }
  }
 }
 for (const category of categories) await walk(join(root, category), category)
 return result.sort((a, b) => b.modified.localeCompare(a.modified))
}
