import {strict as assert} from 'node:assert'
import {test, after} from 'node:test'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join, resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {build} from 'esbuild'

const directory = await mkdtemp(join(tmpdir(), 'correction-regression-'))
await build({
 entryPoints: [resolve('src/main/learning/correction.ts')],
 outfile: join(directory, 'correction.mjs'),
 bundle: true,
 platform: 'node',
 format: 'esm'
})
const {
 planCorrection,
 correctionContext,
 correctionNeedsVision,
 validCorrectionPrefix,
 validateCorrectionRows,
 runCorrectionBatches,
 resumableCorrection
} = await import(pathToFileURL(join(directory, 'correction.mjs')).href)
await build({
 entryPoints: [resolve('src/main/ai/api.ts')],
 outfile: join(directory, 'api.mjs'),
 bundle: true,
 platform: 'node',
 format: 'esm'
})
const {Api, isRetryableApiError} = await import(pathToFileURL(join(directory, 'api.mjs')).href)
after(() => rm(directory, {recursive: true, force: true}))
const source = (count: number) =>
 Array.from({length: count}, (_, i) => ({
  start: i * 1000,
  end: (i + 1) * 1000,
  text: `第${i}条：ATP不是光合作用，x²+1=0，保留否定。`
 }))
const deferred = () => {
 let resolve!: (value?: unknown) => void
 const promise = new Promise(done => {
  resolve = done
 })
 return {promise, resolve}
}
const batches = () => source(4).map((row, start) => ({start, rows: [row]}))
const corrected = (rows: ReturnType<typeof source>) =>
 rows.map(row => ({...row, originalText: row.text, uncertain: false, reason: ''}))

test('adaptive batches cover all 911 rows and improve request count with bounded input and output estimates', () => {
 const rows = source(911),
  planned = planCorrection(rows, 0, 8192)
 assert.ok(planned.length < 31)
 assert.deepEqual(
  planned.flatMap((b: {rows: unknown[]}) => b.rows),
  rows
 )
 for (const batch of planned) {
  assert.ok(batch.rows.length <= 96)
  assert.ok(batch.rows.reduce((n: number, row: {text: string}) => n + JSON.stringify(row.text).length, 0) <= 6000)
  assert.ok(
   2 +
    batch.rows.reduce(
     (n: number, row: {text: string}) => n + Math.ceil(Buffer.byteLength(JSON.stringify(row.text), 'utf8') / 2) + 96,
     0
    ) <=
    Math.floor(8192 * 0.8)
  )
 }
 assert.ok(planCorrection(rows, 0, 2048).length > planned.length)
 assert.throws(() => planCorrection([{...rows[0], text: '长'.repeat(6001)}], 0), /原文未截断/)
 const singleton = planCorrection([{...rows[0], text: '长'.repeat(1500)}], 0, 1024)
 assert.equal(singleton.length, 1)
 assert.equal(singleton[0].rows.length, 1)
 assert.equal(planCorrection(rows.slice(0, 3), 0, 1).length, 3)
})

test('resume starts at exact persisted prefix, including an old 30-row boundary', () => {
 const rows = source(130),
  saved = corrected(rows.slice(0, 30))
 assert.equal(validCorrectionPrefix(saved, rows), true)
 const planned = planCorrection(rows, saved.length)
 assert.equal(planned[0].start, 30)
 assert.deepEqual(
  [
   ...saved.map(row => row.originalText),
   ...planned.flatMap((b: {rows: {text: string}[]}) => b.rows.map(row => row.text))
  ],
  rows.map(row => row.text)
 )
 assert.equal(validCorrectionPrefix([{...saved[0], start: 9}], rows), false)
 assert.equal(validCorrectionPrefix([{...saved[0], originalText: 'changed source'}], rows), false)
 assert.equal(validCorrectionPrefix([saved[1], saved[0]], rows), false)
})

test('resumable checkpoint requires fingerprint, total and prefix to match', () => {
 const rows = source(4),
  saved = corrected(rows.slice(0, 2)),
  fingerprint = 'current'
 assert.deepEqual(resumableCorrection({fingerprint, total: 4, segments: saved}, fingerprint, rows), saved)
 assert.equal(resumableCorrection({fingerprint: 'old', total: 4, segments: saved}, fingerprint, rows), undefined)
 assert.equal(resumableCorrection({fingerprint, total: 5, segments: saved}, fingerprint, rows), undefined)
 assert.equal(
  resumableCorrection({fingerprint, total: 4, segments: [{...saved[0], start: 9}]}, fingerprint, rows),
  undefined
 )
 assert.equal(resumableCorrection(undefined, fingerprint, rows), undefined)
})

