import Database from 'better-sqlite3'
import {createHash, randomUUID} from 'node:crypto'
import {mkdirSync} from 'node:fs'
import {readFile, readdir, lstat} from 'node:fs/promises'
import {basename, join} from 'node:path'
import {z} from 'zod'
import type {KnowledgeEntry, KnowledgeHit, KnowledgeSearch} from '@shared/knowledge'

const sourceId = z.string().regex(/^(?:BV[0-9A-Za-z]{10}|LV(?:[a-f0-9]{8}|[a-f0-9]{64}))$/)
const sha = (text: string) => createHash('sha256').update(text).digest('hex')
export const nativeClassificationOptions = {
 type: [
  '科技',
  '娱乐',
  '教育',
  '生活',
  '游戏',
  '音乐',
  '影视',
  '知识科普',
  '教程',
  '评测',
  '新闻',
  '动漫',
  '其他',
  'unknown'
 ],
 difficulty: ['入门', '进阶', '专业', 'unknown'],
 duration: ['短视频', '中等', '长视频', '超长', 'unknown'],
 language: ['中文', '英文', '混合', '其他', 'unknown']
}
const selectionSchema = z
 .object({
  type: z.string(),
  topic: z.string().trim().max(80),
  subtopics: z.array(z.string().trim().max(60)).max(6),
  difficulty: z.string(),
  duration: z.string(),
  language: z.string(),
  keywords: z.array(z.string().trim().max(64)).max(16),
  quality_tier: z.enum(['S', 'A', 'B', 'C', 'unknown']).optional()
 })
 .strict()
 .superRefine((value, context) => {
  for (const key of ['type', 'difficulty', 'duration', 'language'] as const)
   if (!nativeClassificationOptions[key].includes(value[key]))
    context.addIssue({code: 'custom', path: [key], message: '分类选项无效'})
 })
const entrySchema = z
 .object({
  bvid: sourceId,
  title: z.string().min(1),
  text: z.string(),
  textLength: z.number().int().nonnegative(),
  savedAt: z.string(),
  folder: z.string().default(''),
  source_locator: z.string(),
  sourceHash: z.string().default(''),
  sourceMethod: z.string().optional(),
  generation_id: z.string().min(1),
  source_revision_id: z.string().min(1),
  content_hash: z.string().regex(/^[a-f0-9]{64}$/)
 })
 .passthrough()
type Entry = z.infer<typeof entrySchema>
type StoredChunk = {
 evidence_id: string
 source_id: string
 generation_id: string
 source_revision_id: string
 chunk_index: number
 content: string
 digest: string
 locator: string
}
export type KnowledgeImport = {
 title: string
 text: string
 locator: string
 sourceHash: string
 category?: string
 sourceMethod?: string
 origin?: string
 expectedGeneration?: string | null
}

/** One transactional native database owns sources and citation contents. Old
 * files are imported as a baseline, never edited during the compatibility scan. */
