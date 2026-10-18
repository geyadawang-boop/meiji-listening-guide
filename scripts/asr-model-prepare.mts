import {createHash, randomUUID} from 'node:crypto'
import {execFileSync} from 'node:child_process'
import {constants} from 'node:fs'
import {copyFile, lstat, mkdir, open, readFile, readdir, realpath, writeFile} from 'node:fs/promises'
import {dirname, join, resolve} from 'node:path'
import {tmpdir} from 'node:os'
import {fileURLToPath} from 'node:url'
import {z} from 'zod'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repository = 'onnx-community/whisper-small',
 revision = '36050c46d777d46dc4b5f43f6d90574fc38f8732',
 vadCommit = '65882eee9f5cdbeeb2d877f1131d48cf241b327d'
const componentDigest = '08788c32d3d1f1ed1ae0847f17ee24a482b5614a9e98d96ccafcc64a0893acdf',
 totalBytes = 254727043
const selected = [
 'README.md',
 'config.json',
 'generation_config.json',
 'preprocessor_config.json',
 'tokenizer.json',
 'tokenizer_config.json',
 'special_tokens_map.json',
 'added_tokens.json',
 'normalizer.json',
 'merges.txt',
 'vocab.json',
 'onnx/encoder_model_quantized.onnx',
 'onnx/decoder_model_merged_quantized.onnx'
]
const requestSchema = z
 .object({
  repository: z.literal(repository),
  revision: z.literal(revision),
  productVersion: z.literal('0.1.85'),
  offlineDirectory: z.string().min(1).optional()
 })
 .strict()
const entrySchema = z
 .object({
  path: z.string(),
  size: z.number().int().positive().max(totalBytes),
  sha256: z.string().regex(/^[a-f0-9]{64}$/)
 })
 .strict()
