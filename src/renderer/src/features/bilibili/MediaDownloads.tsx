import {Button, Card, Checkbox, Input} from '@heroui/react'
import {useEffect, useState} from 'react'
import type {MediaCatalog, MediaJob} from '@shared/media'
import {notify} from '@renderer/ui/ToastHost'
import {SelectField} from '@renderer/ui/SelectField'
import {SettingsLink} from '@renderer/app/settings-navigation'
const invoke = <T,>(action: string, args?: unknown) => window.assistant.invoke<T>(action, args)
type Options = Record<string, string | number | boolean | null>
type LoginProfile = {id: string; name: string; site: string; count: number}
const labels: Record<string, string> = {
 height: '最高画质',
 audio_quality: '音频质量',
 audio_only: '只保存音频',
 subtitle_only: '只保存字幕',
 subtitles: '同时下载字幕',
 auto_subtitles: '包含自动字幕',
 translated_subtitles: '包含翻译字幕',
 subtitle_languages: '字幕语言',
 subtitle_format: '字幕格式',
 embed_subtitles: '嵌入字幕',
 keep_subtitles: '保留独立字幕',
 container: '视频格式',
 audio_format: '音频格式',
 audio_bitrate: '音频比特率（0 为自动）',
 video_codec: '视频编码',
 format_ids: '精确格式',
 format_sort: '格式优先顺序',
 merge_audio: '保留多个音轨',
 thumbnail: '下载封面',
 embed_thumbnail: '嵌入封面',
 crop_artwork: '封面裁成方形',
 metadata: '写入媒体信息',
 chapters: '保留章节',
 split_chapters: '按章节拆分',
 clip_start: '片段开始秒数',
 clip_end: '片段结束秒数',
 sponsorblock: '移除片段类型',
 rate_kbps: '速度上限 KB/s（0 不限）',
 concurrent_fragments: '并行片段数',
 retries: '失败重试次数',
 force_ipv4: '使用 IPv4',
 proxy: '代理地址',
 restrict_filenames: '简化文件名',
 skip_existing: '跳过已核验的相同下载',
 filename_template: '文件名格式',
 custom_args: '下载调节参数',
 folder_layout: '目录整理方式'
}
const active = (job: MediaJob) => ['queued', 'running'].includes(job.state)
const sponsorHelp =
 'YouTube 可填 sponsor、intro、outro 等，多个分类用逗号分隔；依据 SponsorBlock 社区标注移除，字幕与章节同步调整。与仅字幕、按章节拆分请分别建立任务。'
