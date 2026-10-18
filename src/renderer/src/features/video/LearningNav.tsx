import {Bookmark, Captions, CirclePlay, History, NotebookPen, type LucideIcon} from 'lucide-react'

export type LearningView = 'biliResources' | 'videoPpt' | 'videoSubtitles' | 'videoNotes' | 'videoTasks'
export const learningViews: {id: LearningView; title: string; description: string}[] = [
 {id: 'biliResources', title: '收藏视频', description: '浏览 B 站收藏夹，送入课件与字幕处理'},
 {id: 'videoPpt', title: '视频课件', description: '选择分集，提取完整课件并保存 PDF'},
 {id: 'videoSubtitles', title: '字幕转写', description: '站内字幕、离线转写与本地字幕'},
 {id: 'videoNotes', title: '课程笔记', description: '从字幕整理摘要、要点与思维导图'},
 {id: 'videoTasks', title: '任务记录', description: '继续未完成任务，查看已保存成果'}
]
const viewIcons: Record<LearningView, LucideIcon> = {
 biliResources: Bookmark,
 videoPpt: CirclePlay,
 videoSubtitles: Captions,
 videoNotes: NotebookPen,
 videoTasks: History
}
export function LearningIcon({view}: {view: LearningView}) {
 const Glyph = viewIcons[view]
 return <Glyph aria-hidden="true" />
}
