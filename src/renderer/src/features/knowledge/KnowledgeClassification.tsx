import {Button, Card, Disclosure, Input} from '@heroui/react'
import {useEffect, useState} from 'react'
import type {KnowledgeEntry} from '@shared/knowledge'
import {notify} from '@renderer/ui/ToastHost'
import {SelectField} from '@renderer/ui/SelectField'
import {SettingsLink} from '@renderer/app/settings-navigation'
const invoke = <T,>(action: string, args?: unknown) => window.assistant.invoke<T>(action, args)
type Selection = {
 type: string
 topic: string
 subtopics: string[]
 difficulty: string
 duration: string
 language: string
 keywords: string[]
}
type Draft = {token: string; title: string; selection: Selection | null; excerpt: boolean}
const empty: Selection = {
 type: '教育',
 topic: '',
 subtopics: [],
 difficulty: 'unknown',
 duration: 'unknown',
 language: '中文',
 keywords: []
}
export function KnowledgeClassification({entries, refresh}: {entries: KnowledgeEntry[]; refresh: () => Promise<void>}) {
 const [options, setOptions] = useState<Record<string, string[]>>({}),
  [draft, setDraft] = useState<Draft | null>(null),
  [id, setId] = useState(''),
  [busy, setBusy] = useState(false)
 useEffect(() => {
  void invoke<Record<string, string[]>>('knowledge:classification-options')
   .then(setOptions)
   .catch(reason => notify.error(reason, {title: '读取分类选项失败'}))
 }, [])
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
 const value = draft?.selection || empty
 function set(key: string, value: unknown) {
  setDraft(current => current && {...current, selection: {...(current.selection || empty), [key]: value}})
 }
 return (
  <Card className="knowledge-card">
   <Disclosure>
    <Disclosure.Heading>
     <Disclosure.Trigger className="knowledge-classification-trigger">
      内容分类与标签
      <Disclosure.Indicator />
     </Disclosure.Trigger>
    </Disclosure.Heading>
    <Disclosure.Content>
     <Disclosure.Body className="knowledge-classification-body">
      <p className="hint">
       按类型、主题、难度、时长和语言整理资料。模型建议使用实际资料文字，保存前可修改；来源改变会拒绝旧草稿。{' '}
       <SettingsLink section="qwen">模型设置</SettingsLink>
      </p>
      <div className="row">
       <SelectField
        label="选择分类资料"
        placeholder="请选择资料"
        value={id}
        isDisabled={busy}
        onChange={next => {
         setId(next)
         setDraft(null)
        }}
        options={[{value: '', label: '请选择资料'}, ...entries.map(entry => ({value: entry.bvid, label: entry.title}))]}
       />
       <Button
        variant="tertiary"
        size="sm"
        isDisabled={busy || !id}
        onClick={() => void run(async () => setDraft(await invoke('knowledge:classification-read', {id})))}
       >
        编辑分类
       </Button>
       <Button
        variant="tertiary"
        size="sm"
        isDisabled={busy || !id}
        onClick={() =>
         void run(async () => {
          setDraft(await invoke('knowledge:classification-suggest', {id}))
          notify.info('建议已生成，请核对后保存')
         })
        }
       >
        生成分类建议
       </Button>
      </div>
      {draft && (
       <>
        <h4>{draft.title}</h4>
        {draft.excerpt && <p className="hint">本次模型建议基于前 12 万字节选；请核对全文后保存。</p>}
        <div className="media-options">
         {Object.entries({type: '内容类型', difficulty: '难度', duration: '时长', language: '语言'}).map(
          ([key, label]) => (
           <label key={key}>
            {label}
            <SelectField
             label={label}
             value={value[key as keyof Selection] as string}
             isDisabled={busy}
             onChange={next => set(key, next)}
             options={(options[key] || []).map(option => ({
              value: option,
              label: option === 'unknown' ? '未知' : option
             }))}
            />
           </label>
          )
         )}
         {Object.entries({topic: '主题', subtopics: '子主题（逗号分隔）', keywords: '关键词（逗号分隔）'}).map(
          ([key, label]) => (
           <label key={key}>
            {label}
            <Input
             disabled={busy}
             value={
              Array.isArray(value[key as keyof Selection])
               ? (value[key as keyof Selection] as string[]).join('，')
               : (value[key as keyof Selection] as string)
             }
             onChange={e =>
              set(
               key,
               key === 'topic'
                ? e.target.value
                : e.target.value
                   .split(/[,，]/)
                   .map(word => word.trim())
                   .filter(Boolean)
              )
             }
            />
           </label>
          )
         )}
        </div>
        <Button
         variant="primary"
         size="sm"
         isDisabled={busy}
         onClick={() =>
          void run(async () => {
           await invoke('knowledge:classification-save', {token: draft.token, selection: value})
           await refresh()
           setDraft(null)
           notify.success('分类已保存')
          })
         }
        >
         保存内容分类
        </Button>
       </>
      )}
     </Disclosure.Body>
    </Disclosure.Content>
   </Disclosure>
  </Card>
 )
}
