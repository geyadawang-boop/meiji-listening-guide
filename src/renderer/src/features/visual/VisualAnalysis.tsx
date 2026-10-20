import {Button, Card, Input} from '@heroui/react'
import {useEffect, useState} from 'react'
import {SelectField} from '@renderer/ui/SelectField'
import {notify} from '@renderer/ui/ToastHost'
import {SettingsLink} from '@renderer/app/settings-navigation'

type Frame = {time: number; status: string; text?: string; error?: string}
type Task = {
 id: string
 source: string
 duration: number
 gaps: unknown[]
 output?: string
 outputRecovery?: 'journal' | 'pending' | 'changed' | 'legacy'
 outputPending?: boolean
 outputJournal?: unknown
 preparation?: {status: string; error?: string}
 frames: Frame[]
}

const invoke = <T,>(action: string, args?: unknown) => window.assistant.invoke<T>(action, args)

export function VisualAnalysisPanel({visible}: {visible: boolean}) {
 const [tasks, setTasks] = useState<Task[]>([])
 const [cap, setCap] = useState(6)
 const [policy, setPolicy] = useState('balanced')
 const [busy, setBusy] = useState(false)
 const [progress, setProgress] = useState('')

 async function refresh() {
  setTasks(await invoke('visual:list'))
 }

 useEffect(() => {
  if (visible) void refresh().catch(reason => notify.error(reason, {title: '读取识别记录失败'}))
 }, [visible])

 useEffect(
  () =>
   window.assistant.onEvent(event => {
    if (event.kind === 'progress') setProgress(event.data.message)
   }),
  []
 )

 async function run(fn: () => Promise<void>) {
  setBusy(true)
  setProgress('')
  try {
   await fn()
   await refresh()
  } catch (reason) {
   notify.error(reason)
   void refresh().catch(() => {})
  } finally {
   setBusy(false)
  }
 }

 return (
  <div className="visual-analysis-panel">
   <Card className="knowledge-card">
    <p className="hint">
     先在本机选择图片或视频并提取画面，点击“识别所选画面”才发送画面到所选千问视觉模型。视频只处理抽样画面，保留时间间隙和源哈希。{' '}
     <SettingsLink section="qwen">视觉模型设置</SettingsLink>
     <SettingsLink section="runtime">检查运行组件</SettingsLink>
    </p>
    <div className="row">
     <label>
      最多画面数
      <Input
       aria-label="最多识别画面数"
       type="number"
       min={1}
       max={12}
       value={cap}
       disabled={busy}
       onChange={event => setCap(Number(event.target.value))}
      />
     </label>
     <label>
      选帧方式
      <SelectField
       label="选帧方式"
       value={policy}
       isDisabled={busy}
       onChange={next => setPolicy(next)}
       options={[
        {value: 'balanced', label: '内容变化优先'},
        {value: 'coverage', label: '覆盖时间范围'}
       ]}
      />
     </label>
     <Button
      variant="primary"
      size="sm"
      isDisabled={busy}
      onClick={() =>
       void run(async () => {
        await invoke('visual:prepare', {cap, policy})
       })
      }
     >
      选择图片或视频
     </Button>
     <Button variant="ghost" size="sm" isDisabled={busy} onClick={() => void run(refresh)}>
      刷新识别记录
     </Button>
    </div>
   </Card>
   {busy && (
    <div className="row">
     <p role="status">{progress || '正在提取或识别…'}</p>
     <Button variant="ghost" size="sm" onClick={() => void invoke('cancel')}>
      取消识别
     </Button>
    </div>
   )}
   {tasks.map(task => {
    const completed = task.frames.filter(frame => frame.status === '已完成').length
    const recoverable = completed > 0 && Boolean(task.outputRecovery || task.outputPending || task.outputJournal)
    const incomplete = task.frames.some(frame => frame.status !== '已完成')

    return (
     <Card className="knowledge-card" key={task.id}>
      <header>
       <h3>{task.source.split(/[\\/]/).pop()}</h3>
       {!task.frames.length ? (
        <Button
         variant="tertiary"
         size="sm"
         isDisabled={busy}
         onClick={() =>
          void run(async () => {
           await invoke('visual:prepare-resume', {id: task.id})
          })
         }
        >
         继续提取画面
        </Button>
       ) : recoverable ? (
        <>
         <Button
          variant="tertiary"
          size="sm"
          isDisabled={busy}
          onClick={() =>
           void run(async () => {
            await invoke('visual:recover-output', {id: task.id})
           })
          }
         >
          保存已识别结果
         </Button>
         {task.output && (
          <Button variant="tertiary" size="sm" onClick={() => void invoke('library:open-file', {path: task.output})}>
           打开当前结果
          </Button>
         )}
         {task.output && incomplete && (
          <Button
           variant="tertiary"
           size="sm"
           isDisabled={busy}
           onClick={() =>
            void run(async () => {
             await invoke('visual:recognize', {id: task.id})
            })
           }
          >
           继续识别未完成画面
          </Button>
         )}
        </>
       ) : task.output ? (
        <>
         <Button variant="tertiary" size="sm" onClick={() => void invoke('library:open-file', {path: task.output})}>
          打开识别结果
         </Button>
         {incomplete && (
          <Button
           variant="tertiary"
           size="sm"
           isDisabled={busy}
           onClick={() =>
            void run(async () => {
             await invoke('visual:recognize', {id: task.id})
            })
           }
          >
           继续识别未完成画面
          </Button>
         )}
        </>
       ) : (
        <Button
         variant="tertiary"
         size="sm"
         isDisabled={busy}
         onClick={() =>
          void run(async () => {
           await invoke('visual:recognize', {id: task.id})
          })
         }
        >
         识别所选画面
        </Button>
       )}
      </header>
      {task.outputRecovery && (
       <p className="hint" role="status">
        识别成果需要恢复（
        {task.outputRecovery === 'journal'
         ? '上次保存未完成'
         : task.outputRecovery === 'pending'
           ? '任务中断'
           : task.outputRecovery === 'changed'
             ? '文件已改变'
             : '旧任务缺少成果记录'}
        ），当前文件会被保留。
       </p>
      )}
      {task.preparation?.error && (
       <p className="hint" role="alert">
        {task.preparation.error}
       </p>
      )}
      <p className="hint">
       共 {task.frames.length} 个画面 · 已完成 {completed} · 未完成{' '}
       {task.frames.filter(frame => frame.status !== '已完成').length}
      </p>
      {task.gaps?.length > 0 ? (
       <details>
        <summary>抽样缺口 · {task.gaps.length}</summary>
        <ul>
         {task.gaps.map((gap, index) => (
          <li key={index}>{typeof gap === 'string' ? gap : JSON.stringify(gap)}</li>
         ))}
        </ul>
       </details>
      ) : (
       <p className="hint">提取器未报告明确缺口；视频抽样依然不覆盖全部时段。</p>
      )}
      {task.frames.map((frame, index) => (
       <details key={index} open={!!frame.error}>
        <summary>
         {Math.floor(frame.time / 60)}:
         {Math.floor(frame.time % 60)
          .toString()
          .padStart(2, '0')}{' '}
         · {frame.status}
        </summary>
        {frame.text && <p className="knowledge-text">{frame.text}</p>}
        {frame.error && (
         <p role="alert" className="hint">
          {frame.error}
         </p>
        )}
       </details>
      ))}
     </Card>
    )
   })}
  </div>
 )
}
