import { expect,test } from 'vitest'
import { mkdtemp,readFile,rm,access } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { downloadVideoMedia } from '../src/main/video-download'

const url='https://upos-sz-mirrorcos.bilivideo.com/video.mp4'
test('only publishes a complete downloaded file',async()=>{
  const root=await mkdtemp(join(tmpdir(),'video-download-')),target=join(root,'video.mp4')
  try{
    const bytes=new Uint8Array(2048).fill(7)
    await downloadVideoMedia(url,target,async()=>new Response(bytes,{headers:{'content-length':'2048'}}),()=>{},new AbortController().signal)
    expect(await readFile(target)).toEqual(Buffer.from(bytes))
    await expect(access(target+'.partial')).rejects.toThrow()
  }finally{await rm(root,{recursive:true,force:true})}
})
test('retains partial data when a streaming download stalls',async()=>{
  const root=await mkdtemp(join(tmpdir(),'video-stall-')),target=join(root,'video.mp4')
  try{
    const body=new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new Uint8Array(2048))}})
    await expect(downloadVideoMedia(url,target,async()=>new Response(body),()=>{},new AbortController().signal,30)).rejects.toThrow('没有收到数据')
    expect((await readFile(target+'.partial')).length).toBe(2048)
    await expect(access(target)).rejects.toThrow()
  }finally{await rm(root,{recursive:true,force:true})}
})
test('does not follow media redirects to unrelated hosts',async()=>{
  await expect(downloadVideoMedia(url,'unused',async()=>new Response(null,{status:302,headers:{location:'https://example.com/secret.mp4'}}),()=>{},new AbortController().signal)).rejects.toThrow('不是受支持')
})
