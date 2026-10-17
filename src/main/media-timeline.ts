export type MediaInterval = {start: number; end: number}
export function checkedMediaIntervals(ranges: MediaInterval[], duration: number) {
 if (!Number.isFinite(duration) || duration <= 0 || ranges.length === 0 || ranges.length > 201)
  throw new Error('媒体保留时间范围无效')
 let end = 0
 return ranges.map(range => {
  if (
   !Number.isFinite(range.start) ||
   !Number.isFinite(range.end) ||
   range.start < end ||
   range.end <= range.start ||
   range.end > duration + 0.001
  )
   throw new Error('媒体保留时间范围越界或重叠')
  end = range.end
  return {...range}
 })
}
export function removalTimeline(duration: number, removed: MediaInterval[], clip?: MediaInterval) {
 const window = clip || {start: 0, end: duration}
 checkedMediaIntervals([window], duration)
 const sorted = removed
  .map(range => {
   checkedMediaIntervals([range], duration)
   return {start: Math.max(window.start, range.start), end: Math.min(window.end, range.end)}
  })
  .filter(range => range.end > range.start)
  .sort((a, b) => a.start - b.start)
 const merged: MediaInterval[] = []
 for (const range of sorted) {
  const prior = merged.at(-1)
  if (prior && range.start <= prior.end) prior.end = Math.max(prior.end, range.end)
  else merged.push({...range})
 }
 const kept: MediaInterval[] = []
 let cursor = window.start
 for (const range of merged) {
  if (range.start > cursor) kept.push({start: cursor, end: range.start})
  cursor = range.end
 }
 if (cursor < window.end) kept.push({start: cursor, end: window.end})
 if (!kept.length) throw new Error('所选片段移除后没有剩余内容，请调整分类或时间范围')
 checkedMediaIntervals(kept, duration)
 return {removed: merged, kept, duration: kept.reduce((sum, range) => sum + range.end - range.start, 0)}
}
/** Intersect first, then map the retained original timestamps to the edited timeline. */
export function retimeMediaCues<T extends MediaInterval>(cues: T[], kept: MediaInterval[]): T[] {
 const output: T[] = []
 let offset = 0
 for (const range of kept) {
  for (const cue of cues) {
   const start = Math.max(range.start, cue.start),
    end = Math.min(range.end, cue.end)
   if (end > start) output.push({...cue, start: offset + start - range.start, end: offset + end - range.start})
  }
  offset += range.end - range.start
 }
 return output.sort((a, b) => a.start - b.start)
}
