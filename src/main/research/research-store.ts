import Database from 'better-sqlite3'
import {createHash, randomUUID} from 'node:crypto'
import {existsSync, lstatSync, realpathSync, mkdirSync} from 'node:fs'
import {join, resolve} from 'node:path'
import {z} from 'zod'
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const opSchema = z.string().regex(/^[a-f0-9]{32}$/)
const conversationId = z.string().regex(/^(?:cv_)?[a-f0-9]{32}$/)
const memorySchema = z.object({
 memory_id: opSchema,
 revision: z.number().int().positive(),
 kind: z.enum(['preference', 'progress', 'correction']),
 title: z.string().max(80),
 body: z.string().max(1000),
 source_task: z.string().nullable(),
 paused: z.boolean(),
 expires_at: z.number().finite().nonnegative().nullable(),
 created_at: z.number().finite(),
 updated_at: z.number().finite(),
 deleted: z.boolean().default(false)
})
const conversationSchema = z.object({
 conversation_id: conversationId,
 title: z.string().trim().min(1).max(80),
 revision: z.number().int().nonnegative(),
 pinned: z.boolean(),
 updated_at: z.string(),
 active_turn: z.string().nullable().default(null)
})
type StoredMemory = z.infer<typeof memorySchema>
type Conversation = z.infer<typeof conversationSchema>
/** Separate native state database; the old database remains a read-only migration source. */
export class NativeResearchStore {
 readonly db: Database.Database
 readonly rootId: string
 constructor(private root: string) {
  mkdirSync(root, {recursive: true})
  if (lstatSync(root).isSymbolicLink() || realpathSync(root).toLowerCase() !== resolve(root).toLowerCase())
   throw new Error('研究资料根目录无效')
  const path = join(root, 'research-native.sqlite')
  if (existsSync(path) && (lstatSync(path).isSymbolicLink() || !lstatSync(path).isFile()))
   throw new Error('研究资料数据库路径无效')
  const kb = join(root, 'knowledge_base'),
   canonical = existsSync(kb) ? realpathSync(kb) : resolve(kb)
  this.rootId = 'kbr_' + digest(['kbr', canonical.toLowerCase()]).slice(0, 32)
  this.db = new Database(path)
  this.db.pragma('journal_mode = WAL')
  this.db.pragma('busy_timeout = 5000')
  this.db.exec(`CREATE TABLE IF NOT EXISTS research_records(kind TEXT NOT NULL,id TEXT NOT NULL,revision INTEGER NOT NULL,json TEXT NOT NULL,PRIMARY KEY(kind,id));
   CREATE TABLE IF NOT EXISTS research_operations(op TEXT PRIMARY KEY,signature TEXT NOT NULL,result TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS research_baselines(name TEXT PRIMARY KEY,json TEXT NOT NULL);`)
 }
 close() {
  this.db.close()
 }
 list<T>(kind: string): T[] {
  return (
   this.db.prepare('SELECT json FROM research_records WHERE kind=? ORDER BY id').all(kind) as {json: string}[]
  ).map(row => JSON.parse(row.json))
 }
 read<T>(kind: string, id: string): T {
  const row = this.db.prepare('SELECT json FROM research_records WHERE kind=? AND id=?').get(kind, id) as
   | {json: string}
   | undefined
  if (!row) throw new Error('所选学习记录不存在')
  return JSON.parse(row.json)
 }
 put(kind: string, id: string, revision: number, value: unknown) {
  this.db
   .prepare(
    'INSERT INTO research_records VALUES(?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET revision=excluded.revision,json=excluded.json'
   )
   .run(kind, id, revision, JSON.stringify(value))
 }
 operation<T>(op: string, request: unknown, run: () => T): T {
  opSchema.parse(op)
  const signature = digest(request)
  return this.db.transaction(() => {
   const prior = this.db.prepare('SELECT signature,result FROM research_operations WHERE op=?').get(op) as
    | {signature: string; result: string}
    | undefined
   if (prior) {
    if (prior.signature !== signature) throw new Error('操作编号已用于不同的修改')
    return JSON.parse(prior.result) as T
   }
   const result = run()
   this.db.prepare('INSERT INTO research_operations VALUES(?,?,?)').run(op, signature, JSON.stringify(result))
   return result
  })()
 }
 memories() {
  const now = Date.now() / 1000,
   rows = this.list<StoredMemory>('memory')
    .map(row => memorySchema.parse(row))
    .filter(row => !row.deleted)
    .sort((a, b) => b.updated_at - a.updated_at)
  return {
   kb_root_id: this.rootId,
   records: rows.map(row => ({
    ...row,
    availability: row.paused ? 'paused' : row.expires_at !== null && row.expires_at <= now ? 'expired' : 'active'
   })),
   reviewed_pairs: [],
   capacity: {used: rows.length, limit: 100, remaining: Math.max(0, 100 - rows.length)}
  }
 }
 changeMemory(input: unknown, deleting = false) {
  const value = z
   .object({
    op_id: opSchema,
    memory_id: opSchema.nullable(),
    revision: z.number().int().nonnegative(),
    kind: z.enum(['preference', 'progress', 'correction']).optional(),
    title: z.string().trim().min(1).max(80).optional(),
    body: z.string().trim().min(1).max(1000).optional(),
    source_task: z.string().nullable().optional(),
    paused: z.boolean().optional(),
    expires_at: z.number().finite().nonnegative().nullable().optional()
   })
   .strict()
   .parse(input)
  return this.operation(value.op_id, {deleting, ...value}, () => {
   let prior: StoredMemory | undefined
   if (value.memory_id) {
    prior = memorySchema.parse(this.read('memory', value.memory_id))
    if (prior.deleted || prior.revision !== value.revision) throw new Error('记忆版本已改变，请刷新后保存')
   } else if (value.revision !== 0 || deleting) throw new Error('新记忆的版本无效')
   if (!prior && this.memories().capacity.used >= 100) throw new Error('学习记忆最多保存100条')
   const now = Date.now() / 1000,
    id = value.memory_id || randomUUID().replaceAll('-', ''),
    revision = value.revision + 1
   if (deleting) {
    this.put('memory', id, revision, {
     ...prior!,
     title: '',
     body: '',
     source_task: null,
     revision,
     updated_at: now,
     deleted: true
    })
    for (const kind of ['legacy:learning_memories', 'legacy:learning_memory_availability'])
     for (const row of this.db.prepare('SELECT id,json FROM research_records WHERE kind=?').all(kind) as {
      id: string
      json: string
     }[]) {
      if (JSON.parse(row.json).memory_id === id)
       this.db.prepare('DELETE FROM research_records WHERE kind=? AND id=?').run(kind, row.id)
     }
    return {memory_id: id, revision, deleted: true}
   }
   if (!value.kind || !value.title || !value.body) throw new Error('记忆类型、标题和正文不能为空')
   if (value.source_task && value.source_task !== prior?.source_task)
    throw new Error('记忆来源必须由已核验的研究结果确认，不接受任意任务编号')
   const next = memorySchema.parse({
    memory_id: id,
    revision,
    kind: value.kind,
    title: value.title,
    body: value.body,
    source_task: value.source_task ?? prior?.source_task ?? null,
    paused: value.paused ?? prior?.paused ?? false,
    expires_at: value.expires_at === undefined ? (prior?.expires_at ?? null) : value.expires_at,
    created_at: prior?.created_at ?? now,
    updated_at: now,
    deleted: false
   })
   this.put('memory', id, revision, next)
   return {memory_id: id, revision, deleted: false}
  })
 }
 createConversation(title: string) {
  const row = conversationSchema.parse({
   conversation_id: 'cv_' + randomUUID().replaceAll('-', ''),
   title,
   revision: 0,
   pinned: false,
   updated_at: new Date().toISOString(),
   active_turn: null
  })
  this.put('conversation', row.conversation_id, row.revision, row)
  return row
 }
 conversations(offset = 0) {
  z.number().int().min(0).max(100000).parse(offset)
  const all = this.list<Conversation>('conversation')
   .map(row => conversationSchema.parse(row))
   .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updated_at.localeCompare(a.updated_at))
  return {entries: all.slice(offset, offset + 50), has_more: offset + 50 < all.length}
 }
 legacyResearchTasks() {
  return this.list<Record<string, unknown>>('legacy-task').map(raw => {
   const task = z
    .object({
     task_id: opSchema,
     question: z.string().max(1500),
     status: z.string(),
     note: z.string().max(200000).default(''),
     limitations: z.string().max(40000).default(''),
     sources: z
      .array(
       z.object({
        source_id: z.string().max(80),
        title: z.string().max(1000),
        url: z.string().max(4000).default(''),
        text: z.string().max(100000).default(''),
        read: z.boolean().default(false)
       })
      )
      .max(100)
      .default([])
    })
    .parse(raw)
   return {
    ...task,
    status: 'legacy_saved',
    original_status: task.status,
    note: task.status === 'completed' ? task.note : '',
    turns: 0,
    events: [
     {kind: 'legacy', message: '旧后台保存时记录，只读展示；尚未按新原生来源代际重新核验，不自动继续旧模型或工具调用。'}
    ],
    error_code: '旧记录仅供回顾，请选择当前原文建立新研究后再核验。',
    memory_candidates: [],
    limitations: task.limitations + ' 本记录尚未按原生知识库重新核验。'
   }
  })
 }
 legacyWorkflows() {
  const nativeIds = new Set(this.list<{workflow_id: string}>('workflow').map(flow => flow.workflow_id))
  return this.list<{state_json: string}>('legacy:grounded_workflows')
   .map(record => {
    const raw = z
     .object({
      workflow_id: opSchema,
      kb_root_id: z.literal(this.rootId),
      question: z.string().max(800),
      status: z.string().max(40),
      revision: z.number().int().nonnegative(),
      fence: z.number().int().nonnegative(),
      steps: z
       .array(
        z.object({
         name: z.string().max(100),
         status: z.string().max(40),
         answer: z.string().max(200000),
         answer_sha256: z.string().nullable()
        })
       )
       .max(10)
     })
     .parse(JSON.parse(z.string().max(4000000).parse(record.state_json)))
    const steps = raw.steps.map(step => ({
     ...step,
     hash_verified:
      step.answer_sha256 !== null && step.answer_sha256 === createHash('sha256').update(step.answer).digest('hex')
    }))
    return {
     workflow_id: raw.workflow_id,
     question: raw.question,
     status: 'legacy_saved' as const,
     original_status: raw.status,
     revision: raw.revision,
     fence: raw.fence,
     outcome_unknown: false,
     steps,
     reference_status: 'not_revalidated' as const,
     notice:
      '旧工作流仅显示保存时的内容；原资料和来源版本尚未重新核验。' +
      (steps.some(step => step.status === 'completed' && !step.hash_verified)
       ? ' 部分已完成步骤的正文校验值不符，请核对历史文件。'
       : '')
    }
   })
   .filter(flow => !nativeIds.has(flow.workflow_id))
 }
 conversation(id: string) {
  conversationId.parse(id)
  const row = conversationSchema.parse(this.read('conversation', id))
  const historical = this.list<Record<string, unknown>>('legacy:kb_conversation_turns').filter(
   turn => turn.conversation_id === id
  )
  return {
   ...row,
   turns: [...historical, ...this.list<{conversation_id: string}>('turn').filter(turn => turn.conversation_id === id)],
   research_tasks: [
    ...this.list<{conversation_id?: string; conversation?: {conversation_id: string}}>('task'),
    ...this.list<{conversation_id?: string; conversation?: {conversation_id: string}}>('legacy-task')
   ].filter(task => task.conversation_id === id || task.conversation?.conversation_id === id)
  }
 }
 organizeConversation(input: unknown) {
  const value = z
   .object({
    id: conversationId,
    op: opSchema,
    revision: z.number().int().nonnegative(),
    title: z.string().trim().min(1).max(80),
    pinned: z.boolean()
   })
   .parse(input)
  return this.operation(value.op, value, () => {
   const row = conversationSchema.parse(this.read('conversation', value.id))
   if (row.revision !== value.revision) throw new Error('会话版本已改变，请刷新后保存')
   const next = {
    ...row,
    title: value.title,
    pinned: value.pinned,
    revision: row.revision + 1,
    updated_at: new Date().toISOString()
   }
   this.put('conversation', row.conversation_id, next.revision, next)
   return {state: next}
  })
 }
 practiceQuestions(query: string, id?: string) {
  z.string().max(1500).parse(query)
  if (id) opSchema.parse(id)
  const path = join(this.root, 'knowledge.sqlite')
  if (!existsSync(path)) return []
  if (lstatSync(path).isSymbolicLink() || !lstatSync(path).isFile()) throw new Error('练习题数据库路径无效')
  const legacy = new Database(path, {readonly: true, fileMustExist: true})
  try {
   if (!legacy.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='tutor_questions'").get()) return []
   const rows = (
    id
     ? legacy
        .prepare('SELECT question_id,question,created_at FROM tutor_questions WHERE kb_root_id=? AND question_id=?')
        .all(this.rootId, id)
     : legacy
        .prepare(
         'SELECT question_id,question,created_at FROM tutor_questions WHERE kb_root_id=? ORDER BY created_at DESC,question_id LIMIT 80'
        )
        .all(this.rootId)
   ) as {question_id: string; question: string; created_at: string}[]
   const valid = rows.map(row =>
     z.object({question_id: opSchema, question: z.string().min(1).max(2000), created_at: z.string().max(80)}).parse(row)
    ),
    terms = query.toLowerCase().match(/[a-z0-9]+|[\u3400-\u9fff]{1,2}/g) || []
   const score = (row: {question: string}) =>
    terms.reduce((sum, term) => sum + Number(row.question.toLowerCase().includes(term)), 0)
   return id
    ? valid
    : valid
       .sort((a, b) => score(b) - score(a))
       .filter(row => score(row) > 0)
       .slice(0, 6)
  } finally {
   legacy.close()
  }
 }
 /** Snapshots preserve the selected legacy tables for adapters; full research migration is a separate gate. */
 baselineLegacy() {
  this.baselineLegacyNotes()
  const existing = this.db.prepare('SELECT json FROM research_baselines WHERE name=?').get('python-v1') as
   | {json: string}
   | undefined
  if (existing) return JSON.parse(existing.json)
  const path = join(this.root, 'knowledge.sqlite')
  if (!existsSync(path)) return {imported: false, reason: 'no-legacy-database'}
  if (lstatSync(path).isSymbolicLink() || !lstatSync(path).isFile()) throw new Error('旧研究数据库路径无效')
  const legacy = new Database(path, {readonly: true, fileMustExist: true})
  const tables = [
   'kb_conversations',
   'kb_conversation_organization',
   'kb_conversation_turns',
   'kb_conversation_research',
   'learning_memories',
   'learning_memory_availability',
   'learning_research_tasks',
   'grounded_workflows',
   'grounded_runs',
   'learning_agent_extensions',
   'learning_mcp_catalog',
   'learning_memory_reviews',
   'document_note_references',
   'kb_conversation_turn_citations'
  ]
  const snapshot: Record<string, Record<string, unknown>[]> = Object.create(null)
  try {
   legacy.transaction(() => {
    for (const table of tables) {
     if (!legacy.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)) continue
     const rows = legacy.prepare(`SELECT * FROM ${table}`).all() as Record<string, unknown>[]
     snapshot[table] = rows.filter(row => row.kb_root_id === undefined || row.kb_root_id === this.rootId)
    }
   })()
  } finally {
   legacy.close()
  }
  return this.db.transaction(() => {
   const counts: Record<string, number> = {}
   for (const [table, rows] of Object.entries(snapshot)) {
    counts[table] = rows.length
    for (const [index, row] of rows.entries()) this.put('legacy:' + table, String(index), 0, row)
   }
   for (const old of snapshot.kb_conversations || []) {
    const organization = (snapshot.kb_conversation_organization || []).find(
      row => row.conversation_id === old.conversation_id
     ),
     row = conversationSchema.parse({
      conversation_id: old.conversation_id,
      title: old.title,
      revision: Math.max(Number(old.revision), Number(organization?.revision || 0)),
      pinned: !!organization?.pinned,
      updated_at: old.updated_at,
      active_turn: null
     })
    if (
     !this.db.prepare('SELECT 1 FROM research_records WHERE kind=? AND id=?').get('conversation', row.conversation_id)
    )
     this.put('conversation', row.conversation_id, row.revision, row)
   }
   for (const old of snapshot.learning_memories || []) {
    const availability = (snapshot.learning_memory_availability || []).find(row => row.memory_id === old.memory_id),
     row = memorySchema.parse({
      memory_id: old.memory_id,
      revision: old.revision,
      kind: old.kind,
      title: old.title,
      body: old.body,
      source_task: old.source_task ?? null,
      paused: !!availability?.paused,
      expires_at: availability?.expires_at ?? null,
      created_at: old.created_at,
      updated_at: old.updated_at,
      deleted: !!old.deleted
     })
    if (!this.db.prepare('SELECT 1 FROM research_records WHERE kind=? AND id=?').get('memory', row.memory_id))
     this.put('memory', row.memory_id, row.revision, row)
   }
   for (const old of snapshot.learning_research_tasks || []) {
    const task = JSON.parse(z.string().parse(old.state_json))
    if (!task.task_id || task.kb_root_id !== this.rootId) throw new Error('旧研究任务来源不一致')
    this.put('legacy-task', task.task_id, 0, task)
   }
   const result = {
    imported: true,
    root: this.rootId,
    counts,
    digest: digest(snapshot),
    oldDatabaseReadOnly: true,
    completedNativeResearch: false
   }
   this.db.prepare('INSERT INTO research_baselines VALUES(?,?)').run('python-v1', JSON.stringify(result))
   return result
  })()
 }
 private baselineLegacyNotes() {
  if (this.db.prepare('SELECT 1 FROM research_baselines WHERE name=?').get('legacy-notes-v1')) return
  const path = join(this.root, 'knowledge.sqlite')
  if (!existsSync(path)) return
  if (lstatSync(path).isSymbolicLink() || !lstatSync(path).isFile()) throw new Error('旧笔记数据库路径无效')
  const legacy = new Database(path, {readonly: true, fileMustExist: true})
  let notes: Record<string, unknown>[] = [],
   events: Record<string, unknown>[] = []
  try {
   legacy.transaction(() => {
    if (legacy.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='document_saved_notes'").get())
     notes = legacy.prepare('SELECT * FROM document_saved_notes WHERE kb_root_id=?').all(this.rootId) as Record<
      string,
      unknown
     >[]
    if (
     legacy.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='document_note_lifecycle_events'").get()
    )
     events = legacy
      .prepare(
       'SELECT note_id,revision,state,body_sha256 FROM document_note_lifecycle_events WHERE kb_root_id=? ORDER BY revision'
      )
      .all(this.rootId) as Record<string, unknown>[]
   })()
  } finally {
   legacy.close()
  }
  this.db.transaction(() => {
   for (const old of notes) {
    const id = opSchema.parse(old.note_id),
     markdown = z.string().max(4000000).parse(old.markdown),
     bodyHash = createHash('sha256').update(markdown).digest('hex'),
     receipt = z
      .object({
       note_id: opSchema,
       title: z.string(),
       body_sha256: z.string(),
       created_at: z.string(),
       parent_note_id: opSchema.optional()
      })
      .passthrough()
      .parse(JSON.parse(z.string().parse(old.receipt_json)))
    if (
     old.body_sha256 !== bodyHash ||
     receipt.body_sha256 !== bodyHash ||
     receipt.note_id !== id ||
     old.body_bytes !== Buffer.byteLength(markdown)
    )
     throw new Error('旧笔记正文与保存回执不一致，未导入为有效笔记')
    const state = events.filter(event => event.note_id === id).at(-1)
    if (state && (state.body_sha256 !== bodyHash || !['active', 'archived'].includes(String(state.state))))
     throw new Error('旧笔记归档回执无效')
    const note = {
     receipt,
     markdown,
     lifecycle: {revision: state ? Number(state.revision) : 0, state: state?.state || 'active'},
     task_id: null,
     taskHash: null,
     parent_note_id: receipt.parent_note_id || null,
     sourceDigest: null,
     legacy: {source: 'knowledge.sqlite', originalReceipt: receipt, referenceStatus: 'not_revalidated'}
    }
    const existing = this.db.prepare('SELECT json FROM research_records WHERE kind=? AND id=?').get('note', id) as
     | {json: string}
     | undefined
    if (existing && JSON.parse(existing.json).receipt.body_sha256 !== bodyHash)
     throw new Error('旧笔记编号与新笔记冲突，两个版本保留待确认')
    if (!existing) this.put('note', id, note.lifecycle.revision, note)
   }
   this.db.prepare('INSERT INTO research_baselines VALUES(?,?)').run(
    'legacy-notes-v1',
    JSON.stringify({
     count: notes.length,
     digest: digest(notes),
     legacyReadOnly: true,
     sourceCurrentness: 'not_revalidated'
    })
   )
  })()
 }
}
