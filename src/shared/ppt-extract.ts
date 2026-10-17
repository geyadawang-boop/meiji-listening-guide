export const defaultPptExtractPrompt =
 '谨慎去除图片两边确认属于外部的连续黑边；智云课堂 PPT 全黑时不要裁剪黑色，应判断提取失败并改用课程录像。黑色课件背景不属于外部黑边，边缘标题、页码和小字必须完整保留；无法确认时保留原边缘。把 PPT 页面设置成裁剪后的图片大小，让图片完整覆盖页面。重复页仅保留内容最完整的一页，删除明确非 PPT 的内容。轻微像素差异无需纠结，但不能裁掉内容。最终 PDF 或其他成果保存成功、可以打开且逐页检查通过后，清理本次任务为生成该成果而下载或生成的中间 PPT、视频、分片、截帧图片及临时导出。仅按本次任务的具体文件清单清理，不能按扩展名删除整个目录；保留正式成果、教材、原有有效资料及备份、数据库、配置和登录数据。未完成核验或失败时保留恢复所需的文件和记录，核验完成后清理；清理失败必须说明，不能声称已删除。'
export type PptExtractPage = {
 page: number
 preview: string
 width: number
 height: number
 keep: boolean
 reason: string
 duplicateOf?: number
 crop: {left: number; right: number; top: number; bottom: number}
}
export type PptExtractReview = {id: string; sourceName: string; pages: PptExtractPage[]}
