import {Button, Checkbox, Input, TextArea} from '@heroui/react'
import {StudyIcon} from '@renderer/ui/StudyIcon'
import {SelectField} from '@renderer/ui/SelectField'
import {useState} from 'react'
import type {CourseFile, Detail, LectureNotes, PastQuestion} from '@shared/types'
import {invoke, Modal, FilePicker} from '@renderer/ui/UiParts'
export function NewCourse({
 close,
 create,
 busy
}: {
 close: () => void
 create: (name: string, senior: string[], exams: string[]) => Promise<boolean>
 busy: boolean
}) {
 const [name, setName] = useState(''),
  [senior, setSenior] = useState<string[]>([]),
  [exams, setExams] = useState<string[]>([])
 return (
  <Modal title="新建课程" close={close}>
   <form
    onSubmit={e => {
     e.preventDefault()
     void create(name, senior, exams)
    }}
   >
    <label>
     课程名称
     <Input autoFocus required value={name} onChange={e => setName(e.target.value)} placeholder="例如：我的课程" />
    </label>
    <FilePicker label="学长学姐笔记（可选）" paths={senior} set={setSenior} />
    <FilePicker label="历年卷（可选）" paths={exams} set={setExams} />
    <p className="hint">支持 PDF、DOCX、TXT、MD；可以以后继续补充。历年卷导入后在“课前资料”中拆题并校对。</p>
    <footer>
     <Button variant="ghost" size="sm" type="button" onClick={close}>
      取消
     </Button>
     <Button type="submit" variant="primary" size="sm" isDisabled={busy || !name.trim()}>
      创建课程
     </Button>
    </footer>
   </form>
  </Modal>
 )
}
export function NewLecture({
 draft,
 pptDraft,
 close,
 create,
 busy,
 courseId,
 courseName
}: {
 courseId: string
 courseName?: string
 draft: string
 pptDraft: string
 close: () => void
 create: (title: string, source: string, ppt: string) => Promise<boolean>
 busy: boolean
}) {
 const [title, setTitle] = useState(''),
  [original, setOriginal] = useState(draft ? [draft] : []),
  [ppt, setPpt] = useState<string[]>(pptDraft ? [pptDraft] : [])
 return (
  <Modal title="新建课次" close={close}>
   <form
    onSubmit={e => {
     e.preventDefault()
     void create(title, original[0], ppt[0] || '')
    }}
   >
    <label>
     课次标题
     <Input autoFocus required value={title} onChange={e => setTitle(e.target.value)} placeholder="第 1 讲" />
    </label>
    <FilePicker
     courseId={courseId}
     courseName={courseName}
     transcript
     label="语音识别原文（必选）"
     paths={original}
     set={p => setOriginal(p.slice(-1))}
    />
    <FilePicker
     courseId={courseId}
     courseName={courseName}
     courseware
     label="PPT/课件"
     paths={ppt}
     set={p => setPpt(p.slice(-1))}
    />
    <p className="hint">
     支持智云原文 Word、TXT、Markdown、SRT。导入 PPTX
     后，软件先在本地提取页面文字与嵌入图片，再交给千问结合语音原文分批校订。
    </p>
    <footer>
     <Button variant="ghost" size="sm" type="button" onClick={close}>
      取消
     </Button>
     <Button type="submit" variant="primary" size="sm" isDisabled={busy || !title.trim() || !original.length}>
      添加课次
     </Button>
    </footer>
   </form>
  </Modal>
 )
}
export function AddTranscript({
 courseId,
 courseName,
 draft,
 close,
 save,
 busy
}: {
 courseId: string
 courseName?: string
 draft: string
 close: () => void
 save: (path: string) => Promise<boolean>
 busy: boolean
}) {
 const [paths, setPaths] = useState<string[]>(draft ? [draft] : [])
 return (
  <Modal title="添加语音识别原文" close={close}>
   <form
    onSubmit={e => {
     e.preventDefault()
     void save(paths[0])
    }}
   >
    <FilePicker
     courseId={courseId}
     courseName={courseName}
     transcript
     label="选择或拖入智云原文"
     paths={paths}
     set={p => setPaths(p.slice(-1))}
    />
    <p className="hint">替换原文后需要重新校订字幕，旧笔记与练习也需重新生成。</p>
    <footer>
     <Button variant="ghost" size="sm" type="button" onClick={close}>
      取消
     </Button>
     <Button type="submit" variant="primary" size="sm" isDisabled={busy || !paths.length}>
      保存原文
     </Button>
    </footer>
   </form>
  </Modal>
 )
}
export function AddCourseware({
 draft,
 close,
 busy,
 save,
 courseId,
 courseName
}: {
 courseId: string
 courseName?: string
 draft: string
 close: () => void
 busy: boolean
 save: (path: string) => Promise<boolean>
}) {
 const [paths, setPaths] = useState<string[]>(draft ? [draft] : [])
 return (
  <Modal title="添加 PPT/课件" close={close}>
   <form
    onSubmit={e => {
     e.preventDefault()
     void save(paths[0])
    }}
   >
    <FilePicker
     courseId={courseId}
     courseName={courseName}
     courseware
     label="选择或拖入 PPT/课件"
     paths={paths}
     set={p => setPaths(p.slice(-1))}
    />
    <p className="hint">
     课件保存到 PPT 文件夹并关联当前课次。每个课次保留一份当前课件，新添加会替换关联，旧文件仍保留。软件先在本地提取
     PPTX 页面文字与嵌入图片，再交给千问结合语音原文分批校订。旧 PPT 请另存为 PPTX；PDF 目前读取文字内容。
    </p>
    <footer>
     <Button variant="ghost" size="sm" type="button" onClick={close}>
      取消
     </Button>
     <Button type="submit" variant="primary" size="sm" isDisabled={busy || !paths.length}>
      添加课件
     </Button>
    </footer>
   </form>
  </Modal>
 )
}
export function Notes({
 notes,
 jump,
 save,
 disabled
}: {
 notes: LectureNotes
 jump: (t: string) => void
 save: (n: LectureNotes) => Promise<boolean>
 disabled: boolean
}) {
 type Note = LectureNotes['keyPoints'][number] | LectureNotes['notTested'][number]
 const [editing, setEditing] = useState<{
  group: 'keyPoints' | 'notTested' | 'uncertain'
  index: number
  value: Note
 } | null>(null)
 const groups = [
  ['keyPoints', '教师明确重点'],
  ['notTested', '明确不考'],
  ['uncertain', '表态含糊']
 ] as const
 return (
  <div className="notes">
   {groups.map(([group, title]) => (
    <section key={group}>
     <h3>
      {title}
      <span>{notes[group]?.length || 0}</span>
     </h3>
     {!notes[group]?.length && <p className="hint">本课未提取到相关表态</p>}
     {notes[group]?.map((p, i) => (
      <article key={i} className={`note-card ${p.verified ? '' : 'unverified'}`}>
       <div className="row">
        <span className={`level ${'level' in p ? p.level : ''}`}>
         {'level' in p ? p.level : group === 'notTested' ? '不考' : '待判断'}
        </span>
        <strong>{p.topic}</strong>
        <button className="timestamp" onClick={() => jump(p.timestamp)}>
         <StudyIcon name="clock" />
         {p.timestamp}
        </button>
        <Button
         variant="tertiary"
         size="sm"
         isDisabled={disabled}
         onClick={() => setEditing({group, index: i, value: {...p}})}
        >
         <StudyIcon name="edit" />
         编辑
        </Button>
        <Button
         variant="ghost"
         size="sm"
         isDisabled={disabled}
         onClick={() => {
          const n = structuredClone(notes)
          n[group]!.splice(i, 1)
          void save(n)
         }}
        >
         <StudyIcon name="trash" />
         删除
        </Button>
       </div>
       {'detail' in p && <p>{p.detail}</p>}
       <blockquote>{p.quote}</blockquote>
       {'pptRef' in p && p.pptRef && <small>课件：{p.pptRef}</small>}
       {!p.verified && <p className="warning">待核对：原话、时间或字幕疑点未通过校验，不作为教师明确考点。</p>}
       {editing?.group === group && editing.index === i && (
        <form
         className="note-editor"
         onSubmit={e => {
          e.preventDefault()
          const n = structuredClone(notes)
          ;(n[group] as Note[])[i] = editing.value
          void save(n).then(ok => {
           if (ok) setEditing(null)
          })
         }}
        >
         <label>
          知识点
          <Input
           required
           value={editing.value.topic}
           onChange={e => setEditing({...editing, value: {...editing.value, topic: e.target.value}})}
          />
         </label>
         {'level' in editing.value && (
          <label>
           重点强度
           <SelectField
            label="重点强度"
            value={editing.value.level}
            onChange={next =>
             setEditing({
              ...editing,
              value: {...editing.value, level: next as LectureNotes['keyPoints'][number]['level']}
             })
            }
            options={['必考', '很可能考', '重要', '要求掌握'].map(level => ({value: level, label: level}))}
           />
          </label>
         )}
         {'detail' in editing.value && (
          <label>
           具体内容
           <TextArea
            value={editing.value.detail}
            onChange={e => setEditing({...editing, value: {...editing.value, detail: e.target.value}})}
           />
          </label>
         )}
         <label>
          老师原话
          <TextArea
           required
           value={editing.value.quote}
           onChange={e => setEditing({...editing, value: {...editing.value, quote: e.target.value}})}
          />
         </label>
         <label>
          时间戳
          <Input
           required
           pattern="[0-9]{2,}:[0-9]{2}:[0-9]{2}"
           value={editing.value.timestamp}
           onChange={e => setEditing({...editing, value: {...editing.value, timestamp: e.target.value}})}
          />
         </label>
         {'level' in editing.value && (
          <label>
           课件位置（可选）
           <Input
            value={editing.value.pptRef || ''}
            onChange={e => setEditing({...editing, value: {...editing.value, pptRef: e.target.value}})}
           />
          </label>
         )}
         <Button type="submit" variant="primary" size="sm" isDisabled={disabled}>
          校验并保存
         </Button>
         <Button variant="ghost" size="sm" type="button" onClick={() => setEditing(null)}>
          取消
         </Button>
        </form>
       )}
      </article>
     ))}
    </section>
   ))}
  </div>
 )
}
export function Materials({
 detail,
 busy,
 close,
 run,
 files
}: {
 files: () => void
 detail: Detail
 busy: boolean
 close: () => void
 run: (fn: () => Promise<unknown>) => Promise<boolean>
}) {
 const [selected, setSelected] = useState<string[]>([]),
  [edit, setEdit] = useState<PastQuestion | null>(null)
 const add = (kind: CourseFile['kind']) =>
  void run(async () => {
   const paths = await invoke<string[]>('pick', {kind: 'document'})
   if (paths.length) await invoke('files:add', {courseId: detail.course.id, kind, paths})
  })
 const saveQuestions = (questions: PastQuestion[]) =>
  run(() => invoke('questions:save', {courseId: detail.course.id, questions}))
 return (
  <Modal title="课前资料与历年题库" close={close}>
   <div className="toolbar">
    <Button variant="tertiary" size="sm" onClick={files}>
     查看本课程 PDF 与文件
    </Button>
    <Button variant="tertiary" size="sm" isDisabled={busy} onClick={() => add('senior_notes')}>
     ＋ 学长学姐笔记
    </Button>
    <Button variant="tertiary" size="sm" isDisabled={busy} onClick={() => add('past_exam')}>
     ＋ 历年卷
    </Button>
   </div>
   {detail.files.map(f => (
    <article className="material" key={f.id}>
     <div>
      <strong>{f.filename}</strong>
      <small>
       {f.kind === 'senior_notes' ? '学长学姐笔记' : '历年卷'} · {f.text.length} 字 · {f.chunks.length} 块
       {f.needs_ocr ? ' · 需 OCR' : ''}
      </small>
     </div>
     {f.kind === 'past_exam' && (
      <Button
       variant="tertiary"
       size="sm"
       isDisabled={busy || !!f.needs_ocr}
       onClick={() => void run(() => invoke('questions:split', {courseId: detail.course.id, id: f.id}))}
      >
       拆成单题
      </Button>
     )}
     <Button
      variant="ghost"
      size="sm"
      isDisabled={busy}
      onClick={() => void run(() => invoke('files:remove', {courseId: detail.course.id, id: f.id}))}
     >
      删除资料
     </Button>
    </article>
   ))}
   {!detail.files.length && <p className="hint">尚未导入资料。支持 PDF、DOCX、TXT、MD；扫描件会标记“需 OCR”。</p>}
   <h3>历年题库 · {detail.questions.length} 道</h3>
   <div className="toolbar">
    <Button
     variant="tertiary"
     size="sm"
     isDisabled={busy || selected.length < 2}
     onClick={() => {
      const chosen = detail.questions.filter(q => selected.includes(q.id)),
       first = chosen[0]
      const merged = {
       ...first,
       stem: chosen.map(q => q.stem).join('\n\n'),
       answer:
        chosen
         .map(q => q.answer || '')
         .filter(Boolean)
         .join('\n') || undefined,
       knowledgePoints: [...new Set(chosen.flatMap(q => q.knowledgePoints))]
      }
      void saveQuestions(
       detail.questions
        .filter(q => !selected.includes(q.id) || q.id === first.id)
        .map(q => (q.id === first.id ? merged : q))
      ).then(() => setSelected([]))
     }}
    >
     合并选中题目
    </Button>
    <Button
     variant="ghost"
     size="sm"
     isDisabled={busy || !selected.length}
     onClick={() =>
      void saveQuestions(detail.questions.filter(q => !selected.includes(q.id))).then(() => setSelected([]))
     }
    >
     删除选中
    </Button>
   </div>
   {detail.questions.map(q => (
    <article key={q.id} className="question-card">
     <div className="row">
      <Checkbox
       isSelected={selected.includes(q.id)}
       aria-label="选中题目"
       onChange={checked => setSelected(checked ? [...selected, q.id] : selected.filter(id => id !== q.id))}
      >
       <Checkbox.Content>
        <Checkbox.Control>
         <Checkbox.Indicator />
        </Checkbox.Control>
       </Checkbox.Content>
      </Checkbox>
      <strong>{q.type}</strong>
      <small>
       {q.year} · {q.sourceFile}
      </small>
      <Button variant="tertiary" size="sm" isDisabled={busy} onClick={() => setEdit(q)}>
       <StudyIcon name="edit" />
       编辑
      </Button>
     </div>
     <p className="question-stem">{q.stem}</p>
     <small>{q.knowledgePoints.join(' / ')}</small>
     {edit?.id === q.id && (
      <form
       onSubmit={e => {
        e.preventDefault()
        void saveQuestions(detail.questions.map(v => (v.id === edit.id ? edit : v))).then(() => setEdit(null))
       }}
      >
       <label>
        题型
        <Input value={edit.type} onChange={e => setEdit({...edit, type: e.target.value})} />
       </label>
       <label>
        年份
        <Input value={edit.year || ''} onChange={e => setEdit({...edit, year: e.target.value})} />
       </label>
       <label>
        题干
        <TextArea value={edit.stem} onChange={e => setEdit({...edit, stem: e.target.value})} />
       </label>
       <label>
        答案
        <TextArea value={edit.answer || ''} onChange={e => setEdit({...edit, answer: e.target.value})} />
       </label>
       <label>
        知识点（用逗号分隔）
        <Input
         value={edit.knowledgePoints.join(',')}
         onChange={e => setEdit({...edit, knowledgePoints: e.target.value.split(/[,，]/).filter(Boolean)})}
        />
       </label>
       <Button type="submit" variant="primary" size="sm" isDisabled={busy}>
        保存
       </Button>
       <Button variant="ghost" size="sm" type="button" onClick={() => setEdit(null)}>
        取消
       </Button>
      </form>
     )}
    </article>
   ))}
  </Modal>
 )
}
