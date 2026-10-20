import {Button} from '@heroui/react'
import {useEffect, useRef, useState} from 'react'
import {notify} from '@renderer/ui/ToastHost'
const invoke = (action: string, args?: unknown) => window.assistant.invoke(action, args)

/** 智云登录视图：嵌入设置的智云账号分区，负责网页覆盖层的位置同步。 */
export function ZhiyunLoginPanel() {
 const slot = useRef<HTMLDivElement>(null)
 async function navigate(action: string) {
  try {
   await invoke(action)
  } catch (e) {
   notify.error(e, {title: '网页无法打开', description: '请检查网络后刷新'})
  }
 }
 useEffect(() => {
  const node = slot.current
  if (!node) return
  const update = () => {
   const b = node.getBoundingClientRect()
   void invoke('zhiyun:bounds', {bounds: {x: b.x, y: b.y, width: b.width, height: b.height}, visible: true}).catch(e =>
    notify.error(e, {title: '登录页面无法打开'})
   )
  }
  const observer = new ResizeObserver(update)
  observer.observe(node)
  window.addEventListener('resize', update)
  window.addEventListener('scroll', update, true)
  update()
  const remove = window.assistant.onEvent(e => {
   if (e.kind === 'progress' && e.data.stage === '智云登录' && e.data.error)
    notify.error(e.data.message, {title: '智云登录失败', key: 'zhiyun-login'})
  })
  return () => {
   observer.disconnect()
   window.removeEventListener('resize', update)
   window.removeEventListener('scroll', update, true)
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
    <span>登录完成后关闭设置，回到智云导入</span>
   </div>
   <div className="zhiyun-login-slot" ref={slot} />
  </div>
 )
}
