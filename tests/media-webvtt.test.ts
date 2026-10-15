import {it,expect} from 'vitest'
import {nativeVttCues} from '../src/main/media-subtitle-download'
import {NativePlatformCatalog} from '../src/main/media-platforms'
it('reads WebVTT cue identifiers, settings, voice markup and entities as inert text',()=>{expect(nativeVttCues('WEBVTT\n\nNOTE metadata\nnot a cue\n\ncue-id\n00:00.000 --> 00:01.500 align:start\n<v Speaker>原文 &amp; <b>重点</b>\n\n00:00:02.000 --> 00:00:03.000\n下一页\n').body).toEqual([{from:0,to:1.5,content:'原文 & 重点'},{from:2,to:3,content:'下一页'}]);expect(()=>nativeVttCues('WEBVTT\n\n00:99.000 --> 00:01.000\nbad')).toThrow();expect(()=>nativeVttCues('<html>sign in</html>')).toThrow()})
it('discovers exact Vimeo and Dailymotion subtitle tracks without exposing unrelated hosts',async()=>{
 const api={async readMedia(){throw new Error('Must not use Bili login')}}
 const vimeo=new NativePlatformCatalog(api,async()=>Response.json({video:{id:123456,title:'VTT fixture',duration:3},request:{files:{},text_tracks:[{lang:'zh-CN',url:'/texttrack/caption.vtt'}]}})),source=await vimeo.read('https://vimeo.com/123456',false,new AbortController().signal,{subtitle_only:true})
 expect('subtitleTracks'in source&&source.subtitleTracks?.[0]).toMatchObject({language:'zh-CN',url:'https://player.vimeo.com/texttrack/caption.vtt',format:'webvtt'})
 const dm=new NativePlatformCatalog(api,async()=>Response.json({id:'x123',title:'VTT fixture',duration:3,qualities:{},subtitles:{data:{en:{urls:['https://s.dmcdn.net/caption.vtt']}}}})),result=await dm.read('https://dai.ly/x123',false,new AbortController().signal,{subtitle_only:true,subtitle_languages:'en'})
 expect('subtitleTracks'in result&&result.subtitleTracks?.[0].language).toBe('en')
 const invalid=new NativePlatformCatalog(api,async()=>Response.json({video:{id:123456,title:'bad',duration:3},request:{files:{},text_tracks:[{lang:'en',url:'http://127.0.0.1/private'}]}}));await expect(invalid.read('https://vimeo.com/123456',false,new AbortController().signal,{subtitle_only:true})).rejects.toThrow('核验')
})
