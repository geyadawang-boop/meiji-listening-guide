import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { transcribePcm } from '../src/main/asr-inference';
const root = process.cwd(), start = Date.now();
const decoded = spawnSync(join(root, 'resources/video/ffmpeg.exe'), ['-hide_banner', '-loglevel', 'error', '-nostdin', '-i', join(root, 'test-results/asr-onnx/chinese.wav'), '-ac', '1', '-ar', '16000', '-f', 'f32le', 'pipe:1'], { windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
assert.equal(decoded.status, 0); assert.equal(decoded.stdout.length % 4, 0);
const audio = new Float32Array(decoded.stdout.length / 4); for (let index = 0; index < audio.length; index++) audio[index] = decoded.stdout.readFloatLE(index * 4);
const cues = await transcribePcm(audio, join(root, 'resources/asr/onnx-small'), console.log);
const text = cues.map(cue => cue.content).join('');
assert.match(text, /字幕/); assert.match(text, /重点|重點/);
assert.ok(cues.every(cue => cue.from >= 0 && cue.to > cue.from && cue.to <= audio.length / 16000));
if (process.argv.includes('--gap')) {
  const secondStart = 75 * 16000, extended = new Float32Array(secondStart + audio.length + 16000 * 3);
  extended.set(audio); extended.set(audio, secondStart);
  const gapCues = await transcribePcm(extended, join(root, 'resources/asr/onnx-small'), console.log);
  assert.ok(gapCues.some(cue => cue.from >= 75));
  assert.ok(gapCues.every(cue => cue.to < audio.length / 16000 + 1 || cue.from >= 74));
  await writeFile(join(root, 'test-results/asr-onnx/gap-report.json'), JSON.stringify({ silenceGapVerified: true, totalSeconds: extended.length / 16000, originalTimingPreserved: true, cues: gapCues }, null, 2));
}
await writeFile(join(root, 'test-results/asr-onnx/report.json'), JSON.stringify({ actualOfflineInference: true, syntheticChineseOnly: true, longVideoVerified: false, duration: audio.length / 16000, elapsed: (Date.now() - start) / 1000, cues }, null, 2));
console.log(JSON.stringify({ actualOfflineInference: true, text, count: cues.length, elapsed: (Date.now() - start) / 1000 }));
