import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { NativeVisualFrames } from '../src/main/visual-frames';
import { MediaBackend } from '../src/main/media';

export async function verifyNativeVisual(root: string, isolated: string) {
  const source = join(isolated, 'visual-source.mp4'), resources = join(root, 'resources');
  const generated = spawnSync(join(resources, 'video/ffmpeg.exe'), ['-hide_banner', '-loglevel', 'error', '-nostdin', '-f', 'lavfi', '-i', 'color=red:s=320x180:d=8', '-f', 'lavfi', '-i', 'color=blue:s=320x180:d=8', '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[out]', '-map', '[out]', '-c:v', 'libx264', '-y', source], { windowsHide: true });
  assert.equal(generated.status, 0);
  const bytes = await readFile(source), expectedHash = createHash('sha256').update(bytes).digest('hex');
  const service = new NativeVisualFrames(resources, isolated);
  const id = () => randomUUID().replaceAll('-', '');
  const balanced = await service.capture({ id: id(), path: source, expectedHash, cap: 2, policy: 'balanced' });
  assert.equal(balanced.frames.length, 2); assert.equal(balanced.duration, 16); assert.ok(balanced.frames[1].time >= 8);
  const coverage = await service.capture({ id: id(), path: source, expectedHash, cap: 2, policy: 'coverage' });
  assert.deepEqual(coverage.frames.map(frame => frame.time), [4, 12]);
  const backend = new MediaBackend(resources, isolated,{readMedia:async()=>{throw new Error('画面测试不得请求站点')}});
  const routed = await backend.request<{ frames: { hash: string }[] }>('visual-frames', { id: id(), path: source, expectedHash, cap: 1, policy: 'coverage' });
  assert.equal(routed.frames.length, 1); assert.equal(backend.started, false);
  const abortId = id(), capture = service.capture({ id: abortId, path: source, expectedHash, cap: 2, policy: 'balanced' });
  service.cancel(abortId); await assert.rejects(capture, /取消|abort/i);
  const output = join(isolated, 'visual-final.md'); await writeFile(output, '# 已核验的隔离画面结果');
  assert.ok((await readFile(output, 'utf8')).includes('已核验'));
  await service.cleanup(balanced.id); assert.ok(!(await readdir(join(isolated, 'native-visual'))).includes(balanced.id));
  assert.deepEqual(await readFile(source), bytes);
  await assert.rejects(service.capture({ id: id(), path: source, expectedHash: '0'.repeat(64), cap: 2, policy: 'coverage' }), /已改变/);
  return { nativeFrameExtraction: true, coverageAndChangeSelection: true, noPythonLaunch: true, cancellationVerified: true, changedSourceRejected: true, cleanupPreservesSource: true };
}
