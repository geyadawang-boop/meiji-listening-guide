import type {PptExtractPage} from './ppt-extract.js'
export type VideoEpisode = {page: number; title: string; duration: number; url: string}
export type VideoSeries = {title: string; episodes: VideoEpisode[]}
export type PendingVideoTask = {id: string; name: string; kind?: 'subtitle'; savedPath?: string; error?: string}
export type VideoBatchItem = {
 page: number
 title: string
 status: '等待处理' | '处理中' | '已完成' | '失败'
 path?: string
 error?: string
}
export const defaultVideoPrompt =
 '可以帮我把这个视频里面的ppt截取出来吗，我要求你仅仅截绿色方框部分（没有绿色方框时自行确认 PPT 的位置），尽量去截取没有笔记的第一时间的ppt，然后最后删除重复，检查无误后保存成pdf然后把其它之前用于生成这个pdf的文件（包括视频）删了。最终 PDF 或其他成果保存成功、可以打开且逐页检查通过后，按本次任务的具体文件清单清理下载视频、分片、截帧图片、中间 PPT 和临时导出，不能按扩展名删除整个目录。保留正式成果、教材、原有有效资料及备份、数据库、配置和登录数据。未完成核验或失败时保留恢复所需的文件和记录，核验完成后清理；清理失败必须说明，不能声称已删除。'
export type VideoSource = {
 id: string
 name: string
 duration: number
 width: number
 height: number
 preview: string
 crop: PptExtractPage['crop']
 warning: string
}
export type VideoReview = {
 id: string
 sourceName: string
 warning?: string
 pages: Array<PptExtractPage & {time: number}>
}
