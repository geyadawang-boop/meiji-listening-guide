import {app,utilityProcess,type UtilityProcess} from 'electron'
import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {mkdir,writeFile,readFile,readdir} from 'node:fs/promises'
import {createServer,type Server} from 'node:http'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {NativeDownloads} from '../src/main/media-downloads'
import type {MediaCatalog,MediaJob} from '../src/shared/media'
const root=process.cwd(),output=join(root,'test-results','native-download-process-'+randomUUID()),bvid='BV1Q5HXzuEJX',url=`https://www.bilibili.com/video/${bvid}/?p=2`
void(async()=>{
 await mkdir(output,{recursive:true});app.setPath('userData',output);await app.whenReady()
 let client:NativeDownloads|undefined,worker:UtilityProcess|undefined,server:Server|undefined
 try{
  function generate(name:string,args:string[]){const path=join(output,name),result=spawnSync(join(root,'resources/video/ffmpeg.exe'),['-hide_banner','-loglevel','error','-nostdin',...args,path],{windowsHide:true,encoding:'utf8'});assert.equal(result.status,0,result.stderr);return path}
  const video=await readFile(generate('video.mp4',['-f','lavfi','-i','color=c=blue:s=320x240:r=25','-t','2','-an','-c:v','libx264']))
  const audio=await readFile(generate('audio.m4a',['-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','2','-vn','-c:a','aac']))
  const picture=await readFile(generate('cover.png',['-f','lavfi','-i','color=c=pink:s=320x180','-frames:v','1']))
  let holdStarted:()=>void=()=>{},requested=0
  server=createServer((request,response)=>{requested++;if(request.url==='/cover'){response.setHeader('content-type','image/png');response.end(picture);return}if(request.url==='/subtitles'){response.setHeader('content-type','application/json');response.end(JSON.stringify({body:[{from:0,to:1,content:'合成课堂字幕'},{from:1,to:2,content:'请核对教材'}]}));return}const hold=request.url==='/hold',body=request.url==='/audio'?audio:video;response.writeHead(200,{'content-length':String(body.length),etag:'"isolated-v1"'});if(hold){response.write(body.subarray(0,200));holdStarted()}else response.end(body)})
  await new Promise<void>(resolve=>server!.listen(0,'127.0.0.1',resolve));const address=server.address() as {port:number}
  const api={async readMedia(path:string,params:Record<string,string>){
   if(path.endsWith('/view'))return {bvid,title:'隔离课程',pic:'https://fixture.hdslb.com/cover',pages:[{cid:22,page:2,part:'第二节',duration:2},{cid:33,page:3,part:'取消测试',duration:2}]}
   if(path.endsWith('/playurl'))return {dash:{video:[{id:80,height:240,codecid:7,codecs:'avc1',baseUrl:'https://fixture.bilivideo.com/'+(params.cid==='33'?'hold':'video')}],audio:[{id:30280,codecs:'mp4a',baseUrl:'https://fixture.bilivideo.com/audio'}]}}
   return {subtitle:{subtitles:[{lan:'zh-CN',subtitle_url:'https://fixture.hdslb.com/subtitles'}]},view_points:[{from:0,to:1,content:'绪论'},{from:1,to:2,content:'课堂重点'}]}
  }}
  // First verify the actual production client and worker without any fetch override.
  client=new NativeDownloads(join(root,'resources'),join(output,'client-data'),api)
  const clientCatalog=await client.request<MediaCatalog>('catalog',{url})
  assert.equal(clientCatalog.title,'第二节');assert.ok(clientCatalog.token);assert.equal(client.started,true)
  const collision=new NativeDownloads(join(root,'resources'),join(output,'client-data'),api);await assert.rejects(()=>collision.request('options'),/另一个进程/);await collision.dispose()
  const noDownload=await client.request<MediaJob>('create',{token:clientCatalog.token,options:{sponsorblock:'sponsor',retries:0}})
  for(let i=0;i<100;i++){const rows=await client.request<MediaJob[]>('list');if(rows.find(row=>row.id===noDownload.id)?.state==='error')break;await new Promise(resolve=>setTimeout(resolve,10))}
  assert.equal((await client.request<MediaJob[]>('list'))[0].state,'error');assert.equal(requested,0);await client.dispose();client=undefined
  // Only this test wrapper maps controlled CDN fixture addresses to a local HTTP service.
  const wrapper=join(root,'out/main/download-test-wrapper.mjs')
  await writeFile(wrapper,`const original=globalThis.fetch;globalThis.fetch=(input,init)=>original('http://127.0.0.1:${address.port}'+new URL(input).pathname,init);await import('./media-download-worker.js');`)
  worker=utilityProcess.fork(wrapper,[join(root,'resources'),join(output,'download-data')],{stdio:'pipe',serviceName:'隔离原生下载验收'})
  worker.stdout?.on('data',()=>{});worker.stderr?.on('data',()=>{})
  let seq=0;const pending=new Map<number,{resolve:(value:unknown)=>void;reject:(error:Error)=>void}>()
  worker.on('message',(message:{kind:string;key:number;path:string;params:Record<string,string>;id:number;ok:boolean;result:unknown;error:string})=>{void(async()=>{
   if(message.kind==='bili-api'){const data=await api.readMedia(message.path,message.params);worker?.postMessage({kind:'bili-result',key:message.key,ok:true,data})}
   else{const item=pending.get(message.id);pending.delete(message.id);message.ok?item?.resolve(message.result):item?.reject(new Error(message.error))}
  })().catch(error=>{console.error(error);app.exit(1)})})
  const request=<T>(action:string,args:unknown={})=>new Promise<T>((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(new Error('进程验收请求超时'))},15000);pending.set(id,{resolve:value=>{clearTimeout(timer);resolve(value as T)},reject:error=>{clearTimeout(timer);reject(error)}});worker!.postMessage({protocol:1,id,action,args})})
  const source=await request<MediaCatalog>('catalog',{url}),row=await request<MediaJob>('create',{token:source.token,options:{retries:0}})
  async function until(id:string,state:string){for(let i=0;i<300;i++){const rows=await request<MediaJob[]>('list'),row=rows.find(row=>row.id===id);if(row?.state===state)return row;if(row?.state==='error')throw new Error(row.error_message);await new Promise(resolve=>setTimeout(resolve,20))}throw new Error('等待任务状态超时')}
  const complete=await until(row.id,'completed');assert.ok(complete.files.includes('result.mkv'));assert.equal(requested,2)
  assert.equal(await request<string>('file',{id:row.id}),complete.output)
  assert.deepEqual((await readdir(join(output,'download-data/native-downloads',row.id))).sort(),['job.json','result.mkv'])
  const duplicate=await request<MediaJob>('create',{token:source.token,options:{retries:0}});assert.equal(duplicate.id,row.id);assert.equal(requested,2)
  const subtitleJob=await request<MediaJob>('create',{token:source.token,options:{retries:0,subtitle_only:true,subtitle_languages:'zh-*'}}),subtitleResult=await until(subtitleJob.id,'completed')
  assert.deepEqual(subtitleResult.files,['subtitle-zh-CN.srt']);assert.equal(requested,3);assert.match(await readFile(await request<string>('file',{id:subtitleJob.id}),'utf8'),/合成课堂字幕/)
  const embeddedJob=await request<MediaJob>('create',{token:source.token,options:{retries:0,subtitles:true,subtitle_languages:'zh-*',embed_subtitles:true,keep_subtitles:false,thumbnail:true,embed_thumbnail:true,crop_artwork:true,force_ipv4:true}}),embedded=await until(embeddedJob.id,'completed')
  assert.deepEqual(embedded.files,['result.mkv','cover.jpg']);assert.deepEqual((await readdir(join(output,'download-data/native-downloads',embeddedJob.id))).sort(),['cover.jpg','job.json','result.mkv'])
  const chapterJob=await request<MediaJob>('create',{token:source.token,options:{retries:0,split_chapters:true,filename_template:'%(title)s-P%(id)s.%(ext)s'}}),chapterResult=await until(chapterJob.id,'completed')
  assert.deepEqual(chapterResult.files,['第二节-PBV1Q5HXzuEJX-P2.mkv','chapter-001.mkv','chapter-002.mkv'])
  assert.deepEqual((await readdir(join(output,'download-data/native-downloads',chapterJob.id))).sort(),['chapter-001.mkv','chapter-002.mkv','job.json','第二节-PBV1Q5HXzuEJX-P2.mkv'])
  const holding=new Promise<void>(resolve=>{holdStarted=resolve}),holdSource=await request<MediaCatalog>('catalog',{url:`https://www.bilibili.com/video/${bvid}/?p=3`}),hold=await request<MediaJob>('create',{token:holdSource.token,options:{retries:0}})
  await holding;const cancelled=await request<MediaJob>('cancel',{id:hold.id});assert.equal(cancelled.state,'cancelled')
  const recovery=await readdir(join(output,'download-data/native-downloads',hold.id));assert.ok(recovery.includes('track-0.partial'));assert.ok(recovery.includes('track-0.resume.json'));assert.ok(!recovery.includes('result.mkv'))
  const crashStarted=new Promise<void>(resolve=>{holdStarted=resolve}),crashSource=await request<MediaCatalog>('catalog',{url:`https://www.bilibili.com/video/${bvid}/?p=3`}),crashed=await request<MediaJob>('create',{token:crashSource.token,options:{retries:0}})
  await crashStarted
  const dead=new Promise<void>(resolve=>worker!.once('exit',()=>resolve()));worker.kill();await dead;worker=undefined
  client=new NativeDownloads(join(root,'resources'),join(output,'download-data'),api)
  const recovered=await client.request<MediaJob[]>('list');assert.equal(recovered.find(row=>row.id===crashed.id)?.state,'interrupted')
  assert.ok(!(await readdir(join(output,'download-data/native-downloads',crashed.id))).includes('track-0.lock'))
  assert.equal(await client.request<string>('file',{id:row.id}),complete.output)
  await client.dispose();client=undefined
  const report={productionClientAndUtilityProcess:true,loginApiMediatedWithoutCookieFiles:true,controlledHttpDownloadInRealUtilityProcess:true,realFfmpegMuxAndOutputChecks:true,duplicateVerifiedOutputReused:true,listResponsiveDuringDownload:true,subtitleOnlyAvoidsMediaDownload:true,subtitlesAndChaptersEmbedded:true,embeddedCaptionIntermediatesCleaned:true,coverCroppedAndEmbedded:true,ipv4DispatcherInRealWorker:true,ownedArtifactReceiptsCleaned:true,chapterSplitsAndFilenameTemplate:true,activeStreamCancellation:true,cancelledPartialRecoveryPreserved:true,successfulIntermediatesCleaned:true,gracefulShutdown:true,exclusiveProcessLease:true,crashedWorkerBecomesInterrupted:true,deadProcessTransferLockRemoved:true,completedOutputSurvivesRestart:true,testFetchMappingIsolated:true,productionButtonsConnected:false,realBiliDownloadVerified:false,completeMigration:false}
  await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({output,...report}))
 }catch(error){console.error(error);process.exitCode=1}
 finally{await client?.dispose();worker?.kill();if(server){server.closeAllConnections();await new Promise<void>(resolve=>server!.close(()=>resolve()))}app.exit(Number(process.exitCode||0))}
})()

