import {VideoIcon, NotesIcon} from './SidebarIcons'

export type LearningView = 'videoPpt' | 'videoSubtitles' | 'videoNotes' | 'videoTasks'
export const learningViews: {id: LearningView; title: string; description: string}[] = [
 {id: 'videoPpt', title: '视频课件', description: '选择分集，提取完整课件并保存 PDF'},
 {id: 'videoSubtitles', title: '字幕转写', description: '站内字幕、离线转写与本地字幕'},
 {id: 'videoNotes', title: '课程笔记', description: '从字幕整理摘要、要点与思维导图'},
 {id: 'videoTasks', title: '任务记录', description: '继续未完成任务，查看已保存成果'}
]
export function LearningIcon({view}: {view: LearningView}) {
 if (view === 'videoPpt') return <VideoIcon />
 if (view === 'videoNotes') return <NotesIcon />
 return (
  <svg viewBox="0 0 24 24" aria-hidden="true">
   {view === 'videoSubtitles' ? (
    <>
     <rect x="3" y="5" width="18" height="14" rx="3" />
     <path d="M6 10h5m3 0h4M6 14h3m3 0h6" />
    </>
   ) : (
    <>
     <circle cx="12" cy="12" r="9" />
     <path d="M12 7v5l3 2M4 4l-1 4 4-1" />
    </>
   )}
  </svg>
 )
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
