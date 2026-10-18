import {Captions, CirclePlay, History, NotebookPen, type LucideIcon} from 'lucide-react'

export type LearningView = 'videoPpt' | 'videoSubtitles' | 'videoNotes' | 'videoTasks'
export const learningViews: {id: LearningView; title: string; description: string}[] = [
 {id: 'videoPpt', title: '视频课件', description: '选择分集，提取完整课件并保存 PDF'},
 {id: 'videoSubtitles', title: '字幕转写', description: '站内字幕、离线转写与本地字幕'},
 {id: 'videoNotes', title: '课程笔记', description: '从字幕整理摘要、要点与思维导图'},
 {id: 'videoTasks', title: '任务记录', description: '继续未完成任务，查看已保存成果'}
]
const viewIcons: Record<LearningView, LucideIcon> = {
 videoPpt: CirclePlay,
 videoSubtitles: Captions,
 videoNotes: NotebookPen,
 videoTasks: History
}
export function LearningIcon({view}: {view: LearningView}) {
 const Glyph = viewIcons[view]
 return <Glyph aria-hidden="true" />
}
export function LearningRail({current, select}: {current: string | null; select: (view: LearningView) => void}) {
 return (
  <>
   {learningViews.map(item => (
    <button
     key={item.id}
     title={item.title}
     aria-label={item.title}
     aria-current={current === item.id ? 'page' : undefined}
     className={current === item.id ? 'active' : ''}
     onClick={() => select(item.id)}
    >
     <LearningIcon view={item.id} />
    </button>
   ))}
  </>
 )
}
