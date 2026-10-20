import {Button, Input} from '@heroui/react'
import {useEffect, useMemo, useRef, useState} from 'react'
import type {ZhiyunCourse, ZhiyunLesson} from '@shared/types'
import {WindowMenuButton, WindowPanel} from '@renderer/ui/WindowPanel'
import {SelectField} from '@renderer/ui/SelectField'
import {notify} from '@renderer/ui/ToastHost'
import {useSettingsNavigation} from '@renderer/app/settings-navigation'
const invoke = <T,>(action: string, args?: unknown) => window.assistant.invoke<T>(action, args)
const courseLabel = (course: ZhiyunCourse) => [course.title, course.teacher, course.term].filter(Boolean).join(' · ')
const courseKey = (course: Pick<ZhiyunCourse, 'title' | 'teacher'>) => course.title + '\u0000' + course.teacher
const lessonCacheTtl = 2 * 60 * 1000
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
 const settings = useSettingsNavigation()
 const [keyword, setKeyword] = useState(''),
  [courses, setCourses] = useState<ZhiyunCourse[]>([]),
  [course, setCourse] = useState<ZhiyunCourse | null>(null),
  [lessons, setLessons] = useState<ZhiyunLesson[]>([]),
  [subId, setSubId] = useState('')
 const [searching, setSearching] = useState(false),
  [lessonsLoading, setLessonsLoading] = useState(false),
  [exporting, setExporting] = useState(false),
  [progress, setProgress] = useState(''),
  [saved, setSaved] = useState(''),
  [page, setPage] = useState(1),
  [hasMore, setHasMore] = useState(false)
 const lessonsCache = useRef(new Map<string, {at: number; promise: Promise<ZhiyunLesson[]>}>()),
  lessonRequest = useRef(0)
 useEffect(
  () =>
   window.assistant.onEvent(e => {
    if (e.kind === 'progress' && e.data.stage === '智云课堂') setProgress(e.data.message)
   }),
  []
 )
 function requestLessons(id: string) {
  const cached = lessonsCache.current.get(id)
  if (cached && Date.now() - cached.at < lessonCacheTtl) return cached.promise
  const promise = invoke<ZhiyunLesson[]>('zhiyun:lessons', {courseId: id})
  lessonsCache.current.set(id, {at: Date.now(), promise})
  promise.catch(() => {
   if (lessonsCache.current.get(id)?.promise === promise) lessonsCache.current.delete(id)
  })
  return promise
 }
 async function loadLessons(value: ZhiyunCourse): Promise<ZhiyunLesson[] | null> {
  const request = ++lessonRequest.current
  setCourse(value)
  setLessonsLoading(true)
  setProgress('')
  try {
   const rows = await requestLessons(value.id)
   if (request !== lessonRequest.current) return null
   setLessons(rows)
   setSubId(rows[0]?.id || '')
   return rows
  } catch (e) {
   if (request !== lessonRequest.current) return null
   setLessons([])
   setSubId('')
   notify.error(e, {title: '读取课次失败'})
   return null
  } finally {
   if (request === lessonRequest.current) setLessonsLoading(false)
  }
 }
 function chooseCourse(terms: ZhiyunCourse[]) {
  for (const term of terms) void requestLessons(term.id).catch(() => {})
  void loadLessons(terms[0])
 }
 const groups = useMemo(() => {
  const map = new Map<string, {key: string; title: string; teacher: string; terms: ZhiyunCourse[]}>()
  for (const c of courses) {
   const key = courseKey(c),
    group = map.get(key)
   if (group) group.terms.push(c)
   else map.set(key, {key, title: c.title, teacher: c.teacher, terms: [c]})
  }
  for (const group of map.values()) {
   group.terms.sort((a, b) => (b.term || '').localeCompare(a.term || ''))
   group.terms = group.terms.filter((t, i, all) => !t.term || all.findIndex(x => x.term === t.term) === i)
  }
  return [...map.values()]
 }, [courses])
 const activeGroup = course ? groups.find(group => group.key === courseKey(course)) : undefined
 async function search(next = 1) {
  setSearching(true)
  if (next === 1) {
   setCourse(null)
   setLessons([])
   setSubId('')
   setSaved('')
   setProgress('')
   setLessonsLoading(false)
   lessonsCache.current.clear()
   lessonRequest.current++
  }
  try {
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
    const rows = await loadLessons(value)
    const sub = url.searchParams.get('sub_id')
    if (rows && sub) setSubId(sub)
    return
   }
   const result = await invoke<{courses: ZhiyunCourse[]; hasMore: boolean}>('zhiyun:search', {keyword, page: next})
   setCourses(
    next === 1 ? result.courses : rows => [...new Map([...rows, ...result.courses].map(c => [c.id, c])).values()]
   )
   setPage(next)
   setHasMore(result.hasMore)
   if (!result.courses.length && next === 1) setProgress('没有找到课程，请换一个名称搜索')
  } catch (e) {
   notify.error(e, {title: '搜索智云课程失败'})
  } finally {
   setSearching(false)
  }
 }
 async function exportResource(kind: 'transcript' | 'ppt') {
  if (!course || !subId || exporting || lessonsLoading) return
  setExporting(true)
  setSaved('')
  setProgress(kind === 'transcript' ? '正在准备语音识别原文…' : '正在准备 PPT…')
  try {
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
    notify.success('智云资源已导出并关联课次', {description: result.path, timeout: 6000})
   } else setProgress('已取消导出')
  } catch (e) {
   notify.error(e, {title: '导出智云资源失败'})
  } finally {
   setExporting(false)
  }
 }
 const lesson = lessons.find(row => row.id === subId)
 const locked = searching || exporting
 return (
  <WindowPanel
   visible={visible}
   label="智云导入"
   title="智云导入"
   description="搜索智云课程，导出语音原文与课件；登录在设置中完成。"
   heading="智云导入"
   subheading={
    lessonsLoading
     ? course
      ? courseLabel(course) + ' · 正在加载课次…'
      : '正在加载课次…'
     : progress || (course ? courseLabel(course) : '登录后搜索课程，导出原文与 PPT')
   }
   menu={
    <>
     {groups.map(group => (
      <WindowMenuButton
       key={group.key}
       active={group.key === activeGroup?.key}
       disabled={locked}
       title={[group.title, group.teacher].filter(Boolean).join(' · ')}
       onSelect={() => chooseCourse(group.terms)}
      >
       {group.title}
       {group.teacher ? ` · ${group.teacher}` : ''}
      </WindowMenuButton>
     ))}
     {!groups.length && <p className="window-menu-empty">搜索后在这里选择课程</p>}
     {hasMore && (
      <WindowMenuButton disabled={locked} onSelect={() => void search(page + 1)}>
       加载更多
      </WindowMenuButton>
     )}
    </>
   }
   actions={
    <Button variant="tertiary" size="sm" isDisabled={locked} onClick={() => settings.open('zhiyun')}>
     登录智云课堂
    </Button>
   }
   close={close}
  >
   <div className="panel-section">
    <form
     className="panel-inline-form"
     onSubmit={e => {
      e.preventDefault()
      if (!searching) void search()
     }}
    >
     <Input
      aria-label="搜索智云课程"
      placeholder="搜索课程名称，或粘贴智云课程链接"
      value={keyword}
      disabled={locked}
      onChange={e => setKeyword(e.target.value)}
     />
     <Button type="submit" variant="tertiary" size="sm" isDisabled={locked || !keyword.trim()}>
      搜索
     </Button>
    </form>
    <div className="row zhiyun-picks">
     {activeGroup && activeGroup.terms.length > 1 && (
      <label>
       选择学期
       <SelectField
        label="选择智云学期"
        placeholder="选择学期"
        value={course?.id || ''}
        isDisabled={locked}
        onChange={next => {
         const value = activeGroup.terms.find(t => t.id === next)
         if (value && value.id !== course?.id) void loadLessons(value)
        }}
        options={activeGroup.terms.map(t => ({
         value: t.id,
         label: t.term || '未标学期'
        }))}
       />
      </label>
     )}
     <label>
      选择课次
      <SelectField
       label="选择智云课次"
       placeholder="选择具体课次"
       value={subId}
       isDisabled={locked || !lessons.length}
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
    </div>
    {course && !lessons.length && !lessonsLoading && !searching && <p className="hint">本课程暂无可读取的课次</p>}
    <div className="row">
     <Button
      variant="primary"
      size="sm"
      isDisabled={locked || !lesson}
      onClick={() => void exportResource('transcript')}
     >
      导出语音识别-原文
     </Button>
     <Button variant="tertiary" size="sm" isDisabled={locked || !lesson} onClick={() => void exportResource('ppt')}>
      导出 PPT
     </Button>
     {exporting && (
      <Button variant="ghost" size="sm" onClick={() => void invoke('cancel')}>
       取消导出
      </Button>
     )}
    </div>
    <p className="hint">原文保存到“语音原文”，课件保存到“PPT”；自动关联同一课次。</p>
    {saved && <Input aria-label="智云资源保存路径" readOnly value={saved} />}
   </div>
  </WindowPanel>
 )
}
