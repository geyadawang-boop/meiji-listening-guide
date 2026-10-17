export interface KnowledgeEntry {
 bvid: string
 title: string
 textLength: number
 savedAt: string
 folder: string
 source_locator: string
 sourceHash: string
 sourceMethod?: string
 generation_id: string
 classification?: {
  type: string
  topic: string
  difficulty: string
  language: string
  duration: string
  subtopics: string[]
  keywords: string[]
 }
}
export interface KnowledgeHit {
 bvid: string
 title: string
 content: string
 evidence_id: string
 digest: string
 generation_id: string
 source_revision_id: string
 chunkIndex: number
 locator: string
}
export interface KnowledgeSearch {
 hits: KnowledgeHit[]
 trace: {vector?: {state: string; note?: string}; keyword?: {verified: number}; coverage?: {instruction: string}}
}
export interface KnowledgeList {
 entries: KnowledgeEntry[]
 stats: {totalVideos: number; totalChunks: number}
 retrieval: string
}
