import {Button, Card, Input} from '@heroui/react'
import {useEffect, useRef, useState} from 'react'
import {BookOpen} from 'lucide-react'
import {notify} from '@renderer/ui/ToastHost'
import {WindowMenuButton, WindowPanel} from '@renderer/ui/WindowPanel'
import {SelectField} from '@renderer/ui/SelectField'
import {KnowledgeClassification} from '@renderer/features/knowledge/KnowledgeClassification'
import {SettingsLink} from '@renderer/app/settings-navigation'
import type {KnowledgeEntry, KnowledgeList, KnowledgeHit, KnowledgeSearch} from '@shared/knowledge'
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
export function KnowledgeBase({visible, close}: {visible: boolean; close: () => void}) {
 const [data, setData] = useState<KnowledgeList>({
  entries: [],
  stats: {totalVideos: 0, totalChunks: 0},
  retrieval: 'keyword'
 })
 const [category, setCategory] = useState(''),
  [importCategory, setImportCategory] = useState(''),
  [query, setQuery] = useState('')
 const [busy, setBusy] = useState(false)
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
  if (visible) void refresh().catch(reason => notify.error(reason, {title: '读取知识库失败'}))
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
  setProgressText('')
  try {
   await fn()
  } catch (reason) {
   notify.error(reason)
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
  notify.success(`已移动 ${result.changed} 份资料，${result.unchanged} 份分类相同；原文件保留。`)
  if (result.failures.length)
   notify.error(result.failures.map(item => item.title + '：' + item.error).join('\n'), {
    title: `${result.failures.length} 份资料移动失败`
   })
  else if (wholeCategory) {
   setCategory(target.trim())
   setCategoryTarget('')
  }
 }
 return (
  <>
   <datalist id="knowledge-categories">
    {categories.map(item => (
     <option key={item} value={item} />
    ))}
   </datalist>
   <WindowPanel
    visible={visible}
    label="知识库"
    title="知识库"
    description={
     <>
      保存正文副本与索引，
      <br />
      原文件仍在文件管理
     </>
    }
    heading={category || '课程知识库'}
    subheading={`${data.stats.totalVideos} 份资料 · ${data.stats.totalChunks} 个原文片段`}
    menu={
     <>
      <WindowMenuButton
       active={!category}
       icon={<BookOpen aria-hidden="true" />}
       onSelect={() => {
        setCategory('')
        setSearch(null)
        setAnswer(null)
       }}
      >
       全部资料 · {data.entries.length}
      </WindowMenuButton>
      {categories.map(item => (
       <WindowMenuButton
        key={item}
        active={category === item}
        title={item}
        onSelect={() => {
         setCategory(item)
         setSearch(null)
         setAnswer(null)
        }}
       >
        {item}
       </WindowMenuButton>
      ))}
     </>
    }
    actions={
     <span className="learning-course">{vector?.index === 'ready' ? '关键词 + 语义检索' : '本地关键词检索'}</span>
    }
    close={close}
   >
    <Card className="knowledge-card">
     <div className="row">
      <label>
       导入分类
       <Input
        aria-label="导入分类"
        placeholder="例如：牙体牙髓病学"
        value={importCategory}
        maxLength={100}
        onChange={event => setImportCategory(event.target.value)}
       />
      </label>
      <Button
       variant="primary"
       size="sm"
       isDisabled={busy}
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
          const imported = results.filter(item => item.ok).length
          const failed = results.filter(item => !item.ok)
          if (imported) notify.success(`已导入或核对 ${imported} 份资料`)
          if (failed.length)
           notify.error(failed.map(item => item.name + '：' + item.error).join('\n'), {
            title: `${failed.length} 份资料导入失败`
           })
         }
        })
       }
      >
       导入资料
      </Button>
      <Button
       variant="tertiary"
       size="sm"
       isDisabled={busy}
       onClick={() =>
        void run(async () => {
         await invoke('knowledge:rebuild')
         await refresh()
         notify.success('关键词索引已重建')
        })
       }
      >
       重建索引
      </Button>
     </div>
     <p className="hint">
      支持有文字的 PDF、Word、TXT、Markdown 和 SRT。原文件保留，知识库单独保存文字版本；更新资料请再次导入。图片型 PDF
      需先识别文字。
     </p>
    </Card>
    <Card className="knowledge-card">
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
        <Button
         variant="tertiary"
         size="sm"
         isDisabled={busy || !vector?.bundled}
         onClick={() =>
          void run(async () => {
           setVector(await invoke<VectorState>('knowledge:vector-enable'))
           notify.success('中文模型已启用，请建立语义索引')
          })
         }
        >
         启用中文模型
        </Button>
       )}
       <Button
        variant="tertiary"
        size="sm"
        isDisabled={busy || !vector?.active}
        onClick={() =>
         void run(async () => {
          const result = await invoke<{status: VectorState}>('knowledge:vector-rebuild')
          setVector(result.status)
          setSearch(null)
          setAnswer(null)
          notify.success('语义索引已建立')
         })
        }
       >
        建立语义索引
       </Button>
      </div>
     </header>
     <p className="hint">模型在本机运行。建索引可能需要数分钟；未建好时检索继续使用关键词。</p>
    </Card>
    {category && (
     <Card className="knowledge-card">
      <h3>管理分类 · {category}</h3>
      <div className="row">
       <label>
        分类新名称
        <Input
         aria-label="分类新名称"
         list="knowledge-categories"
         value={categoryTarget}
         maxLength={100}
         placeholder="输入新名称或选择现有分类"
         onChange={event => setCategoryTarget(event.target.value)}
        />
       </label>
       <Button
        variant="tertiary"
        size="sm"
        isDisabled={busy || !categoryTarget.trim() || categoryTarget.trim() === category || !entries.length}
        onClick={() => void run(() => organize(entries, categoryTarget, true))}
       >
        {categories.includes(categoryTarget.trim()) ? '合并分类' : '重命名分类'}
       </Button>
      </div>
      <p className="hint">将本分类的 {entries.length} 份资料移到新名称；选择已有分类会合并资料，移空的分类自动消失。</p>
     </Card>
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
     <Input
      aria-label="知识库检索词"
      placeholder="输入知识点，查找相关原文…"
      value={query}
      maxLength={2000}
      onChange={event => setQuery(event.target.value)}
     />
     <Button type="submit" variant="primary" size="sm" isDisabled={busy || !query.trim()}>
      检索原文
     </Button>
     <Button
      variant="tertiary"
      size="sm"
      type="button"
      isDisabled={busy || !query.trim()}
      onClick={() =>
       void run(async () => {
        setSearch(null)
        setReading(null)
        setAnswer(await invoke<Answer>('knowledge:ask', {query, ids}))
       })
      }
     >
      根据资料回答
     </Button>
    </form>
    <p className="hint">
     检索在本机进行；点击“根据资料回答”会将问题和检索片段交给当前连接的模型。回答附可查看的原文引用。{' '}
     <SettingsLink section="qwen">模型设置</SettingsLink>
    </p>
    {busy && (
     <div className="row">
      <p role="status">{progressText || '正在处理知识库资料…'}</p>
      <Button variant="ghost" size="sm" onClick={() => void invoke('cancel')}>
       取消处理
      </Button>
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
       <Card className="knowledge-card" key={hit.evidence_id}>
        <header>
         <strong>{hit.title}</strong>
         <Button variant="tertiary" size="sm" isDisabled={busy} onClick={() => void readCitation(hit.evidence_id)}>
          核验引用来源
         </Button>
        </header>
        <p className="knowledge-text">{hit.content}</p>
        <small>原文片段 {hit.chunkIndex + 1}</small>
       </Card>
      ))}
     </section>
    )}
    {answer && (
     <Card className="knowledge-card">
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
     </Card>
    )}
    {reading && (
     <Card className="knowledge-card knowledge-reading">
      <header>
       <h3>{reading.title}</h3>
       <Button variant="tertiary" size="sm" onClick={() => setReading(null)}>
        收起原文
       </Button>
      </header>
      <p className="knowledge-text">{reading.text}</p>
     </Card>
    )}
    <Card className="knowledge-card">
     <h3>按内容筛选</h3>
     <div className="media-options">
      {[
       ['type', '类型'],
       ['topic', '主题'],
       ['difficulty', '难度'],
       ['duration', '时长'],
       ['language', '语言']
      ].map(([key, label]) => (
       <SelectField
        key={key}
        label={`筛选${label}`}
        placeholder="全部"
        value={facets[key] || ''}
        options={[
         {value: '', label: '全部'},
         ...Array.from(
          new Set(
           data.entries
            .map(entry => entry.classification?.[key as keyof NonNullable<KnowledgeEntry['classification']>])
            .filter((value): value is string => typeof value === 'string' && !!value)
          )
         )
          .sort()
          .map(value => ({value, label: value}))
        ]}
        onChange={next => {
         setFacets({...facets, [key]: next})
         setSearch(null)
         setAnswer(null)
        }}
       />
      ))}
     </div>
     <Button
      variant="ghost"
      size="sm"
      onClick={() => {
       setFacets({})
       setSearch(null)
       setAnswer(null)
      }}
     >
      清除筛选
     </Button>
    </Card>
    <KnowledgeClassification entries={entries} refresh={refresh} />
    <section>
     <h3>已导入资料 · {entries.length}</h3>
     {!entries.length && (
      <div className="knowledge-empty">
       <BookOpen />
       <p>导入课程资料后，就能在这里跨资料查找知识点。</p>
      </div>
     )}
     {entries.map(entry => (
      <article className="knowledge-entry" key={entry.bvid}>
       <BookOpen />
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
       <Button
        variant="tertiary"
        size="sm"
        isDisabled={busy}
        onClick={() =>
         void run(async () => {
          const result = await invoke<{entry: {title: string}; text: string}>('knowledge:read', {id: entry.bvid})
          setReading({title: result.entry.title, text: result.text})
         })
        }
       >
        查看原文
       </Button>
       <Button
        variant="tertiary"
        size="sm"
        isDisabled={busy}
        onClick={() => setMoving({entry, target: entry.folder || ''})}
       >
        移动分类
       </Button>
       {deleting === entry.bvid ? (
        <>
         <span>仅删除知识库版本</span>
         <Button
          variant="ghost"
          size="sm"
          isDisabled={busy}
          onClick={() =>
           void run(async () => {
            await invoke('knowledge:delete', {id: entry.bvid, generation: entry.generation_id})
            setDeleting('')
            setSearch(null)
            setAnswer(null)
            setReading(null)
            await refresh()
            notify.success('知识库版本已删除，原文件保留')
           })
          }
         >
          确认删除
         </Button>
         <Button variant="ghost" size="sm" onClick={() => setDeleting('')}>
          取消
         </Button>
        </>
       ) : (
        <Button variant="ghost" size="sm" isDisabled={busy} onClick={() => setDeleting(entry.bvid)}>
         删除
        </Button>
       )}
      </article>
     ))}
    </section>
    {moving && (
     <Card className="knowledge-card" aria-label="移动资料分类">
      <h3>移动 · {moving.entry.title}</h3>
      <div className="row">
       <label>
        目标分类
        <Input
         aria-label="目标分类"
         list="knowledge-categories"
         maxLength={100}
         placeholder="留空移到未分类"
         value={moving.target}
         onChange={event => setMoving({...moving, target: event.target.value})}
        />
       </label>
       <Button
        variant="tertiary"
        size="sm"
        isDisabled={busy}
        onClick={() => void run(() => organize([moving.entry], moving.target))}
       >
        保存分类
       </Button>
       <Button variant="ghost" size="sm" isDisabled={busy} onClick={() => setMoving(null)}>
        取消移动
       </Button>
      </div>
      <p className="hint">可以选择已有分类或输入新的名称；留空归入未分类。</p>
     </Card>
    )}
   </WindowPanel>
  </>
 )
}
