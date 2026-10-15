import {build} from 'esbuild'
import {spawnSync} from 'node:child_process'
import {join,resolve} from 'node:path'
const root=resolve('.')
await build({absWorkingDir:root,entryPoints:['tests/im-weixin-web.integration.ts'],outfile:'test-results/im-weixin-web.integration.mjs',bundle:true,platform:'node',format:'esm',packages:'external'})
const result=spawnSync(join(root,'node_modules/electron/dist/electron.exe'),[join(root,'test-results/im-weixin-web.integration.mjs')],{cwd:root,stdio:'inherit',windowsHide:true,env:{...process.env,ELECTRON_RUN_AS_NODE:'1'}})
if(result.error)throw result.error
process.exitCode=result.status??1
