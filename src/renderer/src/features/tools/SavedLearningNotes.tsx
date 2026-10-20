import {Button, Card, Input, TextArea} from '@heroui/react'
import {useEffect, useState} from 'react'
import ReactMarkdown from 'react-markdown'
import {notify} from '@renderer/ui/ToastHost'
import {SelectField} from '@renderer/ui/SelectField'
const request = <T,>(action: string, args: unknown = {}) => window.assistant.invoke<T>('tools:request', {action, args})
const op = () => crypto.randomUUID().replaceAll('-', '')
type Receipt = {note_id: string; title: string; body_sha256: string; created_at: string}
type Note = {receipt: Receipt; markdown: string; lifecycle: {revision: number; state: string}}
type Preview = {kb_root_id: string; task_id: string; note_sha256: string; sources_sha256: string; markdown: string}
export function SavedLearningNotes() {
 const [notes, setNotes] = useState<Receipt[]>([]),
  [tasks, setTasks] = useState<{task_id: string; question: string}[]>([]),
  [task, setTask] = useState(''),
  [preview, setPreview] = useState<Preview>(),
  [note, setNote] = useState<Note>(),
  [markdown, setMarkdown] = useState(''),
  [query, setQuery] = useState(''),
  [state, setState] = useState('active'),
  [offset, setOffset] = useState<number | null>(0),
  [busy, setBusy] = useState(false),
  [source, setSource] = useState<{status: string}>()
 async function list(start = 0) {
  const page = await request<{entries: Receipt[]; has_more: boolean}>('notes', {query, state, offset: start})
  setNotes(start ? old => [...old, ...page.entries] : page.entries)
  setOffset(page.has_more ? start + 25 : null)
 }
 async function run(fn: () => Promise<unknown>) {
  setBusy(true)
  try {
   await fn()
  } catch (reason) {
   notify.error(reason)
  } finally {
   setBusy(false)
  }
 }
 useEffect(() => {
  void run(async () => {
   await list()
   const value = await request<{tasks: {task_id: string; question: string; status: string}[]}>('overview')
   setTasks(value.tasks.filter(item => item.status === 'completed'))
  })
 }, [])
 async function read(id: string) {
  const next = await request<Note>('note-read', {id})
  setNote(next)
  setMarkdown(next.markdown)
  setSource(undefined)
 }
 return (
  <>
   <Card className="knowledge-card">
    <h3>保存研究笔记</h3>
    <p className="hint">
     先预览完整笔记及出处，再明确保存。保存时核验引用的资料版本；来源改变会拒绝旧保存。保存后可编辑，并保留每次修订，不自动修改原文或教材。
    </p>
    <div className="row">
     <SelectField
      label="待保存的研究"
      placeholder="选择已完成研究"
      value={task}
      onChange={next => {
       setTask(next)
       setPreview(undefined)
      }}
      options={[
       {value: '', label: '选择已完成研究'},
       ...tasks.map(item => ({value: item.task_id, label: item.question}))
      ]}
     />
     <Button
      variant="tertiary"
      size="sm"
      isDisabled={busy || !task}
      onClick={() => void run(async () => setPreview(await request<Preview>('note-preview', {id: task})))}
     >
      预览待保存笔记
     </Button>
    </div>
    {preview && (
     <>
      <div className="learning-summary">
       <ReactMarkdown>{preview.markdown}</ReactMarkdown>
      </div>
      <Button
       variant="primary"
       size="sm"
       isDisabled={busy}
       onClick={() =>
        void run(async () => {
         const saved = await request<Note>('note-save', {
          id: preview.task_id,
          expected: {
           kb_root_id: preview.kb_root_id,
           note_sha256: preview.note_sha256,
           sources_sha256: preview.sources_sha256
          }
         })
         setPreview(undefined)
         await list()
         await read(saved.receipt.note_id)
         notify.success('已保存可编辑笔记')
        })
       }
      >
       确认保存可编辑笔记
      </Button>
     </>
    )}
   </Card>
   <Card className="knowledge-card">
    <h3>研究笔记</h3>
    <div className="row">
     <Input
      aria-label="笔记检索词"
      placeholder="查找笔记正文或标题"
      maxLength={200}
      value={query}
      onChange={e => setQuery(e.target.value)}
     />
     <SelectField
      label="笔记显示范围"
      value={state}
      onChange={next => setState(next)}
      options={[
       {value: 'active', label: '当前笔记'},
       {value: 'archived', label: '已归档'},
       {value: 'all', label: '所有版本'}
      ]}
     />
     <Button variant="tertiary" size="sm" isDisabled={busy} onClick={() => void run(() => list())}>
      检索笔记
     </Button>
    </div>
    <div className="discussion-list">
     {notes.map(item => (
      <Button
       variant="ghost"
       size="sm"
       key={item.note_id}
       isDisabled={busy}
       aria-label={`打开笔记 ${item.title}`}
       onClick={() => void run(() => read(item.note_id))}
      >
       {item.title} · {item.created_at}
      </Button>
     ))}
    </div>
    {offset !== null && (
     <Button variant="ghost" size="sm" isDisabled={busy} onClick={() => void run(() => list(offset))}>
      更多笔记
     </Button>
    )}
    {note && (
     <>
      <h4>{note.receipt.title}</h4>
      <p className="hint">
       笔记保存时版本 · {note.lifecycle.state === 'archived' ? '已归档' : '当前有效'}。笔记是学习记录，不替代原始资料。
      </p>
      <TextArea
       aria-label="笔记正文"
       maxLength={40000}
       value={markdown}
       disabled={busy || note.lifecycle.state === 'archived'}
       onChange={e => setMarkdown(e.target.value)}
      />
      <div className="row">
       <Button
        variant="primary"
        size="sm"
        isDisabled={busy || !markdown.trim() || markdown === note.markdown || note.lifecycle.state === 'archived'}
        onClick={() =>
         void run(async () => {
          const saved = await request<Note>('note-revise', {
           value: {
            action: 'manual_revision',
            schema_version: '1',
            operation_id: op(),
            parent_note_id: note.receipt.note_id,
            parent_body_sha256: note.receipt.body_sha256,
            markdown
           }
          })
          await list()
          await read(saved.receipt.note_id)
          notify.success('修订已保存，原版本保留')
         })
        }
       >
        保存笔记修订
       </Button>
       <Button
        variant="tertiary"
        size="sm"
        isDisabled={busy || note.lifecycle.state === 'archived'}
        onClick={() =>
         void run(async () => {
          setSource(await request<{status: string}>('note-source', {id: note.receipt.note_id}))
         })
        }
       >
        核验原始来源
       </Button>
       <Button
        variant="tertiary"
        size="sm"
        isDisabled={busy}
        onClick={() =>
         void run(async () => {
          const path = await request<string>('note-export', {id: note.receipt.note_id})
          await window.assistant.invoke('library:reveal', {path})
          notify.success('笔记 Markdown 已保存并核验')
         })
        }
       >
        导出笔记
       </Button>
       <Button
        variant="tertiary"
        size="sm"
        isDisabled={busy}
        onClick={() =>
         void run(async () => {
          await request('note-lifecycle', {
           value: {
            note_id: note.receipt.note_id,
            body_sha256: note.receipt.body_sha256,
            expected_revision: note.lifecycle.revision,
            operation_id: op(),
            action: note.lifecycle.state === 'archived' ? 'restore' : 'archive'
           }
          })
          await read(note.receipt.note_id)
          await list()
         })
        }
       >
        {note.lifecycle.state === 'archived' ? '恢复笔记' : '归档笔记'}
       </Button>
      </div>
      {source != null && (
       <details open>
        <summary>来源核验记录</summary>
        <p>
         {(
          {
           research_current: '研究记录和引用来源仍可核验',
           current: '原始资料与保存时一致',
           research_changed: '研究记录或引用来源已有改变，笔记仍保留保存时版本',
           changed: '原始资料已改变',
           research_unavailable: '暂时无法核验研究来源',
           unavailable: '暂时无法核验来源',
           missing: '原始资料已不存在',
           imported_unbound: '导入笔记未绑定可核验原始资料'
          } as Record<string, string>
         )[source.status] || '来源需要进一步核验'}
        </p>
       </details>
      )}
     </>
    )}
   </Card>
  </>
 )
}
