export type MediaOptions = {
 height: number
 audio_only: boolean
 subtitle_only: boolean
 subtitles: boolean
 auto_subtitles: boolean
 subtitle_languages: string
 container: string
 audio_format: string
 format_ids: string
 rate_kbps: number
 concurrent_fragments: number
 retries: number
 thumbnail: boolean
 metadata: boolean
 chapters: boolean
 skip_existing: boolean
 clip_start: number | null
 clip_end: number | null
}
export type MediaCatalog = {
 token?: string
 url: string
 title: string
 playlist: boolean
 entries?: {title: string; url: string}[]
 limited?: boolean
 duration?: number
 heights?: number[]
 subtitles?: string[]
 formats?: {id: string; height: number | null; extension: string; video_codec: string; audio_codec: string}[]
}
export type MediaJob = {
 id: string
 title: string
 state: string
 stage: string
 progress: {downloaded?: number; total?: number; speed?: number; eta?: number}
 error_message: string
 warning: string
 output: string
 source_url: string
 files: string[]
}
