import {useEffect, useMemo, useRef, useState, type CSSProperties} from 'react'
import {Button, Checkbox, NumberField, ProgressBar, Spinner, TextArea} from '@heroui/react'
import {ChevronLeft, ChevronRight, Scan, ZoomIn, ZoomOut} from 'lucide-react'
import {ConfirmDialog} from '@renderer/ui/ConfirmDialog'
import {StudyField} from '@renderer/features/study/Field'
import {usePdfPage} from '@renderer/features/study/usePdfPage'
import {SettingsLink} from '@renderer/app/settings-navigation'
import type {Book, Draft} from '@renderer/features/study/types'
import type {Highlight, StudyEntry} from '@shared/study'
import {highlightLabels} from '@shared/study'
import type {Progress} from '@shared/types'

export type TextbookProps = {
 entry: StudyEntry | undefined
 lectureTitle?: string
 book: Book | null
 pageNumber: number
 first: number
 last: number
 draft: Draft | null
 chosen: string[]
 busy: boolean
 progress: Progress | null
 pdfVersion: number
 onPickBook: () => void
 onAnalyze: () => void
 onOpenBook: () => void
 onRemoveHighlights: () => void
 onCancel: () => void
 onPageNumber: (page: number) => void
 onFirst: (page: number) => void
 onLast: (page: number) => void
 onChosen: (ids: string[]) => void
 onApply: () => void
 onManual: (value: {
  rect: Highlight['rect']
  source: Highlight['source']
  evidence: string
  extension: boolean
 }) => Promise<boolean>
 onGoSchedule: () => void
}

const basename = (path: string) => path.split(/[\\/]/).at(-1) || path
const sourceKeys = Object.keys(highlightLabels) as Highlight['source'][]

function rangeProblem(first: number, last: number, pages: number) {
 if (!Number.isFinite(first) || !Number.isFinite(last)) return '请填写有效的页码范围'
 if (first < 1 || last < first) return '结束页需要大于或等于起始页'
 if (last > pages) return '结束页不能超过教材总页数'
 if (last - first > 99) return '每次最多分析 100 页'
 return ''
}

function Overlay({
 rect,
 viewport,
 size,
 className,
 active
}: {
 rect: Highlight['rect']
 viewport: ReturnType<typeof usePdfPage>['viewport']
 size: {width: number; height: number}
 className: string
 active?: boolean
}) {
 if (!viewport) return null
 const left = viewport.convertToViewportPoint(rect[0], rect[1]),
  right = viewport.convertToViewportPoint(rect[0] + rect[2], rect[1] + rect[3]),
  style: CSSProperties = {
   left: (Math.min(left[0], right[0]) / size.width) * 100 + '%',
   top: (Math.min(left[1], right[1]) / size.height) * 100 + '%',
   width: (Math.abs(left[0] - right[0]) / size.width) * 100 + '%',
   height: (Math.abs(left[1] - right[1]) / size.height) * 100 + '%'
  }
 return <span aria-hidden="true" className={className + (active ? ' study-highlight--active' : '')} style={style} />
}

