import {describe,it,expect} from 'vitest'
import {NativeResearchExternal} from '../src/main/research-external'
import {readResearchAnswer} from '../src/main/research-memory'
type Exchange=NonNullable<ConstructorParameters<typeof NativeResearchExternal>[0]>
function fixture(reply:(url:URL)=>Response){const urls:string[]=[],closed:string[]=[];const exchange:Exchange=async(url)=>{urls.push(url);return {response:reply(new URL(url)),close:async()=>{closed.push(url)}}};return {service:new NativeResearchExternal(exchange),urls,closed}}
const signal=()=>new AbortController().signal
describe('explicit native research queries and snapshot boundaries',()=>{
 it('only queries selected metadata providers, distinguishes abstracts and validates saved bytes',async()=>{
  const f=fixture(url=>Response.json(url.hostname==='api.crossref.org'?{status:'ok',message:{items:[{DOI:'10.1234/TEST',title:['A <i>paper</i>'],abstract:'<jats:p>Actual abstract.</jats:p>'}]}}:{data:[{paperId:'a'.repeat(40),title:'Second paper',abstract:null,year:2025}]}))
  const rows=await f.service.search(['crossref','semantic'],'query',undefined,signal())
  expect(rows).toHaveLength(2);expect(rows[0].text).toContain('Actual abstract.');expect(rows[0].scope).toBe('abstract');expect(rows[1].scope).toBe('metadata');expect(f.closed).toEqual(f.urls);f.service.verify(rows)
  expect(()=>f.service.verify([{...rows[0],text:'modified'}])).toThrow(/快照/)
 })
 it('reads exact arXiv version using bounded XML without external entity resolution',async()=>{
  const f=fixture(()=>new Response('<feed><entry><id>http://arxiv.org/abs/1706.03762v7</id><title>Transformer</title><summary>Original abstract.</summary></entry></feed>'))
  const rows=await f.service.search(['arxiv'],'https://arxiv.org/abs/1706.03762v7',undefined,signal())
  expect(new URL(f.urls[0]).searchParams.get('id_list')).toBe('1706.03762v7');expect(rows[0].url).toBe('https://arxiv.org/abs/1706.03762v7');expect(rows[0].scope).toBe('abstract')
  expect(()=>f.service.parseArxiv('<!DOCTYPE feed SYSTEM "file:///secrets"><feed/>')).toThrow(/声明/)
 })
 it('keeps web search snippets separate from full-page reading and rejects captcha or private endpoints',async()=>{
  const f=fixture(()=>new Response('<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpaper">Paper</a><a class="result__snippet">Only a snippet.</a>'))
  const rows=await f.service.search(['web'],'query',undefined,signal());expect(rows[0]).toMatchObject({scope:'search_snippet',url:'https://example.com/paper',text:'Only a snippet.'});expect(f.urls).toHaveLength(1)
  await expect(f.service.search(['web'],'query',{provider:'searxng',endpoint:'https://127.0.0.1'},signal())).rejects.toThrow(/公开/)
  await expect(fixture(()=>new Response('<form id="challenge-form">bots use DuckDuckGo</form>')).service.search(['web'],'query',undefined,signal())).rejects.toThrow(/人工验证/)
 })
 it('does not silently switch providers or call the model after rate limiting',async()=>{
  const f=fixture(()=>new Response('limited',{status:429}));await expect(f.service.search(['crossref','semantic'],'query',undefined,signal())).rejects.toThrow(/限流/);expect(f.urls).toHaveLength(1);expect(f.closed).toHaveLength(1)
 })
 it('does not save or infer a memory preference without an exact user quote',()=>{
  const task={task_id:'a'.repeat(32),question:'请使用清单',limitations:'仅当前资料'}
  const candidate={kind:'preference',title:'格式偏好',body:'使用清单',basis:'question',quote:'请使用清单'}
  expect(readResearchAnswer(JSON.stringify({note:'回答 [S1]',memory_candidates:[candidate]}),task,true).candidates[0].status).toBe('pending')
  expect(()=>readResearchAnswer(JSON.stringify({note:'回答 [S1]',memory_candidates:[{...candidate,quote:'我已掌握所有课程'}]}),task,true)).toThrow(/原句/)
  expect(readResearchAnswer('回答 [S1]',task,false).candidates).toEqual([])
 })
})
