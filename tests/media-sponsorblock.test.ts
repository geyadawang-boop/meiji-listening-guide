import {describe,it,expect,afterEach} from 'vitest'
import {mkdtemp,mkdir,rm,readFile,readdir,writeFile} from 'node:fs/promises'
import {resolve,join,sep} from 'node:path'
import {createHash} from 'node:crypto'
import {removalTimeline,retimeMediaCues,checkedMediaIntervals} from '../src/main/media-timeline'
import {sponsorBlockPlan} from '../src/main/media-sponsorblock'
import {downloadNativeSubtitles} from '../src/main/media-subtitle-download'
import {mediaOptions} from '../src/main/media-options'
import type {NativeMediaSource} from '../src/main/media-source'
const base=resolve('test-results/sponsor-unit'),owned:string[]=[]
async function directory(){await mkdir(base,{recursive:true});const path=await mkdtemp(join(base,'fixture-'));owned.push(path);return path}
afterEach(async()=>{for(const path of owned.splice(0)){if(!path.startsWith(base+sep))throw new Error('Unexpected fixture path');await rm(path,{recursive:true,force:true})}})
const source:NativeMediaSource={platform:'youtube',sourceId:'abcdefghijk',identity:'youtube:abcdefghijk',streams:[],catalog:{url:'https://www.youtube.com/watch?v=abcdefghijk',title:'合成测试',playlist:false,duration:10}}
const row=(start:number,end:number,extra={})=>({segment:[start,end],category:'sponsor',actionType:'skip',videoDuration:10,UUID:'fixture-segment',...extra})
describe('native removal timeline',()=>{
 it('merges overlapping cuts, intersects the selected clip and never removes content twice',()=>{expect(removalTimeline(10,[{start:1,end:3},{start:2,end:4},{start:8,end:10}],{start:2,end:9})).toEqual({removed:[{start:2,end:4},{start:8,end:9}],kept:[{start:4,end:8}],duration:4})})
 it('rejects an empty result and invalid or overlapping retained ranges',()=>{expect(()=>removalTimeline(10,[{start:0,end:10}])).toThrow('没有剩余');for(const ranges of [[],[{start:0,end:11}],[{start:4,end:5},{start:3,end:4}]])expect(()=>checkedMediaIntervals(ranges,10)).toThrow()})
 it('splits a caption spanning a cut and keeps chapter timestamps on the edited timeline',()=>{expect(retimeMediaCues([{start:1,end:8,text:'内容'}],[{start:0,end:2},{start:5,end:10}])).toEqual([{start:1,end:2,text:'内容'},{start:2,end:5,text:'内容'}])})
})
describe('SponsorBlock read-only lookup and recovery',()=>{
 it('uses only the hash prefix, exact video and selected skip categories; reuses the frozen plan',async()=>{
  const path=await directory(),requests:{url:string;init?:RequestInit}[]=[],fetcher=async(url:string,init?:RequestInit)=>{requests.push({url,init});return Response.json([{videoID:'other-video',segments:[row(0,10)]},{videoID:source.sourceId,segments:[row(2,3),row(5,6),row(0,1,{category:'intro'}),row(7,8,{actionType:'mute'})]}])}
  const plan=await sponsorBlockPlan(source,mediaOptions({sponsorblock:'sponsor'}),path,fetcher,new AbortController().signal)
  expect(plan.duration).toBe(8);expect(plan.kept).toEqual([{start:0,end:2},{start:3,end:5},{start:6,end:10}]);expect(requests).toHaveLength(1)
  expect(new URL(requests[0].url).pathname).toBe('/api/skipSegments/'+createHash('sha256').update(source.sourceId!).digest('hex').slice(0,4));expect(requests[0].url).not.toContain(source.sourceId);expect(requests[0].init?.credentials).toBe('omit');expect(JSON.stringify(requests[0].init?.headers)).not.toMatch(/cookie|authorization/i)
  expect((await sponsorBlockPlan(source,mediaOptions({sponsorblock:'sponsor'}),path,fetcher,new AbortController().signal)).kept).toEqual(plan.kept);expect(requests).toHaveLength(1)
  const saved=JSON.parse(await readFile(join(path,plan.relative),'utf8'));expect(saved.attribution).toContain('CC BY-NC-SA');saved.duration=12;await writeFile(join(path,plan.relative),JSON.stringify(saved));await expect(sponsorBlockPlan(source,mediaOptions({sponsorblock:'sponsor'}),path,fetcher,new AbortController().signal)).rejects.toThrow('已改变')
 })
 it('treats 404 as an explicit unchanged result, rather than claiming a cut',async()=>{const plan=await sponsorBlockPlan(source,mediaOptions({sponsorblock:'intro'}),await directory(),async()=>new Response(null,{status:404}),new AbortController().signal);expect(plan.removed).toEqual([]);expect(plan.warning).toContain('未额外移除')})
 it('refuses stale durations and server errors without saving a valid plan',async()=>{
  for(const response of [Response.json([{videoID:source.sourceId,segments:[row(2,3,{videoDuration:20})]}]),new Response(null,{status:503})]){const path=await directory();await expect(sponsorBlockPlan(source,mediaOptions({sponsorblock:'sponsor'}),path,async()=>response,new AbortController().signal)).rejects.toThrow();expect(await readdir(path)).toEqual([])}
 })
 it('rejects unsupported platforms and incompatible combinations before downloading',async()=>{await expect(sponsorBlockPlan({...source,platform:'bilibili'},mediaOptions({sponsorblock:'sponsor'}),await directory(),async()=>{throw new Error('Must not fetch')},new AbortController().signal)).rejects.toThrow('仅支持 YouTube');for(const input of [{sponsorblock:'sponsor',subtitle_only:true},{sponsorblock:'sponsor',split_chapters:true}])expect(()=>mediaOptions(input)).toThrow('分别建立任务')})
 it('retimes embedded and independent subtitles, including the original JSON format',async()=>{
  const path=await directory(),result=await downloadNativeSubtitles({...source,subtitleTracks:[{language:'zh',url:'https://fixture.invalid/subs',automatic:false}]},mediaOptions({subtitles:true,subtitle_languages:'zh',embed_subtitles:true,subtitle_format:'original'}),path,async()=>Response.json({body:[{from:1,to:8,content:'对照内容'}]}),new AbortController().signal,[{start:0,end:2},{start:5,end:10}])
  expect(JSON.parse(await readFile(join(path,result[0].relative),'utf8')).body).toEqual([{from:1,to:2,content:'对照内容'},{from:2,to:5,content:'对照内容'}]);expect(await readFile(join(path,result[0].embedRelative!),'utf8')).toContain('00:00:02,000 --> 00:00:05,000')
 })
})
