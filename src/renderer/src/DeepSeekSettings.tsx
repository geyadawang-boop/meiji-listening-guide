import {useEffect, useState} from 'react'
import type {Profile, Settings} from '../../shared/types'
const invoke = <T,>(action: string, args?: unknown) => window.assistant.invoke<T>(action, args)
const available = ['deepseek-flash', 'deepseek-v4-pro']
export function DeepSeekSettings({value, update, save, close, busy, navigation}: {value: Settings; update: (patch: Partial<Settings>) => void; save: () => void; close: () => void; busy: boolean; navigation: React.ReactNode}) {
 const [pending, setPending] = useState(false),
  [notice, setNotice] = useState('')
 const profile = value.profiles.find(p => p.id === value.activeProfile && p.provider === 'deepseek') || value.profiles.find(p => p.provider === 'deepseek')
 useEffect(() => {
  if (!profile) {
   const p: Profile = {id: crypto.randomUUID(), name: 'DeepSeek 官方 API', provider: 'deepseek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', apiFormat: 'responses', models: available, parameters: {'deepseek-flash': {reasoningEffort: 'low'}}}
   update({profiles: [...value.profiles, p], activeProfile: p.id})
  }
 }, [])
 if (!profile) return null
 const patch = (fields: Partial<Profile>) => update({activeProfile: profile.id, profiles: value.profiles.map(p => (p.id === profile.id ? {...p, ...fields} : p))})
 const effort = profile.parameters?.[profile.model]?.reasoningEffort || 'low',
  disabled = busy || pending,
  hasKey = !!(profile.apiKey?.trim() || profile.hasKey)
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
 return (
  <div className="codex-settings deepseek-settings">
   <aside>
    <h2>模型连接</h2>
    <p>{value.connection === 'deepseek' ? '正在使用 DeepSeek' : '正在使用 ChatGPT 账号'}</p>
    {navigation}
   </aside>
   <section>
    <header>
     <h2>DeepSeek 连接</h2>
     <div>
      <button disabled={disabled} onClick={close}>
       关闭
      </button>
      <button className="primary" disabled={disabled || !hasKey} onClick={save}>
       保存并使用 DeepSeek
      </button>
     </div>
    </header>
    <div className="codex-account-card">
     <h2>DeepSeek 官方 API</h2>
     <p>填入密钥后，可用于对话、字幕、笔记和课件处理。密钥保存在本机的加密设置中。</p>
     <button
      disabled={disabled}
      onClick={() =>
       void run(async () => {
        await invoke('external', {url: 'https://platform.deepseek.com/'})
       })
      }
     >
      前往 DeepSeek 获取密钥
     </button>
    </div>
    <label>
     API 地址
     <input aria-label="DeepSeek API 地址" value={profile.baseUrl} disabled={disabled} onChange={e => patch({baseUrl: e.target.value})} />
    </label>
    <label>
     API Key
     <input aria-label="DeepSeek API Key" type="password" autoComplete="off" spellCheck={false} disabled={disabled} value={profile.apiKey || ''} placeholder={profile.hasKey ? '已加密保存，留空保留原密钥' : '填写 DeepSeek API Key'} onChange={e => patch({apiKey: e.target.value})} />
    </label>
    <label>
     模型
     <select aria-label="DeepSeek 模型" disabled={disabled} value={available.includes(profile.model) ? profile.model : ''} onChange={e => patch({model: e.target.value, apiFormat: 'responses'})}>
      {!available.includes(profile.model) && <option value="">请选择当前模型</option>}
      {available.map(m => (
       <option key={m} value={m}>
        {m === 'deepseek-flash' ? 'DeepSeek Flash · 支持图片课件' : 'DeepSeek V4 Pro · 仅文字'}
       </option>
      ))}
     </select>
    </label>
    <label>
     推理强度
     <select aria-label="DeepSeek 推理强度" disabled={disabled} value={effort} onChange={e => patch({parameters: {...profile.parameters, [profile.model]: {reasoningEffort: e.target.value}}})}>
      <option value="low">低 · 回复较快</option>
      <option value="high">高 · 深入分析</option>
      <option value="max">最高 · 复杂任务</option>
     </select>
    </label>
    <div className="toolbar">
     <button
      disabled={disabled || !hasKey}
      onClick={() =>
       void run(async () => {
        const models = await invoke<string[]>('deepseek:models', {profile})
        patch({models})
        setNotice(models.length ? '已读取模型：' + models.join('、') : '接口未返回当前支持的 DeepSeek 模型')
       })
      }
     >
      读取可用模型
     </button>
     <button
      disabled={disabled || !hasKey || !available.includes(profile.model)}
      onClick={() =>
       void run(async () => {
        setNotice(await invoke<string>('deepseek:test', {profile}))
       })
      }
     >
      测试当前 DeepSeek 连接
     </button>
    </div>
    {notice && (
     <p role="status" className="notice">
      {notice}
     </p>
    )}
   </section>
  </div>
 )
}
