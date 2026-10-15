import assert from 'node:assert/strict'
import {mkdir,mkdtemp,open,writeFile} from 'node:fs/promises'
import {join,resolve,basename} from 'node:path'
import koffi from 'koffi'
import {WeixinProcessMemory} from '../src/main/im-weixin-process'
const base=resolve('test-results');await mkdir(base,{recursive:true});const directory=await mkdtemp(join(base,'native-weixin-process-')),root=join(directory,'synthetic-account'),file=join(root,'db_storage/contact/contact.db')
await mkdir(join(root,'db_storage/contact'),{recursive:true});await writeFile(file,Buffer.alloc(4096))
const handle=await open(file,'r'),known=Buffer.from('ONLY_OWN_PROCESS_FIXTURE'),address=Number(koffi.address(known))
let memory:WeixinProcessMemory|undefined
try{
 assert.throws(()=>new WeixinProcessMemory(process.pid),/进程已变化/)
 memory=new WeixinProcessMemory(process.pid,undefined,basename(process.execPath))
 assert.ok(Math.abs(memory.created-Date.now()/1000)<60)
 assert.equal(memory.exe.toLowerCase(),resolve(process.execPath).toLowerCase())
 assert.deepEqual(memory.read(address,known.length),known)
 assert.equal(memory.accountRoot().toLowerCase(),root.toLowerCase())
 assert.throws(()=>new WeixinProcessMemory(process.pid,memory!.created+1,basename(process.execPath)),/进程已变化/)
 memory.close();assert.throws(()=>memory!.guard(),/关闭/)
 const report={onlyOwnElectronProcess:true,noWechatProcessAccessed:true,nativeProcessIdentityAndCreationTime:true,selectedProcessMemoryRead:true,nativeHandleDuplicationAndUniqueDatabaseRoot:true,pidReuseGuard:true,closedHandleNotReadable:true,completeMigration:false}
 await writeFile(join(directory,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({directory,...report}))
}finally{memory?.close();await handle.close()}
