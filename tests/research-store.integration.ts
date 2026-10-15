import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import {mkdtempSync,readFileSync,mkdirSync,writeFileSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {randomUUID,createHash} from 'node:crypto'
import {NativeResearchStore} from '../src/main/research-store'
import {NativeResearchExtensions} from '../src/main/research-extensions'
import {NativeResearchMcp} from '../src/main/research-mcp'
const root=resolve('test-results');mkdirSync(root,{recursive:true});const directory=mkdtempSync(join(root,'research-store-'))
const op=()=>randomUUID().replaceAll('-',''),memoryRequest={op_id:op(),memory_id:null,revision:0,kind:'preference',title:'复习偏好',body:'先看教材，再核对字幕',source_task:null,paused:false,expires_at:null}
let store=new NativeResearchStore(directory)
const created=store.changeMemory(memoryRequest);assert.equal(created.revision,1);assert.equal(store.memories().capacity.used,1)
assert.deepEqual(store.changeMemory(memoryRequest),created);assert.throws(()=>store.changeMemory({...memoryRequest,title:'不同内容'}),/操作编号/)
store.changeMemory({...memoryRequest,op_id:op(),memory_id:created.memory_id,revision:1,paused:true});assert.equal(store.memories().records[0].availability,'paused')
assert.throws(()=>store.changeMemory({...memoryRequest,op_id:op(),memory_id:created.memory_id,revision:1}),/版本/)
store.changeMemory({op_id:op(),memory_id:created.memory_id,revision:2},true);assert.equal(store.memories().records.length,0)
const forgotten=store.read<{body:string;title:string}>('memory',created.memory_id);assert.equal(forgotten.body,'');assert.equal(forgotten.title,'')
const session=store.createConversation('龋病课堂复习'),organization={id:session.conversation_id,op:op(),revision:0,title:'龋病病因',pinned:true}
store.organizeConversation(organization);assert.equal(store.conversations().entries[0].pinned,true);assert.equal(store.conversation(session.conversation_id).title,'龋病病因')
assert.throws(()=>store.organizeConversation({...organization,op:op()}),/版本/)
const old=new Database(join(directory,'knowledge.sqlite'))
old.exec('CREATE TABLE kb_conversations(conversation_id TEXT,kb_root_id TEXT,title TEXT,revision INTEGER,updated_at TEXT); CREATE TABLE kb_conversation_organization(conversation_id TEXT,kb_root_id TEXT,revision INTEGER,pinned INTEGER); CREATE TABLE learning_memories(memory_id TEXT,kb_root_id TEXT,kind TEXT,title TEXT,body TEXT,revision INTEGER,created_at REAL,updated_at REAL,deleted INTEGER,source_task TEXT); CREATE TABLE learning_memory_availability(memory_id TEXT,paused INTEGER,expires_at REAL); CREATE TABLE kb_conversation_turns(turn_id TEXT,conversation_id TEXT,kb_root_id TEXT,question TEXT,answer TEXT);')
const cid='cv_'+op(),mid=op()
old.prepare('INSERT INTO kb_conversations VALUES(?,?,?,?,?)').run(cid,store.rootId,'历史会话',3,'2026-09-01T00:00:00Z')
old.prepare('INSERT INTO kb_conversation_organization VALUES(?,?,?,?)').run(cid,store.rootId,5,1)
old.prepare('INSERT INTO learning_memories VALUES(?,?,?,?,?,?,?,?,?,?)').run(mid,store.rootId,'progress','历史进度','已读第三章',2,1,2,0,null)
old.prepare('INSERT INTO learning_memory_availability VALUES(?,?,?)').run(mid,1,null)
old.prepare('INSERT INTO kb_conversation_turns VALUES(?,?,?,?,?)').run('turn_1',cid,store.rootId,'旧问题','旧回答')
old.prepare('INSERT INTO learning_memories VALUES(?,?,?,?,?,?,?,?,?,?)').run(op(),'another-root','progress','不属于此库','不可导入',1,1,2,0,null)
old.exec('CREATE TABLE document_saved_notes(kb_root_id TEXT,note_id TEXT,markdown TEXT,body_sha256 TEXT,body_bytes INTEGER,receipt_json TEXT);CREATE TABLE document_note_lifecycle_events(kb_root_id TEXT,note_id TEXT,revision INTEGER,state TEXT,body_sha256 TEXT)')
const noteId=op(),markdown='# 已保存旧笔记\n用户自己的核对结论',bodyHash=createHash('sha256').update(markdown).digest('hex')
old.prepare('INSERT INTO document_saved_notes VALUES(?,?,?,?,?,?)').run(store.rootId,noteId,markdown,bodyHash,Buffer.byteLength(markdown),JSON.stringify({note_id:noteId,title:'旧版学习笔记',body_sha256:bodyHash,created_at:'2026-09-01T00:00:00Z',verification:'unverified'}))
old.prepare('INSERT INTO document_note_lifecycle_events VALUES(?,?,?,?,?)').run(store.rootId,noteId,3,'archived',bodyHash)
old.exec('CREATE TABLE tutor_questions(kb_root_id TEXT,question_id TEXT,question TEXT,created_at TEXT,answer TEXT)')
const questionId=op();old.prepare('INSERT INTO tutor_questions VALUES(?,?,?,?,?)').run(store.rootId,questionId,'轮轴如何检查？','2026-09-01','THIS_ANSWER_MUST_NOT_LEAVE_THE_DATABASE')
old.exec('CREATE TABLE learning_agent_extensions(kb_root_id TEXT,root_identity TEXT,revision INTEGER,content_json TEXT);CREATE TABLE learning_mcp_catalog(kb_root_id TEXT,root_identity TEXT,revision INTEGER,content_json TEXT)')
const skillId=op(),serverId=op();old.prepare('INSERT INTO learning_agent_extensions VALUES(?,?,?,?)').run(store.rootId,'old-owned-scope',7,JSON.stringify({skills:[{id:skillId,name:'compare-sources',description:'旧学习方法',body:'比较当前原文',enabled:true,resources:[{path:'references/rules.md',content:'附属方法原文'}]}],standing_instructions:{enabled:true,body:'请简洁回复'},disabled_plugins:['practice']}))
old.prepare('INSERT INTO learning_mcp_catalog VALUES(?,?,?,?)').run(store.rootId,'old-owned-scope',4,JSON.stringify([{id:serverId,name:'旧MCP服务',endpoint:'https://example.com/mcp',enabled:true,allowed_tools:['lookup'],tools:[{name:'lookup',description:'旧工具说明',input_schema:{type:'object'},read_only_declared:true}]}]))
old.exec('CREATE TABLE learning_research_tasks(kb_root_id TEXT,state_json TEXT)')
const oldTaskId=op();old.prepare('INSERT INTO learning_research_tasks VALUES(?,?)').run(store.rootId,JSON.stringify({task_id:oldTaskId,kb_root_id:store.rootId,question:'旧研究问题',status:'completed',note:'旧保存回答',limitations:'原范围',sources:[{source_id:'S1',title:'旧资料',url:'https://example.com/old',text:'保存时原文',read:true}],provider:{api_key:'SYNTHETIC_PRIVATE_VALUE_MUST_NOT_BE_EXPOSED'}}))
old.close()
const hash=()=>createHash('sha256').update(readFileSync(join(directory,'knowledge.sqlite'))).digest('hex'),before=hash()
const practice=store.practiceQuestions('轮轴检查');assert.equal(practice[0].question_id,questionId);assert.equal(JSON.stringify(practice).includes('THIS_ANSWER_MUST_NOT_LEAVE_THE_DATABASE'),false)
const baseline=store.baselineLegacy();assert.equal(baseline.imported,true);assert.equal(hash(),before)
assert.equal(store.conversation(cid).turns.length,1);assert.equal(store.conversation(cid).pinned,true);assert.equal(store.conversation(cid).revision,5)
assert.equal(store.memories().records.length,1);assert.equal(store.memories().records[0].availability,'paused');assert.equal(store.memories().records[0].memory_id,mid)
const importedNote=store.read<{markdown:string;lifecycle:{state:string;revision:number};legacy:{referenceStatus:string}}>('note',noteId)
assert.equal(importedNote.markdown,markdown);assert.equal(importedNote.lifecycle.state,'archived');assert.equal(importedNote.lifecycle.revision,3);assert.equal(importedNote.legacy.referenceStatus,'not_revalidated')
const oldResearch=store.legacyResearchTasks()[0];assert.equal(oldResearch.task_id,oldTaskId);assert.equal(oldResearch.status,'legacy_saved');assert.equal(oldResearch.original_status,'completed');assert.equal(oldResearch.note,'旧保存回答');assert.equal(JSON.stringify(oldResearch).includes('SYNTHETIC_PRIVATE_VALUE_MUST_NOT_BE_EXPOSED'),false)
const extensions=new NativeResearchExtensions(store);assert.equal(extensions.list().revision,7);assert.equal(extensions.list().skills[0].resources?.[0].content,'附属方法原文');assert.equal(extensions.list().standing_instructions.body,'请简洁回复');assert.equal(extensions.list().plugins.find(row=>row.id==='practice')?.enabled,false)
const mcp=new NativeResearchMcp(store);assert.equal(mcp.list().revision,4);assert.equal(mcp.list().servers[0].enabled,false);assert.equal(mcp.list().servers[0].allowed_tools.length,0);assert.equal(mcp.list().servers[0].tools[0].description,'旧工具说明')
store.changeMemory({op_id:op(),memory_id:mid,revision:2},true)
assert.equal(store.list<Record<string,unknown>>('legacy:learning_memories').some(row=>row.memory_id===mid),false)
store.close();store=new NativeResearchStore(directory);assert.deepEqual(store.baselineLegacy(),baseline);assert.equal(hash(),before);assert.equal(store.conversation(session.conversation_id).title,'龋病病因');store.close()
const report={nativeSqlite:true,memoryCasAndIdempotence:true,forgetClearsContents:true,conversationVersioning:true,legacyDatabaseUnchanged:true,legacyConversationIdsTurnsAndPins:true,legacyPausedMemoryPreserved:true,otherRootExcluded:true,restart:true,productionToolsConnected:false,legacyNoteBytesAndArchiveVerified:true,legacyNoteSourceNotOverclaimed:true,forgetClearsNativeLegacySnapshot:true,readOnlyPracticeQuestionWithoutAnswer:true,legacyMethodsResourcesInstructionsPreserved:true,legacyMcpRequiresFreshDiscovery:true,legacyResearchReadOnlyAndCredentialsExcluded:true,fullResearchMigration:false}
writeFileSync(join(directory,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({directory,...report}))
