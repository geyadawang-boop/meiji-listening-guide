import {useEffect, useState} from 'react'
type Scope = {
 connection_id: string
 revision: string
 platform: string
 account: string
 login_epoch: string
 peer: string
}
type Policy = {
 identity: string
 mode: 'draft' | 'auto_reply'
 interval_seconds: number
 reply_limit_hour: number
 profile_id: string
 knowledge_ids: string[]
 [key: string]: unknown
}
type Rules = {conversation: {revision: string; value: Partial<Policy>}; effective: Policy}
type Run = {peer: string; state: string}
type Job = {
 id: string
 state: string
 revision: number
 output?: {text: string}
 error?: string
 allowed_actions: string[]
}
const request = <T,>(action: string, value: unknown = {}) =>
 window.assistant.invoke<T>('tools:request', {action: 'im', args: {action, value}})
const labels: Record<string, string> = {
 pending: '等待生成',
 running: '正在处理',
 draft: '草稿待核对',
 ready: '等待发送',
 sending: '正在发送',
 unknown: '结果未知，需要核对',
 failed: '处理失败',
 blocked: '条件改变，已暂停',
 reconcile: '等待核对回执',
 completed: '已确认发送',
 waiting_external: '等待外部处理'
}
export function ImAutomation({
 scope,
 visible,
 liveAvailable,
 onDraft
}: {
 scope: Scope
 visible: boolean
 liveAvailable: boolean
 onDraft: (text: string) => void
}) {
 const [rules, setRules] = useState<Rules>(),
  [identity, setIdentity] = useState(''),
  [mode, setMode] = useState<'draft' | 'auto_reply'>('draft'),
  [interval, setInterval] = useState(15),
  [limit, setLimit] = useState(10),
  [libraries, setLibraries] = useState<{library_id: string; label: string; available: boolean}[]>([]),
  [chosen, setChosen] = useState<string[]>([]),
  [runs, setRuns] = useState<Run[]>([]),
  [jobs, setJobs] = useState<Job[]>([]),
  [offset, setOffset] = useState<number | null>(null),
  [confirmed, setConfirmed] = useState(false),
  [busy, setBusy] = useState(false),
  [error, setError] = useState(''),
  [notice, setNotice] = useState(''),
  [cleanup, setCleanup] = useState<{
   preview_id: string
   count: number
   images: number
   bytes: number
   reason?: string
  }>()
 const active = runs.some(r => r.peer === scope.peer && r.state === 'running'),
  supported = ['qq_napcat', 'weixin_local'].includes(scope.platform)
 async function status() {
  setRuns((await request<{runs: Run[]}>('runs', {...scope, action: 'status'})).runs)
 }
 async function list(start = 0) {
  const value = await request<{jobs: Job[]; next_offset: number | null}>('reply-jobs', {
   ...scope,
   action: 'list',
   limit: 25,
   offset: start,
   status: 'all'
  })
  setJobs(start ? old => [...old, ...value.jobs] : value.jobs)
  setOffset(value.next_offset)
 }
 async function refresh() {
  const next = await request<Rules>('rules', scope)
  setRules(next)
  setIdentity(next.effective.identity)
  setMode(next.effective.mode)
  setInterval(next.effective.interval_seconds)
  setLimit(next.effective.reply_limit_hour)
  setChosen(next.effective.knowledge_ids)
  setLibraries(
   (await request<{libraries: {library_id: string; label: string; available: boolean}[]}>('libraries')).libraries
  )
  if (supported) await status()
  await list()
 }
 async function run(fn: () => Promise<unknown>) {
  setBusy(true)
  setError('')
  setNotice('')
  try {
   await fn()
  } catch (e) {
   setError(e instanceof Error ? e.message : String(e))
  } finally {
   setBusy(false)
  }
 }
 useEffect(() => {
  void run(refresh)
 }, [])
 useEffect(() => {
  if (!visible || !active) return
  let stopped = false
  const timer = setTimeout(() => {
   void Promise.all([status(), list()]).catch(e => {
    if (!stopped) setError(String(e))
   })
  }, 5000)
  return () => {
   stopped = true
   clearTimeout(timer)
  }
 }, [visible, active, runs, jobs])
 return (
  <section className="knowledge-card" aria-label="会话助手设置">
   <h3>会话助手设置</h3>
   <p className="hint">
    仅对账号 {scope.account} 的会话 {scope.peer}{' '}
    生效。默认不运行；首次取得的历史消息建立基线，新消息才登记回复待办。关闭软件会暂停，重启后需要再次手动开启。
   </p>
   {!liveAvailable && (
    <p className="hint" role="status">
     该连接的实时收发未启用（内置 QQ 后台与本机微信读取仅支持 Windows
     x64）；会话助手仍可生成草稿与登记待办，不会自动发送。
    </p>
   )}
   <label>
    会话角色与回复方式
    <textarea
     aria-label="通讯会话设定"
     maxLength={6000}
     value={identity}
     onChange={e => {
      setIdentity(e.target.value)
      setConfirmed(false)
     }}
    />
   </label>
   <div className="row">
    <label>
     处理方式
     <select
      aria-label="后台回复方式"
      value={mode}
      onChange={e => {
       setMode(e.target.value as typeof mode)
       setConfirmed(false)
      }}
     >
      <option value="draft">只生成草稿，核对后手动发送</option>
      {scope.platform === 'qq_napcat' && <option value="auto_reply">自动回复所选会话</option>}
     </select>
    </label>
    <label>
     检查间隔（秒）
     <input
      aria-label="消息检查间隔"
      type="number"
      min={5}
      max={3600}
      value={interval}
      onChange={e => {
       setInterval(Number(e.target.value))
       setConfirmed(false)
      }}
     />
    </label>
    <label>
     每小时回复上限
     <input
      aria-label="每小时回复上限"
      type="number"
      min={1}
      max={120}
      value={limit}
      onChange={e => {
       setLimit(Number(e.target.value))
       setConfirmed(false)
      }}
     />
    </label>
   </div>
   {libraries.map(library => (
    <label className="media-check" key={library.library_id}>
     <input
      type="checkbox"
      disabled={!library.available}
      checked={chosen.includes(library.library_id)}
      onChange={e => {
       setChosen(old => (e.target.checked ? [...old, library.library_id] : old.filter(id => id !== library.library_id)))
       setConfirmed(false)
      }}
     />
     允许本会话查询 {library.label}
    </label>
   ))}
   <p className="hint">
    使用梅酱当前模型连接。改变模型连接或会话规则会阻止旧任务继续发送；学习记忆不会自动共享到聊天账号。
   </p>
   <div className="row">
    <button
     disabled={busy || !rules || interval < 5 || interval > 3600 || limit < 1 || limit > 120}
     onClick={() =>
      void run(async () => {
       const model = await request<{profile_id: string}>('model')
       await request('rules', {
        ...scope,
        level: 'conversation',
        expected_revision: rules!.conversation.revision,
        value: {
         ...rules!.conversation.value,
         identity,
         mode,
         interval_seconds: interval,
         reply_limit_hour: limit,
         profile_id: model.profile_id,
         knowledge_ids: chosen,
         images: false,
         agent_enabled: false
        }
       })
       setConfirmed(false)
       await refresh()
       setNotice('会话规则已保存；后台运行需单独开启')
      })
     }
    >
     保存会话规则
    </button>
    <button disabled={busy} onClick={() => void run(refresh)}>
     刷新会话状态
    </button>
   </div>
   {supported ? (
    <>
     <label className="media-check">
      <input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />
      我确认后台处理账号 {scope.account}、会话 {scope.peer}
      {mode === 'auto_reply' ? '，并允许自动发送回复' : '，只生成待核对草稿'}
     </label>
     <div className="row">
      <button
       className="primary"
       disabled={
        busy ||
        !liveAvailable ||
        !confirmed ||
        active ||
        !rules?.effective.profile_id ||
        identity !== rules.effective.identity ||
        mode !== rules.effective.mode ||
        interval !== rules.effective.interval_seconds ||
        limit !== rules.effective.reply_limit_hour ||
        JSON.stringify(chosen) !== JSON.stringify(rules.effective.knowledge_ids)
       }
       onClick={() =>
        void run(async () => {
         await request('runs', {...scope, action: 'start', peers: [scope.peer], resume_on_restart: false})
         setConfirmed(false)
         await status()
         setNotice('已开启所选会话后台处理')
        })
       }
      >
       开启所选会话助手
      </button>
      <button
       disabled={busy || !active}
       onClick={() =>
        void run(async () => {
         await request('runs', {...scope, action: 'pause'})
         setConfirmed(false)
         await status()
         await list()
         setNotice('后台处理已暂停，保存的待办保留')
        })
       }
      >
       暂停后台处理
      </button>
      <span>{active ? '正在运行' : '已暂停'}</span>
     </div>
    </>
   ) : (
    <p className="hint">此连接支持手动读取和回复；平台尚未验证后台轮询，不提供自动开启。</p>
   )}
   <h4>回复待办</h4>
   <button disabled={busy} onClick={() => void run(() => list())}>
    刷新回复待办
   </button>
   <div className="discussion-list">
    {jobs.map(job => (
     <article key={job.id}>
      <strong>{labels[job.state] || '待核验'}</strong>
      {job.output?.text && <p>{job.output.text}</p>}
      {job.error && <p className="hint">本条需重新核验当前连接或规则，未确认完成。</p>}
      <div className="row">
       {job.output?.text && (
        <button disabled={busy} onClick={() => onDraft(job.output!.text)}>
         复制到待核对正文
        </button>
       )}
       {job.allowed_actions.includes('reconcile') && (
        <button
         disabled={busy}
         onClick={() =>
          void run(async () => {
           await request('reply-jobs', {...scope, action: 'reconcile', job_id: job.id})
           await list()
          })
         }
        >
         核对已保存回执
        </button>
       )}
       {job.allowed_actions.includes('retry_generation') && (
        <button
         disabled={busy || !active}
         onClick={() =>
          void run(async () => {
           await request('reply-jobs', {
            ...scope,
            action: 'retry_generation',
            job_id: job.id,
            expected_revision: job.revision
           })
           await list()
          })
         }
        >
         重试未生成的草稿
        </button>
       )}
      </div>
     </article>
    ))}
   </div>
   {offset !== null && (
    <button disabled={busy} onClick={() => void run(() => list(offset))}>
     更多回复待办
    </button>
   )}
   <details>
    <summary>清理本会话的本地消息记录</summary>
    <p className="hint">
     只清理本软件保存的当前会话记录；不会删除 QQ / 微信原始聊天、教材或课程资料。未完成回复待办需要的证据保留。
    </p>
    <button disabled={busy} onClick={() => void run(async () => setCleanup(await request('cleanup', scope)))}>
     预览可清理记录
    </button>
    {cleanup && (
     <>
      {cleanup.reason && <p className="hint">{cleanup.reason}</p>}
      <p>
       {cleanup.count} 条消息、{cleanup.images} 张图片，约 {(cleanup.bytes / 1048576).toFixed(2)} MB
      </p>
      <button
       disabled={busy}
       onClick={() =>
        void run(async () => {
         await request('cleanup', {...scope, preview_id: cleanup.preview_id, user_confirmed: true})
         setCleanup(undefined)
         await refresh()
         setNotice('已清理本会话可删除记录')
        })
       }
      >
       确认清理以上记录
      </button>
     </>
    )}
   </details>
   {notice && <p role="status">{notice}</p>}
   {error && (
    <p className="alert" role="alert">
     {error}
    </p>
   )}
  </section>
 )
}
