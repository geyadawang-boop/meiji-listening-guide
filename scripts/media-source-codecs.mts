import {fork} from 'node:child_process'
import {once} from 'node:events'
import {createHash} from 'node:crypto'
import {join} from 'node:path'
import {readFile, writeFile} from 'node:fs/promises'
function check(value: unknown, message: string): asserts value {
 if (!value) throw new Error(message)
}
async function noLongerRunning(pid: number) {
 const until = Date.now() + 5000
 while (Date.now() < until) {
  try {
   process.kill(pid, 0)
  } catch (error) {
   if ((error as NodeJS.ErrnoException).code === 'ESRCH') return
   throw error
  }
  await new Promise(resolveDelay => setTimeout(resolveDelay, 50))
 }
 throw new Error('The guardian-owned media process remained alive after shutdown')
}
async function guardian(
 entry: string,
 resources: string,
 tool: 'ffmpeg' | 'ffprobe',
 args: string[],
 stop?: 'cancel' | 'disconnect',
 env?: NodeJS.ProcessEnv
) {
 return await new Promise<{code: number; stdout: Buffer; stderr: string; stop?: string; childExited?: boolean}>(
  (done, fail) => {
   const child = fork(entry, [resources, tool], {stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true, env})
   const streamsClosed = Promise.all([once(child.stdout!, 'close'), once(child.stderr!, 'close')])
   const stdoutChunks: Buffer[] = [],
    stderrChunks: Buffer[] = []
   let outputBytes = 0,
    pid: number | undefined,
    stopping = false,
    failure = ''
   const timer = setTimeout(() => {
    failure = 'Guardian timed out'
    if (child.connected) child.disconnect()
    // Give the owned guardian time to process disconnect before terminating it.
    setTimeout(() => {
     child.kill()
     fail(new Error(failure))
    }, 3000).unref()
   }, 30000)
   const capture = (target: 'stdout' | 'stderr', data: Buffer) => {
    if (failure) return
    outputBytes += data.length
    if (outputBytes > 256000) {
     failure = 'Guardian output exceeded budget'
     if (child.connected) child.disconnect()
     return
    }
    ;(target === 'stdout' ? stdoutChunks : stderrChunks).push(data)
   }
   child.stdout!.on('data', data => capture('stdout', data))
   child.stderr!.on('data', data => capture('stderr', data))
   child.once('error', error => {
    clearTimeout(timer)
    fail(error)
   })
   void streamsClosed.catch(error => {
    clearTimeout(timer)
    fail(error)
   })
   child.on('message', value => {
    const message = value as {kind?: string; pid?: number}
    if (message.kind !== 'media-started') return
    if (!Number.isSafeInteger(message.pid) || message.pid! <= 0 || pid !== undefined) {
     failure = 'Invalid guardian child identity'
     if (child.connected) child.disconnect()
     return
    }
    pid = message.pid
    if (stop)
     setTimeout(() => {
      stopping = true
      if (stop === 'disconnect') {
       if (child.connected) child.disconnect()
      } else if (child.connected) child.send({kind: 'cancel'})
     }, 300)
   })
   // Explicit parent IPC disconnect can omit ChildProcess 'close' on Windows Node.
   // Await the process exit and both actual output pipes independently instead.
   child.once('exit', (code, signal) => {
    void (async () => {
     await streamsClosed
     clearTimeout(timer)
     const stdout = Buffer.concat(stdoutChunks),
      stderr = Buffer.concat(stderrChunks).toString('utf8')
     check(!failure, failure)
     check(pid, 'Guardian did not confirm starting the real binary')
     check(
      signal === null && code === (stop ? 130 : 0),
      'Guardian failed: ' + code + '/' + signal + '\n' + stderr.slice(-3000)
     )
     if (stop) {
      check(stopping, 'Binary finished before requested shutdown')
      await noLongerRunning(pid)
     }
     done({code, stdout, stderr, ...(stop ? {stop, childExited: true} : {})})
    })().catch(fail)
   })
   child.send({kind: 'start', args})
  }
 )
}

