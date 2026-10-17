import {useEffect, useState} from 'react'
import {ImAutomation} from './ImAutomation'
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
export function CommunicationIcon() {
 return (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
   <path d="M3 5h13v10H8l-5 4V5Z" />
   <path d="M18 8h3v13l-4-3h-5" />
   <path d="M7 9h5" />
  </svg>
 )
}
export function Communications({visible, close}: {visible: boolean; close: () => void}) {
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
  [receipt, setReceipt] = useState(''),
  [busy, setBusy] = useState(false),
  [error, setError] = useState(''),
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
  setError('')
  try {
   await fn()
   await refresh()
  } catch (reason) {
   setError(reason instanceof Error ? reason.message : String(reason))
  } finally {
   setBusy(false)
  }
 }
 useEffect(() => {
  if (visible) void run(refresh)
 }, [visible])
 useEffect(() => {
  setPeers([])
  setPeer('')
  setMessages([])
  setLogin(undefined)
  setQr('')
  setProbe(undefined)
  setText('')
  setConfirm(false)
  setReceipt('')
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
  <section
   className="ppt-extract-page learning-window"
   aria-label="通讯助手"
   hidden={!visible}
   style={!visible ? {display: 'none'} : undefined}
  >
   <aside className="learning-menu">
    <h2>通讯助手</h2>
    <p>
     应用内确认账号，
     <br />
     仅处理所选会话。
    </p>
    <button onClick={close}>返回课程对话</button>
   </aside>
   <main className="learning-content">
    <header>
     <div>
      <h2>通讯助手</h2>
      <p>QQ / 微信 · 本机独立连接</p>
     </div>
     <button disabled={busy} onClick={() => void run(refresh)}>
      刷新连接
     </button>
    </header>
    {error && (
     <p className="alert" role="alert">
      {error}
     </p>
    )}
    {busy && <p role="status">正在处理所选操作…</p>}
    <section className="knowledge-card">
     <p className="hint">
      不迁移其他软件账号、不自动读取或发送消息。QQ
      使用随附组件在后台运行；个人微信本机读取只支持指定登录进程，不能发送。微信 Web / Bot
      登录及历史范围依服务实际支持，失败时显示真实状态。
     </p>
     <div className="row">
      <input aria-label="通讯连接名称" placeholder="连接名称" value={name} onChange={e => setName(e.target.value)} />
      <select aria-label="通讯平台" value={platform} onChange={e => setPlatform(e.target.value)}>
       <option value="qq_napcat" disabled={!data?.platforms?.qq_napcat?.available}>
        QQ · 内置后台
       </option>
       <option value="weixin_local" disabled={!data?.platforms?.weixin_local?.available}>
        个人微信 · 本机只读
       </option>
       <option value="weixin_web">微信 Web · 实验</option>
       <option value="weixin_ilink">微信 Bot · iLink</option>
      </select>
      <button
       disabled={busy || !name.trim() || !data?.platforms?.[platform]?.available}
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
      </button>
     </div>
     {data?.platforms?.[platform]?.reason && <p className="hint">{data.platforms[platform].reason}</p>}
     <div className="row">
      <select aria-label="当前通讯账号" value={selected} onChange={e => setSelected(e.target.value)}>
       <option value="">选择连接</option>
       {data?.connections.map(item => (
        <option key={item.id} value={item.id}>
         {item.name}
         {item.account ? ' · ' + item.account : ''}
        </option>
       ))}
      </select>
      {row && (
       <button
        disabled={busy}
        onClick={() =>
         void run(async () => {
          await request('change', {action: 'delete', expected_revision: data!.revision, id: row.id})
          setSelected('')
         })
        }
       >
        删除所选连接
       </button>
      )}
     </div>
     {row && (
      <p className="hint">
       {row.account ? '已确认账号：' + row.account : '尚未确认账号'} ·{' '}
       {row.has_session ? '登录会话已保存' : '需要登录或绑定'}
      </p>
     )}
    </section>
    {row?.live?.reason && <p className="hint">{row.live.reason}</p>}
    {row && row.platform !== 'weixin_local' && (
     <section className="knowledge-card">
      <h3>扫码与账号确认</h3>
      <button
       disabled={busy || !liveAvailable}
       onClick={() =>
        void run(async () =>
         showLogin(
          await request<Login>('start', {operation_id: op(), connection_id: row.id, expected_revision: row.revision})
         )
        )
       }
      >
       开始登录
      </button>
      {login && (
       <>
        <p>
         {states[login.state] || login.state} {login.detail?.message || ''}
        </p>
        {qr && <img className="bili-login-qr" src={qr} alt="当前通讯连接二维码" />}
        {row.platform === 'weixin_ilink' && (
         <input
          aria-label="手机配对码"
          placeholder="手机显示的配对码"
          value={pairCode}
          onChange={e => setPairCode(e.target.value)}
         />
        )}
        <div className="row">
         <button
          disabled={busy || !liveAvailable}
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
         </button>
         <button
          disabled={busy}
          onClick={() => void run(async () => showLogin(await request<Login>('cancel', operation())))}
         >
          取消登录
         </button>
         {login.state === 'awaiting_bind' && (
          <button
           className="primary"
           disabled={busy || !liveAvailable}
           onClick={() =>
            void run(async () => {
             const result = await request<{login: Login}>('confirm', {...operation(), displayed_account: login.account})
             setLogin(result.login)
             setQr('')
            })
           }
          >
           确认绑定账号 {login.account}
          </button>
         )}
        </div>
       </>
      )}
     </section>
    )}
    {row?.platform === 'weixin_local' && (
     <section className="knowledge-card">
      <h3>绑定本机微信</h3>
      <p className="hint">
       请先在官方微信客户端登录；读取范围仅为你选中的进程和会话。点击核验才检查本机读取能力，密钥不写入文件。
      </p>
      <button
       disabled={busy || !liveAvailable}
       onClick={() =>
        void run(async () =>
         setProcesses(
          (await request<{processes: {pid: number; created: number; label: string}[]}>('personal-processes')).processes
         )
        )
       }
      >
       查找已登录微信进程
      </button>
      {processes.map(item => (
       <button
        key={item.pid}
        disabled={busy || !liveAvailable}
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
       </button>
      ))}
      {probe && (
       <button
        className="primary"
        disabled={busy || !liveAvailable}
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
       </button>
      )}
     </section>
    )}
    {row?.account && (
     <section className="knowledge-card">
      <h3>所选会话</h3>
      <button
       disabled={busy}
       onClick={() =>
        void run(async () => {
         const result = await request<{peers: {peer: string; name: string}[]}>('saved-directory', scope('_directory_'))
         setPeers(result.peers)
        })
       }
      >
       已保存会话
      </button>
      <button
       disabled={busy || !liveAvailable}
       onClick={() =>
        void run(async () => {
         const result = await request<{peers: {peer: string; name: string}[]}>('directory', scope('_directory_'))
         setPeers(result.peers)
        })
       }
      >
       读取会话目录
      </button>
      <select
       aria-label="选择通讯会话"
       value={peer}
       onChange={e => {
        setPeer(e.target.value)
        setMessages([])
        setText('')
        setConfirm(false)
       }}
      >
       <option value="">选择好友或群</option>
       {peers.map(item => (
        <option key={item.peer} value={item.peer}>
         {item.name} · {item.peer}
        </option>
       ))}
      </select>
      {peer && (
       <>
        <div className="row">
         <button
          disabled={busy || !liveAvailable}
          onClick={() =>
           void run(async () => {
            await request('sync', scope())
            await read()
           })
          }
         >
          同步所选会话
         </button>
         <button disabled={busy} onClick={() => void run(() => read())}>
          查看已保存消息
         </button>
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
         <button disabled={busy} onClick={() => void run(() => read(true))}>
          更早已保存消息
         </button>
        )}
        <input
         aria-label="回复草稿要求"
         placeholder="希望如何回复（可选）"
         value={instruction}
         onChange={e => setInstruction(e.target.value)}
        />
        <button
         disabled={busy || !messages.length}
         onClick={() =>
          void run(async () => {
           setText(await invoke('im:draft', {scope: scope(), instruction: instruction || '请准备简洁回复'}))
           setConfirm(false)
          })
         }
        >
         根据所选消息准备草稿
        </button>
        <textarea
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
          <label className="media-check">
           <input type="checkbox" checked={confirm} onChange={e => setConfirm(e.target.checked)} />
           我已核对账号 {row.account}、会话 {peer} 和正文，确认发送
          </label>
          <button
           disabled={busy || !liveAvailable || !confirm || !text.trim()}
           onClick={() =>
            void run(async () => {
             const result = await request<{state: string; operation_id: string}>('send', {
              ...scope(),
              operation_id: op(),
              text,
              user_confirmed: true
             })
             setReceipt(
              (result.state === 'sent'
               ? '服务已确认发送'
               : result.state === 'unknown'
                 ? '发送结果未知，请在手机核对，不自动重发'
                 : result.state) +
               ' · 操作编号 ' +
               result.operation_id
             )
             setConfirm(false)
            })
           }
          >
           发送已确认正文
          </button>
         </>
        )}
        {receipt && <p role="status">{receipt}</p>}
       </>
      )}
     </section>
    )}
    {row?.account && peer && (
     <ImAutomation
      key={row.id + row.login_epoch + peer}
      scope={scope()}
      visible={visible}
      liveAvailable={liveAvailable}
      onDraft={value => {
       setText(value)
       setConfirm(false)
      }}
     />
    )}
   </main>
  </section>
 )
}
