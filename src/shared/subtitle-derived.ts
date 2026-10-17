import type {VideoNoteMode, VideoNotePoint} from './video-notes'
export type DerivedSource = {url: string; title: string; path: string; hash: string; generation: string}
export type DerivedOutput = {path: string; hash: string}
export type SubtitleDerivedItem = {
 source: DerivedSource
 mode: VideoNoteMode
 status: '等待处理' | '已完成' | '失败'
 error?: string
 outputs?: DerivedOutput[]
 prepared?: {markdown: string; points: VideoNotePoint[]}
}
export type SubtitleDerivedTask = {
 id: string
 createdAt: string
 courseName?: string
 items: SubtitleDerivedItem[]
 interrupted: boolean
}
