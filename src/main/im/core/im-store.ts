import Database from 'better-sqlite3'
import {createHash, randomUUID} from 'node:crypto'
import {mkdirSync, lstatSync, existsSync, realpathSync} from 'node:fs'
import {join, resolve} from 'node:path'
import {z} from 'zod'
import {windowsProtect} from '@main/security/windows-native'
import type {MediaCrypt} from '@main/security/worker-crypt'
import {imLoopback} from '@main/im/core/im-loopback'
export const imId = z.string().regex(/^[a-f0-9]{32}$/)
const platforms = ['qq_napcat', 'weixin_local', 'weixin_web', 'weixin_ilink'] as const
export const imScope = z.object({
 connection_id: imId,
 revision: imId,
 platform: z.enum(platforms),
 account: z.string().min(1).max(200),
 login_epoch: imId,
 peer: z.string().min(1).max(200)
})
export type NativeImScope = z.infer<typeof imScope>
type StoredConnection = {
 id: string
 name: string
 platform: (typeof platforms)[number]
 revision: string
 public: string
 sealed: Buffer
 account: string
 login_epoch: string
 session: Buffer | null
 checked_at: number | null
 capabilities: string
}
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex'),
 id = () => randomUUID().replaceAll('-', '')
export type NativeImConnection = ReturnType<NativeImStore['capture']>
/** Uses the existing app-owned database and DPAPI format. Merely listing connections never decrypts sessions. */
export class NativeImStore {
 readonly db: Database.Database
 constructor(
  root: string,
  private crypt: MediaCrypt = windowsProtect
 ) {
  mkdirSync(root, {recursive: true})
  if (lstatSync(root).isSymbolicLink() || realpathSync(root).toLowerCase() !== resolve(root).toLowerCase())
   throw new Error('通讯资料根目录无效')
  const path = join(root, 'im-connections.sqlite3')
  if (existsSync(path) && (lstatSync(path).isSymbolicLink() || !lstatSync(path).isFile()))
   throw new Error('通讯数据库路径无效')
  this.db = new Database(path)
  this.db.pragma('busy_timeout = 5000')
  this.db.exec(`CREATE TABLE IF NOT EXISTS registry(id INTEGER PRIMARY KEY CHECK(id=1),revision TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS connections(id TEXT PRIMARY KEY,name TEXT NOT NULL,platform TEXT NOT NULL,revision TEXT NOT NULL,public TEXT NOT NULL,sealed BLOB NOT NULL,account TEXT NOT NULL DEFAULT '',login_epoch TEXT NOT NULL DEFAULT '',session BLOB,checked_at REAL,capabilities TEXT NOT NULL DEFAULT '{}');
   CREATE TABLE IF NOT EXISTS messages(platform TEXT,account TEXT,login_epoch TEXT,peer TEXT,mid TEXT,ts REAL,sender TEXT,text TEXT,kind TEXT,PRIMARY KEY(platform,account,login_epoch,peer,mid));
   CREATE TABLE IF NOT EXISTS send_operations(operation_id TEXT PRIMARY KEY,digest TEXT NOT NULL,scope TEXT NOT NULL,state TEXT NOT NULL,receipt TEXT NOT NULL,updated REAL NOT NULL);
   CREATE TABLE IF NOT EXISTS login_operations(operation_id TEXT PRIMARY KEY,scope TEXT NOT NULL,projection TEXT NOT NULL);`)
  this.db.prepare('INSERT OR IGNORE INTO registry VALUES(1,?)').run(id())
 }
 private revision() {
  return (this.db.prepare('SELECT revision FROM registry WHERE id=1').get() as {revision: string}).revision
 }
 private public(row: StoredConnection) {
  return {
   id: row.id,
   name: row.name,
   platform: row.platform,
   revision: row.revision,
   fields: JSON.parse(row.public) as Record<string, string>,
   has_credentials: !!row.sealed?.length,
   has_session: !!row.session?.length,
   account: row.account,
   login_epoch: row.login_epoch,
   checked_at: row.checked_at,
   capabilities: JSON.parse(row.capabilities),
   online_state: row.checked_at ? 'last_verified' : 'unverified'
  }
 }
 listing() {
  return {
   revision: this.revision(),
   connections: (this.db.prepare('SELECT * FROM connections ORDER BY rowid').all() as StoredConnection[]).map(row =>
    this.public(row)
   )
  }
 }
 capture(key: string, revision?: string) {
  imId.parse(key)
  const row = this.db.prepare('SELECT * FROM connections WHERE id=?').get(key) as StoredConnection | undefined
  if (!row) throw new Error('通讯连接不存在')
  if (revision && row.revision !== revision) throw new Error('通讯连接已改变，请刷新')
  return this.public(row)
 }
 private sealedState(key: string, revision: string) {
  this.capture(key, revision)
  return this.db.prepare('SELECT sealed,session FROM connections WHERE id=?').get(key) as {
   sealed: Buffer
   session: Buffer | null
  }
 }
 privateSnapshot(key: string, revision: string) {
  const row = this.sealedState(key, revision)
  return hash([row.sealed?.toString('base64') || '', row.session?.toString('base64') || ''])
 }
 private checkSnapshot(key: string, revision: string, snapshot: string) {
  if (this.privateSnapshot(key, revision) !== snapshot) throw new Error('通讯凭据或会话已改变，请重新读取')
 }
 async privateState(key: string, revision: string) {
  const publicRow = this.capture(key, revision),
   row = this.sealedState(key, revision),
   snapshot = this.privateSnapshot(key, revision),
   secrets = row.sealed?.length
    ? (JSON.parse((await this.crypt(row.sealed, true)).toString('utf8')) as Record<string, string>)
    : {},
   session = row.session?.length
    ? (JSON.parse((await this.crypt(row.session, true)).toString('utf8')) as Record<string, unknown>)
    : null
  this.checkSnapshot(key, revision, snapshot)
  return {...publicRow, secrets, session, snapshot}
 }
 async change(input: unknown) {
  const value = z
   .object({
    action: z.enum(['create', 'update', 'delete']),
    expected_revision: imId,
    id: imId.optional(),
    name: z.string().trim().min(1).max(80).optional(),
    platform: z.enum(platforms).optional(),
    fields: z.record(z.string(), z.string()).default({}),
    secrets: z.record(z.string(), z.string().max(8192)).default({})
   })
   .strict()
   .parse(input)
  if (this.revision() !== value.expected_revision) throw new Error('通讯连接列表已改变，请刷新')
  const old = value.action === 'create' ? undefined : this.capture(imId.parse(value.id)),
   snapshot = old ? this.privateSnapshot(old.id, old.revision) : undefined
  let fields = value.fields,
   secrets = value.secrets,
   sealed: Buffer = Buffer.alloc(0),
   unchanged = false
  if (value.action !== 'delete') {
   if (!value.name || !value.platform || (old && value.platform !== old.platform)) throw new Error('连接名称或平台无效')
   if (
    Object.keys(fields).some(key => !['mode', 'webui_url', 'onebot_url'].includes(key)) ||
    Object.keys(secrets).some(key => !['webui_token', 'onebot_token'].includes(key))
   )
    throw new Error('通讯连接字段无效')
   if (value.platform === 'qq_napcat') {
    if ((fields.mode || 'managed') === 'managed') {
     fields = {mode: 'managed'}
     secrets = {}
    } else if (fields.mode === 'manual') {
     fields = {
      mode: 'manual',
      webui_url: imLoopback(fields.webui_url),
      ...(fields.onebot_url ? {onebot_url: imLoopback(fields.onebot_url)} : {})
     }
    } else throw new Error('QQ 连接模式无效')
   } else if (Object.keys(fields).length || Object.keys(secrets).length) throw new Error('微信连接不预填第三方凭据')
   if (old && JSON.stringify(old.fields) === JSON.stringify(fields) && !Object.keys(secrets).length) {
    // Renaming an existing connection does not need access to its encrypted session.
    unchanged = true
   } else {
    const prior =
     old && JSON.stringify(old.fields) === JSON.stringify(fields)
      ? (await this.privateState(old.id, old.revision)).secrets
      : {}
    sealed = Object.keys({...prior, ...secrets}).length
     ? await this.crypt(Buffer.from(JSON.stringify({...prior, ...secrets})))
     : Buffer.alloc(0)
    unchanged =
     !!old &&
     JSON.stringify(old.fields) === JSON.stringify(fields) &&
     Object.entries(secrets).every(([key, value]) => prior[key] === value)
   }
  }
  // All asynchronous work has completed. Revalidate ownership inside the synchronous transaction.
  return this.db
   .transaction(() => {
    if (this.revision() !== value.expected_revision) throw new Error('通讯连接列表已改变，请刷新')
    if (old) this.checkSnapshot(old.id, old.revision, snapshot!)
    if (value.action === 'delete') this.db.prepare('DELETE FROM connections WHERE id=?').run(old!.id)
    else {
     if (!old && this.listing().connections.length >= 20) throw new Error('最多保存20个通讯连接')
     if (old && unchanged)
      this.db.prepare('UPDATE connections SET name=?,revision=? WHERE id=?').run(value.name, id(), old.id)
     else if (old)
      this.db
       .prepare(
        "UPDATE connections SET name=?,revision=?,public=?,sealed=?,account='',login_epoch='',session=NULL,checked_at=NULL,capabilities='{}' WHERE id=?"
       )
       .run(value.name, id(), JSON.stringify(fields), sealed, old.id)
     else
      this.db
       .prepare('INSERT INTO connections(id,name,platform,revision,public,sealed) VALUES(?,?,?,?,?,?)')
       .run(id(), value.name, value.platform, id(), JSON.stringify(fields), sealed)
    }
    this.db.prepare('UPDATE registry SET revision=? WHERE id=1').run(id())
    return this.listing()
   })
   .immediate()
 }
 async bind(
  key: string,
  revision: string,
  account: string,
  session: unknown,
  capabilities: unknown,
  beforeCommit: () => void = () => {}
 ) {
  z.string().min(1).max(200).parse(account)
  const snapshot = this.privateSnapshot(key, revision),
   sealed = await this.crypt(Buffer.from(JSON.stringify(session)))
  return this.db
   .transaction(() => {
    this.checkSnapshot(key, revision, snapshot)
    beforeCommit()
    const row = this.capture(key, revision)
    if (row.account && row.account !== account) throw new Error('账号与此连接原绑定不一致，请新建连接')
    this.db
     .prepare(
      'UPDATE connections SET revision=?,account=?,login_epoch=?,session=?,checked_at=?,capabilities=? WHERE id=?'
     )
     .run(id(), account, id(), sealed, Date.now() / 1000, JSON.stringify(capabilities), key)
    this.db.prepare('UPDATE registry SET revision=? WHERE id=1').run(id())
    return this.capture(key)
   })
   .immediate()
 }

