import {Button, Chip} from '@heroui/react'
import {RefreshCw} from 'lucide-react'
import {useEffect, useState, type ReactNode} from 'react'
import {SettingsLink} from '@renderer/app/settings-navigation'
import {SubtitleBatchRecords} from '@renderer/features/video/SubtitleBatchRecords'
import {WindowMenuButton, WindowPanel} from '@renderer/ui/WindowPanel'
import {notify} from '@renderer/ui/ToastHost'
import type {MediaJob} from '@shared/media'
import type {SubtitleDerivedTask} from '@shared/subtitle-derived'
import type {SubtitleSyncTask} from '@shared/subtitle-sync'
import type {PendingVideoTask} from '@shared/video-ppt'
const invoke = <T,>(action: string, args?: unknown) => window.assistant.invoke<T>(action, args)
type OpenTarget = 'videoPpt' | 'videoSubtitles' | 'videoNotes' | 'recognition' | 'tools'
type VisualTask = {
 id: string
 source: string
 output?: string
 preparation?: {status: string; error?: string}
 frames: {status: string; error?: string}[]
}
type ResearchOverview = {
 tasks: {task_id: string; question: string; status: string; error_code?: string}[]
 workflows: {workflow_id: string; question: string; status: string; outcome_unknown: boolean; notice?: string}[]
}
type Row = {
 key: string
 domain: '视频' | '字幕' | '笔记' | '下载' | '识别' | '研究'
 title: string
 detail: string
 course?: string
 status: string
 actions: ReactNode
}
const states: Record<string, string> = {
 queued: '排队中',
 running: '进行中',
 completed: '已完成',
 cancelled: '已取消',
 interrupted: '待继续',
 error: '失败'
}
const statusColor = (status: string): 'default' | 'accent' | 'success' | 'warning' | 'danger' => {
 if (status === '已完成') return 'success'
 if (status === '失败') return 'danger'
 if (status === '进行中') return 'accent'
 if (status === '待处理' || status === '待继续' || status === '已取消' || status === '排队中') return 'default'
 return 'default'
}
const filterRows = (rows: Row[], filter: string) =>
 filter === '全部'
  ? rows
  : filter === '视频与字幕'
    ? rows.filter(row => ['视频', '字幕', '笔记'].includes(row.domain))
    : rows.filter(row => row.domain === filter)
