import {Button, Card, Checkbox, Input, TextArea} from '@heroui/react'
import {learningViews, LearningIcon, type LearningView} from '@renderer/features/video/LearningNav'
import {VideoMindmap} from '@renderer/features/video/VideoMindmap'
import {BiliResourcesPanel} from '@renderer/features/bilibili/BiliResources'
import {notify} from '@renderer/ui/ToastHost'
import {WindowMenuButton, WindowPanel} from '@renderer/ui/WindowPanel'
import {SelectField} from '@renderer/ui/SelectField'
import {SettingsLink} from '@renderer/app/settings-navigation'
import {FileText, SlidersHorizontal} from 'lucide-react'
import type {VideoNoteMode, VideoNoteResult} from '@shared/video-notes'
import ReactMarkdown from 'react-markdown'
import {useEffect, useRef, useState} from 'react'
import {
 defaultVideoPrompt,
 type VideoSource,
 type VideoReview,
 type VideoSeries,
 type VideoBatchItem
} from '@shared/video-ppt'
import type {SubtitleSyncTask} from '@shared/subtitle-sync'
type BiliSubtitle = {
 title: string
 page: number
 source: string
 warning: string
 srt: string
 count: number
 savedPath?: string
}
const invoke = <T,>(action: string, args?: unknown) => window.assistant.invoke<T>(action, args)
const time = (s: number) =>
 `${Math.floor(s / 3600) ? Math.floor(s / 3600) + ':' : ''}${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(Math.floor(s) % 60).padStart(2, '0')}`
