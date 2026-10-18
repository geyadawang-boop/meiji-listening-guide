import Database from 'better-sqlite3'
import {access, cp, mkdir, readFile, rename, writeFile} from 'node:fs/promises'
import {join, relative, isAbsolute, resolve} from 'node:path'
import {Store} from '@main/storage/db'
import {categories, ensureLibrary} from '@main/library/library'

async function exists(path: string) {
 try {
  await access(path)
  return true
 } catch (error) {
  if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
  throw error
 }
}
export async function openPortableLibrary(appDirectory: string, machineRoot: string, legacyLibrary: string) {
 const root = join(appDirectory, '课程数据'),
  libraryRoot = join(appDirectory, '资料')
 await mkdir(root, {recursive: true})
 const database = join(root, 'assistant.db'),
  location = join(root, 'library-location.json')
 let previousRoot = libraryRoot
 if (await exists(location)) previousRoot = JSON.parse(await readFile(location, 'utf8')).libraryRoot
 else if (!(await exists(database))) {
  // Only course files/database migrate. Account and settings directories stay on this computer.
  for (const category of categories) {
   const source = join(legacyLibrary, category)
   if (await exists(source))
    await cp(source, join(libraryRoot, category), {recursive: true, force: false, errorOnExist: false})
  }
  const legacyDatabase = join(machineRoot, 'assistant.db')
  if (await exists(legacyDatabase)) {
   const legacy = new Database(legacyDatabase, {readonly: true, fileMustExist: true})
   try {
    await legacy.backup(database + '.migrating')
   } finally {
    legacy.close()
   }
   await rename(database + '.migrating', database)
  }
  previousRoot = legacyLibrary
 }
 const store = new Store(root)
 try {
  await ensureLibrary(
   libraryRoot,
   store.courses().map(c => c.name)
  )
  const relocate = async (path: string) => {
   if (!path) return path
   const rel = relative(resolve(previousRoot), resolve(path))
   if (!rel || rel === '..' || rel.startsWith('..\\') || rel.startsWith('../') || isAbsolute(rel)) return path
   const target = join(libraryRoot, rel)
   return (await exists(target)) ? target : path
  }
  const updates: Array<() => void> = []
  for (const row of store.db.prepare('SELECT id,path FROM course_files').all() as {id: string; path: string}[]) {
   const path = await relocate(row.path)
   if (path !== row.path)
    updates.push(() => {
     store.db.prepare('UPDATE course_files SET path=? WHERE id=?').run(path, row.id)
    })
  }
  for (const row of store.db.prepare('SELECT id,ppt_path,transcript_path FROM lectures').all() as {
   id: string
   ppt_path: string
   transcript_path: string
  }[]) {
   const ppt = await relocate(row.ppt_path),
    transcript = await relocate(row.transcript_path)
   if (ppt !== row.ppt_path || transcript !== row.transcript_path)
    updates.push(() => {
     store.db.prepare('UPDATE lectures SET ppt_path=?,transcript_path=? WHERE id=?').run(ppt, transcript, row.id)
    })
  }
  store.db.transaction(() => updates.forEach(update => update()))()
  store.db.pragma('wal_checkpoint(FULL)')
  await writeFile(location, JSON.stringify({libraryRoot}), 'utf8')
  return {store, libraryRoot}
 } catch (error) {
  store.close()
  throw error
 }
}
