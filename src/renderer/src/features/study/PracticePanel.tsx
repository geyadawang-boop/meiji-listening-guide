import {Button, Checkbox, Input} from '@heroui/react'
import {useState} from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type {PracticeSet, PracticeQuestion} from '@shared/types'
import {questionOptions} from '@shared/practice'
import {notify} from '@renderer/ui/ToastHost'
import {StudyIcon} from '@renderer/ui/StudyIcon'
import {IdentityAvatar} from '@renderer/features/identity/Identity'
type Group = 'past' | 'extended' | 'generated'
type Actions = {
 disabled: boolean
 submit: (group: Group, index: number, response: string) => Promise<void>
 answer: (group: Group, index: number) => Promise<void>
 reset: (group: Group, index: number) => Promise<void>
}
export function PracticePanel({data, ...actions}: Actions & {data: PracticeSet}) {
 return (
  <div className="practice interactive-practice">
   {data.shortage > 0 && <p className="notice">有来源的拓展题仍缺 {data.shortage} 道。</p>}
   {(['past', 'extended', 'generated'] as const).map(group => (
    <section key={group}>
     <h3>
      <StudyIcon name="practice" />
      {group === 'past' ? '历年真题' : group === 'extended' ? '有来源的拓展练习' : 'AI 自测题（非历年真题）'}
      <span>{data[group]?.length || 0} 道</span>
     </h3>
     {!data[group]?.length && <p className="hint">暂无可核验的相关题目</p>}
     {data[group]?.map((q, index) => (
      <Question key={q.id || q.stem + index} q={q} group={group} index={index} {...actions} />
     ))}
    </section>
   ))}
  </div>
 )
}
function Question({
 q,
 group,
 index,
 submit,
 answer,
 reset,
 disabled
}: Actions & {q: PracticeQuestion; group: Group; index: number}) {
 const [draft, setDraft] = useState(q.attempt?.response || ''),
  [open, setOpen] = useState(false),
  [showAnswer, setShowAnswer] = useState(!questionOptions(q.stem).length || !!q.attempt),
  [pending, setPending] = useState(false)
 const options = questionOptions(q.stem),
  multiple = /多选|不定项/.test(q.type),
  selected = draft.split(','),
  stem = options.length ? q.stem.split(/\n\s*A[.、．)）:：]/)[0] : q.stem
 async function run(fn: () => Promise<void>) {
  setPending(true)
  try {
   await fn()
  } catch (e) {
   notify.error(e)
  } finally {
   setPending(false)
  }
 }
 const origin =
  q.answerSource === 'searched'
   ? '搜索答案 · 同题来源已核验'
   : q.answerSource === 'imported' || (q.answer && !q.aiAnswer)
     ? '题库附带答案'
     : ''
 return (
  <article className="question-card practice-card" aria-label={'题目 ' + (index + 1)}>
   <div className="question-meta">
    <span>{String(index + 1).padStart(2, '0')}</span>
    <strong>{q.topic}</strong>
    <small>{q.type}</small>
   </div>
   <p className="question-stem">{stem}</p>
   {group !== 'generated' && (
    <small className="question-source">
     {q.sourceFile || '有来源的练习题'}
     {q.year ? ' · ' + q.year : ''}
    </small>
   )}
   {!!options.length && (
    <>
     <div className="answer-options" role="group" aria-label="选择答案">
      {options.map(o =>
       multiple ? (
        <Checkbox
         className={'answer-option ' + (selected.includes(o.key) ? 'selected' : '')}
         key={o.key}
         isSelected={selected.includes(o.key)}
         isDisabled={pending || !!q.attempt}
         onChange={checked =>
          setDraft(
           (checked ? [...selected.filter(Boolean), o.key] : selected.filter(k => k !== o.key)).sort().join(',')
          )
         }
        >
         <Checkbox.Content>
          <Checkbox.Control>
           <Checkbox.Indicator />
          </Checkbox.Control>
          <span className="option-letter">{o.key}</span>
          <span>{o.text}</span>
         </Checkbox.Content>
        </Checkbox>
       ) : (
        <label className={'answer-option ' + (selected.includes(o.key) ? 'selected' : '')} key={o.key}>
         <Input
          type="radio"
          name={group + index}
          value={o.key}
          disabled={pending || !!q.attempt}
          checked={selected.includes(o.key)}
          onChange={() => setDraft(o.key)}
         />
         <span className="option-letter">{o.key}</span>
         <span>{o.text}</span>
        </label>
       )
      )}
     </div>
     <label className="choice-response-label">
      输入你的选项
      <Input
       className="choice-response"
       aria-label="输入选项答案"
       placeholder={multiple ? '例如 AC' : '例如 A'}
       value={draft.replace(/,/g, '')}
       disabled={pending || !!q.attempt}
       onChange={e =>
        setDraft(
         [
          ...new Set(
           e.target.value
            .toUpperCase()
            .replace(/[^A-H]/g, '')
            .split('')
          )
         ].join(',')
        )
       }
      />
     </label>
    </>
   )}
   <div className="practice-actions">
    {!!options.length &&
     (q.attempt ? (
      <Button
       variant="tertiary"
       size="sm"
       isDisabled={pending}
       onClick={() =>
        void run(async () => {
         await reset(group, index)
         setDraft('')
         setOpen(false)
         setShowAnswer(false)
        })
       }
      >
       <StudyIcon name="reset" />
       重新作答
      </Button>
     ) : (
      <Button
       variant="tertiary"
       size="sm"
       isDisabled={pending || !draft.trim() || !q.answer}
       onClick={() =>
        void run(async () => {
         await submit(group, index, draft)
         setShowAnswer(true)
        })
       }
      >
       <StudyIcon name="check" />
       提交答案
      </Button>
     ))}
    {!!options.length && (
     <Button variant="ghost" size="sm" aria-expanded={showAnswer} onClick={() => setShowAnswer(!showAnswer)}>
      <StudyIcon name="eye" />
      {showAnswer ? '隐藏答案' : '显示答案'}
     </Button>
    )}
    <button className="explanation-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
     <StudyIcon name="notes" />
     {open ? '隐藏详解' : '查看详解'}
    </button>
   </div>
   {!!options.length && q.attempt && (
    <div className={'practice-feedback ' + q.attempt.verdict} role="status">
     <strong>
      {q.attempt.verdict === 'correct' ? '回答正确' : q.attempt.verdict === 'incorrect' ? '需要再练习' : '待自查'}
     </strong>
     <p>{q.attempt.feedback}</p>
    </div>
   )}
   {(!options.length || showAnswer) && (
    <div className="practice-short-answer">
     <strong>参考答案</strong>
     <p>{q.answer || '参考答案尚未准备，请点击“补全已有答案与详解”'}</p>
     {origin && <small>{origin}</small>}
    </div>
   )}
   {open && (
    <div className="practice-explanation">
     <div className="explanation-heading">
      <span className="identity-answer-avatar">
       <IdentityAvatar role="assistant" />
      </span>
      <strong>答案详解</strong>
      {origin && <small>{origin}</small>}
     </div>
     {q.answer && (
      <p>
       <strong>参考答案：</strong>
       {q.answer}
      </p>
     )}
     <ReactMarkdown remarkPlugins={[remarkGfm]}>
      {q.explanation || '这道题尚未保存详解。需要时请点击上方“补全已有答案与详解”，完成后再查看。'}
     </ReactMarkdown>
     <small>{q.searchStatus} · 详解由 AI 辅助整理</small>
     {q.answerSourceUrl && (
      <a
       href={q.answerSourceUrl}
       onClick={e => {
        e.preventDefault()
        void window.assistant.invoke('external', {url: q.answerSourceUrl})
       }}
      >
       查看答案来源
      </a>
     )}
     <p className="hint">本课关联依据：{q.reason}</p>
    </div>
   )}
  </article>
 )
}
