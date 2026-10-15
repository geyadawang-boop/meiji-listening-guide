import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { generate } from '../scripts/runtime-manifest.mts';

describe('TypeScript runtime manifest generator', () => {
  it('hashes nested and streamed resources and keeps release version separate from Electron', async () => {
    const root = await mkdtemp(join(tmpdir(), 'meijiang-manifest-ts-'));
    try {
      await writeFile(join(root, 'package.json'), JSON.stringify({ version: '0.9.1', devDependencies: { electron: '42.11.10' } }));
      const bytes = Buffer.alloc(2 * 1024 * 1024 + 1, 77);
      const selected:Record<string,string>={knowledge:'onnx-bge/nested/model.bin',asr:'onnx-small/nested/model.bin',codex:'nested/codex.exe',video:'ffmpeg.exe'};
      for (const [id,name] of Object.entries(selected)) { const path=join(root,'resources',id,...name.split('/'));await mkdir(join(path,'..'),{recursive:true});await writeFile(path,bytes);await writeFile(join(root,'resources',id,'worker.py'),'legacy interpreter must not ship'); }
      await mkdir(join(root, 'resources/knowledge/__pycache__')); await writeFile(join(root, 'resources/knowledge/__pycache__/temporary.pyc'), 'not a runtime');
      const manifest = await generate(root);
      expect(manifest.productVersion).toBe('0.9.1'); expect(manifest.components).toHaveLength(4);
      for (const component of manifest.components) {
        expect(component.bytes).toBe(bytes.length);
        expect(component.files).toEqual([{ path: selected[component.id], size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }]);
        expect(component.files.some(file=>/\.(py|pyc)$/.test(file.path))).toBe(false);
      }
      expect(JSON.parse(await readFile(join(root, 'resources/runtime-manifest.json'), 'utf8'))).toEqual(manifest);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
