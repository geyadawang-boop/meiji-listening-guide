import {z} from 'zod'

// Pure candidate contract. Existing installation and schema-1 loading do not use this module.
export const runtimeTargetSchema = z.union([
 z.object({platform: z.literal('win32'), arch: z.literal('x64')}).strict(),
 z.object({platform: z.literal('darwin'), arch: z.literal('arm64')}).strict(),
 z.object({platform: z.literal('linux'), arch: z.literal('x64')}).strict()
])
export type RuntimeTarget = z.infer<typeof runtimeTargetSchema>
const safeInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const relativePath = z
 .string()
 .min(1)
 .max(500)
 .refine(
  value =>
   !/[\\:<>"|?*\x00-\x1f\x7f]/.test(value) &&
   value
    .split('/')
    .every(
     part =>
      part.length > 0 &&
      part !== '.' &&
      part !== '..' &&
      !/[. ]$/.test(part) &&
      !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)
    ),
  'Invalid portable relative path'
 )
const fileShape = {path: relativePath, size: safeInteger, sha256: z.string().regex(/^[a-f0-9]{64}$/)}
const fileV2 = z.object({...fileShape, mode: z.enum(['0644', '0755'])}).strict()
const componentShape = {
 id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
 label: z.string().trim().min(1).max(200),
 directory: relativePath,
 bytes: safeInteger
}
function conflict(paths: string[]) {
 const normalized = paths.map(path => path.normalize('NFC').toLowerCase()),
  entries = new Set(normalized)
 if (entries.size !== paths.length) return true
 return normalized.some(path => {
  const parts = path.split('/')
  return parts.slice(0, -1).some((_, index) => entries.has(parts.slice(0, index + 1).join('/')))
 })
}
function sameTarget(a: RuntimeTarget, b: RuntimeTarget) {
 return a.platform === b.platform && a.arch === b.arch
}
const manifestV2Base = z
 .object({
  schema: z.literal(2),
  productVersion: z.string().trim().min(1).max(100),
  target: runtimeTargetSchema,
  components: z
   .array(z.object({...componentShape, target: runtimeTargetSchema, files: z.array(fileV2).min(1).max(50000)}).strict())
   .min(1)
   .max(10)
 })
 .strict()
export const runtimeManifestV2Schema = manifestV2Base.superRefine((manifest, context) => {
 const issue = (message: string, path: (string | number)[]) => context.addIssue({code: 'custom', message, path})
 if (new Set(manifest.components.map(c => c.id)).size !== manifest.components.length)
  issue('Duplicate component ID', ['components'])
 if (conflict(manifest.components.map(c => c.directory)))
  issue('Component directories overlap or collide', ['components'])
 let fileCount = 0
 for (const [index, component] of manifest.components.entries()) {
  const location = ['components', index]
  fileCount += component.files.length
  if (!sameTarget(component.target, manifest.target))
   issue('Component target differs from manifest', [...location, 'target'])
  if (component.id === 'knowledge' && manifest.target.platform !== 'win32')
   issue('Knowledge components currently require Windows x64', location)
  if (conflict(component.files.map(f => f.path))) issue('File paths overlap or collide', [...location, 'files'])
  const bytes = component.files.reduce((sum, file) => sum + file.size, 0)
  if (!Number.isSafeInteger(bytes) || bytes !== component.bytes)
   issue('Component bytes do not equal file sizes', [...location, 'bytes'])
  const tools = manifest.target.platform === 'win32' ? ['ffmpeg.exe', 'ffprobe.exe'] : ['ffmpeg', 'ffprobe']
  if (component.id === 'video') {
   for (const tool of tools)
    if (!component.files.some(file => file.path === tool && file.size > 0))
     issue('Video tool pair is incomplete', [...location, 'files'])
  }
  for (const [fileIndex, file] of component.files.entries()) {
   const executable = component.id === 'video' && tools.includes(file.path)
   const expected = executable && manifest.target.platform !== 'win32' ? '0755' : '0644'
   if (file.mode !== expected)
    issue('File mode is not allowed by this component contract', [...location, 'files', fileIndex, 'mode'])
  }
 }
 if (fileCount > 50000) issue('Total manifest file budget exceeded', ['components'])
})
export type RuntimeManifestV2 = z.infer<typeof runtimeManifestV2Schema>
export function parseRuntimeManifestV2(value: unknown, expectedTarget: RuntimeTarget): RuntimeManifestV2 {
 const expected = runtimeTargetSchema.parse(expectedTarget),
  manifest = runtimeManifestV2Schema.parse(value)
 if (!sameTarget(manifest.target, expected)) throw new Error('Manifest target differs from requested target')
 return manifest
}

const legacySchema = z
 .object({
  schema: z.literal(1),
  productVersion: z.string(),
  components: z
   .array(
    z
     .object({
      id: z.string(),
      label: z.string(),
      directory: z.string(),
      files: z.array(z.object(fileShape).strict()).max(50000),
      bytes: z.number()
     })
     .strict()
   )
   .max(10)
 })
 .strict()
/** Legacy interpretation only, not installability or integrity acceptance; no conversion or installation changes. */
export function parseLegacyRuntimeManifest(value: unknown, expectedTarget: RuntimeTarget) {
 const target = runtimeTargetSchema.parse(expectedTarget)
 if (target.platform !== 'win32' || target.arch !== 'x64')
  throw new Error('Schema 1 is only interpreted for explicit Windows x64')
 return legacySchema.parse(value)
}
