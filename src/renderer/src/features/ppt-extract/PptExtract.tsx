import {Button, Checkbox, Input, TextArea} from '@heroui/react'
import type {LibraryFile} from '@shared/types'
import {useEffect, useRef, useState} from 'react'
import {defaultPptExtractPrompt, type PptExtractReview, type PptExtractPage} from '@shared/ppt-extract'
import {notify} from '@renderer/ui/ToastHost'
import {SettingsLink} from '@renderer/app/settings-navigation'
const invoke = <T,>(action: string, args?: unknown) => window.assistant.invoke<T>(action, args)
export function PptExtractPanel({
 visible,
 courseId,
 courseName,
 files
}: {
 visible: boolean
 courseId: string
 courseName?: string
 files: () => void
}) {
 const [path, setPath] = useState(''),
  [prompt, setPrompt] = useState(defaultPptExtractPrompt),
  [review, setReview] = useState<PptExtractReview | null>(null),
  [busy, setBusy] = useState(false),
  [progress, setProgress] = useState(''),
  [saved, setSaved] = useState<{
   path: string
   kept: number
   removed: number
   sourceDeleted: boolean
   cleanupWarning: string
  } | null>(null)
 const [pdfs, setPdfs] = useState<LibraryFile[]>([]),
  [sourceDeleted, setSourceDeleted] = useState(false)
 async function refresh() {
  setPdfs(
   (await invoke<LibraryFile[]>('library:list')).filter(
    f => f.category === 'PPT' && /\.pdf$/i.test(f.name) && (!courseName || !f.course || f.course === courseName)
   )
  )
 }
 useEffect(() => {
  if (visible) void refresh().catch(e => notify.error(e, {title: '读取 PPT 文件失败'}))
 }, [visible, courseName])
 async function openFile(path: string, reveal = false) {
  try {
   await invoke(reveal ? 'library:reveal' : 'library:open-file', {path})
  } catch (e) {
   notify.error(e, {title: '打开文件失败'})
  }
 }
 const working = useRef(false)
 useEffect(
  () =>
   window.assistant.onEvent(e => {
    if (working.current && e.kind === 'progress') setProgress(e.data.message)
   }),
  []
 )
 async function run(fn: () => Promise<void>) {
  if (working.current) return
  working.current = true
  setBusy(true)
  try {
   await fn()
  } catch (e) {
   notify.error(e)
  } finally {
   working.current = false
   setBusy(false)
  }
 }
 function choose(file: string) {
  setPath(file)
  setSourceDeleted(false)
  setReview(null)
  setSaved(null)
  setProgress('')
 }
 function change(page: number, value: Partial<PptExtractPage>) {
  setReview(r => (r ? {...r, pages: r.pages.map(p => (p.page === page ? {...p, ...value} : p))} : r))
  setSaved(null)
 }
 const kept = review?.pages.filter(p => p.keep).length || 0
 return (
  <div
   className="ppt-extract-panel"
   onDragOver={e => e.preventDefault()}
   onDrop={e => {
    e.preventDefault()
    e.stopPropagation()
    if (!busy && e.dataTransfer.files[0]) choose(window.assistant.filePath(e.dataTransfer.files[0]))
   }}
  >
   <div className="ppt-extract-form">
    <div className="row">
     <Button
      variant="tertiary"
      size="sm"
      isDisabled={busy}
      onClick={() =>
       void run(async () => {
        const file = await invoke<string | null>('ppt-extract:pick')
        if (file) choose(file)
       })
      }
     >
      选择 PPTX
     </Button>
     <span>{path.split(/[\\/]/).at(-1) || '拖入图片型 PPTX'}</span>
    </div>
    <label>
     处理提示词
     <TextArea
      aria-label="PPT 处理提示词"
      value={prompt}
      disabled={busy}
      onChange={e => {
       setPrompt(e.target.value)
       setReview(null)
       setSaved(null)
      }}
     />
    </label>
    <div className="row">
     <Button
      variant="tertiary"
      size="sm"
      isDisabled={busy}
      onClick={() => {
       setPrompt(defaultPptExtractPrompt)
       setReview(null)
       setSaved(null)
      }}
     >
      恢复默认提示词
     </Button>
     <Button
      variant="primary"
      size="sm"
      isDisabled={busy || !path || !prompt.trim()}
      onClick={() =>
       void run(async () => {
        setReview(null)
        setSaved(null)
        setProgress('正在准备 PPT')
        setReview(await invoke<PptExtractReview>('ppt-extract:analyze', {path, prompt}))
       })
      }
     >
      分析并预览
     </Button>
     {busy && (
      <Button variant="ghost" size="sm" onClick={() => void invoke('cancel')}>
       取消处理
      </Button>
     )}
    </div>
    {sourceDeleted && <p className="hint">原始 PPT 已删除。现有预览可以调整并再次导出；重新分析请另选 PPT。</p>}
    <p className="hint">
     保存到：{courseName || '未分类资料'}。 <SettingsLink section="qwen">视觉模型设置</SettingsLink>
    </p>
    <p className="hint">
     整份 PPT 在一个新对话中分析。支持每页一张图片的 PPTX，结果保存到 PPT 资料文件夹；PDF
     保存并检查成功后自动删除对应的原始 PPT。按原页序导出一份 PDF，每页保留裁剪后的尺寸。
    </p>
   </div>
   {progress && <p aria-live="polite">{progress}</p>}
   {saved && (
    <footer>
     <span>
      已导出 {saved.kept} 页，删除 {saved.removed} 页{saved.sourceDeleted ? ' · 原始 PPT 已删除' : ''}
     </span>
     {saved.cleanupWarning && <p role="alert">{saved.cleanupWarning}</p>}
     <Input aria-label="截取 PPT 输出路径" readOnly value={saved.path} />
     <Button variant="primary" size="sm" onClick={() => void openFile(saved.path)}>
      打开 PDF
     </Button>
     <Button variant="tertiary" size="sm" onClick={() => void openFile(saved.path, true)}>
      在文件夹中查看
     </Button>
    </footer>
   )}
   {review && (
    <>
     <div className="ppt-extract-summary">
      <strong>
       保留 {kept} 页 · 删除 {review.pages.length - kept} 页
      </strong>
      <Button
       variant="tertiary"
       size="sm"
       isDisabled={busy}
       onClick={() => setReview({...review, pages: review.pages.map(p => ({...p, keep: p.width > 0 && p.height > 0}))})}
      >
       保留全部
      </Button>
      <Button
       variant="primary"
       size="sm"
       isDisabled={busy || !kept}
       onClick={() =>
        void run(async () => {
         setProgress('正在生成 PDF')
         const result = await invoke<{
          path: string
          kept: number
          removed: number
          sourceDeleted: boolean
          cleanupWarning: string
         }>('ppt-extract:export', {
          id: review.id,
          courseId: courseId || undefined,
          pages: review.pages.map(({page, keep, crop}) => ({page, keep, crop}))
         })
         setSaved(result)
         setSourceDeleted(result.sourceDeleted)
         await refresh()
         setProgress('导出完成')
         notify.success('PPT 已截取并导出', {description: result.path, timeout: 6000})
         if (result.cleanupWarning) notify.warning(result.cleanupWarning, {timeout: 6000})
        })
       }
      >
       导出 PDF
      </Button>
     </div>
     <div className="ppt-extract-grid">
      {review.pages.map(p => {
       const c = p.crop,
        w = c.right - c.left,
        h = c.bottom - c.top
       return (
        <article key={p.page} className={p.keep ? '' : 'removed'}>
         <Checkbox
          isSelected={p.keep}
          isDisabled={busy || !p.preview}
          aria-label={`保留第 ${p.page} 页`}
          onChange={checked => change(p.page, {keep: checked})}
         >
          <Checkbox.Content>
           <Checkbox.Control>
            <Checkbox.Indicator />
           </Checkbox.Control>
           第 {p.page} 页 · {p.keep ? '保留' : '删除'}
          </Checkbox.Content>
         </Checkbox>
         <div className="ppt-extract-preview" style={{aspectRatio: p.height ? (p.width * w) / (p.height * h) : 16 / 9}}>
          {p.preview ? (
           <img
            alt={`第 ${p.page} 页裁剪预览`}
            src={p.preview}
            style={{
             width: 100 / w + '%',
             height: 100 / h + '%',
             left: (-100 * c.left) / w + '%',
             top: (-100 * c.top) / h + '%'
            }}
           />
          ) : (
           <span>图片无法读取</span>
          )}
         </div>
         <p>{p.reason}</p>
         <details>
          <summary>调整裁剪范围</summary>
          <div className="ppt-crop-inputs">
           {(['left', 'right', 'top', 'bottom'] as const).map((key, i) => (
            <label key={key}>
             {['左边界', '右边界', '上边界', '下边界'][i]} %
             <Input
              type="number"
              step=".1"
              min="0"
              max="100"
              aria-label={`第 ${p.page} 页${['左边界', '右边界', '上边界', '下边界'][i]}`}
              disabled={busy}
              value={Number((c[key] * 100).toFixed(1))}
              onChange={e => {
               const next = {...c, [key]: Number(e.target.value) / 100}
               if (next.right - next.left > 0.05 && next.bottom - next.top > 0.05) change(p.page, {crop: next})
              }}
             />
            </label>
           ))}
          </div>
         </details>
        </article>
       )
      })}
     </div>
    </>
   )}
   <section className="ppt-export-history" aria-label="已保存的 PDF">
    <header>
     <h3>已保存的 PDF</h3>
     <Button variant="tertiary" size="sm" onClick={files}>
      查看全部课程文件
     </Button>
    </header>
    {pdfs.length ? (
     pdfs.slice(0, 8).map(f => (
      <article key={f.path}>
       <div>
        <strong>{f.name}</strong>
        <small>
         {f.course || '未分类'} · {(f.size / 1024 / 1024).toFixed(2)} MB
        </small>
       </div>
       <Button variant="tertiary" size="sm" onClick={() => void openFile(f.path)}>
        打开 PDF
       </Button>
       <Button variant="tertiary" size="sm" onClick={() => void openFile(f.path, true)}>
        定位
       </Button>
      </article>
     ))
    ) : (
     <p className="hint">导出的 PDF 会保存在这里，重新打开软件后也能找到。</p>
    )}
   </section>
  </div>
 )
}
