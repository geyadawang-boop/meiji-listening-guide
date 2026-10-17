import type {Segment, LectureNotes} from './types'
export function time(ms: number, millis = true): string {
 const n = Math.max(0, Math.round(ms)),
  s = Math.floor(n / 1000)
 return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}${millis ? ',' + String(n % 1000).padStart(3, '0') : ''}`
}
export function milliseconds(t: string): number {
 const m = /^(\d{2,}):(\d{2}):(\d{2})(?:[,.](\d{3}))?$/.exec(t.trim())
 if (!m || +m[2] > 59 || +m[3] > 59) throw new Error(`时间戳不合法：${t}`)
 return (+m[1] * 3600 + +m[2] * 60 + +m[3]) * 1000 + +(m[4] || 0)
}
export function parseSrt(raw: string): Segment[] {
 const fenced = [...raw.matchAll(/```(?:srt)?\s*\n([\s\S]*?)```/gi)].map(m => m[1]).join('\n')
 const value = (fenced || raw).replace(/\r/g, '').trim()
 if (!value) throw new Error('回复中没有字幕内容')
 const result: Segment[] = []
 for (const block of value.split(/\n\s*\n/)) {
  const lines = block.trim().split('\n')
  if (!/^\d+$/.test(lines[0])) throw new Error('SRT 字幕缺少序号')
  const m = /^(\d{2,}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d{2,}:\d{2}:\d{2}[,.]\d{3})$/.exec(lines[1]?.trim() || '')
  if (!m) throw new Error('SRT 时间戳格式错误')
  const start = milliseconds(m[1]),
   end = milliseconds(m[2]),
   text = lines.slice(2).join('\n').trim()
  if (!text || end <= start || (result.length && start < result[result.length - 1].end))
   throw new Error('字幕为空或时间没有递增')
  if (+lines[0] !== result.length + 1) throw new Error('字幕序号不连续')
  result.push({start, end, text})
 }
 return result
}
export const toSrt = (segments: Segment[]) =>
 segments.map((s, i) => `${i + 1}\n${time(s.start)} --> ${time(s.end)}\n${s.text}`).join('\n\n') + '\n'
export function mergeSegments(parts: {offset: number; segments: Segment[]}[]): Segment[] {
 const result = parts.flatMap(p => p.segments.map(s => ({...s, start: s.start + p.offset, end: s.end + p.offset})))
 parseSrt(toSrt(result))
 return result
}
const normalize = (s: string) => s.replace(/[\p{P}\p{Z}\s]/gu, '').toLowerCase()
export function verifyNotes(notes: LectureNotes, segments: Segment[]): LectureNotes {
 segments = segments.filter(s => !s.uncertain)
 const all = normalize(segments.map(s => s.text).join(''))
 const verify = <T extends {quote: string; timestamp: string}>(
  point: T,
  group: 'key' | 'not' | 'uncertain'
 ): T & {verified: boolean} => {
  const stamp = milliseconds(point.timestamp)
  const nearby = normalize(
   segments
    .filter(s => Math.abs(s.start - stamp) < 20000 || (s.start <= stamp && s.end >= stamp))
    .map(s => s.text)
    .join('')
  )
  const quote = normalize(point.quote)
  const negative = /不考|了解即可|不作要求|跳过|不用看|不是重点|不重要|不要求/.test(quote)
  const positive = /重点|要考|会考|可能考|很重要|一定要掌握|必考|去年考过|记一下|要会算|要求掌握|必须掌握/.test(quote)
  const trigger = group === 'key' ? positive && !negative : group === 'not' ? negative : true
  return {
   ...point,
   verified: quote.length >= 3 && all.includes(quote) && nearby.includes(quote) && trigger && !quote.startsWith('学生')
  }
 }
 return {
  keyPoints: notes.keyPoints.map(p => verify(p, 'key')),
  notTested: notes.notTested.map(p => verify(p, 'not')),
  uncertain: (notes.uncertain || []).map(p => verify(p, 'uncertain'))
 }
}
export function keywordCandidates(questions: {stem: string; knowledgePoints: string[]}[], topics: string[]): number[] {
 const keys = topics.map(normalize).filter(Boolean)
 return questions.flatMap((q, i) => {
  const tags = q.knowledgePoints.map(normalize),
   stem = normalize(q.stem)
  return keys.some(k => tags.some(t => t.includes(k) || k.includes(t)) || stem.includes(k)) ? [i] : []
 })
}
