import {open, rename, stat} from 'node:fs/promises'
import {videoMediaUrl} from '@main/media/bilibili/video-policy'

export async function downloadVideoMedia(
 media: string,
 destination: string,
 request: (url: string, init: RequestInit) => Promise<Response>,
 progress: (text: string) => void,
 signal: AbortSignal,
 idleMs = 60000
) {
 const idle = new AbortController(),
  active = AbortSignal.any([signal, idle.signal])
 let timer: ReturnType<typeof setTimeout> | undefined,
  stalled = false
 const touch = () => {
  clearTimeout(timer)
  timer = setTimeout(() => {
   stalled = true
   idle.abort()
  }, idleMs)
 }
 touch()
 try {
  active.throwIfAborted()
  let response: Response | undefined,
   next = media
  for (let i = 0; i < 6; i++) {
   if (!videoMediaUrl(next)) throw new Error('下载链接不是受支持的 B 站 MP4 视频')
   response = await request(next, {signal: active, redirect: 'manual', headers: {Referer: 'https://www.bilibili.com/'}})
   touch()
   if ([301, 302, 303, 307, 308].includes(response.status)) {
    const location = response.headers.get('location')
    await response.body?.cancel()
    if (!location) throw new Error('下载重定向无效')
    next = new URL(location, next).href
    response = undefined
    continue
   }
   break
  }
  if (!response?.ok || !response.body) throw new Error('视频下载失败，链接可能已过期，请重新提取')
  const expected = Number(response.headers.get('content-length') || 0)
  const file = await open(destination + '.partial', 'w'),
   reader = response.body.getReader()
  let bytes = 0,
   last = 0
  const cancel = () => {
   void reader.cancel().catch(() => {})
  }
  active.addEventListener('abort', cancel, {once: true})
  try {
   for (;;) {
    active.throwIfAborted()
    const {done, value} = await reader.read()
    active.throwIfAborted()
    if (done) break
    touch()
    let offset = 0
    while (offset < value.length) {
     const written = await file.write(value, offset, value.length - offset)
     offset += written.bytesWritten
    }
    bytes += value.length
    if (Date.now() - last > 1000) {
     progress(
      `下载视频：${(bytes / 1048576).toFixed(1)} MB${expected ? ' / ' + (expected / 1048576).toFixed(1) + ' MB' : ''}`
     )
     last = Date.now()
    }
   }
   await file.sync()
  } finally {
   active.removeEventListener('abort', cancel)
   await file.close()
   await reader.cancel().catch(() => {})
  }
  if (bytes < 1024 || (expected && bytes !== expected)) throw new Error('视频下载不完整，已保留临时文件，请重试')
  await rename(destination + '.partial', destination)
  if ((await stat(destination)).size !== bytes) throw new Error('视频保存校验失败')
 } catch (error) {
  if (stalled && !signal.aborted) throw new Error('视频下载连续 60 秒没有收到数据，已停止并保留临时文件，请重试')
  throw error
 } finally {
  clearTimeout(timer)
 }
}
