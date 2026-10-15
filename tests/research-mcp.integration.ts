import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {randomUUID} from 'node:crypto'
import {NativeResearchStore} from '../src/main/research-store'
import {NativeResearchMcp} from '../src/main/research-mcp'
import {NativeMcpSession} from '../src/main/research-mcp-transport'
import {NativeKnowledgeStore} from '../src/main/knowledge-store'
import {NativeResearchSources} from '../src/main/research-sources'
import {NativeResearchEngine} from '../src/main/research-engine'
import {NativeResearchExtensions} from '../src/main/research-extensions'
import {createHash} from 'node:crypto'
const output=resolve('test-results');mkdirSync(output,{recursive:true});const directory=mkdtempSync(join(output,'research-mcp-')),op=()=>randomUUID().replaceAll('-','')
void(async()=>{
 const store=new NativeResearchStore(directory);let sent=0,failed=false,changed=false
 const schema={type:'object',properties:{query:{type:'string',minLength:1,maxLength:100}},required:['query'],additionalProperties:false}
 const mcp=new NativeResearchMcp(store,endpoint=>new NativeMcpSession(endpoint,async(_url,init)=>{
  if(init.method==='DELETE')return {response:new Response(null,{status:204}),close:async()=>{}}
  const request=JSON.parse(String(init.body));if(request.method==='notifications/initialized')return {response:new Response(null,{status:202}),close:async()=>{}}
  let result:unknown
  if(request.method==='initialize')result={protocolVersion:'2025-11-25',capabilities:{tools:{}}}
  else if(request.method==='tools/list')result={tools:[{name:'lookup',description:changed?'changed definition':'公开只读检索',inputSchema:schema,annotations:{readOnlyHint:true}},{name:'dangerous-write',inputSchema:{type:'object'},annotations:{readOnlyHint:true,destructiveHint:true}}]}
  else{sent++;if(failed)throw new Error('response lost after send');result={content:[{type:'text',text:'外部工具返回的未核实检索线索'}]}}
  return {response:new Response(JSON.stringify({jsonrpc:'2.0',id:request.id,result}),{headers:{'content-type':'application/json','MCP-Session-Id':'fixture-session'}}),close:async()=>{}}
 }))
 const created=mcp.change({op:op(),revision:0,change:{kind:'server',id:null,name:'公开检索',endpoint:'https://public.example/mcp',enabled:false,allowed_tools:[]}}),id=created.servers[0].id
 const discovered=await mcp.discover({op:op(),id,revision:1},new AbortController().signal);assert.equal(discovered.servers[0].tools.length,2);assert.equal(discovered.servers[0].tools[1].read_only_declared,false)
 assert.throws(()=>mcp.change({op:op(),revision:2,change:{...discovered.servers[0],kind:'server',enabled:true,allowed_tools:['dangerous-write']}}),/声明只读/)
 mcp.change({op:op(),revision:2,change:{kind:'server',id,name:'公开检索',endpoint:'https://public.example/mcp',enabled:true,allowed_tools:['lookup']}})
 const snapshot=mcp.snapshot({revision:3,items:[{server_id:id,tool:'lookup'}]}),request={op:op(),taskId:op(),snapshot,serverId:id,tool:'lookup',arguments:{query:'车轮'}}
 await assert.rejects(()=>mcp.call({...request,arguments:{query:7}},new AbortController().signal),/参数不符合/);assert.equal(sent,0)
 const result=await mcp.call(request,new AbortController().signal);assert.equal(result.status,'completed');assert.match(result.usage,/未核实/);assert.equal(sent,1)
 assert.deepEqual(await mcp.call(request,new AbortController().signal),result);assert.equal(sent,1)
 failed=true;const uncertain={...request,op:op()};await assert.rejects(()=>mcp.call(uncertain,new AbortController().signal),/response lost/);assert.equal(sent,2)
 await assert.rejects(()=>mcp.call(uncertain,new AbortController().signal),/不自动重放/);assert.equal(sent,2)
 failed=false;changed=true;await assert.rejects(()=>mcp.call({...request,op:op()},new AbortController().signal),/实时工具定义/);assert.equal(sent,2)
 mcp.change({op:op(),revision:3,change:{kind:'server',id,name:'公开检索',endpoint:'https://public.example/mcp',enabled:false,allowed_tools:['lookup']}});assert.throws(()=>mcp.verify(snapshot),/已改变/)
 changed=false;mcp.change({op:op(),revision:4,change:{kind:'server',id,name:'公开检索',endpoint:'https://public.example/mcp',enabled:true,allowed_tools:['lookup']}})
 const knowledge=new NativeKnowledgeStore(directory),sourceText='车轮维修课堂原文：先检查轮胎气压。'
 await knowledge.import({title:'课堂资料',text:sourceText,locator:'isolated://mcp-research',sourceHash:createHash('sha256').update(sourceText).digest('hex')})
 const sources=new NativeResearchSources(knowledge,store.rootId);let modelCalls=0
 const engine=new NativeResearchEngine(store,sources,async request=>{modelCalls++;if(request.system.includes('字段 arguments'))return JSON.stringify({arguments:{query:'车轮'}});assert.match(request.user,/未核实线索/);return '按课堂原文检查轮胎气压。[S1]'},()=> 'fixture',new NativeResearchExtensions(store),mcp)
 const task=engine.create({op:op(),question:'如何检查车轮？',channels:['library'],materials:[sources.catalog().items[0].binding],mcp:{revision:5,items:[{server_id:id,tool:'lookup'}]}})
 for(let i=0;i<100&&engine.read(task.task_id).status==='running';i++)await new Promise(resolve=>setTimeout(resolve,5))
 assert.equal(engine.read(task.task_id).status,'completed');assert.equal(modelCalls,2);assert.equal(sent,3);assert.equal(engine.verifyResult(task.task_id).tool_results?.length,1)
 await engine.dispose();knowledge.close();store.close()
 const report={nativeSqliteCatalog:true,protocolFixtureOnly:true,explicitAllowlist:true,destructiveToolsDisabled:true,localJsonSchemaBeforeSend:true,verifiedReadOnlyToolCall:true,resultMarkedUnverified:true,durableCallIdempotence:true,unknownCallNeverAutomaticallyReplayed:true,realtimeDefinitionRechecked:true,changedCatalogInvalidatesSnapshot:true,productionResearchToolLoopConnected:false,nativeEngineFixtureLoopVerified:true,separateToolArgumentAndAnswerCalls:true,completeMigration:false}
 writeFileSync(join(directory,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({directory,...report}))
})().catch(error=>{console.error(error);process.exitCode=1})
