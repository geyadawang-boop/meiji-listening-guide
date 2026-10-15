import {describe,it,expect} from 'vitest'
import {mkdtemp,writeFile,readFile,readdir,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import {SubtitleDerived} from '../src/main/subtitle-derived'
const srt='1\n00:00:00,000 --> 00:00:02,000\n牙体组织结构\n'
const points=[{cue:0,quote:'牙体组织',point:'组织结构',topic:'牙体',timestamp:'00:00:00'}]
const result={markdown:'# 课堂笔记\n组织结构',points}
async function setup(){const root=await mkdtemp(join(process.cwd(),'test-results-derived-')),path=join(root,'source.srt');await writeFile(path,srt);return {root,service:new SubtitleDerived(join(root,'records'),root),source:{url:'https://www.bilibili.com/video/BV1Q5HXzuEJX/?p=2',title:'第二节',path,hash:createHash('sha256').update(srt).digest('hex'),generation:'v1'}}}
describe('version-bound derived note tasks',()=>{
  it('exports selected modes, verifies resumed receipts and never calls the model again for completed outputs',async()=>{
    const f=await setup();let calls=0
    try{
      const task=await f.service.create([f.source],['detailed','mindmap'])
      const dependencies={progress:()=>{},generation:async()=>'v1',summarize:async()=>{calls++;return result}}
      const completed=await f.service.run(task.id,dependencies,new AbortController().signal)
      expect(completed.items.map(item=>item.outputs?.length)).toEqual([2,3])
      expect(await readFile(completed.items[0].outputs![0].path,'utf8')).toContain('来源版本：v1')
      expect(await readFile(completed.items[1].outputs![2].path,'utf8')).toContain('<svg')
      expect(completed.items.every(item=>!item.prepared)).toBe(true)
      await f.service.run(task.id,dependencies,new AbortController().signal);expect(calls).toBe(2)
      const note=completed.items[0].outputs![0].path;await writeFile(note,'用户修改后的笔记')
      const checked=await f.service.run(task.id,dependencies,new AbortController().signal)
      expect(checked.items[0].error).toContain('被修改');expect(await readFile(note,'utf8')).toBe('用户修改后的笔记');expect(calls).toBe(2)
    }finally{await rm(f.root,{recursive:true,force:true})}
  })
  it('rejects stale sources before inference and sources changed during inference without creating finals',async()=>{
    const f=await setup();let generation='v2',calls=0
    try{
      const task=await f.service.create([f.source],['brief'])
      const dependencies={progress:()=>{},generation:async()=>generation,summarize:async()=>{calls++;generation='v2';return result}}
      expect((await f.service.run(task.id,dependencies,new AbortController().signal)).items[0].error).toContain('已有改变');expect(calls).toBe(0)
      generation='v1';expect((await f.service.run(task.id,dependencies,new AbortController().signal)).items[0].error).toContain('已有改变');expect(calls).toBe(1)
      expect(await readdir(f.root)).not.toContain('笔记')
    }finally{await rm(f.root,{recursive:true,force:true})}
  })
  it('keeps failed modes retryable while not repeating successful inference',async()=>{
    const f=await setup();let fail=true,calls=0
    try{
      const task=await f.service.create([f.source],['detailed','mindmap'])
      const dependencies={progress:()=>{},generation:async()=>'v1',summarize:async(_srt:string,mode:string)=>{calls++;if(fail&&mode==='mindmap')throw new Error('额度不足');return result}}
      expect((await f.service.run(task.id,dependencies,new AbortController().signal)).items.map(item=>item.status)).toEqual(['已完成','失败'])
      fail=false;expect((await f.service.run(task.id,dependencies,new AbortController().signal)).items.every(item=>item.status==='已完成')).toBe(true);expect(calls).toBe(3)
    }finally{await rm(f.root,{recursive:true,force:true})}
  })
})
