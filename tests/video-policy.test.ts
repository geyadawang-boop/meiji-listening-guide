import {test,expect} from 'vitest'
import {bilibiliUrl,videoMediaUrl,checkedRegion,StableSlides} from '../src/main/video-policy'
test('Bilibili URLs preserve the selected part and reject foreign sites',()=>{
 expect(bilibiliUrl('https://www.bilibili.com/video/BV1Q5HXzuEJX/?p=5')).toContain('p=5')
 for(const u of ['http://www.bilibili.com/video/BVabc','https://bilibili.com.evil/video/BVabc','https://www.bilibili.com/video/BVabc?p=-1'])expect(()=>bilibiliUrl(u)).toThrow()
 expect(videoMediaUrl('https://upos-sz-mirrorcos.bilivideo.com/a.mp4?token=a')).toBe(true)
 for(const u of ['https://bilivideo.com.evil/a.mp4','http://127.0.0.1/a.mp4','https://bilivideo.com:8443/a.mp4'])expect(videoMediaUrl(u)).toBe(false)
})
test('stable slide selection keeps early clean frame, includes later content changes, skips transitions',()=>{
 const d=new StableSlides(),a=Buffer.alloc(100,60),b=Buffer.alloc(100,230),transition=Buffer.alloc(100,130),notes=Buffer.from(b);notes.fill(180,0,10)
 d.push(a,0);d.push(a,1);d.push(transition,2);d.push(b,3);d.push(b,4);d.push(notes,5);d.push(notes,6)
 expect(d.times).toEqual([0,3,5])
})
test('crop rejects zero area and non-finite coordinates',()=>{
 expect(()=>checkedRegion({left:0,right:1,top:0,bottom:1})).not.toThrow()
 expect(()=>checkedRegion({left:.9,right:.5,top:0,bottom:1})).toThrow()
 expect(()=>checkedRegion({left:NaN,right:1,top:0,bottom:1})).toThrow()
})
