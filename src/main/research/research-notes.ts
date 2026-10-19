import {createHash, randomUUID} from 'node:crypto'
import {mkdir, lstat, readFile, realpath, writeFile} from 'node:fs/promises'
import {join, resolve} from 'node:path'
import {z} from 'zod'
import {NativeResearchStore} from '@main/research/research-store'
import {NativeResearchEngine} from '@main/research/research-engine'
const hash = (text: string) => createHash('sha256').update(text).digest('hex'),
 op = z.string().regex(/^[a-f0-9]{32}$/),
 sha = z.string().regex(/^[a-f0-9]{64}$/)
type Note = {
 receipt: {note_id: string; title: string; body_sha256: string; created_at: string}
 markdown: string
 lifecycle: {revision: number; state: 'active' | 'archived'}
 task_id: string | null
 taskHash: string | null
 parent_note_id: string | null
 sourceDigest: string | null
 legacy?: {referenceStatus: string}
}
export class NativeResearchNotes {
 constructor(
  private store: NativeResearchStore,
  private engine: NativeResearchEngine,
  private root: string
 ) {}
 preview(id: string) {
  const task = this.engine.verifyResult(id),
   sources = task.sources.map(source => ({id: source.source_id, binding: source.binding, hash: source.sourceHash})),
   sourceDigest = hash(JSON.stringify(sources)),
   markdown =
    '# ' +
    task.question +
    '\n\n' +
    task.note +
    '\n\n## 范围与限制\n\n' +
    task.limitations +
    '\n\n## 来源版本\n\n' +
    task.sources
     .map(
      source =>
       `- [${source.source_id}] ${source.title}\n  来源：${source.url}\n  代际：${source.binding?.generation_id || 'external-snapshot'}\n  原文 SHA256：${source.sourceHash}`
     )
     .join('\n') +
    '\n'
  return {
   kb_root_id: this.store.rootId,
   task_id: id,
   note_sha256: hash(markdown),
   sources_sha256: sourceDigest,
   markdown
  }
 }
 save(id: string, expected: unknown) {
  const value = z.object({kb_root_id: z.string(), note_sha256: sha, sources_sha256: sha}).parse(expected),
   preview = this.preview(id)
  if (
   value.kb_root_id !== preview.kb_root_id ||
   value.note_sha256 !== preview.note_sha256 ||
   value.sources_sha256 !== preview.sources_sha256
  )
   throw new Error('预览之后研究内容或来源已改变，请重新预览')
  const operation = hash(JSON.stringify(['save-research-note', id, value])).slice(0, 32)
  const result = this.store.operation(operation, {id, value}, () => {
   const task = this.engine.verifyResult(id),
    note: Note = {
     receipt: {
      note_id: randomUUID().replaceAll('-', ''),
      title: task.question,
      body_sha256: preview.note_sha256,
      created_at: new Date().toISOString()
     },
     markdown: preview.markdown,
     lifecycle: {revision: 0, state: 'active'},
     task_id: id,
     taskHash: task.answerHash!,
     parent_note_id: null,
     sourceDigest: preview.sources_sha256
    }
   this.store.put('note', note.receipt.note_id, 0, note)
   return {id: note.receipt.note_id}
  })
  return this.read(result.id)
 }
 read(id: string): Note {
  op.parse(id)
  const note = this.store.read<Note>('note', id)
  if (note.receipt.note_id !== id || note.receipt.body_sha256 !== hash(note.markdown))
   throw new Error('笔记正文与保存回执不一致，原记录保留')
  return note
 }
 list(query = '', state = 'active', offset = 0) {
  z.string().max(200).parse(query)
  z.enum(['active', 'archived', 'all']).parse(state)
  z.number().int().min(0).max(100000).parse(offset)
  const rows = this.store
   .list<Note>('note')
   .filter(
    note =>
     (state === 'all' || note.lifecycle.state === state) &&
     (note.receipt.title + '\n' + note.markdown).toLowerCase().includes(query.toLowerCase())
   )
   .sort((a, b) => b.receipt.created_at.localeCompare(a.receipt.created_at))
  return {
   entries: rows.slice(offset, offset + 25).map(row => this.read(row.receipt.note_id).receipt),
   has_more: offset + 25 < rows.length
  }
 }
 revise(input: unknown) {
  const value = z
   .object({
    action: z.literal('manual_revision'),
    schema_version: z.literal('1'),
    operation_id: op,
    parent_note_id: op,
    parent_body_sha256: sha,
    markdown: z.string().trim().min(1).max(40000)
   })
   .parse(input)
  const result = this.store.operation(value.operation_id, value, () => {
   const prior = this.read(value.parent_note_id)
   if (prior.receipt.body_sha256 !== value.parent_body_sha256 || prior.lifecycle.state !== 'active')
    throw new Error('原笔记已改变或归档，修订未保存')
   const next: Note = {
    ...prior,
    receipt: {
     ...prior.receipt,
     note_id: randomUUID().replaceAll('-', ''),
     body_sha256: hash(value.markdown),
     created_at: new Date().toISOString()
    },
    markdown: value.markdown,
    lifecycle: {revision: 0, state: 'active'},
    parent_note_id: prior.receipt.note_id
   }
   this.store.put('note', next.receipt.note_id, 0, next)
   return {id: next.receipt.note_id}
  })
  return this.read(result.id)
 }
 lifecycle(input: unknown) {
  const value = z
   .object({
    note_id: op,
    body_sha256: sha,
    expected_revision: z.number().int().nonnegative(),
    operation_id: op,
    action: z.enum(['archive', 'restore'])
   })
   .parse(input)
  return this.store.operation(value.operation_id, value, () => {
   const note = this.read(value.note_id)
   if (note.receipt.body_sha256 !== value.body_sha256 || note.lifecycle.revision !== value.expected_revision)
    throw new Error('笔记状态已改变，请刷新')
   const state = value.action === 'archive' ? 'archived' : 'active'
   if (note.lifecycle.state === state) throw new Error('笔记已经处于所选状态')
   const next = {...note, lifecycle: {revision: note.lifecycle.revision + 1, state}} as Note
   this.store.put('note', note.receipt.note_id, next.lifecycle.revision, next)
   return next
  })
 }
 source(id: string) {
  const note = this.read(id)
  if (!note.task_id) return {status: 'legacy_not_revalidated', manualRevision: !!note.parent_note_id}
  try {
   const task = this.engine.verifyResult(note.task_id)
   return {
    status: task.answerHash === note.taskHash ? 'research_current' : 'research_changed',
    manualRevision: !!note.parent_note_id
   }
  } catch {
   return {status: 'research_changed', manualRevision: !!note.parent_note_id}
  }
 }
 async export(id: string) {
  const note = this.read(id),
   directory = resolve(this.root, '笔记导出')
  await mkdir(directory, {recursive: true})
  if (
   (await lstat(directory)).isSymbolicLink() ||
   resolve(await realpath(directory)).toLowerCase() !== directory.toLowerCase()
  )
   throw new Error('笔记导出目录无效')
  const path = join(directory, note.receipt.note_id + '.md')
  try {
   await writeFile(path, note.markdown, {flag: 'wx'})
  } catch (error) {
   if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
   const item = await lstat(path)
   if (!item.isFile() || item.isSymbolicLink()) throw new Error('笔记导出目标无效')
  }
  if (hash(await readFile(path, 'utf8')) !== note.receipt.body_sha256) throw new Error('导出文件已被修改，保留当前文件')
  return path
 }
}
