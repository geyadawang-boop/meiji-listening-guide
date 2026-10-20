import {Button, Card, Checkbox, Input} from '@heroui/react'
import {useState} from 'react'
import {notify} from '@renderer/ui/ToastHost'
import {SelectField} from '@renderer/ui/SelectField'
const invoke = <T,>(action: string, args?: unknown) => window.assistant.invoke<T>(action, args)
type Item = {
 id: string
 text: string
 labels: string[]
 selected: boolean
 author?: string
 url: string
 time_sec?: number
 root_id?: string
 parent_id?: string
 note?: string
}
type Pack = {
 ref: string
 items: Item[]
 coverage: {
  comments: {status: string; root_pages?: number}
  danmaku: {status: string; segments_requested?: number[]; segments_total?: number}
 }
}
const coverageLabel = (status: string) =>
 (
  ({
   complete: '本次范围已取得',
   partial: '部分取得',
   empty: '当前范围无记录',
   failed: '未取得',
   unknown: '范围尚未确认',
   unavailable: '暂不可用'
  }) as Record<string, string>
 )[status] || '范围需要核对'
const labels: Record<string, string> = {
 correction: '纠错候选',
 alternative: '不同观点',
 counterexample: '反例候选',
 supplement: '补充资料',
 marker: '内容标识',
 discussion: '一般讨论'
}
export function Discussion() {
 const [url, setUrl] = useState(''),
  [pages, setPages] = useState(2),
  [pack, setPack] = useState<Pack | null>(null),
  [category, setCategory] = useState('观众讨论'),
  [busy, setBusy] = useState(false),
  [filter, setFilter] = useState('')
 async function run(fn: () => Promise<void>) {
  setBusy(true)
  try {
   await fn()
  } catch (reason) {
   notify.error(reason)
  } finally {
   setBusy(false)
  }
 }
 function change(id: string, key: string, value: unknown) {
  setPack(
   current =>
    current && {...current, items: current.items.map(item => (item.id === id ? {...item, [key]: value} : item))}
  )
 }
 return (
  <Card className="knowledge-card" aria-label="评论与弹幕">
   <header>
    <div>
     <h3>评论与弹幕</h3>
     <p className="hint">降噪并保留出处、时间点及回复上下文。标签仅为候选；点赞和讨论不代表内容正确。</p>
    </div>
   </header>
   <div className="row">
    <Input
     aria-label="讨论视频网址"
     value={url}
     disabled={busy}
     placeholder="B 站具体分集网址"
     onChange={e => {
      setUrl(e.target.value)
      setPack(null)
     }}
    />
    <label>
     评论页数
     <Input
      aria-label="评论页数"
      type="number"
      min={1}
      max={10}
      value={pages}
      disabled={busy}
      onChange={e => setPages(Number(e.target.value))}
     />
    </label>
    <Button
     variant="tertiary"
     size="sm"
     isDisabled={busy || !url.trim()}
     onClick={() =>
      void run(async () => {
       setPack(await invoke('media:discussion', {url, pages}))
      })
     }
    >
     读取评论和弹幕
    </Button>
   </div>
   {pack && (
    <>
     <p className="hint">
      评论：{coverageLabel(pack.coverage.comments.status)}
      {pack.coverage.comments.root_pages != null ? `（${pack.coverage.comments.root_pages} 页）` : ''} · 弹幕：
      {coverageLabel(pack.coverage.danmaku.status)}
      {pack.coverage.danmaku.segments_total
       ? `（采集 ${pack.coverage.danmaku.segments_requested?.length || 0}/${pack.coverage.danmaku.segments_total} 个时段）`
       : ''}{' '}
      · 共 {pack.items.length} 条。采集有页数和时段上限，不能当作所有历史讨论。
     </p>
     <div className="row">
      <Input aria-label="筛选讨论" placeholder="筛选文字" value={filter} onChange={e => setFilter(e.target.value)} />
      <Input aria-label="讨论分类" value={category} onChange={e => setCategory(e.target.value)} />
     </div>
     <div className="discussion-list">
      {pack.items
       .filter(item => !filter || item.text.includes(filter))
       .map(item => (
        <article className="batch-item" key={item.id}>
         <Checkbox
          className="media-switch"
          isSelected={item.selected}
          isDisabled={busy}
          aria-label={`保留 ${item.id}`}
          onChange={checked => change(item.id, 'selected', checked)}
         >
          <Checkbox.Content>
           <Checkbox.Control>
            <Checkbox.Indicator />
           </Checkbox.Control>
           <strong>
            {item.author || '观众讨论'}{' '}
            {item.time_sec != null
             ? `${Math.floor(item.time_sec / 60)}:${Math.floor(item.time_sec % 60)
                .toString()
                .padStart(2, '0')}`
             : ''}
           </strong>
          </Checkbox.Content>
         </Checkbox>
         <p>{item.text}</p>
         <p className="hint">
          {item.url} · 证据 {item.id}
          {item.parent_id ? ` · 回复 ${item.parent_id}` : ''}
         </p>
         <div className="row">
          <SelectField
           label={`分类 ${item.id}`}
           value={item.labels[0]}
           isDisabled={busy}
           onChange={next => change(item.id, 'labels', [next])}
           options={Object.entries(labels).map(([key, label]) => ({value: key, label}))}
          />
          <Input
           aria-label={`备注 ${item.id}`}
           placeholder="核对备注"
           maxLength={500}
           value={item.note || ''}
           disabled={busy}
           onChange={e => change(item.id, 'note', e.target.value)}
          />
         </div>
        </article>
       ))}
     </div>
     <Button
      variant="primary"
      size="sm"
      isDisabled={busy || !pack.items.some(item => item.selected)}
      onClick={() =>
       void run(async () => {
        const result = await invoke<{path: string}>('media:discussion-import', {
         ref: pack.ref,
         category,
         changes: pack.items.map(item => ({
          id: item.id,
          selected: item.selected,
          label: item.labels[0],
          note: item.note || ''
         }))
        })
        notify.success('所选讨论已保存并导入知识库', {description: result.path, timeout: 6000})
        setPack(null)
       })
      }
     >
      保存所选讨论
     </Button>
    </>
   )}
   {busy && (
    <p role="status" className="hint">
     正在读取，范围内结果会保留采集回执…
    </p>
   )}
  </Card>
 )
}
