import type {ParentPort} from 'electron'
import {open, stat} from 'node:fs/promises'
import {transcribePcm} from '@main/asr/asr-inference'

const port = (process as NodeJS.Process & {parentPort: ParentPort}).parentPort
const [modelPath, pcmPath] = process.argv.slice(2)
async function run() {
 if (!modelPath || !pcmPath || !port) throw new Error('转写工作进程参数无效')
 const size = (await stat(pcmPath)).size
 if (!size || size % 4) throw new Error('视频中没有完整的音频采样')
 const audio = new Float32Array(size / 4),
  handle = await open(pcmPath, 'r'),
  bytes = Buffer.alloc(1024 * 1024)
 try {
  let position = 0
  while (position < size) {
   const {bytesRead} = await handle.read(bytes, 0, Math.min(bytes.length, size - position), position)
   if (!bytesRead || bytesRead % 4) throw new Error('音频暂存文件不完整')
   for (let index = 0; index < bytesRead; index += 4) audio[(position + index) / 4] = bytes.readFloatLE(index)
   position += bytesRead
  }
 } finally {
  await handle.close()
 }
 const cues = await transcribePcm(audio, modelPath, message => port.postMessage({kind: 'progress', message}))
 port.postMessage({kind: 'result', cues, duration: audio.length / 16000})
}
void run().catch(error => {
 port?.postMessage({kind: 'error', message: error instanceof Error ? error.message : '字幕转写失败'})
 process.exitCode = 1
})