test('strict response ids reject missing, duplicate, reordered, extra and malformed rows', () => {
 const batch = {start: 9, rows: source(2)}
 const rows = batch.rows.map((row, i) => ({id: 9 + i, text: row.text, uncertain: false, reason: ''}))
 assert.deepEqual(validateCorrectionRows(rows, batch), rows)
 for (const bad of [
  rows.slice(0, 1),
  [rows[0], rows[0]],
  [...rows].reverse(),
  [...rows, rows[0]],
  [{...rows[0], id: '9'}, rows[1]],
  [{...rows[0], reason: undefined}, rows[1]],
  [{...rows[0], text: ' '}, rows[1]]
 ])
  assert.throws(() => validateCorrectionRows(bad, batch))
 const padded = [{...rows[0], text: '  原文  '}, rows[1]]
 assert.equal(validateCorrectionRows(padded, batch)[0].text, '  原文  ')
})

test('out-of-order completion waits for durable prefix and limits in-flight work to two', async () => {
 const gates = Array.from({length: 4}, deferred),
  launched: number[] = [],
  saved: number[] = []
 let active = 0,
  peak = 0
 const task = runCorrectionBatches(
  batches(),
  async (_batch: unknown, index: number) => {
   launched.push(index)
   active++
   peak = Math.max(peak, active)
   await gates[index].promise
   active--
   return index
  },
  (value: number) => saved.push(value)
 )
 assert.deepEqual(launched, [0, 1])
 gates[1].resolve()
 await new Promise(setImmediate)
 assert.deepEqual(saved, [])
 assert.deepEqual(launched, [0, 1])
 gates[0].resolve()
 await new Promise(setImmediate)
 assert.deepEqual(saved, [0, 1])
 assert.deepEqual(launched, [0, 1, 2, 3])
 gates[3].resolve()
 gates[2].resolve()
 await task
 assert.deepEqual(saved, [0, 1, 2, 3])
 assert.equal(peak, 2)
})

test('failed prefix aborts sibling and waits for even an abort-ignoring request; no later save', async () => {
 const fail = deferred(),
  late = deferred(),
  saved: number[] = [],
  launched: number[] = []
 let returned = false,
  siblingSignal: AbortSignal | undefined
 const task = runCorrectionBatches(
  batches(),
  async (_batch: unknown, index: number, signal: AbortSignal) => {
   launched.push(index)
   if (index === 0) {
    await fail.promise
    throw new Error('HTTP 429')
   }
   siblingSignal = signal
   await late.promise
   return index
  },
  (value: number) => saved.push(value)
 ).finally(() => {
  returned = true
 })
 const rejected = assert.rejects(task, /HTTP 429/)
 fail.resolve()
 await new Promise(setImmediate)
 assert.equal(siblingSignal?.aborted, true)
 assert.equal(returned, false)
 late.resolve()
 await rejected
 assert.deepEqual(saved, [])
 assert.deepEqual(launched, [0, 1])
})

test('cancel preserves first committed batch and resume never duplicates the saved prefix', async () => {
 const abort = new AbortController(),
  late = deferred(),
  saved: number[] = []
 const task = runCorrectionBatches(
  batches(),
  async (_batch: unknown, index: number) => {
   if (index === 1) await late.promise
   return index
  },
  (value: number) => saved.push(value),
  abort.signal
 )
 const rejected = assert.rejects(task)
 await new Promise(setImmediate)
 assert.deepEqual(saved, [0])
 abort.abort()
 late.resolve()
 await rejected
 assert.deepEqual(saved, [0])
 await runCorrectionBatches(
  batches().slice(saved.length),
  async (batch: {start: number}) => batch.start,
  (value: number) => saved.push(value)
 )
 assert.deepEqual(saved, [0, 1, 2, 3])
})

test('checkpoint write failure aborts work without committing later batches', async () => {
 let writes = 0
 await assert.rejects(
  runCorrectionBatches(
   batches(),
   async (_batch: unknown, index: number) => index,
   () => {
    writes++
    throw new Error('disk full')
   }
  ),
  /disk full/
 )
 assert.equal(writes, 1)
})

test('retrieves late matching pages, excludes duplicate block context and respects character budgets', () => {
 const rows = source(200),
  batch = {start: 50, rows: rows.slice(50, 100)}
 const ppt = Array.from(
  {length: 40},
  (_, i) => `[第 ${i + 1} 页]\n${i === 35 ? 'ATP 光合作用 公式 x²+1=0' : '星系 astronomy'}\n${'材料'.repeat(500)}`
 ).join('\n')
 const select = correctionContext(ppt, [{label: '第 36 页', url: 'data:image/png;base64,AAAA'}])
 for (const mode of ['quality', 'balanced', 'text']) {
  const result = select(batch, rows, mode)
  assert.match(result.courseware, /第 36 页/)
  assert.ok(result.courseware.length <= (mode === 'quality' ? 8000 : 4000))
  assert.ok(
   result.lectureContext.reduce((n: number, row: {text: string}) => n + row.text.length, 0) <=
    (mode === 'quality' ? 1200 : 800)
  )
  assert.ok(result.lectureContext.every((row: {id: number}) => row.id < 50 || row.id >= 100))
  assert.equal(result.images.length, mode === 'text' ? 0 : 1)
  assert.ok(result.omissions.length)
 }
})