export class NativeKnowledgeStore {
 private db: Database.Database
 private drafts = new Map<string, {id: string; generation: string; digest: string}>()
 constructor(private root: string) {
  mkdirSync(root, {recursive: true})
  this.db = new Database(join(root, 'knowledge-native.sqlite'))
  this.db.pragma('journal_mode = WAL')
  this.db.pragma('synchronous = FULL')
  this.db.pragma('foreign_keys = ON')
  const hadKeywordIndex = !!this.db.prepare('SELECT 1 FROM sqlite_master WHERE name=?').get('native_chunks_fts')
  this.db.exec(`CREATE TABLE IF NOT EXISTS native_sources(id TEXT PRIMARY KEY,generation TEXT NOT NULL,json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS native_chunks(evidence_id TEXT PRIMARY KEY,source_id TEXT NOT NULL REFERENCES native_sources(id) ON DELETE CASCADE,generation_id TEXT NOT NULL,source_revision_id TEXT NOT NULL,chunk_index INTEGER NOT NULL,content TEXT NOT NULL,digest TEXT NOT NULL,locator TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS native_chunk_source ON native_chunks(source_id);
      CREATE TABLE IF NOT EXISTS native_migrations(name TEXT PRIMARY KEY,json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS native_vectors(evidence_id TEXT PRIMARY KEY,vector TEXT NOT NULL);
      CREATE VIRTUAL TABLE IF NOT EXISTS native_chunks_fts USING fts5(content,content='native_chunks',content_rowid='rowid',tokenize='trigram');
      CREATE TRIGGER IF NOT EXISTS native_chunks_ai AFTER INSERT ON native_chunks BEGIN INSERT INTO native_chunks_fts(rowid,content) VALUES(new.rowid,new.content); END;
      CREATE TRIGGER IF NOT EXISTS native_chunks_ad AFTER DELETE ON native_chunks BEGIN INSERT INTO native_chunks_fts(native_chunks_fts,rowid,content) VALUES('delete',old.rowid,old.content); END;`)
  if (!hadKeywordIndex) this.rebuild()
 }
 close() {
  this.db.close()
 }
 private get(id: string): Entry | undefined {
  sourceId.parse(id)
  const row = this.db.prepare('SELECT json FROM native_sources WHERE id=?').get(id) as {json: string} | undefined
  return row ? entrySchema.parse(JSON.parse(row.json)) : undefined
 }
 private view(entry: Entry): KnowledgeEntry {
  const record = entry.classification as
   | {selection?: KnowledgeEntry['classification']; input_digest?: string}
   | undefined
  const validClassification =
   record?.input_digest === sha(JSON.stringify([entry.title, entry.duration || 0, entry.text]))
  return {
   bvid: entry.bvid,
   title: entry.title,
   textLength: entry.textLength,
   savedAt: entry.savedAt,
   folder: entry.folder,
   source_locator: entry.source_locator,
   sourceHash: entry.sourceHash,
   sourceMethod: entry.sourceMethod,
   generation_id: entry.generation_id,
   ...(validClassification ? {classification: record?.selection} : {})
  }
 }
 list() {
  const rows = this.db
   .prepare("SELECT json FROM native_sources ORDER BY json_extract(json,'$.savedAt') DESC,id")
   .all() as {json: string}[]
  return {
   entries: rows.map(row => this.view(entrySchema.parse(JSON.parse(row.json)))),
   stats: {
    totalVideos: rows.length,
    totalChunks: (
     this.db.prepare('SELECT count(*) count FROM native_chunks WHERE chunk_index>=0').get() as {count: number}
    ).count
   },
   retrieval: 'keyword'
  }
 }
 generation(locator: string) {
  const row = this.get('LV' + sha(locator))
  return row?.source_locator === locator ? row.generation_id : null
 }
 read(id: string) {
  const entry = this.get(id)
  if (!entry) throw new Error('资料已删除')
  return {entry: this.view(entry), text: entry.text}
 }
 classificationRead(id: string) {
  const entry = this.get(id)
  if (!entry) throw new Error('资料已删除')
  const token = randomUUID().replaceAll('-', '')
  if (this.drafts.size >= 100) this.drafts.delete(this.drafts.keys().next().value!)
  this.drafts.set(token, {id, generation: entry.generation_id, digest: entry.content_hash})
  return {
   token,
   title: entry.title,
   text: entry.text.slice(0, 120000),
   excerpt: entry.text.length > 120000,
   selection: this.view(entry).classification
  }
 }
 classificationSave(token: string, input: unknown) {
  const selection = selectionSchema.parse(input),
   draft = this.drafts.get(token)
  if (!draft) throw new Error('分类草稿已失效，请重新读取资料')
  const result = this.db
   .transaction(() => {
    const entry = this.get(draft.id)
    if (!entry || entry.generation_id !== draft.generation || entry.content_hash !== draft.digest)
     throw new Error('分类期间资料已改变，请重新读取')
    const classification = {
     selection,
     method: 'manual',
     input_digest: sha(JSON.stringify([entry.title, entry.duration || 0, entry.text])),
     classified_from_generation: entry.generation_id,
     reason: '用户在原生界面核对并保存'
    }
    entry.classification = classification
    this.db.prepare('UPDATE native_sources SET json=? WHERE id=?').run(JSON.stringify(entry), entry.bvid)
    return {
     bvid: entry.bvid,
     classification,
     persisted: true,
     reused: false,
     generation_id: entry.generation_id,
     source_revision_id: entry.source_revision_id
    }
   })
   .immediate()
  this.drafts.delete(token)
  return result
 }
 inventory() {
  return this.db
   .prepare('SELECT * FROM native_chunks WHERE chunk_index>=0 ORDER BY source_id,chunk_index')
   .all() as StoredChunk[]
 }
 inventoryDigest() {
  return sha(JSON.stringify(this.inventory().map(row => [row.evidence_id, row.digest])))
 }
 vectorStatus() {
  const active = this.db.prepare('SELECT json FROM native_migrations WHERE name=?').get('vector-enabled') as
   | {json: string}
   | undefined
  const pointer = this.db.prepare('SELECT json FROM native_migrations WHERE name=?').get('vector-index') as
   | {json: string}
   | undefined
  const state = pointer ? (JSON.parse(pointer.json) as {digest: string; count: number}) : undefined
  return {
   model: 'bge-small-zh-v1-5',
   active: !!active,
   index: !state ? 'not_built' : state.digest === this.inventoryDigest() ? 'ready' : 'stale',
   vector_count: state?.count || 0
  }
 }
 vectorEnable() {
  this.db.prepare('INSERT OR REPLACE INTO native_migrations VALUES(?,?)').run('vector-enabled', 'true')
  return this.vectorStatus()
 }
 publishVectors(expectedDigest: string, rows: {evidenceId: string; vector: number[]}[]) {
  return this.db
   .transaction(() => {
    const inventory = this.inventory()
    if (
     this.inventoryDigest() !== expectedDigest ||
     rows.length !== inventory.length ||
     new Set(rows.map(row => row.evidenceId)).size !== rows.length ||
     rows.some(
      row =>
       !inventory.some(source => source.evidence_id === row.evidenceId) ||
       row.vector.length !== 512 ||
       row.vector.some(number => !Number.isFinite(number))
     )
    )
     throw new Error('建立索引期间资料发生变化，保留原索引')
    this.db.prepare('DELETE FROM native_vectors').run()
    const insert = this.db.prepare('INSERT INTO native_vectors VALUES(?,?)')
    for (const row of rows) insert.run(row.evidenceId, JSON.stringify(row.vector))
    this.db
     .prepare('INSERT OR REPLACE INTO native_migrations VALUES(?,?)')
     .run('vector-index', JSON.stringify({digest: expectedDigest, count: rows.length}))
    return this.vectorStatus()
   })
   .immediate()
 }
 semanticSearch(query: string, vector: number[], ids?: string[]): KnowledgeSearch {
  const lexical = this.search(query, ids),
   status = this.vectorStatus()
  if (!status.active || status.index !== 'ready')
   return {
    ...lexical,
    trace: {...lexical.trace, vector: {state: status.index, note: '资料或语义索引尚未就绪，本次使用当前关键词结果。'}}
   }
  if (vector.length !== 512 || vector.some(value => !Number.isFinite(value))) throw new Error('查询向量无效')
  const scope = ids ? (ids.length ? ' WHERE c.source_id IN (' + ids.map(() => '?').join(',') + ')' : ' WHERE 0') : ''
  const rows = this.db
   .prepare(
    'SELECT v.evidence_id,v.vector,c.source_id FROM native_vectors v JOIN native_chunks c ON c.evidence_id=v.evidence_id' +
     scope
   )
   .all(...(ids || [])) as {evidence_id: string; vector: string; source_id: string}[]
  const semantic = rows
   .map(row => {
    const values = JSON.parse(row.vector) as number[]
    return {
     id: row.evidence_id,
     source_id: row.source_id,
     score: values.reduce((sum, value, index) => sum + value * vector[index], 0)
    }
   })
   .sort((a, b) => b.score - a.score)
   .slice(0, 16)
  const ranked = new Map<string, number>()
  for (const [index, row] of semantic.entries()) ranked.set(row.id, 1 / (60 + index))
  for (const [index, row] of lexical.hits.entries())
   ranked.set(row.evidence_id, (ranked.get(row.evidence_id) || 0) + 1 / (60 + index))
  const sources = new Map(rows.map(row => [row.evidence_id, row.source_id]))
  for (const hit of lexical.hits) sources.set(hit.evidence_id, hit.bvid)
  const rankedHits = [...ranked]
   .sort((a, b) => b[1] - a[1])
   .map(([evidence_id]) => ({evidence_id, source_id: sources.get(evidence_id)}))
   .filter((row): row is {evidence_id: string; source_id: string} => !!row.source_id)
  return {
   hits: this.diverse(rankedHits, 8).map(row => this.citation(row.evidence_id)),
   trace: {
    ...lexical.trace,
    vector: {state: 'ready', note: '本地中文语义与关键词合并检索；优先覆盖不同资料来源，引用已核验。'}
   }
  }
 }
 import(input: KnowledgeImport) {
  const request = z
   .object({
    title: z.string().trim().min(1).max(300),
    text: z.string().min(1).max(2000000),
    locator: z.string().min(1).max(2000),
    sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
    category: z.string().trim().max(100).default(''),
    sourceMethod: z.string().optional(),
    origin: z.enum(['local', 'bilibili-subtitle', 'bilibili-discussion']).default('local'),
    expectedGeneration: z.string().nullable().optional()
   })
   .parse(input)
  if (!request.text.trim()) throw new Error('资料文字为空')
  return this.db
   .transaction(() => {
    const id = 'LV' + sha(request.locator),
     prior = this.get(id),
     textHash = sha(request.text)
    if (
     prior &&
     prior.title === request.title &&
     prior.content_hash === textHash &&
     prior.folder === request.category &&
     prior.sourceHash === request.sourceHash &&
     prior.sourceMethod === request.sourceMethod
    )
     return {entry: this.view(prior), unchanged: true}
    if (input.expectedGeneration !== undefined && request.expectedGeneration !== (prior?.generation_id ?? null))
     throw new Error('来源已有更新，旧同步记录不能覆盖当前版本')
    const entry: Entry = {
     bvid: id,
     title: request.title,
     text: request.text,
     textLength: Array.from(request.text).length,
     savedAt: new Date().toISOString(),
     folder: request.category,
     source_locator: request.locator,
     sourceHash: request.sourceHash,
     sourceMethod: request.sourceMethod,
     generation_id: 'gen_' + randomUUID().replaceAll('-', ''),
     source_revision_id: 'rev_' + randomUUID().replaceAll('-', ''),
     content_hash: textHash,
     source: request.origin,
     source_kind: 'local_text_v1'
    }
    this.publish(entry, this.chunks(entry))
    return {entry: this.view(entry), unchanged: false}
   })
   .immediate()
 }
 private chunks(entry: Entry): StoredChunk[] {
  const points = Array.from(entry.text),
   chunks: StoredChunk[] = []
  for (let offset = 0; offset < points.length; offset += 900) {
   const content = points.slice(offset, offset + 1100).join('')
   const index = chunks.length
   chunks.push({
    evidence_id:
     'evi_' + sha(JSON.stringify(['native-kb-v1', entry.bvid, entry.source_revision_id, index])).slice(0, 32),
    source_id: entry.bvid,
    generation_id: entry.generation_id,
    source_revision_id: entry.source_revision_id,
    chunk_index: index,
    content,
    digest: sha(content),
    locator: entry.source_locator
   })
  }
  return chunks
 }
 private publish(entry: Entry, chunks: StoredChunk[]) {
  this.db
   .prepare('INSERT OR REPLACE INTO native_sources VALUES(?,?,?)')
   .run(entry.bvid, entry.generation_id, JSON.stringify(entry))
  this.db.prepare('DELETE FROM native_chunks WHERE source_id=?').run(entry.bvid)
  const insert = this.db.prepare('INSERT INTO native_chunks VALUES(?,?,?,?,?,?,?,?)')
  for (const row of chunks)
   insert.run(
    row.evidence_id,
    row.source_id,
    row.generation_id,
    row.source_revision_id,
    row.chunk_index,
    row.content,
    row.digest,
    row.locator
   )
 }
 citation(evidenceId: string): KnowledgeHit {
  z.string()
   .regex(/^evi_[a-f0-9]{32}$/)
   .parse(evidenceId)
  const row = this.db
   .prepare('SELECT c.*,s.json FROM native_chunks c JOIN native_sources s ON s.id=c.source_id WHERE c.evidence_id=?')
   .get(evidenceId) as (StoredChunk & {json: string}) | undefined
  if (!row) throw new Error('引用来源已改变，请重新检索')
  const entry = entrySchema.parse(JSON.parse(row.json))
  if (
   entry.generation_id !== row.generation_id ||
   entry.source_revision_id !== row.source_revision_id ||
   sha(row.content) !== row.digest
  )
   throw new Error('引用来源已改变，请重新检索')
  return {
   bvid: row.source_id,
   title: entry.title,
   content: row.content,
   evidence_id: row.evidence_id,
   digest: row.digest,
   generation_id: row.generation_id,
   source_revision_id: row.source_revision_id,
   chunkIndex: row.chunk_index,
   locator: row.locator
  }
 }
 private diverse<T extends {source_id: string}>(hits: T[], limit: number) {
  const bySource = new Map<string, T[]>()
  for (const hit of hits) {
   const bucket = bySource.get(hit.source_id) || []
   bucket.push(hit)
   bySource.set(hit.source_id, bucket)
  }
  const result: T[] = []
  for (let round = 0; result.length < limit; round++) {
   let added = false
   for (const bucket of bySource.values()) {
    const hit = bucket[round]
    if (hit) {
     result.push(hit)
     added = true
     if (result.length === limit) break
    }
   }
   if (!added) break
  }
  return result
 }
 search(query: string, ids?: string[]): KnowledgeSearch {
  z.string().trim().min(1).max(2000).parse(query)
  ids?.forEach(id => sourceId.parse(id))
  const terms = [
   ...new Set(
    query
     .trim()
     .toLowerCase()
     .split(/[\s,，。;；?？!！]+/)
     .flatMap(part => {
      if (!part) return []
      if (!/[\p{Script=Han}]/u.test(part)) return [part]
      const characters = Array.from(part),
       result = [part]
      for (const size of [2, 3])
       for (let index = 0; index + size <= characters.length; index++)
        result.push(characters.slice(index, index + size).join(''))
      return result
     })
   )
  ].slice(0, 30)
  if (!terms.length) return {hits: [], trace: {keyword: {verified: 0}}}
  const longTerms = terms.filter(term => Array.from(term).length >= 3)
  const condition = terms.map(() => 'instr(lower(content),?)>0').join(' OR ')
  const scope = ids ? (ids.length ? ' AND source_id IN (' + ids.map(() => '?').join(',') + ')' : ' AND 0') : ''
  const match = longTerms.map(term => '"' + term.replaceAll('"', '""') + '"').join(' OR ')
  const candidates =
   longTerms.length === terms.length
    ? (this.db
       .prepare(
        `SELECT evidence_id,source_id,content FROM native_chunks WHERE rowid IN (SELECT rowid FROM native_chunks_fts WHERE native_chunks_fts MATCH ?) AND chunk_index>=0${scope} LIMIT 500`
       )
       .all(match, ...(ids || [])) as {evidence_id: string; source_id: string; content: string}[])
    : (this.db
       .prepare(
        `SELECT evidence_id,source_id,content FROM native_chunks WHERE chunk_index>=0 AND (${condition})${scope} LIMIT 500`
       )
       .all(...terms, ...(ids || [])) as {evidence_id: string; source_id: string; content: string}[])
  candidates.sort(
   (a, b) =>
    terms.filter(term => b.content.toLowerCase().includes(term)).length -
    terms.filter(term => a.content.toLowerCase().includes(term)).length
  )
  const hits = this.diverse(candidates, 8).map(row => this.citation(row.evidence_id))
  return {
   hits,
   trace: {keyword: {verified: hits.length}, vector: {state: 'not_built', note: '本次使用当前版本的关键词检索。'}}
  }
 }
 organize(items: {id: string; generation: string}[], target: string) {
  target = z.string().trim().max(100).parse(target)
  if (!items.length || items.length > 5000) throw new Error('请选择需要移动的资料')
  return this.db
   .transaction(() => {
    const seen = new Set<string>(),
     entries = items.map(item => {
      const entry = this.get(item.id)
      if (!entry || seen.has(item.id) || entry.generation_id !== item.generation)
       throw new Error('资料列表已改变，请刷新后重试')
      seen.add(item.id)
      return entry
     })
    let changed = 0,
     unchanged = 0
    for (const entry of entries) {
     if (entry.folder === target) {
      unchanged++
      continue
     }
     entry.folder = target
     this.db.prepare('UPDATE native_sources SET json=? WHERE id=?').run(JSON.stringify(entry), entry.bvid)
     changed++
    }
    return {changed, unchanged, failures: []}
   })
   .immediate()
 }
 delete(id: string, generation: string) {
  sourceId.parse(id)
  z.string().min(1).parse(generation)
  return this.db
   .transaction(() => {
    const entry = this.get(id)
    if (!entry || entry.generation_id !== generation) throw new Error('资料版本已更新，请刷新后再确认删除')
    const changed = this.db
     .prepare('DELETE FROM native_sources WHERE id=? AND generation=?')
     .run(id, generation).changes
    if (changed !== 1) throw new Error('资料版本已更新，请刷新后再确认删除')
    return {deleted: true, generation_id: generation}
   })
   .immediate()
 }
 rebuild() {
  this.db.prepare("INSERT INTO native_chunks_fts(native_chunks_fts) VALUES('rebuild')").run()
  this.db.exec('REINDEX native_chunk_source')
  return {rebuilt: true, ...this.list().stats}
 }

