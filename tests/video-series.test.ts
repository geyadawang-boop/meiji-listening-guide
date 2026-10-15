import {test,expect,vi} from 'vitest'
const mocks=vi.hoisted(()=>({fetch:vi.fn(),window:vi.fn()}))
vi.mock('electron',()=>({BrowserWindow:mocks.window,session:{fromPartition:()=>({fetch:mocks.fetch,getUserAgent:()=> 'Mozilla/5.0 Chrome/149.0.0.0 Electron/42.11.10 listening-assistant/0.1.68',setPermissionRequestHandler:()=>{}})}}))
import {parseVideoSeries,readVideoSeries} from '../src/main/bilibili-series'
test('reading a link to P3 returns all parts and their own URLs',()=>{
 const s=parseVideoSeries('https://www.bilibili.com/video/BVabc/?p=3',{title:'课程',pages:[{page:1,part:'第一节',duration:120},{page:2,part:'第二节',duration:180},{page:3,part:'第三节',duration:240}]})
 expect(s.episodes.map(e=>new URL(e.url).searchParams.get('p'))).toEqual(['1','2','3']);expect(s.episodes[2].title).toBe('第三节')
})
test('reject incomplete or malformed directories instead of silently processing wrong parts',()=>{
 for(const state of [null,{pages:[]},{pages:[{page:2,part:'错位'}]},{pages:[{page:1,part:''}]}])expect(()=>parseVideoSeries('https://www.bilibili.com/video/BVabc/',state)).toThrow()
})
test('public directory API needs no video page or download',async()=>{
 mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({code:0,data:[{page:1,part:'101.口腔正畸学-第一节',duration:120},{page:2,part:'102.口腔正畸学-第二节',duration:180}]})))
 const series=await readVideoSeries('https://www.bilibili.com/video/BVabc/?p=2',new AbortController().signal)
 expect(series.episodes).toHaveLength(2);expect(mocks.fetch.mock.calls.at(-1)?.[0]).toBe('https://api.bilibili.com/x/player/pagelist?bvid=BVabc');expect(mocks.window).not.toHaveBeenCalled()
})
test('cancelled directory read does not start a network request',async()=>{
 const count=mocks.fetch.mock.calls.length,controller=new AbortController();controller.abort()
 await expect(readVideoSeries('https://www.bilibili.com/video/BVabc/',controller.signal)).rejects.toThrow();expect(mocks.fetch.mock.calls.length).toBe(count)
})
