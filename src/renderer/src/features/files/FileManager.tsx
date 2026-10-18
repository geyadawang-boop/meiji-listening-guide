import {useEffect, useState} from 'react'
import type {Course, LibraryFile} from '@shared/types'
import {Folder, Trash2} from 'lucide-react'
export function FileManager({
 busy,
 close,
 changed,
 initialCourse = '全部课程'
}: {
 initialCourse?: string
 busy: boolean
 close: () => void
 changed: () => Promise<unknown>
}) {
 const [files, setFiles] = useState<LibraryFile[]>([]),
  [filter, setFilter] = useState('全部'),
  [search, setSearch] = useState(''),
  [error, setError] = useState(''),
  [pending, setPending] = useState<LibraryFile | null>(null),
  [working, setWorking] = useState(false)
 const [courses, setCourses] = useState<Course[]>([]),
  [course, setCourse] = useState(initialCourse),
  [creating, setCreating] = useState(false),
  [name, setName] = useState('')
 async function load() {
  const [f, c] = await Promise.all([
   window.assistant.invoke<LibraryFile[]>('library:list'),
   window.assistant.invoke<Course[]>('courses')
  ])
  setFiles(f)
  setCourses(c)
 }
 async function create() {
  if (!name.trim()) return
  setWorking(true)
  setError('')
  try {
   const c = await window.assistant.invoke<Course>('course:create', {name: name.trim()})
   await load()
   await changed()
   setCourse(c.name)
   setCreating(false)
   setName('')
  } catch (e) {
   setError(String(e))
  } finally {
   setWorking(false)
  }
 }
 useEffect(() => {
  void load().catch(e => setError(String(e)))
 }, [])
 async function remove() {
  if (!pending) return
  setWorking(true)
  setError('')
  try {
   await window.assistant.invoke('library:delete', {path: pending.path, confirmed: true})
   setPending(null)
   await load()
   await changed()
  } catch (e) {
   setError(String(e))
  } finally {
   setWorking(false)
  }
 }
 const courseNames = [...new Set([...courses.map(c => c.name), ...files.map(f => f.course).filter(Boolean)])]
 const selectedFiles = files.filter(f => course === '全部课程' || f.course === course)
 const visible = selectedFiles.filter(
  f => (filter === '全部' || f.category === filter) && `${f.name} ${f.course}`.includes(search)
 )
 return (
  <section className="file-management" role="dialog" aria-label="文件管理">
   <header>
    <div>
     <h2>
      <Folder /> 文件管理
     </h2>
    </div>
    <button className="d-btn d-btn-ghost d-btn-square d-btn-sm" aria-label="关闭文件管理" onClick={close}>
     ×
    </button>
   </header>
   <div className="course-folder-heading">
    <strong>课程文件夹</strong>
    <button className="d-btn" disabled={busy || working} onClick={() => setCreating(true)}>
     ＋ 新建课程文件夹
    </button>
   </div>
   {creating && (
    <form
     className="new-folder-form"
     onSubmit={e => {
      e.preventDefault()
      void create()
     }}
    >
     <input
      autoFocus
      aria-label="新课程名称"
      placeholder="输入课程名称"
      value={name}
      onChange={e => setName(e.target.value)}
     />
     <button className="d-btn d-btn-primary" disabled={working || !name.trim()}>
      创建
     </button>
     <button className="d-btn d-btn-ghost" type="button" disabled={working} onClick={() => setCreating(false)}>
      取消
     </button>
    </form>
   )}
   <nav className="course-folder-grid" aria-label="课程文件夹">
    {['全部课程', ...courseNames].map(c => (
     <button key={c} className={course === c ? 'selected' : ''} onClick={() => setCourse(c)}>
      <Folder />
      <span>
       <strong>{c}</strong>
       <small>{files.filter(f => c === '全部课程' || f.course === c).length} 个文件</small>
      </span>
     </button>
    ))}
   </nav>
   <div className="file-management-tools">
    <input
     aria-label="搜索资料文件"
     placeholder="搜索文件或课程…"
     value={search}
     onChange={e => setSearch(e.target.value)}
    />
    <button className="d-btn d-btn-ghost" onClick={() => void load().catch(e => setError(String(e)))}>
     刷新
    </button>
    <button className="d-btn" onClick={() => void window.assistant.invoke('library:open')}>
     打开资料文件夹
    </button>
   </div>
   <nav className="file-category-tabs">
    {['全部', 'PPT', '语音原文', '笔记', '历年卷'].map(c => (
     <button key={c} className={c === filter ? 'active' : ''} onClick={() => setFilter(c)}>
      {c}
      <span>{selectedFiles.filter(f => c === '全部' || f.category === c).length}</span>
     </button>
    ))}
   </nav>
   {error && <p className="alert">{error}</p>}
   <div className="file-management-list">
    {visible.map(f => (
     <article key={f.path}>
      <span className="file-type-icon">
       <Folder />
      </span>
      <div>
       <strong title={f.name}>{f.name}</strong>
       <small>
        {f.category} · {f.course || '未分类'} · {(f.size / 1024 / 1024).toFixed(2)} MB
       </small>
      </div>
      {/\.(pdf|pptx?|docx?|txt|md|srt)$/i.test(f.name) && (
       <button
        className="d-btn"
        aria-label={`打开文件 ${f.name}`}
        onClick={() =>
         void window.assistant.invoke('library:open-file', {path: f.path}).catch(e => setError(String(e)))
        }
       >
        {/\.pdf$/i.test(f.name) ? '打开 PDF' : '打开'}
       </button>
      )}
      <button
       className="d-btn"
       onClick={() => void window.assistant.invoke('library:reveal', {path: f.path}).catch(e => setError(String(e)))}
      >
       定位
      </button>
      <button
       className="d-btn d-btn-ghost d-btn-error d-btn-square d-btn-sm"
       aria-label={`删除文件 ${f.name}`}
       disabled={busy || working}
       onClick={() => setPending(f)}
      >
       <Trash2 />
      </button>
     </article>
    ))}
    {!visible.length && (
     <div className="empty">
      <h3>这里还没有文件</h3>
      <p>导入或导出资料后会显示在这里。</p>
     </div>
    )}
   </div>
   {pending && (
    <div className="confirm-shade">
     <section role="alertdialog" aria-label="确认删除文件">
      <h3>将文件移入回收站？</h3>
      <p>{pending.name}</p>
      <p>相关课次会解除此文件的关联；已经生成的字幕和笔记保留。</p>
      <footer>
       <button className="d-btn d-btn-ghost" disabled={working} onClick={() => setPending(null)}>
        取消
       </button>
       <button className="d-btn d-btn-error" disabled={working} onClick={() => void remove()}>
        移入回收站
       </button>
      </footer>
     </section>
    </div>
   )}
  </section>
 )
}
