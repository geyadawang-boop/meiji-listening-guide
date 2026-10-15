import {_electron as electron,type Page} from 'playwright'
import {mkdir,readFile,writeFile,stat} from 'node:fs/promises'
import {dirname,join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createServer} from 'node:http'
import assert from 'node:assert/strict'
import JSZip from 'jszip'
import {Document,Paragraph,Packer} from 'docx'
import {z} from 'zod'
import type {Settings} from '../src/shared/types.ts'
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),data=join(root,'test-results','transcript-'+Date.now())
await mkdir(data,{recursive:true})
const original=join(data,'原文.docx'),ppt=join(data,'课件.pptx')
await writeFile(original,await Packer.toBuffer(new Document({sections:[{children:[new Paragraph('00:00:01 牙油质结构这个必考。'),new Paragraph('00:00:05 这个词没有听清楚。')]}]})))
const zip=new JSZip();zip.file('ppt/slides/slide1.xml','<p:sld><a:t>牙釉质结构</a:t></p:sld>');zip.file('ppt/media/image1.png',Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=','base64'))
const originalPpt=await zip.generateAsync({type:'nodebuffer'});await writeFile(ppt,originalPpt)
let imageCalls=0,correctionCalls=0,bad=false
const partSchema=z.object({type:z.string(),text:z.string().optional(),filename:z.string().optional(),file_data:z.string().optional()})
const requestSchema=z.object({messages:z.array(z.object({content:z.unknown()})).optional(),input:z.array(z.object({content:z.unknown()})).optional()})
const server=createServer((request,response)=>{void(async()=>{
 let body='';for await(const chunk of request)body+=chunk
 const value=requestSchema.parse(JSON.parse(body)),content=(value.messages||value.input)?.at(-1)?.content,parts=Array.isArray(content)?z.array(partSchema).parse(content):undefined
 const text=parts?z.string().parse(parts.find(part=>['text','input_text'].includes(part.type))?.text):z.string().parse(content)
 const input=z.object({rows:z.array(z.object({id:z.number(),text:z.string()})).optional(),subtitles:z.unknown().optional(),selfPractice:z.boolean().optional()}).parse(JSON.parse(text.split('\n上次输出')[0]))
 let result:string
 if(input.rows){
  correctionCalls++;assert.ok(parts);const file=parts.find(part=>['file','input_file'].includes(part.type));assert.ok(file,'课件必须与原文在同一请求')
  assert.equal(parts.filter(part=>part.type==='image_url').length,0);assert.equal(request.url,'/v1/responses');assert.equal(file.type,'input_file');assert.ok(file.filename?.endsWith('.pptx'));assert.ok(file.file_data?.startsWith('data:application/vnd.openxmlformats-officedocument.presentationml.presentation;base64,'));assert.deepEqual(Buffer.from(file.file_data!.split(',')[1],'base64'),originalPpt)
  imageCalls++;result=JSON.stringify(input.rows.map((row,index)=>({id:bad?999:row.id,text:row.text.replace('牙油质','牙釉质'),uncertain:index===1,reason:index===0?'课件第1页支持牙釉质术语':'原文无法确定，保留原句'})))
 }else if(input.selfPractice)result=JSON.stringify(Array.from({length:5},(_,index)=>({stem:'描述牙釉质结构的要点'+(index+1),type:'简答',topic:'牙釉质结构',reason:'字幕讲解牙釉质结构',answer:'核对牙釉质结构',explanation:'仅依据所给字幕准备的合成测试解析'})))
 else if(input.subtitles)result=JSON.stringify({keyPoints:[{level:'必考',topic:'牙釉质结构',detail:'掌握结构',quote:'牙釉质结构这个必考。',timestamp:'00:00:01'}],notTested:[],uncertain:[]})
 else throw new Error('unexpected model fixture input')
 response.setHeader('content-type','application/json');response.end(JSON.stringify(value.input?{status:'completed',output:[{type:'message',content:[{type:'output_text',text:result}]}]}:{choices:[{message:{content:result}}]}))
})().catch(error=>{response.writeHead(500).end('isolated fixture rejected input');console.error(error)})})
await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address!=='string')
const env:Record<string,string>={...Object.fromEntries(Object.entries(process.env).filter((row):row is [string,string]=>typeof row[1]==='string')),LISTENING_ASSISTANT_DATA:data,LISTENING_ASSISTANT_TEST_API:'1'};delete env.ELECTRON_RUN_AS_NODE
type Lecture={id:string;transcript_path:string;video_path:string;ppt_path:string;time_estimated:number}
type Detail={lecture:Lecture;segments:{text:string;originalText:string;start:number;uncertain:boolean}[]}
const app=await electron.launch({executablePath:join(root,'node_modules/electron/dist/electron.exe'),args:[root],env})
try{
 let page:Page|undefined
 for(let index=0;index<120&&!page;index++){page=app.windows().find(window=>window.url().includes('/out/renderer/'));if(!page)await new Promise(resolve=>setTimeout(resolve,250))}
 assert.ok(page);await page.waitForFunction(()=>!!(window as unknown as {assistant?:unknown}).assistant)
 const invoke=<T,>(action:string,args:unknown={}):Promise<T>=>page!.evaluate(async({action,args})=>(window as unknown as {assistant:{invoke(action:string,args:unknown):Promise<unknown>}}).assistant.invoke(action,args),{action,args}) as Promise<T>
 const settings=await invoke<Settings>('settings:get');settings.connection='codex';settings.profiles=[{id:'fixture',name:'测试',model:'fixture-vision',baseUrl:'http://127.0.0.1:'+address.port+'/v1',apiKey:'fixture-only'}];settings.activeProfile='fixture';await invoke('settings:save',{settings})
 const course=await invoke<{id:string}>('course:create',{name:'原文流程验收'}),lecture=await invoke<Lecture>('lecture:create',{courseId:course.id,title:'第1讲',transcriptPath:original,pptPath:ppt})
 assert.ok(lecture.transcript_path.includes('语音原文'));assert.equal(lecture.video_path,'');assert.ok(lecture.ppt_path.includes('PPT'));assert.equal(await stat(join(data,'资料','视频')).then(()=>true,()=>false),false)
 const corrected=await invoke<Detail>('subtitles:generate',{id:lecture.id});assert.equal(corrected.segments.length,2);assert.equal(corrected.segments[0].text,'牙釉质结构这个必考。');assert.equal(corrected.segments[0].originalText,'牙油质结构这个必考。');assert.equal(corrected.segments[0].start,1000);assert.equal(corrected.segments[1].uncertain,true);assert.equal(corrected.lecture.time_estimated,1);assert.equal(imageCalls,1)
 const notes=await invoke<{keyPoints:{verified:boolean}[]}>('notes:generate',{id:lecture.id});assert.equal(notes.keyPoints[0].verified,true);await invoke('practice:generate',{id:lecture.id})
 await app.evaluate(({dialog})=>{dialog.showSaveDialog=async()=>{throw new Error('应自动归档')}})
 const output=await invoke<string>('export',{id:lecture.id,kind:'subtitles',format:'srt'});assert.ok(output.includes('笔记'));assert.ok((await readFile(output,'utf8')).includes('牙釉质'))
 settings.profiles[0].apiFormat='responses';await invoke('settings:save',{settings});await invoke('subtitles:generate',{id:lecture.id});assert.equal(imageCalls,2)
 bad=true;await assert.rejects(invoke('subtitles:generate',{id:lecture.id}));assert.equal((await invoke<Detail>('lecture:detail',{id:lecture.id})).segments[0].text,'牙釉质结构这个必考。');assert.equal(imageCalls,4)
 await invoke('lecture:transcript',{id:lecture.id,path:original});assert.equal((await invoke<Detail>('lecture:detail',{id:lecture.id})).segments.length,0)
 const report={typescriptMaintenanceEntry:true,realIsolatedWindow:true,syntheticModelOnly:true,originalPptWithTranscriptSameRequest:true,correctedTermsAndOriginalPreserved:true,uncertaintyAndTimestampsPreserved:true,verifiedTeacherEvidence:true,subtitleAutomaticallySaved:true,invalidCorrectionDoesNotReplaceOriginal:true,sourceReplacementInvalidatesOldSegments:true,imageCalls,correctionCalls,completeMigration:false}
 await writeFile(join(data,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({directory:data,...report}))
}finally{await app.close();await new Promise<void>(resolve=>server.close(()=>resolve()))}
