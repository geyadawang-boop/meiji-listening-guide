import {useEffect, useState} from 'react'
import ReactMarkdown from 'react-markdown'
import {MemorySuggestions} from './MemorySuggestions'
const request = <T,>(action: string, args: unknown = {}) => window.assistant.invoke<T>('tools:request', {action, args})
const op = () => crypto.randomUUID().replaceAll('-', '')
type Session = {conversation_id: string; title: string; revision: number; pinned: boolean}
type Task = {
 task_id: string
 question: string
 status: string
 note: string
 error_code?: string
 sources: {source_id: string; title: string; text: string; read: boolean}[]
}
type Detail = Session & {research_tasks?: Task[]}
type Memory = {
 memory_id: string
 revision: number
 kind: string
 title: string
 body: string
 source_task: string | null
 paused: boolean
 expires_at: number | null
 availability: string
}
type Memories = {records: Memory[]; capacity: {used: number; limit: number}}
export function LearningRecords() {
 const [sessions, setSessions] = useState<Session[]>([]),
  [offset, setOffset] = useState<number | null>(0),
  [detail, setDetail] = useState<Detail>(),
  [title, setTitle] = useState(''),
  [question, setQuestion] = useState(''),
  [memories, setMemories] = useState<Memories>(),
  [editing, setEditing] = useState<Memory>(),
  [kind, setKind] = useState('preference'),
  [memoryTitle, setMemoryTitle] = useState(''),
  [body, setBody] = useState(''),
  [paused, setPaused] = useState(false),
  [busy, setBusy] = useState(false),
  [error, setError] = useState(''),
  [notice, setNotice] = useState('')
 async function listing(start = 0) {
  const page = await request<{entries: Session[]; has_more: boolean}>('conversations', {offset: start})
  setSessions(start ? old => [...old, ...page.entries] : page.entries)
  setOffset(page.has_more ? start + 50 : null)
 }
 async function refresh() {
  await listing()
  setMemories(await request<Memories>('memories'))
 }
 async function run(fn: () => Promise<unknown>) {
  setBusy(true)
  setError('')
  setNotice('')
  try {
   await fn()
  } catch (reason) {
   setError(reason instanceof Error ? reason.message : String(reason))
  } finally {
   setBusy(false)
  }
 }
 useEffect(() => {
  void run(refresh)
 }, [])
 useEffect(() => {
  if (!detail?.research_tasks?.some(task => task.status === 'running')) return
  const timer = setInterval(
   () =>
    void request<Detail>('conversation-read', {id: detail.conversation_id})
     .then(setDetail)
     .catch(reason => setError(String(reason))),
   2000
  )
  return () => clearInterval(timer)
 }, [detail?.conversation_id, detail?.research_tasks?.map(task => task.status).join()])
 function edit(memory?: Memory) {
  setEditing(memory)
  setKind(memory?.kind || 'preference')
  setMemoryTitle(memory?.title || '')
  setBody(memory?.body || '')
  setPaused(memory?.paused || false)
 }
 return (
  <>
   <section className="knowledge-card">
    <h3>知识会话</h3>
    <p className="hint">
     研究结果和已读来源保存在副本知识库。打开历史不会重新请求模型；后续问题采用保存的上下文，重新核验引用资料，不把历史回答当原文。
    </p>
    <div className="row">
     <input
      aria-label="知识会话名称"
      placeholder="例如：龋病病因复习"
      maxLength={80}
      value={title}
      onChange={e => setTitle(e.target.value)}
     />
     <button
      disabled={busy || !title.trim()}
      onClick={() =>
       void run(async () => {
        const created = await request<Session>('conversation-create', {title})
        setDetail(await request<Detail>('conversation-read', {id: created.conversation_id}))
        setTitle('')
        await listing()
       })
      }
     >
      新建知识会话
     </button>
     <button disabled={busy} onClick={() => void run(refresh)}>
      刷新学习记录
     </button>
    </div>
    <div className="discussion-list">
     {sessions.map(item => (
      <button
       key={item.conversation_id}
       disabled={busy}
       onClick={() =>
        void run(async () => {
         setDetail(await request<Detail>('conversation-read', {id: item.conversation_id}))
         setTitle(item.title)
        })
       }
      >
       {item.pinned ? '置顶 · ' : ''}
       {item.title}
      </button>
     ))}
    </div>
    {offset !== null && (
     <button disabled={busy} onClick={() => void run(() => listing(offset))}>
      更多知识会话
     </button>
    )}
    {detail && (
     <>
      <h4>{detail.title}</h4>
      <div className="row">
       <button
        disabled={busy || !title.trim()}
        onClick={() =>
         void run(async () => {
          const organization = await request<{revision: number; pinned: boolean}>('conversation-organization', {
           id: detail.conversation_id
          })
          await request('conversation-organize', {
           id: detail.conversation_id,
           op: op(),
           revision: organization.revision,
           title,
           pinned: organization.pinned
          })
          setDetail(await request<Detail>('conversation-read', {id: detail.conversation_id}))
          await listing()
         })
        }
       >
        保存会话名称
       </button>
       <button
        disabled={busy}
        onClick={() =>
         void run(async () => {
          const organization = await request<{revision: number; pinned: boolean}>('conversation-organization', {
           id: detail.conversation_id
          })
          await request('conversation-organize', {
           id: detail.conversation_id,
           op: op(),
           revision: organization.revision,
           title: detail.title,
           pinned: !organization.pinned
          })
          await listing()
         })
        }
       >
        切换置顶
       </button>
      </div>
      <textarea
       aria-label="知识会话问题"
       maxLength={1500}
       value={question}
       onChange={e => setQuestion(e.target.value)}
       placeholder="依据知识库继续提问…"
      />
      <button
       className="primary"
       disabled={busy || !question.trim() || !!detail.research_tasks?.some(task => task.status === 'running')}
       onClick={() =>
        void run(async () => {
         const overview = await request<{extensions: {revision: number}; mcp: {revision: number}}>('overview')
         await request('agent-create', {
          op: op(),
          question,
          channels: ['library', 'memory', 'conversations'],
          skills: {revision: overview.extensions.revision, ids: []},
          mcp: {revision: overview.mcp.revision, items: []},
          materials: [],
          conversation: {id: detail.conversation_id, revision: detail.revision}
         })
         setQuestion('')
         setDetail(await request<Detail>('conversation-read', {id: detail.conversation_id}))
         await listing()
        })
       }
      >
       发送本次问题
      </button>
      {detail.research_tasks?.map(task => (
       <article key={task.task_id}>
        <h4>{task.question}</h4>
        <p>
         {task.status === 'running' ? '正在核验与回答' : task.status === 'completed' ? '已保存' : '未完成'}{' '}
         {task.error_code || ''}
        </p>
        {task.status === 'running' && (
         <button
          onClick={() =>
           void run(async () => {
            await request('agent-stop', {id: task.task_id})
            setDetail(await request<Detail>('conversation-read', {id: detail.conversation_id}))
           })
          }
         >
          停止本次回答
         </button>
        )}
        {task.note && (
         <div className="learning-summary">
          <ReactMarkdown>{task.note}</ReactMarkdown>
         </div>
        )}
        <details>
         <summary>本次来源</summary>
         {task.sources.map(source => (
          <p key={source.source_id}>
           {source.source_id} · {source.title} · {source.read ? '已读' : '未读'}
           <br />
           {source.text}
          </p>
         ))}
        </details>
        {task.status === 'completed' && (
         <button
          disabled={busy}
          onClick={() =>
           void run(async () => {
            const path = await request<string>('agent-export', {id: task.task_id})
            await window.assistant.invoke('library:reveal', {path})
            setNotice('所选会话成果已保存')
           })
          }
         >
          保存本次回答
         </button>
        )}
       </article>
      ))}
     </>
    )}
   </section>
   <MemorySuggestions saved={async () => setMemories(await request<Memories>('memories'))} />
   <section className="knowledge-card">
    <h3>
     学习记忆 · {memories?.capacity.used || 0}/{memories?.capacity.limit || 100}
    </h3>
    <p className="hint">
     由你明确填写和保存，模型建议不自动写入。记忆仅辅助后续检索，不能当作教材事实。停用保留内容；忘记会清除内容。
    </p>
    <div className="row">
     <select aria-label="学习记忆类型" value={kind} onChange={e => setKind(e.target.value)}>
      <option value="preference">学习偏好</option>
      <option value="progress">学习进度</option>
      <option value="correction">待核实纠错</option>
     </select>
     <input
      aria-label="学习记忆标题"
      maxLength={80}
      value={memoryTitle}
      onChange={e => setMemoryTitle(e.target.value)}
     />
    </div>
    <textarea aria-label="学习记忆正文" maxLength={1000} value={body} onChange={e => setBody(e.target.value)} />
    <label className="media-check">
     <input type="checkbox" checked={paused} onChange={e => setPaused(e.target.checked)} />
     停用这条记忆
    </label>
    <div className="row">
     <button
      disabled={busy || !memoryTitle.trim() || !body.trim()}
      onClick={() =>
       void run(async () => {
        await request('memory-change', {
         value: {
          op_id: op(),
          memory_id: editing?.memory_id || null,
          revision: editing?.revision || 0,
          kind,
          title: memoryTitle,
          body,
          source_task: editing?.source_task || null,
          paused,
          expires_at: editing?.expires_at || null
         }
        })
        edit()
        setMemories(await request<Memories>('memories'))
        setNotice('学习记忆已保存')
       })
      }
     >
      保存学习记忆
     </button>
     {editing && <button onClick={() => edit()}>取消编辑</button>}
    </div>
    {memories?.records.map(memory => (
     <article key={memory.memory_id}>
      <h4>
       {memory.title} · {memory.paused ? '已停用' : '可召回'}
      </h4>
      <p>{memory.body}</p>
      <div className="row">
       <button disabled={busy} onClick={() => edit(memory)}>
        编辑记忆
       </button>
       <button
        disabled={busy}
        onClick={() =>
         void run(async () => {
          await request('memory-change', {
           deleting: true,
           value: {op_id: op(), memory_id: memory.memory_id, revision: memory.revision}
          })
          if (editing?.memory_id === memory.memory_id) edit()
          setMemories(await request<Memories>('memories'))
         })
        }
       >
        忘记这条记忆
       </button>
      </div>
     </article>
    ))}
   </section>
   {notice && <p role="status">{notice}</p>}
   {error && (
    <p className="alert" role="alert">
     {error}
    </p>
   )}
  </>
 )
}
