import {app} from 'electron'
import assert from 'node:assert/strict'
import {readFile, writeFile} from 'node:fs/promises'
import {join, resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
const work = process.env.MEIJI_ASR_WORK!,
 results = process.env.MEIJI_ASR_RESULTS!
if (!work || !results) throw new Error('Missing isolated ASR fixture scope')
app.setName('Meiji ASR Runtime Fixture')
app.setPath('userData', join(work, 'profile'))
async function run() {
 await app.whenReady()
 const report: Record<string, unknown> = {
   status: 'running',
   electron: process.versions.electron,
   platform: process.platform,
   arch: process.arch,
   scope:
    'Real production local ASR, utilityProcess and CPU ONNX with ordinary system TTS; not a user-audio or broad accuracy evaluation.'
  },
  progress: string[] = []
 try {
  assert.equal(resolve(app.getAppPath()), resolve(work))
  assert.equal(app.isPackaged, false)
  const {transcribeLocalVideo, parseSrt} = await import(pathToFileURL(join(work, 'owner.mjs')).href)
  const audio = JSON.parse(await readFile(join(work, 'audio.json'), 'utf8'))
  const speech = await transcribeLocalVideo(join(work, 'speech.wav'), new AbortController().signal, (message: string) =>
   progress.push(message)
  )
  const cues = parseSrt(speech.srt) as Array<{start: number; end: number; text: string}>
  assert(cues.length > 0)
  assert.equal(speech.count, cues.length)
  let lastEnd = 0
  for (const cue of cues) {
   assert(cue.text.trim())
   assert(Number.isFinite(cue.start) && Number.isFinite(cue.end))
   assert(cue.start >= lastEnd && cue.end > cue.start && cue.end <= audio.duration * 1000 + 1)
   lastEnd = cue.end
  }
  const text = cues
   .map(c => c.text)
   .join('')
   .replace(/[\p{P}\p{Z}\s]/gu, '')
  const keywords = ['学习', '数学', '课本', '练习'],
   matched = keywords.filter(word => text.includes(word))
  assert(matched.length >= 3, 'Synthetic Chinese speech did not meet the bounded keyword oracle')
  await assert.rejects(
   transcribeLocalVideo(join(work, 'silence.wav'), new AbortController().signal, (message: string) =>
    progress.push(message)
   ),
   /未检测到语音/
  )
  report.status = 'passed'
  report.chineseTranscription = 'verified'
  report.cues = cues
  report.keywordMatches = matched
  report.inputDuration = audio.duration
  report.silence = 'rejected without speech'
  report.progress = progress
  await writeFile(join(results, 'synthetic-transcript.srt'), speech.srt)
 } catch (error) {
  report.status = 'failed'
  report.error = error instanceof Error ? error.message : 'Unknown inference failure'
  report.progress = progress
 } finally {
  await writeFile(join(results, 'inference.json'), JSON.stringify(report, null, 2) + '\n')
  app.exit(report.status === 'passed' ? 0 : 1)
 }
}
void run().catch(async error => {
 await writeFile(join(results, 'inference.json'), JSON.stringify({status: 'failed', error: error.message}))
 app.exit(1)
})
