import {useEffect, useState} from 'react'
import type {CodexAccount, CodexModel, Settings} from '../../shared/types'
const invoke = <T,>(action: string, args?: unknown) => window.assistant.invoke<T>(action, args)
export function CodexSettings({
 value,
 update,
 save,
 close,
 busy,
 navigation
}: {
 value: Settings
 update: (patch: Partial<Settings>) => void
 save: () => void
 close: () => void
 busy: boolean
 navigation?: React.ReactNode
}) {
 const [account, setAccount] = useState<CodexAccount | null>(null),
  [models, setModels] = useState<CodexModel[]>([]),
  [notice, setNotice] = useState(''),
  [pending, setPending] = useState(false),
  [waiting, setWaiting] = useState(false)
 async function refresh() {
  const [a, m] = await Promise.all([invoke<CodexAccount>('codex:account'), invoke<CodexModel[]>('codex:models')])
  setAccount(a)
  setModels(m)
  if (a.loggedIn) setWaiting(false)
 }
 useEffect(() => {
  void refresh().catch(e => setNotice(String(e)))
 }, [])
 useEffect(() => {
  if (!waiting) return
  const timer = setInterval(() => void refresh().catch(() => {}), 3000)
  return () => clearInterval(timer)
 }, [waiting])
 const selected = models.find(m => m.id === value.codex?.model) || models.find(m => m.isDefault) || models[0],
  effort =
   value.codex?.effort && selected?.efforts.includes(value.codex.effort)
    ? value.codex.effort
    : selected?.defaultEffort || ''
 const choose = (model: CodexModel, effort: string) => update({codex: {model: model.id, effort}})
 async function run(fn: () => Promise<void>) {
  setPending(true)
  setNotice('')
  try {
   await fn()
  } catch (e) {
   setNotice(e instanceof Error ? e.message : String(e))
  } finally {
   setPending(false)
  }
 }
 const disabled = busy || pending
 return (
  <div className="codex-settings">
   <aside>
    <h2>Codex</h2>
    <p>ChatGPT 账号</p>
    {navigation}
   </aside>
   <section>
    <header>
     <h2>Codex 连接</h2>
     <div>
      <button disabled={disabled} onClick={close}>
       关闭
      </button>
      <button className="primary" disabled={disabled || !selected} onClick={save}>
       保存设置
      </button>
     </div>
    </header>
    <div className="codex-account-card">
     <h2>使用 ChatGPT 账号</h2>
     <p>
      {account?.loggedIn
       ? `已登录 · ${account.plan || 'ChatGPT'}`
       : waiting
         ? '请在官方网页完成登录，完成后自动更新'
         : '登录后由 Codex 处理课程对话、字幕校订和笔记，无需填写 API Key。'}
     </p>
     <div className="toolbar">
      <button
       className="primary"
       disabled={disabled}
       onClick={() =>
        void run(async () => {
         await invoke('codex:login')
         setWaiting(true)
        })
       }
      >
       {account?.loggedIn ? '切换 ChatGPT 账号' : '登录 ChatGPT'}
      </button>
      <button disabled={disabled} onClick={() => void run(refresh)}>
       刷新登录状态
      </button>
     </div>
    </div>
    <label>
     模型
     <select
      aria-label="Codex 模型"
      disabled={disabled}
      value={selected?.id || ''}
      onChange={e => {
       const model = models.find(m => m.id === e.target.value)
       if (model) choose(model, model.defaultEffort)
      }}
     >
      {models.map(m => (
       <option key={m.id} value={m.id}>
        {m.name}
       </option>
      ))}
     </select>
    </label>
    <label>
     推理强度
     <select
      aria-label="Codex 推理强度"
      disabled={disabled || !selected}
      value={effort}
      onChange={e => selected && choose(selected, e.target.value)}
     >
      {selected?.efforts.map(e => (
       <option key={e} value={e}>
        {(
         {
          none: '关闭',
          minimal: '最低',
          low: '低',
          medium: '中',
          high: '高',
          xhigh: '更高',
          max: '最高',
          ultra: '超高'
         } as Record<string, string>
        )[e] || e}
       </option>
      ))}
     </select>
    </label>
    <button
     disabled={disabled || !account?.loggedIn}
     onClick={() =>
      void run(async () => {
       setNotice(await invoke<string>('codex:test'))
      })
     }
    >
     测试已保存的 Codex 连接
    </button>
    {notice && (
     <p role="status" className="notice">
      {notice}
     </p>
    )}
   </section>
  </div>
 )
}
