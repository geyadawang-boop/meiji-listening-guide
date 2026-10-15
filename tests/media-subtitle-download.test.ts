import {describe,it,expect,afterEach} from 'vitest'
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {boundedMediaResponse,downloadNativeSubtitles,matchesSubtitleLanguage} from '../src/main/media-subtitle-download'
import {mediaOptions} from '../src/main/media-options'
import type {BiliMediaSource} from '../src/main/media-bili'
const roots:string[]=[]
afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true})})
const signal=()=>new AbortController().signal
const source:BiliMediaSource={bvid:'BV1Q5HXzuEJX',cid:22,page:2,identity:'BV1Q5HXzuEJX:22:2',streams:[],catalog:{title:'第二节',url:'https://www.bilibili.com/video/BV1Q5HXzuEJX/?p=2',playlist:false,duration:3},subtitleTracks:[{language:'zh-CN',url:'https://i0.hdslb.com/subtitle.json',automatic:false}]}
const fetcher=async()=>new Response(JSON.stringify({body:[{from:0,to:1,content:'老师：这是重点'},{from:1,to:2,content:'请对照教材'}]}))
async function root(){const path=await mkdtemp(join(tmpdir(),'meijiang-native-captions-'));roots.push(path);return path}
describe('native downloadable subtitles',()=>{
 it('matches language glob patterns and exclusions without treating dots as wildcards',()=>{
  expect(matchesSubtitleLanguage('zh-CN','zh.*,zh-*,en,-en-US')).toBe(true)
  expect(matchesSubtitleLanguage('en-US','*,-en-US')).toBe(false)
  expect(matchesSubtitleLanguage('zh-CN','zh.*')).toBe(true)
  expect(matchesSubtitleLanguage('zh-CN','zh.CN')).toBe(false)
 })
 it('writes and verifies all supported output formats plus an independent SRT for embedding',async()=>{
  for(const format of ['srt','vtt','ass','lrc','original'] as const){const directory=await root(),files=await downloadNativeSubtitles(source,mediaOptions({subtitles:true,subtitle_format:format,subtitle_languages:'zh-*',embed_subtitles:true}),directory,fetcher,signal())
   const text=await readFile(join(directory,files[0].relative),'utf8');expect(text).toContain('这是重点');expect(files[0].embedRelative).toBe('embed-zh-CN.srt');expect(await readFile(join(directory,files[0].embedRelative!),'utf8')).toContain('00:00:00,000 --> 00:00:01,000')
  }
 })
 it('only downloads automatic tracks when explicitly included',async()=>{
  const automatic={...source,subtitleTracks:[{language:'ai-zh',url:'https://i0.hdslb.com/a.json',automatic:true}]},directory=await root()
  await expect(downloadNativeSubtitles(automatic,mediaOptions({subtitles:true,subtitle_languages:'ai-*'}),directory,fetcher,signal())).rejects.toThrow('没有可下载字幕')
  expect((await downloadNativeSubtitles(automatic,mediaOptions({auto_subtitles:true,subtitle_languages:'ai-*'}),directory,fetcher,signal()))[0].automatic).toBe(true)
 })
 it('refuses invalid timestamps, unsafe language paths and overwritten outputs',async()=>{
  const directory=await root(),options=mediaOptions({subtitles:true,subtitle_languages:'*'})
  await expect(downloadNativeSubtitles(source,options,directory,async()=>new Response(JSON.stringify({body:[{from:1,to:0,content:'错误'}]})),signal())).rejects.toThrow()
  await expect(downloadNativeSubtitles({...source,subtitleTracks:[{...source.subtitleTracks![0],language:'../escape'}]},options,directory,fetcher,signal())).rejects.toThrow('语言编号')
  await writeFile(join(directory,'subtitle-zh-CN.srt'),'user modified output')
  await expect(downloadNativeSubtitles(source,options,directory,fetcher,signal())).rejects.toThrow('内容不同');expect(await readFile(join(directory,'subtitle-zh-CN.srt'),'utf8')).toBe('user modified output')
 })
 it('bounds actual streamed bytes even when content-length is absent',async()=>{
  await expect(boundedMediaResponse(new Response('x'.repeat(100)),10)).rejects.toThrow('超过大小上限')
  await expect(boundedMediaResponse(new Response('bad',{status:403}),100)).rejects.toThrow('HTTP 403')
 })
})
