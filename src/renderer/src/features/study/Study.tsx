import {Tabs} from '@heroui/react'
import {ConfirmDialog} from '@renderer/ui/ConfirmDialog'
import {WindowPanel} from '@renderer/ui/WindowPanel'
import {notify} from '@renderer/ui/ToastHost'
import {useEffect, useRef, useState} from 'react'
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs'
import {
 ScheduleContent,
 ScheduleMenu,
 type ScheduleIssue,
 type ScheduleProps
} from '@renderer/features/study/SchedulePanel'
import {TextbookContent, TextbookMenu, type TextbookProps} from '@renderer/features/study/TextbookPanel'
import {validTimeZone} from '@renderer/features/study/datetime'
import type {Book, Draft} from '@renderer/features/study/types'
import type {Highlight, StudyEntry} from '@shared/study'
import type {Course, Detail, Progress} from '@shared/types'

const invoke = <T,>(action: string, args?: unknown) => window.assistant.invoke<T>(action, args)

const normalize = (entry: StudyEntry): StudyEntry => ({
 id: entry.id,
 courseId: entry.courseId,
 lectureId: entry.lectureId,
 title: entry.title,
 chapter: entry.chapter,
 endsAt: entry.endsAt,
 zhiyunCourseId: entry.zhiyunCourseId,
 subId: entry.subId
})

const snapshotOf = (entries: StudyEntry[]) => JSON.stringify(entries.map(normalize))

function collectIssues(entries: StudyEntry[]): ScheduleIssue[] {
 const issues: ScheduleIssue[] = []
 for (const entry of entries) {
  if (!entry.courseId) issues.push({id: entry.id, message: '选择课程'})
  if (!entry.title.trim()) issues.push({id: entry.id, message: '填写课次名称'})
  if (!entry.chapter.trim()) issues.push({id: entry.id, message: '填写教材章节'})
  if (entry.endsAt && !Number.isFinite(Date.parse(entry.endsAt)))
   issues.push({id: entry.id, message: '填写有效的结束时间，或勾选时间待定'})
  if (entry.zhiyunCourseId && !/^\d+$/.test(entry.zhiyunCourseId))
   issues.push({id: entry.id, message: '智云课程编号只能是数字'})
  if (entry.subId && !/^\d+$/.test(entry.subId)) issues.push({id: entry.id, message: '智云课次编号只能是数字'})
 }
 return issues
}

