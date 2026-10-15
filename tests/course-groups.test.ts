import {describe,it,expect} from 'vitest'
import {courseLabel,sortCoursesForNavigation} from '../src/shared/course-groups'
import type {Course} from '../src/shared/types'
const course=(id:string,name:string):Course=>({id,name,created_at:'2026-10-01'})
describe('independent academic-year navigation',()=>{
 it('keeps eleven independent entries and sorts current year first without mutating input',()=>{
  const rows=['外科','材料','正畸','修复','牙体'].flatMap((s,i)=>[course('old'+i,s+' 2025-2026'),course('new'+i,s+' 2026-2027')]);rows.push(course('ai','人工智能 2026-2027'))
  const sorted=sortCoursesForNavigation(rows)
  expect(sorted).toHaveLength(11);expect(new Set(sorted.map(c=>c.id)).size).toBe(11)
  expect(sorted.slice(0,6).every(c=>c.name.endsWith('2026-2027'))).toBe(true);expect(rows[0].id).toBe('old0')
 })
 it('puts year first and preserves custom courses and course II',()=>{
  expect(courseLabel('口腔颌面外科学Ⅰ 2025-2026')).toBe('2025–2026 · 口腔颌面外科学1')
  expect(courseLabel('口腔正畸学 2026-2027')).toBe('2026–2027 · 口腔正畸学')
  expect(courseLabel('口腔修复学Ⅱ 2025-2026')).toBe('2025–2026 · 口腔修复学Ⅱ')
  expect(courseLabel('我的自建课')).toBe('我的自建课')
 })
})
