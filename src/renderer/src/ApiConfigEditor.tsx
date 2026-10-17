import {ListeningBuddy} from './ListeningBuddy'
import {DshChevronDownIcon} from './ChatIcons'
import {reasoningOptions} from '../../shared/reasoning'
import {MessageNavIcon, ModelNavIcon, SettingsIcon, LoginNavIcon} from './SidebarIcons'
import {useEffect, useState} from 'react'
import deepseekIcon from './assets/deepseek.svg'
import type {ReactNode} from 'react'
import type {Profile, Settings} from '../../shared/types'
const invoke = <T,>(action: string, args?: unknown) => window.assistant.invoke<T>(action, args)
export function ApiConfigEditor({
 login,
 value,
 update,
 busy,
 task,
 save,
 close,
 saved,
 error,
 navigation
}: {
 login: () => void
 navigation: ReactNode
 save: () => void
 close: () => void
 saved: boolean
 error: string
 value: Settings
 update: (patch: Partial<Settings>) => void
 busy: boolean
 task: (fn: () => Promise<unknown>) => Promise<boolean>
}) {
 const [collapsed, setCollapsed] = useState(() => localStorage.getItem('model-library-general-collapsed') === 'true')
 function toggleGroup() {
  setCollapsed(v => {
   localStorage.setItem('model-library-general-collapsed', String(!v))
   return !v
  })
 }
 const [selected, setSelected] = useState(value.activeProfile || value.profiles[0]?.id || '')
 const [search, setSearch] = useState(''),
  [keyFocused, setKeyFocused] = useState(false),
  [manual, setManual] = useState(false),
  [manualName, setManualName] = useState(''),
  [revealed, setRevealed] = useState<string | null>(null),
  [notice, setNotice] = useState('')
 const p = value.profiles.find(p => p.id === selected) || value.profiles[0]
 useEffect(() => {
  setRevealed(null)
  setNotice('')
 }, [p?.id, p?.hasKey, value])
 function patch(patch: Partial<Profile>) {
  if (!p) return
  update({profiles: value.profiles.map(v => (v.id === p.id ? {...v, ...patch} : v)), activeProfile: p.id})
  setNotice('')
  setRevealed(null)
 }
 function add(provider = 'custom') {
  const id = crypto.randomUUID()
  update({
   profiles: [...value.profiles, {id, provider, name: provider === 'deepseek' ? 'DeepSeek' : '新配置', baseUrl: provider === 'deepseek' ? 'https://api.deepseek.com' : '', model: provider === 'deepseek' ? 'deepseek-chat' : '', models: provider === 'deepseek' ? ['deepseek-chat', 'deepseek-reasoner'] : []}],
   activeProfile: id
  })
  setSelected(id)
 }
 function select(id: string) {
  setSelected(id)
  update({activeProfile: id})
  setManual(false)
 }
 async function reveal() {
  if (!p) return
  if (revealed !== null) {
   setRevealed(null)
   return
  }
  if (p.apiKey) {
   setRevealed(p.apiKey)
   return
  }
  await task(async () => setRevealed(await invoke<string>('settings:revealKey', {id: p.id})))
 }
 async function readModels() {
  if (!p) return
  await task(async () => {
   const models = await invoke<string[]>('settings:models', {profile: p})
   patch({models, model: models.includes(p.model) ? p.model : models[0]})
   setNotice(`已读取 ${models.length} 个模型，请选择后保存`)
  })
 }
 async function test() {
  if (!p) return
  await task(async () => {
   if (!p.model.trim()) throw new Error('请先读取并选择模型，或填写服务商提供的完整模型名')
   const reply = await invoke<string>('settings:probe', {profile: p})
   setNotice(`连接测试成功 · ${p.name} · ${p.model}：${reply}`)
  })
 }
 async function importConfig(file: File) {
  await task(async () => {
   let data: unknown
   try {
    data = JSON.parse(await file.text())
   } catch {
    throw new Error('请选择有效的 API 配置 JSON 文件')
   }
   const object = data as {profiles?: unknown[]; configs?: unknown[]},
    rows = Array.isArray(data) ? data : object?.profiles || object?.configs || [data]
   const profiles: Profile[] = rows.map(row => {
    const r = row as Record<string, unknown>
    if (!r || typeof r !== 'object') throw new Error('API 配置内容不正确')
    const apiFormat = r.apiFormat || r.api_format || 'chat_completions'
    if (apiFormat !== 'chat_completions' && apiFormat !== 'responses') throw new Error('支持 Chat Completions 或 Responses 接口')
    const name = r.name || '导入配置',
     baseUrl = r.baseUrl || r.base_url,
     model = r.model || '',
     apiKey = r.apiKey || r.api_key
    if (typeof name !== 'string' || typeof baseUrl !== 'string' || typeof model !== 'string' || (apiKey !== undefined && typeof apiKey !== 'string')) throw new Error('配置需包含名称、baseUrl/base_url、model 和 apiKey/api_key')
    return {id: crypto.randomUUID(), name, baseUrl, model, apiFormat, apiKey: apiKey as string | undefined}
   })
   if (!profiles.length) throw new Error('文件中没有 API 配置')
   update({profiles: [...value.profiles, ...profiles], activeProfile: profiles[0].id})
   setSelected(profiles[0].id)
   setNotice(`已导入 ${profiles.length} 个配置，检查后点击保存设置`)
  })
 }
 const provider = p?.provider || (p?.baseUrl.includes('deepseek.com') ? 'deepseek' : 'custom')
 const versions = value.profiles.filter(v => (v.provider || (v.baseUrl.includes('deepseek.com') ? 'deepseek' : 'custom')) === provider)
 const parameters = p?.parameters?.[p.model] || {}
 function parameter(key: 'temperature' | 'topP' | 'maxTokens' | 'reasoningEffort', entry: string) {
  if (!p) return
  patch({parameters: {...p.parameters, [p.model]: {...parameters, [key]: entry === '' ? undefined : key === 'reasoningEffort' ? entry : Number(entry)}}})
 }
 const eye = (
  <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="1.7">
   <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
   <circle cx="12" cy="12" r="3" />
   {revealed !== null && <path d="m3 3 18 18" />}
  </svg>
 )
 return (
  <div className="model-desktop">
   <nav className="model-rail">
    <span className="rail-logo">
     <ListeningBuddy />
    </span>
    <button aria-label="返回课程" title="返回课程" onClick={close}>
     <MessageNavIcon />
    </button>
    <button className="active" aria-label="模型库" title="模型库">
     <ModelNavIcon />
    </button>
    <button aria-label="智云登录" title="智云登录" onClick={login}>
     <LoginNavIcon />
    </button>
    <div className="rail-spacer" />
    <button aria-label="设置" title="设置">
     <SettingsIcon />
    </button>
   </nav>
   <aside className="model-library">
    <strong className="library-brand">听课助手</strong>
    <h2>模型库</h2>
    <div className="library-search">
     <input aria-label="搜索模型配置" placeholder="搜索模型配置…" value={search} onChange={e => setSearch(e.target.value)} />
     <button disabled={busy} aria-label="添加 API 配置" onClick={() => add()}>
      ＋
     </button>
    </div>
    <button type="button" className="library-group" aria-expanded={!collapsed} aria-controls="general-model-providers" onClick={toggleGroup}>
     <span className="library-group-title">
      <DshChevronDownIcon className={collapsed ? 'collapsed' : ''} />
      通用大模型
     </span>
     <span>2</span>
    </button>
    <div id="general-model-providers" hidden={collapsed && !search.trim()}>
     {['custom', 'deepseek'].map(kind => {
      const rows = value.profiles.filter(v => (v.provider || (v.baseUrl.includes('deepseek.com') ? 'deepseek' : 'custom')) === kind),
       title = kind === 'deepseek' ? 'DeepSeek' : '自定义模型提供商'
      if (search && !title.toLowerCase().includes(search.toLowerCase()) && !rows.some(v => v.name.toLowerCase().includes(search.toLowerCase()))) return null
      return (
       <button className={'provider-tile ' + (provider === kind && p ? 'selected' : '')} key={kind} disabled={busy} onClick={() => (rows[0] ? select(rows[0].id) : add(kind))}>
        {kind === 'deepseek' ? (
         <img src={deepseekIcon} />
        ) : (
         <span className="provider-cube">
          <ModelNavIcon />
         </span>
        )}
        <span>
         <b>{title}</b>
         <small>{kind === 'deepseek' ? '官方 API' : '添加并配置自定义模型提供商。'}</small>
        </span>
       </button>
      )
     })}
    </div>
    <div className="library-import">
     <div className="settings-links">{navigation}</div>
     <label className="api-import">
      导入 API 配置
      <input
       type="file"
       accept=".json,application/json"
       disabled={busy}
       aria-label="导入 API 配置"
       onChange={e => {
        const file = e.target.files?.[0]
        e.target.value = ''
        if (file) void importConfig(file)
       }}
      />
     </label>
     <button disabled={busy} onClick={() => add()}>
      ＋ 添加 API 配置
     </button>
    </div>
   </aside>
   <main className="model-config-page">
    <header className="model-config-header">
     <h1>模型配置</h1>
     <div>
      <button disabled={busy} onClick={close}>
       取消
      </button>
      <button className="primary" aria-label="保存设置" disabled={busy} onClick={save}>
       保存配置
      </button>
     </div>
    </header>
    {error && (
     <div className="model-notice alert" role="alert">
      {error}
     </div>
    )}
    {saved && (
     <p className="model-notice" role="status">
      已保存 · 当前 API 配置已启用
     </p>
    )}
    {notice && (
     <p className="model-notice" role="status">
      {notice}
     </p>
    )}
    {p ? (
     <>
      <section className="provider-hero">
       {provider === 'deepseek' ? (
        <img src={deepseekIcon} />
       ) : (
        <span className="hero-cube">
         <ModelNavIcon />
        </span>
       )}
       <div>
        <span className="provider-tag">{provider === 'deepseek' ? '官方 API' : '自定义'}</span>
        <h2>{provider === 'deepseek' ? 'DeepSeek' : p.name || '自定义模型提供商'}</h2>
        <p>{provider === 'deepseek' ? '官方 API' : '配置 OpenAI 兼容模型服务'}</p>
       </div>
      </section>
      <section className="model-basic">
       <h3>基础配置</h3>
       <div className="model-two-cols">
        <label>
         配置名称
         <input aria-label="配置名称" disabled={busy} value={p.name} onChange={e => patch({name: e.target.value})} />
        </label>
        <label>
         配置版本
         <div className="version-controls">
          <select aria-label="服务配置" disabled={busy} value={p.id} onChange={e => select(e.target.value)}>
           {versions.map(v => (
            <option key={v.id} value={v.id}>
             {v.name}
            </option>
           ))}
          </select>
          <button disabled={busy} aria-label="添加配置版本" onClick={() => add(provider)}>
           ＋
          </button>
          <button
           aria-label="删除配置版本"
           disabled={busy}
           onClick={() => {
            const profiles = value.profiles.filter(v => v.id !== p.id)
            update({profiles, activeProfile: profiles[0]?.id || ''})
            setSelected(profiles[0]?.id || '')
           }}
          >
           ♲
          </button>
         </div>
        </label>
       </div>
       <label>
        接口格式
        <select aria-label="接口格式" disabled={busy} value={p.apiFormat || 'chat_completions'} onChange={e => patch({apiFormat: e.target.value as Profile['apiFormat']})}>
         <option value="chat_completions">Chat Completions</option>
         <option value="responses">Responses</option>
        </select>
       </label>
       <p className="hint">PPT/PPTX 原文件上传自动使用同一服务地址的 Responses 接口；普通对话按此处配置。服务商需支持 PPT 文件输入。</p>
       <label>
        API 地址
        <input aria-label="Base URL（包含 /v1 等前缀）" disabled={busy} value={p.baseUrl} placeholder="https://服务地址/v1" onChange={e => patch({baseUrl: e.target.value})} />
       </label>
       <label>
        API Key
        <div className="key-control">
         <input
          aria-label="API Key"
          autoComplete="off"
          disabled={busy}
          type={revealed !== null ? 'text' : 'password'}
          value={p.apiKey || revealed || (!keyFocused && p.hasKey ? '•'.repeat(p.keyLength || 8) : '')}
          onFocus={() => setKeyFocused(true)}
          onBlur={() => setKeyFocused(false)}
          placeholder={p.hasKey ? '已保存，留空保留' : provider === 'deepseek' ? '填写 DeepSeek API Key' : '填写 API Key'}
          onChange={e => patch({apiKey: e.target.value || undefined})}
         />
         <button disabled={busy || (!p.hasKey && !p.apiKey)} aria-label={revealed !== null ? '隐藏 API Key' : '显示 API Key'} onClick={() => void reveal()}>
          {eye}
         </button>
        </div>
       </label>
       <label>
        模型列表
        <div className="model-picker-actions">
         <select aria-label="模型列表" disabled={busy} value={p.model} onChange={e => patch({model: e.target.value})}>
          {[...new Set([p.model, ...(p.models || [])])].map(id => (
           <option key={id} value={id}>
            {id || '请选择或添加模型'}
           </option>
          ))}
         </select>
         <button
          disabled={busy}
          onClick={() => {
           setManual(!manual)
           setManualName(p.model)
          }}
         >
          ＋ 添加模型
         </button>
         <button aria-label="读取模型" disabled={busy} onClick={() => void readModels()}>
          ↓ 读取模型
         </button>
         <button aria-label="测试连接" disabled={busy} onClick={() => void test()}>
          ♧ 测试连接
         </button>
        </div>
       </label>
       {manual && (
        <div className="manual-model">
         <input aria-label="模型名" disabled={busy} value={manualName} placeholder="填写服务商提供的完整模型 ID" onChange={e => setManualName(e.target.value)} />
         <button
          disabled={busy || !manualName.trim()}
          onClick={() => {
           const model = manualName.trim()
           patch({model, models: [...new Set([...(p.models || []), model])]})
           setManual(false)
          }}
         >
          添加并使用
         </button>
         <button onClick={() => setManual(false)}>取消</button>
        </div>
       )}
      </section>
      <section className="model-parameters">
       <div className="parameter-heading">
        <h3>模型参数</h3>
        <small>仅作用于 {p.model || '选中的模型'}</small>
       </div>
       <div className="parameter-grid">
        <label>
         单次最大输出
         <input aria-label="单次最大输出" disabled={busy} type="number" min="1" value={parameters.maxTokens ?? ''} placeholder="自动" onChange={e => parameter('maxTokens', e.target.value)} />
        </label>
        <label>
         推理强度
         <select disabled={busy} aria-label="推理强度" value={parameters.reasoningEffort || ''} onChange={e => parameter('reasoningEffort', e.target.value)}>
          {reasoningOptions.map(o => (
           <option key={o.value} value={o.value}>
            {o.label}
           </option>
          ))}
         </select>
        </label>
        <label>
         温度 <small>0–2</small>
         <input disabled={busy} aria-label="温度" type="number" min="0" max="2" step="0.1" value={parameters.temperature ?? ''} placeholder="上游默认" onChange={e => parameter('temperature', e.target.value)} />
        </label>
        <label>
         Top P <small>0–1</small>
         <input disabled={busy} aria-label="Top P" type="number" min="0" max="1" step="0.1" value={parameters.topP ?? ''} placeholder="上游默认" onChange={e => parameter('topP', e.target.value)} />
        </label>
       </div>
      </section>
     </>
    ) : (
     <div className="model-empty">
      <h2>添加模型提供商</h2>
      <p>在左侧选择服务商，或点击 ＋ 新建配置。</p>
     </div>
    )}
   </main>
  </div>
 )
}
