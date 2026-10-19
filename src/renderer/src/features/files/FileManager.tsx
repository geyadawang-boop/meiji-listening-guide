import {Button, Input, ToggleButton, ToggleButtonGroup} from '@heroui/react'
import {useEffect, useState} from 'react'
import type {Course, LibraryFile} from '@shared/types'
import {Folder, Trash2} from 'lucide-react'
import {AlertBox} from '@renderer/ui/AlertBox'
import {WindowMenuButton, WindowPanel} from '@renderer/ui/WindowPanel'
import {ConfirmDialog} from '@renderer/ui/ConfirmDialog'
const categories = ['全部', 'PPT', '语音原文', '笔记', '历年卷']
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
  <WindowPanel
   visible
   label="文件管理"
   title="文件管理"
   description="管理原始文件：导入、归类、打开与清理。"
   heading="文件管理"
   subheading={`${course} · ${visible.length} 个文件`}
   menu={['全部课程', ...courseNames].map(c => (
    <WindowMenuButton key={c} active={course === c} icon={<Folder aria-hidden="true" />} onSelect={() => setCourse(c)}>
     {c} · {files.filter(f => c === '全部课程' || f.course === c).length}
    </WindowMenuButton>
   ))}
   actions={
    <>
     <Button variant="tertiary" size="sm" isDisabled={busy || working} onClick={() => setCreating(true)}>
      新建课程文件夹
     </Button>
     <Button variant="ghost" size="sm" onClick={() => void load().catch(e => setError(String(e)))}>
      刷新
     </Button>
     <Button variant="tertiary" size="sm" onClick={() => void window.assistant.invoke('library:open')}>
      打开资料文件夹
     </Button>
    </>
   }
   close={close}
  >
   <div className="panel-section">
    {creating && (
     <form
      className="panel-inline-form"
      onSubmit={e => {
       e.preventDefault()
       void create()
      }}
     >
      <Input
       autoFocus
       aria-label="新课程名称"
       placeholder="输入课程名称"
       value={name}
       onChange={e => setName(e.target.value)}
      />
      <Button type="submit" variant="primary" size="sm" isDisabled={working || !name.trim()}>
       创建
      </Button>
      <Button variant="ghost" size="sm" type="button" isDisabled={working} onClick={() => setCreating(false)}>
       取消
      </Button>
     </form>
    )}
    <div className="file-management-tools">
     <Input
      aria-label="搜索资料文件"
      placeholder="搜索文件或课程…"
      value={search}
      onChange={e => setSearch(e.target.value)}
     />
    </div>
    <ToggleButtonGroup
     aria-label="文件分类"
     selectionMode="single"
     disallowEmptySelection
     selectedKeys={new Set([filter])}
     onSelectionChange={keys => {
      const next = [...keys][0]
      if (typeof next === 'string') setFilter(next)
     }}
     size="sm"
     className="file-category-group"
    >
     {categories.map((c, index) => (
      <ToggleButton key={c} id={c}>
       {index > 0 && <ToggleButtonGroup.Separator />}
       {c} {selectedFiles.filter(f => c === '全部' || f.category === c).length}
      </ToggleButton>
     ))}
    </ToggleButtonGroup>
    {error && <AlertBox>{error}</AlertBox>}
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
        <Button
         variant="tertiary"
         size="sm"
         aria-label={`打开文件 ${f.name}`}
         onClick={() =>
          void window.assistant.invoke('library:open-file', {path: f.path}).catch(e => setError(String(e)))
         }
        >
         {/\.pdf$/i.test(f.name) ? '打开 PDF' : '打开'}
        </Button>
       )}
       <Button
        variant="tertiary"
        size="sm"
        onClick={() => void window.assistant.invoke('library:reveal', {path: f.path}).catch(e => setError(String(e)))}
       >
        定位
       </Button>
       <Button
        variant="danger-soft"
        size="sm"
        isIconOnly
        aria-label={`删除文件 ${f.name}`}
        isDisabled={busy || working}
        onClick={() => setPending(f)}
       >
        <Trash2 />
       </Button>
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
     <ConfirmDialog
      title="将文件移入回收站？"
      confirmLabel="移入回收站"
      busy={working}
      onCancel={() => setPending(null)}
      onConfirm={() => void remove()}
     >
      <p>{pending.name}</p>
      <p>相关课次会解除此文件的关联；已经生成的字幕和笔记保留。</p>
     </ConfirmDialog>
    )}
   </div>
  </WindowPanel>
 )
}
