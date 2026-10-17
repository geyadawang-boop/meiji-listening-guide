import {z} from 'zod'
import {createHash} from 'node:crypto'
import {decodeHTML} from 'entities'

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>
const headers = {'User-Agent': 'Mozilla/5.0', Referer: 'https://www.bilibili.com/'}
const account = z.object({
 isLogin: z.boolean(),
 mid: z.number().int().nonnegative().optional(),
 uname: z.string().optional()
})
const folder = z.object({
 id: z.number().int().positive(),
 title: z.string(),
 media_count: z.number().int().nonnegative()
})
const media = z.object({
 bvid: z.string(),
 title: z.string(),
 duration: z.number().nonnegative().default(0),
 type: z.number(),
 id: z.number()
})

/** Native adaptation of BiliSum auth/favorites reads; no webpage server. */
export class BiliResources {
 private qr: {key: string; expires: number} | undefined
 private signingKey: {value: string; expires: number} | undefined
 constructor(private fetcher: Fetcher) {}
 private async read(path: string, params: Record<string, string> = {}, passport = false, signal?: AbortSignal) {
  const url = new URL(path, passport ? 'https://passport.bilibili.com' : 'https://api.bilibili.com')
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  const response = await this.fetcher(url.href, {
   headers,
   credentials: 'include',
   redirect: 'error',
   signal: signal || AbortSignal.timeout(20000)
  })
  if (!response.ok) throw new Error(`B 站服务暂不可用（HTTP ${response.status}）`)
  const result = z.object({code: z.number(), data: z.unknown().optional()}).parse(await response.json())
  if (path === '/x/web-interface/nav' && result.code === -101)
   return {...(typeof result.data === 'object' && result.data !== null ? result.data : {}), isLogin: false}
  if (result.code !== 0)
   throw new Error(result.code === -101 ? 'B 站登录已失效，请重新扫码' : `B 站读取失败（${result.code}），请稍后重试`)
  return result.data
 }
 async status() {
  const user = account.parse(await this.read('/x/web-interface/nav'))
  return {
   loggedIn: user.isLogin,
   name: user.isLogin ? user.uname || 'B站账号' : '',
   mid: user.isLogin ? user.mid : undefined
  }
 }
 async readMedia(
  path: '/x/web-interface/view' | '/x/player/wbi/playurl' | '/x/player/v2',
  params: Record<string, string>,
  signal: AbortSignal
 ) {
  return this.read(path, path === '/x/player/wbi/playurl' ? await this.sign(params, signal) : params, false, signal)
 }
 async readDiscussion(path: string, params: Record<string, string>, signal: AbortSignal, signed = false) {
  if (!['/x/web-interface/view', '/x/v2/reply', '/x/v2/reply/reply', '/x/v2/reply/wbi/main'].includes(path))
   throw new Error('讨论读取地址无效')
  return this.read(path, signed ? await this.sign(params, signal) : params, false, signal)
 }
 private async sign(params: Record<string, string>, signal?: AbortSignal) {
  if (!this.signingKey || this.signingKey.expires <= Date.now()) {
   const result = z
    .object({wbi_img: z.object({img_url: z.string().url(), sub_url: z.string().url()}).optional()})
    .parse(await this.read('/x/web-interface/nav', {}, false, signal))
   if (!result.wbi_img) return params
   const keys = [result.wbi_img.img_url, result.wbi_img.sub_url]
    .map(value => new URL(value).pathname.split('/').at(-1)?.split('.')[0] || '')
    .join('')
   if (!/^[a-f0-9]{64}$/i.test(keys)) throw new Error('B 站搜索签名无效，请稍后重试')
   const order = [
    46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38,
    41, 13
   ]
   this.signingKey = {value: order.map(index => keys[index]).join(''), expires: Date.now() + 3600000}
  }
  const signed = {
   ...Object.fromEntries(Object.entries(params).map(([key, value]) => [key, value.replace(/[!'()*]/g, '')])),
   wts: String(Math.floor(Date.now() / 1000))
  }
  const encoded = Object.entries(signed)
   .sort(([a], [b]) => a.localeCompare(b))
   .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value).replace(/%20/g, '+')}`)
   .join('&')
  return {
   ...signed,
   w_rid: createHash('md5')
    .update(encoded + this.signingKey.value)
    .digest('hex')
  }
 }
 async browse(kind: 'search' | 'popular', query: string, page: number) {
  if (
   !Number.isSafeInteger(page) ||
   page < 1 ||
   page > 100 ||
   query.length > 100 ||
   !['search', 'popular'].includes(kind)
  )
   throw new Error('视频检索参数无效')
  if (kind === 'search' && !query.trim()) throw new Error('请输入搜索关键词')
  const params = kind === 'search' ? await this.sign({keyword: query, search_type: 'video', page: String(page)}) : {}
  const data = await this.read(kind === 'search' ? '/x/web-interface/search/type' : '/x/web-interface/popular', params)
  const response = z
   .object({
    list: z.array(z.unknown()).optional(),
    result: z.array(z.unknown()).optional(),
    numPages: z.number().int().nonnegative().optional()
   })
   .parse(data)
  const raw = kind === 'popular' ? response.list : response.result
  if (!raw) throw new Error('B 站视频列表格式异常，请稍后重试')
  const itemSchema = z.object({
   bvid: z.string(),
   title: z.string(),
   author: z.string().optional(),
   owner: z.object({name: z.string()}).optional(),
   duration: z.union([z.number(), z.string()]).optional()
  })
  const videos = raw.slice(0, 50).flatMap(item => {
   const result = itemSchema.safeParse(item)
   if (!result.success || !/^BV[0-9A-Za-z]{10}$/.test(result.data.bvid)) return []
   const row = result.data
   return [
    {
     bvid: row.bvid,
     title: decodeHTML(row.title.replace(/<[^>]*>/g, '')).slice(0, 300),
     author: (row.author || row.owner?.name || '').slice(0, 100),
     duration: String(row.duration || ''),
     url: `https://www.bilibili.com/video/${row.bvid}/`
    }
   ]
  })
  return {videos, page, hasMore: kind !== 'popular' && page < Math.min(100, response.numPages || 1)}
 }
 async begin() {
  const qr = z
   .object({qrcode_key: z.string().min(1), url: z.string().url()})
   .parse(await this.read('/x/passport-login/web/qrcode/generate', {}, true))
  if (!['https://passport.bilibili.com', 'https://account.bilibili.com'].includes(new URL(qr.url).origin))
   throw new Error('扫码地址不是 B 站官方地址')
  this.qr = {key: qr.qrcode_key, expires: Date.now() + 180000}
  return qr.url
 }
 async poll() {
  if (!this.qr || Date.now() > this.qr.expires) {
   this.qr = undefined
   return {status: 'expired'}
  }
  const current = this.qr
  const result = z
   .object({code: z.number()})
   .parse(await this.read('/x/passport-login/web/qrcode/poll', {qrcode_key: current.key}, true))
  if (this.qr !== current) return {status: 'expired'}
  const status: Record<number, string> = {0: 'success', 86101: 'waiting', 86090: 'scanning', 86038: 'expired'}
  if (!status[result.code]) throw new Error('B 站扫码服务暂不可用，请重新生成二维码')
  if (result.code === 0 || result.code === 86038) this.qr = undefined
  return {status: status[result.code]}
 }
 cancelLogin() {
  this.qr = undefined
 }
 async folders() {
  const user = await this.status()
  if (!user.loggedIn || !user.mid) throw new Error('请先扫码登录 B 站')
  const result = z
   .object({list: z.array(folder).nullable().optional()})
   .parse(await this.read('/x/v3/fav/folder/created/list-all', {up_mid: String(user.mid)}))
  return result.list || []
 }
 async videos(id: number, page: number) {
  if (!Number.isSafeInteger(id) || id < 1 || !Number.isSafeInteger(page) || page < 1 || page > 1000)
   throw new Error('收藏夹分页无效')
  const owned = await this.folders()
  if (!owned.some(row => row.id === id)) throw new Error('收藏夹不属于当前账号，请刷新列表')
  const result = z
   .object({medias: z.array(media).nullable().optional(), has_more: z.boolean()})
   .parse(await this.read('/x/v3/fav/resource/list', {media_id: String(id), pn: String(page), ps: '20'}))
  const videos = (result.medias || []).map(row => ({
   ...row,
   available: row.type === 2 && /^BV[0-9A-Za-z]{10}$/.test(row.bvid) && row.title !== '已失效视频',
   url: row.type === 2 && /^BV[0-9A-Za-z]{10}$/.test(row.bvid) ? `https://www.bilibili.com/video/${row.bvid}/` : ''
  }))
  return {videos, hasMore: result.has_more, page}
 }
}
