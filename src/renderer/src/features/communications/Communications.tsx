import {useEffect, useState} from 'react'
import {MessagesSquare} from 'lucide-react'
import {Button, Card, Checkbox, Input, TextArea} from '@heroui/react'
import {notify} from '@renderer/ui/ToastHost'
import {SelectField} from '@renderer/ui/SelectField'
import {ImAutomation} from '@renderer/features/communications/ImAutomation'
type Capability = {available: boolean; reason: string}
type Connection = {
 id: string
 name: string
 platform: string
 revision: string
 account: string
 login_epoch: string
 has_session: boolean
 live: Capability
}
type Listing = {
 revision: string
 connections: Connection[]
 platforms: Record<string, Capability>
 qq_component: {state: string; version: string}
}
type Login = {
 operation_id: string
 connection_id: string
 generation: string
 state: string
 account: string
 has_qr: boolean
 detail?: {message?: string}
}
type Scope = {
 connection_id: string
 revision: string
 platform: string
 account: string
 login_epoch: string
 peer: string
}
type Message = {mid: string; text: string; sender: string; ts: number}
const invoke = <T,>(action: string, args?: unknown) => window.assistant.invoke<T>(action, args)
const request = <T,>(action: string, value: unknown = {}) =>
 invoke<T>('tools:request', {action: 'im', args: {action, value}})