const states: Record<string, string> = {
 queued: '排队中',
 running: '下载中',
 completed: '已完成',
 cancelled: '已取消',
 interrupted: '上次中断',
 error: '失败'
}
export function MediaDownloads({visible}: {visible: boolean}) {
 const [profiles, setProfiles] = useState<LoginProfile[]>([]),
  [profileName, setProfileName] = useState(''),
  [profileSite, setProfileSite] = useState('')
 const [url, setUrl] = useState(''),
  [playlist, setPlaylist] = useState(false),
  [source, setSource] = useState<MediaCatalog | null>(null),
  [selected, setSelected] = useState<string[]>([])
 const [options, setOptions] = useState<Options>({}),
  [enums, setEnums] = useState<Record<string, (string | number)[]>>({}),
  [jobs, setJobs] = useState<MediaJob[]>([]),
  [busy, setBusy] = useState(false),
  [confirmingProfile, setConfirmingProfile] = useState('')
 async function refresh() {
  setJobs(await invoke('media:list'))
 }
 async function refreshProfiles() {
  setProfiles(await invoke('media:auth-list'))
 }
 useEffect(() => {
  if (visible) void refreshProfiles().catch(reason => notify.error(reason, {title: '读取登录档案失败'}))
 }, [visible])
 useEffect(() => {
  if (!visible) return
  let stopped = false
  void invoke<{defaults: Options; enums: Record<string, string[]>; heights: number[]}>('media:options')
   .then(value => {
    if (!stopped) {
     setOptions(current => (Object.keys(current).length ? current : value.defaults))
     setEnums({...value.enums, height: value.heights})
    }
   })
   .catch(reason => !stopped && notify.error(reason, {title: '读取下载选项失败'}))
  void refresh().catch(reason => !stopped && notify.error(reason, {title: '读取下载记录失败'}))
  return () => {
   stopped = true
  }
 }, [visible])
 useEffect(() => {
  if (!visible || !jobs.some(active)) return
  const timer = setTimeout(
   () =>
    void refresh().catch(reason =>
     notify.error(reason, {title: '读取下载记录失败', key: 'media:refresh', dedupeWindow: 10000})
    ),
   2000
  )
  return () => clearTimeout(timer)
 }, [visible, jobs])
 async function run(fn: () => Promise<void>) {
  setBusy(true)
  try {
   await fn()
   await refresh()
  } catch (reason) {
   notify.error(reason)
  } finally {
   setBusy(false)
  }
 }
 const set = (key: string, value: string | number | boolean | null) =>
  setOptions(current => ({...current, [key]: value}))
 async function enqueue() {
  if (!source) return
  const urls = source.playlist ? selected : [source.url]
  let count = 0
  const failed: string[] = []
  for (const link of urls) {
   try {
    const item = source.playlist ? await invoke<MediaCatalog>('media:catalog', {url: link, options}) : source
    await invoke('media:create', {token: item.token, options})
    count++
   } catch (reason) {
    failed.push(`${link}：${reason instanceof Error ? reason.message : String(reason)}`)
   }
  }
  if (count) notify.success(`已加入 ${count} 个所选下载任务`)
  if (failed.length) notify.error(failed.join('\n'), {title: `${failed.length} 个任务加入失败`})
 }
 return (
  <Card className="knowledge-card" aria-label="媒体下载">
   <header>
    <div>
     <h3>媒体下载</h3>
     <p className="hint">
      输入公开的视频网址，选择格式后保存到本地。需登录或受限的视频会显示站点错误，不打开网页。B 站账号请在{' '}
      <SettingsLink section="bilibili">账号设置</SettingsLink> 中管理。
     </p>
     <p className="hint">
      下载依赖本地媒体组件；组件缺失或版本不匹配时，请先 <SettingsLink section="runtime">检查运行组件</SettingsLink>。
     </p>
    </div>
    <Button variant="ghost" size="sm" isDisabled={busy} onClick={() => void run(refresh)}>
     刷新下载记录
    </Button>
   </header>
   <details className="media-advanced">
    <summary>站点登录档案</summary>
    <p className="hint">
     只读取你主动选择的 Netscape cookies.txt，不扫描浏览器。档案由当前系统用户加密保存；仅发往所填站点域名，不发送给视频
     CDN 或其它站点。这里不会显示凭据正文。
    </p>
    <div className="media-options">
     <label>
      档案名称
      <Input
       aria-label="登录档案名称"
       value={profileName}
       maxLength={80}
       onChange={event => setProfileName(event.target.value)}
      />
     </label>
     <label>
      站点域名
      <Input
       aria-label="登录档案站点域名"
       placeholder="例如 youtube.com"
       value={profileSite}
       onChange={event => setProfileSite(event.target.value)}
      />
     </label>
     <Button
      variant="tertiary"
      size="sm"
      isDisabled={busy || !profileName.trim() || !profileSite.trim()}
      onClick={() =>
       void run(async () => {
        const result = await invoke<LoginProfile | null>('media:auth-import', {
         name: profileName.trim(),
         site: profileSite.trim()
        })
        if (result) {
         await refreshProfiles()
         setProfileName('')
         setProfileSite('')
         notify.success('登录档案已在本机加密保存，使用前请在下方明确选择', {timeout: 6000})
        }
       })
      }
     >
      选择文件并导入
     </Button>
     <label>
      下载使用的登录档案
      <SelectField
       label="下载登录档案"
       isDisabled={busy}
       value={String(options.cookie_profile || '')}
       onChange={next => setOptions(current => ({...current, cookie_profile: next, use_cookies: !!next}))}
       options={[
        {value: '', label: '应用内 B 站会话 / 其它站点公开访问'},
        ...profiles.map(profile => ({
         value: profile.id,
         label: profile.name + ' · ' + profile.site + ' · ' + profile.count + ' 项'
        }))
       ]}
      />
     </label>
     <Checkbox
      className="media-check"
      isSelected={!!options.privacy}
      isDisabled={busy}
      onChange={checked => set('privacy', checked)}
     >
      <Checkbox.Content>
       <Checkbox.Control>
        <Checkbox.Indicator />
       </Checkbox.Control>
       加密下载任务记录（媒体文件本身不加密）
      </Checkbox.Content>
     </Checkbox>
    </div>
    {profiles.map(profile => (
     <div className="row" key={profile.id}>
      <span>
       {profile.name} · {profile.site}
      </span>
      {confirmingProfile === profile.id ? (
       <>
        <Button
         variant="danger"
         size="sm"
         isDisabled={busy}
         onClick={() =>
          void run(async () => {
           await invoke('media:auth-remove', {id: profile.id, confirmed: true})
           if (options.cookie_profile === profile.id)
            setOptions(current => ({...current, cookie_profile: '', use_cookies: false}))
           setConfirmingProfile('')
           await refreshProfiles()
          })
         }
        >
         确认删除
        </Button>
        <Button variant="ghost" size="sm" isDisabled={busy} onClick={() => setConfirmingProfile('')}>
         取消
        </Button>
       </>
      ) : (
       <Button variant="danger-soft" size="sm" isDisabled={busy} onClick={() => setConfirmingProfile(profile.id)}>
        删除此档案
       </Button>
      )}
     </div>
    ))}
   </details>
   <div className="row">
    <Input
     aria-label="媒体网址"
     placeholder="视频网址"
     value={url}
     disabled={busy}
     onChange={e => {
      setUrl(e.target.value)
      setSource(null)
      setSelected([])
     }}
    />
    <Checkbox
     className="media-switch"
     isSelected={playlist}
     isDisabled={busy}
     onChange={checked => {
      setPlaylist(checked)
      setSource(null)
      setSelected([])
     }}
    >
     <Checkbox.Content>
      <Checkbox.Control>
       <Checkbox.Indicator />
      </Checkbox.Control>
      读取播放列表
     </Checkbox.Content>
    </Checkbox>
    <Button
     variant="tertiary"
     size="sm"
     isDisabled={busy || !url.trim()}
     onClick={() =>
      void run(async () => {
       setSource(null)
       setSelected([])
       setSource(await invoke('media:catalog', {url: url.trim(), playlist, options}))
      })
     }
    >
     读取可用格式
    </Button>
   </div>
   {source && (
    <div className="media-source">
     <h4>{source.title}</h4>
     {source.playlist ? (
      <>
       <p className="hint">只下载勾选条目。{source.limited ? '目录只列出前 100 项。' : ''}</p>
       <div className="batch-options">
        {source.entries?.map(item => (
         <Checkbox
          key={item.url}
          isSelected={selected.includes(item.url)}
          isDisabled={busy}
          onChange={checked =>
           setSelected(checked ? [...selected, item.url] : selected.filter(link => link !== item.url))
          }
         >
          <Checkbox.Content>
           <Checkbox.Control>
            <Checkbox.Indicator />
           </Checkbox.Control>
           {item.title}
          </Checkbox.Content>
         </Checkbox>
        ))}
       </div>
      </>
     ) : (
      <p className="hint">
       {source.duration && source.duration > 0 ? '时长 ' + Math.round(source.duration) + ' 秒' : '时长未提供'} ·
       可用字幕 {source.subtitles?.join('、') || '未提供'}
      </p>
     )}
     <div className="media-options">
      {['height', 'audio_only', 'subtitle_only', 'subtitles', 'container', 'audio_format'].map(key => (
       <div className="media-option" key={key}>
        <span>{labels[key]}</span>
        {typeof options[key] === 'boolean' ? (
         <Checkbox
          isSelected={!!options[key]}
          isDisabled={busy}
          aria-label={labels[key]}
          onChange={checked => set(key, checked)}
         >
          <Checkbox.Content>
           <Checkbox.Control>
            <Checkbox.Indicator />
           </Checkbox.Control>
          </Checkbox.Content>
         </Checkbox>
        ) : (
         <SelectField
          label={labels[key]}
          isDisabled={busy}
          value={String(options[key])}
          onChange={next => set(key, key === 'height' ? Number(next) : next)}
          options={(enums[key] || []).map(value => ({
           value: String(value),
           label: value === 0 ? '自动' : value === 'auto' ? '自动' : value === 'best' ? '最高质量' : String(value)
          }))}
         />
        )}
       </div>
      ))}
     </div>
     <details className="media-advanced">
      <summary>更多下载选项</summary>
      <div className="media-options">
       {Object.keys(labels)
        .filter(
         key => !['height', 'audio_only', 'subtitle_only', 'subtitles', 'container', 'audio_format'].includes(key)
        )
        .map(key => (
         <div className="media-option" key={key}>
          <span>{labels[key]}</span>
          {typeof options[key] === 'boolean' ? (
           <Checkbox
            isSelected={!!options[key]}
            isDisabled={busy}
            aria-label={labels[key]}
            onChange={checked => set(key, checked)}
           >
            <Checkbox.Content>
             <Checkbox.Control>
              <Checkbox.Indicator />
             </Checkbox.Control>
            </Checkbox.Content>
           </Checkbox>
          ) : enums[key] ? (
           <SelectField
            label={labels[key]}
            isDisabled={busy}
            value={String(options[key])}
            onChange={next => set(key, next)}
            options={enums[key]
             .filter(value => value !== 'aria2c')
             .map(value => ({
              value: String(value),
              label: value === 'auto' ? '自动' : value === 'best' ? '最高质量' : String(value)
             }))}
           />
          ) : (
           <Input
            disabled={busy}
            type={typeof options[key] === 'number' || ['clip_start', 'clip_end'].includes(key) ? 'number' : 'text'}
            value={options[key] === null ? '' : String(options[key] ?? '')}
            onChange={e =>
             set(
              key,
              ['clip_start', 'clip_end'].includes(key)
               ? e.target.value === ''
                ? null
                : Number(e.target.value)
               : typeof options[key] === 'number'
                 ? Number(e.target.value)
                 : e.target.value
             )
            }
            title={key === 'sponsorblock' ? sponsorHelp : undefined}
            placeholder={
             key === 'format_ids'
              ? '自动选择；可填下方编号'
              : key === 'sponsorblock'
                ? '留空不移除；例如 sponsor,intro'
                : undefined
            }
           />
          )}
         </div>
        ))}
      </div>
      {source.formats?.length && (
       <details>
        <summary>查看精确格式编号</summary>
        <div className="media-format-list">
         {source.formats.map(f => (
          <p key={f.id}>
           {f.id} · {f.height || '音频'} · {f.extension} · {f.video_codec} / {f.audio_codec}
          </p>
         ))}
        </div>
       </details>
      )}
     </details>
     <Button
      variant="primary"
      size="sm"
      isDisabled={busy || (source.playlist && !selected.length)}
      onClick={() => void run(enqueue)}
     >
      下载所选媒体（{source.playlist ? selected.length : 1}）
     </Button>
    </div>
   )}
   <div className="media-jobs">
    {jobs.map(job => (
     <article key={job.id}>
      <div>
       <strong>{job.title}</strong>
       <p>
        {states[job.state] || job.state}
        {job.progress.total
         ? ` · ${Math.min(100, Math.round(((job.progress.downloaded || 0) / job.progress.total) * 100))}%`
         : ''}
       </p>
       {job.error_message && (
        <p className="hint" role="alert">
         {job.error_message}
        </p>
       )}
       {job.warning && <p className="hint">{job.warning}</p>}
      </div>
      <div className="row">
       {active(job) ? (
        <Button
         variant="ghost"
         size="sm"
         isDisabled={busy}
         onClick={() =>
          void run(async () => {
           await invoke('media:cancel', {id: job.id})
          })
         }
        >
         取消下载
        </Button>
       ) : job.state === 'completed' ? (
        <Button
         variant="tertiary"
         size="sm"
         isDisabled={busy}
         onClick={() =>
          void run(async () => {
           await invoke('media:open', {id: job.id})
          })
         }
        >
         查看下载文件
        </Button>
       ) : (
        <Button
         variant="tertiary"
         size="sm"
         isDisabled={busy}
         onClick={() =>
          void run(async () => {
           await invoke('media:retry', {id: job.id})
          })
         }
        >
         继续下载
        </Button>
       )}
      </div>
     </article>
    ))}
   </div>
  </Card>
 )
}
