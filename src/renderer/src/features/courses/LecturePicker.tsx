import {Button} from '@heroui/react'
import {ConfirmDialog} from '@renderer/ui/ConfirmDialog'
import {useState} from 'react'
import type {Lecture} from '@shared/types'
import {notify} from '@renderer/ui/ToastHost'
import {CalendarDays, ChevronDown, Trash2} from 'lucide-react'
export function LecturePicker({
 lectures,
 value,
 busy,
 select,
 create,
 remove
}: {
 lectures: Lecture[]
 value: string
 busy: boolean
 select: (id: string) => void
 create: () => void
 remove: (id: string) => Promise<unknown>
}) {
 const [open, setOpen] = useState(false),
  [pending, setPending] = useState<Lecture | null>(null),
  [deleting, setDeleting] = useState(false)
 const selected = lectures.find(l => l.id === value)
 return (
  <div className="lecture-bar">
   <div className="lecture-picker">
    <button
     className="lecture-trigger"
     aria-label="选择课次"
     aria-expanded={open}
     disabled={busy}
     onClick={() => setOpen(!open)}
    >
     <CalendarDays />
     <strong>{selected?.title || '选择课次'}</strong>
     {selected && (
      <span className={selected.status === '字幕完成' ? 'status-ready' : 'lecture-status'}>{selected.status}</span>
     )}
     <ChevronDown size={14} />
    </button>
    {open && (
     <>
      <button className="picker-dismiss" aria-label="收起课次列表" onClick={() => setOpen(false)} />
      <div className="lecture-popover" role="listbox" aria-label="课次列表">
       <header>
        本课程课次 <span>{lectures.length}</span>
       </header>
       {lectures.map(l => (
        <div className={`lecture-choice ${l.id === value ? 'selected' : ''}`} key={l.id}>
         <Button
          variant="ghost"
          size="sm"
          className="lecture-choice-main"
          aria-current={l.id === value ? 'true' : undefined}
          onClick={() => {
           select(l.id)
           setOpen(false)
          }}
         >
          <CalendarDays />
          <strong>{l.title}</strong>
          <small className="lecture-choice-status">{l.status}</small>
         </Button>
         <Button
          variant="ghost"
          size="sm"
          isIconOnly
          className="lecture-choice-delete"
          aria-label={`删除课次 ${l.title}`}
          onClick={() => {
           setPending(l)
           setOpen(false)
          }}
         >
          <Trash2 />
         </Button>
        </div>
       ))}
       {!lectures.length && <p className="hint lecture-empty">还没有课次</p>}
      </div>
     </>
    )}
   </div>
   <button className="new-lecture-button" disabled={busy} onClick={create}>
    ＋ 新建课次
   </button>
   {pending && (
    <ConfirmDialog
     title={`删除「${pending.title}」？`}
     confirmLabel="删除课次"
     busy={deleting || busy}
     onCancel={() => setPending(null)}
     onConfirm={() => {
      setDeleting(true)
      void remove(pending.id)
       .then(() => {
        setPending(null)
        notify.success('课次已删除')
       })
       .catch(e => notify.error(e, {title: '删除课次失败'}))
       .finally(() => setDeleting(false))
     }}
    >
     本课次的对话、字幕、笔记与练习记录会删除。资料文件和已导出文件仍保留，可在文件管理中单独删除。
    </ConfirmDialog>
   )}
  </div>
 )
}
