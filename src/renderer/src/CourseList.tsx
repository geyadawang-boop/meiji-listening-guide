import {useState} from 'react'
import type {Course, ChatSession} from '@shared/types'
import {TrashIcon, CourseBookIcon} from './ManagementIcons'
import {MessageNavIcon} from './SidebarIcons'
import {DshChevronDownIcon} from './ChatIcons'
import {courseLabel, courseYear, courseSubject, sortCoursesForNavigation} from '@shared/course-groups'
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
  [error, setError] = useState(''),
  [deleting, setDeleting] = useState(false),
  [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
 return (
  <>
   <nav className="course-list">
    {sortCoursesForNavigation(courses).map(c => {
     const label = courseLabel(c.name),
      active = c.id === selected,
      folded = collapsed[c.id] ?? !active
     return (
      <section className="course-group" key={c.id}>
       <div className={'course-row ' + (active ? 'selected' : '')}>
        <button
         disabled={busy}
         className={'course ' + (active ? 'selected' : '')}
         title={label}
         aria-label={'打开课程 ' + label}
         onClick={() => {
          select(c.id)
          setCollapsed(v => ({...v, [c.id]: false}))
         }}
        >
         <span className="course-icon" aria-hidden="true">
          <CourseBookIcon />
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
        </button>
        <button
         className="course-fold"
         aria-label={(folded ? '展开课程 ' : '折叠课程 ') + label}
         aria-expanded={!folded}
         onClick={() => setCollapsed(v => ({...v, [c.id]: !folded}))}
        >
         <DshChevronDownIcon />
        </button>
        <button
         className="course-delete"
         aria-label={'删除课程 ' + label}
         title={'删除 ' + label}
         disabled={busy}
         onClick={() => {
          setPending(c)
          setError('')
         }}
        >
         <TrashIcon />
        </button>
       </div>
       {!folded && (
        <div className="course-sessions" aria-label={label + ' 的会话'}>
         {sessions
          .filter(s => s.course_id === c.id)
          .map(s => (
           <div className="session-row" key={s.id}>
            <button
             disabled={busy}
             className={'session-card ' + (s.id === selectedSession && active ? 'selected' : '')}
             aria-label={c.name + ' ' + s.title}
             onClick={() => selectSession(c.id, s.id)}
            >
             <MessageNavIcon />
             <span>{s.title}</span>
            </button>
            <button
             className="session-delete"
             aria-label={'删除会话 ' + c.name + ' ' + s.title}
             title="删除会话"
             disabled={busy}
             onClick={() => {
              setPendingSession(s)
              setError('')
             }}
            >
             <TrashIcon />
            </button>
           </div>
          ))}
         <button
          className="new-session"
          disabled={busy}
          aria-label={'新建会话 ' + c.name}
          onClick={() => newSession(c.id)}
         >
          <span aria-hidden="true">＋</span>新建会话
         </button>
        </div>
       )}
      </section>
     )
    })}
   </nav>
   {pendingSession && (
    <div className="confirm-shade">
     <section role="alertdialog" aria-label="确认删除会话">
      <h3>删除「{pendingSession.title}」？</h3>
      <p>此会话及其中的聊天记录会删除。同课程的文件、课次、字幕、笔记和练习保留。</p>
      {error && (
       <p className="alert" role="alert">
        {error}
       </p>
      )}
      <footer>
       <button disabled={deleting} onClick={() => setPendingSession(null)}>
        取消
       </button>
       <button
        className="danger-button"
        disabled={busy || deleting}
        onClick={() => {
         setDeleting(true)
         void removeSession(pendingSession.course_id, pendingSession.id)
          .then(() => setPendingSession(null))
          .catch(e => setError(e instanceof Error ? e.message : String(e)))
          .finally(() => setDeleting(false))
        }}
       >
        删除会话
       </button>
      </footer>
     </section>
    </div>
   )}
   {pending && (
    <div className="confirm-shade">
     <section role="alertdialog" aria-label="确认删除课程">
      <h3>删除「{pending.name}」？</h3>
      <p>本课程及全部课次、字幕、笔记、练习和对话记录会删除。资料文件和已导出文件保留。</p>
      {error && (
       <p className="alert" role="alert">
        {error}
       </p>
      )}
      <footer>
       <button disabled={deleting} onClick={() => setPending(null)}>
        取消
       </button>
       <button
        className="danger-button"
        disabled={busy || deleting}
        onClick={() => {
         setDeleting(true)
         void remove(pending.id)
          .then(() => setPending(null))
          .catch(e => setError(e instanceof Error ? e.message : String(e)))
          .finally(() => setDeleting(false))
        }}
       >
        删除课程
       </button>
      </footer>
     </section>
    </div>
   )}
  </>
 )
}
