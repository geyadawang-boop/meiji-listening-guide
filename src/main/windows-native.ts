import koffi from 'koffi'
import {isAbsolute} from 'node:path'
let cached: ReturnType<typeof createApi> | undefined
function createApi() {
 if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('此系统组件需要 Windows x64')
 const kernel = koffi.load('kernel32.dll'),
  crypt = koffi.load('crypt32.dll'),
  pointer = koffi.pointer('void')
 const blob = koffi.struct({size: 'uint32_t', data: pointer})
 const basic = koffi.struct({
  processTime: 'int64_t',
  jobTime: 'int64_t',
  flags: 'uint32_t',
  minSet: 'size_t',
  maxSet: 'size_t',
  active: 'uint32_t',
  affinity: 'size_t',
  priority: 'uint32_t',
  scheduling: 'uint32_t'
 })
 const io = koffi.struct(
  Object.fromEntries(
   ['readOps', 'writeOps', 'otherOps', 'readBytes', 'writeBytes', 'otherBytes'].map(name => [name, 'uint64_t'])
  )
 )
 const limits = koffi.struct({
  basic,
  io,
  processMemory: 'size_t',
  jobMemory: 'size_t',
  peakProcess: 'size_t',
  peakJob: 'size_t'
 })
 const security = koffi.struct({size: 'uint32_t', descriptor: pointer, inherit: 'int32_t'})
 const startup = koffi.struct({
  cb: 'uint32_t',
  reserved: pointer,
  desktop: pointer,
  title: pointer,
  x: 'uint32_t',
  y: 'uint32_t',
  xSize: 'uint32_t',
  ySize: 'uint32_t',
  xChars: 'uint32_t',
  yChars: 'uint32_t',
  fill: 'uint32_t',
  flags: 'uint32_t',
  show: 'uint16_t',
  reservedSize: 'uint16_t',
  reservedBytes: pointer,
  stdin: pointer,
  stdout: pointer,
  stderr: pointer
 })
 const startupEx = koffi.struct({startup, attributes: pointer}),
  info = koffi.struct({process: pointer, thread: pointer, pid: 'uint32_t', tid: 'uint32_t'})
 const fn = (name: string, result: string, args: Parameters<typeof kernel.func>[3]) =>
  kernel.func('__stdcall', name, result, args)
 return {
  blob,
  limits,
  security,
  startupEx,
  info,
  protect: crypt.func('__stdcall', 'CryptProtectData', 'int32_t', [
   koffi.pointer(blob),
   pointer,
   pointer,
   pointer,
   pointer,
   'uint32_t',
   koffi.out(koffi.pointer(blob))
  ]),
  unprotect: crypt.func('__stdcall', 'CryptUnprotectData', 'int32_t', [
   koffi.pointer(blob),
   pointer,
   pointer,
   pointer,
   pointer,
   'uint32_t',
   koffi.out(koffi.pointer(blob))
  ]),
  localFree: fn('LocalFree', 'void *', [pointer]),
  lastError: fn('GetLastError', 'uint32_t', []),
  close: fn('CloseHandle', 'int32_t', [pointer]),
  createJob: fn('CreateJobObjectW', 'void *', [pointer, 'str16']),
  setJob: fn('SetInformationJobObject', 'int32_t', [pointer, 'int32_t', koffi.pointer(limits), 'uint32_t']),
  initAttributes: fn('InitializeProcThreadAttributeList', 'int32_t', [
   pointer,
   'uint32_t',
   'uint32_t',
   koffi.inout(koffi.pointer('size_t'))
  ]),
  updateAttributes: fn('UpdateProcThreadAttribute', 'int32_t', [
   pointer,
   'uint32_t',
   'size_t',
   pointer,
   'size_t',
   pointer,
   pointer
  ]),
  deleteAttributes: fn('DeleteProcThreadAttributeList', 'void', [pointer]),
  createFile: fn('CreateFileW', 'void *', [
   'str16',
   'uint32_t',
   'uint32_t',
   koffi.pointer(security),
   'uint32_t',
   'uint32_t',
   pointer
  ]),
  createProcess: fn('CreateProcessW', 'int32_t', [
   'str16',
   pointer,
   pointer,
   pointer,
   'int32_t',
   'uint32_t',
   pointer,
   'str16',
   koffi.pointer(startupEx),
   koffi.out(koffi.pointer(info))
  ]),
  open: fn('OpenProcess', 'void *', ['uint32_t', 'int32_t', 'uint32_t']),
  assignJob: fn('AssignProcessToJobObject', 'int32_t', [pointer, pointer]),
  wait: fn('WaitForSingleObject', 'uint32_t', [pointer, 'uint32_t']),
  exitCode: fn('GetExitCodeProcess', 'int32_t', [pointer, koffi.out(koffi.pointer('uint32_t'))])
 }
}
function api() {
 return (cached ??= createApi())
}
function checked(value: unknown) {
 if (!value) throw new Error('Windows 系统调用失败：' + api().lastError())
 return value
}
/** Same current-user DPAPI format as the retired backend; no intermediate key files. */
export function windowsProtect(raw: Buffer, decrypt = false) {
 if (!raw.length || raw.length > 16 * 1024 * 1024) throw new Error('系统加密输入大小无效')
 const a = api(),
  output: {size?: number; data?: bigint} = {}
 checked((decrypt ? a.unprotect : a.protect)({size: raw.length, data: raw}, null, null, null, null, 1, output))
 try {
  if (!output.data || !Number.isSafeInteger(output.size) || output.size! < 0 || output.size! > 16 * 1024 * 1024)
   throw new Error('系统加密输出无效')
  return Buffer.from(koffi.decode(output.data, 'uint8_t', output.size!))
 } finally {
  if (output.data) a.localFree(output.data)
 }
}
export function windowsArgument(input: string) {
 if (input.includes('\0')) throw new Error('进程参数包含空字符')
 return !input || /[\s"]/.test(input)
  ? '"' + input.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1') + '"'
  : input
}
/** Atomic Windows Job membership before the child runs. Closing the handle also stops descendants. */
export class NativeWindowsJob {
 private handle: bigint | null
 private processes = new Set<bigint>()
 constructor() {
  const a = api()
  this.handle = checked(a.createJob(null, null)) as bigint
  try {
   checked(a.setJob(this.handle, 9, {basic: {flags: 0x2000}}, koffi.sizeof(a.limits)))
  } catch (error) {
   this.close()
   throw error
  }
 }
 /** Adopt a newly forked idle child before sending it any work or credentials. */
 adopt(pid: number) {
  if (!this.handle || !Number.isInteger(pid) || pid <= 0) throw new Error('进程所属任务无效')
  const a = api(),
   handle = checked(a.open(0x101, 0, pid)) as bigint
  try {
   checked(a.assignJob(this.handle, handle))
  } finally {
   a.close(handle)
  }
 }
 spawn(args: string[], cwd: string, environment: Record<string, string | undefined>) {
  const a = api()
  if (!this.handle || !args.length || !isAbsolute(args[0]) || !isAbsolute(cwd))
   throw new Error('进程所属任务已关闭或路径无效')
  const size = [0]
  a.initAttributes(null, 2, 0, size)
  if (!size[0] || size[0] > 1048576) throw new Error('Windows 进程属性大小无效')
  const attributes = Buffer.alloc(Number(size[0]))
  checked(a.initAttributes(attributes, 2, 0, size))
  let nul: bigint | undefined
  const info: {process?: bigint; thread?: bigint; pid?: number; tid?: number} = {}
  try {
   const job = Buffer.alloc(8)
   job.writeBigUInt64LE(this.handle)
   checked(a.updateAttributes(attributes, 0, 0x2000d, job, 8, null, null))
   nul = a.createFile(
    'NUL',
    0xc0000000,
    3,
    {size: koffi.sizeof(a.security), descriptor: null, inherit: 1},
    3,
    0,
    null
   ) as bigint
   if (!nul || nul === 0xffffffffffffffffn) throw new Error('Windows 空设备句柄创建失败')
   const handles = Buffer.alloc(8)
   handles.writeBigUInt64LE(nul)
   checked(a.updateAttributes(attributes, 0, 0x20002, handles, 8, null, null))
   const command = Buffer.from(args.map(windowsArgument).join(' ') + '\0', 'utf16le'),
    env = Buffer.from(
     Object.entries(environment)
      .filter((entry): entry is [string, string] => entry[1] !== undefined)
      .map(([key, value]) => {
       if (!key || /[=\0]/.test(key) || value.includes('\0')) throw new Error('进程环境变量无效')
       return key + '=' + value
      })
      .sort((a, b) => a.toUpperCase().localeCompare(b.toUpperCase()))
      .join('\0') + '\0\0',
     'utf16le'
    )
   checked(
    a.createProcess(
     args[0],
     command,
     null,
     null,
     1,
     0x00080000 | 0x08000000 | 0x00000400,
     env,
     cwd,
     {startup: {cb: koffi.sizeof(a.startupEx), flags: 0x100, stdin: nul, stdout: nul, stderr: nul}, attributes},
     info
    )
   )
   this.processes.add(info.process!)
   a.close(info.thread!)
   const handle = info.process!,
    pid = info.pid!
   return {
    pid,
    poll: () => {
     const wait = a.wait(handle, 0)
     if (wait === 258) return null
     if (wait !== 0) throw new Error('进程状态核验失败')
     const code = [0]
     checked(a.exitCode(handle, code))
     return Number(code[0])
    }
   }
  } finally {
   if (nul && nul !== 0xffffffffffffffffn) a.close(nul)
   a.deleteAttributes(attributes)
  }
 }
 close() {
  if (this.handle) {
   api().close(this.handle)
   this.handle = null
  }
  for (const handle of this.processes) api().close(handle)
  this.processes.clear()
 }
}
