import assert from 'node:assert/strict'
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {randomUUID} from 'node:crypto'
import {NativeImStore} from '../src/main/im-store'
import {NativeImService} from '../src/main/im-service'
const base=resolve('test-results');await mkdir(base,{recursive:true});const directory=await mkdtemp(join(base,'native-ilink-')),id=()=>randomUUID().replaceAll('-','')
let confirmed=false,sends=0,updates=0,replyWithoutId=false,codeRequired=true
const requests:string[]=[]
const fetcher:typeof fetch=async(input,init)=>{
 const url=new URL(String(input));assert.equal(url.origin,'https://ilinkai.weixin.qq.com');assert.equal(init?.redirect,'error');assert.equal(init?.credentials,'omit');requests.push(url.pathname)
 const method=url.pathname.split('/').at(-1),body=init?.body?JSON.parse(String(init.body)):{}
 if(method==='get_bot_qrcode')return Response.json({ret:0,qrcode:'synthetic-code',qrcode_img_content:'https://ilinkai.weixin.qq.com/synthetic-qr'})
 if(method==='get_qrcode_status'){
  if(codeRequired&&!url.searchParams.get('verify_code'))return Response.json({status:'need_verifycode'})
  return Response.json(confirmed?{status:'confirmed',bot_token:'SYNTHETIC_ILINK_TOKEN',ilink_bot_id:'bot-account',ilink_user_id:'phone-user',baseurl:'https://ilinkai.weixin.qq.com'}:{status:'wait'})
 }
 assert.equal(new Headers(init?.headers).get('Authorization'),'Bearer SYNTHETIC_ILINK_TOKEN')
 if(method==='getconfig')return Response.json({ret:0})
 if(method==='getupdates'){updates++;assert.equal(body.get_updates_buf,'');return Response.json({get_updates_buf:'cursor-1',msgs:[{from_user_id:'chosen-peer',to_user_id:'bot-account',message_id:'selected-1',create_time_ms:1000,context_token:'selected-context',item_list:[{type:1,text_item:{text:'所选会话消息'}}]},{from_user_id:'other-peer',to_user_id:'bot-account',message_id:'other-1',create_time_ms:2000,context_token:'OTHER_CONTEXT_NOT_TO_SAVE',item_list:[{type:1,text_item:{text:'OTHER_PRIVATE_TEXT_NOT_TO_SAVE'}}]}]})}
 if(method==='sendmessage'){sends++;assert.equal(body.msg.to_user_id,'chosen-peer');assert.equal(body.msg.context_token,'selected-context');assert.equal(body.msg.item_list[0].type,1);return Response.json(replyWithoutId?{ret:0}:{ret:0,message_id:'remote-1'})}
 throw new Error('unexpected protocol request')
}
const store=new NativeImStore(directory),service=new NativeImService(directory,resolve('resources'),fetcher)
try{
 const listing=store.change({action:'create',expected_revision:store.listing().revision,name:'隔离微信Bot',platform:'weixin_ilink',fields:{},secrets:{}}),row=listing.connections[0]
 const login=await service.execute('start',{operation_id:id(),connection_id:row.id,expected_revision:row.revision}) as {operation_id:string;generation:string;state:string}
 assert.equal(login.state,'waiting_scan');assert.equal(requests.length,1);assert.equal((await service.execute('status') as {qq_component:{owned_running:boolean}}).qq_component.owned_running,false)
 const op={operation_id:login.operation_id,connection_id:row.id,generation:login.generation}
 assert.equal((await service.execute('inspect',op) as {state:string}).state,'waiting_confirm')
 await assert.rejects(()=>service.execute('inspect',{...op,verify_code:'bad-code'}))
 confirmed=true;const inspected=await service.execute('inspect',{...op,verify_code:'123456'}) as {state:string;account:string};assert.equal(inspected.state,'awaiting_bind');assert.equal(store.capture(row.id).has_session,false)
 await service.execute('confirm',{...op,displayed_account:inspected.account});const bound=store.capture(row.id),scope={connection_id:row.id,revision:bound.revision,platform:bound.platform,account:bound.account,login_epoch:bound.login_epoch,peer:'chosen-peer'}
 const directoryResult=await service.execute('directory',{...scope,peer:'_directory_'}) as {peers:{peer:string}[]};assert.equal(directoryResult.peers.length,2);assert.equal(store.readMessages(scope).messages.length,0)
 const before=store.privateState(row.id,bound.revision).session!;assert.equal(before.cursor,'');assert.equal(JSON.stringify(before).includes('OTHER_CONTEXT_NOT_TO_SAVE'),false)
 await service.execute('sync',scope);assert.equal(updates,2);assert.equal(store.readMessages(scope).messages[0].text,'所选会话消息');const saved=store.privateState(row.id,bound.revision).session!;assert.equal(saved.cursor,'cursor-1');assert.equal(JSON.stringify(saved).includes('OTHER_CONTEXT_NOT_TO_SAVE'),false);assert.equal(JSON.stringify(store.db.prepare('SELECT text FROM messages').all()).includes('OTHER_PRIVATE_TEXT_NOT_TO_SAVE'),false)
 const request={...scope,operation_id:id(),text:'仅模拟服务的回复',user_confirmed:true};assert.equal((await service.execute('send',request) as {state:string}).state,'sent');await service.execute('send',request);assert.equal(sends,1)
 replyWithoutId=true;const uncertain={...request,operation_id:id()};assert.equal((await service.execute('send',uncertain) as {state:string}).state,'unknown');await service.execute('send',uncertain);assert.equal(sends,2)
 assert.equal(JSON.stringify(await service.execute('status')).includes('SYNTHETIC_ILINK_TOKEN'),false)
 store.db.exec('CREATE TABLE im_rules(platform TEXT,account TEXT,peer TEXT,revision TEXT,value TEXT,PRIMARY KEY(platform,account,peer))')
 store.db.prepare('INSERT INTO im_rules VALUES(?,?,?,?,?)').run(scope.platform,scope.account,'',id(),JSON.stringify({read_enabled:false}))
 const callsBefore=requests.length
 await assert.rejects(()=>service.execute('directory',{...scope,peer:'_directory_'}),/停用消息读取/);await assert.rejects(()=>service.execute('sync',scope),/停用消息读取/);await assert.rejects(()=>service.execute('read',scope),/停用消息读取/);assert.equal(requests.length,callsBefore)
 store.db.prepare("UPDATE im_rules SET value=? WHERE peer=''").run(JSON.stringify({read_enabled:true,archive_enabled:false}))
 await assert.rejects(()=>service.execute('sync',scope),/停用消息保存/);assert.equal(requests.length,callsBefore)
 store.db.prepare("UPDATE im_rules SET value=? WHERE peer=''").run(JSON.stringify({read_enabled:true,archive_enabled:true,max_messages:50}))
 const beforeCount=store.readMessages(scope).messages.length
 assert.throws(()=>store.saveSessionAndMessages(scope,{...saved,cursor:'cursor-2'},Array.from({length:51},(_,index)=>({mid:'overflow-'+index,ts:10,sender:scope.peer,text:'容量测试',kind:'text'}))),/容量上限/)
 assert.equal(store.readMessages(scope).messages.length,beforeCount);assert.equal(store.privateState(row.id,bound.revision).session!.cursor,'cursor-1')
 const report={fixedOfficialProtocolHost:true,syntheticServiceOnly:true,noRealLoginOrSend:true,phoneCodeVerified:true,explicitAccountConfirmation:true,directoryDoesNotCommitCursor:true,selectedPeerOnlyStored:true,otherPeerContextNotStored:true,cursorAndMessagesSavedTogether:true,systemEncryptedSession:true,duplicateSendNotReplayed:true,noServerIdRemainsUnknown:true,noQqComponentStarted:true,legacyReadAndArchiveDenialsPreserved:true,deniedSyncDoesNotRequestRemote:true,capacityFailureRollsBackMessagesAndCursor:true,completeMigration:false}
 await writeFile(join(directory,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({directory,...report}))
}finally{await service.dispose();store.close()}
