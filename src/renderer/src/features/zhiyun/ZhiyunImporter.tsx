import {Button, Input} from '@heroui/react'
import {useEffect, useState} from 'react'
import type {ZhiyunCourse, ZhiyunLesson} from '@shared/types'
import {WindowMenuButton, WindowPanel} from '@renderer/ui/WindowPanel'
import {SelectField} from '@renderer/ui/SelectField'
import {AlertBox} from '@renderer/ui/AlertBox'
import {ZhiyunLoginPanel} from '@renderer/features/zhiyun/ZhiyunLogin'
const invoke = <T,>(action: string, args?: unknown) => window.assistant.invoke<T>(action, args)
export function ZhiyunImporter({
 visible,
 close,
 localCourseId,
 imported
}: {
 visible: boolean
 close: () => void
 localCourseId: string
 imported: (lectureId: string, courseId: string) => Promise<void>
}) {
 const [view, setView] = useState<'search' | 'login'>('search')
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
    const value = {
     id: url.searchParams.get('course_id')!,
     title: '智云课程 ' + url.searchParams.get('course_id'),
     teacher: '',
     term: ''
    }
    setCourses([value])
    setHasMore(false)
    await select(value)
    const sub = url.searchParams.get('sub_id')
    if (sub) setSubId(sub)
    return
   }
   const result = await invoke<{courses: ZhiyunCourse[]; hasMore: boolean}>('zhiyun:search', {keyword, page: next})
   setCourses(
    next === 1 ? result.courses : rows => [...new Map([...rows, ...result.courses].map(c => [c.id, c])).values()]
   )
   setPage(next)
   setHasMore(result.hasMore)
   if (!result.courses.length && next === 1) setProgress('没有找到课程，请换一个名称搜索')
  })
 }
 async function exportResource(kind: 'transcript' | 'ppt') {
  if (!course || !subId) return
  await run(async () => {
   setProgress(kind === 'transcript' ? '正在准备语音识别原文…' : '正在准备 PPT…')
   const result = await invoke<{path: string; lectureId: string; courseId: string}>('zhiyun:export', {
    courseId: course.id,
    courseName: course.title,
    subId,
    kind,
    localCourseId: localCourseId || undefined
   })
   if (result) {
    setSaved(result.path)
    await imported(result.lectureId, result.courseId)
    setProgress('导出并关联课次完成')
   } else setProgress('已取消导出')
  })
 }
 const lesson = lessons.find(row => row.id === subId)
 return (
  <WindowPanel
   visible={visible}
   label="智云课堂"
   title="智云课堂"
   description="搜索智云课程，导出语音原文与课件。"
   heading="智云课堂"
   subheading={progress || '登录后搜索课程，导出原文与 PPT'}
   menu={
    <>
     {courses.map(c => (
      <WindowMenuButton
       key={c.id}
       active={course?.id === c.id}
       disabled={busy}
       onSelect={() => void run(() => select(c))}
      >
       {c.title}
       {c.teacher ? ` · ${c.teacher}` : ''}
      </WindowMenuButton>
     ))}
     {!courses.length && <p className="window-menu-empty">搜索后在这里选择课程</p>}
     {hasMore && (
      <WindowMenuButton disabled={busy} onSelect={() => void search(page + 1)}>
       加载更多
      </WindowMenuButton>
     )}
    </>
   }
   actions={
    view === 'login' ? (
     <Button variant="ghost" size="sm" onClick={() => setView('search')}>
      返回搜索与导出
     </Button>
    ) : (
     <Button variant="tertiary" size="sm" isDisabled={busy} onClick={() => setView('login')}>
      登录智云课堂
     </Button>
    )
   }
   close={close}
  >
   {visible && view === 'login' ? (
    <ZhiyunLoginPanel />
   ) : (
    <div className="panel-section">
     <form
      className="panel-inline-form"
      onSubmit={e => {
       e.preventDefault()
       void search()
      }}
     >
      <Input
       aria-label="搜索智云课程"
       placeholder="搜索课程名称，或粘贴智云课程链接"
       value={keyword}
       disabled={busy}
       onChange={e => setKeyword(e.target.value)}
      />
      <Button type="submit" variant="tertiary" size="sm" isDisabled={busy || !keyword.trim()}>
       搜索
      </Button>
     </form>
     {error && <AlertBox>{error}</AlertBox>}
     <label>
      选择课次
      <SelectField
       label="选择智云课次"
       placeholder="选择具体课次"
       value={subId}
       isDisabled={busy || !lessons.length}
       onChange={next => setSubId(next)}
       options={[
        {value: '', label: '选择具体课次'},
        ...lessons.map(row => ({
         value: row.id,
         label: row.title + (row.teacher ? ' · ' + row.teacher : '')
        }))
       ]}
      />
     </label>
     {course && !lessons.length && !busy && <p className="hint">本课程暂无可读取的课次</p>}
     <div className="row">
      <Button
       variant="primary"
       size="sm"
       isDisabled={busy || !lesson}
       onClick={() => void exportResource('transcript')}
      >
       导出语音识别-原文
      </Button>
      <Button variant="tertiary" size="sm" isDisabled={busy || !lesson} onClick={() => void exportResource('ppt')}>
       导出 PPT
      </Button>
     </div>
     <p className="hint">原文保存到“语音原文”，课件保存到“PPT”；自动关联同一课次。</p>
     {saved && <Input aria-label="智云资源保存路径" readOnly value={saved} />}
     {busy && (
      <div className="row">
       <Button variant="ghost" size="sm" onClick={() => void invoke('cancel')}>
        取消导出
       </Button>
       <span className="hint">{progress}</span>
      </div>
     )}
    </div>
   )}
  </WindowPanel>
 )
}
