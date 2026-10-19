import {env, pipeline} from '@huggingface/transformers'
import {createHash} from 'node:crypto'
import {createReadStream} from 'node:fs'
import {readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {z} from 'zod'
import {detectSpeech} from '@main/asr/silero-vad'

export type AsrCue = {from: number; to: number; content: string}
const chunksSchema = z.array(
 z.object({text: z.string(), timestamp: z.tuple([z.number().nullable(), z.number().nullable()])})
)
export function timestampedCues(input: unknown, duration: number): AsrCue[] {
 if (!Number.isFinite(duration) || duration <= 0) throw new Error('音频长度无效')
 const chunks = chunksSchema.parse(input),
  cues: AsrCue[] = []
 for (const [index, chunk] of chunks.entries()) {
  const from = chunk.timestamp[0],
   to = chunk.timestamp[1] ?? (index === chunks.length - 1 ? duration : chunks[index + 1].timestamp[0])
  if (!chunk.text.trim()) continue
  if (
   from === null ||
   to === null ||
   !Number.isFinite(from) ||
   !Number.isFinite(to) ||
   from < 0 ||
   to <= from ||
   from >= duration ||
   to > duration + 1
  )
   throw new Error('转写结果缺少可靠的字幕时间点')
  cues.push({from, to: Math.min(to, duration), content: chunk.text.trim()})
 }
 return cues
}
export async function transcribePcm(
 audio: Float32Array,
 modelPath: string,
 progress: (message: string) => void = () => {},
 language = 'chinese'
): Promise<AsrCue[]> {
 if (!audio.length || audio.some(sample => !Number.isFinite(sample))) throw new Error('音频采样无效')
 const manifest = z
  .object({
   repository: z.literal('onnx-community/whisper-small'),
   revision: z.literal('36050c46d777d46dc4b5f43f6d90574fc38f8732'),
   files: z.array(
    z.object({path: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/), size: z.number().int().nonnegative()})
   )
  })
  .parse(JSON.parse(await readFile(join(modelPath, 'acquisition.json'), 'utf8')))
 for (const file of manifest.files) {
  if (
   file.path.includes('\\') ||
   file.path.startsWith('/') ||
   file.path.includes(':') ||
   file.path.split('/').includes('..')
  )
   throw new Error('模型清单路径无效')
  const hash = createHash('sha256')
  let size = 0
  for await (const bytes of createReadStream(join(modelPath, file.path))) {
   hash.update(bytes)
   size += bytes.length
  }
  if (size !== file.size || hash.digest('hex') !== file.sha256)
   throw new Error('离线模型校验失败，请重新安装同版本组件')
 }
 // Model loading and inference use local bytes only. No user audio is sent out.
 env.allowRemoteModels = false
 env.allowLocalModels = true
 env.useFSCache = false
 progress('正在识别语音范围并保留原始时间点')
 const ranges = await detectSpeech(audio, join(modelPath, 'silero-vad-v6.onnx'))
 if (!ranges.length) throw new Error('未检测到语音，原视频保留以便检查')
 progress('正在载入本地字幕模型')
 const transcriber = await pipeline('automatic-speech-recognition', modelPath.replaceAll('\\', '/'), {
  local_files_only: true,
  device: 'cpu',
  dtype: 'q8',
  session_options: {intraOpNumThreads: 4, interOpNumThreads: 1}
 })
 try {
  progress(`正在转写完整音频（${Math.round(audio.length / 16000)} 秒）`)
  const cues: AsrCue[] = []
  for (const [index, range] of ranges.entries()) {
   progress(`正在转写语音片段 ${index + 1}/${ranges.length}（原视频 ${Math.round(range.start / 16000)} 秒）`)
   const result = await transcriber(audio.subarray(range.start, range.end), {
    language,
    task: 'transcribe',
    return_timestamps: true,
    chunk_length_s: 30,
    stride_length_s: 5
   })
   cues.push(
    ...timestampedCues(result.chunks, (range.end - range.start) / 16000).map(cue => ({
     ...cue,
     from: cue.from + range.start / 16000,
     to: cue.to + range.start / 16000
    }))
   )
  }
  if (!cues.length) throw new Error('未识别到语音，原视频保留以便检查')
  return cues
 } finally {
  await transcriber.dispose()
 }
}
