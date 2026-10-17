import {useState, useRef, useEffect, type CSSProperties} from 'react'
import {defaultAppearance, resolveAppearance, type Appearance, type AppearanceState} from '../../shared/appearance'
import type {Course} from '../../shared/types'
import {ChatMessage} from './ChatMessage'
const colors = {default: 'var(--blue)', lavender: '#9279c7', rose: '#ca809c', mint: '#5d9e90', blue: '#6497ca'}
export function chatStyle(value: Appearance) {
 return {
  '--appearance-accent': colors[value.accent],
  '--appearance-user-bg':
   value.accent === 'default'
    ? 'var(--bubble-blue)'
    : 'color-mix(in srgb,' + colors[value.accent] + ' 18%,var(--surface-raised))',
  '--chat-font': value.fontSize + 'px',
  '--chat-line': value.lineHeight,
  '--chat-avatar-size': value.avatarSize + 'px',
  '--chat-avatar-radius': value.avatarShape === 'round' ? '50%' : '14px',
  '--chat-bubble-radius': value.bubbleRadius + 'px',
  '--chat-gap': value.messageGap + 'px',
  '--chat-width': value.contentWidth + 'px'
 } as CSSProperties
}
export function Wallpaper({value}: {value: Appearance}) {
 if (value.background === 'none' || (value.background === 'image' && !value.image)) return null
 const backgrounds = {
  lavender: 'radial-gradient(ellipse at 20% 15%,#cbbce8,transparent 65%),linear-gradient(135deg,#eae4f7,#e8edf8)',
  rose: 'radial-gradient(ellipse at 80% 15%,#edaccb,transparent 65%),linear-gradient(135deg,#f6cddd,#ffeaf2)',
  mint: 'radial-gradient(ellipse at 20% 20%,#b8dccc,transparent 65%),linear-gradient(135deg,#e2f3e9,#e3edf5)',
  none: 'none',
  image: value.image ? `url("${value.image}")` : 'none'
 }
 return (
  <div className="chat-wallpaper" aria-hidden="true">
   <div
    style={{backgroundImage: backgrounds[value.background], opacity: value.opacity, filter: `blur(${value.blur}px)`}}
   />
   <span style={{opacity: value.scrim}} />
  </div>
 )
}
export function AppearanceEditor({
 initial,
 courseId,
 courses,
 close,
 saved
}: {
 initial: AppearanceState
 courseId: string
 courses: Course[]
 close: () => void
 saved: (state: AppearanceState) => void
}) {
 const [editingCourseId, setEditingCourseId] = useState(courseId || courses[0]?.id || ''),
  [state, setState] = useState(initial),
  [scope, setScope] = useState<'global' | 'course'>('global'),
  [value, setValue] = useState(initial.global),
  [busy, setBusy] = useState(false),
  [error, setError] = useState(''),
  [status, setStatus] = useState('')
 const stateRef = useRef(initial),
  pending = useRef(new Map<string, Appearance>()),
  timer = useRef<ReturnType<typeof setTimeout> | null>(null),
  chain = useRef<Promise<void>>(Promise.resolve()),
  revision = useRef(0),
  mounted = useRef(true)
 function commit(next: AppearanceState) {
  stateRef.current = next
  saved(next)
  if (mounted.current) {
   setState(next)
   setStatus('已自动保存')
  }
 }
 function flush() {
  if (timer.current) {
   clearTimeout(timer.current)
   timer.current = null
  }
  const batch = [...pending.current]
  pending.current.clear()
  const rev = revision.current
  const op = chain.current
   .catch(() => {})
   .then(async () => {
    let result: AppearanceState | undefined
    try {
     for (const [id, value] of batch)
      result = await window.assistant.invoke<AppearanceState>('appearance:save', {value, courseId: id || undefined})
     if (result && rev === revision.current) commit(result)
    } catch (e) {
     for (const [id, value] of batch) if (!pending.current.has(id)) pending.current.set(id, value)
     if (mounted.current) {
      setError(e instanceof Error ? e.message : String(e))
      setStatus('保存失败，可点击保存重试')
     }
     throw e
    }
   })
  chain.current = op
  return op
 }
 useEffect(() => {
  mounted.current = true
  return () => {
   mounted.current = false
   void flush().catch(() => {})
  }
 }, [])
 function update(next: Partial<Appearance>) {
  const merged = {...value, ...next},
   id = scope === 'course' ? editingCourseId : ''
  setValue(merged)
  setError('')
  setStatus('正在保存…')
  const current = stateRef.current,
   staged: AppearanceState = id
    ? {...current, courses: {...current.courses, [id]: merged}}
    : {...current, global: merged}
  stateRef.current = staged
  setState(staged)
  saved(staged)
  pending.current.set(id, merged)
  revision.current++
  if (timer.current) clearTimeout(timer.current)
  timer.current = setTimeout(() => void flush().catch(() => {}), 250)
 }
 const changeScope = (next: 'global' | 'course') => {
  setScope(next)
  setValue(next === 'global' ? stateRef.current.global : resolveAppearance(stateRef.current, editingCourseId))
  setError('')
 }
 async function run(fn: () => Promise<void>) {
  setBusy(true)
  setError('')
  try {
   await flush()
   await fn()
  } catch (e) {
   setError(e instanceof Error ? e.message : String(e))
  } finally {
   setBusy(false)
  }
 }
 const slider = (
  label: string,
  key:
   | 'opacity'
   | 'blur'
   | 'scrim'
   | 'fontSize'
   | 'lineHeight'
   | 'avatarSize'
   | 'bubbleRadius'
   | 'messageGap'
   | 'contentWidth',
  min: number,
  max: number,
  step = 1
 ) => (
  <label className="appearance-slider">
   {label}
   <output>{Math.round(value[key] * 100) / 100}</output>
   <input
    type="range"
    aria-label={label}
    min={min}
    max={max}
    step={step}
    value={value[key]}
    onChange={e => update({[key]: Number(e.target.value)})}
   />
  </label>
 )
 return (
  <section className="appearance-editor" role="dialog" aria-label="聊天外观">
   <header>
    <h2>聊天外观</h2>
    <div>
     <button disabled={busy} onClick={() => void run(async () => close())}>
      关闭
     </button>
     <button
      className="primary"
      disabled={busy}
      onClick={() =>
       void run(async () =>
        commit(
         await window.assistant.invoke<AppearanceState>('appearance:save', {
          value,
          courseId: scope === 'course' ? editingCourseId : undefined
         })
        )
       )
      }
     >
      保存
     </button>
    </div>
   </header>
   <div className="appearance-layout">
    <fieldset className="appearance-controls" disabled={busy}>
     <div className="appearance-scope" role="group" aria-label="设置范围">
      <button disabled={busy} className={scope === 'global' ? 'selected' : ''} onClick={() => changeScope('global')}>
       全局
      </button>
      <button
       disabled={busy || !courses.length}
       className={scope === 'course' ? 'selected' : ''}
       onClick={() => changeScope('course')}
      >
       课程
      </button>
     </div>
     {scope === 'global' && courseId && state.courses[courseId] && (
      <div className="appearance-notice">
       {courses.find(c => c.id === courseId)?.name} 使用独立外观。
       <button
        disabled={busy}
        onClick={() =>
         void run(async () => commit(await window.assistant.invoke<AppearanceState>('appearance:clear', {courseId})))
        }
       >
        让当前课程跟随全局
       </button>
      </div>
     )}
     {scope === 'course' && (
      <div className="appearance-course">
       <label>
        选择课程
        <select
         aria-label="外观设置课程"
         disabled={busy}
         value={editingCourseId}
         onChange={e => {
          setEditingCourseId(e.target.value)
          setValue(resolveAppearance(stateRef.current, e.target.value))
          setError('')
         }}
        >
         {courses.map(c => (
          <option key={c.id} value={c.id}>
           {c.name}
          </option>
         ))}
        </select>
       </label>
       <span>{state.courses[editingCourseId] ? '独立设置' : '跟随全局'}</span>
       <button
        disabled={busy}
        onClick={() =>
         void run(async () => {
          const next = await window.assistant.invoke<AppearanceState>('appearance:clear', {courseId: editingCourseId})
          commit(next)
          setValue(next.global)
         })
        }
       >
        跟随全局
       </button>
      </div>
     )}
     <section>
      <h3>聊天背景</h3>
      <label>
       背景
       <select
        aria-label="聊天背景"
        value={value.background}
        onChange={e => update({background: e.target.value as Appearance['background']})}
       >
        <option value="none">无背景</option>
        <option value="lavender">薰衣草</option>
        <option value="rose">樱花</option>
        <option value="mint">薄荷</option>
        <option value="image">自选图片</option>
       </select>
      </label>
      <div className="appearance-actions">
       <button
        disabled={busy}
        onClick={() =>
         void run(async () => {
          const image = await window.assistant.invoke<string | null>('appearance:image')
          if (image) update({image, background: 'image'})
         })
        }
       >
        选择背景图片
       </button>
       <button disabled={busy} onClick={() => update({image: '', background: 'none'})}>
        移除背景
       </button>
      </div>
      {slider('背景透明度', 'opacity', 0, 1, 0.05)}
      {slider('背景模糊', 'blur', 0, 24)}
      {slider('背景遮罩', 'scrim', 0, 1, 0.05)}
     </section>
     <section>
      <h3>头像与消息</h3>
      <label>
       主题色
       <select
        aria-label="聊天主题色"
        value={value.accent}
        onChange={e => update({accent: e.target.value as Appearance['accent']})}
       >
        {Object.entries({default: '默认', lavender: '浅紫', rose: '粉樱', mint: '薄荷', blue: '雾蓝'}).map(
         ([id, name]) => (
          <option key={id} value={id}>
           {name}
          </option>
         )
        )}
       </select>
      </label>
      <button
       disabled={busy}
       onClick={() =>
        void run(async () => {
         const next = {...value, accent: 'default' as const}
         setValue(next)
         commit(
          await window.assistant.invoke<AppearanceState>('appearance:save', {
           value: next,
           courseId: scope === 'course' ? editingCourseId : undefined
          })
         )
        })
       }
      >
       恢复默认主题色
      </button>
      <label>
       头像形状
       <select
        aria-label="头像形状"
        value={value.avatarShape}
        onChange={e => update({avatarShape: e.target.value as Appearance['avatarShape']})}
       >
        <option value="round">圆形</option>
        <option value="rounded">圆角方形</option>
       </select>
      </label>
      {slider('头像大小', 'avatarSize', 28, 72)}
      {slider('正文字号', 'fontSize', 12, 24)}
      {slider('正文行距', 'lineHeight', 1.3, 2.2, 0.05)}
      {slider('消息间距', 'messageGap', 8, 48)}
      {slider('气泡圆角', 'bubbleRadius', 0, 28)}
      {slider('聊天内容宽度', 'contentWidth', 560, 1040, 20)}
      <label className="appearance-check">
       <input type="checkbox" checked={value.showNames} onChange={e => update({showNames: e.target.checked})} />
       显示名字
      </label>
      <label className="appearance-check">
       <input
        type="checkbox"
        checked={value.assistantBubble}
        onChange={e => update({assistantBubble: e.target.checked})}
       />
       助手消息使用气泡
      </label>
     </section>
     <button
      disabled={busy}
      onClick={() =>
       void run(async () => {
        const next = {...defaultAppearance}
        setValue(next)
        commit(
         await window.assistant.invoke<AppearanceState>('appearance:save', {
          value: next,
          courseId: scope === 'course' ? editingCourseId : undefined
         })
        )
       })
      }
     >
      恢复默认外观
     </button>
     {error && (
      <p role="alert" className="alert">
       {error}
      </p>
     )}
     {status && <p role="status">{status}</p>}
    </fieldset>
    <aside>
     <h3>实时预览</h3>
     <div
      className="appearance-preview chat-styled"
      style={chatStyle(value)}
      data-names={value.showNames}
      data-bubbles={value.assistantBubble}
     >
      <Wallpaper value={value} />
      <div className="agent-thread">
       <ChatMessage role="user" content="梅酱，今天一起学习吧。">
        <p>梅酱，今天一起学习吧。</p>
       </ChatMessage>
       <ChatMessage role="assistant" content="好呀，我们先整理重点，再一起练习。">
        <p>
         好呀，我们先整理重点，
         <br />
         再一起练习。
        </p>
       </ChatMessage>
      </div>
     </div>
    </aside>
   </div>
  </section>
 )
}
