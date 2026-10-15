import {build} from 'esbuild'
import {spawnSync} from 'node:child_process'
import {join,resolve} from 'node:path'
const root=resolve('.')
await build({absWorkingDir:root,entryPoints:['src/main/media-process-guardian.ts'],outfile:'test-results/media-process-guardian.js',bundle:true,platform:'node',format:'esm',packages:'external'})
await build({absWorkingDir:root,entryPoints:['tests/media-download-runner.integration.ts'],outfile:'test-results/media-download-runner.integration.mjs',bundle:true,platform:'node',format:'esm',packages:'external'})
const result=spawnSync(process.execPath,[join(root,'test-results/media-download-runner.integration.mjs')],{cwd:root,stdio:'inherit',windowsHide:true})
if(result.error)throw result.error
process.exitCode=result.status??1
