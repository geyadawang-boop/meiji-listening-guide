import {readFile, writeFile, readdir, mkdir, copyFile, cp, rename, lstat} from 'node:fs/promises'
import {createReadStream} from 'node:fs'
import {createHash} from 'node:crypto'
import {spawnSync} from 'node:child_process'
import {resolve, join, relative} from 'node:path'
import {createRequire} from 'node:module'
const root = resolve('.'),
 target = resolve(root, '../梅酱的听课指南-副本'),
 source = join(root, 'release/portable/win-unpacked'),
 version = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version as string
if (target !== resolve('D:/ChatGPT/New project/梅酱的听课指南-副本')) throw Error('Unexpected installation target')
const backup = join(target, '.runtime-before-' + version)
for (const path of [source, target]) if ((await lstat(path)).isSymbolicLink()) throw Error('Installation paths cannot be links')
const running = spawnSync('powershell.exe', ['-NoProfile', '-Command', "@(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -like 'D:\\ChatGPT\\New project\\梅酱的听课指南-副本\\*' }).Count"], {encoding: 'utf8', windowsHide: true})
if (running.status !== 0 || running.stdout.trim() !== '0') throw Error('Please close the installed copy before updating')
async function hash(path: string) {
 const h = createHash('sha256')
 for await (const bytes of createReadStream(path)) h.update(bytes)
 return h.digest('hex')
}
async function snapshot(directory: string): Promise<unknown[]> {
 const rows: unknown[] = []
 async function walk(path: string) {
  for (const entry of await readdir(path, {withFileTypes: true})) {
   const file = join(path, entry.name),
    stat = await lstat(file)
   if (stat.isSymbolicLink()) throw Error('User data link needs explicit review')
   if (stat.isDirectory()) await walk(file)
   else rows.push({path: relative(directory, file), size: stat.size, mtime: stat.mtimeMs})
  }
 }
 await walk(directory)
 return rows
}
const original = resolve(root, '../listening-assistant/release-0.1.71/win-unpacked/resources/app.asar'),
 originalHash = await hash(original)
const before = {courses: await snapshot(join(target, '课程数据')), materials: await snapshot(join(target, '资料'))}
const manifest = JSON.parse(await readFile(join(root, 'resources/runtime-manifest.json'), 'utf8'))
if (manifest.productVersion !== version) throw Error('Wrong runtime manifest version')
let runtimeFilesVerified = 0
for (const component of manifest.components)
 for (const file of component.files) {
  const path = join(source, 'resources', component.directory, ...file.path.split('/'))
  if ((await hash(path)) !== file.sha256) throw Error('Runtime resource hash mismatch: ' + file.path)
  runtimeFilesVerified++
 }
const asar = createRequire(import.meta.url)('@electron/asar'),
 packed = join(source, 'resources/app.asar')
if (JSON.parse(asar.extractFile(packed, 'package.json').toString()).version !== version) throw Error('Packaged application version mismatch')
await mkdir(backup)
await writeFile(join(backup, 'user-data-before.json'), JSON.stringify(before))
await rename(join(target, 'resources'), join(backup, 'resources'))
for (const entry of await readdir(source, {withFileTypes: true}))
 if (entry.isFile()) {
  const current = join(target, entry.name)
  try {
   await copyFile(current, join(backup, entry.name))
  } catch (error) {
   if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  await copyFile(join(source, entry.name), current)
 }
await cp(join(source, 'resources'), join(target, 'resources'), {recursive: true, errorOnExist: true, force: false})
await cp(join(source, 'locales'), join(target, 'locales'), {recursive: true})
const after = {courses: await snapshot(join(target, '课程数据')), materials: await snapshot(join(target, '资料'))}
if (JSON.stringify(before) !== JSON.stringify(after) || (await hash(original)) !== originalHash) throw Error('Protected user data or original application changed')
const appAsarSha256 = await hash(join(target, 'resources/app.asar'))
if (appAsarSha256 !== (await hash(packed))) throw Error('Installed application hash differs')
const report = {version, target, backup, installedAt: new Date().toISOString(), appAsarSha256, runtimeFilesVerified, userCoursesAndMaterialsUnchanged: true, originalUntouched: true, actualInstalledStartupVerified: false}
await writeFile(join(root, 'TypeScript' + version + '安装记录.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report))
