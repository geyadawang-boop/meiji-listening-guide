import {useEffect, useRef, useState} from 'react'
import {reasoningOptions} from '@shared/reasoning'
import type {Settings} from '@shared/types'

// Model/parameter tabs and draft confirmation follow ElecKoi ModelPicker (AGPL-3.0).
export function ChatModelPicker({
 settings,
 busy,
 save,
 close
}: {
 settings: Settings
 busy: boolean
 save: (value: Settings) => Promise<boolean>
 close: () => void
}) {
 const [draft, setDraft] = useState(settings),
  [tab, setTab] = useState<'models' | 'parameters'>('models'),
  [query, setQuery] = useState('')
 const panel = useRef<HTMLElement>(null)
 const profile = draft.profiles.find(p => p.id === draft.activeProfile)
 const effort = profile?.parameters?.[profile.model]?.reasoningEffort || ''
 const changed = JSON.stringify(draft) !== JSON.stringify(settings)
 useEffect(() => {
  const previous = document.activeElement as HTMLElement | null
  panel.current?.focus()
  return () => previous?.focus()
 }, [])
 function choose(id: string, model?: string) {
  setDraft(d => ({
   ...d,
   activeProfile: id,
   profiles: d.profiles.map(p => (p.id === id ? {...p, model: model ?? p.model} : p))
  }))
 }
 function reasoning(value: string) {
  if (!profile) return
  setDraft(d => ({
   ...d,
   profiles: d.profiles.map(p =>
    p.id === profile.id
     ? {
        ...p,
        parameters: {...p.parameters, [p.model]: {...p.parameters?.[p.model], reasoningEffort: value || undefined}}
       }
     : p
   )
  }))
 }
 function key(event: React.KeyboardEvent) {
  if (event.key === 'Escape' && !busy) {
   event.stopPropagation()
   close()
  }
  if (event.key === 'Tab') {
   const items = panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input,select')
   if (!items?.length) return
   const first = items[0],
    last = items[items.length - 1]
   if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) {
    event.preventDefault()
    last.focus()
   } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
   }
  }
 }
 return (
  <div
   className="chat-model-backdrop"
   onMouseDown={e => {
    if (e.target === e.currentTarget && !busy) close()
   }}
  >
   <section
    className="chat-model-panel"
    ref={panel}
    tabIndex={-1}
    role="dialog"
    aria-modal="true"
    aria-label="模型设置"
    onKeyDown={key}
   >
    <header>
     <div className="chat-model-title">
      <strong>模型设置</strong>
      <span>{profile?.model || '选择模型'}</span>
     </div>
     <button type="button" className="chat-model-close" aria-label="关闭模型设置" disabled={busy} onClick={close}>
      ×
     </button>
    </header>
    <div className="chat-model-tabs" role="tablist" aria-label="模型设置页面">
     <button type="button" role="tab" aria-selected={tab === 'models'} onClick={() => setTab('models')}>
      模型
     </button>
     <button type="button" role="tab" aria-selected={tab === 'parameters'} onClick={() => setTab('parameters')}>
      参数
     </button>
    </div>
    {tab === 'models' ? (
     <div className="chat-model-browser">
      <div className="chat-model-configs">
       {draft.profiles.map(p => (
        <button
         type="button"
         key={p.id}
         aria-pressed={p.id === draft.activeProfile}
         disabled={busy}
         onClick={() => choose(p.id)}
        >
         <span className="model-choice-dot" />
         <span>
          <strong>{p.name}</strong>
          <small>{p.model}</small>
         </span>
        </button>
       ))}
      </div>
      <div className="chat-model-list-pane">
       <input aria-label="搜索对话模型" placeholder="搜索模型" value={query} onChange={e => setQuery(e.target.value)} />
       <div className="chat-model-list">
        {[...new Set(profile ? [profile.model, ...(profile.models || [])] : [])]
         .filter(m => m && m.toLowerCase().includes(query.toLowerCase()))
         .map(m => (
          <button
           type="button"
           key={m}
           aria-pressed={m === profile?.model}
           disabled={busy}
           onClick={() => profile && choose(profile.id, m)}
          >
           <span className="model-choice-dot" />
           {m}
          </button>
         ))}
       </div>
      </div>
     </div>
    ) : (
     <div className="chat-model-parameters">
      <div className="parameter-heading">
       <h3>模型参数</h3>
       <small>仅作用于 {profile?.model}</small>
      </div>
      <label>
       推理强度
       <select
        aria-label="对话推理强度"
        disabled={busy || !profile}
        value={effort}
        onChange={e => reasoning(e.target.value)}
       >
        {reasoningOptions.map(o => (
         <option key={o.value} value={o.value}>
          {o.label}
         </option>
        ))}
       </select>
      </label>
     </div>
    )}
    <footer className="chat-model-actions">
     <button type="button" disabled={busy} onClick={close}>
      取消
     </button>
     <button
      type="button"
      className="primary"
      disabled={busy || !changed}
      onClick={() =>
       void save(draft).then(ok => {
        if (ok) close()
       })
      }
     >
      {busy ? '保存中…' : '保存'}
     </button>
    </footer>
   </section>
  </div>
 )
}
