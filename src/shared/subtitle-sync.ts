export type SubtitleSyncItem = {
 page: number
 title: string
 url: string
 status: '等待处理' | '已完成' | '失败'
 path?: string
 hash?: string
 error?: string
 unchanged?: boolean
 sourceMethod?: '站内字幕' | '用户指定 SRT'
 generation?: string | null
}
export type SubtitleSyncTask = {
 id: string
 category: string
 courseName?: string
 createdAt: string
 items: SubtitleSyncItem[]
 interrupted: boolean
}