 checkScope(input: unknown) {
  const scope = imScope.parse(input),
   row = this.capture(scope.connection_id, scope.revision)
  if (
   row.platform !== scope.platform ||
   row.account !== scope.account ||
   row.login_epoch !== scope.login_epoch ||
   !row.has_session
  )
   throw new Error('消息账号或登录代际已改变')
  return {scope, row}
 }
 accountLimits(input: unknown) {
  const {scope} = this.checkScope(input),
   schema = z.object({
    read_enabled: z.boolean().default(true),
    archive_enabled: z.boolean().default(true),
    max_messages: z.number().int().min(50).max(100000).default(2000),
    max_bytes: z
     .number()
     .int()
     .min(1048576)
     .max(1073741824)
     .default(20 * 1048576),
    retention_days: z.number().int().min(1).max(3650).default(30)
   })
  if (!this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='im_rules'").get())
   return schema.parse({})
  const row = this.db
   .prepare("SELECT value FROM im_rules WHERE platform=? AND account=? AND peer=''")
   .get(scope.platform, scope.account) as {value: string} | undefined
  return schema.parse(row ? JSON.parse(row.value) : {})
 }
 requireRead(input: unknown) {
  if (!this.accountLimits(input).read_enabled) throw new Error('此账号已停用消息读取，旧权限设置继续生效')
 }
 saveMessages(input: unknown, messages: unknown) {
  const rows = z
   .array(
    z.object({
     mid: z.string().min(1).max(200),
     ts: z.number().finite().nonnegative(),
     sender: z.string().max(300),
     text: z.string().max(50000),
     kind: z.string().max(80)
    })
   )
   .max(5000)
   .parse(messages)
  return this.db
   .transaction(() => {
    const {scope} = this.checkScope(input),
     limits = this.accountLimits(scope)
    this.requireRead(scope)
    if (!limits.archive_enabled) throw new Error('此账号已停用消息保存，未保存正文或推进游标')
    for (const message of rows) {
     const prior = this.db
      .prepare(
       'SELECT ts,sender,text,kind FROM messages WHERE platform=? AND account=? AND login_epoch=? AND peer=? AND mid=?'
      )
      .get(scope.platform, scope.account, scope.login_epoch, scope.peer, message.mid) as
      | Omit<typeof message, 'mid'>
      | undefined
     if (
      prior &&
      hash(prior) !== hash({ts: message.ts, sender: message.sender, text: message.text, kind: message.kind})
     )
      throw new Error('同一消息编号内容已改变，旧记录保留')
     this.db
      .prepare('INSERT OR IGNORE INTO messages VALUES(?,?,?,?,?,?,?,?,?)')
      .run(
       scope.platform,
       scope.account,
       scope.login_epoch,
       scope.peer,
       message.mid,
       message.ts,
       message.sender,
       message.text,
       message.kind
      )
    }
    const usage = this.db
     .prepare(
      'SELECT COUNT(*) AS count,COALESCE(SUM(length(CAST(text AS BLOB))),0) AS bytes FROM messages WHERE platform=? AND account=?'
     )
     .get(scope.platform, scope.account) as {count: number; bytes: number}
    let mediaBytes = 0
    if (this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='im_media'").get())
     mediaBytes = (
      this.db
       .prepare('SELECT COALESCE(SUM(length(bytes)),0) AS bytes FROM im_media WHERE platform=? AND account=?')
       .get(scope.platform, scope.account) as {bytes: number}
     ).bytes
    if (usage.count > limits.max_messages || usage.bytes + mediaBytes > limits.max_bytes)
     throw new Error('账号保存记录达到容量上限，请先预览清理；本次正文与游标未保存')
    return {saved: rows.length, coverage: '仅此次接口可取得的消息，不代表全部历史'}
   })
   .immediate()
 }
 async saveSessionAndMessages(
  input: unknown,
  session: unknown,
  messages: unknown,
  snapshot: string,
  beforeCommit: () => void = () => {}
 ) {
  const {scope: original} = this.checkScope(input)
  this.checkSnapshot(original.connection_id, original.revision, snapshot)
  const encrypted = await this.crypt(Buffer.from(JSON.stringify(session)))
  return this.db
   .transaction(() => {
    const {scope} = this.checkScope(input)
    this.checkSnapshot(scope.connection_id, scope.revision, snapshot)
    beforeCommit()
    const result = this.saveMessages(scope, messages)
    this.db
     .prepare('UPDATE connections SET session=?,checked_at=? WHERE id=? AND revision=?')
     .run(encrypted, Date.now() / 1000, scope.connection_id, scope.revision)
    return result
   })
   .immediate()
 }
 savedDirectory(input: unknown) {
  const {scope} = this.checkScope(input)
  this.requireRead(scope)
  const peers = this.db
   .prepare(
    'SELECT peer,COUNT(*) AS count FROM messages WHERE platform=? AND account=? AND login_epoch=? GROUP BY peer ORDER BY MAX(ts) DESC,peer LIMIT 500'
   )
   .all(scope.platform, scope.account, scope.login_epoch) as {peer: string; count: number}[]
  return {peers: peers.map(row => ({...row, name: row.peer})), coverage: '当前账号登录代际最近 500 个已保存会话'}
 }
 readMessages(input: unknown) {
  this.requireRead(input)
  const value = z
    .object({
     ...imScope.shape,
     limit: z.number().int().min(1).max(100).default(50),
     cursor: z.object({ts: z.number().finite(), mid: z.string().max(200)}).optional()
    })
    .parse(input),
   {scope} = this.checkScope(value),
   cursor = value.cursor
  const rows = this.db
   .prepare(
    'SELECT mid,ts,sender,text,kind FROM messages WHERE platform=? AND account=? AND login_epoch=? AND peer=?' +
     (cursor ? ' AND (ts<? OR (ts=? AND mid<?))' : '') +
     ' ORDER BY ts DESC,mid DESC LIMIT ?'
   )
   .all(
    scope.platform,
    scope.account,
    scope.login_epoch,
    scope.peer,
    ...(cursor ? [cursor.ts, cursor.ts, cursor.mid] : []),
    value.limit + 1
   ) as {mid: string; ts: number; sender: string; text: string; kind: string}[]
  const selected = rows.slice(0, value.limit)
  return {
   messages: selected,
   next_cursor: rows.length > value.limit ? {ts: selected.at(-1)!.ts, mid: selected.at(-1)!.mid} : null
  }
 }
 claimSend(input: unknown) {
  const value = z
   .object({
    ...imScope.shape,
    operation_id: imId,
    text: z.string().trim().min(1).max(4000),
    user_confirmed: z.literal(true)
   })
   .parse(input)
  return this.db
   .transaction(() => {
    const {scope} = this.checkScope(value),
     digest = hash({scope, text: value.text}),
     old = this.db.prepare('SELECT * FROM send_operations WHERE operation_id=?').get(value.operation_id) as
      | {digest: string; receipt: string}
      | undefined
    if (old) {
     if (old.digest !== digest) throw new Error('发送编号已用于不同内容')
     return {fresh: false, value, receipt: JSON.parse(old.receipt) as {state: string; operation_id: string}}
    }
    const receipt = {operation_id: value.operation_id, state: 'sending'}
    this.db
     .prepare('INSERT INTO send_operations VALUES(?,?,?,?,?,?)')
     .run(value.operation_id, digest, JSON.stringify(scope), 'sending', JSON.stringify(receipt), Date.now() / 1000)
    return {fresh: true, value, receipt}
   })
   .immediate()
 }
 finishSend(operationId: string, state: 'sent' | 'unknown', messageId?: string) {
  imId.parse(operationId)
  if (messageId) z.string().max(200).parse(messageId)
  const receipt = {operation_id: operationId, state, ...(messageId ? {message_id: messageId} : {})}
  const result = this.db
   .prepare("UPDATE send_operations SET state=?,receipt=?,updated=? WHERE operation_id=? AND state='sending'")
   .run(state, JSON.stringify(receipt), Date.now() / 1000, operationId)
  if (result.changes !== 1) throw new Error('发送回执状态已改变，需要人工核对')
  return receipt
 }
 sendStatus(input: unknown) {
  const value = z.object({...imScope.shape, operation_id: imId}).parse(input),
   {scope} = this.checkScope(value),
   row = this.db
    .prepare('SELECT scope,state,receipt FROM send_operations WHERE operation_id=?')
    .get(value.operation_id) as {scope: string; state: string; receipt: string} | undefined
  if (!row || JSON.stringify(scope) !== row.scope) throw new Error('此发送回执不属于当前账号和会话')
  return {...JSON.parse(row.receipt), state: row.state === 'sending' ? 'unknown' : row.state}
 }
 close() {
  this.db.close()
 }
}
