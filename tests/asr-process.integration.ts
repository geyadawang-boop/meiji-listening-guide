import { app } from 'electron';
import assert from 'node:assert/strict';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { transcribeLocalVideo } from '../src/main/local-asr';
import { verifyNativeVisual } from './visual-frames.integration';
const root = process.cwd(), isolated = join(root, 'test-results/asr-onnx/runtime-' + randomUUID());
void (async () => {
await mkdir(isolated, { recursive: true }); app.setPath('userData', isolated);
app.getAppPath = () => root;
await app.whenReady();
try {
  const source = join(root, 'test-results/asr-onnx/chinese.wav'), original = await readFile(source);
  const cancel = new AbortController();
  await assert.rejects(transcribeLocalVideo(source, cancel.signal, message => { if (message.includes('载入')) cancel.abort(); }), /取消/);
  const afterCancel = await readdir(join(isolated, 'asr-tasks')); assert.equal(afterCancel.length, 1);
  assert.equal(JSON.parse(await readFile(join(isolated, 'asr-tasks', afterCancel[0], 'recovery.json'), 'utf8')).state, 'transcribing');
  const result = await transcribeLocalVideo(source, new AbortController().signal, console.log);
  assert.match(result.srt, /字幕/); assert.ok(result.count > 0); assert.deepEqual(await readFile(source), original);
  assert.equal((await readdir(join(isolated, 'asr-tasks'))).length, 2);
  const saved = join(isolated, 'final.srt'); await writeFile(saved, result.srt); assert.equal(await readFile(saved, 'utf8'), result.srt);
  await result.cleanup(); assert.equal((await readdir(join(isolated, 'asr-tasks'))).length, 1);
  const report = { realElectronUtilityProcess: true, nativeInference: true, cancellationVerified: true, failureRecoveryRetained: true, cleanupAfterSavedVerified: true, sourcePreserved: true, count: result.count };
  const visual = await verifyNativeVisual(root, isolated); console.log(JSON.stringify(visual));
  await writeFile(join(root, 'test-results/asr-onnx/visual-report.json'), JSON.stringify(visual, null, 2));
  await writeFile(join(root, 'test-results/asr-onnx/process-report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
} catch (error) { console.error(error); process.exitCode = 1; }
finally { app.exit(Number(process.exitCode || 0)); }
})();
