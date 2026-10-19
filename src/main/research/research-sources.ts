import {createHash} from 'node:crypto'
import {z} from 'zod'
import {NativeKnowledgeStore} from '@main/knowledge/knowledge-store'
import type {KnowledgeHit} from '@shared/knowledge'
const sourceId = z.string().regex(/^(?:BV[A-Za-z0-9]{10}|LV(?:[a-f0-9]{8}|[a-f0-9]{64}))$/)
const bindingSchema = z.object({
 kb_root_id: z.string(),
 bvid: sourceId,
 generation_id: z.string(),
 source_revision_id: z.string(),
 evidence_id: z.string().regex(/^evi_[a-f0-9]{32}$/),
 chunkIndex: z.number().int(),
 digest: z.string().regex(/^[a-f0-9]{64}$/)
})
export type ResearchBinding = z.infer<typeof bindingSchema>
export type ResearchSource = {
 binding: ResearchBinding
 title: string
 locator: string
 text: string
 sourceHash: string
 generation: string
 excerpt: boolean
 quote: string
}
const hash = (text: string) => createHash('sha256').update(text).digest('hex')
/** Research uses the same native source generations and evidence membership as the knowledge UI. */
export class NativeResearchSources {
 constructor(
  private knowledge: NativeKnowledgeStore,
  private rootId: string
 ) {}
 private binding(hit: KnowledgeHit): ResearchBinding {
  return {
   kb_root_id: this.rootId,
   bvid: hit.bvid,
   generation_id: hit.generation_id,
   source_revision_id: hit.source_revision_id,
   evidence_id: hit.evidence_id,
   chunkIndex: hit.chunkIndex,
   digest: hit.digest
  }
 }
 catalog(query = '', offset = 0) {
  z.string().max(200).parse(query)
  z.number().int().min(0).max(100000).parse(offset)
  const entries = this.knowledge
   .list()
   .entries.filter(entry =>
    (entry.title + ' ' + entry.folder + ' ' + entry.source_locator).toLowerCase().includes(query.trim().toLowerCase())
   )
  const chunks = this.knowledge.inventory(),
   bySource = new Map<string, string>()
  for (const chunk of chunks) if (!bySource.has(chunk.source_id)) bySource.set(chunk.source_id, chunk.evidence_id)
  let unavailable = 0
  const selected = entries.slice(offset, offset + 12).flatMap(entry => {
   const id = bySource.get(entry.bvid)
   if (!id) {
    unavailable++
    return []
   }
   const hit = this.knowledge.citation(id)
   return [
    {binding: this.binding(hit), title: entry.title, kind: entry.sourceMethod || '知识库资料', category: entry.folder}
   ]
  })
  return {
   kb_root_id: this.rootId,
   items: selected,
   next_offset: offset + 12 < entries.length ? offset + 12 : null,
   total: entries.length,
   unavailable
  }
 }
 read(input: unknown): ResearchSource {
  const binding = bindingSchema.parse(input)
  if (binding.kb_root_id !== this.rootId) throw new Error('所选研究资料属于另一资料库')
  const hit = this.knowledge.citation(binding.evidence_id)
  if (JSON.stringify(this.binding(hit)) !== JSON.stringify(binding))
   throw new Error('所选资料或引用版本已改变，请重新选择')
  const source = this.knowledge.read(binding.bvid)
  if (source.entry.generation_id !== binding.generation_id || !source.text.includes(hit.content))
   throw new Error('引用不属于当前资料原文')
  return {
   binding,
   title: source.entry.title,
   locator: source.entry.source_locator,
   text: source.text,
   sourceHash: hash(source.text),
   generation: source.entry.generation_id,
   excerpt: false,
   quote: hit.content
  }
 }
 verify(sources: ResearchSource[]) {
  for (const source of sources) {
   const current = this.read(source.binding)
   if (
    current.sourceHash !== source.sourceHash ||
    current.text !== source.text ||
    current.locator !== source.locator ||
    current.title !== source.title
   )
    throw new Error('研究期间来源已改变，结果未发布')
  }
 }
 search(question: string, ids?: string[]) {
  const result = this.knowledge.search(question, ids),
   seen = new Set<string>()
  return result.hits.flatMap(hit => {
   if (seen.has(hit.bvid)) return []
   seen.add(hit.bvid)
   return [this.read(this.binding(hit))]
  })
 }
}