 async importLegacyBaseline() {
  const prior = this.db.prepare('SELECT json FROM native_migrations WHERE name=?').get('legacy-baseline-v1') as
   | {json: string}
   | undefined
  if (prior) return JSON.parse(prior.json) as {imported: number; citations: number}
  const directory = join(this.root, 'knowledge_base')
  for (const name of ['.bilisum-publish-journal', '.bilisum-delete-journal']) {
   try {
    if ((await readdir(join(directory, name))).length) throw new Error('旧知识库有未完成发布，需恢复后再迁移')
   } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
   }
  }
  let legacy: Database.Database
  try {
   await lstat(join(this.root, 'knowledge.sqlite'))
   legacy = new Database(join(this.root, 'knowledge.sqlite'), {readonly: true, fileMustExist: true})
  } catch (error) {
   if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {imported: 0, citations: 0}
   throw error
  }
  const snapshots: {entry: Entry; chunks: StoredChunk[]}[] = []
  const observed = new Map<string, string>()
  try {
   const catalog = legacy.prepare('SELECT * FROM kb_generation_catalog').all() as {
    source_id: string
    kb_root_id: string
    generation_id: string
    source_revision_id: string
    source_kind: string
    source_locator: string
    entry_filename: string
    content_hash: string
    published_at: string
   }[]
   const read = async (folder: string, name: string) => {
    if (basename(name) !== name || name.includes('\\') || name.includes(':')) throw new Error('旧知识库来源路径无效')
    const path = join(folder, name),
     info = await lstat(path)
    if (!info.isFile() || info.isSymbolicLink() || info.size > 12000000) throw new Error('旧知识库文件不可读取')
    const raw = await readFile(path, 'utf8')
    observed.set(path, sha(raw))
    return JSON.parse(raw) as Record<string, unknown>
   }
   for (const published of catalog) {
    if (
     legacy
      .prepare('SELECT 1 FROM kb_delete_tombstones WHERE kb_root_id=? AND source_id=?')
      .get(published.kb_root_id, published.source_id)
    )
     continue
    const entry = entrySchema.parse(await read(directory, published.entry_filename))
    if (
     entry.bvid !== published.source_id ||
     entry.generation_id !== published.generation_id ||
     entry.source_revision_id !== published.source_revision_id ||
     entry.kb_root_id !== published.kb_root_id ||
     entry.source_locator !== published.source_locator ||
     entry.source_kind !== published.source_kind ||
     entry.content_hash !== published.content_hash ||
     sha(entry.text) !== published.content_hash ||
     entry.savedAt !== published.published_at ||
     Array.from(entry.text).length !== entry.textLength
    )
     throw new Error('旧知识库来源与发布记录不一致，请先核验')
    const members = legacy
     .prepare(
      'SELECT * FROM kb_evidence_membership WHERE source_id=? AND kb_root_id=? AND retired=0 AND generation_id=?'
     )
     .all(entry.bvid, published.kb_root_id, entry.generation_id) as {
     evidence_id: string
     chunk_index: number
     content_digest: string
     source_revision_id: string
    }[]
    const chunks: StoredChunk[] = []
    for (const member of members) {
     const payload = await read(
      join(directory, 'chunks'),
      member.chunk_index === -1 ? `${entry.bvid}_meta.json` : `${entry.bvid}_${member.chunk_index}.json`
     )
     const evidenceHash = sha(
      JSON.stringify(['evi', published.kb_root_id, entry.source_revision_id, {chunk_index: member.chunk_index}])
     ).slice(0, 32)
     if (
      typeof payload.content !== 'string' ||
      payload.evidence_id !== member.evidence_id ||
      member.evidence_id !== 'evi_' + evidenceHash ||
      payload.bvid !== entry.bvid ||
      payload.generation_id !== entry.generation_id ||
      payload.source_revision_id !== entry.source_revision_id ||
      member.source_revision_id !== entry.source_revision_id ||
      payload.chunkIndex !== member.chunk_index ||
      sha(payload.content) !== member.content_digest ||
      payload.title !== entry.title ||
      payload.source_locator !== entry.source_locator ||
      (member.chunk_index === -1
       ? payload.content !== `视频标题：${entry.title}`
       : !entry.text.includes(payload.content))
     )
      throw new Error('旧引用证据不完整，请先核验')
     chunks.push({
      evidence_id: member.evidence_id,
      source_id: entry.bvid,
      generation_id: entry.generation_id,
      source_revision_id: entry.source_revision_id,
      chunk_index: member.chunk_index,
      content: payload.content,
      digest: member.content_digest,
      locator: entry.source_locator
     })
    }
    // No old citation is fabricated; uncited text still receives fresh native
    // evidence so that local search works for earlier unindexed entries.
    if (!chunks.some(chunk => chunk.chunk_index >= 0)) chunks.push(...this.chunks(entry))
    snapshots.push({entry, chunks})
   }
   for (const [path, hash] of observed)
    if (sha(await readFile(path, 'utf8')) !== hash) throw new Error('迁移期间旧知识库资料已改变，请重新读取')
   if (JSON.stringify(legacy.prepare('SELECT * FROM kb_generation_catalog').all()) !== JSON.stringify(catalog))
    throw new Error('迁移期间旧知识库版本已改变，请重新读取')
   for (const name of ['.bilisum-publish-journal', '.bilisum-delete-journal']) {
    try {
     if ((await readdir(join(directory, name))).length) throw new Error('迁移期间旧知识库开始发布，请恢复后重试')
    } catch (error) {
     if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
   }
  } finally {
   legacy.close()
  }
  const result = {imported: snapshots.length, citations: snapshots.reduce((sum, item) => sum + item.chunks.length, 0)}
  return this.db
   .transaction(() => {
    for (const snapshot of snapshots) {
     if (this.get(snapshot.entry.bvid)) throw new Error('已有原生资料，不能覆盖为旧版本')
     this.publish(snapshot.entry, snapshot.chunks)
    }
    this.db.prepare('INSERT INTO native_migrations VALUES(?,?)').run('legacy-baseline-v1', JSON.stringify(result))
    return result
   })
   .immediate()
 }
}