export async function verifySourceCodecs(
 entry: string,
 resources: string,
 work: string,
 env: NodeJS.ProcessEnv,
 diagnosticsPath = join(work, 'codec-diagnostics.json')
) {
 const invoke = (tool: 'ffmpeg' | 'ffprobe', args: string[], stop?: 'cancel' | 'disconnect') =>
  guardian(entry, resources, tool, args, stop, env)
 const run = (args: string[]) => invoke('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', ...args])
 const probe = async (file: string) =>
  JSON.parse(
   (
    await invoke('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-show_chapters', '-of', 'json', file])
   ).stdout.toString('utf8')
  )
 const checks: string[] = []
 for (const [flag, names] of [
  [
   '-encoders',
   [
    'libx264',
    'libvpx-vp9',
    'libmp3lame',
    'libopus',
    'libvorbis',
    'aac',
    'flac',
    'pcm_s16le',
    'pcm_f32le',
    'png',
    'mjpeg',
    'srt'
   ]
  ],
  ['-filters', ['fps', 'crop', 'scale', 'format', 'trim', 'setpts', 'atrim', 'asetpts', 'concat']],
  [
   '-demuxers',
   ['mov', 'matroska', 'flv', 'mp3', 'aac', 'ogg', 'wav', 'flac', 'mpegts', 'concat', 'image2', 'srt', 'ffmetadata']
  ],
  [
   '-muxers',
   ['matroska', 'mp4', 'webm', 'ipod', 'mp3', 'opus', 'flac', 'wav', 'adts', 'ogg', 'image2', 'rawvideo', 'f32le']
  ],
  ['-protocols', ['file', 'pipe']]
 ] as const) {
  const capabilities = await invoke('ffmpeg', ['-hide_banner', flag])
  const tokens = (capabilities.stdout.toString('utf8') + '\n' + capabilities.stderr).split(/[\s,]+/)
  for (const name of names) check(tokens.includes(name), 'Missing capability ' + flag + ': ' + name)
 }
 checks.push('application encoder/filter/demuxer/muxer/protocol capability matrix')
 const video = join(work, 'h264.mp4')
 await run([
  '-f',
  'lavfi',
  '-i',
  'color=c=red:s=32x32:r=10',
  '-f',
  'lavfi',
  '-i',
  'sine=frequency=440:sample_rate=48000',
  '-t',
  '1',
  '-c:v',
  'libx264',
  '-preset',
  'fast',
  '-c:a',
  'aac',
  video
 ])
 const primaryCodecs = (await probe(video)).streams.map((s: {codec_name: string}) => s.codec_name)
 check(primaryCodecs.includes('h264') && primaryCodecs.includes('aac'), 'H264/AAC encoding failed')
 checks.push('libx264 H264 and AAC MP4')
 const webm = join(work, 'vp9.webm')
 await run(['-i', video, '-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-c:a', 'libopus', webm])
 const webmStreams = (await probe(webm)).streams.map((s: {codec_name: string}) => s.codec_name)
 check(webmStreams.includes('vp9') && webmStreams.includes('opus'), 'VP9/Opus encoding failed')
 checks.push('libvpx-vp9 and libopus WebM')
 for (const [encoder, extension, expected] of [
  ['libmp3lame', 'mp3', 'mp3'],
  ['libopus', 'opus', 'opus'],
  ['libvorbis', 'ogg', 'vorbis'],
  ['aac', 'm4a', 'aac'],
  ['flac', 'flac', 'flac'],
  ['pcm_s16le', 'wav', 'pcm_s16le']
 ]) {
  const file = join(work, 'audio.' + extension)
  await run(['-i', video, '-vn', '-c:a', encoder, file])
  check((await probe(file)).streams[0].codec_name === expected, 'Audio codec failed: ' + encoder)
  checks.push(encoder + ' actual encode/probe')
 }
 const pcm = join(work, 'asr.f32')
 await run(['-i', video, '-vn', '-ac', '1', '-ar', '16000', '-t', '0.5', '-f', 'f32le', pcm])
 const samples = await readFile(pcm)
 check(samples.length === 8000 * 4, 'ASR float32 mono16k size mismatch')
 for (let i = 0; i < samples.length; i += 4) check(Number.isFinite(samples.readFloatLE(i)), 'Non-finite ASR sample')
 checks.push('ASR f32le mono16k finite samples')
 for (const extension of ['png', 'jpg']) {
  const file = join(work, 'frame.' + extension)
  await run(['-i', video, '-frames:v', '1', '-vf', 'crop=16:16,scale=32:32', file])
  check((await probe(file)).streams[0].width === 32, 'Image extraction failed')
  checks.push(extension + ' crop/scale extraction')
 }
 const raw = await invoke('ffmpeg', [
  '-v',
  'error',
  '-i',
  video,
  '-an',
  '-vf',
  'fps=2,crop=16:16,scale=32:18,format=gray',
  '-f',
  'rawvideo',
  'pipe:1'
 ])
 const rawDiagnostics = {
  expectedBytes: 2 * 32 * 18,
  actualBytes: raw.stdout.length,
  sha256: createHash('sha256').update(raw.stdout).digest('hex'),
  minimumByte: Math.min(...raw.stdout),
  maximumByte: Math.max(...raw.stdout),
  utf8RoundtripBytes: Buffer.byteLength(raw.stdout.toString('utf8'))
 }
 await writeFile(diagnosticsPath, JSON.stringify({grayRawvideo: rawDiagnostics}, null, 2) + '\n')
 console.log(JSON.stringify({grayRawvideo: rawDiagnostics}))
 check(
  raw.stdout.length === rawDiagnostics.expectedBytes,
  'Gray rawvideo frame size mismatch: ' + JSON.stringify(rawDiagnostics)
 )
 check(
  raw.stdout.every(value => Math.abs(value - 76) <= 1),
  'Uniform red input produced nonuniform gray pixels: ' + JSON.stringify(rawDiagnostics)
 )
 checks.push('fps/crop/scale/format gray rawvideo pipe')
 const filter = join(work, 'edit.filter'),
  edited = join(work, 'edited.mp4')
 await writeFile(
  filter,
  '[0:v]trim=start=0:end=0.3,setpts=PTS-STARTPTS[v0];[0:a]atrim=start=0:end=0.3,asetpts=PTS-STARTPTS[a0];[0:v]trim=start=0.6:end=0.9,setpts=PTS-STARTPTS[v1];[0:a]atrim=start=0.6:end=0.9,asetpts=PTS-STARTPTS[a1];[v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]'
 )
 await run([
  '-i',
  video,
  '-filter_complex_script',
  filter,
  '-map',
  '[v]',
  '-map',
  '[a]',
  '-c:v',
  'libx264',
  '-c:a',
  'aac',
  edited
 ])
 const editedDuration = Number((await probe(edited)).format.duration)
 check(editedDuration > 0.5 && editedDuration < 0.8, 'Trim/concat duration failed')
 checks.push('trim/setpts/atrim/asetpts/concat filter script')
 const list = join(work, 'list.ffconcat'),
  combined = join(work, 'combined.mp4')
 await writeFile(list, "ffconcat version 1.0\nfile 'h264.mp4'\nfile 'h264.mp4'\n")
 await run(['-protocol_whitelist', 'file,pipe', '-f', 'concat', '-safe', '1', '-i', list, '-c', 'copy', combined])
 const combinedDuration = Number((await probe(combined)).format.duration)
 check(combinedDuration > 1.8 && combinedDuration < 2.3, 'Concat demuxer failed')
 checks.push('concat demuxer file/pipe stream copy')
 const srt = join(work, 'subtitle.srt'),
  metadata = join(work, 'chapters.txt'),
  decorated = join(work, 'decorated.mkv')
 await writeFile(srt, '1\n00:00:00,000 --> 00:00:00,500\nSynthetic caption\n')
 await writeFile(metadata, ';FFMETADATA1\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=500\ntitle=Synthetic chapter\n')
 await run([
  '-i',
  video,
  '-f',
  'srt',
  '-i',
  srt,
  '-f',
  'ffmetadata',
  '-i',
  metadata,
  '-map',
  '0',
  '-map',
  '1',
  '-map_chapters',
  '2',
  '-c',
  'copy',
  '-c:s',
  'srt',
  '-attach',
  join(work, 'frame.jpg'),
  '-metadata:s:t',
  'mimetype=image/jpeg',
  '-metadata:s:t',
  'filename=frame.jpg',
  decorated
 ])
 const decoratedMeta = await probe(decorated)
 check(
  decoratedMeta.streams.some(
   (s: {codec_type: string; tags?: {filename?: string; mimetype?: string}; disposition?: {attached_pic?: number}}) =>
    (s.codec_type === 'attachment' || s.disposition?.attached_pic === 1) &&
    s.tags?.filename === 'frame.jpg' &&
    s.tags?.mimetype === 'image/jpeg'
  ),
  'JPEG attachment metadata missing'
 )
 check(
  decoratedMeta.streams.some((s: {codec_type: string}) => s.codec_type === 'subtitle') &&
   decoratedMeta.chapters.length === 1,
  'Subtitle/chapter mux failed'
 )
 checks.push('SRT, ffmetadata chapter and JPEG Matroska attachment')
 const infinite = ['-v', 'error', '-re', '-f', 'lavfi', '-i', 'color=s=16x16:r=5', '-f', 'null', '-']
 const cancel = await invoke('ffmpeg', infinite, 'cancel'),
  disconnect = await invoke('ffmpeg', infinite, 'disconnect')
 return {
  checks,
  rawDiagnostics,
  cancel: {...cancel, stdout: cancel.stdout.toString('utf8')},
  disconnect: {...disconnect, stdout: disconnect.stdout.toString('utf8')},
  scope: 'Synthetic application codec paths, not real account, model vision quality or ASR model inference.'
 }
}
