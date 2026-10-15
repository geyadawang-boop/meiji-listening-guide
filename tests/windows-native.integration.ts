import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {resolve,join} from 'node:path'
import {NativeWindowsJob,windowsArgument,windowsProtect} from '../src/main/windows-native'
const root=resolve('test-results');mkdirSync(root,{recursive:true});const directory=mkdtempSync(join(root,'windows-native-'))
if(process.argv[2]==='owned-owner'){
 const owner=new NativeWindowsJob(),child=owner.spawn([process.execPath,process.argv[4]],directory,{...process.env,ELECTRON_RUN_AS_NODE:'1'})
 writeFileSync(process.argv[3],String(child.pid));process.exit(0)
}
const original=Buffer.from('仅隔离的系统加密测试，不含用户凭据。'),sealed=windowsProtect(original)
assert.ok(!sealed.equals(original));assert.deepEqual(windowsProtect(sealed,true),original);assert.throws(()=>windowsProtect(Buffer.from('not a valid DPAPI blob'),true))
assert.equal(windowsArgument('a b'),'"a b"');assert.equal(windowsArgument('C:\\a b\\'),'"C:\\a b\\\\"')
const childScript=join(directory,'owned-child.cjs');writeFileSync(childScript,'setInterval(()=>{},1000)')
const job=new NativeWindowsJob();let pid=0
try{
 const child=job.spawn([process.execPath,childScript],directory,{...process.env,ELECTRON_RUN_AS_NODE:'1'});pid=child.pid;assert.equal(child.poll(),null);process.kill(pid,0)
 job.close()
 for(let i=0;i<100;i++){try{process.kill(pid,0)}catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH'){pid=0;break}throw error}await new Promise(resolve=>setTimeout(resolve,25))}
 assert.equal(pid,0,'Job 关闭后子进程必须停止')
}finally{job.close()}
const receipt=join(directory,'owned-crash-pid.txt'),exited=spawnSync(process.execPath,[fileURLToPath(import.meta.url),'owned-owner',receipt,childScript],{windowsHide:true,env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},encoding:'utf8'})
assert.equal(exited.status,0,exited.stderr)
const orphanPid=Number(readFileSync(receipt,'utf8'));let gone=false
for(let i=0;i<100;i++){try{process.kill(orphanPid,0)}catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH'){gone=true;break}throw error}await new Promise(resolve=>setTimeout(resolve,25))}
assert.equal(gone,true,'所属进程退出后子进程必须停止')
const report={realWindowsDpapiRoundTrip:true,invalidCiphertextRejected:true,nativeAtomicJobSpawn:true,jobCloseStopsOwnedProcess:true,ownerExitStopsOwnedProcess:true,noPython:true,userSecretsUsed:false,completeMigration:false}
writeFileSync(join(directory,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({directory,...report}))
