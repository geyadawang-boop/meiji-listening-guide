import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
await build({ absWorkingDir: root, entryPoints: ['tests/integration.ts'], outfile: 'test-results/integration.mjs', bundle: true, platform: 'node', format: 'esm', packages: 'external' });
const result = spawnSync(join(root, 'node_modules/electron/dist/electron.exe'), [join(root, 'test-results/integration.mjs')], { cwd: root, stdio: 'inherit', windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
