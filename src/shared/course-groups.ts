import type {Course} from './types'

export function courseSubject(name: string): string {
 const subject = name
  .trim()
  .replace(/\s*20\d{2}\s*[-–—]\s*20\d{2}\s*$/, '')
  .trim()
 if (/^口腔颌面外科学\s*[ⅠI１1]$/.test(subject)) return '口腔颌面外科学1'
 if (/^口腔修复学\s*[ⅠI１1]$/.test(subject)) return '口腔修复学I'
 return subject
}
export function courseYear(name: string): string {
 const match = name.match(/(20\d{2})\s*[-–—]\s*(20\d{2})\s*$/)
 return match ? `${match[1]}–${match[2]}` : ''
}
export function courseLabel(name: string): string {
 const year = courseYear(name)
 return year ? `${year} · ${courseSubject(name)}` : name
}
export function sortCoursesForNavigation(courses: Course[]): Course[] {
 return [...courses].sort(
  (a, b) =>
   courseYear(b.name).localeCompare(courseYear(a.name)) ||
   a.created_at.localeCompare(b.created_at) ||
   a.id.localeCompare(b.id)
 )
}
