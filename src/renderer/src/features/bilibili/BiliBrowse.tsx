import {Button, Card, Input} from '@heroui/react'
import {useState} from 'react'
import {notify} from '@renderer/ui/ToastHost'
type Video = {bvid: string; title: string; author: string; duration: string; url: string}
type Listing = {videos: Video[]; page: number; hasMore: boolean}
export function BiliBrowse({useVideo}: {useVideo: (url: string, kind: 'videoPpt' | 'videoSubtitles') => void}) {
 const [query, setQuery] = useState(''),
  [submitted, setSubmitted] = useState(''),
  [result, setResult] = useState<Listing>(),
  [busy, setBusy] = useState(false)
 async function read(kind: string, page = 1, word = query) {
  setBusy(true)
  setResult(undefined)
  try {
   setResult(await window.assistant.invoke<Listing>('bili-resources:browse', {kind, query: word, page}))
   setSubmitted(kind === 'search' ? word : '')
  } catch (reason) {
   notify.error(reason, {title: '读取视频列表失败'})
  } finally {
   setBusy(false)
  }
 }
 return (
  <Card className="knowledge-card">
   <h3>查找 B 站视频</h3>
   <p className="hint">在应用内搜索或读取热门视频；选择某个视频后再勾选分集和处理方式。</p>
   <form
    className="row"
    onSubmit={e => {
     e.preventDefault()
     void read('search')
    }}
   >
    <Input
     aria-label="视频搜索词"
     placeholder="课程、老师或视频名称"
     maxLength={100}
     value={query}
     onChange={e => setQuery(e.target.value)}
    />
    <Button type="submit" variant="primary" size="sm" isDisabled={busy || !query.trim()}>
     搜索视频
    </Button>
    <Button variant="tertiary" size="sm" type="button" isDisabled={busy} onClick={() => void read('popular')}>
     读取热门视频
    </Button>
   </form>
   {result && (
    <>
     <div className="bili-browse-grid">
      {result.videos.map(video => (
       <article key={video.bvid}>
        <h4>{video.title}</h4>
        <p className="hint">
         {video.author} {video.duration ? ' · ' + video.duration : ''}
        </p>
        <div className="row">
         <Button variant="tertiary" size="sm" isDisabled={busy} onClick={() => useVideo(video.url, 'videoPpt')}>
          提取视频课件
         </Button>
         <Button variant="tertiary" size="sm" isDisabled={busy} onClick={() => useVideo(video.url, 'videoSubtitles')}>
          取得字幕
         </Button>
        </div>
       </article>
      ))}
     </div>
     {!result.videos.length && <p>本次未找到视频，请调整关键词。</p>}
     {submitted && (
      <div className="row">
       <Button
        variant="tertiary"
        size="sm"
        isDisabled={busy || result.page === 1}
        onClick={() => void read('search', result.page - 1, submitted)}
       >
        上一页搜索
       </Button>
       <span>第 {result.page} 页</span>
       <Button
        variant="tertiary"
        size="sm"
        isDisabled={busy || !result.hasMore}
        onClick={() => void read('search', result.page + 1, submitted)}
       >
        下一页搜索
       </Button>
      </div>
     )}
    </>
   )}
   {busy && <p role="status">正在读取视频列表…</p>}
  </Card>
 )
}
