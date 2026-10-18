import {Cookie, CookieJar} from 'tough-cookie'
import {randomUUID} from 'node:crypto'
import {lstat, mkdir, readFile, realpath, rename, writeFile} from 'node:fs/promises'
import {join, resolve} from 'node:path'
import {z} from 'zod'
import {windowsProtect} from '@main/security/windows-native'
import type {MediaCrypt} from '@main/security/worker-crypt'
import type {NativeMediaOptions} from '@main/media/core/media-options'
const vaultLimit = 8 * 1024 * 1024
const key = z.string().regex(/^[a-f0-9]{32}$/)
const profile = z
 .object({
  id: key,
  name: z.string().min(1).max(80),
  site: z.string().max(253),
  cookies: z.string().max(1_048_576),
  count: z.number().int().positive().max(2000),
  updated_at: z.number().int().nonnegative()
 })
 .strict()
type Profile = z.infer<typeof profile>
type Fetcher = (url: string, init?: RequestInit) => Promise<Response>
export function mediaCookieScope(value: string) {
 const site = value
  .trim()
  .toLowerCase()
  .replace(/^\.+|\.+$/g, '')
 if (
  !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(site) ||
  ['co.uk', 'com.cn', 'com.au'].includes(site)
 )
  throw new Error('请填写具体站点域名，不含协议、端口或路径')
 return site
}
const belongs = (host: string, site: string) => host === site || host.endsWith('.' + site)
export function parseMediaCookies(text: string, scope: string) {
 const site = mediaCookieScope(scope),
  jar = new CookieJar(),
  rows: string[] = [],
  seen = new Set<string>()
 if (Buffer.byteLength(text) > 1_048_576) throw new Error('Cookie 文件超过 1 MB')
 for (const raw of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
  const httpOnly = raw.startsWith('#HttpOnly_'),
   line = httpOnly ? raw.slice(10) : raw
  if (!line || line.startsWith('#')) continue
  const cells = line.split('\t')
  if (cells.length !== 7) throw new Error('请使用 Netscape cookies.txt 格式')
  const [rawDomain, subs, path, secure, expires, name, value] = cells,
   domain = rawDomain.replace(/^\./, '').toLowerCase()
  if (!belongs(domain, site)) continue
  if (
   !['TRUE', 'FALSE'].includes(subs) ||
   !['TRUE', 'FALSE'].includes(secure) ||
   !/^\d{1,13}$/.test(expires) ||
   !path.startsWith('/') ||
   /[\x00-\x20\x7f;,=]/.test(name) ||
   !name ||
   name.length > 256 ||
   value.length > 16384 ||
   /[\x00-\x1f\x7f;]/.test(value) ||
   /[\x00-\x20\x7f;]/.test(path)
  )
   throw new Error('Cookie 字段格式无效')
  const seconds = Number(expires)
  if (seconds && seconds <= Date.now() / 1000) continue
  const id = domain + '\n' + path + '\n' + name
  if (seen.has(id)) continue
  seen.add(id)
  const cookie = new Cookie({
   key: name,
   value,
   domain,
   path,
   secure: secure === 'TRUE',
   httpOnly,
   hostOnly: subs === 'FALSE',
   expires: seconds ? new Date(seconds * 1000) : 'Infinity'
  })
  jar.setCookieSync(cookie, 'https://' + domain + path, {ignoreError: false})
  rows.push(
   [
    httpOnly ? '#HttpOnly_' + rawDomain.toLowerCase() : rawDomain.toLowerCase(),
    subs,
    path,
    secure,
    expires,
    name,
    value
   ].join('\t')
  )
 }
 if (!rows.length || rows.length > 2000) throw new Error('没有匹配该域名且未过期的 Cookie')
 return {jar, count: rows.length, text: '# Netscape HTTP Cookie File\n' + rows.join('\n') + '\n'}
}
/** System-encrypted vault, never a plaintext temporary cookie file. */
export class NativeMediaAuth {
 private serial: Promise<unknown> = Promise.resolve()
 constructor(
  private root: string,
  private crypt: MediaCrypt = windowsProtect
 ) {}
 private async path() {
  const folder = resolve(this.root, 'download-auth')
  await mkdir(folder, {recursive: true})
  if ((await lstat(folder)).isSymbolicLink() || resolve(await realpath(folder)).toLowerCase() !== folder.toLowerCase())
   throw new Error('登录档案目录无效')
  return join(folder, 'profiles.dpapi')
 }
 private async read() {
  const path = await this.path()
  try {
   const info = await lstat(path)
   if (!info.isFile() || info.isSymbolicLink() || info.size > vaultLimit) throw new Error('登录档案文件无效')
   return z.record(key, profile).parse(JSON.parse((await this.crypt(await readFile(path), true)).toString('utf8')))
  } catch (error) {
   if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {} as Record<string, Profile>
   throw new Error('登录档案不能在当前系统用户下读取，请重新导入')
  }
 }
 private public(row: Profile) {
  return {id: row.id, name: row.name, site: row.site, count: row.count, updated_at: row.updated_at}
 }
 async list() {
  await this.serial
  return Object.values(await this.read()).map(row => this.public(row))
 }
 private async mutate<T>(fn: (rows: Record<string, Profile>) => T) {
  const task = this.serial.then(async () => {
   const rows = await this.read(),
    result = fn(rows),
    path = await this.path(),
    temporary = path + '.' + randomUUID() + '.writing'
   const sealed = await this.crypt(Buffer.from(JSON.stringify(rows)))
   if (sealed.length > vaultLimit) throw new Error('登录档案加密后超过 8 MB，未保存')
   await writeFile(temporary, sealed, {flag: 'wx'})
   await rename(temporary, path)
   return result
  })
  this.serial = task.catch(() => {})
  return task
 }
 save(input: unknown) {
  const request = z
    .object({
     name: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .refine(value => !/[\x00-\x1f]/.test(value)),
     site: z.string(),
     cookies: z.string(),
     id: key.optional()
    })
    .strict()
    .parse(input),
   site = mediaCookieScope(request.site),
   parsed = parseMediaCookies(request.cookies, site)
  return this.mutate(rows => {
   if (request.id && !rows[request.id]) throw new Error('所选登录档案不存在')
   if (!request.id && Object.keys(rows).length >= 50) throw new Error('最多保存 50 个站点档案')
   const id = request.id || randomUUID().replaceAll('-', ''),
    row = {
     id,
     name: request.name,
     site,
     cookies: parsed.text,
     count: parsed.count,
     updated_at: Math.floor(Date.now() / 1000)
    }
   rows[id] = row
   return this.public(row)
  })
 }
 remove(id: string) {
  key.parse(id)
  return this.mutate(rows => {
   if (!rows[id]) throw new Error('所选登录档案不存在')
   delete rows[id]
   return true
  })
 }
 async scoped(url: string, options: NativeMediaOptions, base: Fetcher): Promise<Fetcher> {
  if (!options.use_cookies || !options.cookie_profile) return base
  const rows = await this.read(),
   selected = rows[key.parse(options.cookie_profile)]
  if (!selected || !belongs(new URL(url).hostname, selected.site)) throw new Error('登录档案不属于当前视频站点')
  const {jar} = parseMediaCookies(selected.cookies, selected.site)
  return async (input, init = {}) => {
   const target = new URL(input),
    headers = new Headers(init.headers)
   headers.delete('cookie')
   headers.delete('authorization')
   if (
    target.protocol === 'https:' &&
    !target.username &&
    !target.password &&
    !target.port &&
    belongs(target.hostname, selected.site)
   ) {
    const cookies = jar.getCookieStringSync(target.href)
    if (cookies) headers.set('cookie', cookies)
   }
   // Redirects are resolved only after an explicit new domain check, never by the HTTP client.
   return base(target.href, {...init, headers, credentials: 'omit', redirect: 'error'})
  }
 }
}
