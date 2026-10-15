import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
await build({ absWorkingDir: root, entryPoints: ['tests/knowledge-process.integration.ts'], outfile: 'out/main/knowledge-runtime-check.mjs', bundle: true, platform: 'node', format: 'esm', packages: 'external' });
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const result = spawnSync(join(root, 'node_modules/electron/dist/electron.exe'), [join(root, 'out/main/knowledge-runtime-check.mjs')], { cwd: root, env, stdio: 'inherit', windowsHide: true });
if (result.error) throw result.error; process.exitCode = result.status ?? 1;
