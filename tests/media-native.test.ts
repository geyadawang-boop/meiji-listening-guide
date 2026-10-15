import {describe,it,expect} from 'vitest'
import {mediaOptions,mediaOptionChoices,mediaTuning} from '../src/main/media-options'
import {BiliMediaCatalog,biliMediaInput,biliMediaAddress,selectBiliStreams,type BiliMediaSource} from '../src/main/media-bili'
const signal=()=>new AbortController().signal
const bvid='BV1Q5HXzuEJX'
const video=(id:number,height:number,codecs='avc1',codecid=7)=>({id,height,codecs,codecid,bandwidth:height*1000,baseUrl:'https://upos.bilivideo.com/video?token=private'})
function fixture(play:unknown={dash:{video:[video(80,1080),video(64,720),video(80,1080,'av01',12)],audio:[{id:30280,bandwidth:192000,base_url:'https://upos.bilivideo.com/audio',codecs:'mp4a'}]}}){
 const requests:{path:string;params:Record<string,string>}[]=[]
 const api={async readMedia(path:string,params:Record<string,string>){requests.push({path,params});if(path.endsWith('/view'))return {bvid,title:'全课程',pages:[{cid:11,page:1,part:'第一节',duration:100},{cid:22,page:2,part:'第二节',duration:200}]};if(path.endsWith('/playurl'))return play;return {subtitle:{subtitles:[{lan:'zh-CN'},{lan:'danmaku'}]}}}}
 return {client:new BiliMediaCatalog(api),requests}
}
describe('native download options',()=>{
 it('preserves the existing UI recipe without enabling account export',()=>{
  const defaults=mediaOptionChoices().defaults
  expect(defaults.use_cookies).toBe(false);expect(defaults.height).toBe(0);expect(defaults.filename_template).toBe('%(title).100B [%(id)s].%(ext)s')
  expect(defaults.keep_subtitles&&defaults.skip_existing&&defaults.metadata).toBe(true)
 })
 it('normalizes subtitle dependencies before checking embed compatibility',()=>{
  const value=mediaOptions({translated_subtitles:true,embed_subtitles:true,container:'mp4'})
  expect(value.auto_subtitles&&value.subtitles).toBe(true);expect(value.container).toBe('mkv')
  expect(mediaOptions({subtitle_only:true}).subtitles).toBe(true)
 })
 it('rejects incompatible outputs, unsafe names and unknown fields',()=>{
  for(const input of [{subtitle_only:true,audio_only:true},{embed_subtitles:true},{clip_start:10},{clip_start:20,clip_end:10},{split_chapters:true,clip_start:0,clip_end:10},{crop_artwork:true},{filename_template:'../%(ext)s'},{filename_template:'C:\\%(ext)s'},{unknown:true},{height:true},{concurrent_fragments:17},{cookie_profile:'account'},{proxy:'http://user:pass@example.com'}])expect(()=>mediaOptions(input)).toThrow()
 })
 it('only accepts bounded structured tuning, never shell or output commands',()=>{
  expect(mediaTuning('--socket-timeout 30 --write-description')).toEqual({'--socket-timeout':30,'--write-description':true})
  for(const value of ['--exec calc','--output file','--socket-timeout 181','--sleep-interval NaN','--sleep-interval 0;calc'])expect(()=>mediaOptions({custom_args:value})).toThrow()
 })
})
describe('native Bili media discovery',()=>{
 it('pins a selected page and reads formats from official APIs without exposing CDN URLs',async()=>{
  const {client,requests}=fixture(),source=await client.read(`https://www.bilibili.com/video/${bvid}/?p=2`,false,signal()) as BiliMediaSource
  expect(source.identity).toBe(`${bvid}:22:2`);expect(source.catalog.title).toBe('第二节');expect(source.catalog.subtitles).toEqual(['zh-CN'])
  expect(requests[1].params.cid).toBe('22');expect(requests[2].params.cid).toBe('22')
  expect(JSON.stringify(source.catalog)).not.toContain('token=private')
  expect(source.catalog.formats?.map(f=>f.id)).toEqual(['v80-7','v64-7','v80-12','a30280-0'])
  expect(selectBiliStreams(source,mediaOptions({height:720})).map(s=>s.id)).toEqual(['v64-7','a30280-0'])
  expect(selectBiliStreams(source,mediaOptions({video_codec:'av1'}))[0].id).toBe('v80-12')
  expect(selectBiliStreams(source,mediaOptions({audio_only:true}))[0].kind).toBe('audio')
  expect(()=>selectBiliStreams(source,mediaOptions({height:144}))).toThrow('画质')
 })
 it('lists pages without fetching playback addresses or selecting all entries',async()=>{
  const {client,requests}=fixture(),catalog=await client.read(bvid,true,signal())
  expect('entries' in catalog&&catalog.entries?.length).toBe(2);expect(requests).toHaveLength(1)
 })
 it('refuses nonexistent pages, changed exact formats and audio-only selection as video',async()=>{
  const {client}=fixture()
  await expect(client.read(`https://www.bilibili.com/video/${bvid}/?p=3`,false,signal())).rejects.toThrow('不存在')
  await expect(client.read(bvid,false,signal(),{format_ids:'v80-old'})).rejects.toThrow('改变')
  const source=await client.read(bvid,false,signal()) as BiliMediaSource
  expect(()=>selectBiliStreams(source,mediaOptions({format_ids:'a30280-0'}))).toThrow('视频格式')
  expect(()=>selectBiliStreams(source,mediaOptions({format_ids:'v80-7',audio_only:true}))).toThrow('冲突')
 })
 it('keeps progressive segments in their original sequence',async()=>{
  const {client}=fixture({quality:80,durl:[{url:'https://upos.bilivideo.com/1',length:20,size:100},{url:'https://upos.bilivideo.com/2',length:30,size:200}]})
  const source=await client.read(bvid,false,signal()) as BiliMediaSource
  expect(selectBiliStreams(source,mediaOptions())[0].urls).toEqual(['https://upos.bilivideo.com/1','https://upos.bilivideo.com/2'])
 })
 it('rejects foreign media hosts, credentials and ambiguous page inputs',()=>{
  for(const value of ['https://bilivideo.com.evil.test/a','http://upos.bilivideo.com/a','https://user:pass@upos.bilivideo.com/a','https://127.0.0.1/a'])expect(()=>biliMediaAddress(value)).toThrow()
  for(const value of [`https://bilibili.com.evil.test/video/${bvid}`,`https://bilibili.com/video/${bvid}?p=1&p=2`,`https://bilibili.com/video/${bvid}?p=0`])expect(()=>biliMediaInput(value)).toThrow()
 })
 it('does not silently claim playable formats from empty responses',async()=>{
  await expect(fixture({}).client.read(bvid,false,signal())).rejects.toThrow('可用音视频')
 })
 it('applies declared native sort priorities and rejects unsupported expressions',async()=>{
  const {client}=fixture(),source=await client.read(bvid,false,signal()) as BiliMediaSource
  expect(selectBiliStreams(source,mediaOptions({format_sort:'+res'}))[0].height).toBe(720)
  expect(selectBiliStreams(source,mediaOptions({format_sort:'vcodec:av1,res'}))[0].codec).toBe('av01')
  expect(selectBiliStreams(source,mediaOptions({custom_args:'--prefer-free-formats'}))[0].codec).toBe('av01')
  expect(()=>mediaOptions({format_sort:'unknown:999'})).toThrow(/排序/)
 })
})
