import {Button, Input, TextArea} from '@heroui/react'
import {WindowPanel} from '@renderer/ui/WindowPanel'
import {SelectField} from '@renderer/ui/SelectField'
import {AlertBox} from '@renderer/ui/AlertBox'
import {useEffect, useRef, useState} from 'react'
import {getDocument, GlobalWorkerOptions} from 'pdfjs-dist/legacy/build/pdf.mjs'
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url'
import {highlightColors, highlightLabels, checkAt, type Highlight, type StudyEntry} from '@shared/study'
import type {Course, Detail} from '@shared/types'
GlobalWorkerOptions.workerSrc = workerUrl
const invoke = <T,>(action: string, args?: unknown) => window.assistant.invoke<T>(action, args)
type Book = {id: string; path: string; pages: number}
export function Study({
 courses,
 close,
 refresh
}: {
 courses: Course[]
 close: () => void
 refresh: () => Promise<unknown>
}) {
 const [entries, setEntries] = useState<StudyEntry[]>([]),
  [text, setText] = useState(''),
  [timezone, setTimezone] = useState('Asia/Shanghai'),
  [detail, setDetail] = useState<Detail | null>(null),
  [selected, setSelected] = useState(''),
  [book, setBook] = useState<Book | null>(null),
  [first, setFirst] = useState(1),
  [last, setLast] = useState(1),
  [busy, setBusy] = useState(false),
  [error, setError] = useState(''),
  [notice, setNotice] = useState(''),
  [draft, setDraft] = useState<{id: string; rows: Highlight[]} | null>(null),
  [chosen, setChosen] = useState<string[]>([]),
  [pageNumber, setPageNumber] = useState(1),
  [source, setSource] = useState<Highlight['source']>('teacher'),
  [evidence, setEvidence] = useState(''),
  [extension, setExtension] = useState(false),
  [rectangle, setRectangle] = useState<Highlight['rect'] | null>(null),
  [image, setImage] = useState(''),
  [size, setSize] = useState({width: 1, height: 1})
 const viewport = useRef<ReturnType<import('pdfjs-dist/legacy/build/pdf.mjs').PDFPageProxy['getViewport']> | null>(
   null
  ),
  start = useRef<[number, number] | null>(null)
 const entry = entries.find(e => e.id === selected)
 async function run(fn: () => Promise<void>) {
  if (busy) return
  setBusy(true)
  setError('')
  try {
   await fn()
  } catch (e) {
   setError(e instanceof Error ? e.message : String(e))
  } finally {
   setBusy(false)
  }
 }
 useEffect(() => {
  void invoke<StudyEntry[]>('study:get')
   .then(rows => {
    setEntries(rows)
    setSelected(rows[0]?.id || '')
   })
   .catch(e => setError(String(e)))
 }, [])
 useEffect(() => {
  if (entry)
   void invoke<Detail>('course:detail', {id: entry.courseId})
    .then(setDetail)
    .catch(e => setError(String(e)))
  else setDetail(null)
 }, [entry?.courseId])
 useEffect(() => {
  let active = true
  const task = (async () => {
   if (!book) return
   const data = await invoke<string>('textbook:bytes', {id: book.id}),
    pdfTask = getDocument({
     url: data,
     disableAutoFetch: true,
     disableStream: true,
     rangeChunkSize: 1048576,
     canvasMaxAreaInBytes: 32000000
    })
   try {
    const pdf = await pdfTask.promise,
     page = await pdf.getPage(pageNumber),
     v = page.getViewport({scale: Math.min(1.25, 1000 / page.getViewport({scale: 1}).width)}),
     canvas = document.createElement('canvas')
    canvas.width = v.width
    canvas.height = v.height
    await page.render({canvas, canvasContext: canvas.getContext('2d')!, viewport: v}).promise
    if (active) {
     viewport.current = v
     setImage(canvas.toDataURL())
     setSize({width: v.width, height: v.height})
     setRectangle(null)
    }
   } finally {
    await pdfTask.destroy()
   }
  })()
  void task.catch(e => {
   if (active) setError(String(e))
  })
  return () => {
   active = false
  }
 }, [book, pageNumber, notice])
 async function analyzeBook() {
  if (!book) return
  let result: {id: string; rows: Highlight[]}
  const ppt = await invoke<{data: string; hash: string} | null>('textbook:ppt-source', {entryId: selected})
  if (ppt) {
   setNotice('正在识别本节课图片型 PPT 的文字，供浅蓝色划线使用')
   const task = getDocument({data: Uint8Array.from(atob(ppt.data), c => c.charCodeAt(0))}),
    images: string[] = []
   try {
    const pdf = await task.promise
    if (pdf.numPages > 500) throw new Error('请选择本节课 PPT，不能使用全课程合并课件')
    for (let n = 1; n <= pdf.numPages; n++) {
     const page = await pdf.getPage(n),
      v = page.getViewport({scale: 900 / page.getViewport({scale: 1}).width}),
      canvas = document.createElement('canvas')
     canvas.width = v.width
     canvas.height = v.height
     await page.render({canvas, canvasContext: canvas.getContext('2d')!, viewport: v}).promise
     images.push(canvas.toDataURL('image/jpeg', 0.8))
    }
   } finally {
    await task.destroy()
   }
   await invoke('textbook:ppt-ocr', {entryId: selected, hash: ppt.hash, images})
  }

  try {
   result = await invoke('textbook:analyze', {id: book.id, entryId: selected, first, last})
  } catch (error) {
   if (!String(error).includes('扫描图片')) throw error
   if (last < first || last - first > 99 || last > book.pages) throw new Error('请选择不超过 100 页的章节范围')
   setNotice('正在识别扫描教材；请逐条核对文字和位置后保存')
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
    for (let n = first; n <= last; n++) {
     const page = await pdf.getPage(n),
      v = page.getViewport({scale: Math.min(1.5, 1200 / page.getViewport({scale: 1}).width)}),
      canvas = document.createElement('canvas')
     canvas.width = v.width
     canvas.height = v.height
     await page.render({canvas, canvasContext: canvas.getContext('2d')!, viewport: v}).promise
     images.push(canvas.toDataURL('image/jpeg', 0.85))
    }
   } finally {
    await task.destroy()
   }
   result = await invoke('textbook:analyze-images', {id: book.id, entryId: selected, first, last, images})
  }
  setDraft(result)
  setChosen(result.rows.map(r => r.id))
  setNotice(
   result.rows.length ? '请核对划线内容、位置与依据，再保存到原教材' : '此范围没有找到依据充分的内容，原教材未修改'
  )
 }
 function update(value: Partial<StudyEntry>) {
  setEntries(rows => rows.map(row => (row.id === selected ? {...row, ...value} : row)))
  setDraft(null)
 }
 function point(event: React.MouseEvent<HTMLDivElement>) {
  const r = event.currentTarget.getBoundingClientRect()
  return [((event.clientX - r.left) / r.width) * size.width, ((event.clientY - r.top) / r.height) * size.height] as [
   number,
   number
  ]
 }
 return (
  <WindowPanel
   visible
   className="study-window"
   label="课表与教材"
   title="课表与教材"
   description="选择章节、预览建议，再保存可编辑划线。"
   heading="课表与教材"
   subheading="课表条目在左侧设置，教材预览与划线在右侧完成"
   close={close}
   menu={
    <div className="study-menu">
     <section className="study-menu__section">
      <h3>课表</h3>
      <label>
       粘贴课表
       <TextArea value={text} onChange={e => setText(e.target.value)} placeholder="请包含日期、课程、章节和结束时间" />
      </label>
      <label>
       课表时区
       <Input value={timezone} onChange={e => setTimezone(e.target.value)} />
      </label>
      <div className="study-menu__actions">
       <Button
        variant="tertiary"
        size="sm"
        isDisabled={busy || !text.trim()}
        onClick={() =>
         void run(async () => {
          const rows = await invoke<StudyEntry[]>('study:parse', {text, timezone})
          if (!rows.length) throw new Error('课表缺少明确的日期、结束时间或章节，或课程无法匹配，请补充后重试')
          setEntries(rows)
          setSelected(rows[0].id)
          setNotice('已识别，请核对后保存课表')
         })
        }
       >
        识别课表
       </Button>
       <Button
        variant="tertiary"
        size="sm"
        isDisabled={busy || !courses.length}
        onClick={() => {
         const row: StudyEntry = {
          id: crypto.randomUUID(),
          courseId: courses[0].id,
          title: '',
          chapter: '',
          endsAt: new Date().toISOString()
         }
         setEntries([...entries, row])
         setSelected(row.id)
        }}
       >
        手动添加
       </Button>
      </div>
      <label>
       课表条目
       <SelectField
        label="课表条目"
        placeholder="请选择"
        options={[{value: '', label: '请选择'}, ...entries.map(e => ({value: e.id, label: e.title || '待填写课次'}))]}
        value={selected}
        onChange={next => setSelected(next)}
       />
      </label>
      {entry && (
       <div className="study-menu__detail">
        <label>
         课程
         <SelectField
          label="课程"
          value={entry.courseId}
          onChange={next => update({courseId: next, lectureId: undefined})}
          options={courses.map(c => ({value: c.id, label: c.name}))}
         />
        </label>
        <label>
         课次名称
         <Input value={entry.title} onChange={e => update({title: e.target.value})} />
        </label>
        <label>
         教材章节
         <Input value={entry.chapter} onChange={e => update({chapter: e.target.value})} />
        </label>
        <label className="study-menu__check">
         <input
          type="checkbox"
          checked={!entry.endsAt}
          onChange={e => update({endsAt: e.target.checked ? '' : new Date().toISOString()})}
         />
         时间待定
        </label>
        <label>
         课程结束时间（含时区）
         <Input
          value={entry.endsAt}
          onChange={e => update({endsAt: e.target.value})}
          placeholder="2026-10-08T12:00:00+08:00"
         />
        </label>
        <small>
         核验时间：
         {Number.isFinite(Date.parse(entry.endsAt))
          ? new Date(checkAt(entry.endsAt)).toLocaleString()
          : entry.endsAt
            ? '请填写有效时间'
            : '补课时间待定，不安排核验'}
         （结束后 4 小时）
        </small>
        <label>
         关联已有课次
         <SelectField
          label="关联已有课次"
          placeholder="暂不关联"
          value={entry.lectureId || ''}
          onChange={next => update({lectureId: next || undefined})}
          options={[
           {value: '', label: '暂不关联'},
           ...(detail?.lectures || []).map(l => ({value: l.id, label: l.title}))
          ]}
         />
        </label>
        <label>
         智云课程编号
         <Input
          value={entry.zhiyunCourseId || ''}
          onChange={e => update({zhiyunCourseId: e.target.value || undefined})}
         />
        </label>
        <label>
         智云课次编号
         <Input value={entry.subId || ''} onChange={e => update({subId: e.target.value || undefined})} />
        </label>
        <Button
         variant="ghost"
         size="sm"
         isDisabled={busy}
         onClick={() => {
          setEntries(entries.filter(e => e.id !== selected))
          setSelected('')
         }}
        >
         删除此条目
        </Button>
       </div>
      )}
      <Button
       variant="primary"
       size="sm"
       isDisabled={busy}
       onClick={() =>
        void run(async () => {
         setEntries(await invoke('study:save', {entries}))
         await refresh()
         setNotice('课表已保存，关联课次已按课表改名。核验时间已计算。请手动检查课程资料，再生成并保存教材划线建议。')
        })
       }
      >
       保存课表与课次名称
      </Button>
     </section>
     <section className="study-menu__section">
      <h3>教材划线</h3>
      <p className="study-menu__hint">只有点击保存划线，才会修改原教材。分析和预览不会添加批注。</p>
      <p className="study-menu__hint">重复区域优先级：老师重点 → 学长学姐重点 → 老师讲授内容 → PPT 内容</p>
      <div className="study-legend">
       {Object.entries(highlightLabels).map(([key, label]) => (
        <span key={key}>
         <i style={{background: `rgb(${highlightColors[key as Highlight['source']].map(v => v * 255).join(',')})`}} />
         {label}
        </span>
       ))}
      </div>
      <Button
       variant="tertiary"
       size="sm"
       isDisabled={busy}
       onClick={() =>
        void run(async () => {
         const result = await invoke<Book | null>('textbook:pick')
         if (result) {
          setBook(result)
          setPageNumber(1)
          setDraft(null)
          setLast(1)
         }
        })
       }
      >
       选择原教材 PDF
      </Button>
      {book && (
       <>
        <small className="study-menu__meta">
         {book.path} · {book.pages} 页
        </small>
        <div className="row">
         <label>
          章节起始页
          <Input
           type="number"
           min={1}
           max={book.pages}
           value={first}
           onChange={e => setFirst(Number(e.target.value))}
          />
         </label>
         <label>
          结束页
          <Input
           type="number"
           min={first}
           max={book.pages}
           value={last}
           onChange={e => setLast(Number(e.target.value))}
          />
         </label>
        </div>
        <Button
         variant="tertiary"
         size="sm"
         isDisabled={busy || !entry?.lectureId}
         onClick={() =>
          void run(async () => {
           await analyzeBook()
          })
         }
        >
         按课堂资料生成划线建议
        </Button>
        <Button
         variant="tertiary"
         size="sm"
         isDisabled={busy}
         onClick={() =>
          void run(async () => {
           await invoke('textbook:open', {id: book.id})
          })
         }
        >
         打开原教材
        </Button>
        <Button
         variant="tertiary"
         size="sm"
         isDisabled={busy}
         onClick={() =>
          void run(async () => {
           await invoke('textbook:clear', {id: book.id})
           setDraft(null)
           setNotice('已撤销本软件添加的划线，原有批注保留 · ' + new Date().toLocaleTimeString())
          })
         }
        >
         撤销本软件的划线
        </Button>
       </>
      )}
     </section>
     {busy && (
      <Button variant="ghost" size="sm" onClick={() => void invoke('cancel')}>
       取消处理
      </Button>
     )}
    </div>
   }
  >
   {error && <AlertBox>{error}</AlertBox>}
   {notice && <p role="status">{notice}</p>}
   <main className="study-workspace">
    {book ? (
     <>
      <div className="row">
       <label>
        预览页
        <Input
         type="number"
         min={1}
         max={book.pages}
         value={pageNumber}
         onChange={e => {
          const p = Number(e.target.value)
          if (p >= 1 && p <= book.pages) setPageNumber(p)
         }}
        />
       </label>
       <SelectField
        label="手动划线来源"
        value={source}
        onChange={next => setSource(next as Highlight['source'])}
        options={Object.entries(highlightLabels).map(([key, label]) => ({value: key, label}))}
       />
      </div>
      <p>在教材页面上拖动框选可添加可编辑划线，扫描教材也可使用。</p>
      <div
       className="textbook-preview"
       onMouseDown={e => {
        if (!busy) start.current = point(e)
       }}
       onMouseUp={e => {
        if (!start.current || !viewport.current) return
        const a = viewport.current.convertToPdfPoint(...start.current),
         b = viewport.current.convertToPdfPoint(...point(e))
        start.current = null
        setRectangle([Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1])])
       }}
      >
       <img draggable={false} src={image} />
       {draft?.rows
        .filter(r => r.page === pageNumber && chosen.includes(r.id))
        .map(row => {
         if (!viewport.current) return null
         const v = viewport.current,
          a = v.convertToViewportPoint(row.rect[0], row.rect[1]),
          b = v.convertToViewportPoint(row.rect[0] + row.rect[2], row.rect[1] + row.rect[3])
         return (
          <span
           key={row.id}
           style={{
            left: (Math.min(a[0], b[0]) / size.width) * 100 + '%',
            top: (Math.min(a[1], b[1]) / size.height) * 100 + '%',
            width: (Math.abs(a[0] - b[0]) / size.width) * 100 + '%',
            height: (Math.abs(a[1] - b[1]) / size.height) * 100 + '%',
            background: `rgba(${highlightColors[row.source].map(v => v * 255).join(',')},.35)`
           }}
          />
         )
        })}
       {rectangle &&
        viewport.current &&
        (() => {
         const v = viewport.current!,
          a = v.convertToViewportPoint(rectangle[0], rectangle[1]),
          b = v.convertToViewportPoint(rectangle[0] + rectangle[2], rectangle[1] + rectangle[3])
         return (
          <span
           style={{
            left: (Math.min(a[0], b[0]) / size.width) * 100 + '%',
            top: (Math.min(a[1], b[1]) / size.height) * 100 + '%',
            width: (Math.abs(a[0] - b[0]) / size.width) * 100 + '%',
            height: (Math.abs(a[1] - b[1]) / size.height) * 100 + '%'
           }}
          />
         )
        })()}
      </div>
      <label>
       划线依据或说明
       <Input value={evidence} onChange={e => setEvidence(e.target.value)} />
      </label>
      <label>
       <input type="checkbox" checked={extension} onChange={e => setExtension(e.target.checked)} />
       属于讲授内容的适当延伸
      </label>
      <Button
       variant="primary"
       size="sm"
       isDisabled={busy || !rectangle || !evidence.trim()}
       onClick={() =>
        void run(async () => {
         await invoke('textbook:manual', {
          id: book.id,
          highlight: {
           id: crypto.randomUUID(),
           page: pageNumber,
           rect: rectangle,
           source,
           quote: '手动框选区域',
           evidence,
           extension
          }
         })
         setNotice('手动划线已保存到原教材 · ' + new Date().toLocaleTimeString())
         setDraft(null)
        })
       }
      >
       保存框选划线
      </Button>
     </>
    ) : (
     <div className="study-empty">选择教材后，在这里预览并检查划线。</div>
    )}
    {draft && (
     <div className="highlight-review">
      <h3>划线建议 · {chosen.length} 条选中</h3>
      {draft.rows.map(row => (
       <label key={row.id}>
        <input
         type="checkbox"
         checked={chosen.includes(row.id)}
         onChange={e => setChosen(e.target.checked ? [...chosen, row.id] : chosen.filter(id => id !== row.id))}
        />
        <span>
         第 {row.page} 页 · {highlightLabels[row.source]}
         {row.extension ? ' · 适当延伸' : ''}
         <strong>{row.quote}</strong>
         <small>依据：{row.evidence}</small>
         <Button variant="tertiary" size="sm" onClick={() => setPageNumber(row.page)}>
          看这一页
         </Button>
        </span>
       </label>
      ))}
      <Button
       variant="primary"
       size="sm"
       isDisabled={busy || !chosen.length}
       onClick={() =>
        void run(async () => {
         await invoke('textbook:apply', {id: draft.id, ids: chosen})
         setDraft(null)
         setNotice('可编辑划线已保存到原教材 · ' + new Date().toLocaleTimeString())
        })
       }
      >
       保存所选划线到原教材
      </Button>
     </div>
    )}
   </main>
  </WindowPanel>
 )
}
