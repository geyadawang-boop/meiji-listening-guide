import {existsSync, readFileSync, writeFileSync, renameSync} from 'node:fs'
import {join} from 'node:path'
import {appearanceSchema, appearanceStateSchema, defaultAppearance, type AppearanceState} from '@shared/appearance'
export class AppearanceStore {
 private path: string
 constructor(root: string) {
  this.path = join(root, 'appearance.json')
 }
 get(): AppearanceState {
  return existsSync(this.path)
   ? appearanceStateSchema.parse(JSON.parse(readFileSync(this.path, 'utf8')))
   : {global: {...defaultAppearance}, courses: {}}
 }
 save(value: unknown, courseId?: string) {
  const parsed = appearanceSchema.parse(value),
   state = this.get()
  if (courseId) state.courses[courseId] = parsed
  else state.global = parsed
  return this.write(state)
 }
 clear(courseId: string) {
  const state = this.get()
  delete state.courses[courseId]
  return this.write(state)
 }
 private write(state: AppearanceState) {
  const parsed = appearanceStateSchema.parse(state)
  writeFileSync(this.path + '.tmp', JSON.stringify(parsed), 'utf8')
  renameSync(this.path + '.tmp', this.path)
  return parsed
 }
}
