import {describe,it,expect} from 'vitest'
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {SubtitleSync,subtitleLocator} from '../src/main/subtitle-sync'
const srt='1\n00:00:00,000 --> 00:00:01,000\n牙体组织结构\n'
describe('selected subtitle synchronization',()=>{
  it('canonicalizes source identity without tracking arguments',()=>{
    expect(subtitleLocator('https://bilibili.com/video/BV1Q5HXzuEJX?share=abc&p=2')).toBe('https://www.bilibili.com/video/BV1Q5HXzuEJX/?p=2')
    expect(()=>subtitleLocator('https://elsewhere.example/video/BV1Q5HXzuEJX')).toThrow()
  })
  it('freezes selected parts, keeps a verified SRT on publication failure and retries without reacquisition',async()=>{
    const root=await mkdtemp(join(process.cwd(),'test-results-sync-'))
    try{
      const sync=new SubtitleSync(join(root,'records'),root),path=join(root,'part2.srt')
      const task=await sync.create([{page:2,title:'第二节',url:'https://www.bilibili.com/video/BV1Q5HXzuEJX/?p=2'}],'课程')
      let acquisitions=0,publishing=0
      const dependencies={progress:()=>{},acquire:async()=>{acquisitions++;await writeFile(path,srt);return {srt,path}},publish:async()=>{if(++publishing===1)throw new Error('发布暂时失败');return {unchanged:false}}}
      expect((await sync.run(task.id,dependencies,new AbortController().signal)).items[0].status).toBe('失败')
      const resumed=await sync.run(task.id,dependencies,new AbortController().signal)
      expect(resumed.items[0].status).toBe('已完成');expect(acquisitions).toBe(1)
      expect((await sync.list())[0].items).toHaveLength(1)
      await writeFile(path,srt.replace('牙体','牙髓'))
      await sync.run(task.id,dependencies,new AbortController().signal)
      expect(acquisitions).toBe(2)
      expect(await readFile(path,'utf8')).toBe(srt)
    }finally{await rm(root,{recursive:true,force:true})}
  })
  it('persists interrupted selections and does not publish after cancellation',async()=>{
    const root=await mkdtemp(join(process.cwd(),'test-results-sync-'))
    try{
      const sync=new SubtitleSync(join(root,'records'),root),path=join(root,'part.srt'),abort=new AbortController()
      const task=await sync.create([{page:1,title:'第一节',url:'https://www.bilibili.com/video/BV1Q5HXzuEJX/'}],'')
      let publishes=0
      await expect(sync.run(task.id,{progress:()=>{},acquire:async()=>{await writeFile(path,srt);abort.abort();return {srt,path}},publish:async()=>{publishes++;return {unchanged:false}}},abort.signal)).rejects.toThrow()
      const saved=(await sync.list())[0];expect(saved.interrupted).toBe(true);expect(saved.items[0].hash).toBeTruthy();expect(publishes).toBe(0)
    }finally{await rm(root,{recursive:true,force:true})}
  })
  it('accepts an explicitly assigned local SRT without fetching audio or relabeling it as site subtitles',async()=>{
    const root=await mkdtemp(join(process.cwd(),'test-results-sync-'))
    try{
      const sync=new SubtitleSync(join(root,'records'),root),path=join(root,'assigned.srt')
      const task=await sync.create([{page:3,title:'第三节',url:'https://www.bilibili.com/video/BV1Q5HXzuEJX/?p=3'}],'')
      await writeFile(path,srt);await sync.attach(task.id,3,path)
      const result=await sync.run(task.id,{progress:()=>{},acquire:async()=>{throw new Error('不应再请求视频')},publish:async item=>{expect(item.sourceMethod).toBe('用户指定 SRT');return {unchanged:false}}},new AbortController().signal)
      expect(result.items[0].status).toBe('已完成')
      await expect(sync.attach(task.id,1,path)).rejects.toThrow('按视频网址明确选择')
      await expect(sync.attach(task.id,3,join(root,'..','outside.srt'))).rejects.toThrow('不在课程资料目录')
    }finally{await rm(root,{recursive:true,force:true})}
  })
  it('requires URL selection when mixed videos have the same part number',async()=>{
    const root=await mkdtemp(join(process.cwd(),'test-results-sync-'))
    try{
      const sync=new SubtitleSync(join(root,'records'),root),path=join(root,'assigned.srt')
      const items=['BV1Q5HXzuEJX','BV1A5HYzBEmG'].map(id=>({page:2,title:id,url:`https://www.bilibili.com/video/${id}/?p=2`}))
      const task=await sync.create(items,'');await writeFile(path,srt)
      await expect(sync.attach(task.id,2,path)).rejects.toThrow('按视频网址明确选择')
      const assigned=await sync.attach(task.id,items[1].url,path)
      expect(assigned.items[0].path).toBeUndefined();expect(assigned.items[1].path).toBe(path)
    }finally{await rm(root,{recursive:true,force:true})}
  })
})
