import {useEffect, useState} from 'react'
import type {RuntimeStatus} from '../../shared/runtime'
export function RuntimePanel() {
 const [data, setData] = useState<RuntimeStatus>(),
  [error, setError] = useState(''),
  [busy, setBusy] = useState(false),
  [notice, setNotice] = useState('')
 const refresh = () => window.assistant.invoke<RuntimeStatus>('runtime:status').then(setData)
 useEffect(() => {
  void refresh().catch(e => setError(String(e)))
 }, [])
 async function install(id: string) {
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
   {error && (
    <p className="alert" role="alert">
     {error}
    </p>
   )}
   {notice && <p role="status">{notice}</p>}
   {data?.components.map(c => (
    <article className="knowledge-item" key={c.id}>
     <strong>{c.label}</strong>
     <span>
      {' '}
      · {(c.bytes / 1048576).toFixed(1)} MiB · {c.installed ? '已安装' : '未安装'}
     </span>
     <button disabled={busy || c.installed} onClick={() => void install(c.id)}>
      选择组件文件夹安装
     </button>
    </article>
   ))}
   <button disabled={busy} onClick={() => void refresh().catch(e => setError(String(e)))}>
    刷新组件状态
   </button>
  </section>
 )
}
