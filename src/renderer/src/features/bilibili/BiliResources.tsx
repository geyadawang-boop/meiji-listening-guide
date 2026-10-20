import {Button, Card, Checkbox, Input} from '@heroui/react'
import {useEffect, useRef, useState} from 'react'
import {Bookmark} from 'lucide-react'
import {notify} from '@renderer/ui/ToastHost'
import {SelectField} from '@renderer/ui/SelectField'
import {Discussion} from '@renderer/features/bilibili/Discussion'
import {BiliBrowse} from '@renderer/features/bilibili/BiliBrowse'
import {SettingsLink} from '@renderer/app/settings-navigation'
import type {VideoSeries} from '@shared/video-ppt'
import type {SubtitleSyncTask} from '@shared/subtitle-sync'
const invoke = <T,>(action: string, args?: unknown) => window.assistant.invoke<T>(action, args)
type Folder = {id: number; title: string; media_count: number}
type Video = {id: number; bvid: string; title: string; duration: number; available: boolean; url: string}
type User = {loggedIn: boolean; name?: string; mid?: number}
export function BiliResourcesPanel({
 visible,
 useVideo,
 courseId,
 courseName
}: {
 visible: boolean
 useVideo: (url: string, kind: 'videoPpt' | 'videoSubtitles') => void
 courseId: string
 courseName?: string
}) {
 const [user, setUser] = useState<User>({loggedIn: false}),
  [folders, setFolders] = useState<Folder[]>([]),
  [folder, setFolder] = useState<Folder | null>(null)
 const [videos, setVideos] = useState<Video[]>([]),
  [page, setPage] = useState(1),
  [hasMore, setHasMore] = useState(false),
  [filter, setFilter] = useState('')
 const [busy, setBusy] = useState(false),
  [checked, setChecked] = useState(false)
 const [basket, setBasket] = useState<{url: string; title: string; series: VideoSeries; pages: number[]}[]>([]),
  [category, setCategory] = useState(''),
  [progress, setProgress] = useState('')
 const working = useRef(false)
 const selectedCount = basket.reduce((count, item) => count + item.pages.length, 0)
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
 useEffect(() => {
  if (visible) void refresh().catch(reason => notify.error(reason, {title: '读取 B 站账号失败'}))
 }, [visible])
 async function run(fn: () => Promise<void>) {
  if (working.current) return
  working.current = true
  setBusy(true)
  setProgress('')
  try {
   await fn()
  } catch (reason) {
   notify.error(reason)
  } finally {
   working.current = false
   setBusy(false)
  }
 }
 async function choose(video: Video) {
  if (basket.some(item => item.url === video.url)) return
  const series = await invoke<VideoSeries>('video-ppt:series', {url: video.url})
  setBasket(current => [...current, {url: video.url, title: video.title, series, pages: []}])
 }
 async function load(selected: Folder, nextPage: number) {
  const result = await invoke<{videos: Video[]; hasMore: boolean; page: number}>('bili-resources:videos', {
   id: selected.id,
   page: nextPage
  })
  setFolder(selected)
  setVideos(result.videos)
  setPage(result.page)
  setHasMore(result.hasMore)
 }
 return (
  <>
   <div className="row bili-account-bar">
    <span className="learning-course">{user.loggedIn ? user.name || '已登录' : checked ? '未登录' : '未检查账号'}</span>
    {user.loggedIn && (
     <SelectField
      label="收藏夹"
      placeholder="选择收藏夹"
      value={folder ? String(folder.id) : ''}
      isDisabled={busy || !folders.length}
      onChange={next => {
       const target = folders.find(item => String(item.id) === next)
       if (target) void run(() => load(target, 1))
      }}
      options={folders.map(item => ({value: String(item.id), label: `${item.title} · ${item.media_count}`}))}
     />
    )}
    <Button variant="tertiary" size="sm" isDisabled={busy} onClick={() => void run(refresh)}>
     刷新收藏夹
    </Button>
    <SettingsLink section="bilibili">账号设置</SettingsLink>
   </div>
   <BiliBrowse useVideo={useVideo} />
   <Discussion />
   {busy && (
    <div className="row">
     <p role="status">{progress || '正在读取 B 站资源…'}</p>
     <Button variant="ghost" size="sm" onClick={() => void invoke('cancel')}>
      取消处理
     </Button>
    </div>
   )}
   {!busy && progress && <p role="status">{progress}</p>}
   {folder ? (
    <section>
     <div className="row">
      <h3>{folder.title}</h3>
      <Input
       aria-label="搜索当前页收藏视频"
       placeholder="搜索当前页视频"
       value={filter}
       onChange={event => setFilter(event.target.value)}
      />
     </div>
     {videos
      .filter(video => video.title.includes(filter))
      .map(video => (
       <article className="knowledge-entry" key={video.id}>
        <Bookmark />
        <div>
         <strong>{video.title}</strong>
         <small>{video.available ? `${Math.floor(video.duration / 60)} 分钟` : '视频已失效或不支持'}</small>
        </div>
        <div className="resource-actions">
         <Button
          variant="tertiary"
          size="sm"
          isDisabled={busy || !video.available}
          onClick={() => useVideo(video.url, 'videoPpt')}
         >
          提取课件
         </Button>
         <Button
          variant="tertiary"
          size="sm"
          isDisabled={busy || !video.available}
          onClick={() => useVideo(video.url, 'videoSubtitles')}
         >
          提取字幕
         </Button>
         <Button
          variant="tertiary"
          size="sm"
          isDisabled={busy || !video.available}
          onClick={() => useVideo(video.url, 'videoSubtitles')}
         >
          同步知识库
         </Button>
         <Button
          variant="primary"
          size="sm"
          isDisabled={busy || !video.available || basket.some(item => item.url === video.url)}
          onClick={() => void run(() => choose(video))}
         >
          {basket.some(item => item.url === video.url) ? '已加入选择' : '选择分集'}
         </Button>
        </div>
       </article>
      ))}
     {!videos.length && <p className="hint">当前收藏夹没有视频。</p>}
     <div className="row">
      <Button
       variant="tertiary"
       size="sm"
       isDisabled={busy || page === 1}
       onClick={() => void run(() => load(folder, page - 1))}
      >
       上一页
      </Button>
      <span>第 {page} 页</span>
      <Button
       variant="tertiary"
       size="sm"
       isDisabled={busy || !hasMore}
       onClick={() => void run(() => load(folder, page + 1))}
      >
       下一页
      </Button>
     </div>
    </section>
   ) : (
    <p className="hint">登录并刷新后，从左侧选择收藏夹。选中视频后仍可在处理页面选择分集。</p>
   )}
   {!!basket.length && (
    <Card className="knowledge-card resource-selection" aria-label="跨视频分集选择">
     <header>
      <div>
       <h3>选择要同步的分集</h3>
       <p className="hint">
        已加入 {basket.length} 个视频，勾选 {selectedCount} 个分集。切换收藏页会保留选择；不默认全选。
       </p>
      </div>
      <Button variant="tertiary" size="sm" isDisabled={busy} onClick={() => setBasket([])}>
       清空视频选择
      </Button>
     </header>
     {basket.map(item => (
      <details key={item.url} open>
       <summary>
        {item.title} · 已选 {item.pages.length} / {item.series.episodes.length}
       </summary>
       <div className="row">
        <Button
         variant="tertiary"
         size="sm"
         isDisabled={busy}
         onClick={() =>
          setBasket(current =>
           current.map(row =>
            row.url === item.url ? {...row, pages: row.series.episodes.map(part => part.page)} : row
           )
          )
         }
        >
         选择本视频全部分集
        </Button>
        <Button
         variant="tertiary"
         size="sm"
         isDisabled={busy}
         onClick={() => setBasket(current => current.map(row => (row.url === item.url ? {...row, pages: []} : row)))}
        >
         清空本视频选择
        </Button>
        <Button
         variant="ghost"
         size="sm"
         isDisabled={busy}
         onClick={() => setBasket(current => current.filter(row => row.url !== item.url))}
        >
         移除此视频
        </Button>
       </div>
       <div className="batch-options">
        {item.series.episodes.map(part => (
         <Checkbox
          key={part.url}
          isSelected={item.pages.includes(part.page)}
          isDisabled={busy}
          aria-label={`同步 ${item.title} P${part.page} ${part.title}`}
          onChange={checked =>
           setBasket(current =>
            current.map(row =>
             row.url === item.url
              ? {
                 ...row,
                 pages: checked ? [...row.pages, part.page] : row.pages.filter(page => page !== part.page)
                }
              : row
            )
           )
          }
         >
          <Checkbox.Content>
           <Checkbox.Control>
            <Checkbox.Indicator />
           </Checkbox.Control>
           <span>
            P{part.page} · {part.title}
           </span>
          </Checkbox.Content>
         </Checkbox>
        ))}
       </div>
      </details>
     ))}
     <div className="row">
      <label>
       知识库分类
       <Input
        aria-label="批量字幕知识库分类"
        maxLength={100}
        value={category}
        placeholder={courseName || '未分类'}
        disabled={busy}
        onChange={event => setCategory(event.target.value)}
       />
      </label>
      <Button
       variant="primary"
       size="sm"
       isDisabled={busy || !selectedCount}
       onClick={() =>
        void run(async () => {
         const task = await invoke<SubtitleSyncTask>('subtitle-sync:mixed', {
          selections: basket
           .filter(item => item.pages.length)
           .map(item => ({url: item.url, title: item.title, pages: item.pages})),
          category: category.trim() || courseName || '',
          courseId: courseId || undefined
         })
         setProgress(
          `批量同步结束：完成 ${task.items.filter(item => item.status === '已完成').length}，失败 ${task.items.filter(item => item.status === '失败').length}`
         )
        })
       }
      >
       同步所选视频分集（{selectedCount}）
      </Button>
     </div>
    </Card>
   )}
  </>
 )
}
