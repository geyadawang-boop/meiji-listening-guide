import {useEffect, useState} from 'react'
import {Button, Card, Checkbox, Chip, Input, TextArea} from '@heroui/react'
import {WindowMenuButton, WindowPanel} from '@renderer/ui/WindowPanel'
import ReactMarkdown from 'react-markdown'
import {LearningRecords} from '@renderer/features/tools/LearningRecords'
import {SavedLearningNotes} from '@renderer/features/tools/SavedLearningNotes'
import {notify} from '@renderer/ui/ToastHost'
import {SettingsLink} from '@renderer/app/settings-navigation'
import remarkGfm from 'remark-gfm'
import type {Settings} from '@shared/types'
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
const statusColor = (status: string): 'default' | 'accent' | 'success' | 'warning' | 'danger' => {
 if (status === 'completed') return 'success'
 if (status === 'failed') return 'danger'
 if (['running', 'verifying', 'requesting'].includes(status)) return 'accent'
 if (['paused', 'unknown', 'legacy_saved'].includes(status)) return 'warning'
 return 'default'
}
function StatusChip({status, suffix = ''}: {status: string; suffix?: string}) {
 return (
  <Chip color={statusColor(status)} size="sm" variant="soft">
   {(labels[status] || status) + suffix}
  </Chip>
 )
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
  [busy, setBusy] = useState(false)
 const [retryConsent, setRetryConsent] = useState<string[]>([]),
  [settings, setSettings] = useState<Settings>(),
  [fulltextTargets, setFulltextTargets] = useState('')
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
  try {
   await fn()
   await refresh()
  } catch (reason) {
   notify.error(reason)
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
  const timer = setInterval(
   () =>
    void refresh().catch(reason =>
     notify.error(reason, {title: '刷新研究任务失败', key: 'tools:refresh', dedupeWindow: 10000})
    ),
   2000
  )
  return () => clearInterval(timer)
 }, [visible, data?.tasks.map(task => task.status).join(), data?.workflows.map(task => task.status).join()])
 useEffect(() => {
  void invoke<Settings>('settings:get')
   .then(setSettings)
   .catch(reason => notify.error(reason, {title: '读取设置失败'}))
 }, [])
 const provider = settings?.searchProvider ?? 'duckduckgo'
 const toggle = (value: string, list: string[], set: (values: string[]) => void) =>
  set(list.includes(value) ? list.filter(item => item !== value) : [...list, value])
 return (
  <WindowPanel
   visible={visible}
   label="研究"
   title="研究"
   description={
    <>
     从知识库与外部来源研究，
     <br />
     保存可核对的研究笔记。
    </>
   }
   heading={tab}
   subheading={
    <>
     使用梅酱当前连接的模型 <SettingsLink section="qwen">模型设置</SettingsLink>
    </>
   }
   menu={['研究与工作流', '知识会话', '研究笔记'].map(name => (
    <WindowMenuButton key={name} active={tab === name} onSelect={() => setTab(name)}>
     {name}
    </WindowMenuButton>
   ))}
   actions={
    <Button variant="ghost" size="sm" isDisabled={busy} onPress={() => void run(refresh)}>
     刷新
    </Button>
   }
   close={close}
  >
   {tab === '研究与工作流' && data && (
    <>
     <Card className="knowledge-card">
      <h3>本次资料范围</h3>
      <div className="row">
       <Input
        placeholder="查找知识库资料"
        aria-label="查找研究资料"
        value={query}
        onChange={e => setQuery(e.target.value)}
       />
       <Button variant="tertiary" size="sm" isDisabled={busy} onClick={() => void run(() => loadMaterials())}>
        查找
       </Button>
      </div>
      <div className="discussion-list">
       {materials.map(material => (
        <Checkbox
         className="media-check"
         key={material.binding.bvid}
         isSelected={chosen.some(item => item.binding.bvid === material.binding.bvid)}
         isDisabled={busy || (chosen.length >= 6 && !chosen.some(item => item.binding.bvid === material.binding.bvid))}
         onChange={() =>
          setChosen(old =>
           old.some(item => item.binding.bvid === material.binding.bvid)
            ? old.filter(item => item.binding.bvid !== material.binding.bvid)
            : [...old, material]
          )
         }
        >
         <Checkbox.Content>
          <Checkbox.Control>
           <Checkbox.Indicator />
          </Checkbox.Control>
          {material.title}
          <small>{material.kind}</small>
         </Checkbox.Content>
        </Checkbox>
       ))}
      </div>
      {offset !== null && (
       <Button variant="ghost" size="sm" isDisabled={busy} onClick={() => void run(() => loadMaterials(offset))}>
        更多资料
       </Button>
      )}
      <p className="hint">
       已选 {chosen.length} 份；不选时可搜索当前资料库。最多六份，选择在翻页时保留，来源改变会要求重新选择。
      </p>
      <TextArea
       aria-label="研究问题"
       placeholder="希望依据这些资料解决什么问题？"
       value={question}
       maxLength={flow ? 800 : 1500}
       onChange={e => setQuestion(e.target.value)}
      />
      <Checkbox className="media-check" isSelected={flow} onChange={setFlow}>
       <Checkbox.Content>
        <Checkbox.Control>
         <Checkbox.Indicator />
        </Checkbox.Control>
        两步工作流：先整理材料，再综合回答
       </Checkbox.Content>
      </Checkbox>
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
         <Checkbox
          className="media-check"
          key={id}
          isSelected={channels.includes(id)}
          onChange={() => toggle(id, channels, setChannels)}
         >
          <Checkbox.Content>
           <Checkbox.Control>
            <Checkbox.Indicator />
           </Checkbox.Control>
           {label}
          </Checkbox.Content>
         </Checkbox>
        ))}
       </div>
      )}
      {!flow && (
       <p className="hint">
        网页搜索服务与 SearXNG 地址在 <SettingsLink section="search">搜索设置</SettingsLink>。
       </p>
      )}
      {!flow && (channels.includes('web_pages') || channels.includes('arxiv_fulltext')) && (
       <label>
        本轮正文网址
        <TextArea
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
        <h4>
         本轮方法 <SettingsLink section="methods">管理方法</SettingsLink>
        </h4>
        {data.extensions.skills
         .filter(skill => skill.enabled)
         .map(skill => (
          <Checkbox
           className="media-check"
           key={skill.id}
           isSelected={skills.includes(skill.id)}
           onChange={() => toggle(skill.id, skills, setSkills)}
          >
           <Checkbox.Content>
            <Checkbox.Control>
             <Checkbox.Indicator />
            </Checkbox.Control>
            {skill.name}
           </Checkbox.Content>
          </Checkbox>
         ))}
        <h4>
         本轮外部工具 <SettingsLink section="mcp">管理 MCP</SettingsLink>
        </h4>
        {data.mcp.servers
         .filter(server => server.enabled)
         .flatMap(server =>
          server.allowed_tools.map(name => (
           <Checkbox
            className="media-check"
            key={server.id + name}
            isSelected={mcp.includes(server.id + ':' + name)}
            onChange={() => toggle(server.id + ':' + name, mcp, setMcp)}
           >
            <Checkbox.Content>
             <Checkbox.Control>
              <Checkbox.Indicator />
             </Checkbox.Control>
             {server.name} · {name}
            </Checkbox.Content>
           </Checkbox>
          ))
         )}
       </>
      )}
      <p className="hint">
       点击开始才将已选资料交给当前模型。研究 Agent
       最多八轮，只执行勾选渠道和工具；来源存在性核验不等于结论正确。两步工作流保留每一步结果，失败后可继续。
      </p>
      <Button
       variant="primary"
       size="sm"
       isDisabled={busy || !question.trim() || (flow && !chosen.length) || (!flow && !channels.length)}
       onClick={() =>
        void run(() =>
         request(flow ? 'workflow-create' : 'agent-create', {
          op: op(),
          question,
          channels,
          web_search: provider === 'searxng' ? {provider, endpoint: settings?.searchEndpoint ?? ''} : {provider},
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
      </Button>
     </Card>
     {data.workflows.map(task => (
      <Card className="knowledge-card" key={task.workflow_id}>
       <h3>{task.question}</h3>
       <StatusChip status={task.status} />
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
        <Button
         variant="tertiary"
         size="sm"
         isDisabled={busy}
         onClick={() => {
          setQuestion(task.question)
          setChosen([])
          setFlow(true)
          notify.info('已载入原问题，请重新选择当前资料，再创建工作流')
         }}
        >
         用当前资料重建工作流
        </Button>
       )}
       {!['completed', 'legacy_saved'].includes(task.status) && (
        <Button
         variant="tertiary"
         size="sm"
         isDisabled={busy || (task.outcome_unknown && !retryConsent.includes(task.workflow_id))}
         onClick={() =>
          void run(() =>
           request('workflow-action', {
            id: task.workflow_id,
            op: op(),
            revision: task.revision,
            fence: task.fence,
            retry_unknown: task.status !== 'running' && task.outcome_unknown && retryConsent.includes(task.workflow_id),
            kind: task.status === 'running' ? 'stop' : 'resume'
           })
          )
         }
        >
         {task.status === 'running' ? '停止工作流' : '继续工作流'}
        </Button>
       )}
       {task.outcome_unknown && (
        <Checkbox
         className="media-check"
         isSelected={retryConsent.includes(task.workflow_id)}
         onChange={() => toggle(task.workflow_id, retryConsent, setRetryConsent)}
        >
         <Checkbox.Content>
          <Checkbox.Control>
           <Checkbox.Indicator />
          </Checkbox.Control>
          已核对保存记录，同意重新请求未确认的步骤（可能再次消耗模型额度）
         </Checkbox.Content>
        </Checkbox>
       )}
       {['completed', 'legacy_saved'].includes(task.status) && (
        <Button
         variant="tertiary"
         size="sm"
         isDisabled={busy}
         onClick={() =>
          void run(async () => {
           const path = await request<string>('workflow-export', {id: task.workflow_id})
           await invoke('library:reveal', {path})
           notify.success(
            task.status === 'legacy_saved' ? '历史工作流已导出，来源仍待重新核验' : '工作流成果已保存并核验',
            {description: path, timeout: 6000}
           )
          })
         }
        >
         保存工作流成果
        </Button>
       )}
      </Card>
     ))}
     {data.tasks.map(task => (
      <Card className="knowledge-card" key={task.task_id}>
       <header>
        <h3>{task.question}</h3>
        <span>
         <StatusChip status={task.status} suffix={` · ${task.turns}/8 轮`} />
        </span>
       </header>
       {task.status === 'running' && (
        <Button variant="tertiary" size="sm" onClick={() => void run(() => request('agent-stop', {id: task.task_id}))}>
         停止研究
        </Button>
       )}
       {task.error_code && (
        <p className="hint" role="alert">
         {task.error_code}
        </p>
       )}
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
        <Button
         variant="tertiary"
         size="sm"
         onClick={() =>
          void run(async () => {
           const path = await request<string>('agent-export', {id: task.task_id})
           await invoke('library:open-file', {path})
           notify.success('已保存并核验研究 Markdown', {description: path, timeout: 6000})
          })
         }
        >
         保存研究成果
        </Button>
       )}
      </Card>
     ))}
    </>
   )}
   {tab === '研究笔记' && <SavedLearningNotes />}
   {tab === '知识会话' && <LearningRecords />}
  </WindowPanel>
 )
}
