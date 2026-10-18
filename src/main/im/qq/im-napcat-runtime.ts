import JSZip from 'jszip'
import {createHash, randomBytes, randomUUID} from 'node:crypto'
import {createServer} from 'node:net'
import {readFile, writeFile, mkdir, lstat, realpath, rename, rm} from 'node:fs/promises'
import {join, resolve, dirname, sep} from 'node:path'
import {NativeWindowsJob, windowsProtect} from '@main/security/windows-native'
import {imLocalJson} from '@main/im/core/im-loopback'
import {z} from 'zod'
import type {MediaCrypt} from '@main/security/worker-crypt'
const version = '4.18.37',
 archiveSha = '05c79761361321f6af4358aef92f80a7f8e319b6459c260ebf9a159615e96fe4'
const secretsSchema = z.object({
 webui_port: z.number().int().min(1024).max(65535),
 onebot_port: z.number().int().min(1024).max(65535),
 webui_token: z.string().regex(/^[a-f0-9]{64}$/),
 onebot_token: z.string().regex(/^[a-f0-9]{64}$/)
})
export type NativeNapcatSecrets = z.infer<typeof secretsSchema>
const sha = (data: Buffer) => createHash('sha256').update(data).digest('hex')
async function freePort() {
 const server = createServer()
 await new Promise<void>((resolve, reject) => {
  server.once('error', reject)
  server.listen(0, '127.0.0.1', resolve)
 })
 const port = (server.address() as {port: number}).port
 await new Promise<void>((resolve, reject) => server.close(error => (error ? reject(error) : resolve())))
 return port
}
/** Pinned third-party JS component, with no Python launcher and no visible WebUI. */
export class NativeNapcatRuntime {
 private state = 'stopped'
 private code = ''
 private job: NativeWindowsJob | undefined
 private child: {pid: number; poll: () => number | null} | undefined
 private pending: Promise<NativeNapcatSecrets> | undefined
 private value: NativeNapcatSecrets | undefined
 private closed = false
 constructor(
  private resources: string,
  private root: string,
  private crypt: MediaCrypt = windowsProtect
 ) {}
 status() {
  return {version, state: this.state, code: this.code, owned_running: !!this.child && this.child.poll() === null}
 }
 private async owned(path: string) {
  const base = resolve(this.root),
   target = resolve(path)
  if (target !== base && !target.startsWith(base + sep)) throw new Error('QQ 组件路径越界')
  let current = base
  for (const part of target.slice(base.length).split(sep).filter(Boolean)) {
   current = join(current, part)
   try {
    if (
     (await lstat(current)).isSymbolicLink() ||
     resolve(await realpath(current)).toLowerCase() !== current.toLowerCase()
    )
     throw new Error('QQ 组件路径包含链接')
   } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
   }
  }
  return target
 }
 async prepare() {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('内置 QQ 后台暂仅支持 Windows x64')
  await mkdir(this.root, {recursive: true})
  if (
   (await lstat(this.root)).isSymbolicLink() ||
   resolve(await realpath(this.root)).toLowerCase() !== resolve(this.root).toLowerCase()
  )
   throw new Error('QQ 组件根目录无效')
  const bytes = await readFile(join(this.resources, 'knowledge/vendor/NapCat.Shell.Windows.Node.zip'))
  if (sha(bytes) !== archiveSha) throw new Error('QQ 组件压缩包校验失败')
  const zip = await JSZip.loadAsync(bytes),
   entries = Object.values(zip.files)
  if (entries.length > 20000) throw new Error('QQ 组件文件数量无效')
  for (const entry of entries) {
   const name = entry.unsafeOriginalName || entry.name,
    mode = typeof entry.unixPermissions === 'string' ? parseInt(entry.unixPermissions, 8) : entry.unixPermissions || 0
   if (
    /[:\x00]/.test(name) ||
    name.startsWith('/') ||
    name.includes('\\') ||
    name.split('/').some(part => part === '..') ||
    (mode & 0o170000) === 0o120000
   )
    throw new Error('QQ 组件包路径无效')
  }
  const target = await this.owned(join(this.root, 'native-v' + version)),
   marker = join(target, '.native-package.json')
  let exists = false
  try {
   const descriptor = JSON.parse(await readFile(marker, 'utf8'))
   if (descriptor.sha256 !== archiveSha) throw new Error('QQ 组件版本标记无效')
   exists = true
  } catch (error) {
   if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
   try {
    await lstat(target)
    throw new Error('QQ 组件安装未完成，请保留现场并修复')
   } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
   }
  }
  if (!exists) {
   const stage = await this.owned(join(this.root, '.native-stage-' + randomUUID()))
   await mkdir(stage)
   let published = false,
    total = 0
   try {
    for (const entry of entries) {
     const path = join(stage, entry.name)
     if (!path.startsWith(stage + sep)) throw new Error('QQ 组件解压路径无效')
     if (entry.dir) {
      await mkdir(path, {recursive: true})
      continue
     }
     const bytes = await entry.async('nodebuffer')
     total += bytes.length
     if (total > 500 * 1024 * 1024) throw new Error('QQ 组件解压大小无效')
     await mkdir(dirname(path), {recursive: true})
     await writeFile(path, bytes, {flag: 'wx'})
    }
    await writeFile(join(stage, '.native-package.json'), JSON.stringify({version, sha256: archiveSha}), {flag: 'wx'})
    await rename(stage, target)
    published = true
   } finally {
    if (!published) await rm(await this.owned(stage), {recursive: true, force: true})
   }
  }
  for (const name of ['node.exe', 'index.js', 'napcat/napcat.mjs', 'wrapper.node', 'package.json', 'config.json']) {
   const original = zip.file(name)
   if (!original) throw new Error('QQ 组件缺少必要文件')
   if (sha(await readFile(await this.owned(join(target, name)))) !== sha(await original.async('nodebuffer')))
    throw new Error('QQ 组件执行文件已改变')
  }
  const privatePath = await this.owned(join(this.root, 'native-owner.dpapi'))
  let value: NativeNapcatSecrets
  try {
   value = secretsSchema.parse(JSON.parse((await this.crypt(await readFile(privatePath), true)).toString('utf8')))
  } catch (error) {
   if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
   value = {
    webui_port: await freePort(),
    onebot_port: await freePort(),
    webui_token: randomBytes(32).toString('hex'),
    onebot_token: randomBytes(32).toString('hex')
   }
   if (value.webui_port === value.onebot_port) throw new Error('通讯端口冲突，请重试')
   await writeFile(privatePath, await this.crypt(Buffer.from(JSON.stringify(value))), {flag: 'wx'})
  }
  const config = await this.owned(join(target, 'napcat/config'))
  await mkdir(config, {recursive: true})
  try {
   const env = await readFile(await this.owned(join(config, '.env')), 'utf8')
   if (
    env
     .replace(/^\uFEFF/, '')
     .split(/\r?\n/)
     .some(line => line.trim() && !line.trim().startsWith('#'))
   )
    throw new Error('QQ 组件环境文件已改变，未启动')
  } catch (error) {
   if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  await writeFile(
   await this.owned(join(config, 'webui.json')),
   JSON.stringify({host: '127.0.0.1', port: value.webui_port, token: value.webui_token, autoLoginAccount: ''})
  )
  const settingsPath = await this.owned(join(config, 'napcat.json')),
   settings = JSON.parse(await readFile(settingsPath, 'utf8'))
  await writeFile(settingsPath, JSON.stringify({...settings, fileLog: false, consoleLog: false}))
  this.value = value
  return {directory: target, value}
 }
 ensure() {
  if (process.platform !== 'win32' || process.arch !== 'x64')
   return Promise.reject(new Error('内置 QQ 后台暂仅支持 Windows x64'))
  if (this.closed) return Promise.reject(new Error('QQ 组件所属服务已关闭'))
  if (this.child?.poll() === null) return Promise.resolve(this.value!)
  return (this.pending ??= this.start().finally(() => {
   this.pending = undefined
  }))
 }
 private async start() {
  this.state = 'preparing'
  this.code = ''
  try {
   const {directory, value} = await this.prepare()
   if (this.closed) throw new Error('QQ 组件所属服务已关闭')
   for (const port of [value.webui_port, value.onebot_port]) {
    const server = createServer()
    await new Promise<void>((resolve, reject) => {
     server.once('error', () => reject(new Error('QQ 组件端口被占用，未连接未知进程')))
     server.listen(port, '127.0.0.1', resolve)
    })
    await new Promise<void>(resolve => server.close(() => resolve()))
   }
   const env = {...process.env}
   for (const key of [
    'NAPCAT_QUICK_ACCOUNT',
    'NAPCAT_QUICK_PASSWORD',
    'NAPCAT_QUICK_PASSWORD_MD5',
    'NODE_OPTIONS',
    'NODE_PATH',
    'ELECTRON_RUN_AS_NODE',
    'NAPCAT_WORKER_PROCESS',
    'NAPCAT_WEBUI_PREFERRED_PORT'
   ])
    delete env[key]
   Object.assign(env, {
    NAPCAT_WORKDIR: join(directory, 'napcat'),
    NAPCAT_DISABLE_MULTI_PROCESS: '1',
    NAPCAT_WEBUI_SECRET_KEY: value.webui_token
   })
   this.job?.close()
   this.job = new NativeWindowsJob()
   this.child = this.job.spawn([join(directory, 'node.exe'), join(directory, 'index.js')], directory, env)
   this.state = 'starting'
   const deadline = Date.now() + 40000
   while (Date.now() < deadline) {
    if (this.closed || this.child.poll() !== null) throw new Error('QQ 组件启动后退出')
    try {
     const response = await imLocalJson(
      'http://127.0.0.1:' + value.webui_port,
      '/api/auth/login',
      {hash: sha(Buffer.from(value.webui_token + '.napcat'))},
      '',
      AbortSignal.timeout(2000)
     )
     const data = z.object({code: z.literal(0), data: z.object({Credential: z.string().min(1)})}).parse(response)
     if (data.data.Credential) {
      this.state = 'ready'
      return value
     }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 500))
   }
   throw new Error('QQ 组件启动超时，请检查组件状态')
  } catch (error) {
   this.job?.close()
   this.job = undefined
   this.child = undefined
   this.state = 'failed'
   this.code = 'native-start-failed'
   throw error
  }
 }
 dispose() {
  this.closed = true
  this.job?.close()
  this.job = undefined
  this.child = undefined
  this.state = 'stopped'
 }
}
