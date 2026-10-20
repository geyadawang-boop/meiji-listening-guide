import {Button, Card, Input, TextArea} from '@heroui/react'
import {useEffect, useState} from 'react'
import {notify} from '@renderer/ui/ToastHost'
import {SelectField} from '@renderer/ui/SelectField'
type Candidate = {
 candidate_id: string
 kind: string
 title: string
 body: string
 basis: string
 quote: string
 status: string
}
type Task = {task_id: string; question: string; memory_candidates: Candidate[]}
const request = <T,>(action: string, args: unknown = {}) => window.assistant.invoke<T>('tools:request', {action, args})
export function MemorySuggestions({saved}: {saved: () => Promise<void>}) {
 const [tasks, setTasks] = useState<Task[]>([]),
  [selected, setSelected] = useState(''),
  [title, setTitle] = useState(''),
  [body, setBody] = useState(''),
  [kind, setKind] = useState('progress'),
  [busy, setBusy] = useState(false)
 const suggestions = tasks.flatMap(task =>
  (task.memory_candidates || [])
   .filter(c => c.status === 'pending')
   .map(candidate => ({task, candidate, key: task.task_id + ':' + candidate.candidate_id}))
 )
 const current = suggestions.find(item => item.key === selected)
 async function refresh() {
  setTasks((await request<{tasks: Task[]}>('overview')).tasks)
 }
 async function run(fn: () => Promise<void>) {
  setBusy(true)
  try {
   await fn()
  } catch (e) {
   notify.error(e)
  } finally {
   setBusy(false)
  }
 }
 useEffect(() => {
  void run(refresh)
 }, [])
 return (
  <Card className="knowledge-card">
   <h3>待核对的记忆建议</h3>
   <p className="hint">
    研究可建议下次要继续核对的内容。这里显示原句依据；仅在你检查、修改并确认后保存为学习记忆，不自动写入教材或账号聊天。
   </p>
   <div className="row">
    <SelectField
     label="选择记忆建议"
     placeholder="选择建议"
     value={selected}
     onChange={next => {
      const item = suggestions.find(item => item.key === next)
      setSelected(next)
      setTitle(item?.candidate.title || '')
      setBody(item?.candidate.body || '')
      setKind(item?.candidate.kind || 'progress')
     }}
     options={[
      {value: '', label: '选择建议'},
      ...suggestions.map(item => ({value: item.key, label: item.candidate.title + ' · ' + item.task.question}))
     ]}
    />
    <Button variant="ghost" size="sm" isDisabled={busy} onClick={() => void run(refresh)}>
     刷新记忆建议
    </Button>
   </div>
   {current && (
    <>
     <blockquote>{current.candidate.quote}</blockquote>
     <p className="hint">
      依据：
      {
       ({question: '你的问题', note: '本次研究笔记', limitations: '研究范围与限制'} as Record<string, string>)[
        current.candidate.basis
       ]
      }
     </p>
     <div className="row">
      <SelectField
       label="记忆建议类型"
       value={kind}
       onChange={next => setKind(next)}
       options={[
        {value: 'preference', label: '学习偏好'},
        {value: 'progress', label: '学习进度'},
        {value: 'correction', label: '待核实纠错'}
       ]}
      />
      <Input aria-label="记忆建议标题" value={title} maxLength={80} onChange={e => setTitle(e.target.value)} />
     </div>
     <TextArea aria-label="记忆建议正文" value={body} maxLength={1000} onChange={e => setBody(e.target.value)} />
     <Button
      variant="primary"
      size="sm"
      isDisabled={busy || !title.trim() || !body.trim()}
      onClick={() =>
       void run(async () => {
        await request('memory-accept', {
         id: current.task.task_id,
         value: {candidate_id: current.candidate.candidate_id, kind, title, body}
        })
        setSelected('')
        await refresh()
        await saved()
        notify.success('已保存你核对过的记忆建议')
       })
      }
     >
      确认保存这条记忆建议
     </Button>
    </>
   )}
  </Card>
 )
}
