import {Button, Input, Modal as HeroModal} from '@heroui/react'
import {type ReactNode} from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
export const invoke = <T,>(action: string, args?: unknown) => window.assistant.invoke<T>(action, args)
export const basename = (p: string) => p.split(/[\\/]/).at(-1) || p
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
 courseId
}: {
 label: string
 paths: string[]
 set: (p: string[]) => void
 transcript?: boolean
 courseware?: boolean
 courseId?: string
}) {
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
   <Button
    variant="tertiary"
    size="sm"
    type="button"
    onClick={() =>
     void invoke<string[]>('pick', {
      kind: transcript ? 'transcript' : courseware ? 'courseware' : 'document',
      courseId
     }).then(p => p.length && set(transcript ? p : [...paths, ...p]))
    }
   >
    {transcript ? '选择或拖入原文' : '选择或拖入文件'}
   </Button>
   {paths.map((p, i) => (
    <div key={i} className="file-chip">
     <div>
      <strong>{basename(p)}</strong>
      <Input className="local-path" aria-label="本地文件完整路径" readOnly value={p} title={p} />
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
