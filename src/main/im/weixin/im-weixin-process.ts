import koffi from 'koffi'
import {basename, resolve} from 'node:path'
import type {WeixinMemory} from '@main/im/weixin/im-weixin-crypto'
let cached: ReturnType<typeof api> | undefined
function api() {
 if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('本机微信只读需要 Windows x64')
 const k = koffi.load('kernel32.dll'),
  nt = koffi.load('ntdll.dll'),
  p = koffi.pointer('void'),
  f = (name: string, result: string, args: Parameters<typeof k.func>[3]) => k.func('__stdcall', name, result, args)
 return {
  open: f('OpenProcess', 'void *', ['uint32_t', 'int', 'uint32_t']),
  close: f('CloseHandle', 'int', [p]),
  snapshot: f('CreateToolhelp32Snapshot', 'void *', ['uint32_t', 'uint32_t']),
  first: f('Process32FirstW', 'int', [p, p]),
  next: f('Process32NextW', 'int', [p, p]),
  modFirst: f('Module32FirstW', 'int', [p, p]),
  modNext: f('Module32NextW', 'int', [p, p]),
  image: f('QueryFullProcessImageNameW', 'int', [p, 'uint32_t', p, koffi.inout(koffi.pointer('uint32_t'))]),
  times: f('GetProcessTimes', 'int', [p, p, p, p, p]),
  read: f('ReadProcessMemory', 'int', [p, p, p, 'size_t', koffi.out(koffi.pointer('size_t'))]),
  query: f('VirtualQueryEx', 'size_t', [p, p, p, 'size_t']),
  current: f('GetCurrentProcess', 'void *', []),
  duplicate: f('DuplicateHandle', 'int', [p, p, p, koffi.out(koffi.pointer(p)), 'uint32_t', 'int', 'uint32_t']),
  fileType: f('GetFileType', 'uint32_t', [p]),
  filePath: f('GetFinalPathNameByHandleW', 'uint32_t', [p, p, 'uint32_t', 'uint32_t']),
  handles: nt.func('__stdcall', 'NtQueryInformationProcess', 'int32_t', [
   p,
   'uint32_t',
   p,
   'uint32_t',
   koffi.out(koffi.pointer('uint32_t'))
  ])
 }
}
function a() {
 return (cached ??= api())
}
function invalid(h: bigint) {
 return !h || h === 0xffffffffffffffffn
}
function wide(buffer: Buffer, offset = 0, length = (buffer.length - offset) / 2) {
 return buffer
  .subarray(offset, offset + length * 2)
  .toString('utf16le')
  .split('\0')[0]
}
export class WeixinProcessMemory implements WeixinMemory {
 private handle: bigint
 private deadline = Date.now() + 30000
 private scanned = 0
 readonly created: number
 readonly exe: string
 module = {base: 0, size: 0}
 constructor(
  readonly pid: number,
  expected?: number,
  expectedExecutable = 'weixin.exe'
 ) {
  if (!Number.isInteger(pid) || pid <= 0) throw new Error('微信进程编号无效')
  this.handle = a().open(0x450, 0, pid) as bigint
  if (invalid(this.handle)) throw new Error('无法只读打开所选微信进程')
  try {
   const identity = this.identity()
   this.created = identity.created
   this.exe = identity.exe
   if (
    basename(this.exe).toLowerCase() !== expectedExecutable.toLowerCase() ||
    (expected !== undefined && expected !== this.created)
   )
    throw new Error('所选微信进程已变化')
  } catch (error) {
   this.close()
   throw error
  }
 }
 private identity() {
  const path = Buffer.alloc(65536),
   size = [32768],
   creation = Buffer.alloc(8),
   other = Buffer.alloc(8)
  if (!a().image(this.handle, 0, path, size) || !a().times(this.handle, creation, other, other, other))
   throw new Error('微信进程身份读取失败')
  return {
   exe: resolve(wide(path, 0, size[0])),
   created: Number(creation.readBigUInt64LE() / 10n - 11644473600000000n) / 1000000
  }
 }
 guard = () => {
  if (!this.handle || Date.now() > this.deadline) throw new Error('本机微信读取达到预算或会话已关闭')
  const value = this.identity()
  if (value.created !== this.created || value.exe !== this.exe) throw new Error('微信进程或账号已变化，请重新核验')
 }
 budget(ms: number) {
  this.deadline = Date.now() + ms
  this.scanned = 0
  this.guard()
 }
 read = (address: number, length: number) => {
  this.guard()
  if (
   !Number.isSafeInteger(address) ||
   address < 65536 ||
   !Number.isSafeInteger(length) ||
   length < 1 ||
   length > 1049600
  )
   throw new Error('微信只读内存范围无效')
  this.scanned += length
  if (this.scanned > 4 * 1024 ** 3) throw new Error('微信只读扫描达到预算')
  const buffer = Buffer.alloc(length),
   count = [0]
  if (!a().read(this.handle, BigInt(address), buffer, length, count) || count[0] !== length) {
   buffer.fill(0)
   return undefined
  }
  return buffer
 }
 loadModule() {
  const snapshot = a().snapshot(0x18, this.pid) as bigint
  if (invalid(snapshot)) throw new Error('微信模块目录读取失败')
  try {
   const entry = Buffer.alloc(1080)
   entry.writeUInt32LE(entry.length)
   let ok = a().modFirst(snapshot, entry)
   while (ok) {
    this.guard()
    if (wide(entry, 48, 256).toLowerCase() === 'weixin.dll') {
     this.module = {base: Number(entry.readBigUInt64LE(24)), size: entry.readUInt32LE(32)}
     return
    }
    entry.writeUInt32LE(entry.length)
    ok = a().modNext(snapshot, entry)
   }
   throw new Error('未找到受支持的微信主模块')
  } finally {
   a().close(snapshot)
  }
 }
 find = (needle: Buffer) => {
  if (!needle.length || needle.length > 1024) throw new Error('微信扫描标记无效')
  const hits: number[] = []
  let address = 0
  const mbi = Buffer.alloc(48)
  while (a().query(this.handle, BigInt(address), mbi, 48)) {
   this.guard()
   const base = Number(mbi.readBigUInt64LE(0)),
    size = Number(mbi.readBigUInt64LE(24)),
    state = mbi.readUInt32LE(32),
    protect = mbi.readUInt32LE(36)
   if (!Number.isSafeInteger(size) || size <= 0 || base + size <= address) break
   if (state === 4096 && protect & 255 & 230 && !(protect & 256))
    for (let offset = 0; offset < size; offset += 1048576) {
     const buffer = this.read(base + offset, Math.min(1048576 + needle.length - 1, size - offset))
     if (!buffer) continue
     try {
      let pos = -1
      while ((pos = buffer.indexOf(needle, pos + 1)) >= 0 && pos < 1048576) {
       hits.push(base + offset + pos)
       if (hits.length > 4096) throw new Error('微信扫描标记超出预算')
      }
     } finally {
      buffer.fill(0)
     }
    }
   address = base + size
   if (address >= 140737488355328) break
  }
  return hits
 }
 accountRoot() {
  this.guard()
  let size = 65536,
   buffer = Buffer.alloc(size),
   required = [0],
   status = a().handles(this.handle, 51, buffer, size, required)
  if (status < 0 && required[0] > size && required[0] <= 8 * 1024 * 1024) {
   size = required[0]
   buffer = Buffer.alloc(size)
   status = a().handles(this.handle, 51, buffer, size, required)
  }
  if (status < 0) throw new Error('无法核验微信打开的数据库')
  const count = Number(buffer.readBigUInt64LE())
  if (!Number.isSafeInteger(count) || count > 65536 || 16 + count * 40 > buffer.length)
   throw new Error('微信数据库句柄达到预算')
  const roots = new Set<string>()
  for (let i = 0; i < count; i++) {
   this.guard()
   const duplicate: [bigint | null] = [null]
   if (
    !a().duplicate(this.handle, buffer.readBigUInt64LE(16 + i * 40), a().current(), duplicate, 0, 0, 2) ||
    !duplicate[0]
   )
    continue
   try {
    if (a().fileType(duplicate[0]) !== 1) continue
    const path = Buffer.alloc(65536),
     length = a().filePath(duplicate[0], path, 32768, 0) as number
    if (!length || length >= 32768) continue
    let value = wide(path, 0, length)
    if (value.startsWith('\\\\?\\UNC\\')) value = '\\\\' + value.slice(8)
    else if (value.startsWith('\\\\?\\')) value = value.slice(4)
    const match = /^(.*)\\db_storage\\.+\.db$/i.exec(value)
    if (match) roots.add(resolve(match[1]))
   } finally {
    a().close(duplicate[0])
   }
  }
  if (roots.size !== 1) throw new Error('所选微信进程未对应唯一账号目录')
  return [...roots][0]
 }
 close() {
  if (this.handle) {
   a().close(this.handle)
   this.handle = 0n
  }
 }
}
export function weixinProcesses() {
 const snapshot = a().snapshot(2, 0) as bigint
 if (invalid(snapshot)) throw new Error('本机微信进程目录不可用')
 const processes: {pid: number; created: number; label: string}[] = []
 try {
  const entry = Buffer.alloc(568)
  entry.writeUInt32LE(entry.length)
  let ok = a().first(snapshot, entry)
  while (ok) {
   if (wide(entry, 44, 260).toLowerCase() === 'weixin.exe') {
    let memory: WeixinProcessMemory | undefined
    try {
     memory = new WeixinProcessMemory(entry.readUInt32LE(8))
     processes.push({pid: memory.pid, created: memory.created, label: '本机微信 · PID ' + memory.pid})
    } catch {
    } finally {
     memory?.close()
    }
    if (processes.length >= 16) break
   }
   entry.writeUInt32LE(entry.length)
   ok = a().next(snapshot, entry)
  }
 } finally {
  a().close(snapshot)
 }
 return {processes, coverage: 'local_processes_only', keys_scanned: false}
}
