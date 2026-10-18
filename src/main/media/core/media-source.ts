import type {MediaCatalog} from '@shared/media'
export type NativeMediaStream = {
 id: string
 kind: 'video' | 'audio' | 'combined'
 urls: string[]
 height: number
 codec: string
 bandwidth: number
 extension: string
 transport?: 'hls'
}
export type NativeMediaSource = {
 catalog: MediaCatalog
 identity: string
 streams: NativeMediaStream[]
 sourceId?: string
 platform?: string
 downloadHeaders?: Record<string, string>
 description?: string
 subtitleTracks?: {language: string; url: string; automatic: boolean; format?: 'youtube-json3' | 'webvtt'}[]
 thumbnail?: string
 chapters?: {start: number; end: number; title: string}[]
}
export type NativeMediaCatalog = {
 read: (
  input: string,
  playlist: boolean,
  signal: AbortSignal,
  options?: unknown
 ) => Promise<MediaCatalog | NativeMediaSource>
}
