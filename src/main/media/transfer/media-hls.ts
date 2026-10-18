import {createHash, createDecipheriv} from 'node:crypto'
import {createReadStream} from 'node:fs'
import {open, readFile} from 'node:fs/promises'
import {boundedPublicText} from '@main/net/public-http'
import {boundedMediaResponse} from '@main/media/core/media-subtitle-download'
import {transferMedia} from '@main/media/transfer/media-transfer'
import {platformMediaAddress} from '@main/media/sources/media-platforms'
import {OwnedMediaArtifact} from '@main/media/core/media-artifact'
import type {NativeMediaOptions} from '@main/media/core/media-options'
type Fetcher = (url: string, init?: RequestInit) => Promise<Response>
function attrs(line: string) {
 const result: Record<string, string> = {},
  raw = line.slice(line.indexOf(':') + 1)
 let consumed = ''
 for (const match of raw.matchAll(/([A-Z0-9-]+)=("[^"]*"|[^,]*)(?:,|$)/g)) {
  if (match.index !== consumed.length || result[match[1]] !== undefined) throw new Error('HLS 属性无效')
  consumed += match[0]
  result[match[1]] = match[2].replace(/^"|"$/g, '')
 }
 if (consumed.length !== raw.length) throw new Error('HLS 属性格式不支持')
 return result
}
export function parseHls(text: string, base: string, check: (url: string) => string) {
 const lines = text
  .replace(/^\ufeff/, '')
  .split(/\r?\n/)
  .map(s => s.trim())
  .filter(Boolean)
 if (lines[0] !== '#EXTM3U' || lines.length > 50000) throw new Error('HLS 清单无效或过大')
 const variants: {url: string; height: number; bandwidth: number; codec: string; audio: string}[] = [],
  audio: {url: string; group: string; preferred: boolean}[] = [],
  segments: {url: string; duration: number; sequence: bigint; key?: {url: string; iv?: string}}[] = []
 let pending: Record<string, string> | undefined,
  duration: number | undefined,
  sequence = 0n,
  key: {url: string; iv?: string} | undefined,
  init: string | undefined,
  ended = false
 const url = (raw: string) => check(new URL(raw, base).href)
 for (const line of lines.slice(1)) {
  if (line.startsWith('#EXT-X-STREAM-INF:')) pending = attrs(line)
  else if (line.startsWith('#EXT-X-MEDIA:')) {
   const a = attrs(line)
   if (a.TYPE === 'AUDIO' && a.URI) audio.push({url: url(a.URI), group: a['GROUP-ID'], preferred: a.DEFAULT === 'YES'})
  } else if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
   const value = line.split(':')[1]
   if (!/^\d{1,20}$/.test(value)) throw new Error('HLS 序号无效')
   sequence = BigInt(value)
  } else if (line.startsWith('#EXTINF:')) {
   duration = Number(line.slice(8).split(',')[0])
   if (!Number.isFinite(duration) || duration <= 0 || duration > 3600) throw new Error('HLS 片段时间无效')
  } else if (line.startsWith('#EXT-X-KEY:')) {
   const a = attrs(line)
   if (a.METHOD === 'NONE') key = undefined
   else {
    if (
     a.METHOD !== 'AES-128' ||
     !a.URI ||
     (a.KEYFORMAT && a.KEYFORMAT !== 'identity') ||
     (a.IV && !/^0x[0-9a-fA-F]{32}$/.test(a.IV))
    )
     throw new Error('此 HLS 加密格式尚不支持')
    key = {url: url(a.URI), iv: a.IV}
   }
  } else if (line.startsWith('#EXT-X-MAP:')) {
   const a = attrs(line)
   if (!a.URI || a.BYTERANGE || key) throw new Error('此 HLS 初始化范围或加密格式尚不支持')
   const next = url(a.URI)
   if (init && init !== next) throw new Error('HLS 初始化轨道改变，请使用独立片段任务')
   init = next
  } else if (line.startsWith('#EXT-X-BYTERANGE:') || line.startsWith('#EXT-X-GAP'))
   throw new Error('此 HLS 字节范围或缺失片段尚不支持')
  else if (line === '#EXT-X-ENDLIST') ended = true
  else if (!line.startsWith('#')) {
   if (pending) {
    const height = Number(pending.RESOLUTION?.split('x')[1] || 0),
     bandwidth = Number(pending.BANDWIDTH || 0)
    if (!Number.isFinite(height) || !Number.isFinite(bandwidth) || height < 0 || bandwidth < 0)
     throw new Error('HLS 格式目录无效')
    variants.push({url: url(line), height, bandwidth, codec: pending.CODECS || '', audio: pending.AUDIO || ''})
    pending = undefined
   } else {
    if (duration === undefined || sequence >= 2n ** 64n) throw new Error('HLS 片段缺少时间或序号')
    segments.push({url: url(line), duration, sequence: sequence++, key})
    duration = undefined
    if (segments.length > 10000) throw new Error('HLS 片段超过本次有界任务上限')
   }
  }
 }
 if (pending || duration !== undefined || (variants.length && segments.length) || variants.length > 200)
  throw new Error('HLS 清单结构不完整')
 if (!variants.length && (!ended || !segments.length))
  throw new Error('仅支持已结束且完整的 HLS 录像，未把直播窗口当作完整视频')
 return {variants, audio, segments, init}
}
/** Downloads every declared VOD segment locally. FFmpeg receives no network URLs or keys. */
export async function downloadNativeHls(input: {
 directory: string
 key: string
 identity: string
 url: string
 platform: string
 options: NativeMediaOptions
 fetcher: Fetcher
 signal: AbortSignal
 headers?: Record<string, string>
 progress?: (downloaded: number, total: null) => void
}) {
 if (!/^track-\d+$/.test(input.key)) throw new Error('HLS 任务标识无效')
 const check = (url: string) => platformMediaAddress(input.platform, url),
  intermediates: string[] = [],
  keys = new Map<string, Buffer>()
 let downloaded = 0
 const read = async (url: string) => {
  const response = await input.fetcher(check(url), {
   signal: input.signal,
   redirect: 'error',
   credentials: 'omit',
   headers: input.headers
  })
  if (!response.ok) {
   await response.body?.cancel()
   throw new Error('HLS 清单未取得')
  }
  return parseHls(await boundedPublicText(response, 2 * 1024 * 1024), url, check)
 }
 const resolve = async (url: string, depth = 0): Promise<{url: string; kind: 'video' | 'audio' | 'combined'}[]> => {
  if (depth > 2) throw new Error('HLS 目录嵌套过多')
  const manifest = await read(url)
  if (!manifest.variants.length) return [{url, kind: 'combined'}]
  const prefix = {auto: '', h264: 'avc', h265: 'hev', vp9: 'vp', av1: 'av01'}[input.options.video_codec],
   picked = manifest.variants
    .filter(
     v =>
      (!input.options.height || (v.height > 0 && v.height <= input.options.height)) &&
      (!prefix || v.codec.includes(prefix))
    )
    .sort((a, b) => b.height - a.height || b.bandwidth - a.bandwidth)[0]
  if (!picked) throw new Error('HLS 没有符合画质和编码要求的格式')
  const audio = manifest.audio
   .filter(a => a.group === picked.audio)
   .sort((a, b) => Number(b.preferred) - Number(a.preferred))[0]
  const paths = await resolve(picked.url, depth + 1)
  if (audio) {
   if (paths.length !== 1) throw new Error('HLS 音轨嵌套有歧义')
   return [
    {url: paths[0].url, kind: 'video'},
    {url: audio.url, kind: 'audio'}
   ]
  }
  return paths
 }
 try {
  const tracks: {path: string; kind: 'video' | 'audio' | 'combined'}[] = []
  for (const [track, selected] of (await resolve(check(input.url))).entries()) {
   const manifest = await read(selected.url)
   if (manifest.variants.length) throw new Error('HLS 音轨需要具体媒体清单')
   const parts = [...(manifest.init ? [{url: manifest.init}] : []), ...manifest.segments],
    proofs: {path: string; hash: string; key?: {url: string; iv?: string}; sequence?: bigint}[] = []
   for (const [index, part] of parts.entries()) {
    input.signal.throwIfAborted()
    const name = input.key + '-hls-' + track + '-' + index,
     result = await transferMedia({
      directory: input.directory,
      key: name,
      identity: createHash('sha256')
       .update(input.identity + part.url)
       .digest('hex'),
      url: part.url,
      headers: input.headers,
      fetcher: input.fetcher,
      signal: input.signal,
      maxBytes: 64 * 1024 * 1024,
      progress: bytes => input.progress?.(downloaded + bytes, null)
     })
    downloaded += result.size
    intermediates.push(name + '.partial', name + '.resume.json', name + '.resume.json.writing')
    proofs.push({
     path: result.path,
     hash: result.hash,
     ...('key' in part ? {key: part.key, sequence: part.sequence} : {})
    })
   }
   const name = input.key + '-hls-' + track + '.media',
    artifact = new OwnedMediaArtifact(
     input.directory,
     name,
     createHash('sha256')
      .update(JSON.stringify(['hls-v1', proofs.map(row => [row.hash, row.key, row.sequence?.toString()])]))
      .digest('hex')
    ),
    prepared = await artifact.prepare()
   if (!prepared.reused) {
    const output = await open(artifact.path, 'wx')
    try {
     let size = 0
     for (const part of proofs) {
      input.signal.throwIfAborted()
      let bytes: AsyncIterable<Uint8Array> | Iterable<Uint8Array>
      if (part.key) {
       let key = keys.get(part.key.url)
       if (!key) {
        if (keys.size >= 100) throw new Error('HLS 密钥轮换超出预算')
        key = await boundedMediaResponse(
         await input.fetcher(part.key.url, {
          signal: input.signal,
          redirect: 'error',
          credentials: 'omit',
          headers: input.headers
         }),
         16
        )
        if (key.length !== 16) throw new Error('HLS 密钥长度无效')
        keys.set(part.key.url, key)
       }
       const iv = part.key.iv ? Buffer.from(part.key.iv.slice(2), 'hex') : Buffer.alloc(16)
       if (!part.key.iv) iv.writeBigUInt64BE(part.sequence!, 8)
       const decipher = createDecipheriv('aes-128-cbc', key, iv),
        raw = await readFile(part.path)
       if (createHash('sha256').update(raw).digest('hex') !== part.hash) throw new Error('HLS 恢复片段已改变')
       bytes = [Buffer.concat([decipher.update(raw), decipher.final()])]
      } else bytes = createReadStream(part.path)
      const digest = createHash('sha256')
      for await (const chunk of bytes) {
       input.signal.throwIfAborted()
       digest.update(chunk)
       let offset = 0
       while (offset < chunk.length) {
        const written = await output.write(chunk, offset, chunk.length - offset)
        if (!written.bytesWritten) throw new Error('HLS 合并写入中断')
        offset += written.bytesWritten
       }
       size += chunk.length
       if (size > 50 * 1024 ** 3) throw new Error('HLS 媒体超过任务大小上限')
      }
      if (!part.key && digest.digest('hex') !== part.hash) throw new Error('HLS 恢复片段已改变')
     }
     await output.sync()
    } finally {
     await output.close()
    }
   }
   await artifact.finish()
   intermediates.push(name, ...artifact.intermediates())
   tracks.push({path: artifact.path, kind: selected.kind})
  }
  return {tracks, intermediates}
 } finally {
  for (const key of keys.values()) key.fill(0)
 }
}
