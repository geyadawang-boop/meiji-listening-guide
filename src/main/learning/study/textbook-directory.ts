import {dirname, join} from 'node:path'
import {stat} from 'node:fs/promises'

// Find the saved textbook folder beside the project, including portable releases.
export async function textbookDirectory(start: string, fallback: string): Promise<string> {
 let current = start
 while (true) {
  const candidate = join(current, '课本')
  if (
   await stat(candidate).then(
    s => s.isDirectory(),
    () => false
   )
  )
   return candidate
  const parent = dirname(current)
  if (parent === current) return fallback
  current = parent
 }
}
