import {createHash, randomBytes} from 'node:crypto'
import {CookieJar, Cookie} from 'tough-cookie'
import {SaxesParser} from 'saxes'
import {z} from 'zod'
import {boundedPublicText} from '@main/net/public-http'
import {weixinBootstrap} from '@main/im/weixin/im-weixin-html'

const hosts = ['wx.qq.com', 'wx2.qq.com', 'wx8.qq.com', 'web.wechat.com', 'web2.wechat.com']
const cookieHosts = [...hosts, 'qq.com', 'wechat.com', 'weixin.qq.com', 'login.wx.qq.com', 'login.weixin.qq.com']
const secret = z
 .string()
 .min(1)
 .max(8192)
 .refine(value => !/[\x00-\x1f\x7f]/.test(value))
const uin = z
 .union([z.string().regex(/^\d{1,20}$/), z.number().int().positive().max(Number.MAX_SAFE_INTEGER).transform(String)])
 .transform(value => BigInt(value))
 .refine(value => value > 0n && value < 2n ** 64n)
 .transform(String)
const keySchema = z
 .object({
  Count: z.number().int().min(1).max(100),
  List: z.array(z.object({Key: z.number().int().safe(), Val: z.number().int().safe()})).max(100)
 })
 .refine(value => value.Count === value.List.length)
