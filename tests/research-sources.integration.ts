import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs'
import {resolve,join} from 'node:path'
import {createHash} from 'node:crypto'
import {NativeKnowledgeStore} from '../src/main/knowledge-store'
import {NativeResearchSources} from '../src/main/research-sources'
const output=resolve('test-results');mkdirSync(output,{recursive:true});const directory=mkdtempSync(join(output,'research-sources-'))
void(async()=>{
 const knowledge=new NativeKnowledgeStore(directory),root='kbr_'+'a'.repeat(32),sources=new NativeResearchSources(knowledge,root)
 const text='自行车车轮维修：检查轮胎、轮轴和刹车。'
 const initial=await knowledge.import({title:'维修课程',text,locator:'isolated://repair',sourceHash:createHash('sha256').update(text).digest('hex')})
 const catalog=sources.catalog();assert.equal(catalog.items.length,1)
 const source=sources.read(catalog.items[0].binding);assert.equal(source.text,text);sources.verify([source])
 assert.equal(sources.search('车轮')[0].binding.bvid,source.binding.bvid)
 assert.throws(()=>sources.read({...source.binding,kb_root_id:'another-root'}),/另一资料库/)
 assert.throws(()=>sources.read({...source.binding,digest:'b'.repeat(64)}),/已改变/)
 const changed=text+' 更新了轮轴检查步骤。'
 await knowledge.import({title:'维修课程',text:changed,locator:'isolated://repair',sourceHash:createHash('sha256').update(changed).digest('hex'),expectedGeneration:initial.entry.generation_id})
 assert.throws(()=>sources.verify([source]),/已改变/)
 const current=sources.read(sources.catalog().items[0].binding);assert.equal(current.text,changed)
 knowledge.close()
 const report={nativeKnowledgeSourceShared:true,fullTextRead:true,evidenceMembershipChecked:true,keywordRecallUsesCurrentGeneration:true,changedDigestRefused:true,wrongRootRefused:true,updatedSourceBlocksOldResearch:true,productionToolsConnected:false,completeMigration:false}
 writeFileSync(join(directory,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({directory,...report}))
})().catch(error=>{console.error(error);process.exitCode=1})