export function TextbookMenu(props: TextbookProps) {
 const {
  entry,
  lectureTitle,
  book,
  first,
  last,
  busy,
  progress,
  draft,
  onPickBook,
  onOpenBook,
  onRemoveHighlights,
  onAnalyze,
  onCancel,
  onFirst,
  onLast,
  pageNumber,
  onGoSchedule,
  onPageNumber
 } = props
 const [confirmRemove, setConfirmRemove] = useState(false)
 const problem = book ? rangeProblem(first, last, book.pages) : '请先选择教材'
 const linked = !!entry?.lectureId
 const canAnalyze = !!entry && linked && !!book && !problem
 return (
  <div className="study-menu">
   <section className="study-side-card">
    <small>当前课次</small>
    <strong>{entry?.title || '还没有选择课次'}</strong>
    {entry ? (
     <span className={linked ? 'study-side-card__status' : 'study-side-card__status study-side-card__status--warning'}>
      {linked ? `已关联 · ${lectureTitle || '课次'}` : '尚未关联课次'}
     </span>
    ) : null}
    {!linked ? (
     <Button variant="ghost" size="sm" onClick={onGoSchedule}>
      去课表关联
     </Button>
    ) : null}
   </section>
   <section className="study-side-section">
    <h3>教材</h3>
    <Button variant="tertiary" size="sm" isDisabled={busy} onClick={onPickBook}>
     {book ? '更换教材 PDF' : '选择原教材 PDF'}
    </Button>
    {book ? (
     <div className="study-book">
      <strong title={book.path}>{basename(book.path)}</strong>
      <small title={book.path}>
       {book.path} · {book.pages} 页
      </small>
     </div>
    ) : (
     <p className="study-menu__hint">选择一本本地 PDF。分析和预览不会修改原文件。</p>
    )}
   </section>
   {book ? (
    <section className="study-side-section">
     <h3>页码范围</h3>
     <div className="study-range">
      <StudyField label="起始页">
       <NumberField
        aria-label="章节起始页"
        isDisabled={busy}
        minValue={1}
        maxValue={book.pages}
        value={first}
        onChange={value => onFirst(value)}
       >
        <NumberField.Group>
         <NumberField.DecrementButton />
         <NumberField.Input onFocus={event => event.currentTarget.select()} />
         <NumberField.IncrementButton />
        </NumberField.Group>
       </NumberField>
      </StudyField>
      <StudyField label="结束页">
       <NumberField
        aria-label="章节结束页"
        isDisabled={busy}
        minValue={1}
        maxValue={book.pages}
        value={last}
        onChange={value => onLast(value)}
       >
        <NumberField.Group>
         <NumberField.DecrementButton />
         <NumberField.Input onFocus={event => event.currentTarget.select()} />
         <NumberField.IncrementButton />
        </NumberField.Group>
       </NumberField>
      </StudyField>
     </div>
     <div className="study-range-actions">
      <Button
       variant="ghost"
       size="sm"
       isDisabled={busy}
       onClick={() => {
        onFirst(pageNumber)
        if (last < pageNumber) onLast(pageNumber)
       }}
      >
       当前页设为起点
      </Button>
      <Button variant="ghost" size="sm" isDisabled={busy} onClick={() => onLast(pageNumber)}>
       当前页设为终点
      </Button>
     </div>
     <p className={problem ? 'study-side-hint study-side-hint--warning' : 'study-side-hint'}>
      {problem || `将分析第 ${first}–${last} 页，共 ${last - first + 1} 页。`}
     </p>
     {!linked ? (
      <p className="study-side-hint study-side-hint--warning">先关联课次，AI 才能读取本课字幕、重点与课件。</p>
     ) : null}
     <div className="study-generate-row">
      <Button variant={draft ? 'tertiary' : 'primary'} size="sm" isDisabled={busy || !canAnalyze} onClick={onAnalyze}>
       {draft ? '重新生成建议' : '生成划线建议'}
      </Button>
      <SettingsLink section="qwen">模型设置</SettingsLink>
     </div>
    </section>
   ) : null}
   {busy ? (
    <section className="study-progress" role="status">
     <Spinner size="sm" />
     <div>
      <strong>{progress?.stage || '正在处理教材'}</strong>
      <small>{progress?.message || '请稍候'}</small>
     </div>
     <Button variant="ghost" size="sm" onClick={onCancel}>
      取消
     </Button>
     {progress?.part !== undefined && progress?.total !== undefined ? (
      <ProgressBar aria-label="分析进度" maxValue={progress.total} value={progress.part}>
       <ProgressBar.Track>
        <ProgressBar.Fill />
       </ProgressBar.Track>
      </ProgressBar>
     ) : null}
    </section>
   ) : null}
   {book ? (
    <section className="study-side-section study-side-section--quiet">
     <div className="study-side-actions">
      <Button variant="ghost" size="sm" isDisabled={busy} onClick={onOpenBook}>
       打开原教材
      </Button>
      <Button variant="ghost" size="sm" isDisabled={busy} onClick={() => onPageNumber(1)}>
       回到第一页
      </Button>
     </div>
     <div className="study-danger-zone study-danger-zone--compact">
      <div>
       <strong>移除软件划线</strong>
       <small>原有批注会保留。</small>
      </div>
      <Button variant="danger-soft" size="sm" isDisabled={busy} onClick={() => setConfirmRemove(true)}>
       移除划线
      </Button>
     </div>
    </section>
   ) : null}
   {confirmRemove ? (
    <ConfirmDialog
     title="移除本软件添加的划线？"
     confirmLabel="移除"
     busy={busy}
     onCancel={() => setConfirmRemove(false)}
     onConfirm={() => {
      setConfirmRemove(false)
      onRemoveHighlights()
     }}
    >
     这会修改所选教材 PDF：只删除本软件写入的划线批注，原文件中的其他批注会保留。保存前会创建
     <code>.划线前备份.pdf</code>。
    </ConfirmDialog>
   ) : null}
  </div>
 )
}

