import {Button} from '@heroui/react'
import {useEffect, useRef, useState} from 'react'
import {AlertBox} from '@renderer/ui/AlertBox'
const invoke = (action: string, args?: unknown) => window.assistant.invoke(action, args)

/** 智云登录视图：嵌入「智云课堂」窗口内部，负责网页覆盖层的位置同步。 */
export function ZhiyunLoginPanel() {
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
   void invoke('zhiyun:bounds', {bounds: {x: b.x, y: b.y, width: b.width, height: b.height}, visible: true}).catch(() =>
    setError('登录页面无法打开，请重试')
   )
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
  <div className="zhiyun-login-view">
   <div className="zhiyun-login-toolbar">
    <Button variant="ghost" size="sm" onClick={() => void navigate('zhiyun:back')}>
     返回
    </Button>
    <Button variant="ghost" size="sm" onClick={() => void navigate('zhiyun:refresh')}>
     刷新
    </Button>
    <Button variant="tertiary" size="sm" onClick={() => void navigate('zhiyun:login')}>
     智云首页
    </Button>
    <span>登录完成后切回「搜索与导出」</span>
   </div>
   {error && <AlertBox>{error}</AlertBox>}
   <div className="zhiyun-login-slot" ref={slot} />
  </div>
 )
}
