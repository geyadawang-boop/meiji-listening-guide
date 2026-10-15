import {app} from 'electron'
import assert from 'node:assert/strict'
import {mkdir,writeFile,readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {randomUUID,createHash} from 'node:crypto'
import {KnowledgeBase} from '../src/main/knowledge'
import {NativeResearchBackend} from '../src/main/research'
import type {NativeResearchTask} from '../src/main/research-engine'
const root=process.cwd(),output=join(root,'test-results','native-research-process-'+randomUUID()),op=()=>randomUUID().replaceAll('-','')
void(async()=>{
 await mkdir(output,{recursive:true});app.setPath('userData',output);await app.whenReady()
 const data=join(output,'data'),knowledge=new KnowledgeBase(join(root,'resources'),data)
 let calls=0,hold=false,aborted=false
 const backend=new NativeResearchBackend(data,async(input,signal)=>{
  calls++;assert.equal(input.connection,'isolated-connection');assert.match(input.user,/车轮/)
  if(hold)return new Promise((_resolve,reject)=>{signal.addEventListener('abort',()=>{aborted=true;reject(new Error('取消模型夹具'))},{once:true})})
  return '依据课堂资料，先检查轮胎气压，再核对轮轴。[S1]'
 })
 try{
  const text='车轮检查课堂资料：检查轮胎气压，再核对轮轴。'
  await knowledge.request('import',{title:'隔离研究资料',text,locator:'isolated://research-source',sourceHash:createHash('sha256').update(text).digest('hex')})
  await backend.request('configure',{connection:'isolated-connection',model:'fixture'})
  const catalog=await backend.request<{items:{binding:unknown}[]}>('materials',{});assert.equal(catalog.items.length,1)
  const task=await backend.request<NativeResearchTask>('agent-create',{op:op(),question:'如何检查车轮？',channels:['library'],materials:[catalog.items[0].binding]})
  async function until(id:string,state:string){for(let i=0;i<200;i++){const task=await backend.request<NativeResearchTask>('agent-read',{id});if(task.status===state)return task;if(task.status==='failed')throw new Error(task.error_code);await new Promise(resolve=>setTimeout(resolve,10))}throw new Error('研究完成等待超时')}
  await until(task.task_id,'completed');assert.equal(calls,1)
  const preview=await backend.request<{kb_root_id:string;note_sha256:string;sources_sha256:string;markdown:string}>('note-preview',{id:task.task_id})
  const note=await backend.request<{receipt:{note_id:string};markdown:string}>('note-save',{id:task.task_id,expected:{kb_root_id:preview.kb_root_id,note_sha256:preview.note_sha256,sources_sha256:preview.sources_sha256}})
  assert.equal(note.markdown,preview.markdown)
  const exported=await backend.request<string>('note-export',{id:note.receipt.note_id});assert.equal(await readFile(exported,'utf8'),preview.markdown)
  const memory=await backend.request<{memory_id:string}>('memory-change',{value:{op_id:op(),memory_id:null,revision:0,kind:'progress',title:'进度',body:'已核对车轮章节',paused:false,expires_at:null,source_task:null}})
  assert.ok(memory.memory_id)
  hold=true
  const stopped=await backend.request<NativeResearchTask>('agent-create',{op:op(),question:'继续检查车轮',channels:['library'],materials:[catalog.items[0].binding]})
  for(let i=0;i<100&&calls<2;i++)await new Promise(resolve=>setTimeout(resolve,10))
  await backend.request('agent-stop',{id:stopped.task_id})
  for(let i=0;i<100&&!aborted;i++)await new Promise(resolve=>setTimeout(resolve,10))
  assert.equal(aborted,true);assert.equal((await backend.request<NativeResearchTask>('agent-read',{id:stopped.task_id})).note,'')
  const report={realResearchUtilityProcess:true,nativeKnowledgeSharedAcrossWorkers:true,parentModelBridge:true,modelFixtureOnly:true,verifiedAnswer:true,previewSaveAndExport:true,nativeMemory:true,activeModelCancellationPropagated:true,productionToolsConnected:false,completeMigration:false}
  await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({output,...report}))
 }catch(error){console.error(error);process.exitCode=1}
 finally{await backend.dispose();knowledge.dispose();app.exit(Number(process.exitCode||0))}
})()
