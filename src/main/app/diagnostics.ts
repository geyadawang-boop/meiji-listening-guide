import {appendFileSync, mkdirSync, statSync, renameSync, existsSync} from 'node:fs'
import {join} from 'node:path'
export function diagnostic(
 root: string,
 component: string,
 event: string,
 fields: {
  action?: string
  requestId?: number
  code?: string
  pid?: number
 } = {}
) {
 try {
  const dir = join(root, '诊断日志')
  mkdirSync(dir, {recursive: true})
  const file = join(dir, 'backend.jsonl')
  if (existsSync(file) && statSync(file).size > 2000000) renameSync(file, join(dir, 'backend.previous.jsonl'))
  appendFileSync(file, JSON.stringify({time: new Date().toISOString(), component, event, ...fields}) + '\n', 'utf8')
 } catch {
  /* Diagnostics cannot replace the original task failure. */
 }
}
