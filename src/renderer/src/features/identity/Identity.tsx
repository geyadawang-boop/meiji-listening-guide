import {Button, Input, TextArea} from '@heroui/react'
import {createContext, useContext, useState} from 'react'
import {defaultIdentity, type Identity} from '@shared/identity'
import buddy from '@renderer/assets/mei-avatar.png'
import lian from '@renderer/assets/lian-avatar.jpg'
import {AlertBox} from '@renderer/ui/AlertBox'
export const IdentityContext = createContext<Identity>(defaultIdentity)
export function IdentityAvatar({role}: {role: 'user' | 'assistant'}) {
 const identity = useContext(IdentityContext),
  avatar = role === 'user' ? identity.userAvatar : identity.assistantAvatar,
  name = role === 'user' ? identity.userName : identity.assistantName
 return avatar ? (
  <img className="identity-avatar" src={avatar} alt={name + '的头像'} />
 ) : role === 'assistant' ? (
  <img className="identity-avatar" src={buddy} alt={name + '的头像'} />
 ) : (
  <img className="identity-avatar" src={lian} alt={name + '的头像'} />
 )
}
export function IdentityEditor({
 initial,
 close,
 save,
 embedded = false
}: {
 initial: Identity
 close: () => void
 save: (value: Identity) => Promise<void>
 embedded?: boolean
}) {
 const [value, setValue] = useState(initial),
  [selected, setSelected] = useState<'user' | 'assistant'>('assistant'),
  [busy, setBusy] = useState(false),
  [error, setError] = useState(''),
  [saved, setSaved] = useState(false)
 function update(next: Partial<Identity>) {
  setValue(v => ({...v, ...next}))
  setSaved(false)
 }
 async function chooseAvatar() {
  setError('')
  try {
   const data = await window.assistant.invoke<string | null>('identity:avatar')
   if (data) update(selected === 'user' ? {userAvatar: data} : {assistantAvatar: data})
  } catch (e) {
   setError(e instanceof Error ? e.message : String(e))
  }
 }
 return (
  <IdentityContext.Provider value={value}>
   <section
    className={'identity-editor' + (embedded ? ' identity-editor--embedded' : '')}
    role={embedded ? undefined : 'dialog'}
    aria-label="角色与头像"
   >
    <aside>
     <h2>角色与头像</h2>
     {(['user', 'assistant'] as const).map(role => (
      <button key={role} className={selected === role ? 'selected' : ''} onClick={() => setSelected(role)}>
       <span className="identity-list-avatar">
        <IdentityAvatar role={role} />
       </span>
       <span>
        <strong>{role === 'user' ? value.userName : value.assistantName}</strong>
        <small>{role === 'user' ? '我的资料' : '梅酱'}</small>
       </span>
      </button>
     ))}
    </aside>
    <form
     onSubmit={e => {
      e.preventDefault()
      setBusy(true)
      setError('')
      void save(value)
       .then(() => setSaved(true))
       .catch(e => setError(e instanceof Error ? e.message : String(e)))
       .finally(() => setBusy(false))
     }}
    >
     <header>
      <h2>{selected === 'user' ? '我的资料' : '梅酱'}</h2>
      <div>
       {!embedded && (
        <Button variant="ghost" size="sm" type="button" isDisabled={busy} onClick={close}>
         关闭
        </Button>
       )}
       <Button variant="primary" size="sm" type="submit" isDisabled={busy}>
        保存
       </Button>
      </div>
     </header>
     <div className="identity-avatar-editor">
      <div className="identity-large-avatar">
       <IdentityAvatar role={selected} />
      </div>
      <div>
       <Button variant="tertiary" size="sm" type="button" isDisabled={busy} onClick={() => void chooseAvatar()}>
        更换头像
       </Button>
       <Button
        variant="tertiary"
        size="sm"
        type="button"
        isDisabled={busy}
        onClick={() => update(selected === 'user' ? {userAvatar: ''} : {assistantAvatar: ''})}
       >
        恢复默认头像
       </Button>
      </div>
     </div>
     <label>
      {selected === 'user' ? '我的名字' : '助手名字'}
      <Input
       required
       maxLength={40}
       aria-label={selected === 'user' ? '我的名字' : '助手名字'}
       value={selected === 'user' ? value.userName : value.assistantName}
       onChange={e => update(selected === 'user' ? {userName: e.target.value} : {assistantName: e.target.value})}
      />
     </label>
     {selected === 'assistant' && (
      <label>
       角色设定
       <TextArea
        aria-label="助手角色设定"
        maxLength={12000}
        value={value.persona}
        onChange={e => update({persona: e.target.value})}
        placeholder="例如：你是一位耐心的学习伙伴，回答简洁清楚，先解释概念，再举一个例子。"
       />
      </label>
     )}
     <footer>
      {error && <AlertBox>{error}</AlertBox>}
      {saved && <p role="status">已保存</p>}
     </footer>
    </form>
   </section>
  </IdentityContext.Provider>
 )
}
