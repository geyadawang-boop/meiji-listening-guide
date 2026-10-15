import assert from 'node:assert/strict'
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises'
import {join,resolve,sep} from 'node:path'
import {NativeNapcatRuntime} from '../src/main/im-napcat-runtime'
const base=resolve('test-results');await mkdir(base,{recursive:true});const directory=await mkdtemp(join(base,'native-napcat-')),runtimeRoot=join(directory,'runtime'),runtime=new NativeNapcatRuntime(resolve('resources'),runtimeRoot)
try{
 const prepared=await runtime.prepare(),again=await runtime.prepare();assert.equal(prepared.directory,again.directory)
 assert.notEqual(prepared.value.onebot_port,prepared.value.webui_port);assert.equal(runtime.status().owned_running,false)
 const config=JSON.parse(await readFile(join(prepared.directory,'napcat/config/webui.json'),'utf8'));assert.equal(config.host,'127.0.0.1');assert.equal(config.autoLoginAccount,'');assert.equal(config.token,prepared.value.webui_token)
 const encrypted=await readFile(join(runtimeRoot,'native-owner.dpapi'));assert.equal(encrypted.includes(prepared.value.webui_token),false);assert.equal(encrypted.includes(prepared.value.onebot_token),false)
 const executable=join(prepared.directory,'index.js'),original=await readFile(executable);await writeFile(executable,Buffer.concat([original,Buffer.from('//modified fixture')]))
 await assert.rejects(()=>runtime.prepare(),/执行文件已改变/);await writeFile(executable,original)
 const report={pinnedActualArchivePrepared:true,repeatedPreparationValidated:true,encryptedLocalTokens:true,loopbackOnlyConfiguration:true,noAutomaticAccountLogin:true,changedExecutableRefused:true,qqNotStarted:true,userAccountUsed:false,completeMigration:false}
 runtime.dispose()
 if(!resolve(runtimeRoot).startsWith(resolve(directory)+sep))throw new Error('测试清理路径越界')
 await rm(runtimeRoot,{recursive:true,force:true});await writeFile(join(directory,'report.json'),JSON.stringify({...report,generatedRuntimeRemoved:true},null,2));console.log(JSON.stringify({directory,...report,generatedRuntimeRemoved:true}))
}finally{runtime.dispose()}
