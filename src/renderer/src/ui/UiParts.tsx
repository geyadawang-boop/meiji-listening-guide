import {Button, Input, Modal as HeroModal} from '@heroui/react'
import {useEffect, useState, type ReactNode} from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type {LibraryFile} from '@shared/types'
import {SelectField} from './SelectField'
import {StudyIcon} from './StudyIcon'
import {notify} from './ToastHost'
export const invoke = <T,>(action: string, args?: unknown) => window.assistant.invoke<T>(action, args)
export const basename = (p: string) => p.split(/[\\/]/).at(-1) || p
const displayPath = (p: string) => (/^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(p) ? p : `资料库 / ${p}`)
export function Modal({title, children, close}: {title: string; children: ReactNode; close: () => void}) {
 return (
  <HeroModal.Backdrop
   isOpen
   variant="blur"
   onOpenChange={open => {
    if (!open) close()
   }}
  >
   <HeroModal.Container placement="center" scroll="inside">
    <HeroModal.Dialog className="app-modal" aria-label={title}>
     <HeroModal.CloseTrigger aria-label="关闭" />
     <HeroModal.Header>
      <HeroModal.Heading>{title}</HeroModal.Heading>
     </HeroModal.Header>
     <HeroModal.Body>{children}</HeroModal.Body>
    </HeroModal.Dialog>
   </HeroModal.Container>
  </HeroModal.Backdrop>
 )
}
export function FilePicker({
 label,
 paths,
 set,
 transcript = false,
 courseware = false,
 courseId,
 courseName
}: {
 label: string
 paths: string[]
 set: (p: string[]) => void
 transcript?: boolean
 courseware?: boolean
 courseId?: string
 courseName?: string
}) {
 const [library, setLibrary] = useState<LibraryFile[]>([]),
  [loading, setLoading] = useState(false)
 useEffect(() => {
  if (!courseId) {
   setLibrary([])
   setLoading(false)
   return
  }
  let active = true
  setLoading(true)
  void invoke<LibraryFile[]>('library:list')
   .then(files => {
    if (!active) return
    const extension = transcript
      ? /\.(docx|txt|md|srt)$/i
      : courseware
        ? /\.(pptx?|pdf|docx|txt|md)$/i
        : /\.(pdf|docx|txt|md)$/i,
     category = transcript ? '语音原文' : courseware ? 'PPT' : ''
    setLibrary(
     files
      .filter(file => extension.test(file.name) && (!category || file.category === category))
      .sort(
       (a, b) =>
        Number(b.course === courseName) - Number(a.course === courseName) || a.name.localeCompare(b.name, 'zh-CN')
      )
    )
   })
   .catch(reason => {
    if (active) notify.error(reason, {title: '读取资料库失败'})
   })
   .finally(() => {
    if (active) setLoading(false)
   })
  return () => {
   active = false
  }
 }, [courseId, courseName, transcript, courseware])
 const selected = paths[0] && library.some(file => file.path === paths[0]) ? paths[0] : '',
  single = transcript || courseware
 return (
  <div
   className="file-picker"
   onDragOver={e => e.preventDefault()}
   onDrop={e => {
    e.preventDefault()
    e.stopPropagation()
    const dropped = Array.from(e.dataTransfer.files)
     .map(f => window.assistant.filePath(f))
     .filter(Boolean)
    if (dropped.length) set(transcript ? dropped.slice(0, 1) : [...paths, ...dropped])
   }}
  >
   <label>{label}</label>
   {courseId && (
    <div className="file-picker-library">
     <div className="file-picker-library-row">
      <SelectField
       className="file-picker-select"
       searchable
       label={transcript ? '选择资料库原文' : courseware ? '选择资料库课件' : '选择资料库文件'}
       placeholder={loading ? '正在读取资料库…' : library.length ? '从软件资料库中选择' : '资料库暂无匹配文件'}
       value={selected}
       isDisabled={loading || !library.length}
       onChange={next => {
        const file = library.find(item => item.path === next)
        if (!file) return
        set(single ? [file.path] : paths.includes(file.path) ? paths : [...paths, file.path])
       }}
       options={library.map(file => ({
        value: file.path,
        label: file.name,
        description: [file.category, file.course].filter(Boolean).join(' · ')
       }))}
      />
      {single && paths.length > 0 && (
       <Button variant="ghost" size="sm" type="button" onClick={() => set([])}>
        清除
       </Button>
      )}
     </div>
    </div>
   )}
   {(single ? !selected && paths.length > 0 : paths.length > 0) &&
    paths.map((p, i) => (
     <div key={i} className="file-chip">
      <div>
       <strong>{basename(p)}</strong>
       <Input className="local-path" aria-label="文件路径" readOnly value={displayPath(p)} title={displayPath(p)} />
      </div>
      <Button
       variant="ghost"
       size="sm"
       isIconOnly
       type="button"
       aria-label="移除文件"
       onClick={() => set(paths.filter((_, j) => i !== j))}
      >
       ×
      </Button>
     </div>
    ))}
   <div className="row file-picker-actions">
    <Button
     variant="tertiary"
     size="sm"
     type="button"
     onClick={() =>
      void invoke<string[]>('pick', {
       kind: transcript ? 'transcript' : courseware ? 'courseware' : 'document',
       courseId
      })
       .then(p => p.length && set(transcript ? p : [...paths, ...p]))
       .catch(reason => notify.error(reason, {title: '选择文件失败'}))
     }
    >
     <StudyIcon name="upload" />
     从外部导入
    </Button>
    <small className="hint">也可直接拖入文件</small>
   </div>
  </div>
 )
}
export function Markdown({text}: {text: string}) {
 return (
  <ReactMarkdown
   remarkPlugins={[remarkGfm]}
   components={{
    a: ({href, children}) => (
     <a
      href={href}
      onClick={e => {
       e.preventDefault()
       if (href) void invoke('external', {url: href})
      }}
     >
      {children}
     </a>
    )
   }}
  >
   {text}
  </ReactMarkdown>
 )
}
