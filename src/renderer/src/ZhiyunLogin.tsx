import {useEffect, useRef, useState} from 'react'
const invoke = (action: string, args?: unknown) => window.assistant.invoke(action, args)
export function ZhiyunLogin({close, exportResources}: {close: () => void; exportResources: () => void}) {
 const slot = useRef<HTMLDivElement>(null),
  [error, setError] = useState('')
 async function navigate(action: string) {
  setError('')
  try {
   await invoke(action)
  } catch {
   setError('网页暂时无法打开，请检查网络后刷新')
  }
 }
 useEffect(() => {
  const node = slot.current
  if (!node) return
  const update = () => {
   const b = node.getBoundingClientRect()
   void invoke('zhiyun:bounds', {bounds: {x: b.x, y: b.y, width: b.width, height: b.height}, visible: true}).catch(() => setError('登录页面无法打开，请重试'))
  }
  const observer = new ResizeObserver(update)
  observer.observe(node)
  window.addEventListener('resize', update)
  update()
  const remove = window.assistant.onEvent(e => {
   if (e.kind === 'progress' && e.data.stage === '智云登录' && e.data.error) setError(e.data.message)
  })
  return () => {
   observer.disconnect()
   window.removeEventListener('resize', update)
   remove()
   void invoke('zhiyun:bounds', {bounds: {x: 0, y: 0, width: 0, height: 0}, visible: false})
  }
 }, [])
 return (
  <section className="zhiyun-login-page" aria-label="智云登录页面">
   <header>
    <div>
     <h1>智云登录</h1>
    </div>
    <div>
     <button onClick={close}>返回搜索与导出</button>
     <button className="primary" onClick={exportResources}>
      搜索与导出
     </button>
    </div>
   </header>
   <div className="zhiyun-login-toolbar">
    <button onClick={() => void navigate('zhiyun:back')}>返回</button>
    <button onClick={() => void navigate('zhiyun:refresh')}>刷新</button>
    <button onClick={() => void navigate('zhiyun:login')}>智云首页</button>
   </div>
   {error && (
    <div className="alert" role="alert">
     {error}
    </div>
   )}
   <div className="zhiyun-login-slot" ref={slot} />
  </section>
 )
}
