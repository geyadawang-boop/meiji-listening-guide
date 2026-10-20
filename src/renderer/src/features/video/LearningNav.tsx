import {Bookmark, Captions, CirclePlay, NotebookPen, type LucideIcon} from 'lucide-react'

export type LearningView = 'biliResources' | 'videoPpt' | 'videoSubtitles' | 'videoNotes'
export const learningViews: {id: LearningView; title: string; description: string}[] = [
 {id: 'biliResources', title: 'B站资源', description: '浏览收藏夹与搜索视频，送入课件、字幕或知识库'},
 {id: 'videoPpt', title: '视频课件', description: '选择分集，提取完整课件并保存 PDF'},
 {id: 'videoSubtitles', title: '字幕转写', description: '站内字幕、离线转写与本地字幕'},
 {id: 'videoNotes', title: '视频摘要', description: '从字幕整理摘要、要点与思维导图'}
]
const viewIcons: Record<LearningView, LucideIcon> = {
 biliResources: Bookmark,
 videoPpt: CirclePlay,
 videoSubtitles: Captions,
 videoNotes: NotebookPen
}
export function LearningIcon({view}: {view: LearningView}) {
 const Glyph = viewIcons[view]
 return <Glyph aria-hidden="true" />
}
