import {Button} from '@heroui/react'
import {useEffect, useState} from 'react'
import {notify} from '@renderer/ui/ToastHost'
const invoke = <T,>(action: string, args?: unknown) => window.assistant.invoke<T>(action, args)
type User = {loggedIn: boolean; name?: string; mid?: number}

export function BiliAccountPanel() {
 const [user, setUser] = useState<User>({loggedIn: false})
 const [busy, setBusy] = useState(false)
 const [qr, setQr] = useState('')
 const [login, setLogin] = useState('')
 const [tick, setTick] = useState(0)
 async function refresh() {
  setUser(await invoke<User>('bili-resources:status'))
 }
 useEffect(() => {
  void refresh().catch(reason => notify.error(reason, {title: '读取 B 站账号失败'}))
 }, [])
 useEffect(() => {
  if (!qr || !['waiting', 'scanning'].includes(login)) return
  let stopped = false
  const timer = setTimeout(() => {
   void invoke<{status: string}>('bili-resources:poll')
    .then(async result => {
     if (stopped) return
     setLogin(result.status)
     setTick(value => value + 1)
     if (result.status === 'success') {
      setQr('')
      await refresh()
      notify.success('B 站账号已登录')
     }
    })
    .catch(reason => {
     if (!stopped) {
      notify.error(reason, {title: '扫码状态检查失败', key: 'bili:login-poll'})
      setLogin('failed')
     }
    })
  }, 2500)
  return () => {
   stopped = true
   clearTimeout(timer)
  }
 }, [qr, login, tick])
 async function run(fn: () => Promise<void>) {
  setBusy(true)
  try {
   await fn()
  } catch (reason) {
   notify.error(reason)
  } finally {
   setBusy(false)
  }
 }
 return (
  <div className="panel-section">
   <div className="row">
    <span className="learning-course">{user.loggedIn ? user.name || '已登录' : '未登录'}</span>
    <Button variant="tertiary" size="sm" isDisabled={busy} onClick={() => void run(refresh)}>
     检查登录状态
    </Button>
    {user.loggedIn ? (
     <Button
      variant="ghost"
      size="sm"
      isDisabled={busy}
      onClick={() =>
       void run(async () => {
        await invoke('bili-resources:logout')
        setQr('')
        setLogin('')
        await refresh()
        notify.success('已退出 B 站账号')
       })
      }
     >
      退出 B 站
     </Button>
    ) : (
     <Button
      variant="primary"
      size="sm"
      isDisabled={busy}
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
     </Button>
    )}
   </div>
   {qr && (
    <div className="resource-qr">
     <img src={qr} alt="B 站官方登录二维码" />
     <p>
      {login === 'scanning'
       ? '已扫码，请在手机上确认'
       : login === 'expired'
         ? '二维码已过期，请重新生成'
         : login === 'failed'
           ? '检查失败，请重试'
           : '请使用 B 站手机应用扫码'}
     </p>
    </div>
   )}
  </div>
 )
}