function groupStatus(rows: Row[]) {
 return {
  active: rows.filter(
   row => row.status === '进行中' || row.status === '待处理' || row.status === '待继续' || row.status === '排队中'
  ),
  failed: rows.filter(row => row.status === '失败'),
  done: rows.filter(row => row.status === '已完成' || row.status === '已取消')
 }
}
export function TaskCenter({
 visible,
 close,
 open,
 restoreVideoTask
}: {
 visible: boolean
 close: () => void
 open: (view: OpenTarget) => void
 restoreVideoTask: (id: string) => void
}) {
 const [filter, setFilter] = useState('全部')
 const [rows, setRows] = useState<Row[]>([])
 const [syncTasks, setSyncTasks] = useState<SubtitleSyncTask[]>([])
 const [derivedTasks, setDerivedTasks] = useState<SubtitleDerivedTask[]>([])
 const [busy, setBusy] = useState(false)
 async function load() {
  const [pending, sync, derived, media, visual, research] = await Promise.all([
   invoke<PendingVideoTask[]>('video-ppt:pending'),
   invoke<SubtitleSyncTask[]>('subtitle-sync:list'),
   invoke<SubtitleDerivedTask[]>('subtitle-derived:list'),
   invoke<MediaJob[]>('media:list'),
   invoke<VisualTask[]>('visual:list'),
   invoke<ResearchOverview>('tools:request', {action: 'overview'}).catch(() => ({tasks: [], workflows: []}))
  ])
  setSyncTasks(sync)
  setDerivedTasks(derived)
  const next: Row[] = []
  for (const task of pending) {
   next.push({
    key: 'video:' + task.id,
    domain: task.kind === 'subtitle' ? '字幕' : '视频',
    title: task.name,
    detail: task.error || (task.kind === 'subtitle' ? '字幕转写可继续' : '课件任务待继续'),
    status: task.error ? '失败' : '待处理',
    actions: (
     <>
      <Button
       variant="tertiary"
       size="sm"
       isDisabled={busy}
       onClick={() => void run(() => invoke('video-ppt:reveal', {id: task.id}).then(() => {}))}
      >
       查看保留文件
      </Button>
      {task.kind === 'subtitle' ? (
       <Button
        variant="tertiary"
        size="sm"
        isDisabled={busy || !!task.error}
        onClick={() =>
         void run(async () => {
          await invoke('video-ppt:resume-subtitle', {id: task.id})
          open('videoSubtitles')
         })
        }
       >
        继续字幕
       </Button>
      ) : (
       <Button variant="tertiary" size="sm" isDisabled={busy || !!task.error} onClick={() => restoreVideoTask(task.id)}>
        继续检查
       </Button>
      )}
     </>
    )
   })
  }
  for (const job of media) {
   const status = states[job.state] || job.state
   next.push({
    key: 'media:' + job.id,
    domain: '下载',
    title: job.title,
    detail: job.error_message || job.warning || status,
    status,
    actions: (
     <>
      {['queued', 'running'].includes(job.state) ? (
       <Button
        variant="danger-soft"
        size="sm"
        isDisabled={busy}
        onClick={() => void run(() => invoke('media:cancel', {id: job.id}).then(() => {}))}
       >
        取消下载
       </Button>
      ) : job.state === 'completed' ? (
       <Button
        variant="tertiary"
        size="sm"
        isDisabled={busy}
        onClick={() => void run(() => invoke('media:open', {id: job.id}).then(() => {}))}
       >
        打开文件
       </Button>
      ) : (
       <Button
        variant="tertiary"
        size="sm"
        isDisabled={busy}
        onClick={() => void run(() => invoke('media:retry', {id: job.id}).then(() => {}))}
       >
        继续下载
       </Button>
      )}
     </>
    )
   })
  }
  for (const task of visual) {
   const done = task.frames.length > 0 && task.frames.every(frame => frame.status === '已完成')
   const failed = task.frames.some(frame => frame.error) || task.preparation?.error
   const running =
    task.preparation?.status === 'running' || task.frames.some(frame => frame.status !== '已完成' && !frame.error)
   next.push({
    key: 'visual:' + task.id,
    domain: '识别',
    title: task.source.split(/[\\/]/).pop() || task.source,
    detail: task.preparation?.error || task.frames.find(frame => frame.error)?.error || '画面识别',
    status: done ? '已完成' : failed ? '失败' : running ? '进行中' : '待处理',
    actions: (
     <>
      {task.output && (
       <Button
        variant="tertiary"
        size="sm"
        isDisabled={busy}
        onClick={() => void run(() => invoke('library:open-file', {path: task.output}).then(() => {}))}
       >
        打开结果
       </Button>
      )}
      {!done && (
       <Button
        variant="tertiary"
        size="sm"
        isDisabled={busy}
        onClick={() =>
         void run(() =>
          invoke(task.frames.length ? 'visual:recognize' : 'visual:prepare-resume', {id: task.id}).then(() => {})
         )
        }
       >
        继续识别
       </Button>
      )}
      <Button variant="tertiary" size="sm" isDisabled={busy} onClick={() => open('recognition')}>
       去识别工具
      </Button>
     </>
    )
   })
  }
  for (const task of research.tasks) {
   next.push({
    key: 'research:' + task.task_id,
    domain: '研究',
    title: task.question,
    detail: task.error_code || '研究 Agent',
    status: task.status === 'completed' ? '已完成' : task.status === 'failed' ? '失败' : '进行中',
    actions: (
     <Button variant="tertiary" size="sm" isDisabled={busy} onClick={() => open('tools')}>
      去研究
     </Button>
    )
   })
  }
  for (const flow of research.workflows) {
   next.push({
    key: 'workflow:' + flow.workflow_id,
    domain: '研究',
    title: flow.question,
    detail: flow.notice || (flow.outcome_unknown ? '上次结果未确认' : '两步工作流'),
    status: flow.status === 'completed' ? '已完成' : flow.status === 'failed' ? '失败' : '进行中',
    actions: (
     <Button variant="tertiary" size="sm" isDisabled={busy} onClick={() => open('tools')}>
      去研究
     </Button>
    )
   })
  }
  setRows(next)
 }
 async function run(fn: () => Promise<void>) {
  setBusy(true)
  try {
   await fn()
   await load()
  } catch (reason) {
   notify.error(reason)
  } finally {
   setBusy(false)
  }
 }
 useEffect(() => {
  if (visible) void load().catch(reason => notify.error(reason, {title: '读取任务失败'}))
 }, [visible])
 useEffect(() => {
  const activeSync = syncTasks.some(task => task.items.some(item => item.status === '等待处理'))
  const activeDerived = derivedTasks.some(task => task.items.some(item => item.status === '等待处理'))
  if (!visible || (!rows.some(row => row.status === '进行中') && !activeSync && !activeDerived)) return
  const timer = setInterval(() => {
   void load().catch(reason => notify.error(reason, {title: '刷新任务失败', key: 'tasks:refresh', dedupeWindow: 8000}))
  }, 3000)
  return () => clearInterval(timer)
 }, [visible, rows])
 const visibleRows = filterRows(rows, filter)
 const groups = groupStatus(visibleRows)
 const allGroups = groupStatus(rows)
 const activeSubtitle =
  syncTasks.filter(task => task.items.some(item => item.status === '等待处理')).length +
  derivedTasks.filter(task => task.items.some(item => item.status === '等待处理')).length
 const failedSubtitle =
  syncTasks.filter(task => task.items.some(item => item.status === '失败')).length +
  derivedTasks.filter(task => task.items.some(item => item.status === '失败')).length
 const showSubtitle = (filter === '全部' || filter === '视频与字幕') && (!!syncTasks.length || !!derivedTasks.length)
 const hasRunning = rows.some(row => row.status === '进行中' || row.status === '排队中') || activeSubtitle > 0
 return (
  <WindowPanel
   visible={visible}
   label="任务中心"
   title="任务中心"
   description="视频、字幕、下载、识别与研究的全局任务。"
   heading="任务中心"
   subheading={`${rows.length + syncTasks.length + derivedTasks.length} 个任务 · 进行中 ${allGroups.active.length + activeSubtitle} · 需要处理 ${allGroups.failed.length + failedSubtitle}`}
   menu={['全部', '视频与字幕', '下载', '识别', '研究'].map(item => (
    <WindowMenuButton key={item} active={filter === item} onSelect={() => setFilter(item)}>
     {item}
    </WindowMenuButton>
   ))}
   actions={
    <>
     {hasRunning && (
      <Button
       variant="danger-soft"
       size="sm"
       isDisabled={busy}
       onClick={() =>
        void run(async () => {
         await invoke('cancel')
         notify.info('已请求取消当前任务')
         await new Promise(resolve => setTimeout(resolve, 400))
        })
       }
      >
       取消当前任务
      </Button>
     )}
     <Button variant="ghost" size="sm" isDisabled={busy} onClick={() => void run(load)}>
      <RefreshCw size={14} aria-hidden="true" />
      刷新
     </Button>
    </>
   }
   close={close}
  >
   {!rows.length && !syncTasks.length && !derivedTasks.length && (
    <div className="learning-empty">
     <h3>暂无任务</h3>
     <p>视频、字幕、下载、识别和研究任务会集中显示在这里。</p>
    </div>
   )}
   {(filter === '全部' || filter === '视频与字幕') && (!!syncTasks.length || !!derivedTasks.length) && (
    <SubtitleBatchRecords visible={visible} tasks={syncTasks} busy={busy} run={run} refresh={load} />
   )}
   {!!groups.active.length && (
    <section className="ppt-export-history">
     <h3>进行中与待处理</h3>
     {groups.active.map(row => (
      <TaskRow key={row.key} row={row} />
     ))}
    </section>
   )}
   {!!groups.failed.length && (
    <section className="ppt-export-history">
     <h3>失败</h3>
     {groups.failed.map(row => (
      <TaskRow key={row.key} row={row} />
     ))}
    </section>
   )}
   {!!groups.done.length && (
    <section className="ppt-export-history">
     <h3>最近完成</h3>
     {groups.done.map(row => (
      <TaskRow key={row.key} row={row} />
     ))}
    </section>
   )}
   {(!!rows.length || !!syncTasks.length || !!derivedTasks.length) && !visibleRows.length && !showSubtitle && (
    <p className="hint">没有符合当前筛选的任务。</p>
   )}
   <p className="hint">
    下载或字幕组件缺失时，可以先到 <SettingsLink section="runtime">运行组件</SettingsLink>
    检查安装状态。
   </p>
  </WindowPanel>
 )
}
function TaskRow({row}: {row: Row}) {
 return (
  <article className="task-row">
   <div className="task-row__copy">
    <strong>{row.title}</strong>
    <p className="hint">
     {row.domain}
     {row.course ? ` · ${row.course}` : ' · 未关联课程'}
     {row.detail ? ` · ${row.detail}` : ''}
    </p>
   </div>
   <div className="task-row__side">
    <Chip className="task-status-chip" color={statusColor(row.status)} size="sm" variant="soft">
     {row.status}
    </Chip>
    <div className="task-row__actions">{row.actions}</div>
   </div>
  </article>
 )
}
