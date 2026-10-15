import {describe,it,expect,vi} from 'vitest'
const fake=vi.hoisted(()=>({info:{basic_info:{id:'abc123DEF_0',title:'YouTube合成课程',duration:2,is_live:false},playability_status:{status:'OK'},streaming_data:{formats:[] as unknown[],adaptive_formats:[] as unknown[]},captions:{caption_tracks:[{base_url:'https://www.youtube.com/api/timedtext?v=abc123DEF_0',language_code:'zh-Hans',kind:'asr',is_translatable:true}],translation_languages:[]}},requests:0}))
vi.mock('youtubei.js',()=>({default:{create:async()=>({session:{player:{}},getBasicInfo:async()=>{fake.requests++;return fake.info}})},Platform:{shim:{}}}))
import {NativeYoutubeCatalog,youtubeInput,youtubeSignature} from '../src/main/media-youtube'
import {selectBiliStreams} from '../src/main/media-bili'
import {mediaOptions} from '../src/main/media-options'
describe('native YouTube minimal acceptance',()=>{
 it('handles exact video/list links and rejects foreign hosts and ambiguous video identifiers',()=>{
  expect(youtubeInput('https://youtu.be/abc123DEF_0').id).toBe('abc123DEF_0');expect(youtubeInput('https://www.youtube.com/watch?v=abc123DEF_0&list=PLabcdefghijk').list).toBe('PLabcdefghijk')
  for(const value of ['https://youtube.com.evil.test/watch?v=abc123DEF_0','https://youtube.com/watch?v=abc123DEF_0&v=abcdefghijk','https://user@youtube.com/watch?v=abc123DEF_0'])expect(()=>youtubeInput(value)).toThrow()
 })
 it('deciphers only in isolated bounded WASM without Node, file or network globals',async()=>{
  expect(await youtubeSignature('return {sig:sig.split("").reverse().join(""),node:typeof process,fs:typeof require,net:typeof fetch}',{sig:'synthetic'})).toEqual({sig:'citehtnys',node:'undefined',fs:'undefined',net:'undefined'})
  await expect(youtubeSignature('while(true){}')).rejects.toThrow('预算')
 })
 it('projects separate media, exact identity and automatic captions without leaking signed URLs',async()=>{
  fake.info.streaming_data.adaptive_formats=[{itag:137,has_video:true,has_audio:false,height:1080,bitrate:500000,mime_type:'video/mp4; codecs="avc1"',decipher:async()=> 'https://fixture.googlevideo.com/video?sig=private-signed-url'},{itag:140,has_video:false,has_audio:true,bitrate:128000,mime_type:'audio/mp4; codecs="mp4a"',decipher:async()=> 'https://fixture.googlevideo.com/audio'}]
  const catalog=new NativeYoutubeCatalog(async()=>{throw new Error('受控SDK不访问网络')}),source=await catalog.read('https://youtu.be/abc123DEF_0',false,new AbortController().signal)
  if(!('streams'in source))throw new Error('missing source');expect(source.identity).toBe('youtube:abc123DEF_0');expect(selectBiliStreams(source,mediaOptions())).toHaveLength(2);expect(source.subtitleTracks?.[0]).toMatchObject({language:'ai-zh-Hans',format:'youtube-json3'});expect(JSON.stringify(source.catalog)).not.toContain('private-signed-url')
  fake.info.basic_info.id='DIFFERENT_0';await expect(catalog.read('https://youtu.be/abc123DEF_0',false,new AbortController().signal)).rejects.toThrow('未确认')
 })
})
