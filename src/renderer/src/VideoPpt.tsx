import {SubtitleBatchRecords} from './SubtitleBatchRecords'
import {learningViews, LearningIcon, type LearningView} from './LearningNav'
import {VideoMindmap} from './VideoMindmap'
import type {VideoNoteMode, VideoNoteResult} from '../../shared/video-notes'
import ReactMarkdown from 'react-markdown'
import {useEffect, useRef, useState} from 'react'
import {defaultVideoPrompt, type VideoSource, type VideoReview, type VideoSeries, type VideoBatchItem, type PendingVideoTask} from '../../shared/video-ppt'
import type {SubtitleSyncTask} from '../../shared/subtitle-sync'
import type {LibraryFile} from '../../shared/types'
type BiliSubtitle = {title: string; page: number; source: string; warning: string; srt: string; count: number; savedPath?: string}
const invoke = <T,>(action: string, args?: unknown) => window.assistant.invoke<T>(action, args)
const time = (s: number) => `${Math.floor(s / 3600) ? Math.floor(s / 3600) + ':' : ''}${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(Math.floor(s) % 60).padStart(2, '0')}`
export function VideoPpt({visible, view, select, close, courseId, courseName, files, incomingUrl, consumeUrl}: {visible: boolean; view: LearningView; select: (view: LearningView) => void; close: () => void; courseId: string; courseName?: string; files: () => void; incomingUrl?: string; consumeUrl?: () => void}) {
 const [url, setUrl] = useState(''),
  [prompt, setPrompt] = useState(defaultVideoPrompt),
  [source, setSource] = useState<VideoSource | null>(null),
  [review, setReview] = useState<VideoReview | null>(null),
  [busy, setBusy] = useState(false),
  [error, setError] = useState(''),
  [progress, setProgress] = useState(''),
  [checked, setChecked] = useState(false),
  [saved, setSaved] = useState<{path: string; kept: number; removed: number; cleaned: boolean; cleanupWarning: string} | null>(null),
  [pdfs, setPdfs] = useState<LibraryFile[]>([])
 const working = useRef(false)
 const [series, setSeries] = useState<VideoSeries | null>(null),
  [selected, setSelected] = useState<number[]>([]),
  [batch, setBatch] = useState<VideoBatchItem[]>([]),
  [filter, setFilter] = useState('')
 const [pending, setPending] = useState<PendingVideoTask[]>([])
 const [subtitle, setSubtitle] = useState<BiliSubtitle | null>(null),
  [subtitlePage, setSubtitlePage] = useState(1),
  [subtitleSaved, setSubtitleSaved] = useState('')
 const [summaryMode, setSummaryMode] = useState<VideoNoteMode>('detailed')
 const [summary, setSummary] = useState<VideoNoteResult | null>(null)
 const [subtitleBatch, setSubtitleBatch] = useState<VideoBatchItem[]>([])
 const [syncTasks, setSyncTasks] = useState<SubtitleSyncTask[]>([]),
  [syncCategory, setSyncCategory] = useState('')
 const [outputs, setOutputs] = useState<LibraryFile[]>([])
 useEffect(() => setSummary(null), [subtitle])
 useEffect(() => {
  if (visible && incomingUrl) {
   setUrl(incomingUrl)
   setSeries(null)
   setSelected([])
   setBatch([])
   setSubtitle(null)
   setSubtitleSaved('')
   consumeUrl?.()
  }
 }, [visible, incomingUrl])
 async function refresh() {
  const files = (await invoke<LibraryFile[]>('library:list')).filter(f => !courseName || !f.course || f.course === courseName)
  setPdfs(files.filter(f => f.category === 'PPT' && f.name.endsWith('-视频课件.pdf')))
  setOutputs(files.filter(f => (f.category === '语音原文' || f.category === '笔记') && /\.(srt|vtt|txt|md|docx|pdf|svg)$/i.test(f.name)))
  setPending(await invoke('video-ppt:pending'))
  setSyncTasks(await invoke('subtitle-sync:list'))
 }
 useEffect(() => {
  if (visible) void refresh().catch(e => setError(String(e)))
 }, [visible, courseName])
 useEffect(
  () =>
   window.assistant.onEvent(e => {
    if (working.current && e.kind === 'progress') setProgress(e.data.message)
    if (working.current && e.kind === 'video-batch') setBatch(e.items)
   }),
  []
 )
 async function run(fn: () => Promise<void>) {
  if (working.current) return
  working.current = true
  setBusy(true)
  setError('')
  try {
   await fn()
  } catch (e) {
   setError(e instanceof Error ? e.message : String(e))
  } finally {
   working.current = false
   setBusy(false)
   void refresh().catch(e => setError(current => current || '任务列表刷新失败：' + (e instanceof Error ? e.message : String(e))))
  }
 }
 async function load(args: unknown) {
  setReview(null)
  setSource(null)
  setSaved(null)
  setChecked(false)
  setSource(await invoke<VideoSource>('video-ppt:source', args))
 }
 async function open(path: string, reveal = false) {
  await run(async () => {
   await invoke(reveal ? 'library:reveal' : 'library:open-file', {path})
  })
 }
 const active = learningViews.find(item => item.id === view)!
 const isVideo = view === 'videoPpt',
  isSubtitles = view === 'videoSubtitles',
  isNotes = view === 'videoNotes',
  isTasks = view === 'videoTasks'
 const kept = review?.pages.filter(p => p.keep).length || 0
 return (
  <section className="ppt-extract-page video-ppt-page learning-window" aria-label={active.title} hidden={!visible} style={!visible ? {display: 'none'} : undefined}>
   <aside className="learning-menu" aria-label="视频学习导航">
    <h2>视频学习</h2>
    <p>
     把课程视频整理成
     <br />
     可复习的字幕、课件和笔记
    </p>
    {learningViews.map(item => (
     <button key={item.id} className={view === item.id ? 'active' : ''} aria-current={view === item.id ? 'page' : undefined} onClick={() => select(item.id)}>
      <LearningIcon view={item.id} />
      <span>{item.title}</span>
     </button>
    ))}
    <button onClick={close}>
     <span>返回课程对话</span>
    </button>
   </aside>
   <div className="learning-content">
    <header>
     <div>
      <h2>{active.title}</h2>
      <p>{active.description}</p>
     </div>
     <span className="learning-course" title={courseName}>
      {courseName || '未分类资料'}
     </span>
    </header>
    <div className="ppt-extract-form">
     {!isTasks && !isNotes && (
      <div className="learning-source-card">
       <label>
        B 站视频网址
        <input
         aria-label="B 站视频网址"
         placeholder="https://www.bilibili.com/video/BV…/?p=5"
         value={url}
         disabled={busy}
         onChange={e => {
          setUrl(e.target.value)
          setSeries(null)
          setSelected([])
          setBatch([])
          setSubtitle(null)
          setSubtitleSaved('')
         }}
        />
       </label>
       {isVideo && (
        <div className="row">
         <button
          className="primary"
          disabled={busy || !url.trim()}
          onClick={() =>
           void run(async () => {
            setSource(null)
            setReview(null)
            setSaved(null)
            setSaved(await invoke('video-ppt:auto', {url, prompt, courseId: courseId || undefined}))
           })
          }
         >
          仅生成当前分集 PDF
         </button>
         <button
          disabled={busy}
          onClick={() =>
           void run(async () => {
            const path = await invoke<string | null>('video-ppt:pick')
            if (path) {
             setSource(null)
             setReview(null)
             setSaved(null)
             setSaved(await invoke('video-ppt:auto', {path, prompt, courseId: courseId || undefined}))
            }
           })
          }
         >
          使用已下载的视频
         </button>
         {busy && <button onClick={() => void invoke('cancel')}>取消处理</button>}
        </div>
       )}
      </div>
     )}
     {!isTasks && !isNotes && (
      <section className="video-course-picker" aria-label="选择课程分集">
       <header>
        <div>
         <h3>选择课程</h3>
         <p className="hint">读取合集目录后勾选分集，只处理你选中的课程。</p>
        </div>
        <button
         className="primary"
         disabled={busy || !url.trim()}
         onClick={() =>
          void run(async () => {
           setSeries(null)
           setSelected([])
           setBatch([])
           setFilter('')
           const loaded = await invoke<VideoSeries>('video-ppt:series', {url})
           setSeries(loaded)
           const requested = Number(new URL(url).searchParams.get('p') || 1)
           setSubtitlePage(loaded.episodes.some(e => e.page === requested) ? requested : 1)
           setProgress('课程列表已读取，请勾选需要的分集')
          })
         }
        >
         读取课程列表
        </button>
       </header>
       {series && (
        <>
         <strong>{series.title}</strong>
         <div className="video-course-toolbar">
          <input aria-label="搜索课程分集" placeholder="搜索课程名称" disabled={busy} value={filter} onChange={e => setFilter(e.target.value)} />
          <span>
           已选 {selected.length} / {series.episodes.length}
          </span>
          <button disabled={busy} onClick={() => setSelected(series.episodes.filter(e => e.title.includes(filter)).map(e => e.page))}>
           选择当前列表
          </button>
          <button disabled={busy} onClick={() => setSelected([])}>
           清空选择
          </button>
         </div>
         <div className="video-course-list">
          {series.episodes
           .filter(e => e.title.includes(filter))
           .map(e => {
            const item = batch.find(i => i.page === e.page)
            return (
             <label key={e.page} className={selected.includes(e.page) ? 'selected' : ''}>
              <input type="checkbox" aria-label={`选择 P${e.page} ${e.title}`} disabled={busy} checked={selected.includes(e.page)} onChange={ev => setSelected(s => (ev.target.checked ? [...s, e.page] : s.filter(p => p !== e.page)))} />
              <span className="video-course-number">P{e.page}</span>
              <span className="video-course-title">
               {e.title}
               {item?.error && <small role="alert">{item.error}</small>}
              </span>
              <span className="hint">{item?.status || time(e.duration)}</span>
              {item?.path && (
               <button
                type="button"
                disabled={busy}
                onClick={ev => {
                 ev.preventDefault()
                 void open(item.path!)
                }}
               >
                打开 PDF
               </button>
              )}
             </label>
            )
           })}
         </div>
         {isVideo && (
          <div className="video-course-actions">
           <span className="hint">每个分集单独保存 PDF，完成后清理对应视频。</span>
           <button
            className="primary"
            disabled={busy || !selected.length}
            onClick={() =>
             void run(async () => {
              setSaved(null)
              setSource(null)
              setReview(null)
              const result = await invoke<VideoBatchItem[]>('video-ppt:batch', {url, pages: selected, prompt, courseId: courseId || undefined})
              setBatch(result)
              setProgress(`所选课程已处理：完成 ${result.filter(i => i.status === '已完成').length}，失败 ${result.filter(i => i.status === '失败').length}`)
             })
            }
           >
            生成所选课件 PDF{selected.length ? `（${selected.length}）` : ''}
           </button>
          </div>
         )}
        </>
       )}
      </section>
     )}
     {isSubtitles && (
      <section className="video-course-picker" aria-label="B 站视频字幕">
       <header>
        <div>
         <h3>视频字幕</h3>
         <p className="hint">读取所选分集的站内字幕；没有字幕时可用离线模型转写。结果保存到当前课程的“语音原文”。</p>
        </div>
       </header>
       <div className="row">
        <button
         disabled={busy}
         onClick={() =>
          void run(async () => {
           const result = await invoke<BiliSubtitle | null>('video-ppt:subtitle-import', {courseId: courseId || undefined})
           if (result) {
            setSubtitle(result)
            setSubtitleSaved(result.savedPath || '')
           }
          })
         }
        >
         载入已保存的 SRT
        </button>
        {series && (
         <label>
          选择分集
          <select
           aria-label="字幕分集"
           value={subtitlePage}
           disabled={busy}
           onChange={e => {
            setSubtitlePage(Number(e.target.value))
            setSubtitle(null)
            setSubtitleSaved('')
           }}
          >
           {series.episodes.map(e => (
            <option key={e.page} value={e.page}>
             P{e.page} · {e.title}
            </option>
           ))}
          </select>
         </label>
        )}
        <button
         className="primary"
         disabled={busy || !url.trim()}
         onClick={() =>
          void run(async () => {
           const target = series?.episodes.find(e => e.page === subtitlePage)?.url || url
           setSubtitleSaved('')
           setSubtitle(await invoke<BiliSubtitle>('video-ppt:subtitle', {url: target}))
          })
         }
        >
         读取字幕
        </button>
        <button
         disabled={busy || !url.trim()}
         onClick={() =>
          void run(async () => {
           const target = series?.episodes.find(e => e.page === subtitlePage)?.url || url
           const result = await invoke<BiliSubtitle>('video-ppt:subtitle-transcribe', {url: target, courseId: courseId || undefined})
           setSubtitle(result)
           setSubtitleSaved(result.savedPath || '')
          })
         }
        >
         无站内字幕？离线转写并保存
        </button>
        <button
         disabled={busy}
         onClick={() =>
          void run(async () => {
           const result = await invoke<BiliSubtitle | null>('video-ppt:subtitle-transcribe-local', {courseId: courseId || undefined})
           if (result) {
            setSubtitle(result)
            setSubtitleSaved(result.savedPath || '')
           }
          })
         }
        >
         选择本地视频转写
        </button>
       </div>
       {subtitle && (
        <>
         <p>
          {subtitle.title} · {subtitle.source} · {subtitle.count} 条
         </p>
         {subtitle.warning && (
          <p className="hint" role="alert">
           {subtitle.warning}
          </p>
         )}
         <details>
          <summary>预览完整字幕</summary>
          <textarea className="srt-editor" readOnly value={subtitle.srt} />
         </details>
         <button
          disabled={busy || !!subtitle.savedPath}
          onClick={() =>
           void run(async () => {
            const target = series?.episodes.find(e => e.page === subtitlePage)?.url || url
            setSubtitleSaved(await invoke<string>('video-ppt:subtitle-save', {url: target, title: subtitle.title, srt: subtitle.srt, courseId: courseId || undefined}))
           })
          }
         >
          保存字幕 SRT
         </button>
         <div className="row">
          {(['txt', 'md', 'vtt'] as const).map(format => (
           <button
            key={format}
            disabled={busy}
            onClick={() =>
             void run(async () => {
              const path = await invoke<string>('video-ppt:subtitle-export', {title: subtitle.title, srt: subtitle.srt, format, courseId: courseId || undefined})
              setProgress(`${format.toUpperCase()} 字幕已保存：${path}`)
             })
            }
           >
            导出 {format.toUpperCase()}
           </button>
          ))}
          <button disabled={busy} onClick={() => select('videoNotes')}>
           整理课程笔记
          </button>
         </div>
         {subtitleSaved && <p role="status">已保存：{subtitleSaved}</p>}
        </>
       )}
      </section>
     )}
     {series && isSubtitles && (
      <section className="video-course-picker" aria-label="批量获取分集字幕">
       <header>
        <div>
         <h3>批量获取分集字幕</h3>
         <p className="hint">使用上方勾选的分集；优先保存站内字幕，没有字幕时逐集离线转写。每集单独保存，成功后清理该集临时视频。</p>
        </div>
        <button
         className="primary"
         disabled={busy || !selected.length}
         onClick={() =>
          void run(async () => {
           setSubtitleBatch([])
           const result = await invoke<VideoBatchItem[]>('video-ppt:batch-subtitles', {url, pages: selected, courseId: courseId || undefined})
           setSubtitleBatch(result)
           setProgress(`字幕处理完成：成功 ${result.filter(i => i.status === '已完成').length}，失败 ${result.filter(i => i.status === '失败').length}`)
          })
         }
        >
         获取所选分集字幕（{selected.length}）
        </button>
       </header>
       {subtitleBatch.map(item => (
        <div className="video-course-toolbar" key={item.page}>
         <span>
          P{item.page} · {item.title} · {item.status}
         </span>
         {item.path && (
          <button disabled={busy} onClick={() => void open(item.path!)}>
           打开字幕
          </button>
         )}
         {item.error && <span role="alert">{item.error}</span>}
        </div>
       ))}
      </section>
     )}
     {series && isSubtitles && (
      <section className="knowledge-card" aria-label="同步字幕到知识库">
       <header>
        <div>
         <h3>同步字幕到知识库</h3>
         <p className="hint">仅同步上方勾选的分集，保留分集网址和字幕版本。相同内容重复同步不新增资料；同时保存课程 SRT。没有站内字幕时保留失败记录，可离线转写后为该分集选择已有 SRT。</p>
        </div>
       </header>
       <div className="row">
        <label>
         知识库分类
         <input aria-label="字幕知识库分类" placeholder={courseName || '未分类'} disabled={busy} value={syncCategory} onChange={e => setSyncCategory(e.target.value)} />
        </label>
        <button
         className="primary"
         disabled={busy || !selected.length}
         onClick={() =>
          void run(async () => {
           const task = await invoke<SubtitleSyncTask>('subtitle-sync:start', {url, pages: selected, category: syncCategory.trim() || courseName || '', courseId: courseId || undefined})
           setSyncTasks(current => [task, ...current.filter(item => item.id !== task.id)])
           setProgress(`同步结束：完成 ${task.items.filter(item => item.status === '已完成').length}，失败 ${task.items.filter(item => item.status === '失败').length}`)
          })
         }
        >
         同步所选字幕（{selected.length}）
        </button>
       </div>
       <p className="hint">笔记、导图和 PDF 沿用对应页面的生成按钮，由你选择是否生成。</p>
      </section>
     )}
     {(isTasks || isSubtitles) && <SubtitleBatchRecords visible={visible} tasks={syncTasks} busy={busy} run={run} refresh={refresh} courseName={courseName} />}
     {isNotes && (
      <section className="video-course-picker" aria-label="视频课程摘要">
       <header>
        <div>
         <h3>视频课程摘要</h3>
         <p className="hint">使用已取得或载入的字幕整理笔记，附原话与时间点，并保存到当前课程。</p>
        </div>
       </header>
       <div className="row">
        <button
         disabled={busy}
         onClick={() =>
          void run(async () => {
           const result = await invoke<BiliSubtitle | null>('video-ppt:subtitle-import', {courseId: courseId || undefined})
           if (result) {
            setSubtitle(result)
            setSubtitleSaved(result.savedPath || '')
           }
          })
         }
        >
         载入已保存的 SRT
        </button>
        <label>
         摘要形式
         <select aria-label="摘要形式" value={summaryMode} disabled={busy} onChange={e => setSummaryMode(e.target.value as VideoNoteMode)}>
          <option value="brief">简要摘要</option>
          <option value="detailed">详细摘要</option>
          <option value="keypoints">课程要点</option>
          <option value="mindmap">思维导图</option>
         </select>
        </label>
        <button
         className="primary"
         disabled={busy || !subtitle}
         onClick={() =>
          void run(async () => {
           setSummary(null)
           setSummary(await invoke('video-ppt:summary', {mode: summaryMode, srt: subtitle!.srt, title: subtitle!.title, courseId: courseId || undefined}))
          })
         }
        >
         根据字幕生成并保存
        </button>
       </div>
       {subtitle && (
        <p className="hint">
         当前字幕：{subtitle.title} · {subtitle.count} 条 · {subtitle.source}
        </p>
       )}
       {summary && (
        <>
         <p role="status">已保存课程笔记 · {summary.count} 项字幕引文已核实</p>
         <details className="learning-path">
          <summary>查看保存位置</summary>
          <input aria-label="笔记保存位置" readOnly value={summary.path} />
         </details>
         <div className="learning-summary">{summaryMode === 'mindmap' ? <VideoMindmap title={subtitle?.title || '课程笔记'} points={summary.points} /> : <ReactMarkdown>{summary.markdown}</ReactMarkdown>}</div>
         <div className="row">
          <button disabled={busy} onClick={() => void open(summary.path)}>
           打开 Markdown
          </button>
          {(['docx', 'pdf', 'svg'] as const).map(format => (
           <button
            key={format}
            disabled={busy}
            onClick={() =>
             void run(async () => {
              const path = await invoke<string>('video-ppt:notes-export', {path: summary.path, format})
              setProgress(`${format.toUpperCase()} 已保存：${path}`)
              await invoke('library:reveal', {path})
             })
            }
           >
            导出 {format.toUpperCase()}
           </button>
          ))}
         </div>
        </>
       )}
      </section>
     )}
     {isVideo && (
      <div className="video-options">
       <details className="video-option">
        <summary>
         <span className="video-option-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24">
           <path d="M4 7h16M4 17h16M8 4v6M16 14v6" />
          </svg>
         </span>
         <span>手动检查与调整</span>
         <span className="video-option-chevron" aria-hidden="true" />
        </summary>
        <div className="video-option-body">
         <button
          disabled={busy}
          onClick={() =>
           void run(async () => {
            const path = await invoke<string | null>('video-ppt:pick')
            if (path) await load({path})
           })
          }
         >
          手动框选已下载视频
         </button>
        </div>
       </details>
       <details className="video-option">
        <summary>
         <span className="video-option-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24">
           <path d="M8 4h8l4 4v12H4V4h4M15 4v5h5M8 13h8M8 17h5" />
          </svg>
         </span>
         <span>处理提示词</span>
         <span className="video-option-chevron" aria-hidden="true" />
        </summary>
        <div className="video-option-body">
         <textarea aria-label="视频处理提示词" value={prompt} disabled={busy} onChange={e => setPrompt(e.target.value)} />
         <button disabled={busy} onClick={() => setPrompt(defaultVideoPrompt)}>
          恢复默认提示词
         </button>
        </div>
       </details>
      </div>
     )}
     {isVideo && <p className="hint">保存到：{courseName || '未分类资料'}。全程后台下载、裁剪和去重，PDF 检查成功后清理本次视频和临时图片。</p>}
    </div>
    {error && (
     <div className="alert" role="alert">
      {error}
     </div>
    )}
    {progress && (
     <div className="learning-status" role="status">
      <span>{progress}</span>
      {busy && <button onClick={() => void invoke('cancel')}>取消任务</button>}
     </div>
    )}
    {isVideo && source && !review && !saved && (
     <section className="video-region">
      <h3>确认 PPT 区域 · {time(source.duration)}</h3>
      {source.warning && <p role="alert">{source.warning}</p>}
      <div className="video-region-image">
       <img alt="完整视频画面，确认 PPT 区域" src={source.preview} />
       <div style={{left: source.crop.left * 100 + '%', top: source.crop.top * 100 + '%', width: (source.crop.right - source.crop.left) * 100 + '%', height: (source.crop.bottom - source.crop.top) * 100 + '%'}} />
      </div>
      <div className="ppt-crop-inputs">
       {(['left', 'right', 'top', 'bottom'] as const).map((key, i) => (
        <label key={key}>
         {['左边界', '右边界', '上边界', '下边界'][i]} %<input type="number" min="0" max="100" step=".1" aria-label={`PPT ${key}`} value={Number((source.crop[key] * 100).toFixed(1))} disabled={busy} onChange={e => setSource({...source, crop: {...source.crop, [key]: Number(e.target.value) / 100}})} />
        </label>
       ))}
      </div>
      <button
       className="primary"
       disabled={busy}
       onClick={() =>
        void run(async () => {
         setChecked(false)
         setReview(await invoke<VideoReview>('video-ppt:extract', {id: source.id, crop: source.crop, prompt}))
        })
       }
      >
       确认区域，提取整段视频
      </button>
     </section>
    )}
    {isVideo && review && !saved && (
     <>
      <div className="ppt-extract-summary">
       <strong>
        保留 {kept} 页 · 删除 {review.pages.length - kept} 页
       </strong>
       <label>
        <input type="checkbox" checked={checked} disabled={busy} onChange={e => setChecked(e.target.checked)} />
        已检查裁剪、重复和页面内容
       </label>
       <button
        className="primary"
        disabled={busy || !checked || !kept}
        onClick={() =>
         void run(async () => {
          setSaved(await invoke('video-ppt:export', {id: review.id, courseId: courseId || undefined, checked, pages: review.pages.map(({page, keep, crop}) => ({page, keep, crop}))}))
          await refresh()
          setProgress('PDF 已保存并逐页检查')
         })
        }
       >
        保存 PDF 并清理临时文件
       </button>
       <button
        disabled={busy}
        onClick={() => {
         setReview(null)
         setChecked(false)
        }}
       >
        重新框选
       </button>
      </div>
      <div className="ppt-extract-grid">
       {review.pages.map(p => {
        const c = p.crop,
         w = c.right - c.left,
         h = c.bottom - c.top
        return (
         <article key={p.page} className={p.keep ? '' : 'removed'}>
          <label>
           <input
            type="checkbox"
            disabled={busy}
            checked={p.keep}
            onChange={e => {
             setChecked(false)
             setReview({...review, pages: review.pages.map(q => (q.page === p.page ? {...q, keep: e.target.checked} : q))})
            }}
           />
           第 {p.page} 页 · {time(p.time)} · {p.keep ? '保留' : '删除'}
          </label>
          <div className="ppt-extract-preview" style={{aspectRatio: (p.width * w) / (p.height * h)}}>
           <img alt={`视频课件第 ${p.page} 页`} src={p.preview} style={{width: 100 / w + '%', height: 100 / h + '%', left: (-100 * c.left) / w + '%', top: (-100 * c.top) / h + '%'}} />
          </div>
          <p>{p.reason}</p>
          <details>
           <summary>调整此页裁剪</summary>
           <div className="ppt-crop-inputs">
            {(['left', 'right', 'top', 'bottom'] as const).map((key, i) => (
             <label key={key}>
              {['左', '右', '上', '下'][i]} %
              <input
               type="number"
               min="0"
               max="100"
               step=".1"
               disabled={busy}
               value={Number((c[key] * 100).toFixed(1))}
               onChange={e => {
                const crop = {...c, [key]: Number(e.target.value) / 100}
                if (crop.right - crop.left >= 0.1 && crop.bottom - crop.top >= 0.1) {
                 setChecked(false)
                 setReview({...review, pages: review.pages.map(q => (q.page === p.page ? {...q, crop} : q))})
                }
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
    {isVideo && saved && (
     <footer>
      <strong>
       已保存 {saved.kept} 页 PDF · {saved.cleaned ? '本次视频和临时文件已清理' : '临时文件已保留'}
      </strong>
      {saved.cleanupWarning && <p role="alert">{saved.cleanupWarning}</p>}
      <input aria-label="视频 PDF 输出路径" readOnly value={saved.path} />
      <button onClick={() => void open(saved.path)}>打开 PDF</button>
      <button onClick={() => void open(saved.path, true)}>在文件夹中查看</button>
     </footer>
    )}
    {isTasks && !!pending.length && (
     <section className="ppt-export-history">
      <h3>未完成的任务</h3>
      {pending.map(t => (
       <article key={t.id}>
        <div>
         <strong>{t.name}</strong>
         {t.kind === 'subtitle' && <p className="hint">{t.savedPath ? '字幕已保存，待核对并清理临时视频' : '字幕转写可继续'}</p>}
         {t.error && (
          <p className="hint" role="alert">
           {t.error}
          </p>
         )}
        </div>
        <button
         disabled={busy}
         onClick={() =>
          void run(async () => {
           await invoke('video-ppt:reveal', {id: t.id})
          })
         }
        >
         查看保留文件
        </button>
        {t.kind === 'subtitle' ? (
         <button
          disabled={busy || !!t.error}
          onClick={() =>
           void run(async () => {
            const result = await invoke<BiliSubtitle>('video-ppt:resume-subtitle', {id: t.id})
            setSubtitle(result)
            setSubtitleSaved(result.savedPath || '')
            setProgress('字幕任务已完成，临时视频已清理')
            select('videoSubtitles')
           })
          }
         >
          {t.savedPath ? '核对字幕并清理' : '继续字幕转写'}
         </button>
        ) : (
         <button
          disabled={busy || !!t.error}
          onClick={() =>
           void run(async () => {
            const restored = await invoke<{source: VideoSource; review: VideoReview | null}>('video-ppt:restore', {id: t.id})
            setSource(restored.source)
            setReview(restored.review)
            setSaved(null)
            setChecked(false)
            setProgress('已恢复任务，原视频和候选页仍在')
            select('videoPpt')
           })
          }
         >
          继续检查
         </button>
        )}
       </article>
      ))}
     </section>
    )}
    {(isVideo || isTasks) && (
     <section className="ppt-export-history" aria-label="视频课件 PDF">
      <header>
       <h3>已保存的 PDF</h3>
       <button onClick={files}>查看课程文件</button>
      </header>
      {pdfs.map(f => (
       <article key={f.path}>
        <strong>{f.name}</strong>
        <button onClick={() => void open(f.path)}>打开 PDF</button>
        <button onClick={() => void open(f.path, true)}>定位</button>
       </article>
      ))}
     </section>
    )}
    {isTasks && !!outputs.length && (
     <section className="ppt-export-history">
      <header>
       <h3>课程字幕与笔记</h3>
       <button onClick={files}>查看全部文件</button>
      </header>
      {outputs.map(file => (
       <article key={file.path}>
        <div>
         <strong>{file.name}</strong>
         <p className="hint">
          {file.category} · {file.course || '未分类'}
         </p>
        </div>
        {!/\.(vtt|svg)$/i.test(file.name) && (
         <button disabled={busy} onClick={() => void open(file.path)}>
          打开
         </button>
        )}
        <button disabled={busy} onClick={() => void open(file.path, true)}>
         定位
        </button>
       </article>
      ))}
     </section>
    )}
    {isTasks && !pending.length && !pdfs.length && !outputs.length && (
     <div className="learning-empty">
      <LearningIcon view="videoTasks" />
      <h3>暂无视频任务</h3>
      <p>完成的课件和需要继续的任务会显示在这里。</p>
     </div>
    )}
   </div>
  </section>
 )
}
