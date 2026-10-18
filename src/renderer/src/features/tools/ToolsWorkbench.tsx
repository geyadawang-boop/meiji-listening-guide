import {useEffect, useState} from 'react'
import {Wrench} from 'lucide-react'
import {RuntimePanel} from '@renderer/features/tools/RuntimePanel'
import ReactMarkdown from 'react-markdown'
import {LearningRecords} from '@renderer/features/tools/LearningRecords'
import {SavedLearningNotes} from '@renderer/features/tools/SavedLearningNotes'
import remarkGfm from 'remark-gfm'
function Result({text}: {text: string}) {
 return (
  <div className="learning-summary">
   <ReactMarkdown
    remarkPlugins={[remarkGfm]}
    components={{
     a: ({href, children}) => (
      <a
       href={href}
       onClick={e => {
        e.preventDefault()
        if (href) void window.assistant.invoke('external', {url: href})
       }}
      >
       {children}
      </a>
     )
    }}
   >
    {text}
   </ReactMarkdown>
  </div>
 )
}
type Skill = {id: string; name: string; description: string; body: string; enabled: boolean}
type Server = {
 id: string
 name: string
 endpoint: string
 enabled: boolean
 allowed_tools: string[]
 tools: {name: string; description: string; read_only_declared: boolean; input_schema: unknown}[]
}
type Agent = {
 task_id: string
 question: string
 status: string
 note: string
 limitations: string
 error_code?: string
 turns: number
 events: {kind: string; message?: string}[]
 sources: {source_id: string; title: string; read: boolean; text: string; url: string}[]
}
type Flow = {
 workflow_id: string
 question: string
 status: string
 revision: number
 fence: number
 outcome_unknown: boolean
 notice?: string
 steps: {name: string; status: string; answer: string}[]
}
type Overview = {
 root: string
 extensions: {
  revision: number
  skills: Skill[]
  standing_instructions: {enabled: boolean; body: string}
  plugins: {id: string; name: string; enabled: boolean; description: string}[]
 }
 mcp: {revision: number; servers: Server[]}
 tasks: Agent[]
 workflows: Flow[]
 runtime: {dependencies: {id: string; label: string; state: string; version?: string}[]}
}
type Material = {binding: {bvid: string; [key: string]: unknown}; title: string; kind: string}
const invoke = <T,>(action: string, args?: unknown) => window.assistant.invoke<T>(action, args)
const request = <T,>(action: string, args: unknown = {}) => invoke<T>('tools:request', {action, args})
const op = () => crypto.randomUUID().replaceAll('-', '')
const labels: Record<string, string> = {
 legacy_saved: '旧保存记录（待重新核验）',
 running: '正在运行',
 completed: '已完成',
 stopped: '已停止',
 failed: '失败',
 paused: '待继续',
 unknown: '结果待确认',
 pending: '待运行',
 verifying: '核验来源',
 requesting: '正在分析'
}
export function ToolsWorkbench({visible, close}: {visible: boolean; close: () => void}) {
 const [tab, setTab] = useState('研究与工作流'),
  [data, setData] = useState<Overview>(),
  [materials, setMaterials] = useState<Material[]>([]),
  [chosen, setChosen] = useState<Material[]>([]),
  [offset, setOffset] = useState<number | null>(0),
  [query, setQuery] = useState(''),
  [question, setQuestion] = useState(''),
  [channels, setChannels] = useState<string[]>(['library']),
  [skills, setSkills] = useState<string[]>([]),
  [mcp, setMcp] = useState<string[]>([]),
  [flow, setFlow] = useState(false),
  [error, setError] = useState(''),
  [busy, setBusy] = useState(false),
  [saved, setSaved] = useState('')
 const [retryConsent, setRetryConsent] = useState<string[]>([]),
  [webProvider, setWebProvider] = useState('duckduckgo'),
  [webEndpoint, setWebEndpoint] = useState(''),
  [fulltextTargets, setFulltextTargets] = useState('')
 const [skillName, setSkillName] = useState(''),
  [description, setDescription] = useState(''),
  [body, setBody] = useState(''),
  [editing, setEditing] = useState<string | null>(null),
  [rules, setRules] = useState(''),
  [rulesEnabled, setRulesEnabled] = useState(false),
  [serverName, setServerName] = useState(''),
  [endpoint, setEndpoint] = useState('')
 async function refresh() {
  const next = await request<Overview>('overview')
  setData(next)
 }
 async function loadMaterials(start = 0) {
  const result = await request<{items: Material[]; next_offset: number | null}>('materials', {query, offset: start})
  setMaterials(start ? old => [...old, ...result.items] : result.items)
  setOffset(result.next_offset)
 }
 async function run(fn: () => Promise<unknown>) {
  setBusy(true)
  setError('')
  setSaved('')
  try {
   await fn()
   await refresh()
  } catch (reason) {
   setError(reason instanceof Error ? reason.message : String(reason))
  } finally {
   setBusy(false)
  }
 }
 useEffect(() => {
  if (visible)
   void run(async () => {
    await refresh()
    await loadMaterials()
   })
 }, [visible])
 useEffect(() => {
  if (
   !visible ||
   !data ||
   (!data.tasks.some(task => task.status === 'running') && !data.workflows.some(task => task.status === 'running'))
  )
   return
  const timer = setInterval(() => void refresh().catch(reason => setError(String(reason))), 2000)
  return () => clearInterval(timer)
 }, [visible, data?.tasks.map(task => task.status).join(), data?.workflows.map(task => task.status).join()])
 const toggle = (value: string, list: string[], set: (values: string[]) => void) =>
  set(list.includes(value) ? list.filter(item => item !== value) : [...list, value])
 const editExtension = (change: unknown) =>
  request('extension-change', {op: op(), revision: data!.extensions.revision, change})
 const editServer = (server: Server, allowed: string[], enabled: boolean) =>
  request('mcp-change', {
   op: op(),
   revision: data!.mcp.revision,
   change: {
    kind: 'server',
    id: server.id,
    name: server.name,
    endpoint: server.endpoint,
    allowed_tools: allowed,
    enabled
   }
  })
 return (
  <section
   className="ppt-extract-page learning-window"
   aria-label="工具与工作流"
   hidden={!visible}
   style={!visible ? {display: 'none'} : undefined}
  >
   <aside className="learning-menu">
    <h2>工具与工作流</h2>
    <p>
     按所选来源研究，
     <br />
     管理方法和外部工具。
    </p>
    {['研究与工作流', '学习记录', '我的笔记', '学习方法', 'MCP 工具', '运行环境'].map(name => (
     <button key={name} className={tab === name ? 'active' : ''} onClick={() => setTab(name)}>
      {name}
     </button>
    ))}
    <button className="d-btn d-btn-ghost" onClick={close}>
     返回课程对话
    </button>
   </aside>
   <main className="learning-content">
    <header>
     <div>
      <h2>{tab}</h2>
      <p>使用梅酱当前连接的模型 · 在应用内完成操作</p>
     </div>
     <button className="d-btn d-btn-ghost" disabled={busy} onClick={() => void run(refresh)}>
      刷新
     </button>
    </header>
    {error && (
     <p className="alert" role="alert">
      {error}
     </p>
    )}
    {saved && <p role="status">{saved}</p>}
    {tab === '研究与工作流' && data && (
     <>
      <section className="knowledge-card">
       <h3>本次资料范围</h3>
       <div className="row">
        <input
         placeholder="查找知识库资料"
         aria-label="查找研究资料"
         value={query}
         onChange={e => setQuery(e.target.value)}
        />
        <button className="d-btn" disabled={busy} onClick={() => void run(() => loadMaterials())}>
         查找
        </button>
       </div>
       <div className="discussion-list">
        {materials.map(material => (
         <label className="media-check" key={material.binding.bvid}>
          <input
           type="checkbox"
           checked={chosen.some(item => item.binding.bvid === material.binding.bvid)}
           disabled={busy || (chosen.length >= 6 && !chosen.some(item => item.binding.bvid === material.binding.bvid))}
           onChange={() =>
            setChosen(old =>
             old.some(item => item.binding.bvid === material.binding.bvid)
              ? old.filter(item => item.binding.bvid !== material.binding.bvid)
              : [...old, material]
            )
           }
          />
          {material.title}
          <small>{material.kind}</small>
         </label>
        ))}
       </div>
       {offset !== null && (
        <button className="d-btn d-btn-ghost" disabled={busy} onClick={() => void run(() => loadMaterials(offset))}>
         更多资料
        </button>
       )}
       <p className="hint">
        已选 {chosen.length} 份；不选时可搜索当前资料库。最多六份，选择在翻页时保留，来源改变会要求重新选择。
       </p>
       <textarea
        aria-label="研究问题"
        placeholder="希望依据这些资料解决什么问题？"
        value={question}
        maxLength={flow ? 800 : 1500}
        onChange={e => setQuestion(e.target.value)}
       />
       <label className="media-check">
        <input type="checkbox" checked={flow} onChange={e => setFlow(e.target.checked)} />
        两步工作流：先整理材料，再综合回答
       </label>
       {!flow && (
        <div className="row">
         {[
          ['library', '知识库'],
          ['web', '网页搜索（后台）'],
          ['web_pages', '所选网页正文'],
          ['arxiv', 'arXiv'],
          ['arxiv_fulltext', '所选论文页'],
          ['crossref', 'Crossref'],
          ['semantic', 'Semantic Scholar'],
          ['notes', '已保存笔记'],
          ['memory', '学习记忆'],
          ['practice', '练习题'],
          ['organize', '分类建议'],
          ['conversations', '历史问答']
         ].map(([id, label]) => (
          <label className="media-check" key={id}>
           <input type="checkbox" checked={channels.includes(id)} onChange={() => toggle(id, channels, setChannels)} />
           {label}
          </label>
         ))}
        </div>
       )}
       {!flow && channels.includes('web') && (
        <div className="row">
         <label>
          搜索服务
          <select aria-label="搜索服务" value={webProvider} onChange={e => setWebProvider(e.target.value)}>
           <option value="duckduckgo">DuckDuckGo</option>
           <option value="searxng">SearXNG</option>
          </select>
         </label>
         {webProvider === 'searxng' && (
          <input
           aria-label="搜索实例地址"
           placeholder="公开 HTTPS 实例地址"
           value={webEndpoint}
           onChange={e => setWebEndpoint(e.target.value)}
          />
         )}
        </div>
       )}
       {!flow && (channels.includes('web_pages') || channels.includes('arxiv_fulltext')) && (
        <label>
         本轮正文网址
         <textarea
          aria-label="本轮正文网址"
          value={fulltextTargets}
          onChange={e => setFulltextTargets(e.target.value)}
          maxLength={9000}
          placeholder={
           '每行一个公开 HTTPS 网址；论文须固定版本并指定物理页。\nhttps://arxiv.org/abs/1706.03762v7 | 1,2\nhttps://example.com/article'
          }
         />
         <small>最多四个网址；至多两篇论文、每篇四页。仅后台读取所填网址，不自动浏览其他页面。</small>
        </label>
       )}
       {!flow && (
        <>
         <h4>本轮方法</h4>
         {data.extensions.skills
          .filter(skill => skill.enabled)
          .map(skill => (
           <label className="media-check" key={skill.id}>
            <input
             type="checkbox"
             checked={skills.includes(skill.id)}
             onChange={() => toggle(skill.id, skills, setSkills)}
            />
            {skill.name}
           </label>
          ))}
         <h4>本轮外部工具</h4>
         {data.mcp.servers
          .filter(server => server.enabled)
          .flatMap(server =>
           server.allowed_tools.map(name => (
            <label key={server.id + name} className="media-check">
             <input
              type="checkbox"
              checked={mcp.includes(server.id + ':' + name)}
              onChange={() => toggle(server.id + ':' + name, mcp, setMcp)}
             />
             {server.name} · {name}
            </label>
           ))
          )}
        </>
       )}
       <p className="hint">
        点击开始才将已选资料交给当前模型。研究 Agent
        最多八轮，只执行勾选渠道和工具；来源存在性核验不等于结论正确。两步工作流保留每一步结果，失败后可继续。
       </p>
       <button
        className="d-btn d-btn-primary"
        disabled={busy || !question.trim() || (flow && !chosen.length) || (!flow && !channels.length)}
        onClick={() =>
         void run(() =>
          request(flow ? 'workflow-create' : 'agent-create', {
           op: op(),
           question,
           channels,
           web_search:
            webProvider === 'searxng' ? {provider: webProvider, endpoint: webEndpoint} : {provider: webProvider},
           fulltext: fulltextTargets.trim()
            ? fulltextTargets
               .trim()
               .split(/\r?\n/)
               .filter(line => line.trim())
               .map(line => {
                const [url, pages, ...extra] = line.split('|').map(value => value.trim())
                if (extra.length) throw new Error('正文网址格式无效')
                return {url, ...(pages ? {pages: pages.split(/[,，]/).map(value => Number(value.trim()))} : {})}
               })
            : [],
           materials: chosen.map(item => item.binding),
           skills: {revision: data.extensions.revision, ids: skills},
           mcp: {
            revision: data.mcp.revision,
            items: mcp.map(value => {
             const [server_id, name] = value.split(':')
             return {server_id, tool: name}
            })
           }
          })
         )
        }
       >
        开始研究
       </button>
      </section>
      {data.workflows.map(task => (
       <section className="knowledge-card" key={task.workflow_id}>
        <h3>{task.question}</h3>
        <p>{labels[task.status] || task.status}</p>
        {task.steps.map(step => (
         <details key={step.name} open={!!step.answer}>
          <summary>
           {step.name} · {labels[step.status] || step.status}
          </summary>
          <Result text={step.answer} />
         </details>
        ))}
        {task.notice && <p className="hint">{task.notice}</p>}
        {task.status === 'legacy_saved' && (
         <button
          className="d-btn"
          disabled={busy}
          onClick={() => {
           setQuestion(task.question)
           setChosen([])
           setFlow(true)
           setSaved('已载入原问题，请重新选择当前资料，再创建工作流')
          }}
         >
          用当前资料重建工作流
         </button>
        )}
        {!['completed', 'legacy_saved'].includes(task.status) && (
         <button
          className="d-btn"
          disabled={busy || (task.outcome_unknown && !retryConsent.includes(task.workflow_id))}
          onClick={() =>
           void run(() =>
            request('workflow-action', {
             id: task.workflow_id,
             op: op(),
             revision: task.revision,
             fence: task.fence,
             retry_unknown:
              task.status !== 'running' && task.outcome_unknown && retryConsent.includes(task.workflow_id),
             kind: task.status === 'running' ? 'stop' : 'resume'
            })
           )
          }
         >
          {task.status === 'running' ? '停止工作流' : '继续工作流'}
         </button>
        )}
        {task.outcome_unknown && (
         <label className="media-check">
          <input
           type="checkbox"
           checked={retryConsent.includes(task.workflow_id)}
           onChange={() => toggle(task.workflow_id, retryConsent, setRetryConsent)}
          />
          已核对保存记录，同意重新请求未确认的步骤（可能再次消耗模型额度）
         </label>
        )}
        {['completed', 'legacy_saved'].includes(task.status) && (
         <button
          className="d-btn"
          disabled={busy}
          onClick={() =>
           void run(async () => {
            const path = await request<string>('workflow-export', {id: task.workflow_id})
            await invoke('library:reveal', {path})
            setSaved(task.status === 'legacy_saved' ? '历史工作流已导出，来源仍待重新核验' : '工作流成果已保存并核验')
           })
          }
         >
          保存工作流成果
         </button>
        )}
       </section>
      ))}
      {data.tasks.map(task => (
       <section className="knowledge-card" key={task.task_id}>
        <header>
         <h3>{task.question}</h3>
         <span>
          {labels[task.status] || task.status} · {task.turns}/8 轮
         </span>
        </header>
        {task.status === 'running' && (
         <button className="d-btn" onClick={() => void run(() => request('agent-stop', {id: task.task_id}))}>
          停止研究
         </button>
        )}
        {task.error_code && <p className="alert">{task.error_code}</p>}
        {task.note && <Result text={task.note} />}
        {task.limitations && <p className="hint">{task.limitations}</p>}
        <details>
         <summary>处理过程与来源</summary>
         {task.events.map((event, index) => (
          <p key={index}>{event.message || event.kind}</p>
         ))}
         {task.sources.map(source => (
          <details key={source.source_id}>
           <summary>
            {source.source_id} · {source.title} · {source.read ? '已读取' : '尚未读取'}
           </summary>
           <p>{source.url}</p>
           <p className="knowledge-text">{source.text}</p>
          </details>
         ))}
        </details>
        {task.status === 'completed' && (
         <button
          className="d-btn"
          onClick={() =>
           void run(async () => {
            const path = await request<string>('agent-export', {id: task.task_id})
            await invoke('library:open-file', {path})
            setSaved('已保存并核验研究 Markdown')
           })
          }
         >
          保存研究成果
         </button>
        )}
       </section>
      ))}
     </>
    )}
    {tab === '我的笔记' && <SavedLearningNotes />}
    {tab === '学习记录' && <LearningRecords />}
    {tab === '学习方法' && data && (
     <>
      <button
       className="d-btn"
       disabled={busy}
       onClick={() =>
        void run(async () => {
         const value = await invoke<{name: string; description: string; body: string} | null>('tools:skill-open')
         if (value) {
          setEditing(null)
          setSkillName(value.name)
          setDescription(value.description)
          setBody(value.body)
          setSaved('方法已读入，请核对后点击保存方法')
         }
        })
       }
      >
       导入 Skill.md
      </button>
      <section className="knowledge-card">
       <h3>固定学习要求</h3>
       <button
        className="d-btn"
        onClick={() => {
         setRules(data.extensions.standing_instructions.body)
         setRulesEnabled(data.extensions.standing_instructions.enabled)
        }}
       >
        读取现有要求
       </button>
       <textarea aria-label="固定学习要求" maxLength={4000} value={rules} onChange={e => setRules(e.target.value)} />
       <label className="media-check">
        <input type="checkbox" checked={rulesEnabled} onChange={e => setRulesEnabled(e.target.checked)} />
        在后续任务中启用
       </label>
       <button
        className="d-btn"
        disabled={busy}
        onClick={() => void run(() => editExtension({kind: 'instructions', enabled: rulesEnabled, body: rules}))}
       >
        保存要求
       </button>
      </section>
      <section className="knowledge-card">
       <h3>{editing ? '编辑学习方法' : '添加学习方法（Skill）'}</h3>
       <input
        aria-label="方法名称"
        placeholder="英文短名，例如 compare-sources"
        value={skillName}
        onChange={e => setSkillName(e.target.value)}
       />
       <input
        aria-label="方法说明"
        placeholder="方法说明"
        value={description}
        onChange={e => setDescription(e.target.value)}
       />
       <textarea
        aria-label="方法正文"
        placeholder="具体学习步骤；不会执行其中的系统命令"
        maxLength={6000}
        value={body}
        onChange={e => setBody(e.target.value)}
       />
       <button
        className="d-btn"
        disabled={busy || !skillName || !description || !body}
        onClick={() =>
         void run(async () => {
          await editExtension({kind: 'skill', id: editing, name: skillName, description, body, enabled: true})
          setEditing(null)
          setBody('')
          setSkillName('')
          setDescription('')
         })
        }
       >
        保存方法
       </button>
      </section>
      {data.extensions.skills.map(skill => (
       <section className="knowledge-card" key={skill.id}>
        <h3>{skill.name}</h3>
        <p>{skill.description}</p>
        <div className="row">
         <button
          className="d-btn"
          onClick={() => {
           setEditing(skill.id)
           setSkillName(skill.name)
           setDescription(skill.description)
           setBody(skill.body)
          }}
         >
          编辑
         </button>
         <button
          className="d-btn"
          disabled={busy}
          onClick={() =>
           void run(() =>
            editExtension({
             kind: 'skill',
             id: skill.id,
             name: skill.name,
             description: skill.description,
             body: skill.body,
             enabled: !skill.enabled
            })
           )
          }
         >
          {skill.enabled ? '停用' : '启用'}
         </button>
         <button
          className="d-btn d-btn-ghost"
          disabled={busy}
          onClick={() => void run(() => editExtension({kind: 'remove', id: skill.id}))}
         >
          删除方法
         </button>
        </div>
       </section>
      ))}
      <section className="knowledge-card">
       <h3>内置工具组</h3>
       {data.extensions.plugins.map(plugin => (
        <label className="media-check" key={plugin.id}>
         <input
          type="checkbox"
          disabled={busy}
          checked={plugin.enabled}
          onChange={() => void run(() => editExtension({kind: 'plugin', id: plugin.id, enabled: !plugin.enabled}))}
         />
         <span>
          {plugin.name}
          <small>{plugin.description}</small>
         </span>
        </label>
       ))}
      </section>
     </>
    )}
    {tab === 'MCP 工具' && data && (
     <>
      <section className="knowledge-card">
       <p className="hint">
        接入公开 HTTPS MCP
        的只读工具。先读取清单、再勾选允许工具、最后在研究页选择本轮工具；不自动执行远端工具，不支持密钥连接。
       </p>
       <input
        aria-label="MCP名称"
        placeholder="连接名称"
        value={serverName}
        onChange={e => setServerName(e.target.value)}
       />
       <input
        aria-label="MCP地址"
        placeholder="https://.../mcp"
        value={endpoint}
        onChange={e => setEndpoint(e.target.value)}
       />
       <button
        className="d-btn"
        disabled={busy || !serverName || !endpoint}
        onClick={() =>
         void run(async () => {
          await request('mcp-change', {
           op: op(),
           revision: data.mcp.revision,
           change: {kind: 'server', id: null, name: serverName, endpoint, enabled: false, allowed_tools: []}
          })
          setEndpoint('')
          setServerName('')
         })
        }
       >
        添加连接
       </button>
      </section>
      {data.mcp.servers.map(server => (
       <section className="knowledge-card" key={server.id}>
        <h3>{server.name}</h3>
        <p>{server.endpoint}</p>
        <div className="row">
         <button
          className="d-btn"
          disabled={busy}
          onClick={() =>
           void run(() => request('mcp-discover', {op: op(), id: server.id, revision: data.mcp.revision}))
          }
         >
          读取工具清单
         </button>
         <button
          className="d-btn"
          disabled={busy || !server.allowed_tools.length}
          onClick={() => void run(() => editServer(server, server.allowed_tools, !server.enabled))}
         >
          {server.enabled ? '停用连接' : '启用连接'}
         </button>
         <button
          className="d-btn d-btn-ghost"
          disabled={busy}
          onClick={() =>
           void run(() =>
            request('mcp-change', {op: op(), revision: data.mcp.revision, change: {kind: 'remove', id: server.id}})
           )
          }
         >
          删除连接
         </button>
        </div>
        {server.tools.map(tool => (
         <details key={tool.name}>
          <summary>
           <label className="media-check">
            <input
             type="checkbox"
             disabled={busy || !tool.read_only_declared}
             checked={server.allowed_tools.includes(tool.name)}
             onChange={() =>
              void run(() =>
               editServer(
                server,
                server.allowed_tools.includes(tool.name)
                 ? server.allowed_tools.filter(name => name !== tool.name)
                 : [...server.allowed_tools, tool.name],
                false
               )
              )
             }
            />
            {tool.name} · {tool.read_only_declared ? '声明只读' : '未声明只读，禁用'}
           </label>
          </summary>
          <p>{tool.description}</p>
          <pre>{JSON.stringify(tool.input_schema, null, 2)}</pre>
         </details>
        ))}
       </section>
      ))}
     </>
    )}
    {tab === '运行环境' && (
     <section className="knowledge-card">
      <RuntimePanel />
      <p className="hint">组件存在不代表模型已经加载或外部账号可用。</p>
      {data?.runtime.dependencies.map(item => (
       <div className="row" key={item.id}>
        <span>{item.label}</span>
        <span>
         {item.state === 'detected' ? '已找到' : item.state === 'missing' ? '当前环境未找到' : '待检查'}{' '}
         {item.version || ''}
        </span>
       </div>
      ))}
     </section>
    )}
   </main>
  </section>
 )
}
