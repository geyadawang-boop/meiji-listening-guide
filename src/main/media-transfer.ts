import {createHash} from 'node:crypto'
import {createReadStream} from 'node:fs'
import {lstat, open, readFile, realpath, rename, writeFile} from 'node:fs/promises'
import {join, resolve} from 'node:path'
import {z} from 'zod'

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>
const checkpointSchema = z
 .object({
  version: z.literal(1),
  identity: z.string(),
  size: z.number().int().nonnegative().safe(),
  hash: z.string().regex(/^[a-f0-9]{64}$/),
  etag: z.string(),
  total: z.number().int().nonnegative().safe().nullable()
 })
 .strict()
async function hashFile(path: string) {
 const hash = createHash('sha256')
 for await (const chunk of createReadStream(path)) hash.update(chunk)
 return hash.digest('hex')
}
const strongETag = (value: string | null) => (value && /^"[^"\r\n]+"$/.test(value) ? value : '')
/** Caller supplies an owned task directory and an already validated platform URL.
 * A returned file is still intermediate; the queue must validate final media before publishing it.
 */
export async function transferMedia(input: {
 directory: string
 key: string
 identity: string
 url: string
 signal: AbortSignal
 fetcher: Fetcher
 headers?: Record<string, string>
 maxBytes?: number
 writeBufferBytes?: number
 chunkBytes?: number
 progress?: (downloaded: number, total: number | null) => void
}) {
 if (!/^[a-zA-Z0-9_-]{1,80}$/.test(input.key) || !input.identity || input.identity.length > 500)
  throw new Error('下载分段标识无效')
 const writeBuffer = input.writeBufferBytes ?? 65536
 if (!Number.isSafeInteger(writeBuffer) || writeBuffer < 1024 || writeBuffer > 10485760)
  throw new Error('下载写入缓冲区大小无效')
 const directory = resolve(input.directory),
  stat = await lstat(directory)
 if (
  !stat.isDirectory() ||
  stat.isSymbolicLink() ||
  resolve(await realpath(directory)).toLowerCase() !== directory.toLowerCase()
 )
  throw new Error('下载任务目录无效')
 const path = join(directory, input.key + '.partial'),
  journal = join(directory, input.key + '.resume.json'),
  lock = join(directory, input.key + '.lock')
 for (const file of [path, journal, lock]) {
  try {
   const info = await lstat(file)
   if (!info.isFile() || info.isSymbolicLink()) throw new Error('下载分段文件无效')
  } catch (error) {
   if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
 }
 // Exclusive lock also protects cancellation/retry from writing the same partial file concurrently.
 const owner = await open(lock, 'wx'),
  max = input.maxBytes ?? 50 * 1024 ** 3
 let size = 0,
  total: number | null = null,
  etag = '',
  mutated = false,
  handle: Awaited<ReturnType<typeof open>> | undefined,
  reader: ReadableStreamDefaultReader<Uint8Array> | undefined
 const abortReader = () => {
  void reader?.cancel().catch(() => {})
 }
 try {
  await owner.writeFile(JSON.stringify({version: 1, pid: process.pid, identity: input.identity}))
  await owner.sync()
  input.signal.throwIfAborted()
  try {
   const old = checkpointSchema.parse(JSON.parse(await readFile(journal, 'utf8'))),
    file = await lstat(path)
   if (
    old.identity === input.identity &&
    file.size === old.size &&
    old.etag &&
    old.size > 0 &&
    old.size <= max &&
    (await hashFile(path)) === old.hash
   ) {
    size = old.size
    total = old.total
    etag = old.etag
   }
  } catch (error) {
   if (input.signal.aborted)
    throw error /* Incomplete crash checkpoints restart instead of appending unverified bytes. */
  }
  const headers = {
   ...input.headers,
   'Accept-Encoding': 'identity',
   ...(size ? {Range: `bytes=${size}-`, 'If-Range': etag} : {})
  }
  const response = await input.fetcher(input.url, {
   headers,
   signal: input.signal,
   redirect: 'error',
   credentials: 'omit'
  })
  if (response.body) reader = response.body.getReader()
  if (
   response.status === 416 &&
   size > 0 &&
   total === size &&
   response.headers.get('content-range') === 'bytes */' + size &&
   strongETag(response.headers.get('etag')) === etag
  )
   return {path, size, hash: await hashFile(path), etag, total}
  if (!response.ok || !response.body) throw new Error(`媒体下载未完成（HTTP ${response.status}）`)
  if (response.headers.get('content-encoding') && response.headers.get('content-encoding') !== 'identity')
   throw new Error('媒体响应压缩方式不支持断点校验')
  const incomingTag = strongETag(response.headers.get('etag'))
  const lengthHeader = response.headers.get('content-length'),
   length = lengthHeader !== null && /^\d+$/.test(lengthHeader) ? Number(lengthHeader) : null
  if (length !== null && !Number.isSafeInteger(length)) throw new Error('媒体长度无效')
  if (size && response.status === 206) {
   const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') || '')
   if (
    !range ||
    Number(range[1]) !== size ||
    Number(range[2]) < size ||
    Number(range[3]) <= Number(range[2]) ||
    incomingTag !== etag ||
    (total !== null && Number(range[3]) !== total) ||
    (length !== null && length !== Number(range[2]) - size + 1)
   )
    throw new Error('断点响应与原分段不一致，请重新建立下载')
   total = Number(range[3])
  } else if (response.status === 200) {
   size = 0
   total = length
   etag = incomingTag
  } else throw new Error('下载服务未正确响应断点请求')
  if (total !== null && (!Number.isSafeInteger(total) || total > max)) throw new Error('媒体大小超过此任务上限')
  handle = await open(path, size ? 'a' : 'w')
  mutated = true
  input.signal.addEventListener('abort', abortReader, {once: true})
  while (true) {
   input.signal.throwIfAborted()
   const chunk = await reader!.read()
   input.signal.throwIfAborted()
   if (chunk.done) break
   if (size + chunk.value.byteLength > max || (total !== null && size + chunk.value.byteLength > total))
    throw new Error('媒体响应超过声明长度')
   let offset = 0
   while (offset < chunk.value.byteLength) {
    input.signal.throwIfAborted()
    const result = await handle.write(chunk.value, offset, Math.min(writeBuffer, chunk.value.byteLength - offset))
    if (!result.bytesWritten) throw new Error('下载写入中断')
    offset += result.bytesWritten
   }
   size += chunk.value.byteLength
   input.progress?.(size, total)
  }
  if ((total !== null && size !== total) || !size) throw new Error('媒体响应不完整，恢复文件已保留')
  await handle.sync()
  await handle.close()
  handle = undefined
  const hash = await hashFile(path)
  await checkpoint(hash)
  return {path, size, hash, etag, total}
 } catch (error) {
  await handle?.close()
  handle = undefined
  if (mutated)
   try {
    const file = await lstat(path)
    if (file.isFile() && !file.isSymbolicLink()) {
     size = file.size
     await checkpoint(await hashFile(path))
    }
   } catch {
    /* Preserve the last valid checkpoint if saving recovery fails. */
   }
  throw error
 } finally {
  input.signal.removeEventListener('abort', abortReader)
  try {
   await reader?.cancel()
  } catch {}
  await handle?.close()
  await owner.close()
  // Remove only this invocation's lock, never downloaded media or a recovery checkpoint.
  const {unlink} = await import('node:fs/promises')
  await unlink(lock)
 }
 async function checkpoint(hash: string) {
  const tmp = journal + '.writing'
  try {
   const info = await lstat(tmp)
   if (!info.isFile() || info.isSymbolicLink()) throw new Error('下载恢复记录路径无效')
  } catch (error) {
   if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  await writeFile(tmp, JSON.stringify({version: 1, identity: input.identity, size, hash, etag, total}))
  await rename(tmp, journal)
 }
}
