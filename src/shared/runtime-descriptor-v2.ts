import {createHash} from 'node:crypto'
import {z} from 'zod'
import {parseRuntimeManifestV2, runtimeTargetSchema, type RuntimeManifestV2} from './runtime-manifest-v2.ts'
const hash = z.string().regex(/^[a-f0-9]{64}$/)
const descriptorSchema = z
 .object({
  schema: z.literal(2),
  id: z.literal('video'),
  productVersion: z.string(),
  target: runtimeTargetSchema,
  bytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  filesDigest: hash,
  manifestDigest: hash
 })
 .strict()
export type VideoDescriptorV2 = z.infer<typeof descriptorSchema>
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
/** Stable tuple encoding, independent of caller object-key/file/component order. */
export function manifestIdentity(manifest: RuntimeManifestV2) {
 return [
  2,
  manifest.productVersion,
  [manifest.target.platform, manifest.target.arch],
  [...manifest.components]
   .sort((a, b) => a.id.localeCompare(b.id, 'en'))
   .map(c => [
    c.id,
    c.label,
    c.directory,
    [c.target.platform, c.target.arch],
    c.bytes,
    [...c.files]
     .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
     .map(f => [f.path, f.size, f.sha256, f.mode])
   ])
 ]
}
export function createVideoDescriptor(manifest: RuntimeManifestV2): VideoDescriptorV2 {
 const checked = parseRuntimeManifestV2(manifest, manifest.target)
 if (checked.components.length !== 1 || checked.components[0].id !== 'video')
  throw new Error('Video-only candidate manifest required')
 const component = checked.components[0]
 return {
  schema: 2,
  id: 'video',
  productVersion: checked.productVersion,
  target: checked.target,
  bytes: component.bytes,
  filesDigest: digest(
   [...component.files]
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map(f => [f.path, f.size, f.sha256, f.mode])
  ),
  manifestDigest: digest(manifestIdentity(checked))
 }
}
/** Caller must supply the independently selected manifest; descriptor hashes grant no installation authority. */
export function validateVideoDescriptor(value: unknown, callerManifest: RuntimeManifestV2) {
 const actual = descriptorSchema.parse(value),
  expected = createVideoDescriptor(callerManifest)
 if (
  JSON.stringify([
   actual.productVersion,
   actual.target.platform,
   actual.target.arch,
   actual.bytes,
   actual.filesDigest,
   actual.manifestDigest
  ]) !==
  JSON.stringify([
   expected.productVersion,
   expected.target.platform,
   expected.target.arch,
   expected.bytes,
   expected.filesDigest,
   expected.manifestDigest
  ])
 )
  throw new Error('Descriptor differs from caller manifest')
 return actual
}
