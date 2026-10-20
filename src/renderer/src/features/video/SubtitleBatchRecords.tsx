import {Button, Card, Checkbox} from '@heroui/react'
import {useEffect, useState} from 'react'
import type {SubtitleSyncTask} from '@shared/subtitle-sync'
import type {SubtitleDerivedTask} from '@shared/subtitle-derived'
import {noteTitles, type VideoNoteMode} from '@shared/video-notes'
import {notify} from '@renderer/ui/ToastHost'
import {SettingsLink} from '@renderer/app/settings-navigation'
const invoke = <T,>(action: string, args?: unknown) => window.assistant.invoke<T>(action, args)
export function SubtitleBatchRecords({
 visible,
 tasks,
 busy,
 run,
 refresh,
 courseName
}: {
 visible: boolean
 tasks: SubtitleSyncTask[]
 busy: boolean
 run: (fn: () => Promise<void>) => Promise<void>
 refresh: () => Promise<void>
 courseName?: string
}) {
 const [derived, setDerived] = useState<SubtitleDerivedTask[]>([])
 const [draft, setDraft] = useState<{task: SubtitleSyncTask; urls: string[]; modes: VideoNoteMode[]} | null>(null)
 async function load() {
  setDerived(await invoke('subtitle-derived:list'))
 }
 useEffect(() => {
  if (visible) void load().catch(reason => notify.error(reason, {title: '读取任务失败'}))
 }, [visible])
 const action = (fn: () => Promise<void>) =>
  void run(async () => {
   await fn()
   await refresh()
   await load()
  })
 return (
  <>
   {(!!tasks.length || !!derived.length) && (
    <section className="ppt-export-history batch-records" aria-label="批量同步与笔记记录">
     <header>
      <h3>同步与笔记任务</h3>
      <Button variant="ghost" size="sm" isDisabled={busy} onClick={() => action(async () => {})}>
       刷新任务
      </Button>
     </header>
     {tasks
      .filter(task => !courseName || task.courseName === courseName)
      .map(task => (
       <article key={task.id}>
        <div>
         <strong>
          {task.category || '未分类'} · {task.items.length} 个分集
         </strong>
         <details>
          <summary>查看所选分集与结果</summary>
          {task.items.map(item => (
           <div className="batch-item" key={item.url}>
            <p>
             P{item.page} · {item.title} · {item.status}
             {item.unchanged ? '（版本未变）' : ''}
             {item.sourceMethod ? ` · ${item.sourceMethod}` : ''}
            </p>
            {item.error && (
             <p className="hint" role="alert">
              {item.error}
             </p>
            )}
            {item.status === '失败' && (
             <Button
              variant="tertiary"
              size="sm"
              isDisabled={busy}
              onClick={() =>
               action(async () => {
                const result = await invoke<SubtitleSyncTask | null>('subtitle-sync:attach', {
                 id: task.id,
                 url: item.url
                })
                if (result) notify.success('指定字幕已同步，来源标为用户指定 SRT')
               })
              }
             >
              为 P{item.page} 选择已有 SRT
             </Button>
            )}
           </div>
          ))}
         </details>
         {task.interrupted && <p className="hint">上次处理中断，保存的字幕会核对后复用。</p>}
        </div>
        <div className="row">
         <Button
          variant="tertiary"
          size="sm"
          isDisabled={busy}
          onClick={() =>
           action(async () => {
            await invoke('subtitle-sync:resume', {id: task.id})
            notify.info('同步记录已核对，正在继续处理')
           })
          }
         >
          核对并继续同步
         </Button>
         <Button
          variant="tertiary"
          size="sm"
          isDisabled={busy || !task.items.some(item => item.status === '已完成')}
          onClick={() => setDraft({task, urls: [], modes: []})}
         >
          选择生成笔记
         </Button>
        </div>
       </article>
      ))}
    </section>
   )}
   {draft && (
    <Card className="knowledge-card" aria-label="选择批量课程笔记">
     <header>
      <h3>选择要整理的字幕</h3>
      <Button variant="tertiary" size="sm" isDisabled={busy} onClick={() => setDraft(null)}>
       收起选择
      </Button>
     </header>
     <p className="hint">
      只整理勾选的分集和形式。生成时会将这些字幕交给当前连接的模型；字幕同步和本地检索不会调用模型。{' '}
      <SettingsLink section="qwen">模型设置</SettingsLink>
     </p>
     <div className="batch-options">
      {draft.task.items
       .filter(item => item.status === '已完成')
       .map(item => (
        <Checkbox
         key={item.url}
         isSelected={draft.urls.includes(item.url)}
         isDisabled={busy}
         aria-label={`整理 ${item.title}`}
         onChange={checked =>
          setDraft({
           ...draft,
           urls: checked ? [...draft.urls, item.url] : draft.urls.filter(url => url !== item.url)
          })
         }
        >
         <Checkbox.Content>
          <Checkbox.Control>
           <Checkbox.Indicator />
          </Checkbox.Control>
          <span>
           P{item.page} · {item.title}
          </span>
         </Checkbox.Content>
        </Checkbox>
       ))}
     </div>
     <div className="row batch-mode-options">
      {(Object.keys(noteTitles) as VideoNoteMode[]).map(mode => (
       <Checkbox
        key={mode}
        isSelected={draft.modes.includes(mode)}
        isDisabled={busy}
        onChange={checked =>
         setDraft({
          ...draft,
          modes: checked ? [...draft.modes, mode] : draft.modes.filter(value => value !== mode)
         })
        }
       >
        <Checkbox.Content>
         <Checkbox.Control>
          <Checkbox.Indicator />
         </Checkbox.Control>
         {noteTitles[mode]}
        </Checkbox.Content>
       </Checkbox>
      ))}
     </div>
     <Button
      variant="primary"
      size="sm"
      isDisabled={busy || !draft.urls.length || !draft.modes.length}
      onClick={() =>
       action(async () => {
        const result = await invoke<SubtitleDerivedTask>('subtitle-derived:start', {
         id: draft.task.id,
         urls: draft.urls,
         modes: draft.modes
        })
        notify.success(
         `笔记任务结束：完成 ${result.items.filter(item => item.status === '已完成').length}，失败 ${result.items.filter(item => item.status === '失败').length}`
        )
        setDraft(null)
       })
      }
     >
      生成所选笔记（{draft.urls.length * draft.modes.length}）
     </Button>
    </Card>
   )}
   {!!derived.length && (
    <section className="ppt-export-history" aria-label="批量笔记成果">
     <h3>笔记与导图成果</h3>
     {derived
      .filter(task => !courseName || task.courseName === courseName)
      .map(task => (
       <article key={task.id}>
        <div>
         {task.items.map((item, index) => (
          <div className="batch-item" key={index}>
           <strong>
            {item.source.title} · {noteTitles[item.mode]} · {item.status}
           </strong>
           {item.error && (
            <p className="hint" role="alert">
             {item.error}
            </p>
           )}
           {item.outputs && (
            <div className="row">
             <Button
              variant="tertiary"
              size="sm"
              isDisabled={busy}
              onClick={() =>
               action(async () => {
                await invoke('library:open-file', {path: item.outputs![0].path})
               })
              }
             >
              打开笔记
             </Button>
             {(['docx', 'pdf', 'svg'] as const)
              .filter(format => format !== 'svg' || item.mode === 'mindmap')
              .map(format => (
               <Button
                variant="tertiary"
                size="sm"
                key={format}
                isDisabled={busy}
                onClick={() =>
                 action(async () => {
                  const existing = item.outputs?.find(output => output.path.endsWith('.' + format))
                  const path =
                   existing?.path ||
                   (await invoke<string>('video-ppt:notes-export', {path: item.outputs![0].path, format}))
                  await invoke('library:reveal', {path})
                  notify.success(`${format.toUpperCase()} 已保存`, {description: path, timeout: 6000})
                 })
                }
               >
                {format === 'svg' ? '查看导图 SVG' : `导出 ${format.toUpperCase()}`}
               </Button>
              ))}
            </div>
           )}
          </div>
         ))}
        </div>
        <Button
         variant="tertiary"
         size="sm"
         isDisabled={busy}
         onClick={() =>
          action(async () => {
           await invoke('subtitle-derived:resume', {id: task.id})
           notify.info('笔记任务已核对，正在继续处理')
          })
         }
        >
         核对并继续笔记
        </Button>
       </article>
      ))}
    </section>
   )}
  </>
 )
}
