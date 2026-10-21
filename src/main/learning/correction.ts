import type {CorrectionMode} from '@shared/correction'
import type {Segment} from '@shared/types'
import {z} from 'zod'

const correctionRows = z.array(
 z.object({
  id: z.number().int(),
  text: z
   .string()
   .min(1)
   .refine(text => !!text.trim()),
  uncertain: z.boolean(),
  reason: z.string()
 })
)
export function validateCorrectionRows(value: unknown, batch: CorrectionBatch) {
 const rows = correctionRows.parse(value)
 if (rows.length !== batch.rows.length || rows.some((row, index) => row.id !== batch.start + index))
  throw new Error('校订结果缺少原文或次序变化，已拒绝保存')
 return rows
}

export interface CorrectionBatch {
 start: number
 rows: Segment[]
}
export function planCorrection(segments: Segment[], start: number, outputTokens = 8192): CorrectionBatch[] {
 const batches: CorrectionBatch[] = []
 const budget = Math.floor(outputTokens * 0.8)
 for (let i = start; i < segments.length; ) {
  const batch: CorrectionBatch = {start: i, rows: []}
  let output = 2,
   input = 0
  while (i < segments.length && batch.rows.length < 96) {
   const row = segments[i],
    chars = JSON.stringify(row.text).length
   // Conservative estimate (not a tokenizer): reserve JSON, text changes and short reasons.
   const estimate = Math.ceil(Buffer.byteLength(JSON.stringify(row.text), 'utf8') / 2) + 96
   if (chars > 6000) throw new Error(`第 ${i + 1} 条原文超过 6000 字符单批输入预算，请拆分过长原文后重试；原文未截断`)
   // A single row that exceeds the estimated output budget still gets its own batch;
   // aborting the whole lecture during planning is worse than letting the request try.
   if (batch.rows.length && (output + estimate > budget || input + chars > 6000)) break
   batch.rows.push(row)
   input += chars
   output += estimate
   i++
  }
  batches.push(batch)
 }
 return batches
}

export function validCorrectionPrefix(saved: Segment[], source: Segment[]) {
 return (
  saved.length <= source.length &&
  saved.every(
   (row, i) =>
    row &&
    typeof row.text === 'string' &&
    !!row.text.trim() &&
    row.originalText === source[i].text &&
    row.start === source[i].start &&
    row.end === source[i].end &&
    typeof row.uncertain === 'boolean' &&
    typeof row.reason === 'string'
  )
 )
}

export interface CorrectionCheckpoint {
 fingerprint: string
 total: number
 segments: Segment[]
}

export function resumableCorrection(
 checkpoint: CorrectionCheckpoint | undefined,
 fingerprint: string,
 source: Segment[]
) {
 return checkpoint &&
  checkpoint.fingerprint === fingerprint &&
  checkpoint.total === source.length &&
  validCorrectionPrefix(checkpoint.segments, source)
  ? checkpoint.segments
  : undefined
}

export function correctionNeedsVision(contexts: {images: {label: string; url: string}[]}[], visionModel?: string) {
 return contexts.some(context => context.images.length > 0) && !visionModel?.trim()
}

const grams = (value: string) => {
 const tokens = new Set<string>()
 for (const term of value
  .toLowerCase()
  .replace(/[^\p{Script=Han}a-z0-9]+/giu, ' ')
  .split(/\s+/)
  .filter(Boolean)) {
  if (/\p{Script=Han}/u.test(term)) {
   for (const size of [2, 3]) for (let i = 0; i + size <= term.length; i++) tokens.add(term.slice(i, i + size))
  } else if (term.length > 1) tokens.add(term)
 }
 return tokens
}