test('only explicit quality policy attaches unmatched images; all policies enforce image byte budgets', () => {
 const rows = source(3),
  batch = {start: 0, rows},
  images = Array.from({length: 4}, (_, i) => ({label: `第 ${i + 1} 页`, url: 'data:image/png;base64,AAAA'}))
 const select = correctionContext('[第 1 页]\nastronomy', images)
 assert.ok(select(batch, rows, 'quality').images.length > 0)
 assert.equal(select(batch, rows, 'balanced').images.length, 0)
 assert.equal(select(batch, rows, 'text').images.length, 0)
 const oversized = correctionContext('[第 1 页]\nATP', [{label: '第 1 页', url: 'x'.repeat(900001)}])(
  batch,
  rows,
  'quality'
 )
 assert.equal(oversized.images.length, 0)
 assert.match(oversized.omissions.join(' '), /字节预算/)
 const total = correctionContext(
  '[第 1 页]\nATP\n[第 2 页]\nATP\n[第 3 页]\nATP',
  images.slice(0, 3).map(image => ({...image, url: 'x'.repeat(700000)}))
 )(batch, rows, 'quality')
 assert.equal(total.images.length, 2)
})

test('vision requirement follows selected image context', () => {
 const image = {label: '第 1 页', url: 'data:image/png;base64,AAAA'},
  withImage = {courseware: '', lectureContext: [], images: [image], omissions: []},
  withoutImage = {courseware: '', lectureContext: [], images: [], omissions: []}
 assert.equal(correctionNeedsVision([withImage], ''), true)
 assert.equal(correctionNeedsVision([withImage], '  '), true)
 assert.equal(correctionNeedsVision([withImage], 'vision-model'), false)
 assert.equal(correctionNeedsVision([withImage, withoutImage], ''), true)
 assert.equal(correctionNeedsVision([withoutImage], ''), false)
})

test('API freezes actual model/output settings and preserves Retry-After without leaking response body', async () => {
 const pinned = {
  model: 'pinned-text',
  visionModel: 'pinned-vision',
  baseUrl: 'https://example.invalid',
  apiKey: 'fixture-only',
  parameters: {'pinned-vision': {maxTokens: 2048}}
 }
 const settings = {
  profile: () => {
   throw new Error('must not reread active profile')
  },
  draft: (profile: typeof pinned) => ({...profile, key: profile.apiKey})
 }
 let sent: Record<string, unknown> = {}
 const api = new Api(settings, async (_url: string, init: RequestInit) => {
  sent = JSON.parse(String(init.body))
  return new Response(JSON.stringify({choices: [{message: {content: '[]'}, finish_reason: 'stop'}]}), {status: 200})
 })
 await api.json('fixture', {}, (value: unknown) => value, undefined, undefined, {
  profile: pinned,
  images: [{label: 'test', url: 'data:image/png;base64,AAAA'}]
 })
 assert.equal(sent.model, 'pinned-vision')
 assert.equal(sent.max_tokens, 2048)
 const throttled = new Api(
  settings,
  async () => new Response('private provider body', {status: 429, headers: {'retry-after': '7'}})
 )
 await assert.rejects(
  throttled.json('fixture', {}, (value: unknown) => value, undefined, undefined, {profile: pinned}),
  (error: Error & {retryAfterMs?: number}) => {
   assert.equal(error.retryAfterMs, 7000)
   assert.equal(isRetryableApiError(error), true)
   assert.doesNotMatch(error.message, /private provider/)
   return true
  }
 )
 assert.equal(isRetryableApiError(new DOMException('timed out', 'TimeoutError')), true)
})

test('cancel during API format retry delay is immediate and no second request escapes', async () => {
 const abort = new AbortController()
 let calls = 0,
  retries = 0
 const api = new Api({profile: () => ({model: 'fixture', baseUrl: 'https://example.invalid'})}, async () => {
  calls++
  return new Response(JSON.stringify({choices: [{message: {content: 'invalid JSON'}}]}), {status: 200})
 })
 await assert.rejects(
  api.json('fixture', {}, (value: unknown) => value, abort.signal, undefined, {
   onRetry: () => {
    retries++
    abort.abort()
   }
  })
 )
 assert.equal(calls, 1)
 assert.equal(retries, 1)
})
