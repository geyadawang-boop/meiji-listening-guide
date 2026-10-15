import assert from 'node:assert/strict'
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {NativeImStore} from '../src/main/im-store'
import {NativeImService} from '../src/main/im-service'
const base=resolve('test-results');await mkdir(base,{recursive:true});const directory=await mkdtemp(join(base,'native-im-')),op=()=>randomUUID().replaceAll('-','')
let loggedIn=false,sends=0,requestCount=0,loseReply=false,modelCalls=0
let reply:()=>Promise<string>=async()=> '隔离草稿回复'
const history=[{self_id:1234567,user_id:7654321,message_id:1,time:100,sender:{user_id:7654321},message:[{type:'text',data:{text:'仅隔离消息'}}]}]
const fetcher:typeof fetch=async(input,init)=>{
 const url=new URL(String(input)),body=JSON.parse(String(init?.body||'{}'));requestCount++
 assert.equal(url.hostname,'127.0.0.1');assert.equal(init?.redirect,'error')
 let data:unknown
 if(url.pathname.startsWith('/api/')){
  if(url.pathname.endsWith('auth/login'))data={Credential:'synthetic-webui-credential'}
  else if(url.pathname.endsWith('CheckLoginStatus'))data={isLogin:loggedIn,...!loggedIn?{qrcodeurl:'https://qrcode.qq.com/synthetic-login'}:{}}
  else if(url.pathname.endsWith('GetQQLoginInfo'))data={online:true,uin:'1234567'}
  else throw new Error('unexpected management operation')
  return Response.json({code:0,data})
 }
 if(url.pathname==='/get_login_info')data={user_id:1234567}
 else if(url.pathname==='/get_status')data={online:true,good:true}
 else if(url.pathname==='/get_friend_list')data=[{user_id:7654321,nickname:'隔离联系人'}]
 else if(url.pathname==='/get_group_list')data=[]
 else if(url.pathname==='/get_friend_msg_history'){assert.equal(body.user_id,7654321);data={messages:history}}
 else if(url.pathname==='/send_private_msg'){assert.equal(body.user_id,7654321);assert.equal(body.message[0].type,'text');sends++;if(loseReply)throw new Error('synthetic response lost');data={message_id:999}}
 else throw new Error('unexpected OneBot operation')
 return Response.json({status:'ok',retcode:0,data})
}
const store=new NativeImStore(directory)
const initial=store.listing();store.change({action:'create',expected_revision:initial.revision,name:'隔离QQ连接',platform:'qq_napcat',fields:{mode:'manual',webui_url:'http://127.0.0.1:55001',onebot_url:'http://127.0.0.1:55002'},secrets:{webui_token:'synthetic-token',onebot_token:'synthetic-onebot'}})
assert.throws(()=>store.change({action:'create',expected_revision:initial.revision,name:'冲突',platform:'qq_napcat'}),/已改变/)
const row=store.listing().connections[0];assert.equal(JSON.stringify(store.listing()).includes('synthetic-token'),false)
const service=new NativeImService(directory,resolve('resources'),fetcher,async()=>{modelCalls++;return reply()})
service.configure('fixture-model')
try{
 await service.execute('status');assert.equal(requestCount,0)
 const start=await service.execute('start',{operation_id:op(),connection_id:row.id,expected_revision:row.revision}) as {operation_id:string;connection_id:string;generation:string;state:string;account:string}
 assert.equal(start.state,'waiting_scan');const operation={operation_id:start.operation_id,connection_id:row.id,generation:start.generation}
 assert.match(await service.execute('qr',operation) as string,/^data:image\/gif;base64,/)
 loggedIn=true;const inspected=await service.execute('inspect',operation) as typeof start;assert.equal(inspected.state,'awaiting_bind');assert.equal(inspected.account,'1234567');assert.equal(store.capture(row.id).has_session,false)
 await assert.rejects(()=>service.execute('confirm',{...operation,displayed_account:'99999'}),/核对/)
 await service.execute('confirm',{...operation,displayed_account:inspected.account});const bound=store.capture(row.id)
 assert.equal(bound.has_session,true);assert.equal(bound.account,'1234567');assert.equal(JSON.stringify(await service.execute('status')).includes('synthetic-onebot'),false)
 const scope={connection_id:row.id,revision:bound.revision,account:bound.account,platform:bound.platform,login_epoch:bound.login_epoch,peer:'private:7654321'}
 const peers=await service.execute('directory',{...scope,peer:'_directory_'}) as {peers:{peer:string}[]};assert.equal(peers.peers[0].peer,scope.peer)
 await service.execute('sync',scope);const saved=await service.execute('read',{...scope,limit:50}) as {messages:{text:string}[]};assert.equal(saved.messages[0].text,'仅隔离消息')
 await assert.rejects(()=>service.execute('read',{...scope,account:'9999'}),/已改变/)
 const send={...scope,operation_id:op(),text:'隔离测试回复，仅交给模拟接口',user_confirmed:true}
 assert.equal((await service.execute('send',send) as {state:string}).state,'sent');assert.equal(sends,1);await service.execute('send',send);assert.equal(sends,1)
 await assert.rejects(()=>service.execute('send',{...send,text:'不同内容'}),/不同内容/)
 loseReply=true;const uncertain={...send,operation_id:op()};assert.equal((await service.execute('send',uncertain) as {state:string}).state,'unknown');assert.equal(sends,2);await service.execute('send',uncertain);assert.equal(sends,2)
 await assert.rejects(()=>service.execute('send',{...send,operation_id:op(),user_confirmed:false}));assert.equal(sends,2)
 assert.throws(()=>store.saveMessages(scope,[{mid:'1',ts:100,sender:'7654321',text:'同编号改写',kind:'text'}]),/内容已改变/)
 async function waitFor(test:()=>boolean){for(let i=0;i<240;i++){if(test())return;await new Promise(resolve=>setTimeout(resolve,50))}throw new Error('后台状态未在预算内完成')}
 const policy=(mode:'draft'|'auto_reply')=>({identity:'为隔离会话准备简短回复',mode,interval_seconds:5,reply_limit_hour:10,profile_id:'native-fixture-model',knowledge_ids:[],images:false,agent_enabled:false})
 const rules=await service.execute('rules',scope) as {conversation:{revision:string}}
 await service.execute('rules',{...scope,level:'conversation',expected_revision:rules.conversation.revision,value:policy('draft')})
 await service.execute('runs',{...scope,action:'start',peers:[scope.peer],resume_on_restart:false})
 await waitFor(()=>{const row=store.db.prepare("SELECT json FROM native_im_state WHERE kind='run'").get() as {json:string}|undefined;return !!row&&JSON.parse(row.json).baseline.includes('1')})
 assert.equal(modelCalls,0)
 history.push({...history[0],message_id:2,time:101,message:[{type:'text',data:{text:'新增隔离消息2'}}]})
 await waitFor(()=>modelCalls===1&&store.db.prepare("SELECT 1 FROM native_im_state WHERE kind='job' AND json_extract(json,'$.state')='draft'").get()!==undefined)
 assert.equal(sends,2)
 let release:(value:string)=>void=()=>{};reply=()=>new Promise(resolve=>{release=resolve})
 history.push({...history[0],message_id:3,time:102,message:[{type:'text',data:{text:'新增隔离消息3'}}]})
 await waitFor(()=>modelCalls===2);await service.execute('runs',{...scope,action:'pause'});release('停止之后迟到的文字，不应保存或发送')
 await waitFor(()=>!!store.db.prepare("SELECT 1 FROM native_im_state WHERE kind='job' AND json_extract(json,'$.state')='blocked'").get())
 assert.equal(sends,2);assert.equal(JSON.stringify(store.db.prepare("SELECT json FROM native_im_state WHERE kind='job'").all()).includes('停止之后迟到的文字'),false)
 await new Promise(resolve=>setTimeout(resolve,25))
 const latest=await service.execute('rules',scope) as {conversation:{revision:string}};await service.execute('rules',{...scope,level:'conversation',expected_revision:latest.conversation.revision,value:policy('auto_reply')})
 reply=async()=> '仅模拟接口的自动回复';loseReply=false
 await service.execute('runs',{...scope,action:'start',peers:[scope.peer],resume_on_restart:false})
 await waitFor(()=>{const row=store.db.prepare("SELECT json FROM native_im_state WHERE kind='run'").get() as {json:string};return JSON.parse(row.json).baseline.includes('3')})
 history.push({...history[0],message_id:4,time:103,message:[{type:'text',data:{text:'新增隔离消息4'}}]})
 await waitFor(()=>sends===3);await service.execute('runs',{...scope,action:'pause'});assert.equal(modelCalls,3)
 const protectedPreview=await service.execute('cleanup',scope) as {count:number;reason:string};assert.equal(protectedPreview.count,0);assert.match(protectedPreview.reason,/待办|发送/)
 const otherScope={...scope,peer:'private:1112223'},localMessage={mid:'local-1',ts:10,sender:'1112223',text:'另外会话的隔离记录',kind:'text'}
 store.saveMessages(otherScope,[localMessage]);const cleanup=await service.execute('cleanup',otherScope) as {preview_id:string;count:number};assert.equal(cleanup.count,1)
 await assert.rejects(()=>service.execute('cleanup',{...otherScope,preview_id:cleanup.preview_id,user_confirmed:false}),/确认/)
 store.saveMessages(otherScope,[{...localMessage,mid:'local-2'}]);await assert.rejects(()=>service.execute('cleanup',{...otherScope,preview_id:cleanup.preview_id,user_confirmed:true}),/已改变/)
 const newPreview=await service.execute('cleanup',otherScope) as {preview_id:string;count:number};assert.equal(newPreview.count,2)
 const cleaning={...otherScope,preview_id:newPreview.preview_id,user_confirmed:true};assert.equal((await service.execute('cleanup',cleaning) as {deleted:number}).deleted,2);assert.equal((await service.execute('cleanup',cleaning) as {replayed:boolean}).replayed,true)
 assert.ok(store.readMessages(scope).messages.length>0)
 await service.dispose();const beforeRestart=requestCount,restarted=new NativeImService(directory,resolve('resources'),fetcher);try{await restarted.execute('status');assert.equal(requestCount,beforeRestart);assert.equal((await restarted.execute('runs',{...scope,action:'status'}) as {runs:{state:string}[]}).runs[0].state,'paused')}finally{await restarted.dispose()}
 const revision=store.listing().revision;store.change({action:'update',expected_revision:revision,id:row.id,name:'改名保留登录',platform:'qq_napcat',fields:row.fields,secrets:{}});assert.equal(store.capture(row.id).has_session,true)
 assert.throws(()=>store.readMessages(scope),/已改变/)
 const report={nativeSqliteAndDpapi:true,syntheticLoopbackAdapterOnly:true,noActualAccountOrMessageSent:true,listingDoesNotConnect:true,noWebUiShown:true,qrLocallyRendered:true,userAccountBindingRequired:true,accountAndPeerChecked:true,selectedHistoryOnly:true,confirmedSendReceipt:true,duplicateSendNotReplayed:true,unknownSendNotReplayed:true,falseConfirmationRejected:true,changedMessageIdRefused:true,renamingPreservesSession:true,staleScopeRejected:true,firstHistoryIsOnlyBaseline:true,newMessagesCreateDraftOnly:true,lateModelAfterPauseNotPublished:true,explicitAutoModeUsesSendReceipt:true,restartDoesNotPollOrRequestModel:true,cleanupPreviewAndConfirmation:true,changedPreviewBlocksDeletion:true,cleanupDoesNotDeleteOtherConversations:true,unfinishedEvidenceRetained:true,allImFunctionsMigrated:false,completeMigration:false}
 await writeFile(join(directory,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({directory,...report}))
}finally{await service.dispose();store.close()}
