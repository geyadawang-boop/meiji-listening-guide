import {useEffect, useState} from 'react'
import type {KnowledgeEntry} from '@shared/knowledge'
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
  [busy, setBusy] = useState(false),
  [error, setError] = useState(''),
  [notice, setNotice] = useState('')
 useEffect(() => {
  void invoke<Record<string, string[]>>('knowledge:classification-options')
   .then(setOptions)
   .catch(reason => setError(String(reason)))
 }, [])
 async function run(fn: () => Promise<void>) {
  setBusy(true)
  setError('')
  setNotice('')
  try {
   await fn()
  } catch (reason) {
   setError(reason instanceof Error ? reason.message : String(reason))
  } finally {
   setBusy(false)
  }
 }
 const value = draft?.selection || empty
 function set(key: string, value: unknown) {
  setDraft(current => current && {...current, selection: {...(current.selection || empty), [key]: value}})
 }
 return (
  <details className="knowledge-card">
   <summary>内容分类与标签</summary>
   <p className="hint">
    按类型、主题、难度、时长和语言整理资料。模型建议使用实际资料文字，保存前可修改；来源改变会拒绝旧草稿。
   </p>
   <div className="row">
    <select
     aria-label="选择分类资料"
     value={id}
     disabled={busy}
     onChange={e => {
      setId(e.target.value)
      setDraft(null)
     }}
    >
     <option value="">请选择资料</option>
     {entries.map(entry => (
      <option key={entry.bvid} value={entry.bvid}>
       {entry.title}
      </option>
     ))}
    </select>
    <button
     className="d-btn"
     disabled={busy || !id}
     onClick={() => void run(async () => setDraft(await invoke('knowledge:classification-read', {id})))}
    >
     编辑分类
    </button>
    <button
     className="d-btn"
     disabled={busy || !id}
     onClick={() =>
      void run(async () => {
       setDraft(await invoke('knowledge:classification-suggest', {id}))
       setNotice('建议已生成，请核对后保存')
      })
     }
    >
     生成分类建议
    </button>
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
         <select
          value={value[key as keyof Selection] as string}
          disabled={busy}
          onChange={e => set(key, e.target.value)}
         >
          {options[key]?.map(option => (
           <option key={option} value={option}>
            {option === 'unknown' ? '未知' : option}
           </option>
          ))}
         </select>
        </label>
       )
      )}
      {Object.entries({topic: '主题', subtopics: '子主题（逗号分隔）', keywords: '关键词（逗号分隔）'}).map(
       ([key, label]) => (
        <label key={key}>
         {label}
         <input
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
     <button
      disabled={busy}
      className="d-btn d-btn-primary"
      onClick={() =>
       void run(async () => {
        await invoke('knowledge:classification-save', {token: draft.token, selection: value})
        await refresh()
        setDraft(null)
        setNotice('分类已保存')
       })
      }
     >
      保存内容分类
     </button>
    </>
   )}
   {error && (
    <p role="alert" className="alert">
     {error}
    </p>
   )}
   {notice && (
    <p role="status" className="learning-status">
     {notice}
    </p>
   )}
  </details>
 )
}
