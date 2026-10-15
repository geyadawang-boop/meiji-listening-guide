import assert from 'node:assert/strict'
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {NativeImService} from '../src/main/im-service'
import {NativeImStore} from '../src/main/im-store'
const base=resolve('test-results');await mkdir(base,{recursive:true});const directory=await mkdtemp(join(base,'native-weixin-web-')),id=()=>randomUUID().replaceAll('-',''),key=(n:number)=>({Count:1,List:[{Key:1,Val:n}]})
let sends=0,initCount=0,loseReceipt=false,calls=0,hold=false,release=()=>{},reached=()=>{}
let entered=new Promise<void>(resolve=>{reached=resolve})
const fetcher:typeof fetch=async(input,init)=>{
 calls++;const url=new URL(String(input)),body=init?.body?JSON.parse(String(init.body)):{}
 assert.equal(init?.redirect,'error');assert.equal(init?.credentials,'omit');assert.ok(['login.wx.qq.com','wx.qq.com'].includes(url.hostname))
 if(url.pathname==='/jslogin')return new Response('window.QRLogin.code=200;window.QRLogin.uuid="fixture";')
 if(url.pathname.endsWith('/login'))return new Response('window.code=200;window.redirect_uri="https://wx.qq.com/cgi-bin/mmwebwx-bin/webwxnewloginpage?ticket=synthetic";')
 if(url.pathname.endsWith('webwxnewloginpage'))return new Response('<error><ret>0</ret><wxuin>1234567</wxuin><wxsid>synthetic-sid</wxsid><skey>synthetic-key</skey><pass_ticket>synthetic-ticket</pass_ticket></error>',{headers:{'set-cookie':'wxsid=synthetic-sid; Secure; Path=/'}})
 if(url.pathname.endsWith('webwxinit')){initCount++;return Response.json({BaseResponse:{Ret:0},User:{UserName:'@self',Uin:'1234567'},SKey:'synthetic-verified-key',SyncKey:key(initCount===1?1:999)})}
 if(url.pathname.endsWith('webwxgetcontact'))return Response.json({BaseResponse:{Ret:0},Seq:0,MemberList:[{UserName:'@chosen',NickName:'所选联系人'}]})
 if(url.pathname.endsWith('webwxsync')){
  assert.equal(body.SyncKey.List[0].Val,hold?2:1)
  if(hold){reached();await new Promise<void>(resolve=>{release=resolve})}
  return Response.json({BaseResponse:{Ret:0},SyncKey:key(hold?3:2),AddMsgList:[{MsgId:'fixture-1',FromUserName:'@chosen',ToUserName:'@self',MsgType:1,Content:'隔离会话消息',CreateTime:1},{MsgId:'other-1',FromUserName:'@other',ToUserName:'@self',MsgType:1,Content:'OTHER_PRIVATE_TEXT',CreateTime:1}]})
 }
 if(url.pathname.endsWith('webwxsendmsg')){sends++;assert.equal(body.Msg.ToUserName,'@chosen');assert.equal(body.Msg.FromUserName,'@self');return Response.json({BaseResponse:{Ret:0},...loseReceipt?{}:{MsgID:'remote-fixture'}})}
 throw new Error('Unexpected fixture endpoint')
}
const store=new NativeImStore(directory),service=new NativeImService(directory,resolve('resources'),fetcher)
try{
 const listing=store.change({action:'create',expected_revision:store.listing().revision,name:'隔离微信 Web',platform:'weixin_web',fields:{},secrets:{}}),row=listing.connections[0]
 await service.execute('status');assert.equal(calls,0)
 const login=await service.execute('start',{operation_id:id(),connection_id:row.id,expected_revision:row.revision}) as {operation_id:string;generation:string;state:string}
 assert.equal(login.state,'waiting_scan');const op={operation_id:login.operation_id,generation:login.generation,connection_id:row.id}
 assert.match(await service.execute('qr',op) as string,/^data:image\/gif;base64,/)
 const inspect=await service.execute('inspect',op) as {state:string;account:string};assert.equal(inspect.state,'awaiting_bind');assert.equal(store.capture(row.id).has_session,false)
 await assert.rejects(()=>service.execute('confirm',{...op,displayed_account:'different'}),/核对/)
 await service.execute('confirm',{...op,displayed_account:inspect.account});const bound=store.capture(row.id),scope={connection_id:row.id,revision:bound.revision,account:bound.account,platform:bound.platform,login_epoch:bound.login_epoch,peer:'@chosen'}
 await service.execute('directory',{...scope,peer:'_directory_'});assert.equal(store.readMessages(scope).messages.length,0)
 await service.execute('sync',scope);assert.equal(store.readMessages(scope).messages[0].text,'隔离会话消息');assert.equal(JSON.stringify(store.db.prepare('SELECT text FROM messages').all()).includes('OTHER_PRIVATE_TEXT'),false)
 assert.equal((store.privateState(row.id,bound.revision).session!.SyncKey as {List:{Val:number}[]}).List[0].Val,2)
 const send={...scope,operation_id:id(),text:'只交给模拟服务',user_confirmed:true};assert.equal((await service.execute('send',send) as {state:string}).state,'sent');await service.execute('send',send);assert.equal(sends,1)
 loseReceipt=true;const unknown={...send,operation_id:id()};assert.equal((await service.execute('send',unknown) as {state:string}).state,'unknown');await service.execute('send',unknown);assert.equal(sends,2)
 hold=true;const running=service.execute('sync',scope);await entered;await assert.rejects(()=>service.execute('sync',scope),/正在同步/);release();await running
 assert.equal(JSON.stringify(await service.execute('status')).includes('synthetic-sid'),false)
 await service.dispose();const previous=calls,restarted=new NativeImService(directory,resolve('resources'),fetcher);try{await restarted.execute('status');assert.equal(calls,previous)}finally{await restarted.dispose()}
 const report={syntheticServiceOnly:true,noRealWechatLoginOrSend:true,nativeUiActionsConnected:true,explicitAccountConfirmation:true,encryptedSessionAndRestart:true,restoredIdentityRecheckPreservesCursor:true,onlySelectedPeerPersisted:true,cursorSavedWithMessages:true,parallelSyncRefused:true,duplicateSendNotRepeated:true,missingReceiptUnknown:true,statusNeverExposesSession:true,noBrowserOpened:true,completeMigration:false}
 await writeFile(join(directory,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({directory,...report}))
}finally{release();await service.dispose();store.close()}
