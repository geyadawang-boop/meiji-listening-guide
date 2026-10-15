import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {createHash,randomUUID} from 'node:crypto'
import {NativeResearchStore} from '../src/main/research-store'
import {NativeKnowledgeStore} from '../src/main/knowledge-store'
import {NativeResearchSources} from '../src/main/research-sources'
import {NativeResearchEngine,type NativeResearchTask} from '../src/main/research-engine'
import {NativeResearchWorkflows} from '../src/main/research-workflow'
import {NativeResearchNotes} from '../src/main/research-notes'
import {NativeResearchExtensions} from '../src/main/research-extensions'
import {NativeResearchExternal} from '../src/main/research-external'
import {NativeResearchFulltext} from '../src/main/research-fulltext'
const root=resolve('test-results');mkdirSync(root,{recursive:true});const directory=mkdtempSync(join(root,'research-engine-')),op=()=>randomUUID().replaceAll('-','')
void(async()=>{
 const store=new NativeResearchStore(directory),knowledge=new NativeKnowledgeStore(directory),sources=new NativeResearchSources(knowledge,store.rootId)
 const importText=async(text:string,expectedGeneration?:string)=>knowledge.import({title:'隔离维修课程',text,locator:'isolated://repair-course',sourceHash:createHash('sha256').update(text).digest('hex'),expectedGeneration})
 const initial=await importText('自行车车轮检查包含轮胎气压和轮轴。'),binding=sources.catalog().items[0].binding
 let calls=0,connection='fixture-model',model:(signal:AbortSignal)=>Promise<string>=async()=> '依据原文，检查轮胎气压与轮轴。[S1]'
 const engine=new NativeResearchEngine(store,sources,async(input,signal)=>{calls++;assert.match(input.user,/轮胎气压/);return model(signal)},()=>connection)
 async function done(id:string){for(let i=0;i<100;i++){const task=engine.read(id);if(task.status!=='running'&&task.status!=='paused')return task;await new Promise(resolve=>setTimeout(resolve,5))}throw new Error('研究状态未结束')}
 const request={op:op(),question:'应该如何检查自行车车轮？',channels:['library'],materials:[binding]}
 const created=engine.create(request),completed=await done(created.task_id);assert.equal(completed.status,'completed');assert.match(engine.verifyResult(created.task_id).note,/\[S1\]/);assert.equal(calls,1)
 const notes=new NativeResearchNotes(store,engine,directory),preview=notes.preview(created.task_id),expected={kb_root_id:preview.kb_root_id,note_sha256:preview.note_sha256,sources_sha256:preview.sources_sha256}
 const note=notes.save(created.task_id,expected);assert.equal(notes.save(created.task_id,expected).receipt.note_id,note.receipt.note_id);assert.equal(notes.source(note.receipt.note_id).status,'research_current')
 const revised=notes.revise({action:'manual_revision',schema_version:'1',operation_id:op(),parent_note_id:note.receipt.note_id,parent_body_sha256:note.receipt.body_sha256,markdown:'用户核对后的笔记 [S1]'})
 assert.notEqual(note.receipt.note_id,revised.receipt.note_id);assert.equal(notes.read(note.receipt.note_id).markdown,preview.markdown)
 notes.lifecycle({note_id:revised.receipt.note_id,body_sha256:revised.receipt.body_sha256,expected_revision:0,operation_id:op(),action:'archive'});assert.equal(notes.list('','archived').entries.length,1);await notes.export(revised.receipt.note_id)
 assert.equal(engine.create(request).task_id,created.task_id);assert.equal(calls,1)
 model=async()=> '虚构来源 [S99]';const invalid=engine.create({...request,op:op()});assert.equal((await done(invalid.task_id)).status,'failed');assert.equal(engine.read(invalid.task_id).note,'')
 let release:(text:string)=>void=()=>{},started:()=>void=()=>{}
 model=async()=>new Promise(resolve=>{release=resolve;started()})
 const waiting=new Promise<void>(resolve=>{started=resolve}),changed=engine.create({...request,op:op()});await waiting
 await importText('自行车轮轴检查已有新版本，请逐项检查轴承。',initial.entry.generation_id);release('依据旧版检查轮胎。[S1]')
 assert.equal((await done(changed.task_id)).status,'failed');assert.equal(engine.read(changed.task_id).note,'');assert.throws(()=>engine.verifyResult(completed.task_id),/已改变/)
 assert.equal(notes.source(note.receipt.note_id).status,'research_changed');assert.throws(()=>notes.save(created.task_id,expected),/已改变/)
 const current=sources.catalog().items[0].binding
 model=async signal=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('cancelled')),{once:true}))
 const stopped=engine.create({...request,op:op(),materials:[current]});engine.stop(stopped.task_id);assert.equal(engine.read(stopped.task_id).status,'stopped')
 const memory=store.changeMemory({op_id:op(),memory_id:null,revision:0,kind:'preference',title:'复习方法',body:'先看清单再看原文'})
 const conversation=store.createConversation('自行车保养复习'),localRequest={...request,op:op(),question:'我希望用清单复习轮轴',channels:['library','memory','notes','conversations'],materials:[current],conversation:{id:conversation.conversation_id,revision:conversation.revision}}
 let sawAuxiliary=false
 const localEngine=new NativeResearchEngine(store,sources,async(input)=>{sawAuxiliary=input.user.includes('先看清单再看原文')&&input.user.includes('本地辅助资料');return JSON.stringify({note:'检查轮轴与轴承。[S1]',memory_candidates:[{kind:'preference',title:'清单复习',body:'用户希望用清单复习轮轴',basis:'question',quote:'我希望用清单复习轮轴'}]})},()=>connection)
 const localTask=localEngine.create(localRequest)
 for(let i=0;i<100&&localEngine.read(localTask.task_id).status==='running';i++)await new Promise(resolve=>setTimeout(resolve,5))
 assert.equal(localEngine.read(localTask.task_id).status,'completed');assert.equal(sawAuxiliary,true);localEngine.verifyResult(localTask.task_id)
 assert.equal(store.memories().capacity.used,1)
 const suggestion=localEngine.read(localTask.task_id).memory_candidates[0],accept={candidate_id:suggestion.candidate_id,kind:'preference',title:'清单复习',body:'先列清单再学习'}
 const accepted=localEngine.acceptMemory(localTask.task_id,accept);assert.equal(localEngine.acceptMemory(localTask.task_id,accept).memory_id,accepted.memory_id);assert.equal(store.memories().capacity.used,2)
 assert.throws(()=>localEngine.acceptMemory(localTask.task_id,{...accept,body:'不同内容'}),/不同的修改/)
 const localNotes=new NativeResearchNotes(store,localEngine,directory),localPreview=localNotes.preview(localTask.task_id)
 localNotes.save(localTask.task_id,{kb_root_id:localPreview.kb_root_id,note_sha256:localPreview.note_sha256,sources_sha256:localPreview.sources_sha256})
 localEngine.verifyResult(localTask.task_id)
 store.changeMemory({op_id:op(),memory_id:memory.memory_id,revision:memory.revision,kind:'preference',title:'复习方法',body:'先看清单再看原文',paused:true})
 assert.throws(()=>localEngine.verifyResult(localTask.task_id),/已改变/)
 assert.equal(localEngine.read(localTask.task_id).memory_candidates[0].status,'accepted')
 await localEngine.dispose()
 let remoteCalls=0
 const external=new NativeResearchExternal(async(url)=>{remoteCalls++;assert.equal(new URL(url).hostname,'api.crossref.org');return {response:Response.json({status:'ok',message:{items:[{DOI:'10.1234/test',title:['自行车维护'],abstract:'检查轮轴轴承。'}]}}),close:async()=>{}}})
 const remoteEngine=new NativeResearchEngine(store,sources,async(input)=>{assert.match(input.user,/读取范围：abstract/);return '摘要讨论轮轴轴承。[S1]'},()=>connection,undefined,undefined,external)
 const remoteTask=remoteEngine.create({op:op(),question:'自行车维护',channels:['crossref'],materials:[]})
 for(let i=0;i<100&&remoteEngine.read(remoteTask.task_id).status==='running';i++)await new Promise(resolve=>setTimeout(resolve,5))
 assert.equal(remoteEngine.verifyResult(remoteTask.task_id).status,'completed');assert.equal(remoteCalls,1);assert.equal(remoteEngine.read(remoteTask.task_id).sources[0].binding,null)
 const remoteNotes=new NativeResearchNotes(store,remoteEngine,directory),remotePreview=remoteNotes.preview(remoteTask.task_id)
 assert.match(remotePreview.markdown,/external-snapshot/);remoteNotes.save(remoteTask.task_id,{kb_root_id:remotePreview.kb_root_id,note_sha256:remotePreview.note_sha256,sources_sha256:remotePreview.sources_sha256})
 await remoteEngine.dispose()
 let pagesRead=0
 const fulltext=new NativeResearchFulltext(async(url)=>{assert.equal(url,'https://example.com/wheel');pagesRead++;return {response:new Response('<title>Wheel manual</title><article><p>Inspect the wheel axle first.</p></article>',{headers:{'content-type':'text/html'}}),close:async()=>{}}})
 const search=new NativeResearchExternal(async()=>({response:new Response('<a class="result__a" href="https://example.com/wheel">Wheel manual</a><div class="result__snippet">Short excerpt.</div>',{headers:{'content-type':'text/html'}}),close:async()=>{}}))
 const pageEngine=new NativeResearchEngine(store,sources,async(input)=>{assert.match(input.user,/Inspect the wheel axle first/);assert.match(input.user,/web_excerpt/);return 'The selected webpage recommends checking the axle. [S2]'},()=>connection,undefined,undefined,search,fulltext)
 assert.throws(()=>pageEngine.create({op:op(),question:'wheel',channels:['web','web_pages']}),/明确填写/)
 const pageTask=pageEngine.create({op:op(),question:'wheel',channels:['web','web_pages'],fulltext:[{url:'https://example.com/wheel'}]})
 for(let i=0;i<100&&pageEngine.read(pageTask.task_id).status==='running';i++)await new Promise(resolve=>setTimeout(resolve,5))
 assert.equal(pageEngine.verifyResult(pageTask.task_id).status,'completed');assert.equal(pagesRead,1);assert.equal(pageEngine.read(pageTask.task_id).external?.[1].scope,'web_excerpt')
 const altered=pageEngine.read(pageTask.task_id);altered.sources[1].text='modified excerpt';store.put('task',altered.task_id,altered.revision,altered);assert.throws(()=>pageEngine.verifyResult(altered.task_id),/截断记录不符|快照不一致/)
 await pageEngine.dispose()

 await engine.dispose()
 const extensions=new NativeResearchExtensions(store),parsed=extensions.parseMarkdown('---\nname: compare-sources\ndescription: 对照不同来源\n---\n先比较原文，再检查差异。')
 assert.equal(parsed.enabled,false)
 extensions.change({op:op(),revision:0,change:{kind:'skill',id:null,...parsed,enabled:true}})
 const method=extensions.list().skills[0]
 extensions.change({op:op(),revision:1,change:{kind:'instructions',enabled:true,body:'请使用简洁中文'}})
 let seenMethod=false
 const methodEngine=new NativeResearchEngine(store,sources,async(input)=>{seenMethod=input.user.includes('先比较原文')&&input.system.includes('简洁中文');return '原文要求检查轮轴。[S1]'},()=>connection,extensions)
 const methodTask=methodEngine.create({...request,op:op(),materials:[current],skills:{revision:2,ids:[method.id]}})
 for(let i=0;i<100&&methodEngine.read(methodTask.task_id).status==='running';i++)await new Promise(resolve=>setTimeout(resolve,5))
 assert.equal(methodEngine.read(methodTask.task_id).status,'completed');assert.equal(seenMethod,true)
 const methodSnapshot=extensions.snapshot({revision:2,ids:[method.id]},['library'])
 extensions.change({op:op(),revision:2,change:{kind:'plugin',id:'library',enabled:false}})
 assert.throws(()=>extensions.verify(methodSnapshot),/已改变/);assert.throws(()=>methodEngine.create({...request,op:op(),materials:[current]}),/停用/)
 extensions.change({op:op(),revision:3,change:{kind:'plugin',id:'library',enabled:true}});await methodEngine.dispose()
 const paused:NativeResearchTask={...completed,task_id:op(),status:'running',revision:10,outcome_unknown:true};store.put('task',paused.task_id,paused.revision,paused)
 const recovered=new NativeResearchEngine(store,sources,async()=>{throw new Error('must not automatically call model')},()=>connection)
 const recoveredTask=recovered.read(paused.task_id);assert.equal(recoveredTask.status,'paused');assert.equal(recoveredTask.outcome_unknown,true);assert.throws(()=>recovered.resume(paused.task_id,recoveredTask.revision,false),/明确确认/)
 connection='different-model';assert.throws(()=>recovered.create({...request,op:op(),materials:[binding]}),/已改变/)
 await recovered.dispose()
 let workflowCalls=0
 const flowEngine=new NativeResearchEngine(store,sources,async()=>{workflowCalls++;return '当前原文要求逐项检查轮轴轴承。[S1]'},()=>connection),flows=new NativeResearchWorkflows(store,sources,flowEngine)
 const flow=flows.create({op:op(),question:'如何复习轮轴检查？',materials:[current]})
 assert.equal(flow.status,'paused');assert.equal(workflowCalls,0)
 const action={id:flow.workflow_id,op:op(),revision:flow.revision,fence:flow.fence,retry_unknown:false,kind:'resume'}
 flows.action(action)
 for(let i=0;i<200&&flows.read(flow.workflow_id).status==='running';i++)await new Promise(resolve=>setTimeout(resolve,5))
 const finished=flows.verify(flow.workflow_id);assert.equal(finished.steps.length,2);assert.equal(workflowCalls,2);assert.ok(finished.steps.every(step=>step.answer_sha256))
 assert.throws(()=>flows.action({...action,op:op()}),/版本已改变/)
 await flows.dispose();await flowEngine.dispose();knowledge.close();store.close()
 const report={durableNativeResearch:true,realNativeKnowledgeSources:true,modelFixtureOnly:true,sourceReadBeforeGeneration:true,sourceReverifiedBeforePublish:true,citationIdsChecked:true,idempotentCreate:true,sourceMutationBlocksAnswer:true,invalidCitationsNotPublished:true,userStop:true,interruptedModelRequiresExplicitRetry:true,oldCompletedSourcesRevalidated:true,twoStageWorkflowWithSeparateCalls:true,workflowSourcesAndAnswerHashesVerified:true,workflowFenceProtectsStaleActions:true,explicitPreviewAndSave:true,manualNoteRevisionPreservesOriginal:true,noteArchiveAndExport:true,changedSourcesBlockOldPreview:true,skillMarkdownInert:true,explicitMethodsAndInstructionsAttached:true,changedMethodsAndDisabledPluginsRefused:true,productionToolsConnected:false,localAuxiliarySelectionAndStalenessVerified:true,conversationButtonShapeAccepted:true,explicitMemorySuggestionAcceptance:true,addingNotesDoesNotInvalidateOwnResult:true,externalSnapshotToAnswerAndNotesFixtureVerified:true,noFullPaperReadingClaimed:true,explicitFulltextToAnswerVerified:true,modifiedPublishedSourceRefused:true,allChannelsImplemented:false,completeMigration:false}
 writeFileSync(join(directory,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({directory,...report}))
})().catch(error=>{console.error(error);process.exitCode=1})