const op = () => crypto.randomUUID().replaceAll('-', '')
const states: Record<string, string> = {
 waiting_scan: '等待手机扫码',
 scanned: '已扫码，等待手机确认',
 verifying: '正在核验账号',
 awaiting_bind: '请确认绑定当前账号',
 online: '账号已绑定',
 failed: '登录失败',
 expired: '二维码已过期',
 cancelled: '已取消',
 unknown: '登录结果待确认'
}
export function CommunicationsPanel() {
 const [data, setData] = useState<Listing>(),
  [platform, setPlatform] = useState('qq_napcat'),
  [name, setName] = useState(''),
  [selected, setSelected] = useState(''),
  [login, setLogin] = useState<Login>(),
  [qr, setQr] = useState(''),
  [pairCode, setPairCode] = useState(''),
  [peers, setPeers] = useState<{peer: string; name: string}[]>([]),
  [peer, setPeer] = useState(''),
  [messages, setMessages] = useState<Message[]>([]),
  [cursor, setCursor] = useState<unknown>(),
  [text, setText] = useState(''),
  [instruction, setInstruction] = useState(''),
  [confirm, setConfirm] = useState(false),
  [busy, setBusy] = useState(false),
  [processes, setProcesses] = useState<{pid: number; created: number; label: string}[]>([]),
  [probe, setProbe] = useState<{probe_id: string; account: string}>()
 const row = data?.connections.find(item => item.id === selected),
  liveAvailable = row?.live?.available === true
 const scope = (chosen = peer): Scope => {
  if (!row?.account || !chosen) throw new Error('请先绑定账号并选择会话')
  return {
   connection_id: row.id,
   revision: row.revision,
   platform: row.platform,
   account: row.account,
   login_epoch: row.login_epoch,
   peer: chosen
  }
 }
 async function refresh() {
  setData(await request('status'))
 }
 async function run(fn: () => Promise<unknown>) {
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
 useEffect(() => {
  void run(refresh)
 }, [])
 useEffect(() => {
  setPeers([])
  setPeer('')
  setMessages([])
  setLogin(undefined)
  setQr('')
  setProbe(undefined)
  setText('')
  setConfirm(false)
 }, [selected])
 async function showLogin(next: Login) {
  setLogin(next)
  setQr(
   next.has_qr
    ? await request<string>('qr', {
       operation_id: next.operation_id,
       connection_id: next.connection_id,
       generation: next.generation
      })
    : ''
  )
 }
 const operation = () => ({
  operation_id: login!.operation_id,
  connection_id: login!.connection_id,
  generation: login!.generation
 })
 async function read(older = false) {
  const result = await request<{messages: Message[]; next_cursor: unknown}>('read', {
   ...scope(),
   limit: 50,
   ...(older && cursor ? {cursor} : {})
  })
  setMessages(older ? old => [...old, ...result.messages] : result.messages)
  setCursor(result.next_cursor)
 }
 return (
  <div className="panel-section communications-panel">
   {busy && <p role="status">正在处理所选操作…</p>}
   <Card className="knowledge-card">
    <div className="row">
     <Button variant="ghost" size="sm" isDisabled={busy} onPress={() => void run(refresh)}>
      刷新连接
     </Button>
    </div>
    <p className="hint">
     不迁移其他软件账号、不自动读取或发送消息。QQ
     使用随附组件在后台运行；个人微信本机读取只支持指定登录进程，不能发送。微信 Web / Bot
     登录及历史范围依服务实际支持，失败时显示真实状态。
    </p>
    <div className="row">
     <Input aria-label="通讯连接名称" placeholder="连接名称" value={name} onChange={e => setName(e.target.value)} />
     <SelectField
      label="通讯平台"
      value={platform}
      onChange={next => setPlatform(next)}
      disabledKeys={Object.entries(data?.platforms || {})
       .filter(([, capability]) => !capability.available)
       .map(([id]) => id)}
      options={[
       {value: 'qq_napcat', label: 'QQ · 内置后台'},
       {value: 'weixin_local', label: '个人微信 · 本机只读'},
       {value: 'weixin_web', label: '微信 Web · 实验'},
       {value: 'weixin_ilink', label: '微信 Bot · iLink'}
      ]}
     />
     <Button
      variant="tertiary"
      size="sm"
      isDisabled={busy || !name.trim() || !data?.platforms?.[platform]?.available}
      onClick={() =>
       void run(async () => {
        const next = await request<Listing>('change', {
         action: 'create',
         expected_revision: data!.revision,
         name,
         platform,
         fields: platform === 'qq_napcat' ? {mode: 'managed'} : {},
         secrets: {}
        })
        const added = next.connections.find(item => !data!.connections.some(old => old.id === item.id))
        setData(next)
        setSelected(added?.id || '')
        setName('')
       })
      }
     >
      添加连接
     </Button>
    </div>
    {data?.platforms?.[platform]?.reason && <p className="hint">{data.platforms[platform].reason}</p>}
    <div className="row">
     <SelectField
      label="当前通讯账号"
      placeholder="选择连接"
      value={selected}
      onChange={next => setSelected(next)}
      options={[
       {value: '', label: '选择连接'},
       ...(data?.connections || []).map(item => ({
        value: item.id,
        label: item.name + (item.account ? ' · ' + item.account : '')
       }))
      ]}
     />
     {row && (
      <Button
       variant="ghost"
       size="sm"
       isDisabled={busy}
       onClick={() =>
        void run(async () => {
         await request('change', {action: 'delete', expected_revision: data!.revision, id: row.id})
         setSelected('')
        })
       }
      >
       删除所选连接
      </Button>
     )}
    </div>
    {row && (
     <p className="hint">
      {row.account ? '已确认账号：' + row.account : '尚未确认账号'} ·{' '}
      {row.has_session ? '登录会话已保存' : '需要登录或绑定'}
     </p>
    )}
   </Card>
   {row?.live?.reason && <p className="hint">{row.live.reason}</p>}
   {row && row.platform !== 'weixin_local' && (
    <Card className="knowledge-card">
     <h3>扫码与账号确认</h3>
     <Button
      variant="tertiary"
      size="sm"
      isDisabled={busy || !liveAvailable}
      onClick={() =>
       void run(async () =>
        showLogin(
         await request<Login>('start', {operation_id: op(), connection_id: row.id, expected_revision: row.revision})
        )
       )
      }
     >
      开始登录
     </Button>
     {login && (
      <>
       <p>
        {states[login.state] || login.state} {login.detail?.message || ''}
       </p>
       {qr && <img className="bili-login-qr" src={qr} alt="当前通讯连接二维码" />}
       {row.platform === 'weixin_ilink' && (
        <Input
         aria-label="手机配对码"
         placeholder="手机显示的配对码"
         value={pairCode}
         onChange={e => setPairCode(e.target.value)}
        />
       )}
       <div className="row">
        <Button
         variant="tertiary"
         size="sm"
         isDisabled={busy || !liveAvailable}
         onClick={() =>
          void run(async () =>
           showLogin(
            await request<Login>('inspect', {
             ...operation(),
             refresh: true,
             ...(pairCode ? {verify_code: pairCode} : {})
            })
           )
          )
         }
        >
         检查登录状态
        </Button>
        <Button
         variant="ghost"
         size="sm"
         isDisabled={busy}
         onClick={() => void run(async () => showLogin(await request<Login>('cancel', operation())))}
        >
         取消登录
        </Button>
        {login.state === 'awaiting_bind' && (
         <Button
          variant="primary"
          size="sm"
          isDisabled={busy || !liveAvailable}
          onClick={() =>
           void run(async () => {
            const result = await request<{login: Login}>('confirm', {...operation(), displayed_account: login.account})
            setLogin(result.login)
            setQr('')
           })
          }
         >
          确认绑定账号 {login.account}
         </Button>
        )}
       </div>
      </>
     )}
    </Card>
   )}
   {row?.platform === 'weixin_local' && (
    <Card className="knowledge-card">
     <h3>绑定本机微信</h3>
     <p className="hint">
      请先在官方微信客户端登录；读取范围仅为你选中的进程和会话。点击核验才检查本机读取能力，密钥不写入文件。
     </p>
     <Button
      variant="tertiary"
      size="sm"
      isDisabled={busy || !liveAvailable}
      onClick={() =>
       void run(async () =>
        setProcesses(
         (await request<{processes: {pid: number; created: number; label: string}[]}>('personal-processes')).processes
        )
       )
      }
     >
      查找已登录微信进程
     </Button>
     {processes.map(item => (
      <Button
       variant="tertiary"
       size="sm"
       key={item.pid}
       isDisabled={busy || !liveAvailable}
       onClick={() =>
        void run(async () =>
         setProbe(
          await request('personal-probe', {
           connection_id: row.id,
           revision: row.revision,
           pid: item.pid,
           created: item.created
          })
         )
        )
       }
      >
       核验 {item.label}
      </Button>
     ))}
     {probe && (
      <Button
       variant="primary"
       size="sm"
       isDisabled={busy || !liveAvailable}
       onClick={() =>
        void run(async () => {
         await request('personal-confirm', {
          connection_id: row.id,
          revision: row.revision,
          probe_id: probe.probe_id,
          account: probe.account,
          user_confirmed: true
         })
         setProbe(undefined)
        })
       }
      >
       确认只读绑定 {probe.account}
      </Button>
     )}
    </Card>
   )}
   {row?.account && (
    <Card className="knowledge-card">
     <h3>所选会话</h3>
     <Button
      variant="tertiary"
      size="sm"
      isDisabled={busy}
      onClick={() =>
       void run(async () => {
        const result = await request<{peers: {peer: string; name: string}[]}>('saved-directory', scope('_directory_'))
        setPeers(result.peers)
       })
      }
     >
      已保存会话
     </Button>
     <Button
      variant="tertiary"
      size="sm"
      isDisabled={busy || !liveAvailable}
      onClick={() =>
       void run(async () => {
        const result = await request<{peers: {peer: string; name: string}[]}>('directory', scope('_directory_'))
        setPeers(result.peers)
       })
      }
     >
      读取会话目录
     </Button>
     <SelectField
      label="选择通讯会话"
      placeholder="选择好友或群"
      value={peer}
      onChange={next => {
       setPeer(next)
       setMessages([])
       setText('')
       setConfirm(false)
      }}
      options={[
       {value: '', label: '选择好友或群'},
       ...peers.map(item => ({value: item.peer, label: item.name + ' · ' + item.peer}))
      ]}
     />
     {peer && (
      <>
       <div className="row">
        <Button
         variant="tertiary"
         size="sm"
         isDisabled={busy || !liveAvailable}
         onClick={() =>
          void run(async () => {
           await request('sync', scope())
           await read()
          })
         }
        >
         同步所选会话
        </Button>
        <Button variant="tertiary" size="sm" isDisabled={busy} onClick={() => void run(() => read())}>
         查看已保存消息
        </Button>
       </div>
       <p className="hint">仅当前联系人或群的可取得消息。实际覆盖范围由后台返回；“同步成功”不表示全部历史已取得。</p>
       <div className="discussion-list">
        {messages.map(message => (
         <article key={message.mid}>
          <strong>{message.sender}</strong>
          <small> · {new Date(message.ts * 1000).toLocaleString()}</small>
          <p>{message.text}</p>
         </article>
        ))}
       </div>
       {!!cursor && (
        <Button variant="tertiary" size="sm" isDisabled={busy} onClick={() => void run(() => read(true))}>
         更早已保存消息
        </Button>
       )}
       <Input
        aria-label="回复草稿要求"
        placeholder="希望如何回复（可选）"
        value={instruction}
        onChange={e => setInstruction(e.target.value)}
       />
       <Button
        variant="tertiary"
        size="sm"
        isDisabled={busy || !messages.length}
        onClick={() =>
         void run(async () => {
          setText(await invoke('im:draft', {scope: scope(), instruction: instruction || '请准备简洁回复'}))
          setConfirm(false)
         })
        }
       >
        根据所选消息准备草稿
       </Button>
       <TextArea
        aria-label="通讯回复正文"
        placeholder="待核对的回复；不会自动发送"
        maxLength={4000}
        value={text}
        onChange={e => {
         setText(e.target.value)
         setConfirm(false)
        }}
       />
       {row.platform === 'weixin_local' ? (
        <p className="hint">本机个人微信为只读模式，可复制草稿到官方客户端。</p>
       ) : (
        <>
         <Checkbox className="media-check" isSelected={confirm} onChange={setConfirm}>
          <Checkbox.Content>
           <Checkbox.Control>
            <Checkbox.Indicator />
           </Checkbox.Control>
           我已核对账号 {row.account}、会话 {peer} 和正文，确认发送
          </Checkbox.Content>
         </Checkbox>
         <Button
          variant="tertiary"
          size="sm"
          isDisabled={busy || !liveAvailable || !confirm || !text.trim()}
          onClick={() =>
           void run(async () => {
            const result = await request<{state: string; operation_id: string}>('send', {
             ...scope(),
             operation_id: op(),
             text,
             user_confirmed: true
            })
            const message =
             (result.state === 'sent'
              ? '服务已确认发送'
              : result.state === 'unknown'
                ? '发送结果未知，请在手机核对，不自动重发'
                : result.state) +
             ' · 操作编号 ' +
             result.operation_id
            if (result.state === 'sent') notify.success(message, {timeout: 8000})
            else if (result.state === 'unknown') notify.warning(message, {timeout: 10000})
            else notify.info(message, {timeout: 8000})
            setConfirm(false)
           })
          }
         >
          发送已确认正文
         </Button>
        </>
       )}
      </>
     )}
    </Card>
   )}
   {row?.account && peer && (
    <ImAutomation
     key={row.id + row.login_epoch + peer}
     scope={scope()}
     visible={true}
     liveAvailable={liveAvailable}
     onDraft={value => {
      setText(value)
      setConfirm(false)
     }}
    />
   )}
  </div>
 )
}