export function VideoPpt({
 visible,
 view,
 select,
 close,
 courseId,
 courseName,
 restoreTaskId,
 onTaskRestored
}: {
 visible: boolean
 view: LearningView
 select: (view: LearningView) => void
 close: () => void
 courseId: string
 courseName?: string
 restoreTaskId?: string
 onTaskRestored?: () => void
}) {
 const [url, setUrl] = useState(''),
  [prompt, setPrompt] = useState(defaultVideoPrompt),
  [source, setSource] = useState<VideoSource | null>(null),
  [review, setReview] = useState<VideoReview | null>(null),
  [busy, setBusy] = useState(false),
  [progress, setProgress] = useState(''),
  [checked, setChecked] = useState(false),
  [saved, setSaved] = useState<{
   path: string
   kept: number
   removed: number
   cleaned: boolean
   cleanupWarning: string
  } | null>(null)
 const working = useRef(false)
 const [series, setSeries] = useState<VideoSeries | null>(null),
  [selected, setSelected] = useState<number[]>([]),
  [batch, setBatch] = useState<VideoBatchItem[]>([]),
  [filter, setFilter] = useState('')
 const [subtitle, setSubtitle] = useState<BiliSubtitle | null>(null),
  [subtitlePage, setSubtitlePage] = useState(1),
  [subtitleSaved, setSubtitleSaved] = useState('')
 const [summaryMode, setSummaryMode] = useState<VideoNoteMode>('detailed')
 const [summary, setSummary] = useState<VideoNoteResult | null>(null)
 const [subtitleBatch, setSubtitleBatch] = useState<VideoBatchItem[]>([])
 const [syncCategory, setSyncCategory] = useState('')
 useEffect(() => setSummary(null), [subtitle])
 function openFromResources(url: string, kind: 'videoPpt' | 'videoSubtitles') {
  setUrl(url)
  setSeries(null)
  setSelected([])
  setBatch([])
  setSubtitle(null)
  setSubtitleSaved('')
  select(kind)
 }
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
  try {
   await fn()
  } catch (e) {
   notify.error(e)
  } finally {
   working.current = false
   setBusy(false)
  }
 }
 useEffect(() => {
  if (!visible || !restoreTaskId) return
  void run(async () => {
   const restored = await invoke<{source: VideoSource; review: VideoReview | null}>('video-ppt:restore', {
    id: restoreTaskId
   })
   setSource(restored.source)
   setReview(restored.review)
   setSaved(null)
   setChecked(false)
   setProgress('已恢复任务，原视频和候选页仍在')
   onTaskRestored?.()
  })
 }, [visible, restoreTaskId])

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
 const isResources = view === 'biliResources',
  isVideo = view === 'videoPpt',
  isSubtitles = view === 'videoSubtitles',
  isNotes = view === 'videoNotes'
 const kept = review?.pages.filter(p => p.keep).length || 0
 return (
  <WindowPanel
   visible={visible}
   label={active.title}
   title="视频学习"
   className="video-ppt-page"
   description={
    <>
     把课程视频整理成
     <br />
     可复习的字幕、课件和笔记
    </>
   }
   heading={active.title}
   subheading={active.description}
   menu={learningViews.map(item => (
    <WindowMenuButton
     key={item.id}
     active={view === item.id}
     icon={<LearningIcon view={item.id} />}
     onSelect={() => select(item.id)}
    >
     {item.title}
    </WindowMenuButton>
   ))}
   actions={
    <span className="learning-course" title={courseName}>
     {courseName || '未分类资料'}
    </span>
   }
   close={close}
  >
   <div className="ppt-extract-form">
    {isResources && (
     <BiliResourcesPanel visible={visible} useVideo={openFromResources} courseId={courseId} courseName={courseName} />
    )}
    {!isNotes && !isResources && (
     <div className="learning-source-card">
      <label>
       B 站视频网址
       <Input
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
        <Button
         variant="tertiary"
         size="sm"
         isDisabled={busy || !url.trim()}
         onClick={() =>
          void run(async () => {
           setSource(null)
           setReview(null)
           setSaved(null)
           setSaved(await invoke('video-ppt:auto', {url, prompt, courseId: courseId || undefined}))
           notify.success('视频课件已生成')
          })
         }
        >
         仅生成当前分集 PDF
        </Button>
        <Button
         variant="ghost"
         size="sm"
         isDisabled={busy}
         onClick={() =>
          void run(async () => {
           const path = await invoke<string | null>('video-ppt:pick')
           if (path) {
            setSource(null)
            setReview(null)
            setSaved(null)
            setSaved(await invoke('video-ppt:auto', {path, prompt, courseId: courseId || undefined}))
            notify.success('视频课件已生成')
           }
          })
         }
        >
         使用已下载的视频
        </Button>
        {busy && (
         <Button variant="ghost" size="sm" onClick={() => void invoke('cancel')}>
          取消处理
         </Button>
        )}
       </div>
      )}
     </div>
    )}
    {!isNotes && !isResources && (
     <section className="video-course-picker" aria-label="选择课程分集">
      <header>
       <div>
        <h3>选择课程</h3>
        <p className="hint">读取合集目录后勾选分集，只处理你选中的课程。</p>
       </div>
       <Button
        variant="tertiary"
        size="sm"
        isDisabled={busy || !url.trim()}
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
       </Button>
      </header>
      {series && (
       <>
        <strong>{series.title}</strong>
        <div className="video-course-toolbar">
         <Input
          aria-label="搜索课程分集"
          placeholder="搜索课程名称"
          disabled={busy}
          value={filter}
          onChange={e => setFilter(e.target.value)}
         />
         <span>
          已选 {selected.length} / {series.episodes.length}
         </span>
         <Button
          variant="tertiary"
          size="sm"
          isDisabled={busy}
          onClick={() => setSelected(series.episodes.filter(e => e.title.includes(filter)).map(e => e.page))}
         >
          选择当前列表
         </Button>
         <Button variant="tertiary" size="sm" isDisabled={busy} onClick={() => setSelected([])}>
          清空选择
         </Button>
        </div>
        <div className="video-course-list">
         {series.episodes
          .filter(e => e.title.includes(filter))
          .map(e => {
           const item = batch.find(i => i.page === e.page)
           return (
            <Checkbox
             key={e.page}
             className={selected.includes(e.page) ? 'selected' : ''}
             isSelected={selected.includes(e.page)}
             isDisabled={busy}
             aria-label={`选择 P${e.page} ${e.title}`}
             onChange={checked => setSelected(s => (checked ? [...s, e.page] : s.filter(p => p !== e.page)))}
            >
             <Checkbox.Content>
              <Checkbox.Control>
               <Checkbox.Indicator />
              </Checkbox.Control>
              <span className="video-course-number">P{e.page}</span>
              <span className="video-course-title">
               {e.title}
               {item?.error && <small role="alert">{item.error}</small>}
              </span>
              <span className="hint">{item?.status || time(e.duration)}</span>
              {item?.path && (
               <Button
                variant="tertiary"
                size="sm"
                type="button"
                isDisabled={busy}
                onClick={ev => {
                 ev.preventDefault()
                 void open(item.path!)
                }}
               >
                打开 PDF
               </Button>
              )}
             </Checkbox.Content>
            </Checkbox>
           )
          })}
        </div>
        {isVideo && (
         <div className="video-course-actions">
          <span className="hint">每个分集单独保存 PDF，完成后清理对应视频。</span>
          <Button
           variant="primary"
           size="sm"
           isDisabled={busy || !selected.length}
           onClick={() =>
            void run(async () => {
             setSaved(null)
             setSource(null)
             setReview(null)
             const result = await invoke<VideoBatchItem[]>('video-ppt:batch', {
              url,
              pages: selected,
              prompt,
              courseId: courseId || undefined
             })
             setBatch(result)
             setProgress(
              `所选课程已处理：完成 ${result.filter(i => i.status === '已完成').length}，失败 ${result.filter(i => i.status === '失败').length}`
             )
            })
           }
          >
           生成所选课件 PDF{selected.length ? `（${selected.length}）` : ''}
          </Button>
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
        <p className="hint">
         读取所选分集的站内字幕；没有字幕时可用离线模型转写。结果保存到当前课程的“语音原文”。{' '}
         <SettingsLink section="runtime">检查运行组件</SettingsLink>
        </p>
       </div>
      </header>
      <div className="row">
       <Button
        variant="tertiary"
        size="sm"
        isDisabled={busy}
        onClick={() =>
         void run(async () => {
          const result = await invoke<BiliSubtitle | null>('video-ppt:subtitle-import', {
           courseId: courseId || undefined
          })
          if (result) {
           setSubtitle(result)
           setSubtitleSaved(result.savedPath || '')
           if (result.savedPath) notify.success('B 站字幕已保存', {description: result.savedPath, timeout: 6000})
          }
         })
        }
       >
        载入已保存的 SRT
       </Button>
       {series && (
        <label>
         选择分集
         <SelectField
          label="字幕分集"
          value={String(subtitlePage)}
          isDisabled={busy}
          onChange={next => {
           setSubtitlePage(Number(next))
           setSubtitle(null)
           setSubtitleSaved('')
          }}
          options={series.episodes.map(e => ({value: String(e.page), label: 'P' + e.page + ' · ' + e.title}))}
         />
        </label>
       )}
       <Button
        variant="tertiary"
        size="sm"
        isDisabled={busy || !url.trim()}
        onClick={() =>
         void run(async () => {
          const target = series?.episodes.find(e => e.page === subtitlePage)?.url || url
          setSubtitleSaved('')
          setSubtitle(await invoke<BiliSubtitle>('video-ppt:subtitle', {url: target}))
         })
        }
       >
        读取字幕
       </Button>
       <Button
        variant="tertiary"
        size="sm"
        isDisabled={busy || !url.trim()}
        onClick={() =>
         void run(async () => {
          const target = series?.episodes.find(e => e.page === subtitlePage)?.url || url
          const result = await invoke<BiliSubtitle>('video-ppt:subtitle-transcribe', {
           url: target,
           courseId: courseId || undefined
          })
          setSubtitle(result)
          setSubtitleSaved(result.savedPath || '')
          if (result.savedPath) notify.success('字幕已保存', {description: result.savedPath, timeout: 6000})
         })
        }
       >
        无站内字幕？离线转写并保存
       </Button>
       <Button
        variant="tertiary"
        size="sm"
        isDisabled={busy}
        onClick={() =>
         void run(async () => {
          const result = await invoke<BiliSubtitle | null>('video-ppt:subtitle-transcribe-local', {
           courseId: courseId || undefined
          })
          if (result) {
           setSubtitle(result)
           setSubtitleSaved(result.savedPath || '')
           if (result.savedPath) notify.success('B 站字幕已保存', {description: result.savedPath, timeout: 6000})
          }
         })
        }
       >
        选择本地视频转写
       </Button>
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
         <TextArea className="srt-editor" readOnly value={subtitle.srt} />
        </details>
        <Button
         variant="tertiary"
         size="sm"
         isDisabled={busy || !!subtitle.savedPath}
         onClick={() =>
          void run(async () => {
           const target = series?.episodes.find(e => e.page === subtitlePage)?.url || url
           const path = await invoke<string>('video-ppt:subtitle-save', {
            url: target,
            title: subtitle.title,
            srt: subtitle.srt,
            courseId: courseId || undefined
           })
           setSubtitleSaved(path)
           notify.success('字幕 SRT 已保存', {description: path, timeout: 6000})
          })
         }
        >
         保存字幕 SRT
        </Button>
        <div className="row">
         {(['txt', 'md', 'vtt'] as const).map(format => (
          <Button
           variant="tertiary"
           size="sm"
           key={format}
           isDisabled={busy}
           onClick={() =>
            void run(async () => {
             const path = await invoke<string>('video-ppt:subtitle-export', {
              title: subtitle.title,
              srt: subtitle.srt,
              format,
              courseId: courseId || undefined
             })
             setProgress(`${format.toUpperCase()} 字幕已保存：${path}`)
            })
           }
          >
           导出 {format.toUpperCase()}
          </Button>
         ))}
         <Button variant="tertiary" size="sm" isDisabled={busy} onClick={() => select('videoNotes')}>
          整理课程笔记
         </Button>
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
        <p className="hint">
         使用上方勾选的分集；优先保存站内字幕，没有字幕时逐集离线转写。每集单独保存，成功后清理该集临时视频。
        </p>
       </div>
       <Button
        variant="primary"
        size="sm"
        isDisabled={busy || !selected.length}
        onClick={() =>
         void run(async () => {
          setSubtitleBatch([])
          const result = await invoke<VideoBatchItem[]>('video-ppt:batch-subtitles', {
           url,
           pages: selected,
           courseId: courseId || undefined
          })
          setSubtitleBatch(result)
          setProgress(
           `字幕处理完成：成功 ${result.filter(i => i.status === '已完成').length}，失败 ${result.filter(i => i.status === '失败').length}`
          )
         })
        }
       >
        获取所选分集字幕（{selected.length}）
       </Button>
      </header>
      {subtitleBatch.map(item => (
       <div className="video-course-toolbar" key={item.page}>
        <span>
         P{item.page} · {item.title} · {item.status}
        </span>
        {item.path && (
         <Button variant="tertiary" size="sm" isDisabled={busy} onClick={() => void open(item.path!)}>
          打开字幕
         </Button>
        )}
        {item.error && <span role="alert">{item.error}</span>}
       </div>
      ))}
     </section>
    )}
    {series && isSubtitles && (
     <Card className="knowledge-card" aria-label="同步字幕到知识库">
      <header>
       <div>
        <h3>同步字幕到知识库</h3>
        <p className="hint">
         仅同步上方勾选的分集，保留分集网址和字幕版本。相同内容重复同步不新增资料；同时保存课程
         SRT。没有站内字幕时保留失败记录，可离线转写后为该分集选择已有 SRT。
        </p>
       </div>
      </header>
      <div className="row">
       <label>
        知识库分类
        <Input
         aria-label="字幕知识库分类"
         placeholder={courseName || '未分类'}
         disabled={busy}
         value={syncCategory}
         onChange={e => setSyncCategory(e.target.value)}
        />
       </label>
       <Button
        variant="tertiary"
        size="sm"
        isDisabled={busy || !selected.length}
        onClick={() =>
         void run(async () => {
          const task = await invoke<SubtitleSyncTask>('subtitle-sync:start', {
           url,
           pages: selected,
           category: syncCategory.trim() || courseName || '',
           courseId: courseId || undefined
          })
          setProgress(
           `同步结束：完成 ${task.items.filter(item => item.status === '已完成').length}，失败 ${task.items.filter(item => item.status === '失败').length}`
          )
         })
        }
       >
        同步所选字幕（{selected.length}）
       </Button>
      </div>
      <p className="hint">笔记、导图和 PDF 沿用对应页面的生成按钮，由你选择是否生成。</p>
     </Card>
    )}
    {isNotes && (
     <section className="video-course-picker" aria-label="视频课程摘要">
      <header>
       <div>
        <h3>视频课程摘要</h3>
        <p className="hint">使用已取得或载入的字幕整理笔记，附原话与时间点，并保存到当前课程。</p>
       </div>
      </header>
      <div className="row notes-summary-row">
       <Button
        variant="tertiary"
        size="sm"
        isDisabled={busy}
        onClick={() =>
         void run(async () => {
          const result = await invoke<BiliSubtitle | null>('video-ppt:subtitle-import', {
           courseId: courseId || undefined
          })
          if (result) {
           setSubtitle(result)
           setSubtitleSaved(result.savedPath || '')
           if (result.savedPath) notify.success('B 站字幕已保存', {description: result.savedPath, timeout: 6000})
          }
         })
        }
       >
        载入已保存的 SRT
       </Button>
       <label>
        摘要形式
        <SelectField
         className="notes-summary-select"
         label="摘要形式"
         value={summaryMode}
         isDisabled={busy}
         onChange={next => setSummaryMode(next as VideoNoteMode)}
         options={[
          {value: 'brief', label: '简要摘要'},
          {value: 'detailed', label: '详细摘要'},
          {value: 'keypoints', label: '课程要点'},
          {value: 'mindmap', label: '思维导图'}
         ]}
        />
       </label>
       <Button
        variant="primary"
        size="sm"
        isDisabled={busy || !subtitle}
        onClick={() =>
         void run(async () => {
          setSummary(null)
          const result = await invoke<VideoNoteResult | null>('video-ppt:summary', {
           mode: summaryMode,
           srt: subtitle!.srt,
           title: subtitle!.title,
           courseId: courseId || undefined
          })
          setSummary(result)
          if (result) notify.success('课程笔记已生成并保存')
         })
        }
       >
        根据字幕生成并保存
       </Button>
      </div>
      {subtitle && (
       <p className="hint">
        当前字幕：{subtitle.title} · {subtitle.count} 条 · {subtitle.source}{' '}
        <SettingsLink section="qwen">模型设置</SettingsLink>
       </p>
      )}
      {summary && (
       <>
        <p role="status">已保存课程笔记 · {summary.count} 项字幕引文已核实</p>
        <details className="learning-path">
         <summary>查看保存位置</summary>
         <Input aria-label="笔记保存位置" readOnly value={summary.path} />
        </details>
        <div className="learning-summary">
         {summaryMode === 'mindmap' ? (
          <VideoMindmap title={subtitle?.title || '课程笔记'} points={summary.points} />
         ) : (
          <ReactMarkdown>{summary.markdown}</ReactMarkdown>
         )}
        </div>
        <div className="row">
         <Button variant="tertiary" size="sm" isDisabled={busy} onClick={() => void open(summary.path)}>
          打开 Markdown
         </Button>
         {(['docx', 'pdf', 'svg'] as const).map(format => (
          <Button
           variant="tertiary"
           size="sm"
           key={format}
           isDisabled={busy}
           onClick={() =>
            void run(async () => {
             const path = await invoke<string>('video-ppt:notes-export', {path: summary.path, format})
             setProgress(`${format.toUpperCase()} 已保存：${path}`)
             await invoke('library:reveal', {path})
            })
           }
          >
           导出 {format.toUpperCase()}
          </Button>
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
         <SlidersHorizontal aria-hidden="true" />
        </span>
        <span>手动检查与调整</span>
        <span className="video-option-chevron" aria-hidden="true" />
       </summary>
       <div className="video-option-body">
        <Button
         variant="tertiary"
         size="sm"
         isDisabled={busy}
         onClick={() =>
          void run(async () => {
           const path = await invoke<string | null>('video-ppt:pick')
           if (path) await load({path})
          })
         }
        >
         手动框选已下载视频
        </Button>
       </div>
      </details>
      <details className="video-option">
       <summary>
        <span className="video-option-icon" aria-hidden="true">
         <FileText aria-hidden="true" />
        </span>
        <span>处理提示词</span>
        <span className="video-option-chevron" aria-hidden="true" />
       </summary>
       <div className="video-option-body">
        <TextArea
         aria-label="视频处理提示词"
         value={prompt}
         disabled={busy}
         onChange={e => setPrompt(e.target.value)}
        />
        <Button variant="tertiary" size="sm" isDisabled={busy} onClick={() => setPrompt(defaultVideoPrompt)}>
         恢复默认提示词
        </Button>
       </div>
      </details>
     </div>
    )}
    {isVideo && (
     <p className="hint">
      保存到：{courseName || '未分类资料'}。全程后台下载、裁剪和去重，PDF 检查成功后清理本次视频和临时图片。{' '}
      <SettingsLink section="qwen">模型设置</SettingsLink>
      <SettingsLink section="runtime">检查运行组件</SettingsLink>
     </p>
    )}
   </div>
   {progress && (
    <div className="learning-status" role="status">
     <span>{progress}</span>
     {busy && (
      <Button variant="ghost" size="sm" onClick={() => void invoke('cancel')}>
       取消任务
      </Button>
     )}
    </div>
   )}
   {isVideo && source && !review && !saved && (
    <section className="video-region">
     <h3>确认 PPT 区域 · {time(source.duration)}</h3>
     {source.warning && <p role="alert">{source.warning}</p>}
     <div className="video-region-image">
      <img alt="完整视频画面，确认 PPT 区域" src={source.preview} />
      <div
       style={{
        left: source.crop.left * 100 + '%',
        top: source.crop.top * 100 + '%',
        width: (source.crop.right - source.crop.left) * 100 + '%',
        height: (source.crop.bottom - source.crop.top) * 100 + '%'
       }}
      />
     </div>
     <div className="ppt-crop-inputs">
      {(['left', 'right', 'top', 'bottom'] as const).map((key, i) => (
       <label key={key}>
        {['左边界', '右边界', '上边界', '下边界'][i]} %
        <Input
         type="number"
         min="0"
         max="100"
         step=".1"
         aria-label={`PPT ${key}`}
         value={Number((source.crop[key] * 100).toFixed(1))}
         disabled={busy}
         onChange={e => setSource({...source, crop: {...source.crop, [key]: Number(e.target.value) / 100}})}
        />
       </label>
      ))}
     </div>
     <Button
      variant="tertiary"
      size="sm"
      isDisabled={busy}
      onClick={() =>
       void run(async () => {
        setChecked(false)
        setReview(await invoke<VideoReview>('video-ppt:extract', {id: source.id, crop: source.crop, prompt}))
       })
      }
     >
      确认区域，提取整段视频
     </Button>
    </section>
   )}
   {isVideo && review && !saved && (
    <>
     <div className="ppt-extract-summary">
      <strong>
       保留 {kept} 页 · 删除 {review.pages.length - kept} 页
      </strong>
      <Checkbox isSelected={checked} isDisabled={busy} onChange={setChecked}>
       <Checkbox.Content>
        <Checkbox.Control>
         <Checkbox.Indicator />
        </Checkbox.Control>
        已检查裁剪、重复和页面内容
       </Checkbox.Content>
      </Checkbox>
      <Button
       variant="primary"
       size="sm"
       isDisabled={busy || !checked || !kept}
       onClick={() =>
        void run(async () => {
         setSaved(
          await invoke('video-ppt:export', {
           id: review.id,
           courseId: courseId || undefined,
           checked,
           pages: review.pages.map(({page, keep, crop}) => ({page, keep, crop}))
          })
         )
         setProgress('PDF 已保存并逐页检查')
         notify.success('视频课件 PDF 已保存')
        })
       }
      >
       保存 PDF 并清理临时文件
      </Button>
      <Button
       variant="tertiary"
       size="sm"
       isDisabled={busy}
       onClick={() => {
        setReview(null)
        setChecked(false)
       }}
      >
       重新框选
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
          isDisabled={busy}
          onChange={checked => {
           setChecked(false)
           setReview({
            ...review,
            pages: review.pages.map(q => (q.page === p.page ? {...q, keep: checked} : q))
           })
          }}
         >
          <Checkbox.Content>
           <Checkbox.Control>
            <Checkbox.Indicator />
           </Checkbox.Control>
           第 {p.page} 页 · {time(p.time)} · {p.keep ? '保留' : '删除'}
          </Checkbox.Content>
         </Checkbox>
         <div className="ppt-extract-preview" style={{aspectRatio: (p.width * w) / (p.height * h)}}>
          <img
           alt={`视频课件第 ${p.page} 页`}
           src={p.preview}
           style={{
            width: 100 / w + '%',
            height: 100 / h + '%',
            left: (-100 * c.left) / w + '%',
            top: (-100 * c.top) / h + '%'
           }}
          />
         </div>
         <p>{p.reason}</p>
         <details>
          <summary>调整此页裁剪</summary>
          <div className="ppt-crop-inputs">
           {(['left', 'right', 'top', 'bottom'] as const).map((key, i) => (
            <label key={key}>
             {['左', '右', '上', '下'][i]} %
             <Input
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
     <Input aria-label="视频 PDF 输出路径" readOnly value={saved.path} />
     <Button variant="tertiary" size="sm" onClick={() => void open(saved.path)}>
      打开 PDF
     </Button>
     <Button variant="tertiary" size="sm" onClick={() => void open(saved.path, true)}>
      在文件夹中查看
     </Button>
    </footer>
   )}
  </WindowPanel>
 )
}
