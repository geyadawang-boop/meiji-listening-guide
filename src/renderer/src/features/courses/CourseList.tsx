import {Button, ScrollShadow} from '@heroui/react'
import {ConfirmDialog} from '@renderer/ui/ConfirmDialog'
import {useState} from 'react'
import type {Course, ChatSession} from '@shared/types'
import {BookMarked, ChevronDown, MessageSquare, Trash2} from 'lucide-react'
import {courseLabel, courseYear, courseSubject, sortCoursesForNavigation} from '@shared/course-groups'
import {notify} from '@renderer/ui/ToastHost'
export function CourseList({
 courses,
 selected,
 busy,
 select,
 remove,
 sessions,
 selectedSession,
 selectSession,
 newSession,
 removeSession
}: {
 courses: Course[]
 selected: string
 busy: boolean
 select: (id: string) => void
 remove: (id: string) => Promise<void>
 sessions: ChatSession[]
 selectedSession: string
 selectSession: (courseId: string, sessionId: string) => void
 newSession: (courseId: string) => void
 removeSession: (courseId: string, id: string) => Promise<void>
}) {
 const [pendingSession, setPendingSession] = useState<ChatSession | null>(null)
 const [pending, setPending] = useState<Course | null>(null),
  [deleting, setDeleting] = useState(false),
  [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
 return (
  <>
   <ScrollShadow className="course-list" orientation="vertical">
    {sortCoursesForNavigation(courses).map(c => {
     const label = courseLabel(c.name),
      active = c.id === selected,
      folded = collapsed[c.id] ?? !active
     return (
      <section className="course-group" key={c.id}>
       <div className={'course-row ' + (active ? 'selected' : '')}>
        <Button
         variant="ghost"
         isDisabled={busy}
         className={'course ' + (active ? 'selected' : '')}
         aria-label={'打开课程 ' + label}
         onClick={() => {
          select(c.id)
          setCollapsed(v => ({...v, [c.id]: false}))
         }}
        >
         <span className="course-icon" aria-hidden="true">
          <BookMarked />
         </span>
         <span className="course-name">
          {courseYear(c.name) ? (
           <>
            <small>{courseYear(c.name)} · </small>
            <span>{courseSubject(c.name)}</span>
           </>
          ) : (
           label
          )}
         </span>
        </Button>
        <Button
         variant="ghost"
         className="course-fold"
         aria-label={(folded ? '展开课程 ' : '折叠课程 ') + label}
         aria-expanded={!folded}
         onClick={() => setCollapsed(v => ({...v, [c.id]: !folded}))}
        >
         <ChevronDown size={14} />
        </Button>
        <Button
         variant="ghost"
         className="course-delete"
         aria-label={'删除课程 ' + label}
         isDisabled={busy}
         onClick={() => {
          setPending(c)
         }}
        >
         <Trash2 />
        </Button>
       </div>
       {!folded && (
        <div className="course-sessions" aria-label={label + ' 的会话'}>
         {sessions
          .filter(s => s.course_id === c.id)
          .map(s => (
           <div className="session-row" key={s.id}>
            <Button
             variant="ghost"
             isDisabled={busy}
             className={'session-card ' + (s.id === selectedSession && active ? 'selected' : '')}
             aria-label={c.name + ' ' + s.title}
             onClick={() => selectSession(c.id, s.id)}
            >
             <MessageSquare />
             <span>{s.title}</span>
            </Button>
            <Button
             variant="ghost"
             className="session-delete"
             aria-label={'删除会话 ' + c.name + ' ' + s.title}
             isDisabled={busy}
             onClick={() => {
              setPendingSession(s)
             }}
            >
             <Trash2 />
            </Button>
           </div>
          ))}
         <Button
          variant="ghost"
          className="new-session"
          isDisabled={busy}
          aria-label={'新建会话 ' + c.name}
          onClick={() => newSession(c.id)}
         >
          <span aria-hidden="true">＋</span>新建会话
         </Button>
        </div>
       )}
      </section>
     )
    })}
   </ScrollShadow>
   {pendingSession && (
    <ConfirmDialog
     title={`删除「${pendingSession.title}」？`}
     confirmLabel="删除会话"
     busy={busy || deleting}
     onCancel={() => setPendingSession(null)}
     onConfirm={() => {
      setDeleting(true)
      void removeSession(pendingSession.course_id, pendingSession.id)
       .then(() => {
        setPendingSession(null)
        notify.success('会话已删除')
       })
       .catch(e => notify.error(e, {title: '删除会话失败'}))
       .finally(() => setDeleting(false))
     }}
    >
     此会话及其中的聊天记录会删除。同课程的文件、课次、字幕、笔记和练习保留。
    </ConfirmDialog>
   )}
   {pending && (
    <ConfirmDialog
     title={`删除「${pending.name}」？`}
     confirmLabel="删除课程"
     busy={busy || deleting}
     onCancel={() => setPending(null)}
     onConfirm={() => {
      setDeleting(true)
      void remove(pending.id)
       .then(() => {
        setPending(null)
        notify.success('课程已删除')
       })
       .catch(e => notify.error(e, {title: '删除课程失败'}))
       .finally(() => setDeleting(false))
     }}
    >
     本课程及全部课次、字幕、笔记、练习和对话记录会删除。资料文件和已导出文件保留。
    </ConfirmDialog>
   )}
  </>
 )
}
