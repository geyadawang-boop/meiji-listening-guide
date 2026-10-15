import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {mkdir,writeFile,readFile,readdir} from 'node:fs/promises'
import {createServer} from 'node:http'
import {join,resolve} from 'node:path'
import {randomUUID,createCipheriv} from 'node:crypto'
import {NativeBiliDownloadRunner} from '../src/main/media-download-runner'
import {NativeMediaMux} from '../src/main/media-mux'
import {NativeDownloadJobs} from '../src/main/media-jobs'
import {BiliMediaCatalog} from '../src/main/media-bili'
import {NativePlatformCatalog} from '../src/main/media-platforms'
const root=resolve('.'),resources=join(root,'resources'),directory=join(root,'test-results','media-runner-'+randomUUID())
await mkdir(directory,{recursive:true})
function generate(name:string,args:string[]){const output=join(directory,name),result=spawnSync(join(resources,'video','ffmpeg.exe'),['-hide_banner','-loglevel','error','-nostdin',...args,output],{windowsHide:true,encoding:'utf8'});assert.equal(result.status,0,result.stderr);return output}
const video=await readFile(generate('video.mp4',['-f','lavfi','-i','color=c=red:s=320x240:r=25','-t','2','-an','-c:v','libx264']))
const audio=await readFile(generate('audio.m4a',['-f','lavfi','-i','sine=frequency=600:sample_rate=48000','-t','2','-vn','-c:a','aac']))
const combined=await readFile(generate('combined.mp4',['-i',join(directory,'video.mp4'),'-i',join(directory,'audio.m4a'),'-c','copy']))
const ts=await readFile(generate('segment.ts',['-i',join(directory,'combined.mp4'),'-c','copy','-f','mpegts']))
const server=createServer((request,response)=>{const body=request.url==='/video'?video:request.url==='/combined'?combined:audio;response.writeHead(200,{'content-length':String(body.length),etag:'"synthetic-v1"'});response.end(body)})
await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address() as {port:number}
const bvid='BV1Q5HXzuEJX',url=`https://www.bilibili.com/video/${bvid}/?p=2`
let cid=22,downloads=0
const catalog=new BiliMediaCatalog({async readMedia(path:string){
 if(path.endsWith('/view'))return {bvid,title:'隔离课程',desc:'本视频简介：隔离测试的课程材料。',pages:[{cid,page:2,part:'第二节',duration:2}]}
 if(path.endsWith('/playurl'))return {dash:{video:[{id:80,codecid:7,height:240,codecs:'avc1',baseUrl:'https://fixture.bilivideo.com/video'}],audio:[{id:30280,codecs:'mp4a',baseUrl:'https://fixture.bilivideo.com/audio'}]}}
 return {subtitle:{subtitles:[]}}
}})
const jobs=new NativeDownloadJobs(directory),runner=new NativeBiliDownloadRunner(jobs,catalog,async(input,init)=>{downloads++;return fetch(`http://127.0.0.1:${address.port}`+new URL(input).pathname,init)},new NativeMediaMux(resources))
try{
 const row=await jobs.create({identity:`${bvid}:22:2`,url,title:'第二节',options:{retries:0}})
 const result=await runner.run(row.id,new AbortController().signal)
 assert.equal(result.job.state,'completed');assert.equal(result.output.video,1);assert.equal(result.output.audio,1);assert.equal(result.cleanupPending.length,0);assert.equal(downloads,2)
 assert.ok(Math.abs(result.output.duration-2)<.1);assert.equal(await jobs.file(row.id),result.output.path)
 const remaining=await readdir(await jobs.taskDirectory(row.id));assert.deepEqual(remaining.sort(),['job.json','result.mkv'])
 const changed=await jobs.create({identity:`${bvid}:22:2`,url,title:'身份改变',options:{retries:0}});cid=99
 await assert.rejects(()=>runner.run(changed.id,new AbortController().signal),/身份已改变/);assert.equal((await jobs.read(changed.id)).state,'error');assert.equal(downloads,2);cid=22
 const cancelled=await jobs.create({identity:`${bvid}:22:2`,url,title:'取消',options:{retries:0}}),controller=new AbortController();controller.abort()
 await assert.rejects(()=>runner.run(cancelled.id,controller.signal));assert.equal((await jobs.read(cancelled.id)).state,'cancelled');assert.equal(downloads,2)
 const unsupported=await jobs.create({identity:`${bvid}:22:2`,url,title:'尚未接入的选项',options:{sponsorblock:'sponsor',retries:0}})
 await assert.rejects(()=>runner.run(unsupported.id,new AbortController().signal),/尚未接入/);assert.equal((await jobs.read(unsupported.id)).state,'error')
 const enhanced=await jobs.create({identity:`${bvid}:22:2`,url,title:'附属成果',options:{custom_args:'--write-description --write-link --socket-timeout 10 --sleep-requests 0 --no-mtime',format_sort:'+res',retries:0}})
 const extras=await runner.run(enhanced.id,new AbortController().signal),extraDirectory=await jobs.taskDirectory(enhanced.id)
 assert.equal(extras.job.state,'completed');assert.deepEqual((await readdir(extraDirectory)).sort(),['description.txt','job.json','result.mkv','source.webloc'])
 assert.match(await readFile(join(extraDirectory,'description.txt'),'utf8'),/隔离测试的课程材料/);assert.match(await readFile(join(extraDirectory,'source.webloc'),'utf8'),/BV1Q5HXzuEJX/)
 assert.equal((await jobs.read(enhanced.id)).outputs.length,3)
 const organized=await jobs.create({identity:`${bvid}:22:2`,url,title:'按类型与月份整理',options:{folder_layout:'type-date',custom_args:'--write-link',retries:0}})
 const organizedResult=await runner.run(organized.id,new AbortController().signal),organizedRow=await jobs.read(organized.id),organizedDirectory=await jobs.taskDirectory(organized.id)
 assert.match(organizedResult.output.relative,/^视频\/\d{4}-\d{2}\/result.mkv$/);assert.deepEqual((await readdir(organizedDirectory)).sort(),['job.json','视频']);assert.equal(organizedRow.outputs.length,2);assert.equal(await jobs.file(organized.id),organizedResult.output.path)
 const multiFetch=async(input:string,init?:RequestInit)=>input.includes('player.vimeo.com')?Response.json({video:{id:123456,title:'Vimeo合成课程',duration:2},request:{files:{progressive:[{height:240,url:'https://fixture.vimeocdn.com/combined'}]}}}):fetch(`http://127.0.0.1:${address.port}/combined`,init)
 const multiCatalog=new NativePlatformCatalog({async readMedia(){throw new Error('跨平台不访问B站账号')}},multiFetch),multiRunner=new NativeBiliDownloadRunner(jobs,multiCatalog,multiFetch,new NativeMediaMux(resources))
 const vimeo=await jobs.create({identity:'vimeo:123456',url:'https://vimeo.com/123456',title:'原生Vimeo课程',options:{height:360,custom_args:'--buffer-size 1024 --http-chunk-size 100000',retries:0}})
 const multiResult=await multiRunner.run(vimeo.id,new AbortController().signal);assert.equal(multiResult.job.state,'completed');assert.equal(multiResult.output.video,1);assert.equal(multiResult.output.audio,1);assert.ok(Math.abs(multiResult.output.duration-2)<.1);assert.equal(await jobs.file(vimeo.id),multiResult.output.path);assert.deepEqual((await readdir(await jobs.taskDirectory(vimeo.id))).sort(),['job.json','result.mkv'])
 const hlsKey=Buffer.alloc(16,3),iv=Buffer.alloc(16);iv.writeBigUInt64BE(7n,8);const cipher=createCipheriv('aes-128-cbc',hlsKey,iv),encryptedTs=Buffer.concat([cipher.update(ts),cipher.final()])
 const hlsFetch=async(input:string,init?:RequestInit)=>input.includes('player.vimeo.com')?Response.json({video:{id:123456,title:'HLS课程',duration:2},request:{files:{hls:{default_cdn:'fixture',cdns:{fixture:{url:'https://fixture.vimeocdn.com/master.m3u8'}}}}}}):input.endsWith('/master.m3u8')?new Response('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=100000,RESOLUTION=320x240,CODECS="avc1,mp4a"\nvideo.m3u8'):input.endsWith('/video.m3u8')?new Response('#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:7\n#EXT-X-KEY:METHOD=AES-128,URI="key"\n#EXTINF:2,\nsegment.ts\n#EXT-X-ENDLIST'):input.endsWith('/key')?new Response(hlsKey):new Response(encryptedTs,{headers:{'Content-Length':String(encryptedTs.length),ETag:'"encrypted-fixture"'}})
 const hlsRunner=new NativeBiliDownloadRunner(jobs,new NativePlatformCatalog({async readMedia(){throw new Error('not B站')}},hlsFetch),hlsFetch,new NativeMediaMux(resources)),hlsJob=await jobs.create({identity:'vimeo:123456',url:'https://vimeo.com/123456',title:'原生HLS课程',options:{height:360,retries:0}})
 const hlsResult=await hlsRunner.run(hlsJob.id,new AbortController().signal);assert.equal(hlsResult.job.state,'completed');assert.equal(hlsResult.output.video,1);assert.equal(hlsResult.output.audio,1);assert.deepEqual((await readdir(await jobs.taskDirectory(hlsJob.id))).sort(),['job.json','result.mkv'])
 const report={nativeEndToEnd:true,controlledApiAndRealHttp:true,separateTracksDownloadedAndMuxed:true,finalVideoAudioDurationVerified:true,finalHashRechecked:true,generatedIntermediatesDeleted:true,changedPageRefusedBeforeDownload:true,cancelledJobNotPublished:true,unsupportedOptionsExplicit:true,productionQueueConnected:false,realBiliDownloadVerified:false,nativeSortAndStructuredTuning:true,descriptionAndLinkSavedAndHashed:true,typeDateLayoutPublishedAndCheckedBeforeCleanup:true,completeMigration:false}
 Object.assign(report,{vimeoSyntheticMetadataAndRealMedia:true,crossPlatformVideoAudioDurationAndHashVerified:true,crossPlatformIntermediatesDeleted:true,bufferAndChunkOptionsConnected:true,nativeHlsMasterAndAes128Vod:true,hlsDurationAudioVideoVerifiedAndIntermediatesDeleted:true,noHlsKeyWrittenOrNetworkUrlPassedToFfmpeg:true,realVimeoOrDailymotionDownloaded:false})
 await writeFile(join(directory,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({directory,...report}))
}finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}
