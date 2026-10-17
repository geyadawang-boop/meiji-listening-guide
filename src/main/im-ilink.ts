import {randomBytes} from 'node:crypto'
import {z} from 'zod'
import {boundedPublicText} from './public-http'
const base = 'https://ilinkai.weixin.qq.com',
 text = z.string().min(1).max(8192)
const sessionSchema = z.object({
 token: text,
 account: z.string().min(1).max(200),
 user: text,
 base: z.string().refine(value => new URL(value).origin === base && ['', '/'].includes(new URL(value).pathname) && !new URL(value).search && !new URL(value).hash && !new URL(value).username && !new URL(value).password),
 cursor: z.string().max(1000000).default(''),
 contexts: z.record(z.string(), z.string().max(8192)).default({})
})
type Session = z.infer<typeof sessionSchema>
/** Fixed-host Bot protocol, with a committed cursor only after the chosen peer is saved. */
export class NativeILinkSession {
 private session: Session | undefined
 private qrcode = ''
 private qr = ''
 private verifyCode = ''
 constructor(
  saved?: unknown,
  private fetcher: typeof fetch = fetch
 ) {
  if (saved) this.session = sessionSchema.parse(saved)
 }
 submitCode(code: string) {
  this.verifyCode = z
   .string()
   .regex(/^\d{1,12}$/)
   .parse(code)
 }
 private async request(path: string, method: 'GET' | 'POST', body: unknown, query: Record<string, string>, signal: AbortSignal) {
  if (!['get_bot_qrcode', 'get_qrcode_status', 'getconfig', 'getupdates', 'sendmessage'].includes(path)) throw new Error('微信Bot操作无效')
  const url = new URL(base + '/ilink/bot/' + path)
  url.search = new URLSearchParams(query).toString()
  const response = await this.fetcher(url.href, {
   method,
   redirect: 'error',
   credentials: 'omit',
   headers: {
    'content-type': 'application/json',
    AuthorizationType: 'ilink_bot_token',
    'iLink-App-Id': 'bot',
    'iLink-App-ClientVersion': String((2 << 16) | (4 << 8) | 10),
    'X-WECHAT-UIN': Buffer.from(String(randomBytes(4).readUInt32BE())).toString('base64'),
    ...(this.session ? {Authorization: 'Bearer ' + this.session.token} : {})
   },
   ...(method === 'POST' ? {body: JSON.stringify(body)} : {}),
   signal: AbortSignal.any([signal, AbortSignal.timeout(40000)])
  })
  if (!response.ok) throw new Error('微信Bot接口未成功，请稍后检查连接')
  const data = z.record(z.string(), z.unknown()).parse(JSON.parse(await boundedPublicText(response, 4 * 1024 * 1024)))
  for (const key of ['ret', 'errcode']) if (data[key] !== undefined && (typeof data[key] !== 'number' || !Number.isInteger(data[key]) || data[key] !== 0)) throw new Error(data[key] === -14 ? '微信Bot会话已失效，请重新扫码' : '微信Bot接口返回错误，未确认完成')
  return data
 }
 async start(signal: AbortSignal) {
  const data = z.object({qrcode: text, qrcode_img_content: text}).parse(await this.request('get_bot_qrcode', 'POST', {local_token_list: []}, {bot_type: '3'}, signal))
  this.qrcode = data.qrcode
  const url = new URL(data.qrcode_img_content)
  if (url.protocol !== 'https:' || url.username || url.password || !(url.hostname === 'weixin.qq.com' || url.hostname.endsWith('.weixin.qq.com'))) throw new Error('微信Bot二维码网址未核验')
  this.qr = url.href
  return {state: 'waiting_scan', qr: this.qr}
 }
 async poll(signal: AbortSignal) {
  const data = await this.request('get_qrcode_status', 'GET', undefined, {qrcode: this.qrcode, ...(this.verifyCode ? {verify_code: this.verifyCode} : {})}, signal)
  if (data.status === 'wait') return {state: 'waiting_scan', qr: this.qr}
  if (data.status === 'scaned') {
   this.verifyCode = ''
   return {state: 'scanned', qr: this.qr}
  }
  if (data.status === 'need_verifycode') return {state: 'waiting_confirm', qr: '', detail: {message: '请输入手机微信显示的数字验证码。'}}
  if (data.status === 'expired') return {state: 'expired', qr: ''}
  if (['verify_code_blocked', 'binded_redirect'].includes(String(data.status))) throw new Error('微信Bot此次扫码未取得有效会话，请重新开始')
  if (data.status === 'scaned_but_redirect') {
   if (data.redirect_host !== 'ilinkai.weixin.qq.com') throw new Error('微信Bot返回不支持的区域地址')
   return {state: 'scanned', qr: this.qr}
  }
  if (data.status !== 'confirmed') throw new Error('微信Bot返回未知登录状态')
  this.session = sessionSchema.parse({token: data.bot_token, account: data.ilink_bot_id, user: data.ilink_user_id, base: data.baseurl, cursor: '', contexts: {}})
  this.qr = ''
  return {state: 'verifying', qr: ''}
 }
 async verify(signal: AbortSignal, expectedAccount?: string) {
  if (!this.session || (expectedAccount && this.session.account !== expectedAccount)) throw new Error('微信Bot账号已改变或未确认')
  const result = await this.request('getconfig', 'POST', {ilink_user_id: this.session.user, base_info: this.baseInfo()}, {}, signal)
  if (result.ret !== 0) throw new Error('微信Bot未明确确认在线状态')
  return {account: this.session.account, session: {...this.session}, capabilities: {identity: 'weixin_ilink_bot', history: 'local_since_connection', messages: 'direct_new_events_only', send: 'explicit_confirmed_text'}}
 }
 async directory(signal: AbortSignal) {
  if (!this.session) throw new Error('微信Bot未登录')
  const pending = await this.receive('', this.session.account, signal)
  return {peers: [...new Set([...Object.keys(this.session.contexts), ...pending.peers])].map(peer => ({peer, name: peer})), coverage: '仅本次可取得的会话标识；不保存其他会话正文，不推进消息游标，不代表全部联系人'}
 }
 private baseInfo() {
  return {channel_version: '2.4.10', bot_agent: 'Meijiang'}
 }
 async receive(selected: string, account: string, signal: AbortSignal) {
  if (!this.session || this.session.account !== account) throw new Error('微信Bot消息账号不符')
  const value = z
   .object({
    get_updates_buf: z.string().max(1000000),
    msgs: z
     .array(
      z.object({
       from_user_id: z.string().max(200),
       to_user_id: z.string().max(200),
       message_id: z.union([z.string().max(200), z.number().int().finite().transform(String)]),
       context_token: z.string().max(8192).optional(),
       create_time_ms: z.number().finite().nonnegative(),
       item_list: z.array(z.object({type: z.number().optional(), text_item: z.object({text: z.string().max(50000)}).optional()})).max(100)
      })
     )
     .max(5000)
   })
   .parse(await this.request('getupdates', 'POST', {get_updates_buf: this.session.cursor, base_info: this.baseInfo()}, {}, signal))
  const contexts = {...this.session.contexts},
   messages = value.msgs.flatMap(item => {
    const peer = item.from_user_id === account ? item.to_user_id : item.from_user_id
    if (peer !== selected) return []
    if (item.context_token) contexts[peer] = item.context_token
    return [
     {
      mid: item.message_id,
      ts: item.create_time_ms / 1000,
      sender: item.from_user_id,
      text: item.item_list
       .map(part => part.text_item?.text || '[未读取的媒体消息]')
       .join('\n')
       .slice(0, 50000),
      kind: 'text'
     }
    ]
   })
  return {messages, peers: [...new Set(value.msgs.map(item => (item.from_user_id === account ? item.to_user_id : item.from_user_id)))], session: {...this.session, cursor: value.get_updates_buf || this.session.cursor, contexts}}
 }
 async send(peer: string, text: string, operationId: string, signal: AbortSignal) {
  if (!this.session?.contexts[peer]) throw new Error('请先同步所选联系人的入站消息再回复')
  const value = await this.request('sendmessage', 'POST', {msg: {from_user_id: '', to_user_id: peer, client_id: operationId, message_type: 2, message_state: 2, context_token: this.session.contexts[peer], item_list: [{type: 1, text_item: {text}}]}, base_info: this.baseInfo()}, {}, signal)
  if (value.errmsg !== undefined && !['', 'ok', 'success'].includes(String(value.errmsg))) throw new Error('微信Bot未明确确认发送')
  return value.message_id === undefined ? null : z.union([z.string().min(1).max(200), z.number().int().finite().transform(String)]).parse(value.message_id)
 }
}
