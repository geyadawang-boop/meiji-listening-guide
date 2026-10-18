import {useEffect, useState, useRef} from 'react'
import type {RuntimeStatus} from '@shared/runtime'
export function RuntimePanel() {
 const [data, setData] = useState<RuntimeStatus>(),
  [error, setError] = useState(''),
  [busy, setBusy] = useState(false),
  [notice, setNotice] = useState('')
 const [refreshing, setRefreshing] = useState(false),
  generation = useRef(0)
 const [platform, setPlatform] = useState<string>()
 const isWindows = platform === 'win32'
 useEffect(() => {
  void window.assistant
   .invoke<{platform: string}>('app:info')
   .then(info => setPlatform(info.platform))
   .catch(() => setPlatform(''))
 }, [])
 const refresh = async () => {
  const current = ++generation.current
  setRefreshing(true)
  try {
   const result = await window.assistant.invoke<RuntimeStatus>('runtime:status')
   if (current === generation.current) {
    setData(result)
    setError('')
   }
  } catch (error) {
   if (current === generation.current) setError(String(error))
  } finally {
   if (current === generation.current) setRefreshing(false)
  }
 }
 useEffect(() => {
  void refresh()
  return () => {
   generation.current++
  }
 }, [])
 async function install(id: string) {
  if (!isWindows) {
   setError('运行组件目前仅支持 Windows，无法在当前平台安装。')
   return
  }
  setBusy(true)
  setError('')
  try {
   const result = await window.assistant.invoke('runtime:install', {id})
   if (result) {
    await refresh()
    setNotice('组件已校验并安装，请重启软件后使用。')
   }
  } catch (e) {
   setError(String(e))
  } finally {
   setBusy(false)
  }
 }
 return (
  <section aria-label="应用与运行组件">
   <h3>应用与运行组件</h3>
   <p>梅酱的听课指南 {data?.version || ''}</p>
   <p className="hint">完整包可离线使用。轻量包可选择同版本组件文件夹安装；不会自动下载或更改你的资料。</p>
   {platform !== undefined && !isWindows && (
    <p className="hint" role="status">
     运行组件目前仅支持 Windows；此平台不可安装 Windows 专属组件。
    </p>
   )}
   {error && (
    <p className="alert" role="alert">
     {error}
    </p>
   )}
   {data?.reason && (
    <p className="hint" role="status">
     {data.reason}
    </p>
   )}
   {notice && <p role="status">{notice}</p>}
   {data?.components.map(c => (
    <article className="knowledge-item" key={c.id}>
     <strong>{c.label}</strong>
     <span>
      {' '}
      · {(c.bytes / 1048576).toFixed(1)} MiB ·{' '}
      {c.validation === 'verified'
       ? '已校验'
       : c.validation === 'invalid'
         ? '校验失败'
         : c.validation === 'unsupported_target'
           ? '目标不支持'
           : c.validation === 'missing'
             ? '文件缺失'
             : c.installed
               ? '已安装'
               : '未安装'}
     </span>
     {c.reason && <p className="hint">{c.reason}</p>}
     <button
      className="d-btn"
      disabled={busy || refreshing || c.installed || c.installable === false || platform !== 'win32'}
      onClick={() => void install(c.id)}
     >
      选择组件文件夹安装
     </button>
    </article>
   ))}
   <button className="d-btn" disabled={busy || refreshing} onClick={() => void refresh()}>
    {refreshing ? '正在校验组件…' : '刷新组件状态'}
   </button>
  </section>
 )
}
