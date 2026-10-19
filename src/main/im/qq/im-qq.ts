import {createHash} from 'node:crypto'
import {z} from 'zod'
import {imLocalJson, imLoopback} from '@main/im/core/im-loopback'
const qq = z.union([
 z.string().regex(/^\d{1,18}$/),
 z.number().int().positive().max(Number.MAX_SAFE_INTEGER).transform(String)
])
export const onebotConfig = z.object({
 url: z.string().transform(imLoopback),
 token: z.string().max(8192),
 account: qq.optional()
})
export type OnebotConfig = z.infer<typeof onebotConfig>
function peer(value: string) {
 const match = /^(private|group):(\d{1,18})$/.exec(value)
 if (!match || !Number.isSafeInteger(Number(match[2]))) throw new Error('请选择 QQ 好友或群')
 return {group: match[1] === 'group', id: Number(match[2])}
}
/** Only explicit, account-verified protocol actions. Sending has no automatic retries. */
export class NativeQqSession {
 readonly config: OnebotConfig
 constructor(
  config: unknown,
  private fetcher: typeof fetch = fetch
 ) {
  this.config = onebotConfig.parse(config)
 }
 async action(name: string, body: unknown, signal: AbortSignal) {
  if (
   ![
    'get_login_info',
    'get_status',
    'get_friend_list',
    'get_group_list',
    'get_friend_msg_history',
    'get_group_msg_history',
    'send_private_msg',
    'send_group_msg'
   ].includes(name)
  )
   throw new Error('此 QQ 操作未启用')
  const result = z
   .object({status: z.literal('ok'), retcode: z.literal(0), data: z.unknown()})
   .parse(await imLocalJson(this.config.url, '/' + name, body, this.config.token, signal, this.fetcher))
  return result.data
 }
 async verify(account: string, signal: AbortSignal) {
  const login = z.object({user_id: qq}).parse(await this.action('get_login_info', {}, signal)),
   status = z
    .object({online: z.literal(true), good: z.boolean().optional()})
    .parse(await this.action('get_status', {}, signal))
  if (status.good === false || login.user_id !== account || (this.config.account && this.config.account !== account))
   throw new Error('QQ 账号或在线状态已改变，未读取或发送消息')
  return login.user_id
 }
 async identity(signal: AbortSignal) {
  const login = z.object({user_id: qq}).parse(await this.action('get_login_info', {}, signal))
  await this.verify(login.user_id, signal)
  return login.user_id
 }
 async directory(signal: AbortSignal) {
  const peers: {peer: string; name: string}[] = []
  for (const group of [false, true]) {
   const rows = z
    .array(z.record(z.string(), z.unknown()))
    .max(5000)
    .parse(await this.action(group ? 'get_group_list' : 'get_friend_list', {}, signal))
   for (const row of rows) {
    const id = qq.parse(row[group ? 'group_id' : 'user_id'])
    peers.push({
     peer: (group ? 'group:' : 'private:') + id,
     name: z
      .string()
      .parse(row[group ? 'group_name' : 'nickname'] || id)
      .slice(0, 200)
    })
   }
  }
  return {peers}
 }
 async receive(selected: string, account: string, signal: AbortSignal) {
  const target = peer(selected),
   result = z
    .object({messages: z.array(z.record(z.string(), z.unknown())).max(5000)})
    .parse(
     await this.action(
      target.group ? 'get_group_msg_history' : 'get_friend_msg_history',
      {[target.group ? 'group_id' : 'user_id']: target.id, count: 50},
      signal
     )
    )
  return result.messages.map(row => {
   if (
    (row.self_id !== undefined && qq.parse(row.self_id) !== account) ||
    (row[target.group ? 'group_id' : 'user_id'] !== undefined &&
     qq.parse(row[target.group ? 'group_id' : 'user_id']) !== String(target.id))
   )
    throw new Error('QQ 历史回包账号或所选会话不一致，未保存')
   const message = z
     .union([z.string(), z.array(z.object({type: z.string(), data: z.record(z.string(), z.unknown())}))])
     .parse(row.message),
    text =
     typeof message === 'string'
      ? message
      : message.map(part => (part.type === 'text' ? z.string().parse(part.data.text) : '[' + part.type + ']')).join('')
   return {
    mid: z.union([z.string(), z.number().int().finite().transform(String)]).parse(row.message_id),
    ts: z.number().finite().nonnegative().parse(row.time),
    sender:
     typeof row.sender === 'object' && row.sender ? String((row.sender as {user_id?: unknown}).user_id || '') : '',
    text: text.slice(0, 50000),
    kind: 'text'
   }
  })
 }
 async send(selected: string, text: string, signal: AbortSignal) {
  const target = peer(selected),
   result = z
    .object({message_id: z.union([z.string().min(1).max(200), z.number().int().finite().transform(String)])})
    .parse(
     await this.action(
      target.group ? 'send_group_msg' : 'send_private_msg',
      {[target.group ? 'group_id' : 'user_id']: target.id, message: [{type: 'text', data: {text}}]},
      signal
     )
    )
  return result.message_id
 }
}
export class NativeNapcatLogin {
 private credential = ''
 private configured = false
 constructor(
  private url: string,
  private token: string,
  readonly onebot: OnebotConfig,
  private managed: boolean,
  private fetcher: typeof fetch = fetch
 ) {
  imLoopback(url)
  onebotConfig.parse(onebot)
 }
 private async action(name: string, body: unknown, signal: AbortSignal, authenticated = true) {
  if (
   ![
    'auth/login',
    'QQLogin/CheckLoginStatus',
    'QQLogin/GetQQLoginInfo',
    'OB11Config/GetConfig',
    'OB11Config/SetConfig'
   ].includes(name)
  )
   throw new Error('QQ 登录操作无效')
  const result = z
   .object({code: z.literal(0), data: z.unknown()})
   .parse(await imLocalJson(this.url, '/api/' + name, body, authenticated ? this.credential : '', signal, this.fetcher))
  return result.data
 }
 async start(signal: AbortSignal) {
  const result = z.object({Credential: z.string().min(1).max(8192)}).parse(
   await this.action(
    'auth/login',
    {
     hash: createHash('sha256')
      .update(this.token + '.napcat')
      .digest('hex')
    },
    signal,
    false
   )
  )
  this.credential = result.Credential
  this.token = ''
  return this.poll(signal)
 }
 async poll(signal: AbortSignal) {
  const result = z
   .object({
    isLogin: z.boolean(),
    loginError: z.unknown().optional(),
    qrLoginAccepted: z.boolean().optional(),
    qrcodeurl: z.string().max(8192).optional()
   })
   .parse(await this.action('QQLogin/CheckLoginStatus', {}, signal))
  if (result.isLogin) return {state: 'verifying' as const, qr: ''}
  if (result.loginError) throw new Error('QQ 组件拒绝此次扫码登录')
  if (result.qrcodeurl) {
   const url = new URL(result.qrcodeurl)
   if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    !(url.hostname === 'qq.com' || url.hostname.endsWith('.qq.com'))
   )
    throw new Error('QQ 二维码地址未通过核验')
  }
  return {state: result.qrLoginAccepted ? ('scanned' as const) : ('waiting_scan' as const), qr: result.qrcodeurl || ''}
 }
 async verify(signal: AbortSignal) {
  if (this.managed && !this.configured) {
   const config = z
     .object({network: z.object({httpServers: z.array(z.record(z.string(), z.unknown()))}).passthrough()})
     .passthrough()
     .parse(await this.action('OB11Config/GetConfig', {}, signal)),
    owned = config.network.httpServers.filter(row => row.name === 'meijiang-native-http')
   if (owned.length > 1) throw new Error('QQ 消息接口存在重名配置，未覆盖')
   config.network.httpServers = [
    ...config.network.httpServers.filter(row => row.name !== 'meijiang-native-http'),
    {
     name: 'meijiang-native-http',
     enable: true,
     host: '127.0.0.1',
     port: Number(new URL(this.onebot.url).port),
     enableCors: false,
     enableWebsocket: false,
     messagePostFormat: 'array',
     token: this.onebot.token,
     debug: false
    }
   ]
   await this.action('OB11Config/SetConfig', {config: JSON.stringify(config)}, signal)
   this.configured = true
  }
  const session = new NativeQqSession(this.onebot, this.fetcher)
  let account = '',
   lastError: unknown
  const deadline = Date.now() + 20000
  do {
   signal.throwIfAborted()
   try {
    account = await session.identity(signal)
    break
   } catch (error) {
    lastError = error
    await new Promise(resolve => setTimeout(resolve, 500))
   }
  } while (Date.now() < deadline)
  if (!account) throw lastError || new Error('QQ 消息接口未就绪')
  const control = z
   .object({online: z.literal(true), uin: qq})
   .parse(await this.action('QQLogin/GetQQLoginInfo', {}, signal))
  if (control.uin !== account || (this.onebot.account && this.onebot.account !== account))
   throw new Error('QQ 管理端和消息接口账号不同，未绑定')
  return {
   account,
   session: {onebot: {...this.onebot, account}},
   capabilities: {
    identity: 'personal_qq',
    history: 'onebot_extension_unverified',
    messages: 'selected_conversation',
    send: 'explicit_confirmed_text'
   }
  }
 }
}
