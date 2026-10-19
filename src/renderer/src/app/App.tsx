import {Button, Input, Kbd, ScrollShadow, Surface, TextArea, Tooltip} from '@heroui/react'
import {learningViews, type LearningView} from '@renderer/features/video/LearningNav'
import {Wallpaper, chatStyle} from '@renderer/features/appearance/Appearance'
import {defaultAppearanceState, resolveAppearance, type AppearanceState} from '@shared/appearance'
import {CourseList} from '@renderer/features/courses/CourseList'
import {sortCoursesForNavigation} from '@shared/course-groups'
import {IdentityContext} from '@renderer/features/identity/Identity'
import {defaultIdentity, type Identity} from '@shared/identity'
import {PracticePanel} from '@renderer/features/study/PracticePanel'
import {StudyIcon} from '@renderer/ui/StudyIcon'
import {TitleBar} from '@renderer/app/TitleBar'
import {AppWindows, type AppWindowKey} from '@renderer/app/AppWindows'
import {AppLogo} from '@renderer/ui/brand/AppLogo'
import {FileManager} from '@renderer/features/files/FileManager'
import {LecturePicker} from '@renderer/features/courses/LecturePicker'
import {ChatMessage, ChatWaitingReply} from '@renderer/features/chat/ChatMessage'
import {
 ArrowUp,
 BookOpen,
 Boxes,
 ChevronDown,
 CirclePlay,
 CloudDownload,
 Cog,
 FileText,
 Folder,
 History,
 MessageSquare,
 MessagesSquare,
 Plus,
 Presentation,
 Scan,
 Search,
 Square,
 Wrench
} from 'lucide-react'
import {useEffect, useRef, useState, type ReactNode} from 'react'
import type {ChatSession, Course, Detail, LectureDetail, Progress, Settings} from '@shared/types'
import {milliseconds, time} from '@shared/srt'
import {invoke, basename, Modal, Markdown} from '@renderer/ui/UiParts'
import {AlertBox} from '@renderer/ui/AlertBox'
import {SelectField} from '@renderer/ui/SelectField'
import {
 NewCourse,
 NewLecture,
 AddTranscript,
 AddCourseware,
 Notes,
 Materials
} from '@renderer/features/courses/CoursePanels'
import {SettingsHub} from '@renderer/features/settings/SettingsHub'
type RailTarget = LearningView | 'zhiyun' | 'files' | 'recognition' | 'knowledge' | 'tools' | 'study' | null
const railItems: {target: RailTarget; label: string; shortcut: string; icon: ReactNode}[] = [
 {target: null, label: '课程对话', shortcut: '1', icon: <MessageSquare />},
 {target: 'zhiyun', label: '智云课堂', shortcut: '2', icon: <CloudDownload />},
 {target: 'files', label: '文件管理', shortcut: '3', icon: <Folder />},
 {target: 'recognition', label: '识别工具', shortcut: '4', icon: <Scan />},
 {target: 'videoPpt', label: 'B站视频', shortcut: '5', icon: <CirclePlay />},
 {target: 'knowledge', label: '知识库', shortcut: '6', icon: <BookOpen />},
 {target: 'tools', label: '研究工具', shortcut: '7', icon: <Wrench />},
 {target: 'study', label: '课表与教材', shortcut: '8', icon: <StudyIcon name="notes" />}
]
export default function App() {
 const [sessionDraft, setSessionDraft] = useState<{
  detail: Detail
  lectureId: string
 } | null>(null)
 const [sessions, setSessions] = useState<ChatSession[]>([]),
  [sessionId, setSessionId] = useState('')
 const selectedSessions = useRef<Record<string, string>>({})
 const [appearance, setAppearance] = useState<AppearanceState>(defaultAppearanceState)
 const [identity, setIdentity] = useState<Identity>(defaultIdentity)
 const [courses, setCourses] = useState<Course[]>([]),
  [courseId, setCourseId] = useState(''),
  [detail, setDetail] = useState<Detail | null>(null)
 const [lectureId, setLectureId] = useState(''),
  [lecture, setLecture] = useState<LectureDetail | null>(null),
  [tab, setTab] = useState<'chat' | 'activity' | 'subtitles' | 'notes' | 'practice'>('chat')
 const [settings, setSettings] = useState<Settings | null>(null),
  [modal, setModal] = useState<
   | 'course'
   | 'lecture'
   | 'settings'
   | 'materials'
   | 'zhiyun'
   | 'courseware'
   | 'transcript'
   | 'files'
   | LearningView
   | 'study'
   | 'knowledge'
   | 'recognition'
   | 'tools'
   | null
  >(null)
 const [platform, setPlatform] = useState('')
 const modKey = platform === 'darwin' ? ('command' as const) : ('ctrl' as const)
 const railActive = (target: RailTarget) =>
  target === null
   ? modal === null
   : target === 'videoPpt'
     ? learningViews.some(item => item.id === modal)
     : modal === target
 useEffect(() => {
  void invoke<{platform: string}>('app:info').then(info => setPlatform(info.platform))
 }, [])
 useEffect(() => {
  const onKeyDown = (event: KeyboardEvent) => {
   if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return
   if (event.key === '0') {
    event.preventDefault()
    setModal('settings')
    return
   }
   const index = Number(event.key) - 1
   if (index >= 0 && index < railItems.length) {
    event.preventDefault()
    setModal(railItems[index].target)
   }
  }
  window.addEventListener('keydown', onKeyDown)
  return () => window.removeEventListener('keydown', onKeyDown)
 }, [])
 const [error, setError] = useState(''),
  [busy, setBusy] = useState(false),
  [progress, setProgress] = useState<Progress | null>(null)
 const [search, setSearch] = useState(''),
  [srtEdit, setSrtEdit] = useState<string | null>(null),
  [input, setInput] = useState(''),
  [chatText, setChatText] = useState(''),
  [pendingChat, setPendingChat] = useState('')
 const [sourceDraft, setSourceDraft] = useState(''),
  [pptDraft, setPptDraft] = useState('')
 const [withSearch, setWithSearch] = useState(false),
  [menu, setMenu] = useState(false),
  [activities, setActivities] = useState<
   Array<
    Progress & {
     at: string
    }
   >
  >([])
 const threadEnd = useRef<HTMLDivElement>(null),
  importedLecture = useRef(''),
  current = useRef({courseId: '', lectureId: '', sessionId: ''}),
  request = useRef(''),
  operation = useRef(false)
 current.current = {courseId, lectureId, sessionId}
 async function reloadCourse(id = courseId) {
  const result = await invoke<Detail>('course:detail', {id})
  if (current.current.courseId === id) {
   setDetail(result)
   setSessions(v => [...v.filter(s => s.course_id !== id), ...result.sessions])
  }
  return result
 }
 async function zhiyunImported(id: string, cid: string) {
  setCourses(await invoke<Course[]>('courses'))
  if (cid === courseId) {
   await reloadCourse()
   setLectureId(id)
  } else {
   importedLecture.current = id
   setCourseId(cid)
  }
  setTab('subtitles')
 }
 async function reloadLecture(id = lectureId) {
  const result = await invoke<LectureDetail>('lecture:detail', {id})
  if (current.current.lectureId === id) setLecture(result)
  return result
 }
 async function task(fn: () => Promise<unknown>) {
  if (operation.current) return false
  operation.current = true
  setBusy(true)
  setError('')
  setProgress(null)
  try {
   await fn()
   setActivities(a => [...a, {stage: '完成', message: '操作已完成', at: new Date().toLocaleTimeString()}])
   return true
  } catch (e) {
   const message = e instanceof Error ? e.message : String(e)
   setError(message)
   setActivities(a => [...a, {stage: '失败', message, error: true, at: new Date().toLocaleTimeString()}])
   return false
  } finally {
   operation.current = false
   setBusy(false)
  }
 }
 useEffect(() => {
  void invoke<AppearanceState>('appearance:get')
   .then(setAppearance)
   .catch(e => setError(String(e)))
 }, [])
 useEffect(() => {
  void invoke<Identity>('identity:get')
   .then(setIdentity)
   .catch(e => setError(String(e)))
 }, [])
 useEffect(() => {
  void Promise.all([invoke<Course[]>('courses'), invoke<Settings>('settings:get'), invoke<ChatSession[]>('sessions')])
   .then(([c, s, cs]) => {
    setSessions(cs)
    setCourses(c)
    setSettings(s)
    const first = sortCoursesForNavigation(c)[0]
    if (first) setCourseId(first.id)
   })
   .catch(e => setError(String(e)))
  return window.assistant.onEvent(e => {
   if (e.kind === 'progress' && e.data.stage === '片段完成' && e.data.lectureId === current.current.lectureId)
    void reloadLecture(e.data.lectureId).catch(() => {})
   if (e.kind === 'progress' && (!e.data.lectureId || e.data.lectureId === current.current.lectureId)) {
    setProgress(e.data)
    setActivities(a => [...a, {...e.data, at: new Date().toLocaleTimeString()}])
   }
   if (e.kind === 'chat' && e.requestId === request.current) setChatText(t => t + e.text)
  })
 }, [])
 useEffect(() => {
  const media = window.matchMedia('(prefers-color-scheme: dark)')
  const apply = () => {
   const theme = settings?.theme ?? 'light'
   document.documentElement.dataset.theme = theme === 'system' ? (media.matches ? 'dark' : 'light') : theme
  }
  apply()
  media.addEventListener('change', apply)
  return () => media.removeEventListener('change', apply)
 }, [settings?.theme])
 useEffect(() => {
  setDetail(null)
  setSessionId('')
  setLecture(null)
  setLectureId('')
  setProgress(null)
  setSrtEdit(null)
  setChatText('')
  setPendingChat('')
  setActivities([])
  setSourceDraft('')
  setMenu(false)
  request.current = ''
  if (courseId)
   void invoke<Detail>('course:detail', {id: courseId})
    .then(d => {
     if (current.current.courseId === courseId) {
      setDetail(d)
      setSessions(v => [...v.filter(s => s.course_id !== courseId), ...d.sessions])
      setSessionId(selectedSessions.current[courseId] || d.sessions[0]?.id || '')
      setLectureId(
       importedLecture.current ||
        d.sessions.find(s => s.id === (selectedSessions.current[courseId] || d.sessions[0]?.id))?.lecture_id ||
        d.lectures[0]?.id ||
        ''
      )
      importedLecture.current = ''
     }
    })
    .catch(e => setError(String(e)))
 }, [courseId])
 useEffect(() => {
  threadEnd.current?.scrollIntoView({block: 'end'})
 }, [pendingChat, chatText, detail?.messages.length, tab])
 useEffect(() => {
  setLecture(null)
  setSrtEdit(null)
  setProgress(null)
  if (lectureId) void reloadLecture(lectureId).catch(e => setError(String(e)))
 }, [lectureId])
 function jump(timestamp: string | number) {
  const stamp = typeof timestamp === 'number' ? timestamp : milliseconds(timestamp)
  setTab('subtitles')
  setSearch('')
  requestAnimationFrame(() => {
   const node = document.querySelector('[data-stamp="' + stamp + '"]')
   node?.scrollIntoView({block: 'center', behavior: 'smooth'})
  })
 }
 const activeProfile = settings?.profiles.find(p => p.id === settings.activeProfile) || settings?.profiles[0]
 const modelBrand = 'custom'
 const exportResult = (kind: string, format: string) =>
  void task(async () => {
   const path = await invoke<string>('export', {id: lectureId, kind, format})
   setProgress({stage: '已导出', message: path})
  })
 async function generate(action: string) {
  const id = lectureId
  try {
   await invoke(action, {id, ...(action === 'practice:generate' ? {withSearch} : {})})
  } finally {
   await reloadLecture(id)
   await reloadCourse()
  }
 }
 function dropped(e: React.DragEvent) {
  e.preventDefault()
  if (busy) return
  const file = e.dataTransfer.files[0]
  if (file) {
   if (!courseId) {
    setError('请先新建课程，再拖入原文或 PPT')
    return
   }
   const path = window.assistant.filePath(file)
   if (!path) {
    setError('未获取到本地路径，请从文件资源管理器拖入或使用文件选择')
    return
   }
   if (/\.(pptx?|pdf)$/i.test(path)) {
    setSourceDraft('')
    setPptDraft(path)
    setModal(lectureId ? 'courseware' : 'lecture')
   } else if (/\.(docx|txt|md|srt)$/i.test(path)) {
    setSourceDraft(path)
    setPptDraft('')
    setModal(lectureId ? 'transcript' : 'lecture')
   } else {
    setError('请拖入 PPT、PPTX、PDF 课件，或 Word、TXT、Markdown、SRT 原文')
    return
   }
   setTab('chat')
  }
 }
 const activeAppearance = resolveAppearance(appearance, courseId)
 return (
  <IdentityContext.Provider value={identity}>
   <TitleBar />
   <div className="app" data-background={activeAppearance.background}>
    <AppWindows
     current={modal as AppWindowKey}
     setModal={setModal}
     courses={courses}
     courseId={courseId}
     courseName={detail?.course.name}
     reloadCourse={reloadCourse}
     zhiyunImported={zhiyunImported}
    />
    {sessionDraft && (
     <Modal
      title="新建会话"
      close={() => {
       if (!busy) setSessionDraft(null)
      }}
     >
      <form
       onSubmit={e => {
        e.preventDefault()
        const draft = sessionDraft
        void task(async () => {
         const cid = draft.detail.course.id,
          next = await invoke<ChatSession>('session:create', {courseId: cid, lectureId: draft.lectureId || undefined})
         setSessions(v => [...v, next])
         selectedSessions.current[cid] = next.id
         setCourseId(cid)
         setSessionId(next.id)
         if (cid === courseId && next.lecture_id) setLectureId(next.lecture_id)
         setTab('chat')
         setInput('')
         setSessionDraft(null)
        })
       }}
      >
       <label>
        对应课次
        <SelectField
         label="新会话对应课次"
         placeholder="暂无课次"
         isDisabled={busy || !sessionDraft.detail.lectures.length}
         value={sessionDraft.lectureId}
         options={
          sessionDraft.detail.lectures.length
           ? sessionDraft.detail.lectures.map(l => ({value: l.id, label: l.title}))
           : [{value: '', label: '暂无课次'}]
         }
         onChange={next => setSessionDraft({...sessionDraft, lectureId: next})}
        />
       </label>
       <Button variant="primary" size="sm" type="submit" isDisabled={busy}>
        创建会话
       </Button>
      </form>
     </Modal>
    )}
    {busy && (
     <div className="busy-indicator">
      <span className="pulse">●</span> {progress ? `${progress.stage} · ${progress.message}` : '正在处理，请稍等'}{' '}
      <Button variant="ghost" size="sm" onClick={() => void invoke('cancel')}>
       取消任务
      </Button>
     </div>
    )}
    <nav className="app-icon-rail">
     {railItems.map(item => (
      <Tooltip key={item.label} delay={0} closeDelay={0}>
       <Button
        variant="ghost"
        isIconOnly
        aria-label={item.label}
        className={railActive(item.target) ? 'active' : ''}
        onClick={() => setModal(item.target)}
       >
        {item.icon}
       </Button>
       <Tooltip.Content placement="right">
        <span className="rail-tooltip">
         {item.label}
         <Kbd>
          <Kbd.Abbr keyValue={modKey} />
          <Kbd.Content>{item.shortcut}</Kbd.Content>
         </Kbd>
        </span>
       </Tooltip.Content>
      </Tooltip>
     ))}
     <div className="rail-spacer" />
     <Tooltip delay={0} closeDelay={0}>
      <Button
       variant="ghost"
       isIconOnly
       aria-label="设置"
       className={modal === 'settings' ? 'active' : ''}
       onClick={() => setModal('settings')}
      >
       <Cog />
      </Button>
      <Tooltip.Content placement="right">
       <span className="rail-tooltip">
        设置
        <Kbd>
         <Kbd.Abbr keyValue={modKey} />
         <Kbd.Content>0</Kbd.Content>
        </Kbd>
       </span>
      </Tooltip.Content>
     </Tooltip>
    </nav>
    <aside className="sidebar">
     <div className="brand">
      <span className="brand-mark">
       <AppLogo size={26} />
      </span>
      <div>
       <strong>摘云</strong>
       <small>把老师的原话留下来</small>
      </div>
     </div>
     <button className="new-course" onClick={() => setModal('course')}>
      ＋ 新建课程
     </button>
     <div className="sidebar-label">
      我的课程 <span>{courses.length}</span>
     </div>
     <CourseList
      courses={courses}
      selected={courseId}
      busy={busy}
      sessions={sessions}
      selectedSession={sessionId}
      removeSession={async (cid, sid) => {
       const ok = await task(async () => {
        const remaining = await invoke<ChatSession[]>('session:delete', {courseId: cid, id: sid, confirmed: true})
        setSessions(v => [...v.filter(s => s.course_id !== cid), ...remaining])
        if (selectedSessions.current[cid] === sid) selectedSessions.current[cid] = remaining[0].id
        if (cid === courseId) {
         if (sessionId === sid) {
          setSessionId(remaining[0].id)
          setInput('')
          setChatText('')
          setPendingChat('')
          request.current = ''
         }
         await reloadCourse(cid)
        }
       })
       if (!ok) throw new Error('会话未删除，请查看错误提示')
      }}
      selectSession={(cid, sid) => {
       selectedSessions.current[cid] = sid
       setCourseId(cid)
       setSessionId(sid)
       if (cid === courseId) {
        const linked = sessions.find(s => s.id === sid)?.lecture_id
        if (linked) setLectureId(linked)
       }
       setTab('chat')
       setInput('')
      }}
      newSession={cid =>
       void invoke<Detail>('course:detail', {id: cid})
        .then(d => {
         const linked = cid === courseId ? sessions.find(s => s.id === sessionId)?.lecture_id : undefined
         setSessionDraft({
          detail: d,
          lectureId:
           linked ||
           (cid === courseId && d.lectures.some(l => l.id === lectureId) ? lectureId : d.lectures[0]?.id) ||
           ''
         })
        })
        .catch(e => setError(String(e)))
      }
      select={setCourseId}
      remove={async id => {
       const ok = await task(async () => {
        await invoke('course:delete', {id, confirmed: true})
        const remaining = await invoke<Course[]>('courses')
        setCourses(remaining)
        setSessions(v => v.filter(s => s.course_id !== id))
        if (id === courseId) {
         setCourseId(remaining[0]?.id || '')
         setDetail(null)
         setLecture(null)
         setLectureId('')
         setTab('chat')
        }
       })
       if (!ok) throw new Error('课程未删除，请查看错误提示')
      }}
     />
    </aside>
    <main
     className={'workspace agent-workspace wallpaper-workspace ' + (tab === 'chat' ? 'chat-styled' : '')}
     style={chatStyle(activeAppearance)}
     data-names={activeAppearance.showNames}
     data-bubbles={activeAppearance.assistantBubble}
     onDragOver={e => e.preventDefault()}
     onDrop={dropped}
    >
     <Wallpaper value={activeAppearance} />
     <header className="workspace-header">
      <div className="agent-heading">
       <h1>{detail?.course.name || '摘云'}</h1>
      </div>
      <div className="row">
       <Button
        variant="ghost"
        size="sm"
        isIconOnly
        className="header-icon"
        aria-label="课程资料"
        isDisabled={!courseId}
        onClick={() => setModal('materials')}
       >
        <FileText size={18} />
       </Button>
      </div>
     </header>
     {error && <AlertBox onClose={() => setError('')}>{error}</AlertBox>}
     {!courseId ? (
      <div className="welcome">
       <div className="welcome-symbol">
        <BookOpen size={25} />
       </div>
       <h2>从一门课程开始</h2>
       <p>
        导入资料和语音识别原文，保留完整字幕，
        <br />
        只提取老师亲口强调的重点。
       </p>
       <Button variant="primary" size="sm" onClick={() => setModal('course')}>
        ＋ 新建课程
       </Button>
       <div className="steps">
        <span>01 课前资料</span>
        <span>02 原文校订</span>
        <span>03 重点与练习</span>
       </div>
      </div>
     ) : (
      <>
       <LecturePicker
        lectures={detail?.lectures || []}
        value={lectureId}
        busy={busy}
        select={setLectureId}
        create={() => {
         setSourceDraft('')
         setModal('lecture')
        }}
        remove={async id => {
         await invoke('lecture:delete', {id, confirmed: true})
         const next = await reloadCourse()
         if (id === lectureId) {
          setLecture(null)
          setLectureId(next.lectures[0]?.id || '')
         }
        }}
       />
       <div className="tabs agent-tabs" role="tablist">
        {(
         [
          ['chat', '对话'],
          ['activity', '任务轨迹'],
          ['subtitles', '完整字幕'],
          ['notes', '听课笔记'],
          ['practice', '练习题']
         ] as const
        ).map(([id, label]) => (
         <button
          key={id}
          role="tab"
          aria-selected={tab === id}
          className={tab === id ? 'active' : ''}
          onClick={() => {
           setTab(id)
           setMenu(false)
          }}
         >
          {(id === 'subtitles' || id === 'notes' || id === 'practice') && <StudyIcon name={id} />} {label}
          {id === 'subtitles' && !!lecture?.segments.length && <span>{lecture.segments.length}</span>}
         </button>
        ))}
       </div>
       <ScrollShadow className="agent-scroll" orientation="vertical">
        {tab === 'chat' && (
         <div className="agent-thread">
          {!detail?.messages.filter(m => m.session_id === sessionId).length && !pendingChat && !chatText && (
           <div className="agent-empty">
            <h2>{lecture ? '这一讲，想从哪里开始？' : '今天要听哪一门课？'}</h2>
            <p>拖入语音识别原文和 PPT，或直接向听课助手提问。</p>
            <div className="suggestions">
             <Button
              variant="tertiary"
              size="sm"
              onClick={() => {
               setInput('本节课老师明确强调了哪些重点？')
              }}
             >
              提取教师重点
             </Button>
             <Button variant="tertiary" size="sm" onClick={() => setModal('materials')}>
              整理课前资料
             </Button>
             <Button
              variant="tertiary"
              size="sm"
              onClick={() => {
               setSourceDraft('')
               setModal('lecture')
              }}
             >
              添加语音识别原文
             </Button>
            </div>
           </div>
          )}
          {detail?.messages
           .filter(m => m.session_id === sessionId)
           .map(m => (
            <ChatMessage key={m.id} role={m.role} content={m.content}>
             <Markdown text={m.content} />
            </ChatMessage>
           ))}
          {pendingChat && (
           <ChatMessage role="user" content={pendingChat} pending>
            <Markdown text={pendingChat} />
           </ChatMessage>
          )}
          {chatText && (
           <ChatMessage role="assistant" content={chatText} pending>
            <Markdown text={chatText} />
           </ChatMessage>
          )}
          <div ref={threadEnd} />
         </div>
        )}
        {tab === 'activity' && (
         <div className="activity-list">
          <h3>任务执行记录</h3>
          {!activities.length && (
           <div className="agent-empty">
            <p>还没有任务记录。导入原文或生成笔记后，可在这里查看进度。</p>
           </div>
          )}
          {activities.map((a, i) => (
           <div className={`activity-item ${a.error ? 'warning' : ''}`} key={i}>
            <span>●</span>
            <div>
             <strong>
              {a.stage}
              {a.part ? ` · ${a.part}/${a.total}` : ''}
             </strong>
             <p>{a.message}</p>
            </div>
            <time>{a.at}</time>
           </div>
          ))}
         </div>
        )}
        {tab !== 'chat' &&
         tab !== 'activity' &&
         (!lecture ? (
          <div className="empty">
           <h2>添加这一讲的原文</h2>
           <p>
            将语音识别原文拖到这里，或点击“新建课次”。
            <br />
            课件可使用 PPTX、PDF、DOCX、TXT 或 Markdown。
           </p>
          </div>
         ) : (
          <>
           <div className="lecture-source-card">
            <h2>{lecture.lecture.title}</h2>
            <div className="lecture-source-actions">
             <Button variant="tertiary" size="sm" isDisabled={busy} onClick={() => setModal('transcript')}>
              添加或替换原文
             </Button>
             <Button variant="tertiary" size="sm" isDisabled={busy} onClick={() => setModal('courseware')}>
              添加或替换课件
             </Button>
            </div>
            <details>
             <summary>查看语音识别原文</summary>
             <TextArea className="srt-editor" readOnly value={lecture.lecture.transcript_text} />
            </details>
           </div>
           {progress && (
            <div className={`progress ${progress.error ? 'failed' : ''}`}>
             <span className={busy ? 'pulse' : ''}>●</span>
             <strong>{progress.stage}</strong>
             <span>{progress.message}</span>
             {progress.part && (
              <small>
               第 {progress.part}/{progress.total} 段
              </small>
             )}
             {busy && (
              <Button variant="ghost" size="sm" onClick={() => void invoke('cancel')}>
               取消任务
              </Button>
             )}
            </div>
           )}
           <div className="tab-content">
            {tab === 'subtitles' && (
             <>
              <div className="toolbar">
               <Button
                variant="primary"
                size="sm"
                isDisabled={busy || !lecture.lecture.transcript_path || !lecture.lecture.ppt_path}
                onClick={() => void task(() => generate('subtitles:generate'))}
               >
                <StudyIcon name="sparkle" />
                {lecture.correction ? '继续校订字幕' : lecture.segments.length ? '重新校订字幕' : '原文 + PPT 校订字幕'}
               </Button>
               <Button
                variant="tertiary"
                size="sm"
                isDisabled={busy}
                onClick={() =>
                 void task(async () => {
                  await invoke('subtitles:import', {id: lectureId})
                  await reloadLecture()
                 })
                }
               >
                <StudyIcon name="upload" />
                导入 SRT
               </Button>
               {lecture.segments.length > 0 && (
                <>
                 <Button
                  variant="ghost"
                  size="sm"
                  isIconOnly
                  isDisabled={busy || !!lecture.correction}
                  onClick={() => setSrtEdit(srtEdit === null ? lecture.srt : null)}
                 >
                  <StudyIcon name="edit" />
                  {srtEdit === null ? '编辑字幕' : '退出编辑'}
                 </Button>
                 <Button variant="tertiary" size="sm" onClick={() => exportResult('subtitles', 'srt')}>
                  <StudyIcon name="download" />
                  SRT
                 </Button>
                 <Button variant="tertiary" size="sm" onClick={() => exportResult('subtitles', 'txt')}>
                  <StudyIcon name="download" />
                  TXT
                 </Button>
                 <Button variant="tertiary" size="sm" onClick={() => exportResult('evidence-bundle', 'md')}>
                  <StudyIcon name="download" />
                  课程证据包
                 </Button>
                </>
               )}
              </div>
              {lecture.correction && (
               <p className="hint">
                已保存 {lecture.correction.completed}/{lecture.correction.total}{' '}
                条，以下为已完成部分；点击继续校订可恢复剩余内容。
               </p>
              )}
              {srtEdit !== null ? (
               <>
                <p className="hint">保存修改后，旧笔记与练习会清空，需重新生成。</p>
                <TextArea className="srt-editor" value={srtEdit} onChange={e => setSrtEdit(e.target.value)} />
                <Button
                 variant="primary"
                 size="sm"
                 isDisabled={busy}
                 onClick={() =>
                  void task(async () => {
                   await invoke('subtitles:save', {id: lectureId, srt: srtEdit})
                   await reloadLecture()
                   setSrtEdit(null)
                  })
                 }
                >
                 校验并保存字幕
                </Button>
               </>
              ) : lecture.segments.length ? (
               <>
                <Input
                 className="search"
                 placeholder="搜索老师的原话…"
                 aria-label="搜索字幕"
                 value={search}
                 onChange={e => setSearch(e.target.value)}
                />
                <div className="transcript">
                 {lecture.segments
                  .filter(s => s.text.includes(search))
                  .map((s, i) => (
                   <div className="subtitle" data-stamp={s.start} key={i}>
                    <button className="timestamp" onClick={() => jump(s.start)}>
                     <StudyIcon name="clock" />
                     {time(s.start, false)}
                    </button>
                    <div>
                     <p>{s.text}</p>
                     {s.uncertain && <small className="warning">待核对：{s.reason}</small>}
                     {s.originalText && s.originalText !== s.text && (
                      <details>
                       <summary>对照识别原文</summary>
                       <p>{s.originalText}</p>
                       <small>{s.reason}</small>
                      </details>
                     )}
                    </div>
                   </div>
                  ))}
                </div>
               </>
              ) : (
               <div className="empty">
                <h3>完整记录，不做摘要</h3>
                <p>
                 先添加语音识别原文和 PPT，
                 <br />
                 再交给千问识别与校订。原文保留，疑点明确标注。
                </p>
               </div>
              )}
             </>
            )}
            {tab === 'notes' && (
             <>
              <div className="toolbar">
               <Button
                variant="primary"
                size="sm"
                isDisabled={busy || !lecture.segments.length || !!lecture.correction}
                onClick={() => void task(() => generate('notes:generate'))}
               >
                {lecture.notes ? '重新提取重点' : '生成听课重点笔记'}
               </Button>
               {lecture.notes && (
                <>
                 <Button variant="tertiary" size="sm" onClick={() => exportResult('notes', 'md')}>
                  Markdown
                 </Button>
                 <Button variant="tertiary" size="sm" onClick={() => exportResult('notes', 'docx')}>
                  Word
                 </Button>
                </>
               )}
               <Button
                variant="tertiary"
                size="sm"
                isDisabled={busy}
                onClick={() => exportResult('evidence-bundle', 'json')}
               >
                <StudyIcon name="download" />
                证据包 JSON
               </Button>
               <Button
                variant="tertiary"
                size="sm"
                isDisabled={busy}
                onClick={() => exportResult('evidence-bundle', 'md')}
               >
                <StudyIcon name="download" />
                证据包 Markdown
               </Button>
              </div>
              {lecture.notes ? (
               <Notes
                notes={lecture.notes}
                jump={jump}
                disabled={busy}
                save={notes =>
                 task(async () => {
                  await invoke('notes:save', {id: lectureId, notes})
                  await reloadLecture()
                 })
                }
               />
              ) : (
               <div className="empty">
                <h3>有证据，才算重点</h3>
                <p>字幕完成后，提取“要考”“很重要”“要求掌握”等明确表态。</p>
               </div>
              )}
             </>
            )}
            {tab === 'practice' && (
             <>
              <div className="toolbar">
               <Button
                variant="primary"
                size="sm"
                isDisabled={busy || !lecture.segments.length || !!lecture.correction}
                onClick={() => void task(() => generate('practice:generate'))}
               >
                <StudyIcon name="practice" />
                生成课后练习
               </Button>
               {lecture.practice &&
                [...lecture.practice.past, ...lecture.practice.extended, ...(lecture.practice.generated || [])].some(
                 q => !q.answer || !q.explanation
                ) && (
                 <Button
                  variant="tertiary"
                  size="sm"
                  isDisabled={busy}
                  onClick={() => void task(() => generate('practice:prepare'))}
                 >
                  <StudyIcon name="sparkle" />
                  补全已有答案与详解
                 </Button>
                )}
               {lecture.practice &&
                ['md', 'docx', 'pdf'].map(f => (
                 <Button variant="ghost" size="sm" isIconOnly key={f} onClick={() => exportResult('practice', f)}>
                  <StudyIcon name="download" />
                  {f === 'md' ? 'Markdown' : f === 'docx' ? 'Word' : 'PDF'}
                 </Button>
                ))}
              </div>
              <label className="practice-options">
               <input
                type="checkbox"
                checked={withSearch}
                disabled={busy}
                onChange={e => setWithSearch(e.target.checked)}
               />
               搜索有来源的拓展题（较慢，需配置搜索服务）
              </label>
              {lecture.practice ? (
               <PracticePanel
                key={lectureId}
                data={lecture.practice}
                disabled={busy}
                submit={async (group, index, response) => {
                 await invoke('practice:submit', {id: lectureId, group, index, response})
                 await reloadLecture()
                }}
                answer={async (group, index) => {
                 let failure: unknown
                 const ok = await task(async () => {
                  try {
                   await invoke('practice:answer', {id: lectureId, group, index})
                  } catch (e) {
                   failure = e
                  } finally {
                   await reloadLecture()
                  }
                 })
                 if (failure) throw failure
                 if (!ok) throw new Error('请等待当前任务完成，再补全详解')
                }}
                reset={async (group, index) => {
                 await invoke('practice:reset', {id: lectureId, group, index})
                 await reloadLecture()
                }}
               />
              ) : (
               <div className="empty">
                <h3>围绕这一讲练习</h3>
                <p>
                 完成字幕后即可生成 AI 自测题和参考解析。
                 <br />
                 导入并拆题后，相关历年真题会单独列出。
                </p>
               </div>
              )}
             </>
            )}
           </div>
          </>
         ))}
       </ScrollShadow>
       <section className="agent-composer">
        {pendingChat && <ChatWaitingReply streaming={!!chatText} />}
        <form
         onSubmit={e => {
          e.preventDefault()
          if (!sessionId || !input.trim()) return
          const id = courseId,
           lid = lectureId,
           sid = sessionId,
           content = input
          setTab('chat')
          void task(async () => {
           request.current = crypto.randomUUID()
           setChatText('')
           setPendingChat(content)
           setInput('')
           try {
            await invoke('chat', {
             courseId: id,
             lectureId: lid || undefined,
             sessionId: sid,
             content,
             requestId: request.current
            })
           } finally {
            try {
             await reloadCourse(id)
            } finally {
             setChatText('')
             setPendingChat('')
            }
           }
          })
         }}
        >
         {sourceDraft && (
          <div className="draft-attachment">
           <span aria-hidden="true">
            <FileText size={18} />
           </span>
           <div>
            <strong>{basename(sourceDraft)}</strong>
            <Input
             className="local-path"
             aria-label="拖入文件完整路径"
             readOnly
             value={sourceDraft}
             title={sourceDraft}
            />
           </div>
           <Button variant="tertiary" size="sm" type="button" isDisabled={busy} onClick={() => setModal('lecture')}>
            建立课次
           </Button>
           <Button
            variant="ghost"
            size="sm"
            isIconOnly
            type="button"
            aria-label="移除待导入文件"
            onClick={() => setSourceDraft('')}
           >
            ×
           </Button>
          </div>
         )}
         <Surface className="composer-box" variant="default">
          <TextArea
           value={input}
           onChange={e => setInput(e.target.value)}
           placeholder="输入消息，或拖入语音原文、PPT…"
           aria-label="追问内容"
           onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
             e.preventDefault()
             if (input.trim() && !busy) e.currentTarget.form?.requestSubmit()
            }
           }}
          />
          <div className="composer-controls">
           <div className="attachment-menu-anchor">
            <Button
             variant="ghost"
             isIconOnly
             className="composer-plus"
             aria-label="附件与工具"
             aria-expanded={menu}
             onClick={() => setMenu(!menu)}
            >
             <Plus size={20} />
            </Button>
            {menu && (
             <div className="attachment-menu" role="menu">
              <Button
               variant="tertiary"
               size="sm"
               type="button"
               isDisabled={busy}
               onClick={() => {
                setMenu(false)
                setModal(lectureId ? 'transcript' : 'lecture')
               }}
              >
               <Search size={16} />
               添加语音识别原文
              </Button>
              <Button
               variant="tertiary"
               size="sm"
               type="button"
               isDisabled={busy}
               onClick={() => {
                setMenu(false)
                setModal(lectureId ? 'courseware' : 'lecture')
               }}
              >
               <Presentation size={16} />
               添加 PPT/课件
              </Button>
              <Button
               variant="tertiary"
               size="sm"
               type="button"
               onClick={() => {
                setMenu(false)
                setModal('zhiyun')
               }}
              >
               <span aria-hidden="true">
                <CloudDownload size={18} strokeWidth={1.7} />
               </span>
               智云课堂 · 搜索与导出
              </Button>
              <Button
               variant="tertiary"
               size="sm"
               type="button"
               onClick={() => {
                setMenu(false)
                setModal('materials')
               }}
              >
               <BookOpen size={16} />
               课前资料
              </Button>
              <Button
               variant="tertiary"
               size="sm"
               type="button"
               onClick={() => {
                setMenu(false)
                setTab('chat')
               }}
              >
               <MessagesSquare size={16} />
               聊天记录
              </Button>
              <Button
               variant="tertiary"
               size="sm"
               type="button"
               onClick={() => {
                setMenu(false)
                void task(() => invoke('library:open'))
               }}
              >
               <Folder size={16} />
               资料文件夹
              </Button>
              <div className="menu-divider" />
              <Button
               variant="tertiary"
               size="sm"
               type="button"
               isDisabled={!lecture || busy}
               onClick={() => {
                setMenu(false)
                setTab('subtitles')
                void task(() => generate('subtitles:generate'))
               }}
              >
               <CirclePlay size={16} />
               校订完整字幕
              </Button>
              <Button
               variant="tertiary"
               size="sm"
               type="button"
               isDisabled={!lecture?.segments.length || !!lecture?.correction || busy}
               onClick={() => {
                setMenu(false)
                setTab('notes')
                void task(() => generate('notes:generate'))
               }}
              >
               <StudyIcon name="sparkle" />
               提取重点笔记
              </Button>
              <Button
               variant="tertiary"
               size="sm"
               type="button"
               isDisabled={!lecture?.segments.length || !!lecture?.correction || busy}
               onClick={() => {
                setMenu(false)
                setTab('practice')
                void task(() => generate('practice:generate'))
               }}
              >
               <StudyIcon name="practice" />
               生成课后练习
              </Button>
              <div className="menu-divider" />
              <Button
               variant="tertiary"
               size="sm"
               type="button"
               onClick={() => {
                setMenu(false)
                setTab('activity')
               }}
              >
               <History size={16} />
               任务轨迹
              </Button>
             </div>
            )}
           </div>
           <Button
            variant="ghost"
            className="composer-model-trigger"
            aria-label="选择对话模型"
            aria-haspopup="dialog"
            aria-expanded={modal === 'settings'}
            isDisabled={busy}
            onClick={() => setModal('settings')}
           >
            <span className={`composer-brand ${modelBrand}`} aria-hidden="true">
             {modelBrand === 'custom' && <Boxes />}
            </span>
            <span className="composer-model-name">{activeProfile?.model || '请选择千问模型'}</span>
            <ChevronDown size={14} />
           </Button>
           {busy ? (
            <Button
             type="button"
             variant="primary"
             isIconOnly
             className="composer-send"
             aria-label="停止任务"
             onClick={() => void invoke('cancel')}
            >
             <Square size={20} />
            </Button>
           ) : (
            <Button
             type="submit"
             variant="primary"
             isIconOnly
             className="composer-send"
             aria-label="发送消息"
             isDisabled={!input.trim()}
            >
             <ArrowUp size={20} />
            </Button>
           )}
          </div>
         </Surface>
        </form>
       </section>
      </>
     )}
    </main>
    {modal === 'files' && (
     <FileManager
      initialCourse={detail?.course.name}
      busy={busy}
      close={() => setModal(null)}
      changed={async () => {
       setCourses(await invoke<Course[]>('courses'))
       if (courseId) await reloadCourse()
       if (lectureId) await reloadLecture()
      }}
     />
    )}
    {modal === 'course' && (
     <NewCourse
      close={() => setModal(null)}
      busy={busy}
      create={(name, senior, exams) =>
       task(async () => {
        const c = await invoke<Course>('course:create', {name})
        setCourses(await invoke<Course[]>('courses'))
        setCourseId(c.id)
        if (senior.length) await invoke('files:add', {courseId: c.id, kind: 'senior_notes', paths: senior})
        if (exams.length) await invoke('files:add', {courseId: c.id, kind: 'past_exam', paths: exams})
        setModal(null)
        await reloadCourse(c.id)
       })
      }
     />
    )}
    {modal === 'lecture' && (
     <NewLecture
      courseId={courseId}
      draft={sourceDraft}
      pptDraft={pptDraft}
      close={() => {
       setPptDraft('')
       setModal(null)
      }}
      busy={busy}
      create={(title, transcriptPath, pptPath) =>
       task(async () => {
        const value = await invoke<{
         id: string
        }>('lecture:create', {courseId, title, transcriptPath, pptPath})
        await reloadCourse()
        setLectureId(value.id)
        setSourceDraft('')
        setPptDraft('')
        setTab('subtitles')
        setModal(null)
       })
      }
     />
    )}
    {modal === 'transcript' && (
     <AddTranscript
      courseId={courseId}
      draft={sourceDraft}
      close={() => setModal(null)}
      busy={busy}
      save={path =>
       task(async () => {
        await invoke('lecture:transcript', {id: lectureId, path})
        await reloadLecture()
        await reloadCourse()
        setSourceDraft('')
        setModal(null)
       })
      }
     />
    )}
    {modal === 'courseware' && (
     <AddCourseware
      courseId={courseId}
      draft={pptDraft}
      close={() => {
       setPptDraft('')
       setModal(null)
      }}
      busy={busy}
      save={path =>
       task(async () => {
        await invoke('lecture:courseware', {id: lectureId, path})
        await reloadLecture()
        setPptDraft('')
        setModal(null)
       })
      }
     />
    )}
    {modal === 'settings' && settings && (
     <SettingsHub
      visible
      initial={settings}
      busy={busy}
      error={error}
      close={() => setModal(null)}
      save={async value => {
       let ok = false
       await task(async () => {
        setSettings(await invoke<Settings>('settings:save', {settings: value}))
        ok = true
       })
       return ok
      }}
      appearance={appearance}
      appearanceSaved={setAppearance}
      courses={courses}
      courseId={courseId}
      identity={identity}
      identitySave={async value => setIdentity(await invoke<Identity>('identity:save', {identity: value}))}
     />
    )}
    {modal === 'materials' && detail && (
     <Materials
      files={() => setModal('files')}
      detail={detail}
      busy={busy}
      close={() => setModal(null)}
      run={fn =>
       task(async () => {
        await fn()
        await reloadCourse()
       })
      }
     />
    )}
   </div>
  </IdentityContext.Provider>
 )
}
