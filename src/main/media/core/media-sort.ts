import type {NativeMediaStream} from '@main/media/bilibili/media-bili'
/** A documented native subset, rather than passing unparsed downloader expressions to a shell. */
export function mediaSort(input: string) {
 return input
  ? input.split(',').map(token => {
     const match = /^(\+)?(res|height|br|tbr|vcodec|acodec)(?::([A-Za-z0-9]+))?$/.exec(token)
     if (!match) throw new Error('原生格式排序支持 res、height、br、tbr、vcodec、acodec，可用 + 表示升序')
     if (match[3] && !['vcodec', 'acodec'].includes(match[2]))
      throw new Error('数值排序不使用额外参数，请通过画质或音质上限设置')
     return {ascending: !!match[1], field: match[2], preferred: match[3] || ''}
    })
  : []
}
export function sortMediaStreams(rows: NativeMediaStream[], input: string, freeFormats = false) {
 const fields = mediaSort(input)
 const codecScore = (codec: string) =>
  /^av01|av1/.test(codec) ? 4 : /^vp/.test(codec) ? 3 : /^hev|hvc/.test(codec) ? 2 : /^avc|h264/.test(codec) ? 1 : 0
 return [...rows].sort((a, b) => {
  for (const field of fields) {
   let av: number, bv: number
   if (['res', 'height'].includes(field.field)) {
    av = a.height
    bv = b.height
   } else if (['br', 'tbr'].includes(field.field)) {
    av = a.bandwidth
    bv = b.bandwidth
   } else {
    const preferred =
     field.preferred === 'h264'
      ? 'avc'
      : field.preferred === 'h265'
        ? 'hev'
        : field.preferred === 'av1'
          ? 'av01'
          : field.preferred
    av = preferred ? Number(a.codec.startsWith(preferred)) : codecScore(a.codec)
    bv = preferred ? Number(b.codec.startsWith(preferred)) : codecScore(b.codec)
   }
   if (av !== bv) return field.ascending ? av - bv : bv - av
  }
  if (freeFormats) {
   const free = (row: NativeMediaStream) =>
    Number(row.extension === 'webm' || /^vp|^av01|^opus|^vorbis/.test(row.codec))
   if (free(a) !== free(b)) return free(b) - free(a)
  }
  return b.height - a.height || b.bandwidth - a.bandwidth || a.id.localeCompare(b.id)
 })
}
