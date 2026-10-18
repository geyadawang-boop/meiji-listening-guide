import Database from 'better-sqlite3'
import {mkdir, lstat, realpath} from 'node:fs/promises'
import {join, resolve} from 'node:path'
/** SQLite's OS locks release on process exit; a PID file alone cannot provide this guarantee. */
export async function acquireDownloadQueue(
 root: string,
 ownerName: 'native-download-owner.sqlite' | 'native-research-owner.sqlite' = 'native-download-owner.sqlite'
) {
 const directory = resolve(root)
 await mkdir(directory, {recursive: true})
 if (
  (await lstat(directory)).isSymbolicLink() ||
  resolve(await realpath(directory)).toLowerCase() !== directory.toLowerCase()
 )
  throw new Error('下载进程目录无效')
 const path = join(directory, ownerName)
 try {
  const file = await lstat(path)
  if (!file.isFile() || file.isSymbolicLink()) throw new Error('下载进程所有权文件无效')
 } catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
 }
 const db = new Database(path, {timeout: 0})
 try {
  db.exec(
   'PRAGMA journal_mode=DELETE; BEGIN EXCLUSIVE; CREATE TABLE IF NOT EXISTS native_owner (pid INTEGER NOT NULL); DELETE FROM native_owner;'
  )
  db.prepare('INSERT INTO native_owner(pid) VALUES (?)').run(process.pid)
 } catch {
  db.close()
  throw new Error('此下载目录已由另一个进程使用，请先关闭原进程')
 }
 return {
  close: () => {
   if (db.open) db.close()
  }
 }
}
