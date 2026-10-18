import {crc32} from 'node:zlib'
import {SaxesParser} from 'saxes'
import {z} from 'zod'
import {BiliResources} from '@main/media/bilibili/bili-resources'
import {bilibiliUrl} from '@main/media/bilibili/video-policy'
import {
 classifyDiscussion,
 discussionDigest,
 discussionPolicy,
 DiscussionStore,
 type Coverage,
 type DiscussionItem,
 type DiscussionPack
} from '@main/media/bilibili/discussion-evidence'

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>
type Raw = Record<string, unknown>
const object = (value: unknown): Raw =>
 value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Raw) : {}
const array = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
const number = (value: unknown, fallback = 0) =>
 Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : fallback
const identity = (value: unknown) =>
 typeof value === 'string' && /^\d+$/.test(value)
  ? value
  : typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? String(value)
    : ''
type Comment = {
 rpid: string
 root_id: string
 parent_id: string
 user: string
 content: string
 likes: number
 created_at: number
 is_uploader: boolean
 replies: Comment[]
 pinned: boolean
 reply_count: number
 replies_complete: boolean
}
function commentRecord(value: unknown, owner: number, root = '', pinned = false): Comment | undefined {
 const raw = object(value),
  member = object(raw.member),
  content = object(raw.content)
 const rpid = identity(raw.rpid_str) || identity(raw.rpid)
 if (!rpid) return
 const rootId = identity(raw.root) || root
 if (root && rootId && rootId !== root) return
 const replies: Comment[] = [],
  seen = new Set<string>()
 if (!root)
  for (const child of array(raw.replies).slice(0, 40)) {
   const entry = commentRecord(child, owner, rpid)
   if (entry && !seen.has(entry.rpid)) {
    seen.add(entry.rpid)
    replies.push(entry)
   }
  }
 const count = number(raw.rcount ?? raw.count, replies.length)
 return {
  rpid,
  root_id: root || rootId,
  parent_id: identity(raw.parent) || root,
  user: String(member.uname || '匿名').slice(0, 100),
  content: String(content.message || '').slice(0, 12000),
  likes: number(raw.like),
  created_at: number(raw.ctime),
  is_uploader: !!owner && identity(member.mid) === String(owner),
  replies,
  pinned,
  reply_count: Math.max(count, replies.length),
  replies_complete: ('rcount' in raw || 'count' in raw) && count <= replies.length
 }
}
function failureCode(error: unknown): string {
 if (error instanceof Error) {
  const http = /HTTP (\d+)/.exec(error.message)
  if (http) return 'http_' + http[1]
  const api = /（(-?\d+)）/.exec(error.message)
  if (api) return 'api_' + api[1]
  if (error.name === 'TimeoutError' || error.name === 'AbortError') return 'timeout'
  if (error instanceof z.ZodError) return 'invalid_response'
 }
 return 'network_or_protocol'
}
function* fields(bytes: Uint8Array): Generator<[number, bigint | Uint8Array]> {
 let position = 0
 const read = () => {
  let value = 0n
  for (let shift = 0; shift < 70; shift += 7) {
   if (position >= bytes.length) throw new Error('truncated_protobuf')
   const part = bytes[position++]
   value |= BigInt(part & 127) << BigInt(shift)
   if (!(part & 128)) {
    if (value > 0xffffffffffffffffn) throw new Error('oversized_varint')
    return value
   }
  }
  throw new Error('oversized_varint')
 }
 while (position < bytes.length) {
  const tag = read(),
   field = Number(tag >> 3n),
   wire = Number(tag & 7n)
  if (!field || field > 536870911) throw new Error('invalid_protobuf')
  if (wire === 0) {
   yield [field, read()]
   continue
  }
  const size = wire === 2 ? Number(read()) : wire === 1 ? 8 : wire === 5 ? 4 : NaN
  if (!Number.isSafeInteger(size) || size < 0) throw new Error('unsupported_protobuf_wire')
  if (size > bytes.length - position) throw new Error('truncated_protobuf')
  yield [field, bytes.subarray(position, position + size)]
  position += size
 }
}
export type Danmaku = {id: string; text: string; time_sec: number; created_at: number; is_uploader: boolean}
export function parseDanmaku(bytes: Uint8Array, owner = 0): {rows: Danmaku[]; closed: boolean} {
 if (bytes.length > 12 * 1024 * 1024) throw new Error('danmaku_too_large')
 const rows: Danmaku[] = [],
  ownerHash = owner
   ? crc32(Buffer.from(String(owner)))
      .toString(16)
      .replace(/^0+/, '')
   : ''
 let closed = false
 const add = (id: string, text: string, seconds: number, mid = '', created = 0, mode = 1) => {
  if ([8, 9].includes(mode) || !text || !Number.isFinite(seconds) || seconds < 0) return
  rows.push({
   id,
   text: text.slice(0, 4000),
   time_sec: seconds,
   created_at: created,
   is_uploader: !!ownerHash && mid.replace(/^0+/, '') === ownerHash
  })
 }
 const initial = Buffer.from(bytes.subarray(0, 200)).toString('utf8').trimStart()
 if (initial.startsWith('<')) {
  const parser = new SaxesParser({xmlns: false})
  let depth = 0,
   p: string[] | undefined,
   text = ''
  parser.on('doctype', () => {
   throw new Error('invalid_xml')
  })
  parser.on('opentag', tag => {
   depth++
   if (depth === 1 && tag.name !== 'i') throw new Error('invalid_xml')
   if (depth === 2 && tag.name === 'd') {
    p = String(tag.attributes.p || '').split(',')
    text = ''
   }
  })
  parser.on('text', value => {
   if (p) text += value
  })
  parser.on('cdata', value => {
   if (p) text += value
  })
  parser.on('closetag', tag => {
   if (depth === 2 && tag.name === 'd' && p) {
    if (p.length >= 8) add(p[7], text, Number(p[0]), p[6], number(p[4]), number(p[1], 1))
    p = undefined
   }
   depth--
  })
  parser.write(Buffer.from(bytes).toString('utf8')).close()
 } else {
  if (/^[\[{]/.test(initial)) throw new Error('json_error_not_danmaku')
  for (const [field, value] of fields(bytes)) {
   if (field === 2 && typeof value === 'bigint') closed = value === 1n
   if (field !== 1 || typeof value === 'bigint') continue
   const item = new Map(fields(value))
   const string = (key: number) => {
    const value = item.get(key)
    return value instanceof Uint8Array ? Buffer.from(value).toString('utf8') : ''
   }
   const integer = (key: number, fallback = 0) => {
    const value = item.get(key)
    return typeof value === 'bigint' && value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : fallback
   }
   add(string(12) || String(item.get(1) ?? ''), string(7), integer(2) / 1000, string(6), integer(8), integer(3, 1))
  }
 }
 return {rows, closed}
}
async function boundedMap<T>(rows: T[], concurrency: number, run: (row: T) => Promise<void>) {
 let position = 0
 await Promise.all(
  Array.from({length: Math.min(concurrency, rows.length)}, async () => {
   while (position < rows.length) await run(rows[position++])
  })
 )
}
export class BiliDiscussion {
 private store: Pick<DiscussionStore, 'save' | 'select'>
 constructor(
  private resources: BiliResources,
  private fetcher: Fetcher,
  root: string,
  store?: Pick<DiscussionStore, 'save' | 'select'>
 ) {
  this.store = store || new DiscussionStore(root)
 }
 select(ref: string, changes: unknown) {
  return this.store.select(ref, changes)
 }
 private async json(path: string, params: Record<string, string>, signal: AbortSignal, signed = false): Promise<Raw> {
  const value = await this.resources.readDiscussion(
   path,
   params,
   AbortSignal.any([signal, AbortSignal.timeout(7000)]),
   signed
  )
  return z.record(z.string(), z.unknown()).parse(value)
 }
 private async comments(aid: number, owner: number, pages: number) {
  const rows: Comment[] = [],
   seen = new Set<string>()
  const coverage: Coverage = {
   status: 'partial',
   complete: false,
   errors: [],
   root_pages: 0,
   child_pages: 0,
   root_end: false,
   sort: 'hot_and_recent'
  }
  const signal = AbortSignal.timeout(22000)
  for (const [sort, budget] of [
   [2, pages],
   [0, 1]
  ]) {
   for (let page = 1; page <= budget; page++) {
    let data: Raw
    try {
     data = await this.json(
      '/x/v2/reply',
      {type: '1', oid: String(aid), sort: String(sort), pn: String(page), ps: '20'},
      signal
     )
    } catch (error) {
     const code = failureCode(error)
     coverage.errors.push({stage: 'roots', sort, code})
     if (page !== 1 || sort !== 2 || !['http_404', 'api_-400', 'invalid_response'].includes(code)) break
     try {
      data = await this.json(
       '/x/v2/reply/wbi/main',
       {type: '1', oid: String(aid), mode: '3', pagination_str: '{"offset":""}', web_location: '1315875'},
       signal,
       true
      )
      coverage.fallback_first_page_only = true
     } catch (fallback) {
      coverage.errors.push({stage: 'roots_fallback', code: failureCode(fallback)})
      break
     }
    }
    coverage.root_pages = number(coverage.root_pages) + 1
    const candidates: [unknown, boolean][] = [
     ...array(data.replies).map(value => [value, false] as [unknown, boolean]),
     ...array(data.top_replies).map(value => [value, true] as [unknown, boolean]),
     ...Object.values(object(data.top))
      .filter(value => identity(object(value).rpid))
      .map(value => [value, true] as [unknown, boolean])
    ]
    for (const [raw, pinned] of candidates) {
     const row = commentRecord(raw, owner, '', pinned)
     if (row && !seen.has(row.rpid)) {
      seen.add(row.rpid)
      rows.push(row)
     } else if (row && pinned) rows.find(value => value.rpid === row.rpid)!.pinned = true
    }
    const pagination = object(data.page),
     cursor = object(data.cursor)
    const ended =
     cursor.is_end === true || ('count' in pagination && page * number(pagination.size, 20) >= number(pagination.count))
    if (sort === 2) coverage.root_end = ended
    if (ended || !candidates.length || coverage.fallback_first_page_only) break
   }
  }
  const rank = (comment: Comment) =>
   Math.max(
    classifyDiscussion(comment.content).score,
    ...comment.replies.map(reply => classifyDiscussion(reply.content).score)
   ) +
   2 * Number(comment.is_uploader) +
   Number(comment.pinned)
  const targets = rows
   .filter(row => !row.replies_complete && row.reply_count > row.replies.length)
   .sort((a, b) => rank(b) - rank(a) || b.likes - a.likes)
   .slice(0, 6)
  await boundedMap(targets, 2, async parent => {
   const seen = new Set(parent.replies.map(row => row.rpid))
   for (let page = 1; page <= 2; page++) {
    let data: Raw
    try {
     data = await this.json(
      '/x/v2/reply/reply',
      {type: '1', oid: String(aid), root: parent.rpid, pn: String(page), ps: '20'},
      signal
     )
    } catch (error) {
     coverage.errors.push({stage: 'children', root: parent.rpid, code: failureCode(error)})
     break
    }
    coverage.child_pages = number(coverage.child_pages) + 1
    let added = 0
    for (const raw of array(data.replies)) {
     const child = commentRecord(raw, owner, parent.rpid)
     if (child && !seen.has(child.rpid)) {
      seen.add(child.rpid)
      parent.replies.push(child)
      added++
     }
    }
    const pagination = object(data.page)
    if ('count' in pagination) parent.reply_count = number(pagination.count)
    parent.replies_complete = parent.replies.length >= parent.reply_count
    if (parent.replies_complete || !added) break
   }
  })
  if (signal.aborted) coverage.errors.push({stage: 'collection', code: 'deadline'})
  coverage.root_count = rows.length
  coverage.reply_count = rows.reduce((sum, row) => sum + row.replies.length, 0)
  coverage.partial_threads = rows.filter(row => !row.replies_complete).length
  coverage.complete = !!coverage.root_end && !coverage.errors.length && !coverage.partial_threads
  coverage.status = coverage.complete
   ? 'complete'
   : rows.length
     ? 'partial'
     : coverage.errors.length
       ? 'failed'
       : 'empty'
  return {rows, coverage}
 }
 private async raw(path: string, params: Record<string, string>, signal: AbortSignal) {
  const url = new URL(path, 'https://api.bilibili.com')
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  const response = await this.fetcher(url.href, {
   headers: {'User-Agent': 'Mozilla/5.0', Referer: 'https://www.bilibili.com/'},
   credentials: 'include',
   redirect: 'error',
   signal: AbortSignal.any([signal, AbortSignal.timeout(6000)])
  })
  if (!response.ok) throw new Error('HTTP ' + response.status)
  if (Number(response.headers.get('content-length')) > 12 * 1024 * 1024) throw new Error('danmaku_too_large')
  const reader = response.body?.getReader()
  if (!reader) throw new Error('empty_response')
  const chunks: Buffer[] = []
  let size = 0
  try {
   while (true) {
    const {value, done} = await reader.read()
    if (done) break
    size += value.length
    if (size > 12 * 1024 * 1024) throw new Error('danmaku_too_large')
    chunks.push(Buffer.from(value))
   }
   return Buffer.concat(chunks)
  } catch (error) {
   await reader.cancel().catch(() => undefined)
   throw error
  } finally {
   reader.releaseLock()
  }
 }
 private async danmaku(cid: number, duration: number, owner: number) {
  const total = Math.max(1, Math.ceil(duration / 360)),
   cap = 12
  const segments =
   total > cap
    ? [...new Set(Array.from({length: cap}, (_, index) => 1 + Math.round((index * (total - 1)) / (cap - 1))))]
    : Array.from({length: total}, (_, index) => index + 1)
  const ok: number[] = [],
   rows: Danmaku[] = [],
   coverage: Coverage = {
    status: 'partial',
    complete: false,
    errors: [],
    segments_total: total,
    segments_requested: segments,
    segments_ok: ok,
    scope: 'current_pool_not_all_historical'
   }
  const signal = AbortSignal.timeout(20000)
  await boundedMap(segments, 3, async segment => {
   try {
    const parsed = parseDanmaku(
     await this.raw('/x/v2/dm/web/seg.so', {type: '1', oid: String(cid), segment_index: String(segment)}, signal),
     owner
    )
    if (parsed.closed) coverage.closed = true
    rows.push(...parsed.rows)
    ok.push(segment)
   } catch (error) {
    coverage.errors.push({segment, code: failureCode(error)})
   }
  })
  if (signal.aborted) coverage.errors.push({code: 'deadline'})
  if (!ok.length) {
   try {
    rows.push(
     ...parseDanmaku(await this.raw('/x/v1/dm/list.so', {oid: String(cid)}, AbortSignal.timeout(5000)), owner).rows
    )
    coverage.fallback = 'xml_pool'
   } catch {
    coverage.errors.push({code: 'xml_unavailable'})
   }
  }
  const unique = [...new Map(rows.map(row => [row.id || canonicalJsonKey(row), row])).values()]
  unique.sort(
   (a, b) =>
    classifyDiscussion(b.text).score - classifyDiscussion(a.text).score ||
    Number(b.is_uploader) - Number(a.is_uploader) ||
    a.time_sec - b.time_sec
  )
  ok.sort((a, b) => a - b)
  coverage.raw_count = unique.length
  coverage.retained_count = Math.min(unique.length, 800)
  coverage.retention_limited = unique.length > 800
  coverage.complete = ok.length === total && !coverage.errors.length && !coverage.retention_limited
  coverage.status = coverage.closed
   ? 'closed'
   : coverage.complete
     ? 'complete'
     : unique.length
       ? 'partial'
       : coverage.errors.length
         ? 'failed'
         : 'empty'
  return {rows: unique.slice(0, 800), coverage}
 }
 async collect(input: string, pages: number) {
  z.number().int().min(1).max(10).parse(pages)
  const url = new URL(bilibiliUrl(input)),
   id = url.pathname.split('/')[2],
   page = Number(url.searchParams.get('p') || 1)
  const info = z
   .object({
    bvid: z.string().regex(/^BV[0-9A-Za-z]{10}$/),
    aid: z.number().int().positive(),
    desc: z.string().default(''),
    owner: z.object({mid: z.number().int().nonnegative()}),
    pages: z.array(
     z.object({page: z.number().int().positive(), cid: z.number().int().positive(), duration: z.number().nonnegative()})
    )
   })
   .parse(
    await this.json(
     '/x/web-interface/view',
     id.startsWith('av') ? {aid: id.slice(2)} : {bvid: id},
     AbortSignal.timeout(20000)
    )
   )
  if (id.startsWith('BV') && info.bvid !== id) throw new Error('视频来源与所选网址不一致')
  const selected = info.pages.find(row => row.page === page)
  if (!selected) throw new Error('所选分集不存在')
  const [comments, danmaku] = await Promise.all([
   this.comments(info.aid, info.owner.mid, pages),
   this.danmaku(selected.cid, selected.duration, info.owner.mid)
  ])
  const items: DiscussionItem[] = [],
   base = 'https://www.bilibili.com/video/' + info.bvid
  const add = (kind: DiscussionItem['kind'], text: string, identity: string, meta: Partial<DiscussionItem> = {}) => {
   text = text.trim().slice(0, 12000)
   if (!text) return
   const {labels, score} = classifyDiscussion(text)
   items.push({
    id: kind + ':' + (identity || discussionDigest([info.bvid, selected.cid, text]).slice(0, 20)),
    kind,
    text,
    text_sha256: discussionDigest(text),
    labels,
    score:
     Math.round(
      (score +
       2 * Number(!!meta.is_uploader) +
       Number(!!meta.pinned) +
       Math.min(1, Math.log10(Math.max(1, meta.likes || 0)))) *
       100
     ) / 100,
    selected: false,
    verification: 'unverified',
    reviewed: false,
    note: '',
    url: base,
    ...meta
   })
  }
  add('description', info.desc, info.bvid, {is_uploader: true})
  const seen = new Set<string>()
  for (const comment of comments.rows) {
   if (seen.has(comment.rpid)) continue
   seen.add(comment.rpid)
   const meta = (row: Comment) => ({
    author: row.user,
    likes: row.likes,
    rpid: row.rpid,
    is_uploader: row.is_uploader,
    created_at: row.created_at,
    url: base + '#reply' + row.rpid
   })
   add('comment', comment.content, comment.rpid, {
    ...meta(comment),
    root_id: '',
    parent_id: '',
    pinned: comment.pinned,
    reply_count: comment.reply_count,
    replies_complete: comment.replies_complete
   })
   for (const reply of comment.replies) {
    if (seen.has(reply.rpid)) continue
    seen.add(reply.rpid)
    add('reply', reply.content, reply.rpid, {
     ...meta(reply),
     root_id: 'comment:' + comment.rpid,
     parent_id:
      reply.parent_id && reply.parent_id !== comment.rpid ? 'reply:' + reply.parent_id : 'comment:' + comment.rpid
    })
   }
  }
  for (const row of danmaku.rows)
   add('danmaku', row.text, row.id, {
    time_sec: row.time_sec,
    created_at: row.created_at,
    is_uploader: row.is_uploader,
    cid: selected.cid,
    page,
    url: `${base}?p=${page}&t=${Math.floor(row.time_sec)}`
   })
  return this.store.save({
   schema: 'video-discussion-v1',
   bvid: info.bvid,
   cid: selected.cid,
   page,
   fetched_at: Math.floor(Date.now() / 1000),
   classification_method: 'heuristic_candidates_v1',
   policy: discussionPolicy,
   coverage: {comments: comments.coverage, danmaku: danmaku.coverage, items_truncated: items.length > 1200},
   items: items.slice(0, 1200)
  })
 }
}
function canonicalJsonKey(row: Danmaku) {
 return JSON.stringify([row.time_sec, row.text])
}
