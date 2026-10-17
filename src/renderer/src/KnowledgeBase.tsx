import {useEffect, useRef, useState} from 'react'
import {KnowledgeClassification} from './KnowledgeClassification'
import type {KnowledgeEntry, KnowledgeList, KnowledgeHit, KnowledgeSearch} from '../../shared/knowledge'
const invoke = <T,>(action: string, args?: unknown) => window.assistant.invoke<T>(action, args)
type Answer = {
 answer: {paragraphs: {text: string; citations: {id: string; quote: string}[]}[]; limitation: string}
 sources: KnowledgeHit[]
}
type VectorState = {
 model: string
 bundled: boolean
 active: boolean
 selection_error: string | null
 index: 'ready' | 'stale' | 'not_built'
 vector_count: number
}
export function KnowledgeIcon() {
 return (
  <svg
   viewBox="0 0 24 24"
   fill="none"
   stroke="currentColor"
   strokeWidth="1.7"
   strokeLinecap="round"
   strokeLinejoin="round"
   aria-hidden="true"
  >
   <path d="M12 5c-3-2-7-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-2-1-6-1-9 1v15M6 8h3m-3 4h3m6-4h3m-3 4h3" />
  </svg>
 )
}
export function KnowledgeBase({visible, close}: {visible: boolean; close: () => void}) {
 const [data, setData] = useState<KnowledgeList>({
  entries: [],
  stats: {totalVideos: 0, totalChunks: 0},
  retrieval: 'keyword'
 })
 const [category, setCategory] = useState(''),
  [importCategory, setImportCategory] = useState(''),
  [query, setQuery] = useState('')
 const [busy, setBusy] = useState(false),
  [error, setError] = useState(''),
  [notice, setNotice] = useState('')
 const [search, setSearch] = useState<KnowledgeSearch | null>(null),
  [answer, setAnswer] = useState<Answer | null>(null)
 const [reading, setReading] = useState<{title: string; text: string} | null>(null),
  [deleting, setDeleting] = useState('')
 const [vector, setVector] = useState<VectorState | null>(null)
 const [progressText, setProgressText] = useState('')
 const [categoryTarget, setCategoryTarget] = useState('')
 const [moving, setMoving] = useState<{entry: KnowledgeEntry; target: string} | null>(null)
 const [facets, setFacets] = useState<Record<string, string>>({})
 const working = useRef(false)
 const entries = data.entries.filter(
  entry =>
   (!category || entry.folder === category) &&
   Object.entries(facets).every(
    ([key, value]) =>
     !value || entry.classification?.[key as keyof NonNullable<KnowledgeEntry['classification']>] === value
   )
 )
 const categories = Array.from(new Set(data.entries.map(entry => entry.folder).filter(Boolean))).sort()
 async function refresh() {
  setData(await invoke<KnowledgeList>('knowledge:list'))
  setVector(await invoke<VectorState>('knowledge:vector-status'))
 }
 useEffect(() => {
  if (visible) void refresh().catch(reason => setError(String(reason)))
 }, [visible])
 useEffect(
  () =>
   window.assistant.onEvent(event => {
    if (working.current && event.kind === 'progress') setProgressText(event.data.message)
   }),
  []
 )
 async function run(fn: () => Promise<void>) {
  if (working.current) return
  working.current = true
  setBusy(true)
  setError('')
  setNotice('')
  setProgressText('')
  try {
   await fn()
  } catch (reason) {
   setError(reason instanceof Error ? reason.message : String(reason))
  } finally {
   working.current = false
   setBusy(false)
  }
 }
 const ids = category || Object.values(facets).some(Boolean) ? entries.map(entry => entry.bvid) : undefined
 async function readCitation(id: string) {
  await run(async () => {
   const source = await invoke<KnowledgeHit>('knowledge:citation', {evidenceId: id})
   setReading({title: source.title, text: source.content})
  })
 }
 async function organize(selected: KnowledgeEntry[], target: string, wholeCategory = false) {
  const result = await invoke<{changed: number; unchanged: number; failures: {title: string; error: string}[]}>(
   'knowledge:organize',
   {target: target.trim(), items: selected.map(entry => ({id: entry.bvid, generation: entry.generation_id}))}
  )
  await refresh()
  setSearch(null)
  setAnswer(null)
  setReading(null)
  setMoving(null)
  setNotice(`已移动 ${result.changed} 份资料，${result.unchanged} 份分类相同；原文件保留。`)
  if (result.failures.length) setError(result.failures.map(item => item.title + '：' + item.error).join('\n'))
  else if (wholeCategory) {
   setCategory(target.trim())
   setCategoryTarget('')
  }
 }
 return (
  <section
   className="learning-window ppt-extract-page knowledge-window"
   aria-label="知识库"
   hidden={!visible}
   style={!visible ? {display: 'none'} : undefined}
  >
   <datalist id="knowledge-categories">
    {categories.map(item => (
     <option key={item} value={item} />
    ))}
   </datalist>
   <aside className="learning-menu">
    <h2>知识库</h2>
    <p>集中保存课程资料，检索原文与引用来源。</p>
    <button
     className={!category ? 'active' : ''}
     onClick={() => {
      setCategory('')
      setSearch(null)
      setAnswer(null)
     }}
    >
     <KnowledgeIcon />
     <span>全部资料 · {data.entries.length}</span>
    </button>
    {categories.map(item => (
     <button
      key={item}
      className={category === item ? 'active' : ''}
      title={item}
      onClick={() => {
       setCategory(item)
       setSearch(null)
       setAnswer(null)
      }}
     >
      <span>{item}</span>
     </button>
    ))}
    <button onClick={close}>
     <span>返回课程对话</span>
    </button>
   </aside>
   <main className="learning-content">
    <header>
     <div>
      <h2>{category || '课程知识库'}</h2>
      <p>
       {data.stats.totalVideos} 份资料 · {data.stats.totalChunks} 个原文片段
      </p>
     </div>
     <span className="learning-course">{vector?.index === 'ready' ? '关键词 + 语义检索' : '本地关键词检索'}</span>
    </header>
    <section className="knowledge-card">
     <div className="row">
      <label>
       导入分类
       <input
        aria-label="导入分类"
        placeholder="例如：牙体牙髓病学"
        value={importCategory}
        maxLength={100}
        onChange={event => setImportCategory(event.target.value)}
       />
      </label>
      <button
       className="primary"
       disabled={busy}
       onClick={() =>
        void run(async () => {
         const results = await invoke<{name: string; ok: boolean; error?: string; result?: {unchanged: boolean}}[]>(
          'knowledge:import',
          {category: importCategory.trim()}
         )
         if (results.length) {
          await refresh()
          setSearch(null)
          setAnswer(null)
          setNotice(
           results
            .map(item =>
             item.ok
              ? item.name + (item.result?.unchanged ? '：已有相同版本' : '：已导入')
              : item.name + '：' + item.error
            )
            .join('\n')
          )
         }
        })
       }
      >
       导入资料
      </button>
      <button
       disabled={busy}
       onClick={() =>
        void run(async () => {
         await invoke('knowledge:rebuild')
         await refresh()
         setNotice('关键词索引已重建')
        })
       }
      >
       重建索引
      </button>
     </div>
     <p className="hint">
      支持有文字的 PDF、Word、TXT、Markdown 和 SRT。原文件保留，知识库单独保存文字版本；更新资料请再次导入。图片型 PDF
      需先识别文字。
     </p>
    </section>
    <section className="knowledge-card">
     <header>
      <div>
       <h3>本地语义检索</h3>
       <p className="hint">
        {!vector
         ? '正在检查本地模型…'
         : vector.index === 'ready'
           ? `模型已启用，已建立 ${vector.vector_count} 个向量片段。`
           : vector.active
             ? '模型已启用；导入或更新资料后，请建立语义索引。'
             : vector.bundled
               ? '已附带中文模型，启用后可以建立语义索引。'
               : '本地模型文件不可用，仍可使用关键词检索。'}
       </p>
      </div>
      <div className="row">
       {!vector?.active && (
        <button
         disabled={busy || !vector?.bundled}
         onClick={() =>
          void run(async () => {
           setVector(await invoke<VectorState>('knowledge:vector-enable'))
           setNotice('中文模型已启用，请建立语义索引')
          })
         }
        >
         启用中文模型
        </button>
       )}
       <button
        disabled={busy || !vector?.active}
        onClick={() =>
         void run(async () => {
          const result = await invoke<{status: VectorState}>('knowledge:vector-rebuild')
          setVector(result.status)
          setSearch(null)
          setAnswer(null)
          setNotice('语义索引已建立')
         })
        }
       >
        建立语义索引
       </button>
      </div>
     </header>
     <p className="hint">模型在本机运行。建索引可能需要数分钟；未建好时检索继续使用关键词。</p>
    </section>
    {category && (
     <section className="knowledge-card">
      <h3>管理分类 · {category}</h3>
      <div className="row">
       <label>
        分类新名称
        <input
         aria-label="分类新名称"
         list="knowledge-categories"
         value={categoryTarget}
         maxLength={100}
         placeholder="输入新名称或选择现有分类"
         onChange={event => setCategoryTarget(event.target.value)}
        />
       </label>
       <button
        disabled={busy || !categoryTarget.trim() || categoryTarget.trim() === category || !entries.length}
        onClick={() => void run(() => organize(entries, categoryTarget, true))}
       >
        {categories.includes(categoryTarget.trim()) ? '合并分类' : '重命名分类'}
       </button>
      </div>
      <p className="hint">将本分类的 {entries.length} 份资料移到新名称；选择已有分类会合并资料，移空的分类自动消失。</p>
     </section>
    )}
    <form
     className="knowledge-search"
     onSubmit={event => {
      event.preventDefault()
      void run(async () => {
       setAnswer(null)
       setReading(null)
       setSearch(await invoke<KnowledgeSearch>('knowledge:search', {query, ids}))
      })
     }}
    >
     <input
      aria-label="知识库检索词"
      placeholder="输入知识点，查找相关原文…"
      value={query}
      maxLength={2000}
      onChange={event => setQuery(event.target.value)}
     />
     <button disabled={busy || !query.trim()} className="primary">
      检索原文
     </button>
     <button
      type="button"
      disabled={busy || !query.trim()}
      onClick={() =>
       void run(async () => {
        setSearch(null)
        setReading(null)
        setAnswer(await invoke<Answer>('knowledge:ask', {query, ids}))
       })
      }
     >
      根据资料回答
     </button>
    </form>
    <p className="hint">
     检索在本机进行；点击“根据资料回答”会将问题和检索片段交给当前连接的模型。回答附可查看的原文引用。
    </p>
    {busy && (
     <div className="row">
      <p role="status">{progressText || '正在处理知识库资料…'}</p>
      <button onClick={() => void invoke('cancel')}>取消处理</button>
     </div>
    )}
    {error && (
     <div className="alert" role="alert">
      {error}
     </div>
    )}
    {notice && (
     <div className="knowledge-notice" role="status">
      {notice}
     </div>
    )}
    {search && (
     <section>
      <h3>相关原文 · {search.hits.length}</h3>
      <p className="hint">
       {search.trace.vector?.note || '本次使用关键词检索。'}
       {!search.hits.length && '未命中不代表资料没有相关内容，可以换关键词。'}
      </p>
      {search.hits.map(hit => (
       <article className="knowledge-card" key={hit.evidence_id}>
        <header>
         <strong>{hit.title}</strong>
         <button disabled={busy} onClick={() => void readCitation(hit.evidence_id)}>
          核验引用来源
         </button>
        </header>
        <p className="knowledge-text">{hit.content}</p>
        <small>原文片段 {hit.chunkIndex + 1}</small>
       </article>
      ))}
     </section>
    )}
    {answer && (
     <section className="knowledge-card">
      <h3>资料回答</h3>
      {answer.answer.paragraphs.map((paragraph, index) => (
       <div key={index}>
        <p>{paragraph.text}</p>
        {paragraph.citations.map((citation, i) => (
         <button key={i} className="knowledge-citation" disabled={busy} onClick={() => void readCitation(citation.id)}>
          {answer.sources.find(source => source.evidence_id === citation.id)?.title || '原文来源'} · 查看引用
         </button>
        ))}
       </div>
      ))}
      {answer.answer.limitation && <p className="hint">{answer.answer.limitation}</p>}
     </section>
    )}
    {reading && (
     <section className="knowledge-card knowledge-reading">
      <header>
       <h3>{reading.title}</h3>
       <button onClick={() => setReading(null)}>收起原文</button>
      </header>
      <p className="knowledge-text">{reading.text}</p>
     </section>
    )}
    <section className="knowledge-card">
     <h3>按内容筛选</h3>
     <div className="media-options">
      {[
       ['type', '类型'],
       ['topic', '主题'],
       ['difficulty', '难度'],
       ['duration', '时长'],
       ['language', '语言']
      ].map(([key, label]) => (
       <label key={key}>
        {label}
        <select
         aria-label={`筛选${label}`}
         value={facets[key] || ''}
         onChange={e => {
          setFacets({...facets, [key]: e.target.value})
          setSearch(null)
          setAnswer(null)
         }}
        >
         <option value="">全部</option>
         {Array.from(
          new Set(
           data.entries
            .map(entry => entry.classification?.[key as keyof NonNullable<KnowledgeEntry['classification']>])
            .filter((value): value is string => typeof value === 'string' && !!value)
          )
         )
          .sort()
          .map(value => (
           <option key={value}>{value}</option>
          ))}
        </select>
       </label>
      ))}
     </div>
     <button
      onClick={() => {
       setFacets({})
       setSearch(null)
       setAnswer(null)
      }}
     >
      清除筛选
     </button>
    </section>
    <KnowledgeClassification entries={entries} refresh={refresh} />
    <section>
     <h3>已导入资料 · {entries.length}</h3>
     {!entries.length && (
      <div className="knowledge-empty">
       <KnowledgeIcon />
       <p>导入课程资料后，就能在这里跨资料查找知识点。</p>
      </div>
     )}
     {entries.map(entry => (
      <article className="knowledge-entry" key={entry.bvid}>
       <KnowledgeIcon />
       <div>
        <strong>{entry.title}</strong>
        <small>
         {entry.folder || '未分类'} · {entry.textLength} 字
         {entry.classification && (
          <span>
           {' '}
           · {entry.classification.type} · {entry.classification.topic} · {entry.classification.keywords.join('、')}
          </span>
         )}
         {entry.sourceMethod ? ` · ${entry.sourceMethod}` : ''} · 版本 {entry.generation_id.slice(-8)}
        </small>
       </div>
       <button
        disabled={busy}
        onClick={() =>
         void run(async () => {
          const result = await invoke<{entry: {title: string}; text: string}>('knowledge:read', {id: entry.bvid})
          setReading({title: result.entry.title, text: result.text})
         })
        }
       >
        查看原文
       </button>
       <button disabled={busy} onClick={() => setMoving({entry, target: entry.folder || ''})}>
        移动分类
       </button>
       {deleting === entry.bvid ? (
        <>
         <span>仅删除知识库版本</span>
         <button
          disabled={busy}
          onClick={() =>
           void run(async () => {
            await invoke('knowledge:delete', {id: entry.bvid, generation: entry.generation_id})
            setDeleting('')
            setSearch(null)
            setAnswer(null)
            setReading(null)
            await refresh()
            setNotice('知识库版本已删除，原文件保留')
           })
          }
         >
          确认删除
         </button>
         <button onClick={() => setDeleting('')}>取消</button>
        </>
       ) : (
        <button disabled={busy} onClick={() => setDeleting(entry.bvid)}>
         删除
        </button>
       )}
      </article>
     ))}
    </section>
    {moving && (
     <section className="knowledge-card" aria-label="移动资料分类">
      <h3>移动 · {moving.entry.title}</h3>
      <div className="row">
       <label>
        目标分类
        <input
         aria-label="目标分类"
         list="knowledge-categories"
         maxLength={100}
         placeholder="留空移到未分类"
         value={moving.target}
         onChange={event => setMoving({...moving, target: event.target.value})}
        />
       </label>
       <button disabled={busy} onClick={() => void run(() => organize([moving.entry], moving.target))}>
        保存分类
       </button>
       <button disabled={busy} onClick={() => setMoving(null)}>
        取消移动
       </button>
      </div>
      <p className="hint">可以选择已有分类或输入新的名称；留空归入未分类。</p>
     </section>
    )}
   </main>
  </section>
 )
}
