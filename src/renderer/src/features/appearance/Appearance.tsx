import {Button, Checkbox, Label, Slider, Tabs} from '@heroui/react'
import {useState, useRef, useEffect, type CSSProperties} from 'react'
import {defaultAppearance, resolveAppearance, type Appearance, type AppearanceState} from '@shared/appearance'
import type {Course} from '@shared/types'
import {ChatMessage} from '@renderer/features/chat/ChatMessage'
import {notify} from '@renderer/ui/ToastHost'
import {SelectField} from '@renderer/ui/SelectField'
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
 saved,
 embedded = false
}: {
 initial: AppearanceState
 courseId: string
 courses: Course[]
 close: () => void
 saved: (state: AppearanceState) => void
 embedded?: boolean
}) {
 const [editingCourseId, setEditingCourseId] = useState(courseId || courses[0]?.id || ''),
  [state, setState] = useState(initial),
  [scope, setScope] = useState<'global' | 'course'>('global'),
  [value, setValue] = useState(initial.global),
  [busy, setBusy] = useState(false),
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
      notify.error(e, {title: '保存外观失败', key: 'appearance:save', dedupeWindow: 10000})
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
 }
 async function run(fn: () => Promise<void>) {
  setBusy(true)
  try {
   await flush()
   await fn()
  } catch (e) {
   notify.error(e, {title: '保存外观失败', key: 'appearance:save', dedupeWindow: 10000})
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
  <Slider
   aria-label={label}
   className="w-full"
   value={value[key]}
   minValue={min}
   maxValue={max}
   step={step}
   isDisabled={busy}
   formatOptions={{maximumFractionDigits: 2}}
   onChange={next => typeof next === 'number' && update({[key]: next})}
  >
   <Label>{label}</Label>
   <Slider.Output />
   <Slider.Track>
    <Slider.Fill />
    <Slider.Thumb />
   </Slider.Track>
  </Slider>
 )
 return (
  <section
   className={'appearance-editor' + (embedded ? ' appearance-editor--embedded' : '')}
   role={embedded ? undefined : 'dialog'}
   aria-label="聊天外观"
  >
   <header>
    <h2>聊天外观</h2>
    <div>
     {!embedded && (
      <Button variant="ghost" size="sm" isDisabled={busy} onClick={() => void run(async () => close())}>
       关闭
      </Button>
     )}
     <Button
      variant="primary"
      size="sm"
      isDisabled={busy}
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
     </Button>
    </div>
   </header>
   <div className="appearance-layout">
    <fieldset className="appearance-controls appearance-controls--background" disabled={busy}>
     <div className="appearance-scope-block">
      <Tabs
       className="appearance-scope-tabs"
       selectedKey={scope}
       onSelectionChange={key => {
        if (key === 'global' || key === 'course') changeScope(key)
       }}
      >
       <Tabs.ListContainer className="app-tabs__list-container">
        <Tabs.List aria-label="设置范围">
         <Tabs.Tab className="app-tabs__tab" id="global" isDisabled={busy}>
          全局
          <Tabs.Indicator />
         </Tabs.Tab>
         <Tabs.Tab className="app-tabs__tab" id="course" isDisabled={busy || !courses.length}>
          课程
          <Tabs.Indicator />
         </Tabs.Tab>
        </Tabs.List>
       </Tabs.ListContainer>
       <Tabs.Panel id="global">
        {courseId && state.courses[courseId] && (
         <div className="appearance-notice">
          {courses.find(c => c.id === courseId)?.name} 使用独立外观。
          <Button
           variant="tertiary"
           size="sm"
           isDisabled={busy}
           onClick={() =>
            void run(async () => commit(await window.assistant.invoke<AppearanceState>('appearance:clear', {courseId})))
           }
          >
           让当前课程跟随全局
          </Button>
         </div>
        )}
       </Tabs.Panel>
       <Tabs.Panel id="course">
        <div className="appearance-course">
         <label>
          选择课程
          <SelectField
           label="外观设置课程"
           isDisabled={busy}
           value={editingCourseId}
           onChange={next => {
            setEditingCourseId(next)
            setValue(resolveAppearance(stateRef.current, next))
           }}
           options={courses.map(c => ({value: c.id, label: c.name}))}
          />
         </label>
         <span>{state.courses[editingCourseId] ? '独立设置' : '跟随全局'}</span>
         <Button
          variant="tertiary"
          size="sm"
          isDisabled={busy}
          onClick={() =>
           void run(async () => {
            const next = await window.assistant.invoke<AppearanceState>('appearance:clear', {
             courseId: editingCourseId
            })
            commit(next)
            setValue(next.global)
           })
          }
         >
          跟随全局
         </Button>
        </div>
       </Tabs.Panel>
      </Tabs>
     </div>
     <section>
      <h3>聊天背景</h3>
      <label>
       背景样式
       <SelectField
        label="聊天背景"
        value={value.background}
        onChange={next => update({background: next as Appearance['background']})}
        options={[
         {value: 'none', label: '无背景'},
         {value: 'lavender', label: '薰衣草'},
         {value: 'rose', label: '樱花'},
         {value: 'mint', label: '薄荷'},
         {value: 'image', label: '自选图片'}
        ]}
       />
      </label>
      <div className="appearance-actions">
       <Button
        variant="tertiary"
        size="sm"
        isDisabled={busy}
        onClick={() =>
         void run(async () => {
          const image = await window.assistant.invoke<string | null>('appearance:image')
          if (image) update({image, background: 'image'})
         })
        }
       >
        选择背景图片
       </Button>
       <Button variant="ghost" size="sm" isDisabled={busy} onClick={() => update({image: '', background: 'none'})}>
        移除背景
       </Button>
      </div>
     </section>
    </fieldset>
    <aside>
     <h3 className="appearance-preview-title">实时预览</h3>
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
    <fieldset className="appearance-controls appearance-controls--details" disabled={busy}>
     <section>
      <h3>背景细节与头像</h3>
      {slider('背景不透明度', 'opacity', 0, 1, 0.05)}
      {slider('背景模糊', 'blur', 0, 24)}
      {slider('背景遮罩', 'scrim', 0, 1, 0.05)}
      <label>
       聊天主题色
       <SelectField
        label="聊天主题色"
        value={value.accent}
        onChange={next => update({accent: next as Appearance['accent']})}
        options={Object.entries({default: '默认', lavender: '浅紫', rose: '粉樱', mint: '薄荷', blue: '雾蓝'}).map(
         ([id, name]) => ({value: id, label: name})
        )}
       />
      </label>
      <Button
       variant="tertiary"
       size="sm"
       isDisabled={busy}
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
      </Button>
      <label>
       头像形状
       <SelectField
        label="头像形状"
        value={value.avatarShape}
        onChange={next => update({avatarShape: next as Appearance['avatarShape']})}
        options={[
         {value: 'round', label: '圆形'},
         {value: 'rounded', label: '圆角方形'}
        ]}
       />
      </label>
      {slider('头像大小', 'avatarSize', 28, 72)}
     </section>
    </fieldset>
    <fieldset className="appearance-controls appearance-controls--style" disabled={busy}>
     <section>
      <h3>文字与气泡</h3>
      {slider('正文字号', 'fontSize', 12, 24)}
      {slider('正文行高', 'lineHeight', 1.3, 2.2, 0.05)}
      {slider('消息间距', 'messageGap', 8, 48)}
      {slider('气泡圆角', 'bubbleRadius', 0, 28)}
      {slider('聊天内容宽度', 'contentWidth', 560, 1040, 20)}
      <Checkbox
       className="appearance-check"
       isSelected={value.showNames}
       onChange={checked => update({showNames: checked})}
      >
       <Checkbox.Content>
        <Checkbox.Control>
         <Checkbox.Indicator />
        </Checkbox.Control>
        显示发送者名字
       </Checkbox.Content>
      </Checkbox>
      <Checkbox
       className="appearance-check"
       isSelected={value.assistantBubble}
       onChange={checked => update({assistantBubble: checked})}
      >
       <Checkbox.Content>
        <Checkbox.Control>
         <Checkbox.Indicator />
        </Checkbox.Control>
        助手消息使用气泡
       </Checkbox.Content>
      </Checkbox>
     </section>
    </fieldset>
   </div>
   <div className="appearance-footer">
    <Button
     variant="tertiary"
     size="sm"
     isDisabled={busy}
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
    </Button>
    {status && <p role="status">{status}</p>}
   </div>
  </section>
 )
}
