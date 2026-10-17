import {useEffect, useState} from 'react'
import type {ZhiyunCourse, ZhiyunLesson} from '../../shared/types'
const invoke = <T,>(action: string, args?: unknown) => window.assistant.invoke<T>(action, args)
export function ZhiyunImporter({visible, close, login, localCourseId, imported}: {visible: boolean; close: () => void; login: () => void; localCourseId: string; imported: (lectureId: string, courseId: string) => Promise<void>}) {
 const [keyword, setKeyword] = useState(''),
  [courses, setCourses] = useState<ZhiyunCourse[]>([]),
  [course, setCourse] = useState<ZhiyunCourse | null>(null),
  [lessons, setLessons] = useState<ZhiyunLesson[]>([]),
  [subId, setSubId] = useState('')
 const [busy, setBusy] = useState(false),
  [error, setError] = useState(''),
  [progress, setProgress] = useState(''),
  [saved, setSaved] = useState(''),
  [page, setPage] = useState(1),
  [hasMore, setHasMore] = useState(false)
 useEffect(
  () =>
   window.assistant.onEvent(e => {
    if (e.kind === 'progress' && e.data.stage === '智云课堂') setProgress(e.data.message)
   }),
  []
 )
 async function run(fn: () => Promise<void>) {
  setBusy(true)
  setError('')
  setSaved('')
  setProgress('')
  try {
   await fn()
  } catch (e) {
   setError(e instanceof Error ? e.message : String(e))
  } finally {
   setBusy(false)
  }
 }
 async function select(value: ZhiyunCourse) {
  setCourse(value)
  setLessons([])
  setSubId('')
  const rows = await invoke<ZhiyunLesson[]>('zhiyun:lessons', {courseId: value.id})
  setLessons(rows)
  setSubId(rows[0]?.id || '')
 }
 async function search(next = 1) {
  await run(async () => {
   setCourse(null)
   setLessons([])
   setSubId('')
   let url: URL | null = null
   try {
    url = new URL(keyword)
   } catch {}
   if (url && /(^|\.)cmc\.zju\.edu\.cn$/.test(url.hostname) && /^\d+$/.test(url.searchParams.get('course_id') || '')) {
    const value = {id: url.searchParams.get('course_id')!, title: '智云课程 ' + url.searchParams.get('course_id'), teacher: '', term: ''}
    setCourses([value])
    setHasMore(false)
    await select(value)
    const sub = url.searchParams.get('sub_id')
    if (sub) setSubId(sub)
    return
   }
   const result = await invoke<{courses: ZhiyunCourse[]; hasMore: boolean}>('zhiyun:search', {keyword, page: next})
   setCourses(next === 1 ? result.courses : rows => [...new Map([...rows, ...result.courses].map(c => [c.id, c])).values()])
   setPage(next)
   setHasMore(result.hasMore)
   if (!result.courses.length && next === 1) setProgress('没有找到课程，请换一个名称搜索')
  })
 }
 async function exportResource(kind: 'transcript' | 'ppt') {
  if (!course || !subId) return
  await run(async () => {
   setProgress(kind === 'transcript' ? '正在准备语音识别原文…' : '正在准备 PPT…')
   const result = await invoke<{path: string; lectureId: string; courseId: string}>('zhiyun:export', {courseId: course.id, courseName: course.title, subId, kind, localCourseId: localCourseId || undefined})
   if (result) {
    setSaved(result.path)
    await imported(result.lectureId, result.courseId)
    setProgress('导出并关联课次完成')
   } else setProgress('已取消导出')
  })
 }
 const lesson = lessons.find(row => row.id === subId)
 return (
  <section className="zhiyun-dialog zhiyun-page" aria-label="智云课堂" hidden={!visible} style={!visible ? {display: 'none'} : undefined}>
   <header>
    <div>
     <h2>智云课堂</h2>
    </div>
    <button aria-label="返回课程对话" onClick={close}>
     返回课程对话
    </button>
   </header>
   <div className="zhiyun-login">
    <button disabled={busy} onClick={login}>
     登录智云课堂
    </button>
   </div>
   <form
    className="zhiyun-search"
    onSubmit={e => {
     e.preventDefault()
     void search()
    }}
   >
    <input aria-label="搜索智云课程" placeholder="搜索课程名称，或粘贴智云课程链接" value={keyword} disabled={busy} onChange={e => setKeyword(e.target.value)} />
    <button className="primary" disabled={busy || !keyword.trim()}>
     搜索
    </button>
   </form>
   {error && (
    <div className="alert" role="alert">
     {error}
    </div>
   )}
   <div className="zhiyun-content">
    <div className="zhiyun-courses">
     <h3>课程</h3>
     {courses.map(c => (
      <button key={c.id} className={course?.id === c.id ? 'selected' : ''} disabled={busy} onClick={() => void run(() => select(c))}>
       <strong>{c.title}</strong>
       <small>{[c.teacher, c.term].filter(Boolean).join(' · ')}</small>
      </button>
     ))}
     {!courses.length && <p>搜索后在这里选择课程</p>}
     {hasMore && (
      <button disabled={busy} onClick={() => void search(page + 1)}>
       加载更多
      </button>
     )}
    </div>
    <div className="zhiyun-lessons">
     <h3>{course?.title || '课次'}</h3>
     <label>
      选择课次
      <select aria-label="选择智云课次" value={subId} disabled={busy || !lessons.length} onChange={e => setSubId(e.target.value)}>
       <option value="">选择具体课次</option>
       {lessons.map(row => (
        <option key={row.id} value={row.id}>
         {row.title}
         {row.teacher ? ' · ' + row.teacher : ''}
        </option>
       ))}
      </select>
     </label>
     {course && !lessons.length && !busy && <p>本课程暂无可读取的课次</p>}
     <div className="zhiyun-export">
      <button className="primary" disabled={busy || !lesson} onClick={() => void exportResource('transcript')}>
       导出语音识别-原文
      </button>
      <button disabled={busy || !lesson} onClick={() => void exportResource('ppt')}>
       导出 PPT
      </button>
     </div>
     <p className="hint">原文保存到“语音原文”，课件保存到“PPT”；自动关联同一课次。</p>
    </div>
   </div>
   <footer className="zhiyun-status" aria-live="polite">
    <span>{progress}</span>
    {busy && <button onClick={() => void invoke('cancel')}>取消导出</button>}
    {saved && <input aria-label="智云资源保存路径" readOnly value={saved} />}
   </footer>
  </section>
 )
}
