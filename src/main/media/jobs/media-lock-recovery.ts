import {lstat, readFile, readdir, unlink} from 'node:fs/promises'
import {join} from 'node:path'
import {z} from 'zod'
const ownerSchema = z.object({
 version: z.literal(1),
 pid: z.number().int().positive().safe(),
 identity: z.string().min(1)
})
/** Called only after the worker holds its exclusive queue lease. Ambiguous locks are preserved. */
export async function recoverDownloadLocks(directory: string, identity: string) {
 const preserved: string[] = [],
  removed: string[] = []
 for (const name of await readdir(directory)) {
  if (!/^track-\d+(?:-segment-\d+)?(?:-chunk-\d+)?\.lock$/.test(name)) continue
  const path = join(directory, name),
   info = await lstat(path)
  if (info.isSymbolicLink() || !info.isFile()) {
   preserved.push(name)
   continue
  }
  let owner: z.infer<typeof ownerSchema>
  try {
   owner = ownerSchema.parse(JSON.parse(await readFile(path, 'utf8')))
  } catch {
   preserved.push(name)
   continue
  }
  if (!owner.identity.startsWith(identity + ':')) {
   preserved.push(name)
   continue
  }
  let dead = false
  try {
   process.kill(owner.pid, 0)
  } catch (error) {
   dead = (error as NodeJS.ErrnoException).code === 'ESRCH'
  }
  if (!dead) {
   preserved.push(name)
   continue
  }
  await unlink(path)
  removed.push(name)
 }
 return {removed, preserved}
}
