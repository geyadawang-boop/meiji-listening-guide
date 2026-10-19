import {createHash, randomUUID} from 'node:crypto'
import {z} from 'zod'
import {NativeImStore, imId, imScope, type NativeImScope} from '@main/im/core/im-store'
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
type Preview = {scope: NativeImScope; hash: string; count: number; bytes: number; createdAt: number; done: boolean}
/** Only explicitly previewed local text records. External chats and media files are never deleted here. */
export class NativeImCleanup {
 constructor(private store: NativeImStore) {
  store.db.exec('CREATE TABLE IF NOT EXISTS native_im_cleanup(id TEXT PRIMARY KEY,json TEXT NOT NULL)')
 }
 private matches(a: Record<string, unknown>, scope: NativeImScope) {
  return (
   a.platform === scope.platform &&
   a.account === scope.account &&
   a.login_epoch === scope.login_epoch &&
   a.peer === scope.peer
  )
 }
 private protected(scope: NativeImScope) {
  for (const row of this.store.db
   .prepare("SELECT scope FROM send_operations WHERE state NOT IN ('sent','completed','failed_before_request')")
   .all() as {scope: string}[]) {
   try {
    if (this.matches(JSON.parse(row.scope), scope)) return true
   } catch {
    return true
   }
  }
  if (this.store.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='native_im_state'").get())
   for (const row of this.store.db.prepare("SELECT json FROM native_im_state WHERE kind='job'").all() as {
    json: string
   }[]) {
    const job = JSON.parse(row.json) as {state: string; scope: Record<string, unknown>}
    if (job.state !== 'completed' && this.matches(job.scope, scope)) return true
   }
  return false
 }
 private rows(scope: NativeImScope) {
  const rows = this.store.db
   .prepare(
    'SELECT mid,ts,sender,text,kind FROM messages WHERE platform=? AND account=? AND login_epoch=? AND peer=? ORDER BY mid LIMIT 10001'
   )
   .all(scope.platform, scope.account, scope.login_epoch, scope.peer) as {text: string}[]
  if (rows.length > 10000) throw new Error('本会话记录较多，需要分段清理，当前未删除记录')
  return rows
 }
 execute(input: unknown) {
  const args = z
    .object({...imScope.shape, preview_id: imId.optional(), user_confirmed: z.boolean().optional()})
    .parse(input),
   {scope} = this.store.checkScope(args)
  return this.store.db
   .transaction(() => {
    if (!args.preview_id) {
     const protectedByTask = this.protected(scope),
      rows = protectedByTask ? [] : this.rows(scope),
      value: Preview = {
       scope,
       hash: digest(rows),
       count: rows.length,
       bytes: rows.reduce((sum, row) => sum + Buffer.byteLength(row.text), 0),
       createdAt: Date.now(),
       done: false
      },
      previewId = randomUUID().replaceAll('-', '')
     this.store.db.prepare('INSERT INTO native_im_cleanup VALUES(?,?)').run(previewId, JSON.stringify(value))
     return {
      preview_id: previewId,
      count: value.count,
      images: 0,
      bytes: value.bytes,
      reason: protectedByTask
       ? '未完成回复待办或未确认发送仍需这些消息，当前保留。'
       : '只清理本软件保存的所选会话文字记录。'
     }
    }
    if (args.user_confirmed !== true) throw new Error('请先确认清理预览')
    const saved = this.store.db.prepare('SELECT json FROM native_im_cleanup WHERE id=?').get(args.preview_id) as
     | {json: string}
     | undefined
    if (!saved) throw new Error('清理预览不存在')
    const preview = JSON.parse(saved.json) as Preview
    if (JSON.stringify(preview.scope) !== JSON.stringify(scope)) throw new Error('清理预览不属于当前账号和会话')
    if (preview.done) return {deleted: preview.count, replayed: true}
    if (Date.now() - preview.createdAt > 10 * 60000 || this.protected(scope))
     throw new Error('清理预览已过期或出现待办，请重新检查')
    const rows = this.rows(scope)
    if (digest(rows) !== preview.hash || rows.length !== preview.count)
     throw new Error('预览之后消息已改变，当前未删除')
    const result = this.store.db
     .prepare('DELETE FROM messages WHERE platform=? AND account=? AND login_epoch=? AND peer=?')
     .run(scope.platform, scope.account, scope.login_epoch, scope.peer)
    if (result.changes !== preview.count) throw new Error('清理数量与预览不符，修改已回滚')
    this.store.db
     .prepare('UPDATE native_im_cleanup SET json=? WHERE id=?')
     .run(JSON.stringify({...preview, done: true}), args.preview_id)
    return {deleted: preview.count, replayed: false}
   })
   .immediate()
 }
}