// Index once per lecture; both text and image selection share the same page evidence.
export function correctionContext(ppt: string, images: {label: string; url: string}[]) {
 const matches = [...ppt.matchAll(/\[第\s*(\d+)\s*页\]\n([\s\S]*?)(?=\n\s*\[第\s*\d+\s*页\]|$)/g)]
 const pages = matches.length
  ? matches.map(m => ({page: Number(m[1]), text: m[0]}))
  : Array.from({length: Math.ceil(ppt.length / 2000)}, (_, i) => ({
     page: i + 1,
     text: ppt.slice(i * 2000, (i + 1) * 2000)
    }))
 const indexed = pages.map((page, index) => ({...page, index, tokens: grams(page.text)}))
 return (batch: CorrectionBatch, source: Segment[], mode: CorrectionMode) => {
  const quality = mode === 'quality',
   limit = quality ? 8000 : 4000
  let remaining = quality ? 1200 : 800
  const adjacent: {id: number; text: string}[] = []
  for (let distance = 1; distance <= (quality ? 6 : 4); distance++) {
   for (const id of [batch.start - distance, batch.start + batch.rows.length - 1 + distance]) {
    if (id < 0 || id >= source.length || remaining <= 0) continue
    const text = source[id].text.slice(0, remaining)
    adjacent.push({id, text})
    remaining -= text.length
   }
  }
  adjacent.sort((a, b) => a.id - b.id)
  const query = grams(batch.rows.map(row => row.text).join('\n') + '\n' + adjacent.map(row => row.text).join('\n'))
  const ranked = indexed
   .map(page => ({...page, score: [...page.tokens].filter(token => query.has(token)).length}))
   .sort((a, b) => b.score - a.score || a.index - b.index)
  const relevant = ranked.filter(page => page.score > 0)
  const center = Math.min(pages.length - 1, Math.floor((batch.start / Math.max(1, source.length)) * pages.length))
  const selected = relevant.length ? relevant : indexed.slice(Math.max(0, center - 1), center + 2)
  const text = selected
   .map(page => page.text)
   .join('\n')
   .slice(0, limit)
  const omissions: string[] = []
  if (text.length < ppt.length) omissions.push(`课件文字按本批相关性择取，最多 ${limit} 字；未发送整份课件。`)
  if (!relevant.length && pages.length) omissions.push('未找到课件文字匹配，按字幕进度选取候选页面，不能视为可靠对齐。')
  const scored = images
   .map((image, index) => ({
    image,
    index,
    score: ranked.find(page => page.page === Number(/第\s*(\d+)\s*页/.exec(image.label)?.[1]))?.score || 0
   }))
   .sort((a, b) => b.score - a.score || a.index - b.index)
  let candidates = scored.filter(item => item.score > 0).slice(0, quality ? 3 : 1)
  if (quality && !candidates.length) {
   const imageCenter = Math.min(
    images.length - 1,
    Math.floor((batch.start / Math.max(1, source.length)) * images.length)
   )
   candidates = scored.slice(Math.max(0, imageCenter - 1), imageCenter + 2)
   if (candidates.length) omissions.push('附图按进度猜选，未经可靠页面对齐。')
  }
  if (mode === 'text') candidates = []
  if (mode !== 'quality')
   omissions.push(
    mode === 'text' ? '快速文字模式未附图片，图表与扫描页不可猜测。' : '均衡模式只附文字匹配图片，未匹配图表不可猜测。'
   )
  let bytes = 0
  const chosen = candidates
   .sort((a, b) => a.index - b.index)
   .flatMap(({image}) => {
    const size = Buffer.byteLength(image.url, 'utf8')
    if (size > 900000 || size + bytes > 1800000) {
     omissions.push(`${image.label} 图片超出请求字节预算，未附加。`)
     return []
    }
    bytes += size
    return [image]
   })
  return {courseware: text, lectureContext: adjacent, images: chosen, omissions}
 }
}

// Only a contiguous prefix is durable. At most two results can be pending, and all
// in-flight work settles before returning or releasing the lecture job lock.
export async function runCorrectionBatches<T>(
 batches: CorrectionBatch[],
 run: (batch: CorrectionBatch, index: number, signal: AbortSignal) => Promise<T>,
 commit: (result: T, batch: CorrectionBatch) => void,
 signal?: AbortSignal
) {
 const controller = new AbortController()
 const combined = AbortSignal.any([controller.signal, ...(signal ? [signal] : [])])
 for (let start = 0; start < batches.length; start += 2) {
  combined.throwIfAborted()
  const pending = new Map<number, T>()
  let next = start,
   failure: unknown,
   failed = false
  const jobs = batches.slice(start, start + 2).map(async (batch, offset) => {
   try {
    const result = await run(batch, start + offset, combined)
    combined.throwIfAborted()
    pending.set(start + offset, result)
    while (pending.has(next)) {
     combined.throwIfAborted()
     commit(pending.get(next)!, batches[next])
     pending.delete(next++)
    }
   } catch (error) {
    if (!failed) {
     failed = true
     failure = error
     controller.abort(error)
    }
   }
  })
  await Promise.all(jobs)
  if (failed) throw failure
  combined.throwIfAborted()
 }
}