export function Study({
 visible,
 courses,
 close,
 refresh
}: {
 visible: boolean
 courses: Course[]
 close: () => void
 refresh: () => Promise<unknown>
}) {
 const [entries, setEntries] = useState<StudyEntry[]>([]),
  [snapshot, setSnapshot] = useState('[]'),
  [selected, setSelected] = useState(''),
  [detail, setDetail] = useState<Detail | null>(null),
  [tab, setTab] = useState<'schedule' | 'textbook'>('schedule'),
  [timezone, setTimezone] = useState('Asia/Shanghai'),
  [book, setBook] = useState<Book | null>(null),
  [pageNumber, setPageNumber] = useState(1),
  [first, setFirst] = useState(1),
  [last, setLast] = useState(1),
  [draft, setDraft] = useState<Draft | null>(null),
  [chosen, setChosen] = useState<string[]>([]),
  [pdfVersion, setPdfVersion] = useState(0),
  [busy, setBusy] = useState(false),
  [progress, setProgress] = useState<Progress | null>(null),
  [confirmClose, setConfirmClose] = useState(false)
 const working = useRef(false),
  loaded = useRef(false)
 const entry = entries.find(item => item.id === selected),
  issues = collectIssues(entries),
  dirty = JSON.stringify(entries.map(normalize)) !== snapshot,
  lectureTitle = detail?.lectures.find(lecture => lecture.id === entry?.lectureId)?.title,
  courseName = courses.find(course => course.id === entry?.courseId)?.name || ''
 async function run(task: () => Promise<void>) {
  if (working.current) return false
  working.current = true
  setBusy(true)
  setProgress(null)
  try {
   await task()
   return true
  } catch (reason) {
   notify.error(reason)
   return false
  } finally {
   working.current = false
   setBusy(false)
   setProgress(null)
  }
 }
 useEffect(() => {
  if (!visible || loaded.current) return
  loaded.current = true
  void invoke<StudyEntry[]>('study:get')
   .then(rows => {
    setEntries(rows)
    setSelected(rows[0]?.id || '')
    setSnapshot(snapshotOf(rows))
   })
   .catch(reason => {
    loaded.current = false
    notify.error(reason, {title: '读取课表失败'})
   })
 }, [visible])
 useEffect(
  () =>
   window.assistant.onEvent(event => {
    if (working.current && event.kind === 'progress') setProgress(event.data)
   }),
  []
 )
 useEffect(() => {
  let active = true
  if (entry)
   void invoke<Detail>('course:detail', {id: entry.courseId})
    .then(value => {
     if (active) setDetail(value)
    })
    .catch(reason => notify.error(reason, {title: '读取课程信息失败'}))
  else setDetail(null)
  return () => {
   active = false
  }
 }, [entry?.courseId])
 function selectEntry(id: string) {
  if (id !== selected && draft) {
   setDraft(null)
   setChosen([])
  }
  setSelected(id)
 }
 function update(value: Partial<StudyEntry>) {
  const current = entries.find(item => item.id === selected)
  if (!current) return
  setEntries(rows => rows.map(row => (row.id === selected ? {...row, ...value} : row)))
  const affectsDraft =
   ('courseId' in value && value.courseId !== current.courseId) ||
   ('chapter' in value && value.chapter !== current.chapter) ||
   ('lectureId' in value && value.lectureId !== current.lectureId)
  if (affectsDraft && draft) {
   setDraft(null)
   setChosen([])
   notify.info('课表信息已修改，当前划线建议已清空')
  }
 }
 function addEntry() {
  if (!courses.length) {
   notify.warning('还没有课程，请先创建课程')
   return
  }
  const row: StudyEntry = {
   id: crypto.randomUUID(),
   courseId: courses[0].id,
   title: '',
   chapter: '',
   endsAt: ''
  }
  setEntries(rows => [...rows, row])
  setSelected(row.id)
  setTab('schedule')
 }
 function deleteEntry() {
  if (!entry) return
  const index = entries.findIndex(item => item.id === entry.id),
   rows = entries.filter(item => item.id !== entry.id)
  setEntries(rows)
  setSelected(rows[Math.min(index, rows.length - 1)]?.id || '')
  setDraft(null)
  setChosen([])
 }
 function save() {
  void run(async () => {
   const rows = await invoke<StudyEntry[]>('study:save', {entries})
   setEntries(rows)
   setSnapshot(snapshotOf(rows))
   await refresh()
   notify.success('课表已保存，已关联课次的名称和聊天标题已同步更新。', {timeout: 8000})
  })
 }
 async function parseSchedule(text: string, nextTimezone: string) {
  if (!validTimeZone(nextTimezone)) {
   notify.warning('课表时区无效，请填写类似 Asia/Shanghai 的时区。')
   return false
  }
  return run(async () => {
   const rows = await invoke<StudyEntry[]>('study:parse', {text, timezone: nextTimezone})
   if (!rows.length) throw new Error('课表缺少明确的日期、结束时间或章节，或课程无法匹配，请补充后重试')
   setTimezone(nextTimezone)
   setEntries(rows)
   setSelected(rows[0].id)
   setDraft(null)
   setChosen([])
   notify.info(`已识别 ${rows.length} 条课次，请逐条核对并关联课次后保存。`, {timeout: 6000})
  })
 }
 function pickBook() {
  void run(async () => {
   const result = await invoke<Book | null>('textbook:pick')
   if (!result) return
   setBook(result)
   setPageNumber(1)
   setFirst(1)
   setLast(1)
   setDraft(null)
   setChosen([])
  })
 }
 function changeFirst(value: number) {
  setFirst(value)
  if (draft) {
   setDraft(null)
   setChosen([])
  }
 }
 function changeLast(value: number) {
  setLast(value)
  if (draft) {
   setDraft(null)
   setChosen([])
  }
 }
 function goPage(value: number) {
  if (!book) return
  setPageNumber(Math.max(1, Math.min(book.pages, value)))
 }
 function analyze() {
  if (!entry) {
   notify.warning('先在课表里选择一个课次。')
   return
  }
  if (!entry.lectureId) {
   notify.warning('请先在课表中关联已有课次，AI 才能读取本课字幕、重点与课件。')
   return
  }
  if (!book) {
   notify.warning('请先选择教材 PDF。')
   return
  }
  if (first < 1 || last < first || last > book.pages || last - first > 99) {
   notify.warning('请选择不超过 100 页的有效页码范围。')
   return
  }
  void run(async () => {
   let result: Draft
   const ppt = await invoke<{data: string; hash: string} | null>('textbook:ppt-source', {entryId: entry.id})
   if (ppt) {
    notify.info('正在识别本节课图片型 PPT 的文字，供 PPT 内容划线使用。', {timeout: 6000})
    const task = getDocument({data: Uint8Array.from(atob(ppt.data), character => character.charCodeAt(0))}),
     images: string[] = []
    try {
     const pdf = await task.promise
     if (pdf.numPages > 500) throw new Error('请选择本节课 PPT，不能使用全课程合并课件')
     for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number),
       viewport = page.getViewport({scale: 900 / page.getViewport({scale: 1}).width}),
       canvas = document.createElement('canvas')
      canvas.width = viewport.width
      canvas.height = viewport.height
      await page.render({canvas, canvasContext: canvas.getContext('2d')!, viewport}).promise
      images.push(canvas.toDataURL('image/jpeg', 0.8))
     }
    } finally {
     await task.destroy()
    }
    await invoke('textbook:ppt-ocr', {entryId: entry.id, hash: ppt.hash, images})
   }
   try {
    result = await invoke<Draft>('textbook:analyze', {id: book.id, entryId: entry.id, first, last})
   } catch (error) {
    if (!String(error).includes('扫描图片')) throw error
    if (last < first || last - first > 99 || last > book.pages) throw new Error('请选择不超过 100 页的章节范围')
    notify.info('正在识别扫描教材；请逐条核对文字和位置后保存。', {timeout: 6000})
    const data = await invoke<string>('textbook:bytes', {id: book.id}),
     task = getDocument({
      url: data,
      disableAutoFetch: true,
      disableStream: true,
      rangeChunkSize: 1048576,
      canvasMaxAreaInBytes: 32000000
     }),
     images: string[] = []
    try {
     const pdf = await task.promise
     for (let number = first; number <= last; number++) {
      const page = await pdf.getPage(number),
       viewport = page.getViewport({scale: Math.min(1.5, 1200 / page.getViewport({scale: 1}).width)}),
       canvas = document.createElement('canvas')
      canvas.width = viewport.width
      canvas.height = viewport.height
      await page.render({canvas, canvasContext: canvas.getContext('2d')!, viewport}).promise
      images.push(canvas.toDataURL('image/jpeg', 0.85))
     }
    } finally {
     await task.destroy()
    }
    result = await invoke<Draft>('textbook:analyze-images', {
     id: book.id,
     entryId: entry.id,
     first,
     last,
     images
    })
   }
   setDraft(result)
   setChosen(result.rows.map(row => row.id))
   notify.info(
    result.rows.length
     ? '请核对划线内容、位置与依据，再保存到原教材。'
     : '此范围没有找到依据充分的内容，原教材未修改。',
    {timeout: 6000}
   )
  })
 }
 function applyDraft() {
  if (!draft || !chosen.length) return
  void run(async () => {
   const result = await invoke<{path: string; count: number}>('textbook:apply', {id: draft.id, ids: chosen})
   setDraft(null)
   setChosen([])
   setPdfVersion(value => value + 1)
   notify.success(`已保存 ${result.count} 条划线到原教材；备份：${result.path}.划线前备份.pdf`, {
    timeout: 10000
   })
  })
 }
 async function manual(value: {
  rect: Highlight['rect']
  source: Highlight['source']
  evidence: string
  extension: boolean
 }) {
  if (!book) return false
  return run(async () => {
   await invoke('textbook:manual', {
    id: book.id,
    highlight: {
     id: crypto.randomUUID(),
     page: pageNumber,
     quote: '手动框选区域',
     ...value
    }
   })
   setPdfVersion(current => current + 1)
   notify.success('手动划线已保存到原教材。')
  })
 }
 function removeHighlights() {
  if (!book) return
  void run(async () => {
   await invoke('textbook:clear', {id: book.id})
   setDraft(null)
   setChosen([])
   setPdfVersion(current => current + 1)
   notify.success('已移除本软件添加的划线，原有批注保留。')
  })
 }
 const scheduleProps: ScheduleProps = {
  courses,
  entries,
  selected,
  detail,
  timezone,
  busy,
  dirty,
  issues,
  onSelect: selectEntry,
  onAdd: addEntry,
  onUpdate: update,
  onDelete: deleteEntry,
  onSave: save,
  onTimezone: setTimezone,
  onParse: parseSchedule
 }
 const textbookProps: TextbookProps = {
  entry,
  lectureTitle,
  book,
  pageNumber,
  first,
  last,
  draft,
  chosen,
  busy,
  progress,
  pdfVersion,
  onPickBook: pickBook,
  onAnalyze: analyze,
  onOpenBook: () => {
   if (book) void run(() => invoke('textbook:open', {id: book.id}))
  },
  onRemoveHighlights: removeHighlights,
  onCancel: () => void invoke('cancel'),
  onPageNumber: goPage,
  onFirst: changeFirst,
  onLast: changeLast,
  onChosen: setChosen,
  onApply: applyDraft,
  onManual: manual,
  onGoSchedule: () => setTab('schedule')
 }
 return (
  <>
   <WindowPanel
    visible={visible}
    className={'study-window' + (tab === 'textbook' ? ' study-window--textbook' : '')}
    label="课表与教材"
    title="课表与教材"
    description="先准备课表，再为每节课设置教材页面与划线。"
    heading={tab === 'schedule' ? '课表' : '教材划线'}
    subheading={
     tab === 'schedule'
      ? `${entries.length} 个课次 · 保存后会同步已关联课次的名称`
      : entry
        ? `${entry.title || '未命名课次'}${courseName ? ' · ' + courseName : ''}`
        : '先在课表里选择一个课次'
    }
    close={() => {
     if (dirty) setConfirmClose(true)
     else close()
    }}
    menu={tab === 'schedule' ? <ScheduleMenu {...scheduleProps} /> : <TextbookMenu {...textbookProps} />}
   >
    <Tabs
     className="study-tabs"
     selectedKey={tab}
     onSelectionChange={key => {
      if (key === 'schedule' || key === 'textbook') setTab(key)
     }}
    >
     <div className="study-modebar">
      <Tabs.ListContainer className="app-tabs__list-container">
       <Tabs.List aria-label="课表与教材">
        <Tabs.Tab className="app-tabs__tab" id="schedule">
         课表
         <Tabs.Indicator />
        </Tabs.Tab>
        <Tabs.Tab className="app-tabs__tab" id="textbook">
         教材划线
         <Tabs.Indicator />
        </Tabs.Tab>
       </Tabs.List>
      </Tabs.ListContainer>
      <small className="study-modebar__status">
       {busy
        ? `${progress?.stage || '正在处理'}…`
        : tab === 'schedule'
          ? '课表设置'
          : book
            ? `${book.pages} 页教材`
            : '未选择教材'}
      </small>
     </div>
     <Tabs.Panel
      className={'study-panel' + (tab !== 'schedule' ? ' study-panel--hidden' : '')}
      id="schedule"
      shouldForceMount
     >
      <ScheduleContent {...scheduleProps} />
     </Tabs.Panel>
     <Tabs.Panel
      className={'study-panel' + (tab !== 'textbook' ? ' study-panel--hidden' : '')}
      id="textbook"
      shouldForceMount
     >
      <TextbookContent {...textbookProps} />
     </Tabs.Panel>
    </Tabs>
   </WindowPanel>
   {confirmClose ? (
    <ConfirmDialog
     title="放弃未保存的课表修改？"
     confirmLabel="放弃并关闭"
     onCancel={() => setConfirmClose(false)}
     onConfirm={() => {
      setConfirmClose(false)
      close()
     }}
    >
     左侧课表还有未保存的修改。关闭窗口不会丢失已保存的课次，但会放弃这些修改。
    </ConfirmDialog>
   ) : null}
  </>
 )
}
