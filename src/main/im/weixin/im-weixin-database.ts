import CipherDatabase from 'better-sqlite3-multiple-ciphers'
import {createHash, randomUUID} from 'node:crypto'
import {statSync, lstatSync, realpathSync, readdirSync, openSync, readSync, closeSync} from 'node:fs'
import {basename, dirname, join, relative} from 'node:path'
import {zstdDecompressSync, constants as zlibConstants} from 'node:zlib'
import {z} from 'zod'
import {readWeixinIdentity, scanWeixinKeys} from '@main/im/weixin/im-weixin-crypto'
import type {WeixinMemory} from '@main/im/weixin/im-weixin-crypto'

type Row = Record<string, unknown>
export type BoundWeixinMemory = WeixinMemory & {
 budget: (ms: number) => void
 accountRoot: () => string
 loadModule: () => void
 close: () => void
}
const sequence = z
 .union([z.number().int().safe().transform(String), z.string().regex(/^-?\d{1,19}$/)])
 .transform(value => BigInt(value))
 .refine(value => value >= -(2n ** 63n) && value < 2n ** 63n)
const id = (path: string) => {
 const s = statSync(path, {bigint: true})
 return String(s.dev) + ':' + String(s.ino)
}
/** A real native SQLCipher-compatible transaction; never writes a decrypted database. */
export function weixinRead<T>(path: string, key: Buffer, read: (db: CipherDatabase.Database) => T, guard: () => void) {
 if (![32, 48].includes(key.length)) throw new Error('所选微信库缺少已核验密钥')
 guard()
 const db = new CipherDatabase(path, {readonly: true, fileMustExist: true, timeout: 100}),
  deadline = Date.now() + 5000
 let steps = 0
 try {
  db.pragma("cipher='sqlcipher'")
  db.pragma('legacy=4')
  if (key.length === 48) db.pragma('plaintext_header_size=16')
  const encoded = Buffer.from('raw:' + key.toString('hex'))
  try {
   db.key(encoded)
  } finally {
   encoded.fill(0)
  }
  db.pragma('query_only=ON')
  db.pragma('temp_store=MEMORY')
  db.pragma('cache_size=-4096')
  db.pragma('mmap_size=0')
  db.pragma('trusted_schema=OFF')
  db.defaultSafeIntegers(true)
  db.function('native_guard', () => {
   if (++steps > 2000000 || Date.now() > deadline) throw new Error('读取达到预算')
   guard()
   return 1
  })
  db.exec('BEGIN')
  const value = read(db)
  guard()
  if (Date.now() > deadline) throw new Error('读取达到预算')
  return value
 } catch {
  throw new Error('本次微信只读事务未完成，未保存消息或推进游标')
 } finally {
  try {
   if (db.inTransaction) db.exec('ROLLBACK')
  } finally {
   db.close()
  }
 }
}
export function weixinText(value: unknown, kind: number) {
 if (kind !== 1) return '[暂未读取此类消息内容]'
 if (typeof value === 'string') return value.slice(0, 6000)
 if (!(value instanceof Uint8Array) || value.length > 24000) return '[消息内容超出读取范围]'
 let bytes = Buffer.from(value)
 try {
  if (bytes.subarray(0, 4).equals(Buffer.from('28b52ffd', 'hex')))
   bytes = zstdDecompressSync(bytes, {maxOutputLength: 24000, params: {[zlibConstants.ZSTD_d_windowLogMax]: 20}})
  return new TextDecoder('utf-8', {fatal: true}).decode(bytes).trim().slice(0, 6000)
 } catch {
  return '[消息编码暂不支持或超出读取范围]'
 }
}
export class NativeWeixinReader {
 readonly readerId = randomUUID().replaceAll('-', '')
 readonly account: string
 private keys = new Map<string, Buffer>()
 private identities = new Map<string, string>()
 private base: string
 private baseId: string
 private root: string
 private deadline = 0
 constructor(private memory: BoundWeixinMemory) {
  try {
   memory.budget(30000)
   this.deadline = Date.now() + 30000
   this.root = memory.accountRoot()
   this.base = join(this.root, 'db_storage')
   this.baseId = id(this.base)
   memory.loadModule()
   this.account = readWeixinIdentity(memory)
   if (!this.account || this.account !== basename(this.root).replace(/_\w{4}$/, ''))
    throw new Error('微信进程身份与账号目录不一致')
   const files = this.files(),
    pages = new Map<string, Buffer>()
   for (const file of files) {
    this.identities.set(file, id(file))
    const handle = openSync(file, 'r')
    try {
     const page = Buffer.alloc(4096)
     if (readSync(handle, page, 0, 4096, 0) !== 4096) throw new Error('微信库文件不完整')
     pages.set(file, page)
    } finally {
     closeSync(handle)
    }
   }
   try {
    this.keys = scanWeixinKeys(memory, pages)
   } finally {
    for (const page of pages.values()) page.fill(0)
   }
   if (files.some(file => !this.keys.has(file))) throw new Error('部分微信消息库未取得已核验密钥，请重新核验')
   const found = this.query(files[0], db =>
    db.prepare('SELECT 1 FROM contact WHERE username=? AND native_guard() LIMIT 1').get(this.account)
   )
   if (!found) throw new Error('微信联系人库未确认当前身份')
   this.fence(true)
  } catch (error) {
   this.close()
   throw error
  }
 }
 private guard = () => {
  if (Date.now() > this.deadline) throw new Error('微信只读任务达到预算')
  this.memory.guard()
 }
 private path(file: string) {
  if (
   id(this.base) !== this.baseId ||
   realpathSync.native(this.base) !== this.base ||
   relative(this.base, file).startsWith('..') ||
   realpathSync.native(file) !== file
  )
   throw new Error('微信数据库路径已变化')
  for (let current = file; current !== this.root; current = dirname(current)) {
   const st = lstatSync(current)
   if (st.isSymbolicLink()) throw new Error('微信数据库不能经过链接路径')
   if (dirname(current) === current) throw new Error('微信数据库路径不属于账号')
  }
  if (this.identities.has(file) && this.identities.get(file) !== id(file))
   throw new Error('微信数据库已替换，请重新核验')
 }
 private files() {
  const contact = join(this.base, 'contact/contact.db'),
   shards = readdirSync(join(this.base, 'message'))
    .filter(file => /^message_\d+\.db$/.test(file))
    .sort()
    .map(file => join(this.base, 'message', file)),
   files = [contact, ...shards]
  if (shards.length > 64 || [...this.identities.keys()].some(file => !files.includes(file)))
   throw new Error('微信消息分片缺失或超出预算')
  for (const file of files) {
   this.path(file)
   if (!statSync(file).isFile()) throw new Error('微信数据库文件无效')
  }
  return files
 }
 private fence(strong = false) {
  this.guard()
  if (strong && this.memory.accountRoot() !== this.root) throw new Error('微信账号目录已改变')
  this.path(join(this.base, 'contact/contact.db'))
 }
 private query<T>(file: string, read: (db: CipherDatabase.Database) => T) {
  this.fence()
  this.path(file)
  const key = this.keys.get(file)
  if (!key) throw new Error('所选微信库缺少独立密钥')
  const result = weixinRead(file, key, read, this.guard)
  this.path(file)
  this.fence()
  return result
 }
 verify(account: string, readerId: string) {
  this.memory.budget(10000)
  this.deadline = Date.now() + 10000
  if (account !== this.account || readerId !== this.readerId) throw new Error('本机微信绑定已失效')
  this.fence(true)
 }
 directory() {
  this.verify(this.account, this.readerId)
  return this.query(this.files()[0], db => {
   const rows = db
    .prepare(
     'SELECT username,substr(nick_name,1,200) AS nick,substr(remark,1,200) AS remark FROM contact WHERE username<>? AND length(username)<=200 AND native_guard() ORDER BY username LIMIT 5001'
    )
    .all(this.account) as Row[]
   return {
    peers: rows
     .slice(0, 5000)
     .map(row => ({peer: String(row.username), name: String(row.remark || row.nick || row.username)})),
    coverage: rows.length > 5000 ? 'partial_page_limit' : 'local_contact_table'
   }
  })
 }
 receive(peer: string, saved: unknown) {
  const session = z
   .object({
    reader_id: z.literal(this.readerId),
    cursors: z.record(z.string(), z.record(z.string(), z.tuple([sequence, sequence]))).default({})
   })
   .parse(saved)
  z.string()
   .min(1)
   .max(200)
   .refine(value => value !== '_directory_')
   .parse(peer)
  this.verify(this.account, this.readerId)
  this.memory.budget(15000)
  this.deadline = Date.now() + 15000
  if (
   !this.query(this.files()[0], db =>
    db.prepare('SELECT 1 FROM contact WHERE username=? AND native_guard() LIMIT 1').get(peer)
   )
  )
   throw new Error('所选会话不在当前微信联系人库')
  const shards = this.files().slice(1),
   prior = session.cursors[peer] || {},
   updates = {...prior}
  if (Object.keys(prior).some(file => !shards.some(path => basename(path) === file)))
   throw new Error('微信已保存游标对应分片缺失')
  const table = 'Msg_' + createHash('md5').update(peer).digest('hex'),
   messages: {mid: string; sender: string; ts: number; text: string; kind: string; seq: bigint; local: bigint}[] = []
  let limited = false
  const take = Math.min(50, Math.max(2, Math.floor(200 / Math.max(1, shards.length))))
  for (const file of shards) {
   const name = basename(file),
    watermark = prior[name]
   const batch = this.query(file, db => {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=? AND native_guard() LIMIT 1").get(table))
     return []
    const fields =
     'CASE WHEN length(CAST(message_content AS BLOB))<=24000 THEN message_content END AS raw,local_type AS kind,real_sender_id AS sender,sort_seq AS seq,local_id AS local,CASE WHEN length(compress_content)<=24000 THEN compress_content END AS compressed,create_time AS created,CASE WHEN length(compress_content)>24000 THEN 1 ELSE 0 END AS oversized'
    const selected = db
     .prepare(
      `SELECT ${fields} FROM "${table}" WHERE native_guard() ${watermark ? 'AND (sort_seq>? OR (sort_seq=? AND local_id>?))' : ''} ORDER BY sort_seq ${watermark ? 'ASC' : 'DESC'},local_id ${watermark ? 'ASC' : 'DESC'} LIMIT ?`
     )
     .all(...(watermark ? [watermark[0], watermark[0], watermark[1]] : []), take + 1) as Row[]
    if (selected.length > take) limited = true
    const newer = selected.slice(0, watermark ? Math.max(1, Math.floor(take / 2)) : take)
    if (watermark && selected.length > newer.length) limited = true
    const overlap = watermark
     ? (db
        .prepare(
         `SELECT ${fields} FROM "${table}" WHERE native_guard() AND (sort_seq<? OR (sort_seq=? AND local_id<=?)) ORDER BY sort_seq DESC,local_id DESC LIMIT ?`
        )
        .all(watermark[0], watermark[0], watermark[1], take - newer.length) as Row[])
     : []
    return [...newer, ...overlap].map(row => {
     const seq = sequence.parse(typeof row.seq === 'bigint' ? String(row.seq) : row.seq),
      local = sequence.parse(typeof row.local === 'bigint' ? String(row.local) : row.local),
      sender = db
       .prepare('SELECT substr(user_name,1,200) AS name FROM Name2Id WHERE rowid=? AND native_guard() LIMIT 1')
       .get(row.sender) as Row | undefined
     return {
      seq,
      local,
      mid:
       'wx:' +
       createHash('sha256')
        .update(name + ':' + local)
        .digest('hex'),
      sender: String(sender?.name || ''),
      ts: z
       .number()
       .nonnegative()
       .finite()
       .parse(Number(row.created || 0)),
      text: Number(row.oversized) ? '[压缩消息超出读取范围]' : weixinText(row.compressed || row.raw, Number(row.kind)),
      kind: Number(row.kind) === 1 ? 'text' : 'unsupported_media'
     }
    })
   })
   for (const row of batch) {
    if (!updates[name] || row.seq > updates[name][0] || (row.seq === updates[name][0] && row.local > updates[name][1]))
     updates[name] = [row.seq, row.local]
    messages.push(row)
   }
   if (messages.length > 200 || messages.reduce((n, row) => n + row.text.length, 0) > 100000)
    throw new Error('本次微信消息超过读取预算')
  }
  const cursors = {...session.cursors, [peer]: updates}
  if (Object.keys(cursors).length > 100) throw new Error('微信所选会话达到上限')
  this.fence(true)
  const encodedCursors = Object.fromEntries(
   Object.entries(cursors).map(([peer, shards]) => [
    peer,
    Object.fromEntries(Object.entries(shards).map(([name, value]) => [name, value.map(String)]))
   ])
  )
  return {
   messages: messages.sort((a, b) => a.ts - b.ts || a.mid.localeCompare(b.mid)).map(({seq, local, ...row}) => row),
   session: {reader_id: this.readerId, cursors: encodedCursors},
   coverage: {
    state: limited ? 'bounded_window' : 'scanned_local_shards',
    shards: shards.length,
    initial_recent_window: !Object.keys(prior).length,
    older_history: 'not_complete'
   }
  }
 }
 close() {
  for (const key of this.keys.values()) key.fill(0)
  this.keys.clear()
  this.memory.close()
 }
}