type Entry = z.infer<typeof entrySchema>
function check(value: unknown, message: string): asserts value {
 if (!value) throw new Error(message)
}
const digest = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex')
async function plain(path: string, directory = false) {
 const target = resolve(path)
 for (let current = target; ; current = dirname(current)) {
  const stat = await lstat(current)
  check(!stat.isSymbolicLink(), 'Links are not allowed')
  check(
   current !== target || directory ? stat.isDirectory() : stat.isFile() && stat.nlink === 1,
   'Regular non-hardlinked files required'
  )
  if (dirname(current) === current) break
 }
 check(resolve(await realpath(target)) === target, 'Canonical input path required')
 return target
}
async function verifyFile(path: string, entry: Entry) {
 await plain(path)
 const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0)),
  hash = createHash('sha256')
 let size = 0
 try {
  const before = await handle.stat()
  check(before.size === entry.size, 'File size mismatch: ' + entry.path)
  for await (const bytes of handle.createReadStream({autoClose: false})) {
   size += bytes.length
   check(size <= entry.size, 'File exceeds fixed size')
   hash.update(bytes)
  }
  const after = await handle.stat(),
   current = await lstat(path)
  check(
   before.dev === current.dev &&
    before.ino === current.ino &&
    before.mtimeMs === after.mtimeMs &&
    before.ctimeMs === after.ctimeMs &&
    size === entry.size &&
    after.size === size,
   'File changed during verification'
  )
 } finally {
  await handle.close()
 }
 check(hash.digest('hex') === entry.sha256, 'File digest mismatch: ' + entry.path)
}
function sourceFor(name: string) {
 if (name === 'silero-vad-v6.onnx')
  return {
   url:
    'https://raw.githubusercontent.com/SYSTRAN/faster-whisper/' +
    vadCommit +
    '/faster_whisper/assets/silero_vad_v6.onnx',
   hosts: ['raw.githubusercontent.com']
  }
 if (name === 'VAD-LICENSE.txt')
  return {
   url: 'https://raw.githubusercontent.com/SYSTRAN/faster-whisper/' + vadCommit + '/LICENSE',
   hosts: ['raw.githubusercontent.com']
  }
 check(selected.includes(name), 'Unknown remote model file')
 return {
  url: 'https://huggingface.co/' + repository + '/resolve/' + revision + '/' + name,
  hosts: [
   'huggingface.co',
   'us.aws.cdn.hf.co',
   'cdn-lfs.huggingface.co',
   'cdn-lfs-us-1.hf.co',
   'cas-bridge.xethub.hf.co'
  ]
 }
}
async function download(entry: Entry, path: string) {
 const source = sourceFor(entry.path)
 let url = source.url
 const signal = AbortSignal.timeout(300000)
 for (let count = 0; count <= 5; count++) {
  const parsed = new URL(url)
  check(
   parsed.protocol === 'https:' &&
    !parsed.username &&
    !parsed.password &&
    (!parsed.port || parsed.port === '443') &&
    source.hosts.includes(parsed.hostname),
   'Model redirect host is not allowed'
  )
  let response: Response
  try {
   response = await fetch(url, {redirect: 'manual', signal, headers: {'accept-encoding': 'identity'}})
  } catch {
   throw new Error('Model request failed: ' + entry.path + ' at ' + parsed.hostname)
  }
  if ([301, 302, 303, 307, 308].includes(response.status)) {
   const next = response.headers.get('location')
   await response.body?.cancel()
   check(next && count < 5, 'Invalid model redirect chain')
   url = new URL(next, url).href
   continue
  }
  check(response.ok && response.body, 'Model HTTP ' + response.status + ': ' + entry.path + ' at ' + parsed.hostname)
  const length = response.headers.get('content-length')
  check(length === null || Number(length) === entry.size, 'Model Content-Length mismatch')
  const file = await open(path, 'wx', 0o600),
   hash = createHash('sha256')
  let size = 0
  try {
   for await (const bytes of response.body) {
    size += bytes.length
    check(size <= entry.size, 'Model download exceeds fixed size')
    hash.update(bytes)
    let offset = 0
    while (offset < bytes.length) {
     const written = await file.write(bytes, offset, bytes.length - offset)
     check(written.bytesWritten > 0, 'Model write made no progress')
     offset += written.bytesWritten
    }
   }
   await file.sync()
  } catch {
   throw new Error('Model transfer failed: ' + entry.path)
  } finally {
   await file.close()
  }
  check(
   size === entry.size && hash.digest('hex') === entry.sha256,
   'Model download digest/size mismatch: ' + entry.path
  )
  return
 }
 throw new Error('Model redirect limit exceeded')
}
async function binding() {
 return {
  commit: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim(),
  dirty: !!execFileSync('git', ['status', '--porcelain'], {cwd: root, encoding: 'utf8'}).trim(),
  scriptSha256: digest(await readFile(fileURLToPath(import.meta.url))),
  manifestSha256: digest(await readFile(join(root, 'resources/runtime-manifest.json'))),
  platform: process.platform,
  arch: process.arch
 }
}
/** Public model preparation only; does not load a model, execute inference or alter app resources. */
export async function prepareAsrModel(value: unknown) {
 const request = requestSchema.parse(value)
 const raw = JSON.parse(await readFile(join(root, 'resources/runtime-manifest.json'), 'utf8'))
 check(raw.schema === 1 && raw.productVersion === request.productVersion, 'Application manifest identity mismatch')
 const component = raw.components.find((c: {id: string}) => c.id === 'asr')
 check(
  component && digest(JSON.stringify(component)) === componentDigest && component.bytes === totalBytes,
  'Application ASR source lock changed; explicit review required'
 )
 const entries = z
  .array(entrySchema)
  .length(17)
  .parse(component.files)
  .map(file => ({...file, path: file.path.slice('onnx-small/'.length)}))
 const names = [...selected, 'silero-vad-v6.onnx', 'VAD-LICENSE.txt', 'MODEL-LICENSE.txt', 'acquisition.json']
 check(
  entries.every(file => names.includes(file.path)) && new Set(entries.map(f => f.path)).size === 17,
  'Unexpected ASR file set'
 )
 if (request.offlineDirectory) {
  await plain(request.offlineDirectory, true)
  const actual: string[] = []
  for (const name of await readdir(request.offlineDirectory)) {
   if (name === 'onnx') {
    await plain(join(request.offlineDirectory, name), true)
    for (const child of await readdir(join(request.offlineDirectory, name))) actual.push('onnx/' + child)
   } else actual.push(name)
  }
  check(actual.sort().join('|') === [...names].sort().join('|'), 'Offline model file set mismatch')
 }
 const temp = await plain(await realpath(tmpdir()), true),
  work = join(temp, 'meiji-asr-model-' + randomUUID()),
  model = join(work, 'onnx-small')
 await mkdir(work, {mode: 0o700})
 await mkdir(model, {mode: 0o700})
 await mkdir(join(model, 'onnx'), {mode: 0o700})
 let active = 'metadata'
 try {
  for (const entry of entries) {
   active = entry.path
   console.error('Preparing ASR file: ' + active)
   const path = join(model, entry.path)
   if (request.offlineDirectory) {
    const input = join(request.offlineDirectory, entry.path)
    await verifyFile(input, entry)
    await copyFile(input, path, constants.COPYFILE_EXCL)
   } else if (entry.path === 'acquisition.json') {
    const files = [...selected, 'silero-vad-v6.onnx'].map(name => entries.find(f => f.path === name)!)
    const text = JSON.stringify(
     {
      repository,
      revision,
      baseModel: 'openai/whisper-small',
      license: 'apache-2.0',
      dtype: 'q8',
      files,
      transcriptionVerified: false
     },
     null,
     2
    )
    check(
     Buffer.byteLength(text) === entry.size && digest(text) === entry.sha256,
     'Generated acquisition differs from fixed bytes'
    )
    await writeFile(path, text, {flag: 'wx', mode: 0o600})
   } else if (entry.path === 'MODEL-LICENSE.txt') {
    const bytes = await readFile(join(root, 'node_modules/@huggingface/transformers/LICENSE'))
    check(bytes.length === entry.size && digest(bytes) === entry.sha256, 'Apache license differs from fixed bytes')
    await writeFile(path, bytes, {flag: 'wx', mode: 0o600})
   } else await download(entry, path)
   await verifyFile(path, entry)
  }
  for (const entry of entries) await verifyFile(join(model, entry.path), entry)
  const report = {
   state: 'model_prepared',
   repository,
   revision,
   productVersion: request.productVersion,
   files: entries,
   bytes: totalBytes,
   vadCommit,
   transcriptionVerified: false,
   licenseReviewPending: [
    'VAD component license is SYSTRAN MIT; Silero Team upstream attribution must also be reviewed before distribution'
   ],
   vadUpstreamLicense: {
    url: 'https://github.com/snakers4/silero-vad/blob/fba061dc5559f696e62171e9a0741782b0fdc23c/LICENSE',
    size: 1075,
    sha256: '2e63e9a38b6e8fc0c7bc37ce174caca1862870856c6daf5697cfb785e925520b'
   },
   sourceLockDigest: componentDigest,
   binding: await binding(),
   scope:
    'Public fixed model bytes verified in an isolated temporary directory; no inference, app installation or user audio access.'
  }
  await writeFile(join(work, 'model-report.json'), JSON.stringify(report, null, 2) + '\n', {flag: 'wx', mode: 0o600})
  return {model, report}
 } catch (error) {
  const cause = error instanceof Error ? error.message : 'Unknown preparation failure'
  await writeFile(
   join(work, 'failure.json'),
   JSON.stringify({state: 'failed', file: active, error: cause, binding: await binding()}, null, 2) + '\n',
   {flag: 'wx', mode: 0o600}
  )
  throw new Error('ASR preparation failed for ' + active + '; incomplete directory retained at ' + work + ': ' + cause)
 }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
 try {
  check(
   process.argv.length === 2 || (process.argv.length === 4 && process.argv[2] === '--offline'),
   'Usage: node scripts/asr-model-prepare.mts [--offline <canonical model directory>]'
  )
  console.log(
   JSON.stringify(
    await prepareAsrModel({
     repository,
     revision,
     productVersion: '0.1.85',
     ...(process.argv.length === 4 ? {offlineDirectory: process.argv[3]} : {})
    })
   )
  )
 } catch (error) {
  console.log(JSON.stringify({state: 'failed', error: error instanceof Error ? error.message : 'Unknown failure'}))
  process.exitCode = 1
 }
}
