import {lstat, mkdir, readFile, realpath, writeFile} from 'node:fs/promises'
import {join, resolve} from 'node:path'
import {createHash} from 'node:crypto'
import {z} from 'zod'
import {NativeResearchStore} from '@main/research/research-store'
import {NativeKnowledgeStore} from '@main/knowledge/knowledge-store'
import {NativeResearchSources} from '@main/research/research-sources'
import {NativeResearchExtensions} from '@main/research/research-extensions'
import {NativeResearchEngine, type ResearchModel} from '@main/research/research-engine'
import {NativeResearchNotes} from '@main/research/research-notes'
import {NativeResearchWorkflows} from '@main/research/research-workflow'
import {NativeResearchMcp} from '@main/research/research-mcp'
import {NativeImService} from '@main/im/core/im-service'
import type {MediaCrypt} from '@main/security/worker-crypt'
const op = z.string().regex(/^[a-f0-9]{32}$/)
/** Staged native tools dispatcher. Unimplemented channels are errors, never empty success receipts. */
export class NativeResearchService {
 private store: NativeResearchStore
 private knowledge: NativeKnowledgeStore
 private sources: NativeResearchSources
 private extensions: NativeResearchExtensions
 private engine: NativeResearchEngine
 private notes: NativeResearchNotes
 private workflows: NativeResearchWorkflows
 private mcp: NativeResearchMcp
 private im: NativeImService | undefined
 private connection = ''
 private ready: Promise<unknown> | undefined
 private closed = false
 constructor(
  private root: string,
  private model: ResearchModel,
  private resources?: string,
  private crypt?: MediaCrypt
 ) {
  this.store = new NativeResearchStore(root)
  this.knowledge = new NativeKnowledgeStore(root)
  this.sources = new NativeResearchSources(this.knowledge, this.store.rootId)
  this.extensions = new NativeResearchExtensions(this.store)
  this.mcp = new NativeResearchMcp(this.store)
  this.engine = new NativeResearchEngine(
   this.store,
   this.sources,
   model,
   () => this.connection,
   this.extensions,
   this.mcp
  )
  this.notes = new NativeResearchNotes(this.store, this.engine, root)
  this.workflows = new NativeResearchWorkflows(this.store, this.sources, this.engine)
 }
 async execute(action: string, input: unknown = {}): Promise<unknown> {
  if (this.closed) throw new Error('研究后台已关闭')
  await (this.ready ??= this.knowledge.importLegacyBaseline().then(() => this.store.baselineLegacy()))
  const args = z.record(z.string(), z.unknown()).parse(input)
  switch (action) {
   case 'im': {
    if (!this.resources) throw new Error('通讯组件资源路径缺失')
    this.im ??= new NativeImService(
     this.root,
     this.resources,
     undefined,
     this.model,
     {
      id: this.store.rootId,
      search: query => this.sources.search(query),
      verify: sources => this.sources.verify(sources)
     },
     this.crypt
    )
    return this.im.execute(z.string().parse(args.action), args.value || {}, this.connection)
   }
   case 'configure': {
    const value = z.object({connection: z.string().min(1).max(200), model: z.string().max(200)}).parse(args)
    if (this.connection && this.connection !== value.connection)
     for (const task of this.engine.list()) if (task.status === 'running') this.engine.stop(task.task_id)
    this.connection = value.connection
    this.im?.configure(value.connection)
    return true
   }
   case 'materials':
    return this.sources.catalog(
     z
      .string()
      .max(200)
      .parse(args.query || ''),
     z
      .number()
      .int()
      .parse(args.offset || 0)
    )
   case 'conversations':
    return this.store.conversations(
     z
      .number()
      .int()
      .parse(args.offset || 0)
    )
   case 'conversation-create':
    return this.store.createConversation(z.string().parse(args.title))
   case 'conversation-read':
    return this.store.conversation(z.string().parse(args.id))
   case 'conversation-organization': {
    const value = this.store.conversation(z.string().parse(args.id))
    return {revision: value.revision, pinned: value.pinned, title: value.title}
   }
   case 'conversation-organize':
    return this.store.organizeConversation(args)
   case 'memories':
    return this.store.memories()
   case 'memory-change':
    return this.store.changeMemory(args.value, args.deleting === true)
   case 'memory-accept':
    return this.engine.acceptMemory(op.parse(args.id), args.value)
   case 'skill-markdown':
    return this.extensions.parseMarkdown(z.string().parse(args.text))
   case 'extension-change':
    return this.extensions.change(args)
   case 'mcp-change':
    return this.mcp.change(args)
   case 'mcp-discover':
    return this.mcp.discover(args, AbortSignal.timeout(120000))
   case 'agent-create':
    return this.engine.create(args)
   case 'agent-read': {
    const id = op.parse(args.id)
    return this.store.legacyResearchTasks().find(task => task.task_id === id) || this.engine.read(id)
   }
   case 'agent-stop':
    return this.engine.stop(op.parse(args.id))
   case 'agent-export': {
    const task = this.engine.verifyResult(op.parse(args.id)),
     text =
      '# ' +
      task.question +
      '\n\n' +
      task.note +
      '\n\n## 范围与限制\n\n' +
      task.limitations +
      '\n\n## 来源\n\n' +
      task.sources
       .filter(source => source.read)
       .map(source => `### ${source.source_id} · ${source.title}\n${source.url}\n\n${source.text}`)
       .join('\n\n')
    return this.exportFile('研究成果', task.task_id + '.md', text)
   }
   case 'note-preview':
    return this.notes.preview(op.parse(args.id))
   case 'note-save':
    return this.notes.save(op.parse(args.id), args.expected)
   case 'notes':
    return this.notes.list(
     z.string().parse(args.query || ''),
     z.string().parse(args.state || 'active'),
     z
      .number()
      .int()
      .parse(args.offset || 0)
    )
   case 'note-read':
    return this.notes.read(op.parse(args.id))
   case 'note-revise':
    return this.notes.revise(args.value)
   case 'note-lifecycle':
    return this.notes.lifecycle(args.value)
   case 'note-source':
    return this.notes.source(op.parse(args.id))
   case 'note-export':
    return this.notes.export(op.parse(args.id))
   case 'workflow-create':
    return this.workflows.create(args)
   case 'workflow-action': {
    if (this.store.legacyWorkflows().some(flow => flow.workflow_id === args.id))
     throw new Error('旧工作流需要重新选择当前资料建立新任务，不会重放旧请求')
    return this.workflows.action(args)
   }
   case 'workflow-export': {
    const id = op.parse(args.id),
     old = this.store.legacyWorkflows().find(flow => flow.workflow_id === id)
    if (old)
     return this.exportFile(
      '研究成果',
      old.workflow_id + '-工作流.md',
      '# ' +
       old.question +
       '\n\n> 历史工作流导出（未重新核验）\n> ' +
       old.notice +
       '\n\n' +
       old.steps
        .map(
         step =>
          '## ' +
          step.name +
          '\n\n保存状态：' +
          step.status +
          '；正文哈希：' +
          (step.hash_verified ? '与保存值一致' : '未确认') +
          '\n\n' +
          step.answer
        )
        .join('\n\n')
     )
    const flow = this.workflows.verify(id),
     text =
      '# ' +
      flow.question +
      '\n\n' +
      flow.steps.map(step => '## ' + step.name + '\n\n' + step.answer).join('\n\n') +
      '\n\n## 来源版本\n\n```json\n' +
      JSON.stringify(flow.bindings, null, 2) +
      '\n```\n'
    return this.exportFile('研究成果', flow.workflow_id + '-工作流.md', text)
   }
   case 'overview':
    return {
     root: this.store.rootId,
     extensions: this.extensions.list(),
     mcp: this.mcp.list(),
     tasks: [...this.engine.list(), ...this.store.legacyResearchTasks()],
     workflows: [...this.workflows.list(), ...this.store.legacyWorkflows()],
     migration: {
      runtimeLanguage: 'typescript',
      legacyRuntimeRequired: false,
      externalAcceptance: '详见版本说明；本地模拟不代表所有真实账号和站点已验收'
     },
     runtime: {
      dependencies: [{id: 'typescript', label: '原生 TypeScript 研究后台', state: 'detected', version: 'native-v1'}]
     }
    }
   default:
    throw new Error('此研究工具尚未完成原生适配：' + action)
  }
 }
 private async exportFile(folder: string, name: string, text: string) {
  if (!/^[a-f0-9]{32}(?:-工作流)?\.md$/.test(name) || !['研究成果'].includes(folder))
   throw new Error('研究导出名称无效')
  const directory = resolve(this.root, folder)
  await mkdir(directory, {recursive: true})
  if (
   (await lstat(directory)).isSymbolicLink() ||
   resolve(await realpath(directory)).toLowerCase() !== directory.toLowerCase()
  )
   throw new Error('研究导出目录无效')
  const path = join(directory, name)
  try {
   await writeFile(path, text, {flag: 'wx'})
  } catch (error) {
   if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
   const item = await lstat(path)
   if (!item.isFile() || item.isSymbolicLink()) throw new Error('研究导出文件无效')
  }
  const hash = (value: string) => createHash('sha256').update(value).digest('hex')
  if (hash(await readFile(path, 'utf8')) !== hash(text)) throw new Error('已有研究成果被修改，保留当前文件')
  return path
 }
 async dispose() {
  if (this.closed) return
  this.closed = true
  await this.workflows.dispose()
  await this.engine.dispose()
  await this.im?.dispose()
  this.knowledge.close()
  this.store.close()
 }
}
