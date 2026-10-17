import {z} from 'zod'
export const studyEntrySchema = z.object({
 id: z.string().uuid(),
 courseId: z.string().uuid(),
 lectureId: z.string().uuid().optional(),
 title: z.string().trim().min(1).max(200),
 chapter: z.string().trim().min(1).max(500),
 endsAt: z.union([z.string().datetime({offset: true}), z.literal('')]),
 zhiyunCourseId: z.string().regex(/^\d+$/).optional(),
 subId: z.string().regex(/^\d+$/).optional()
})
export type StudyEntry = z.infer<typeof studyEntrySchema>
export const checkAt = (endsAt: string) =>
 endsAt ? new Date(Date.parse(endsAt) + 4 * 60 * 60 * 1000).toISOString() : ''
export const highlightColors = {
 teacher: [0.76, 0.61, 0.44],
 focus: [1, 0.57, 0.57],
 ppt: [0.53, 0.76, 1],
 senior: [1, 0.66, 0.81]
} as const
export const highlightLabels = {focus: '老师重点', senior: '学长学姐重点', teacher: '老师讲授内容', ppt: 'PPT 内容'}
export const highlightSchema = z.object({
 id: z.string().uuid(),
 page: z.number().int().positive(),
 rect: z.tuple([z.number(), z.number(), z.number(), z.number()]),
 source: z.enum(['teacher', 'focus', 'ppt', 'senior']),
 quote: z.string().min(1).max(3000),
 evidence: z.string().min(1).max(5000),
 extension: z.boolean()
})
export type Highlight = z.infer<typeof highlightSchema>
export const highlightPriority = {focus: 0, senior: 1, teacher: 2, ppt: 3} as const
// Subtract only the covered area; preserve the rest of a lower-priority line.
export function prioritizedHighlights(rows: Highlight[]): Highlight[] {
 const result: Highlight[] = []
 for (const row of [...rows].sort((a, b) => highlightPriority[a.source] - highlightPriority[b.source])) {
  let rects = [row.rect]
  for (const above of result.filter(r => r.page === row.page)) {
   const [ax, ay, aw, ah] = above.rect
   rects = rects.flatMap(rect => {
    const [x, y, w, h] = rect,
     l = Math.max(x, ax),
     b = Math.max(y, ay),
     r = Math.min(x + w, ax + aw),
     t = Math.min(y + h, ay + ah)
    if (r <= l || t <= b) return [rect]
    const pieces: Highlight['rect'][] = []
    if (b > y) pieces.push([x, y, w, b - y])
    if (t < y + h) pieces.push([x, t, w, y + h - t])
    if (l > x) pieces.push([x, b, l - x, t - b])
    if (r < x + w) pieces.push([r, b, x + w - r, t - b])
    return pieces.filter(p => p[2] > 0.2 && p[3] > 0.2)
   })
  }
  for (const [index, rect] of rects.entries()) result.push({...row, id: index ? crypto.randomUUID() : row.id, rect})
 }
 return result
}
