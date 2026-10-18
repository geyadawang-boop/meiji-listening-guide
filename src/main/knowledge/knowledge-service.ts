import {existsSync} from 'node:fs'
import {join} from 'node:path'
import {z} from 'zod'
import {KnowledgeEmbedding} from '@main/knowledge/knowledge-embedding'
import {NativeKnowledgeStore, nativeClassificationOptions} from '@main/knowledge/knowledge-store'

export class NativeKnowledgeService {
 private store: NativeKnowledgeStore
 private embedding: KnowledgeEmbedding
 private baseline: Promise<unknown>
 private modelPath: string
 constructor(
  resources: string,
  root: string,
  private progress: (message: string) => void = () => {}
 ) {
  this.store = new NativeKnowledgeStore(root)
  this.modelPath = join(resources, 'knowledge/onnx-bge')
  this.embedding = new KnowledgeEmbedding(this.modelPath)
  this.baseline = this.store.importLegacyBaseline()
  // Keep a failed baseline available to the caller without an unhandled rejection.
  void this.baseline.catch(() => undefined)
 }
 async execute(action: string, input: unknown = {}): Promise<unknown> {
  await this.baseline
  const args = z.record(z.string(), z.unknown()).parse(input)
  switch (action) {
   case 'list':
    return this.store.list()
   case 'generation':
    return this.store.generation(z.string().min(1).max(2000).parse(args.locator))
   case 'import':
    return this.store.import(
     z
      .object({
       title: z.string(),
       text: z.string(),
       locator: z.string(),
       sourceHash: z.string(),
       category: z.string().optional(),
       sourceMethod: z.string().optional(),
       origin: z.string().optional(),
       expectedGeneration: z.string().nullable().optional()
      })
      .parse(args)
    )
   case 'read':
    return this.store.read(z.string().parse(args.id))
   case 'citation':
    return this.store.citation(z.string().parse(args.evidenceId))
   case 'delete':
    return this.store.delete(z.string().parse(args.id), z.string().min(1).parse(args.generation))
   case 'organize': {
    const value = z
     .object({items: z.array(z.object({id: z.string(), generation: z.string()})), target: z.string()})
     .parse(args)
    return this.store.organize(value.items, value.target)
   }
   case 'classification-options':
    return nativeClassificationOptions
   case 'classification-read':
    return this.store.classificationRead(z.string().parse(args.id))
   case 'classification-save':
    return this.store.classificationSave(z.string().parse(args.token), args.selection)
   case 'vector-status':
    return {...this.store.vectorStatus(), bundled: existsSync(join(this.modelPath, 'acquisition.json'))}
   case 'vector-enable':
    await this.embedding.load()
    return {...this.store.vectorEnable(), bundled: true}
   case 'vector-rebuild': {
    if (!this.store.vectorStatus().active) throw new Error('请先启用本地语义模型')
    const digest = this.store.inventoryDigest(),
     rows = this.store.inventory(),
     vectors: {evidenceId: string; vector: number[]}[] = []
    for (const [index, row] of rows.entries()) {
     this.progress(`正在建立语义索引：${index + 1}/${rows.length}`)
     vectors.push({evidenceId: row.evidence_id, vector: await this.embedding.encode(row.content)})
    }
    const status = this.store.publishVectors(digest, vectors)
    return {report: {indexed: rows.length}, status: {...status, bundled: true}}
   }
   case 'search': {
    const query = z.string().trim().min(1).max(2000).parse(args.query),
     ids = args.ids === undefined ? undefined : z.array(z.string()).max(5000).parse(args.ids)
    const status = this.store.vectorStatus()
    if (status.active && status.index === 'ready')
     return this.store.semanticSearch(query, await this.embedding.encode(query, true), ids)
    const result = this.store.search(query, ids)
    result.trace.vector = {
     state: status.index,
     note:
      status.index === 'stale'
       ? '资料已更新，请重建语义索引；本次使用当前版本关键词结果。'
       : '本次使用关键词检索，可启用本地语义模型并建立索引。'
    }
    return result
   }
   case 'rebuild':
    return this.store.rebuild()
   default:
    throw new Error('未知知识库操作')
  }
 }
 async dispose() {
  await this.embedding.dispose()
  this.store.close()
 }
}
