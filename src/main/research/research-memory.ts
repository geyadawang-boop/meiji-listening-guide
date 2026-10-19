import {createHash} from 'node:crypto'
import {z} from 'zod'
const candidate = z.object({
 kind: z.enum(['preference', 'progress', 'correction']),
 title: z.string().trim().min(1).max(80),
 body: z.string().trim().min(1).max(1000),
 basis: z.enum(['question', 'note', 'limitations']),
 quote: z.string().trim().min(1).max(300)
})
export type MemoryCandidate = z.infer<typeof candidate> & {candidate_id: string; status: 'pending' | 'accepted'}
/** Suggestions are never persistent memories until the user explicitly accepts them. */
export function readResearchAnswer(
 raw: string,
 task: {task_id: string; question: string; limitations: string},
 allowSuggestions: boolean
) {
 let note = raw,
  candidates: MemoryCandidate[] = []
 if (allowSuggestions && /^\s*(?:```(?:json)?\s*)?\{/.test(raw)) {
  const result = z
   .object({note: z.string().min(1).max(200000), memory_candidates: z.array(candidate).max(3).default([])})
   .parse(JSON.parse(raw.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, '')))
  note = result.note
  candidates = result.memory_candidates.map((value, index) => {
   const original = {question: task.question, note, limitations: task.limitations}[value.basis]
   if (!original.includes(value.quote) || (value.kind === 'preference' && value.basis !== 'question'))
    throw new Error('记忆建议未包含相应字段原句，未保存建议或研究成果')
   return {
    ...value,
    candidate_id: createHash('sha256')
     .update(JSON.stringify([task.task_id, index, value]))
     .digest('hex')
     .slice(0, 32),
    status: 'pending'
   }
  })
 }
 return {note, candidates}
}
