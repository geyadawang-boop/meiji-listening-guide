import {createHash} from 'node:crypto'
import {createReadStream} from 'node:fs'
import {lstat, open, writeFile, rename} from 'node:fs/promises'
import {join} from 'node:path'
import {transferMedia} from '@main/media/transfer/media-transfer'
type Input = Parameters<typeof transferMedia>[0]
/** Range workers reuse the same verified-prefix implementation as serial downloads. */
export async function transferMediaRanges(input: Input, concurrency: number) {
 if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 16) throw new Error('并行片段数无效')
 const chunkBytes = input.chunkBytes ?? 0,
  bufferBytes = input.writeBufferBytes ?? 65536
 if (!Number.isSafeInteger(chunkBytes) || chunkBytes < 0 || chunkBytes > 104857600) throw new Error('HTTP 分段大小无效')
 if (!Number.isSafeInteger(bufferBytes) || bufferBytes < 1024 || bufferBytes > 10485760)
  throw new Error('下载写入缓冲区大小无效')
 const serial = async (intermediates: string[] = [], warning = '') => ({
  ...(await transferMedia(input)),
  intermediates,
  warning
 })
 if (concurrency === 1 && !chunkBytes) return serial()
 let size = 0,
  etag = ''
 try {
  const headers = new Headers(input.headers)
  headers.delete('Range')
  headers.delete('If-Range')
  headers.set('Accept-Encoding', 'identity')
  const head = await input.fetcher(input.url, {
   method: 'HEAD',
   headers,
   signal: AbortSignal.any([input.signal, AbortSignal.timeout(20000)]),
   redirect: 'error',
   credentials: 'omit'
  })
  if (head.body) await head.body.cancel()
  size = Number(head.headers.get('content-length') || 0)
  etag = head.headers.get('etag') || ''
  if (
   !head.ok ||
   !Number.isSafeInteger(size) ||
   size < (chunkBytes ? 2 : concurrency * 65536) ||
   !/^"[^"\r\n]+"$/.test(etag) ||
   head.headers.get('accept-ranges')?.toLowerCase() !== 'bytes'
  )
   return serial([], '服务器未提供可核验的分段范围，已使用完整串行下载')
 } catch (error) {
  input.signal.throwIfAborted()
  return serial([], '未取得并行范围，已使用串行下载')
 }
 if (size > (input.maxBytes ?? 50 * 1024 ** 3)) throw new Error('媒体大小超过此任务上限')
 const count = chunkBytes ? Math.ceil(size / chunkBytes) : concurrency
 if (count > 4096) throw new Error('HTTP 分段超过 4096 份，请增加分段大小')
 const controller = new AbortController(),
  signal = AbortSignal.any([input.signal, controller.signal]),
  progress = new Array<number>(count).fill(0)
 const ranges = Array.from({length: count}, (_, index) => ({
  start: chunkBytes ? index * chunkBytes : Math.floor((size * index) / count),
  end: chunkBytes ? Math.min(size, (index + 1) * chunkBytes) - 1 : Math.floor((size * (index + 1)) / count) - 1,
  key: input.key + '-chunk-' + index
 }))
 const intermediates = ranges.flatMap(range => [
  range.key + '.partial',
  range.key + '.resume.json',
  range.key + '.resume.json.writing'
 ])
 let ignored = false,
  failure: unknown
 const download = async (range: (typeof ranges)[number], index: number) => {
  const total = range.end - range.start + 1
  const fetcher: Input['fetcher'] = async (url, init = {}) => {
   const headers = new Headers(init.headers),
    prefix = Number(/^bytes=(\d+)-$/.exec(headers.get('Range') || '')?.[1] || 0)
   // HEAD has just confirmed the whole object. A complete, hash-checked chunk can be reused.
   if (prefix === total)
    return new Response(null, {status: 416, headers: {ETag: etag, 'Content-Range': `bytes */${total}`}})
   headers.set('Range', `bytes=${range.start + prefix}-${range.end}`)
   headers.set('If-Range', etag)
   const response = await input.fetcher(url, {...init, headers, signal})
   if (response.status === 200) {
    await response.body?.cancel()
    ignored = true
    throw new Error('服务器忽略并行范围')
   }
   const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') || '')
   if (
    response.status !== 206 ||
    !match ||
    Number(match[1]) !== range.start + prefix ||
    Number(match[2]) !== range.end ||
    Number(match[3]) !== size ||
    response.headers.get('etag') !== etag
   ) {
    await response.body?.cancel()
    throw new Error('并行响应或媒体版本不一致，保留恢复文件')
   }
   const normalized = new Headers(response.headers)
   normalized.set('content-length', String(total - prefix))
   normalized.set('content-range', `bytes ${prefix}-${total - 1}/${total}`)
   return new Response(response.body, {status: prefix ? 206 : 200, headers: normalized})
  }
  try {
   return await transferMedia({
    ...input,
    key: range.key,
    identity: input.identity + `:range:${range.start}-${range.end}`,
    signal,
    fetcher,
    progress: downloaded => {
     progress[index] = downloaded
     input.progress?.(
      progress.reduce((a, b) => a + b, 0),
      size
     )
    }
   })
  } catch (error) {
   failure ??= error
   controller.abort()
   throw error
  }
 }
 const settled: PromiseSettledResult<Awaited<ReturnType<typeof transferMedia>>>[] = new Array(ranges.length)
 let next = 0
 await Promise.all(
  Array.from({length: Math.min(concurrency, count)}, async () => {
   while (next < ranges.length && !signal.aborted) {
    const index = next++
    try {
     settled[index] = {status: 'fulfilled', value: await download(ranges[index], index)}
    } catch (reason) {
     settled[index] = {status: 'rejected', reason}
    }
   }
  })
 )
 const failed = settled.find(result => result?.status === 'rejected')
 if (failed) {
  input.signal.throwIfAborted()
  if (ignored) return serial(intermediates, '服务器未执行并行范围，已切换串行下载')
  throw failure || failed.reason
 }
 input.signal.throwIfAborted()
 if (settled.filter(result => result?.status === 'fulfilled').length !== count)
  throw new Error('下载分段未全部完成，恢复文件保留')
 const path = join(input.directory, input.key + '.partial'),
  journal = join(input.directory, input.key + '.resume.json'),
  tmp = journal + '.writing'
 for (const target of [path, journal, tmp]) {
  try {
   const item = await lstat(target)
   if (!item.isFile() || item.isSymbolicLink()) throw new Error('并行合并目标无效')
  } catch (error) {
   if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
 }
 const handle = await open(path, 'w'),
  hash = createHash('sha256')
 let written = 0
 try {
  for (const result of settled) {
   if (!result || result.status !== 'fulfilled') throw new Error('并行片段未全部完成')
   for await (const chunk of createReadStream(result.value.path, {highWaterMark: bufferBytes})) {
    input.signal.throwIfAborted()
    const bytes = Buffer.from(chunk)
    hash.update(bytes)
    let offset = 0
    while (offset < bytes.length) {
     input.signal.throwIfAborted()
     const count = await handle.write(bytes, offset, Math.min(bufferBytes, bytes.length - offset))
     if (!count.bytesWritten) throw new Error('合并分段写入中断')
     offset += count.bytesWritten
    }
    written += bytes.length
   }
  }
  if (written !== size) throw new Error('并行片段合并长度不一致')
  await handle.sync()
 } finally {
  await handle.close()
 }
 const digest = hash.digest('hex')
 await writeFile(tmp, JSON.stringify({version: 1, identity: input.identity, size, hash: digest, etag, total: size}))
 await rename(tmp, journal)
 return {path, size, hash: digest, etag, total: size, intermediates, warning: ''}
}