const loginSchema = z.object({
 wxuin: uin,
 wxsid: secret,
 skey: z.string().max(8192),
 pass_ticket: z.string().max(8192).optional()
})
const sessionSchema = z.object({
 domain: z.enum(hosts as [string, ...string[]]),
 login: loginSchema,
 BaseRequest: z.object({
  Uin: z.number().int().positive().safe(),
  Sid: secret,
  Skey: z.string().max(8192),
  DeviceID: z.string().regex(/^e\d{15}$/)
 }),
 user: z.string().min(1).max(256).optional(),
 SyncKey: keySchema.optional(),
 cookies: z.array(z.record(z.string(), z.unknown())).max(200).default([])
})
type Session = z.infer<typeof sessionSchema>
const record = z.record(z.string(), z.unknown())
export function weixinRedirect(value: string) {
 const url = new URL(value)
 if (
  url.protocol !== 'https:' ||
  !hosts.includes(url.hostname) ||
  url.port ||
  url.username ||
  url.password ||
  url.hash ||
  url.pathname !== '/cgi-bin/mmwebwx-bin/webwxnewloginpage'
 )
  throw new Error('微信返回不支持的确认地址')
 const parts = url.search
  .slice(1)
  .split('&')
  .filter(Boolean)
  .filter(part => !['fun', 'version'].includes(decodeURIComponent(part.split('=')[0].replaceAll('+', ' '))))
 url.search = [...parts, 'fun=new', 'version=v2'].join('&')
 return url
}
function xmlLogin(xml: string) {
 if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('微信确认响应包含无效声明')
 const stack: string[] = [],
  fields: Record<string, string> = {}
 let invalid = false,
  root = ''
 const parser = new SaxesParser()
 parser.on('opentag', tag => {
  const name = tag.name
  if (Object.keys(tag.attributes).length) invalid = true
  if (!stack.length) {
   if (root) invalid = true
   root = name
  }
  stack.push(name)
  if (stack.length > 2) invalid = true
  else if (stack.length === 2) {
   if (fields[name] !== undefined) invalid = true
   fields[name] = ''
  }
 })
 const append = (text: string) => {
  if (stack.length === 2) fields[stack[1]] += text
  else if (text.trim()) invalid = true
 }
 parser.on('text', append)
 parser.on('cdata', append)
 parser.on('closetag', tag => {
  if (stack.pop() !== tag.name) invalid = true
 })
 parser.on('error', () => {
  invalid = true
 })
 parser.write(xml).close()
 if (invalid || stack.length || root !== 'error' || fields.ret !== '0') throw new Error('微信未确认有效登录')
 return loginSchema.extend({skey: secret, pass_ticket: secret}).parse(fields)
}
/** Direct fixed-host Web protocol. The caller must confirm the verified account before storing it. */
export class NativeWeixinWebSession {
 private jar = new CookieJar()
 private session: Session | undefined
 private uuid = ''
 private qr = ''
 constructor(
  saved?: unknown,
  private fetcher: typeof fetch = fetch
 ) {
  if (saved) {
   const raw = record.parse(saved)
   // Import the old session format without trusting or modifying the old database.
   const cookies = z
    .array(record)
    .max(200)
    .parse(raw.cookies || [])
   this.session = sessionSchema.parse({...raw, cookies: []})
   if (
    String(this.session.BaseRequest.Uin) !== this.session.login.wxuin ||
    this.session.BaseRequest.Sid !== this.session.login.wxsid ||
    this.session.BaseRequest.Skey !== this.session.login.skey
   )
    throw new Error('保存的微信身份不一致')
   for (const item of cookies) {
    const legacy = item.key === undefined
    if (legacy && item.port_specified) throw new Error('保存的微信 Cookie 端口范围无法兼容，请重新扫码')
    const domain = z.string().parse(item.domain).replace(/^\./, '').toLowerCase()
    if (!cookieHosts.includes(domain)) throw new Error('保存的微信 Cookie 域无效')
    const cookie = legacy
     ? new Cookie({
        key: z.string().parse(item.name),
        value: z.string().parse(item.value),
        domain,
        path: z.string().parse(item.path || '/'),
        secure: !!item.secure,
        hostOnly: item.domain_specified === false,
        expires: typeof item.expires === 'number' ? new Date(item.expires * 1000) : 'Infinity'
       })
     : Cookie.fromJSON(item)
    if (!cookie) throw new Error('保存的微信 Cookie 无效')
    this.jar.setCookieSync(cookie, 'https://' + domain + (cookie.path || '/'))
   }
  }
 }
 private export(session = this.session!) {
  return {...session, cookies: this.jar.serializeSync()?.cookies || []}
 }
 private async request(url: URL, signal: AbortSignal, body?: unknown) {
  if (
   url.protocol !== 'https:' ||
   url.port ||
   url.username ||
   url.password ||
   ![...hosts, 'login.wx.qq.com'].includes(url.hostname)
  )
   throw new Error('微信服务地址无效')
  signal.throwIfAborted()
  let response: Response
  try {
   response = await this.fetcher(url.href, {
    method: body === undefined ? 'GET' : 'POST',
    redirect: 'error',
    credentials: 'omit',
    headers: {
     'User-Agent':
      'Mozilla/5.0 (Linux; U; UOS x86_64; zh-cn) AppleWebKit/537.36 Chrome/91.0.4472.124 Safari/537.36 UOSBrowser/6.0.1.1001',
     Cookie: this.jar.getCookieStringSync(url.href),
     ...(body === undefined ? {} : {'Content-Type': 'application/json;charset=UTF-8'})
    },
    ...(body === undefined ? {} : {body: JSON.stringify(body)}),
    signal: AbortSignal.any([signal, AbortSignal.timeout(15000)])
   })
  } catch {
   signal.throwIfAborted()
   throw new Error('微信服务暂时无法连接')
  }
  if (response.status !== 200) {
   await response.body?.cancel()
   throw new Error('微信服务未成功响应')
  }
  const text = await boundedPublicText(response, 4 * 1024 * 1024)
  signal.throwIfAborted()
  try {
   const cookies = response.headers.getSetCookie()
   if (cookies.length > 200 || cookies.some(value => value.length > 16384)) throw new Error()
   for (const cookie of cookies) this.jar.setCookieSync(cookie, url.href)
   if ((this.jar.serializeSync()?.cookies.length || 0) > 200) throw new Error()
  } catch {
   throw new Error('微信服务返回无效或过多 Cookie')
  }
  return text
 }
 private url(path: string, query: Record<string, string> = {}) {
  if (!this.session) throw new Error('微信尚未取得会话')
  const url = new URL('https://' + this.session.domain + '/cgi-bin/mmwebwx-bin/' + path)
  url.search = new URLSearchParams(query).toString()
  return url
 }
 private async json(path: string, signal: AbortSignal, body?: unknown, query: Record<string, string> = {}) {
  const data = record.parse(JSON.parse(await this.request(this.url(path, query), signal, body)))
  if (!z.object({Ret: z.literal(0)}).safeParse(data.BaseResponse).success) throw new Error('微信会话失效或操作未确认')
  return data
 }
 async start(signal: AbortSignal) {
  const url = new URL('https://login.wx.qq.com/jslogin')
  url.search = new URLSearchParams({
   appid: 'wx782c26e4c19acffb',
   fun: 'new',
   lang: 'zh_CN',
   _: String(Date.now()),
   redirect_uri: 'https://wx.qq.com/cgi-bin/mmwebwx-bin/webwxnewloginpage'
  }).toString()
  const text = await this.request(url, signal),
   codes = [...text.matchAll(/window\.QRLogin\.code\s*=\s*(\d+)\s*;/g)],
   uuids = [...text.matchAll(/window\.QRLogin\.uuid\s*=\s*"([A-Za-z0-9_-]{1,128}={0,2})"\s*;/g)]
  if (codes.length !== 1 || codes[0][1] !== '200' || uuids.length !== 1) throw new Error('微信 Web 未提供有效二维码')
  this.uuid = uuids[0][1]
  this.qr = 'https://login.weixin.qq.com/l/' + this.uuid
  return {state: 'waiting_scan', qr: this.qr}
 }
 async poll(signal: AbortSignal) {
  if (!this.uuid) throw new Error('请先开始微信扫码')
  const url = new URL('https://login.wx.qq.com/cgi-bin/mmwebwx-bin/login')
  url.search = new URLSearchParams({
   uuid: this.uuid,
   tip: '0',
   loginicon: 'true',
   _: String(Math.floor(Date.now() / 1000)),
   r: String(Math.floor(Date.now() / 1000 / 1579))
  }).toString()
  const text = await this.request(url, signal),
   codes = [...text.matchAll(/window\.code\s*=\s*(\d+)\s*;/g)]
  if (codes.length !== 1) throw new Error('微信登录状态无效')
  if (codes[0][1] === '408') return {state: 'waiting_scan', qr: this.qr}
  if (codes[0][1] === '201') return {state: 'waiting_confirm', qr: this.qr}
  if (codes[0][1] === '400') return {state: 'expired', qr: ''}
  if (codes[0][1] !== '200') throw new Error('微信未批准本次扫码')
  const redirects = [...text.matchAll(/window\.redirect_uri\s*=\s*"([^"<>]{1,4096})"\s*;/g)]
  if (redirects.length !== 1) throw new Error('微信确认地址无效')
  const target = weixinRedirect(redirects[0][1]),
   raw = await this.request(target, signal)
  let login: z.infer<typeof loginSchema>
  if (/^\s*(?:\ufeff)?\s*(?:<!doctype\s+html|<html)/i.test(raw)) {
   if (!weixinBootstrap(raw)) throw new Error('微信返回的网页尚不能建立已验证会话')
   const applicable = this.jar.getCookiesSync('https://' + target.hostname + '/cgi-bin/mmwebwx-bin/webwxinit'),
    values = (name: string) => applicable.filter(cookie => cookie.key === name)
   if (values('wxuin').length !== 1 || values('wxsid').length !== 1) throw new Error('微信网页会话 Cookie 缺失或有歧义')
   login = loginSchema.parse({wxuin: values('wxuin')[0].value, wxsid: values('wxsid')[0].value, skey: ''})
  } else login = xmlLogin(raw)
  const numeric = Number(login.wxuin)
  if (!Number.isSafeInteger(numeric)) throw new Error('当前微信账号编号无法无损编码，请使用微信 Bot 连接')
  this.session = sessionSchema.parse({
   domain: target.hostname,
   login,
   BaseRequest: {
    Uin: numeric,
    Sid: login.wxsid,
    Skey: login.skey,
    DeviceID: 'e' + [...randomBytes(15)].map(value => value % 10).join('')
   }
  })
  this.qr = ''
  return {state: 'verifying', qr: ''}
 }
 async verify(signal: AbortSignal, expectedAccount?: string) {
  if (!this.session || (expectedAccount && this.session.login.wxuin !== expectedAccount))
   throw new Error('微信账号归属不符')
  const data = await this.json(
    'webwxinit',
    signal,
    {BaseRequest: this.session.BaseRequest},
    {_: String(Math.floor(Date.now() / 1000))}
   ),
   user = z.object({UserName: z.string().min(1).max(256), Uin: z.unknown().optional()}).parse(data.User)
  if (
   user.Uin !== undefined &&
   user.Uin !== null &&
   user.Uin !== '' &&
   user.Uin !== 0 &&
   uin.parse(user.Uin) !== this.session.login.wxuin
  )
   throw new Error('微信初始化账号与扫码账号不一致')
  if (this.session.user && this.session.user !== user.UserName) throw new Error('微信会话身份已改变')
  const skey = secret.parse(data.SKey ?? this.session.login.skey),
   key = keySchema.parse(data.SyncKey)
  // Rechecking identity must not move a previously committed receive cursor.
  this.session = {
   ...this.session,
   user: user.UserName,
   login: {...this.session.login, skey},
   BaseRequest: {...this.session.BaseRequest, Skey: skey},
   SyncKey: this.session.SyncKey || key
  }
  return {
   account: this.session.login.wxuin,
   session: this.export(),
   capabilities: {
    identity: 'personal_weixin_web_experimental',
    history: 'local_since_connection',
    messages: 'new_events_only',
    send: 'explicit_confirmed_text'
   }
  }
 }
 async directory(signal: AbortSignal) {
  const peers = new Map<string, {peer: string; name: string}>(),
   seen = new Set<number>()
  let seq = 0,
   complete = false
  for (let page = 0; page < 20; page++) {
   const data = await this.json('webwxgetcontact', signal, undefined, {
     r: String(Date.now()),
     skey: this.session!.login.skey,
     seq: String(seq)
    }),
    members = z.array(record).max(10000).parse(data.MemberList),
    next = z.number().int().nonnegative().safe().parse(data.Seq)
   for (const item of members) {
    const peer = z.string().min(1).max(256).parse(item.UserName)
    peers.set(peer, {peer, name: String(item.RemarkName || item.DisplayName || item.NickName || peer).slice(0, 200)})
    if (peers.size > 10000) throw new Error('微信联系人超出本次读取上限')
   }
   if (next === 0) {
    complete = true
    break
   }
   if (next === seq || seen.has(next)) throw new Error('微信联系人分页未前进')
   seen.add(seq)
   seq = next
  }
  return {peers: [...peers.values()], coverage: complete ? 'complete_current_directory' : 'partial_page_limit'}
 }
 async receive(selected: string, account: string, signal: AbortSignal) {
  if (!this.session?.user || !this.session.SyncKey || this.session.login.wxuin !== account)
   throw new Error('微信所选会话尚未核验')
  const data = await this.json(
    'webwxsync',
    signal,
    {BaseRequest: this.session.BaseRequest, SyncKey: this.session.SyncKey, rr: String(Math.floor(Date.now() / 1000))},
    {
     sid: this.session.login.wxsid,
     skey: this.session.login.skey,
     ...(this.session.login.pass_ticket ? {pass_ticket: this.session.login.pass_ticket} : {})
    }
   ),
   key = keySchema.parse(data.SyncKey)
  const messages = z
   .array(record)
   .max(5000)
   .parse(data.AddMsgList)
   .flatMap(item => {
    const sender = z.string().max(256).parse(item.FromUserName),
     to = z.string().max(256).parse(item.ToUserName)
    if (sender !== this.session!.user && to !== this.session!.user) return []
    const peer = sender === this.session!.user ? to : sender
    if (peer !== selected) return []
    return [
     {
      mid: z
       .union([z.string().min(1).max(200), z.number().int().safe().transform(String)])
       .parse(item.MsgId ?? item.NewMsgId),
      sender,
      ts: z.number().nonnegative().finite().parse(item.CreateTime),
      kind: item.MsgType === 1 ? 'text' : 'unsupported_media',
      text: item.MsgType === 1 ? z.string().max(50000).parse(item.Content) : '[未读取的图片、语音或其他消息]'
     }
    ]
   })
  return {messages, session: this.export({...this.session, SyncKey: key})}
 }
 async send(peer: string, text: string, operationId: string, signal: AbortSignal) {
  if (!this.session?.user) throw new Error('微信尚未核验身份')
  const id = String(
    BigInt('0x' + createHash('sha256').update(operationId).digest('hex').slice(0, 16)) & ((1n << 63n) - 1n)
   ),
   data = await this.json(
    'webwxsendmsg',
    signal,
    {
     BaseRequest: this.session.BaseRequest,
     Msg: {
      Type: 1,
      Content: text,
      FromUserName: this.session.user,
      ToUserName: z.string().min(1).max(256).parse(peer),
      LocalID: id,
      ClientMsgId: id
     },
     Scene: 0
    },
    {lang: 'zh_CN', ...(this.session.login.pass_ticket ? {pass_ticket: this.session.login.pass_ticket} : {})}
   )
  return data.MsgID === undefined
   ? null
   : z.union([z.string().min(1).max(200), z.number().int().safe().transform(String)]).parse(data.MsgID)
 }
}