export function TextbookContent(props: TextbookProps) {
 const {entry, book, pageNumber, draft, chosen, busy, pdfVersion, onPageNumber, onChosen, onApply, onManual} = props
 const [zoom, setZoom] = useState(1),
  [mode, setMode] = useState<'suggestions' | 'manual'>('manual'),
  [activeId, setActiveId] = useState(''),
  [source, setSource] = useState<Highlight['source']>('teacher'),
  [evidence, setEvidence] = useState(''),
  [extension, setExtension] = useState(false),
  [rectangle, setRectangle] = useState<Highlight['rect'] | null>(null),
  [width, setWidth] = useState(0),
  [confirmApply, setConfirmApply] = useState(false)
 const frame = useRef<HTMLDivElement | null>(null),
  start = useRef<[number, number] | null>(null)
 const {canvas, viewport, size, rendering, error} = usePdfPage(book, pageNumber, width, zoom, pdfVersion)
 useEffect(() => {
  const element = frame.current
  if (!element) return
  const measure = () => setWidth(Math.max(240, Math.floor(element.clientWidth - 32)))
  measure()
  const observer = new ResizeObserver(measure)
  observer.observe(element)
  return () => observer.disconnect()
 }, [book?.id])
 useEffect(() => {
  setRectangle(null)
  start.current = null
 }, [pageNumber, book?.id])
 useEffect(() => {
  setRectangle(null)
  setEvidence('')
  setActiveId('')
  setMode('manual')
 }, [entry?.id])
 useEffect(() => {
  if (rectangle) setMode('manual')
 }, [rectangle])
 useEffect(() => {
  if (draft) setMode('suggestions')
 }, [draft?.id])
 const groups = useMemo(() => {
  if (!draft) return []
  const map = new Map<
   string,
   {page: number; source: Highlight['source']; quote: string; evidence: string; extension: boolean; ids: string[]}
  >()
  for (const row of draft.rows) {
   const key = [row.page, row.source, row.quote, row.evidence].join('\u0000')
   const group = map.get(key)
   if (group) group.ids.push(row.id)
   else
    map.set(key, {
     page: row.page,
     source: row.source,
     quote: row.quote,
     evidence: row.evidence,
     extension: row.extension,
     ids: [row.id]
    })
  }
  return [...map.entries()].sort((a, b) => a[1].page - b[1].page)
 }, [draft])
 const selectedCount = groups.filter(group => group[1].ids.every(id => chosen.includes(id))).length
 const point = (event: React.MouseEvent<HTMLDivElement>) => {
  const rect = event.currentTarget.getBoundingClientRect()
  return [
   ((event.clientX - rect.left) / rect.width) * size.width,
   ((event.clientY - rect.top) / rect.height) * size.height
  ] as [number, number]
 }
 const saveManual = async () => {
  if (!rectangle || !evidence.trim()) return
  const ok = await onManual({rect: rectangle, source, evidence: evidence.trim(), extension})
  if (ok) {
   setRectangle(null)
   setEvidence('')
   setExtension(false)
  }
 }
 return (
  <div className="study-textbook">
   <div className="study-canvas-column">
    {book ? (
     <>
      <div className="study-canvas-toolbar">
       <Button
        variant="ghost"
        size="sm"
        isIconOnly
        aria-label="上一页"
        isDisabled={pageNumber <= 1}
        onClick={() => onPageNumber(pageNumber - 1)}
       >
        <ChevronLeft size={18} aria-hidden="true" />
       </Button>
       <NumberField
        aria-label="预览页码"
        className="study-page-number"
        minValue={1}
        maxValue={book.pages}
        value={pageNumber}
        onChange={value => onPageNumber(value)}
       >
        <NumberField.Group>
         <NumberField.Input onFocus={event => event.currentTarget.select()} />
        </NumberField.Group>
       </NumberField>
       <span className="study-page-total">/ {book.pages}</span>
       <Button
        variant="ghost"
        size="sm"
        isIconOnly
        aria-label="下一页"
        isDisabled={pageNumber >= book.pages}
        onClick={() => onPageNumber(pageNumber + 1)}
       >
        <ChevronRight size={18} aria-hidden="true" />
       </Button>
       <span className="study-canvas-toolbar__spacer" />
       <Button
        variant="ghost"
        size="sm"
        isIconOnly
        aria-label="缩小"
        isDisabled={zoom <= 0.5}
        onClick={() => setZoom(value => Math.max(0.5, Math.round((value - 0.1) * 10) / 10))}
       >
        <ZoomOut size={18} aria-hidden="true" />
       </Button>
       <span className="study-zoom">{Math.round(zoom * 100)}%</span>
       <Button
        variant="ghost"
        size="sm"
        isIconOnly
        aria-label="放大"
        isDisabled={zoom >= 2}
        onClick={() => setZoom(value => Math.min(2, Math.round((value + 0.1) * 10) / 10))}
       >
        <ZoomIn size={18} aria-hidden="true" />
       </Button>
       <Button variant="ghost" size="sm" isDisabled={zoom === 1} onClick={() => setZoom(1)}>
        <Scan size={16} aria-hidden="true" />
        适应宽度
       </Button>
      </div>
      <div className="study-canvas" ref={frame}>
       <div className="study-page-shell">
        <div
         className="study-page"
         style={{width: size.width, height: size.height}}
         onMouseDown={event => {
          if (!busy && viewport) start.current = point(event)
         }}
         onMouseLeave={() => {
          start.current = null
         }}
         onMouseUp={event => {
          if (!start.current || !viewport || busy) return
          const from = start.current,
           to = point(event),
           a = viewport.convertToPdfPoint(...from),
           b = viewport.convertToPdfPoint(...to)
          start.current = null
          const rect: Highlight['rect'] = [
           Math.min(a[0], b[0]),
           Math.min(a[1], b[1]),
           Math.abs(a[0] - b[0]),
           Math.abs(a[1] - b[1])
          ]
          if (rect[2] < 3 || rect[3] < 3) return
          setRectangle(rect)
         }}
        >
         <canvas ref={canvas} className="study-page__canvas" />
         {draft?.rows
          .filter(row => row.page === pageNumber && chosen.includes(row.id))
          .map(row => (
           <Overlay
            key={row.id}
            active={activeId === row.id}
            className={`study-highlight study-highlight--${row.source}`}
            rect={row.rect}
            size={size}
            viewport={viewport}
           />
          ))}
         {rectangle && viewport ? (
          <Overlay className="study-selection" rect={rectangle} size={size} viewport={viewport} />
         ) : null}
         {rendering ? <div className="study-page__loading">正在渲染页面…</div> : null}
        </div>
       </div>
      </div>
      {error ? <p className="study-inline-error">{error}</p> : null}
     </>
    ) : (
     <div className="study-empty study-empty--canvas">
      <h3>选择教材后开始预览</h3>
      <p>在左侧选择原教材 PDF，设置页码范围，然后生成建议或直接框选。</p>
     </div>
    )}
   </div>
   <aside className="study-inspector">
    {!book ? (
     <div className="study-inspector-empty">
      <h3>开始划线</h3>
      <p>先选择原教材 PDF，再设置页码范围。生成建议后可以逐条核对，也可以直接在页面上框选。</p>
     </div>
    ) : (
     <>
      {draft || rectangle ? (
       <div aria-label="划线方式" className="study-segmented study-segmented--full" role="group">
        <Button
         aria-pressed={mode === 'suggestions'}
         className={'study-segmented__button' + (mode === 'suggestions' ? ' study-segmented__button--active' : '')}
         isDisabled={!draft}
         size="sm"
         variant="ghost"
         onClick={() => setMode('suggestions')}
        >
         建议 · {groups.length}
        </Button>
        <Button
         aria-pressed={mode === 'manual'}
         className={'study-segmented__button' + (mode === 'manual' ? ' study-segmented__button--active' : '')}
         size="sm"
         variant="ghost"
         onClick={() => setMode('manual')}
        >
         手动框选
        </Button>
       </div>
      ) : null}
      {mode === 'suggestions' && draft ? (
       <div className="study-inspector-body">
        <div className="study-inspector-heading">
         <div>
          <h3>划线建议</h3>
          <small>
           已选 {selectedCount} / {groups.length} 条
          </small>
         </div>
         <div className="study-inspector-heading__actions">
          <Button variant="ghost" size="sm" onClick={() => onChosen(groups.flatMap(group => group[1].ids))}>
           全选
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onChosen([])}>
           清空
          </Button>
         </div>
        </div>
        <div className="study-suggestion-list">
         {groups.map(([key, group]) => {
          const selected = group.ids.every(id => chosen.includes(id))
          return (
           <div key={key} className="study-suggestion">
            <Checkbox
             isSelected={selected}
             onChange={checked =>
              onChosen(checked ? [...new Set([...chosen, ...group.ids])] : chosen.filter(id => !group.ids.includes(id)))
             }
            >
             <Checkbox.Content>
              <Checkbox.Control>
               <Checkbox.Indicator />
              </Checkbox.Control>
              <span className="study-suggestion__main">
               <span className="study-suggestion__meta">
                <span className={`study-source study-source--${group.source}`}>
                 <i />
                 {highlightLabels[group.source]}
                </span>
                <span>第 {group.page} 页</span>
                {group.extension ? <span>适当延伸</span> : null}
               </span>
               <strong>{group.quote}</strong>
               <small>依据：{group.evidence}</small>
              </span>
             </Checkbox.Content>
            </Checkbox>
            <Button
             variant="ghost"
             size="sm"
             onClick={() => {
              onPageNumber(group.page)
              setActiveId(group.ids[0])
             }}
            >
             定位
            </Button>
           </div>
          )
         })}
        </div>
        <div className="study-inspector-footer">
         <small>保存会写入原教材，并创建划线前备份。</small>
         <Button variant="primary" size="sm" isDisabled={busy || !chosen.length} onClick={() => setConfirmApply(true)}>
          保存所选 {chosen.length} 条
         </Button>
        </div>
       </div>
      ) : (
       <div className="study-inspector-body">
        <div className="study-inspector-heading">
         <div>
          <h3>手动框选</h3>
          <small>{rectangle ? `第 ${pageNumber} 页已框选` : '在左侧页面上拖出要划线的区域'}</small>
         </div>
         {rectangle ? (
          <Button variant="ghost" size="sm" onClick={() => setRectangle(null)}>
           重新框选
          </Button>
         ) : null}
        </div>
        <StudyField label="划线来源">
         <div aria-label="划线来源" className="study-source-choices" role="group">
          {sourceKeys.map(key => (
           <Button
            key={key}
            aria-pressed={source === key}
            className={'study-source-choice' + (source === key ? ' study-source-choice--active' : '')}
            size="sm"
            variant="ghost"
            fullWidth
            onClick={() => setSource(key)}
           >
            <span className={`study-source-dot study-source-dot--${key}`} />
            {highlightLabels[key]}
           </Button>
          ))}
         </div>
        </StudyField>
        <StudyField label="划线依据" hint="说明这段内容与老师讲授、重点或课件的对应关系，保存后写入批注。">
         <TextArea
          aria-label="划线依据"
          value={evidence}
          onChange={event => setEvidence(event.target.value)}
          placeholder="例如：老师在本节课反复强调的定义，对应字幕 00:32:10。"
         />
        </StudyField>
        <Checkbox isSelected={extension} onChange={setExtension}>
         <Checkbox.Content>
          <Checkbox.Control>
           <Checkbox.Indicator />
          </Checkbox.Control>
          这是教材对课堂内容的适当延伸
         </Checkbox.Content>
        </Checkbox>
        <div className="study-inspector-footer">
         <small>保存会写入原教材，并创建划线前备份。</small>
         <Button
          variant="primary"
          size="sm"
          isDisabled={busy || !rectangle || !evidence.trim()}
          onClick={() => void saveManual()}
         >
          保存框选划线
         </Button>
        </div>
       </div>
      )}
     </>
    )}
   </aside>
   {confirmApply ? (
    <ConfirmDialog
     title={`保存 ${chosen.length} 条划线？`}
     confirmLabel="保存到原教材"
     busy={busy}
     onCancel={() => setConfirmApply(false)}
     onConfirm={() => {
      setConfirmApply(false)
      onApply()
     }}
    >
     这会修改原教材 PDF，并在同目录创建 <code>.划线前备份.pdf</code>
     。保存后仍可通过“移除本软件添加的划线”撤销本软件写入的批注。
    </ConfirmDialog>
   ) : null}
  </div>
 )
}
