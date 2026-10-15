import {describe,it,expect} from 'vitest'
import {parseHls} from '../src/main/media-hls'
const check=(url:string)=>{const value=new URL(url);if(value.protocol!=='https:'||value.hostname!=='fixture.vimeocdn.com')throw new Error('foreign');return value.href}
const base='https://fixture.vimeocdn.com/path/master.m3u8'
describe('native bounded HLS',()=>{
 it('parses relative master variants and their separate audio groups',()=>{
  const parsed=parseHls('#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",DEFAULT=YES,URI="audio.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=100000,RESOLUTION=320x240,CODECS="avc1,mp4a",AUDIO="a"\nvideo.m3u8',base,check)
  expect(parsed.variants[0].height).toBe(240);expect(parsed.audio[0].url).toBe('https://fixture.vimeocdn.com/path/audio.m3u8')
 })
 it('preserves AES-128 sequence and only accepts complete VOD with checked segment URLs',()=>{
  const parsed=parseHls('#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:9007199254740993\n#EXT-X-KEY:METHOD=AES-128,URI="key"\n#EXTINF:2,\nsegment.ts\n#EXT-X-ENDLIST',base,check)
  expect(parsed.segments[0].sequence).toBe(9007199254740993n);expect(parsed.segments[0].key?.url).toBe('https://fixture.vimeocdn.com/path/key')
  for(const text of ['#EXTM3U\n#EXTINF:2,\na.ts','#EXTM3U\n#EXTINF:2,\nhttp://127.0.0.1/private\n#EXT-X-ENDLIST','#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI="key"\n#EXTINF:2,\na.ts\n#EXT-X-ENDLIST'])expect(()=>parseHls(text,base,check)).toThrow()
 })
})
