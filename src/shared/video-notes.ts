export type VideoNotePoint = {cue: number; quote: string; point: string; topic: string; timestamp: string}
export type VideoNoteResult = {path: string; count: number; markdown: string; points: VideoNotePoint[]}
export type VideoNoteMode = 'brief' | 'detailed' | 'keypoints' | 'mindmap'
export const noteTitles: Record<VideoNoteMode, string> = {
 brief: '简要摘要',
 detailed: '详细摘要',
 keypoints: '课程要点',
 mindmap: '思维导图'
}
export function noteGroups(points: VideoNotePoint[]) {
 const groups = new Map<string, VideoNotePoint[]>()
 for (const point of points) {
  const topic = point.topic || '课程内容'
  const group = groups.get(topic) || []
  group.push(point)
  groups.set(topic, group)
 }
 return Array.from(groups, ([title, items]) => ({title, items}))
}
const escape = (s: string) =>
 s.replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'})[c]!)
export function notesSvg(title: string, points: VideoNotePoint[]) {
 const groups = noteGroups(points),
  height = Math.max(240, 80 + points.length * 72 + groups.length * 44)
 let y = 44
 const rows: string[] = []
 for (const group of groups) {
  rows.push(
   `<path d="M180 100H240V${y + 15}H280" fill="none" stroke="#c8c1ed" stroke-width="2"/><rect x="280" y="${y}" width="640" height="30" rx="8" fill="#eeeafa"/><text x="294" y="${y + 21}" font-size="15" font-weight="600">${escape(group.title)}</text>`
  )
  y += 44
  for (const point of group.items) {
   const text = Array.from(point.point),
    lines = [text.slice(0, 38).join(''), text.slice(38, 76).join('') + (text.length > 76 ? '…' : '')]
   rows.push(
    `<path d="M290 ${y - 10}V${y + 20}H310" fill="none" stroke="#c8c1ed"/><rect x="310" y="${y}" width="610" height="62" rx="10" fill="#f7f6fc"/><text x="324" y="${y + 21}" font-size="14">${escape(lines[0])}</text><text x="324" y="${y + 40}" font-size="14">${escape(lines[1])}</text><text x="830" y="${y + 53}" font-size="11" fill="#76718b">${escape(point.timestamp)}</text>`
   )
   y += 72
  }
 }
 return `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="${height}" viewBox="0 0 960 ${height}"><rect width="960" height="${height}" fill="#fff"/><g font-family="Microsoft YaHei,sans-serif" fill="#282534"><rect x="20" y="66" width="160" height="68" rx="14" fill="#e3ddf7"/><text x="34" y="96" font-size="16" font-weight="600">${escape(Array.from(title).slice(0, 8).join(''))}</text><text x="34" y="118" font-size="12">${points.length} 项字幕要点</text>${rows.join('')}</g></svg>`
}
