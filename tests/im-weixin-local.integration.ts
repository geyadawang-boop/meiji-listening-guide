import assert from 'node:assert/strict'
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {NativeWeixinLocal} from '../src/main/im-weixin-local'
const base=resolve('test-results');await mkdir(base,{recursive:true});const directory=await mkdtemp(join(base,'native-weixin-local-'))
const reader=new NativeWeixinLocal(),input={connection_id:'fixture-only',account:'fixture',session:{reader_id:'not-a-live-reader'}}
try{
 await assert.rejects(()=>reader.request('verify',input),/绑定已失效/)
 await assert.rejects(()=>reader.request('receive',{...input,peer:'fixture-peer'}),/绑定已失效/)
 const cancelled=new AbortController(),pending=reader.request('verify',input,cancelled.signal);cancelled.abort();await assert.rejects(()=>pending,/进程已中断/)
 await assert.rejects(()=>reader.request('verify',input),/绑定已失效/)
 await reader.dispose();await assert.rejects(()=>reader.request('verify',input),/后台已关闭/)
 const report={actualIndependentElectronChild:true,nativeCipherAddonLoaded:true,windowsJobAdoptionBeforeRequests:true,abortedChildTerminated:true,staleReaderRejected:true,noAutomaticAccountRestore:true,noWechatProcessScanned:true,noKeyOrSourceMessageAcrossIpc:true,closedReaderCannotRestart:true,completeMigration:false}
 await writeFile(join(directory,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({directory,...report}))
}finally{await reader.dispose()}
