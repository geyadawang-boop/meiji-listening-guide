import {describe,it,expect} from 'vitest'
import {NativePlatformCatalog,platformInput} from '../src/main/media-platforms'
import {selectBiliStreams} from '../src/main/media-bili'
import {mediaOptions} from '../src/main/media-options'
const signal=()=>new AbortController().signal
const api={async readMedia(){throw new Error('B站接口不应被跨平台调用')}}
describe('native platform catalogs',()=>{
 it('canonicalizes exact video links without mistaking collections for one video',()=>{
  expect(platformInput('https://player.vimeo.com/video/123456?h=abc')).toEqual({platform:'vimeo',id:'123456',hash:'abc',url:'https://vimeo.com/123456/abc'})
  expect(platformInput('https://dai.ly/x123')).toMatchObject({platform:'dailymotion',id:'x123'})
  for(const url of ['https://vimeo.com.evil.test/123','https://vimeo.com/showcase/123','https://user@vimeo.com/123','https://player.vimeo.com/video/123?a=1#bad','https://vimeo.com/123/abc?h=different'])expect(()=>platformInput(url)).toThrow()
 })
 it('returns Vimeo progressive formats and applies height selection to complete tracks',async()=>{
  let calls=0;const catalog=new NativePlatformCatalog(api,async(url,init)=>{calls++;expect(url).toBe('https://player.vimeo.com/video/123456/config');expect(init?.redirect).toBe('error');return Response.json({video:{id:123456,title:'合成课程',duration:2,thumbs:{640:'https://i.vimeocdn.com/cover.jpg'}},request:{files:{progressive:[{height:360,url:'https://fixture.vimeocdn.com/360.mp4'},{height:720,url:'https://fixture.vimeocdn.com/720.mp4'}]}}})})
  const source=await catalog.read('https://vimeo.com/123456',false,signal());expect('streams'in source).toBe(true);if(!('streams'in source))throw new Error()
  expect(selectBiliStreams(source,mediaOptions({height:480}))[0].height).toBe(360);expect(source.identity).toBe('vimeo:123456');expect(source.catalog.formats).toHaveLength(2)
  await expect(catalog.read('https://vimeo.com/123456',true,signal())).rejects.toThrow('播放列表');await expect(catalog.read('https://vimeo.com/123456',false,signal(),{subtitles:true})).rejects.toThrow('字幕');expect(calls).toBe(1)
 })
 it('rejects identity changes and an untrusted media address supplied by metadata',async()=>{
  for(const row of [{id:999,url:'https://fixture.vimeocdn.com/file.mp4'},{id:123456,url:'http://127.0.0.1/private'},{id:123456,url:'https://vimeocdn.com.evil.test/private'}]){
   const catalog=new NativePlatformCatalog(api,async()=>Response.json({video:{id:row.id,title:'fixture',duration:2},request:{files:{progressive:[{height:720,url:row.url}]}}}));await expect(catalog.read('https://vimeo.com/123456',false,signal())).rejects.toThrow()
  }
 })
 it('reads Dailymotion direct formats and native HLS selection',async()=>{
  let streaming=false;const catalog=new NativePlatformCatalog(api,async()=>Response.json({id:'x123',title:'fixture',duration:2,qualities:{'720':[{type:streaming?'application/x-mpegURL':'video/mp4',url:'https://fixture.dailymotion.com/media'}]}}))
  const source=await catalog.read('https://dai.ly/x123',false,signal());expect('identity'in source&&source.identity).toBe('dailymotion:x123');streaming=true;const hls=await catalog.read('https://dai.ly/x123',false,signal());expect('streams'in hls&&hls.streams[0].transport).toBe('hls')
 })
})
