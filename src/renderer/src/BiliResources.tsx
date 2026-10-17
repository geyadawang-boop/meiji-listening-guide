import {useEffect, useRef, useState} from 'react'
import {SubtitleBatchRecords} from './SubtitleBatchRecords'
import {MediaDownloads} from './MediaDownloads'
import {Discussion} from './Discussion'
import {BiliBrowse} from './BiliBrowse'
import type {VideoSeries} from '../../shared/video-ppt'
import type {SubtitleSyncTask} from '../../shared/subtitle-sync'
const invoke = <T,>(action: string, args?: unknown) => window.assistant.invoke<T>(action, args)
type Folder = {id: number; title: string; media_count: number}
type Video = {id: number; bvid: string; title: string; duration: number; available: boolean; url: string}
type User = {loggedIn: boolean; name?: string; mid?: number}
export function ResourceIcon() {
 return (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
   <path d="M5 4h14v17l-7-4-7 4z" />
   <path d="m10 8 4 2-4 2z" />
  </svg>
 )
}
export function BiliResources({visible, close, useVideo, courseId, courseName}: {visible: boolean; close: () => void; useVideo: (url: string, kind: 'videoPpt' | 'videoSubtitles') => void; courseId: string; courseName?: string}) {
 const [user, setUser] = useState<User>({loggedIn: false}),
  [folders, setFolders] = useState<Folder[]>([]),
  [folder, setFolder] = useState<Folder | null>(null)
 const [videos, setVideos] = useState<Video[]>([]),
  [page, setPage] = useState(1),
  [hasMore, setHasMore] = useState(false),
  [filter, setFilter] = useState('')
 const [busy, setBusy] = useState(false),
  [error, setError] = useState(''),
  [qr, setQr] = useState(''),
  [login, setLogin] = useState(''),
  [checked, setChecked] = useState(false)
 const [basket, setBasket] = useState<{url: string; title: string; series: VideoSeries; pages: number[]}[]>([]),
  [category, setCategory] = useState(''),
  [tasks, setTasks] = useState<SubtitleSyncTask[]>([]),
  [progress, setProgress] = useState('')
 const working = useRef(false)
 const selectedCount = basket.reduce((count, item) => count + item.pages.length, 0)
 async function loadTasks() {
  setTasks(await invoke('subtitle-sync:list'))
 }
 useEffect(() => {
  if (visible) void loadTasks().catch(reason => setError(String(reason)))
 }, [visible])
 useEffect(
  () =>
   window.assistant.onEvent(event => {
    if (working.current && event.kind === 'progress') setProgress(event.data.message)
   }),
  []
 )
 async function refresh() {
  const current = await invoke<User>('bili-resources:status')
  if (current.mid !== user.mid) {
   setBasket([])
   setFolder(null)
   setVideos([])
  }
  setUser(current)
  setChecked(true)
  if (current.loggedIn) setFolders(await invoke<Folder[]>('bili-resources:folders'))
  else {
   setFolders([])
   setFolder(null)
   setVideos([])
   setBasket([])
  }
 }
 async function run(fn: () => Promise<void>) {
  if (working.current) return
  working.current = true
  setBusy(true)
  setError('')
  setProgress('')
  try {
   await fn()
  } catch (reason) {
   setError(reason instanceof Error ? reason.message : String(reason))
  } finally {
   working.current = false
   setBusy(false)
   void loadTasks().catch(reason => setError(String(reason)))
  }
 }
 async function choose(video: Video) {
  if (basket.some(item => item.url === video.url)) return
  const series = await invoke<VideoSeries>('video-ppt:series', {url: video.url})
  setBasket(current => [...current, {url: video.url, title: video.title, series, pages: []}])
 }
 // A repeated waiting result must schedule the next check, even if its text
 // is unchanged. The sequence below remains scoped to the visible QR panel.
 const [pollTick, setPollTick] = useState(0)
 useEffect(() => {
  if (!visible || !qr || !['waiting', 'scanning'].includes(login)) return
  let stopped = false
  const timer = setTimeout(() => {
   void invoke<{status: string}>('bili-resources:poll')
    .then(async result => {
     if (stopped) return
     setLogin(result.status)
     setPollTick(tick => tick + 1)
     if (result.status === 'success') {
      setQr('')
      await refresh()
     }
    })
    .catch(reason => {
     if (!stopped) {
      setError(String(reason))
      setLogin('failed')
     }
    })
  }, 2500)
  return () => {
   stopped = true
   clearTimeout(timer)
  }
 }, [visible, qr, login, pollTick])
 async function load(selected: Folder, nextPage: number) {
  const result = await invoke<{videos: Video[]; hasMore: boolean; page: number}>('bili-resources:videos', {id: selected.id, page: nextPage})
  setFolder(selected)
  setVideos(result.videos)
  setPage(result.page)
  setHasMore(result.hasMore)
 }
 return (
  <section className="learning-window ppt-extract-page" aria-label="视频资源" hidden={!visible} style={!visible ? {display: 'none'} : undefined}>
   <aside className="learning-menu">
    <h2>视频资源</h2>
    <p>
     在应用内选择收藏视频，
     <br />
     送到课件和字幕处理。
    </p>
    <button onClick={() => void run(refresh)} disabled={busy}>
     <ResourceIcon />
     <span>刷新收藏夹</span>
    </button>
    {folders.map(item => (
     <button key={item.id} title={item.title} className={folder?.id === item.id ? 'active' : ''} disabled={busy} onClick={() => void run(() => load(item, 1))}>
      <span>
       {item.title} · {item.media_count}
      </span>
     </button>
    ))}
    <button onClick={close}>
     <span>返回课程对话</span>
    </button>
   </aside>
   <main className="learning-content">
    <header>
     <div>
      <h2>视频资源</h2>
      <p>扫码登录 B 站，读取自己的收藏夹。</p>
     </div>
     <span className="learning-course">{user.loggedIn ? user.name || '已登录' : checked ? '未登录' : '未检查账号'}</span>
    </header>
    <BiliBrowse useVideo={useVideo} />
    <MediaDownloads visible={visible} />
    <Discussion />
    <section className="knowledge-card">
     <header>
      <h3>B 站账号</h3>
      <div className="row">
       <button disabled={busy} onClick={() => void run(refresh)}>
        检查登录状态
       </button>
       {user.loggedIn ? (
        <button
         disabled={busy}
         onClick={() =>
          void run(async () => {
           await invoke('bili-resources:logout')
           setQr('')
           setLogin('')
           await refresh()
          })
         }
        >
         退出 B 站
        </button>
       ) : (
        <button
         className="primary"
         disabled={busy}
         onClick={() =>
          void run(async () => {
           setQr('')
           setLogin('')
           setQr(await invoke<string>('bili-resources:qr'))
           setLogin('waiting')
          })
         }
        >
         扫码登录 B 站
        </button>
       )}
      </div>
     </header>
     <p className="hint">登录保存在本应用的独立 B 站会话中，不读取 Chrome 或 BiliSum 的账号；只读取收藏列表，不修改 B 站收藏。</p>
     {qr && (
      <div className="resource-qr">
       <img src={qr} alt="B 站官方登录二维码" />
       <p>{login === 'scanning' ? '已扫码，请在手机上确认' : login === 'expired' ? '二维码已过期，请重新生成' : login === 'failed' ? '检查失败，请重试' : '请使用 B 站手机应用扫码'}</p>
      </div>
     )}
    </section>
    {busy && (
     <div className="row">
      <p role="status">{progress || '正在读取 B 站资源…'}</p>
      <button onClick={() => void invoke('cancel')}>取消处理</button>
     </div>
    )}
    {!busy && progress && <p role="status">{progress}</p>}
    {error && (
     <div className="alert" role="alert">
      {error}
     </div>
    )}
    {folder ? (
     <section>
      <div className="row">
       <h3>{folder.title}</h3>
       <input aria-label="搜索当前页收藏视频" placeholder="搜索当前页视频" value={filter} onChange={event => setFilter(event.target.value)} />
      </div>
      {videos
       .filter(video => video.title.includes(filter))
       .map(video => (
        <article className="knowledge-entry" key={video.id}>
         <ResourceIcon />
         <div>
          <strong>{video.title}</strong>
          <small>{video.available ? `${Math.floor(video.duration / 60)} 分钟` : '视频已失效或不支持'}</small>
         </div>
         <div className="resource-actions">
          <button disabled={busy || !video.available} onClick={() => useVideo(video.url, 'videoPpt')}>
           提取课件
          </button>
          <button disabled={busy || !video.available} onClick={() => useVideo(video.url, 'videoSubtitles')}>
           提取字幕
          </button>
          <button disabled={busy || !video.available} onClick={() => useVideo(video.url, 'videoSubtitles')}>
           同步知识库
          </button>
          <button className="primary" disabled={busy || !video.available || basket.some(item => item.url === video.url)} onClick={() => void run(() => choose(video))}>
           {basket.some(item => item.url === video.url) ? '已加入选择' : '选择分集'}
          </button>
         </div>
        </article>
       ))}
      {!videos.length && <p className="hint">当前收藏夹没有视频。</p>}
      <div className="row">
       <button disabled={busy || page === 1} onClick={() => void run(() => load(folder, page - 1))}>
        上一页
       </button>
       <span>第 {page} 页</span>
       <button disabled={busy || !hasMore} onClick={() => void run(() => load(folder, page + 1))}>
        下一页
       </button>
      </div>
     </section>
    ) : (
     <p className="hint">登录并刷新后，从左侧选择收藏夹。选中视频后仍可在处理页面选择分集。</p>
    )}
    {!!basket.length && (
     <section className="knowledge-card resource-selection" aria-label="跨视频分集选择">
      <header>
       <div>
        <h3>选择要同步的分集</h3>
        <p className="hint">
         已加入 {basket.length} 个视频，勾选 {selectedCount} 个分集。切换收藏页会保留选择；不默认全选。
        </p>
       </div>
       <button disabled={busy} onClick={() => setBasket([])}>
        清空视频选择
       </button>
      </header>
      {basket.map(item => (
       <details key={item.url} open>
        <summary>
         {item.title} · 已选 {item.pages.length} / {item.series.episodes.length}
        </summary>
        <div className="row">
         <button disabled={busy} onClick={() => setBasket(current => current.map(row => (row.url === item.url ? {...row, pages: row.series.episodes.map(part => part.page)} : row)))}>
          选择本视频全部分集
         </button>
         <button disabled={busy} onClick={() => setBasket(current => current.map(row => (row.url === item.url ? {...row, pages: []} : row)))}>
          清空本视频选择
         </button>
         <button disabled={busy} onClick={() => setBasket(current => current.filter(row => row.url !== item.url))}>
          移除此视频
         </button>
        </div>
        <div className="batch-options">
         {item.series.episodes.map(part => (
          <label key={part.url}>
           <input
            type="checkbox"
            disabled={busy}
            aria-label={`同步 ${item.title} P${part.page} ${part.title}`}
            checked={item.pages.includes(part.page)}
            onChange={event => setBasket(current => current.map(row => (row.url === item.url ? {...row, pages: event.target.checked ? [...row.pages, part.page] : row.pages.filter(page => page !== part.page)} : row)))}
           />
           <span>
            P{part.page} · {part.title}
           </span>
          </label>
         ))}
        </div>
       </details>
      ))}
      <div className="row">
       <label>
        知识库分类
        <input aria-label="批量字幕知识库分类" maxLength={100} value={category} placeholder={courseName || '未分类'} disabled={busy} onChange={event => setCategory(event.target.value)} />
       </label>
       <button
        className="primary"
        disabled={busy || !selectedCount}
        onClick={() =>
         void run(async () => {
          const task = await invoke<SubtitleSyncTask>('subtitle-sync:mixed', {selections: basket.filter(item => item.pages.length).map(item => ({url: item.url, title: item.title, pages: item.pages})), category: category.trim() || courseName || '', courseId: courseId || undefined})
          setTasks(current => [task, ...current.filter(item => item.id !== task.id)])
          setProgress(`批量同步结束：完成 ${task.items.filter(item => item.status === '已完成').length}，失败 ${task.items.filter(item => item.status === '失败').length}`)
         })
        }
       >
        同步所选视频分集（{selectedCount}）
       </button>
      </div>
     </section>
    )}
    <SubtitleBatchRecords visible={visible} tasks={tasks} busy={busy} run={run} refresh={loadTasks} courseName={courseName} />
   </main>
  </section>
 )
}
