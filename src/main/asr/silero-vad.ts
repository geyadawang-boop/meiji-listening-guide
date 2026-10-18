// Silero V6 inference and thresholding adapted from faster-whisper's MIT VAD.
// The model is retained separately from its former Python runtime.
import {InferenceSession, Tensor} from 'onnxruntime-node'
export type SpeechRange = {start: number; end: number}
export function speechRanges(probabilities: readonly number[], samples: number): SpeechRange[] {
 const ranges: SpeechRange[] = []
 let start: number | undefined, silence: number | undefined
 for (const [index, probability] of probabilities.entries()) {
  if (!Number.isFinite(probability) || probability < 0 || probability > 1) throw new Error('语音检测返回无效概率')
  const position = index * 512
  if (probability >= 0.5) {
   silence = undefined
   if (start === undefined) start = position
  } else if (probability < 0.35 && start !== undefined) {
   silence ??= position
   if (position - silence >= 32000) {
    if (silence > start) ranges.push({start, end: silence})
    start = undefined
    silence = undefined
   }
  }
 }
 if (start !== undefined && samples > start) ranges.push({start, end: samples})
 for (const [index, range] of ranges.entries()) {
  if (index === 0) range.start = Math.max(0, range.start - 6400)
  const next = ranges[index + 1]
  if (next) {
   const gap = next.start - range.end
   if (gap < 12800) {
    range.end += Math.floor(gap / 2)
    next.start -= Math.floor(gap / 2)
   } else {
    range.end = Math.min(samples, range.end + 6400)
    next.start = Math.max(0, next.start - 6400)
   }
  } else range.end = Math.min(samples, range.end + 6400)
 }
 return ranges
}
export async function detectSpeech(audio: Float32Array, model: string): Promise<SpeechRange[]> {
 const session = await InferenceSession.create(model, {
  executionProviders: ['cpu'],
  intraOpNumThreads: 1,
  interOpNumThreads: 1
 })
 try {
  let h: Tensor = new Tensor('float32', new Float32Array(128), [1, 1, 128]),
   c: Tensor = new Tensor('float32', new Float32Array(128), [1, 1, 128])
  const probabilities: number[] = [],
   total = Math.ceil(audio.length / 512)
  for (let first = 0; first < total; first += 10000) {
   const count = Math.min(10000, total - first),
    input = new Float32Array(count * 576)
   for (let row = 0; row < count; row++) {
    const start = (first + row) * 512,
     offset = row * 576
    if (start) input.set(audio.subarray(start - 64, start), offset)
    input.set(audio.subarray(start, Math.min(start + 512, audio.length)), offset + 64)
   }
   const output = await session.run({input: new Tensor('float32', input, [count, 576]), h, c})
   const values = output[session.outputNames[0]].data
   if (!(values instanceof Float32Array) || values.length !== count) throw new Error('语音检测输出维度不符')
   probabilities.push(...values)
   h = output[session.outputNames[1]]
   c = output[session.outputNames[2]]
  }
  return speechRanges(probabilities, audio.length)
 } finally {
  await session.release()
 }
}
