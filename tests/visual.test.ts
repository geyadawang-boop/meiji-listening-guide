import {describe,it,expect} from 'vitest'
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createHash} from 'node:crypto'
import {VisualTasks} from '../src/main/visual'
import type {MediaBackend} from '../src/main/media'
const hash=(value:string)=>createHash('sha256').update(value).digest('hex')
describe('visual result authority and resumable cleanup',()=>{
 it('persists extraction failures and resumes the same task before model dispatch',async()=>{
  const root=await mkdtemp(join(tmpdir(),'meijiang-visual-'));try{
   const source=join(root,'source.png');await writeFile(source,'source');let failed=true;const ids:string[]=[]
   const media={request:async(_action:string,args:{id:string})=>{ids.push(args.id);if(failed)throw Error('extraction interrupted');return {duration:0,gaps:[],frames:[{path:source,time:0,hash:hash('source')}]}}} as unknown as MediaBackend
   const tasks=new VisualTasks(join(root,'result'),media);await expect(tasks.create(source,1,'balanced','one')).rejects.toThrow('interrupted');const pending=(await tasks.list())[0];expect(pending.preparation?.status).toBe('等待继续');expect(pending.frames).toHaveLength(0)
   failed=false;await tasks.prepare(pending.id,'one');expect(ids).toEqual([pending.id,pending.id]);expect((await tasks.list())[0].frames).toHaveLength(1)
  }finally{await rm(root,{recursive:true,force:true})}
 })
 it('resumes failed frames, preserves user source and rejects modified final results',async()=>{
  const root=await mkdtemp(join(tmpdir(),'meijiang-visual-'));try{
   const source=join(root,'video.mp4'),frame=join(root,'frame.png');await writeFile(source,'source');await writeFile(frame,'frame')
   let cleanup=0,calls=0
   const media={request:async(action:string)=>{if(action==='visual-frames')return {id:'a'.repeat(32),source,sourceHash:hash('source'),duration:5,gaps:[],frames:[{path:frame,time:2,hash:hash('frame')}]};cleanup++;return true}} as unknown as MediaBackend
   const tasks=new VisualTasks(join(root,'result'),media),task=await tasks.create(source,1,'balanced','connection'),signal=new AbortController().signal
   await tasks.run(task.id,'connection',async()=>{calls++;throw Error('model unavailable')},()=>{},signal);expect(cleanup).toBe(0)
   const final=await tasks.run(task.id,'connection',async()=>{calls++;return '可见文字'},()=>{},signal);expect(final.output).toBeTruthy();expect(cleanup).toBe(1);expect(calls).toBe(2);expect(await readFile(source,'utf8')).toBe('source')
   await tasks.run(task.id,'connection',async()=>{calls++;return 'unexpected'},()=>{},signal);expect(calls).toBe(2)
   await writeFile(final.output!,'user changed');await expect(tasks.run(task.id,'connection',async()=>'',()=>{},signal)).rejects.toThrow('已改变');expect(await readFile(final.output!,'utf8')).toBe('user changed')
  }finally{await rm(root,{recursive:true,force:true})}
 })
 it('rejects source or connection changes before dispatch',async()=>{
  const root=await mkdtemp(join(tmpdir(),'meijiang-visual-'));try{
   const source=join(root,'source.png');await writeFile(source,'source');let calls=0
   const media={request:async()=>({id:'b'.repeat(32),source,sourceHash:hash('source'),duration:0,gaps:[],frames:[{path:source,time:0,hash:hash('source')}]})} as unknown as MediaBackend
   const tasks=new VisualTasks(join(root,'result'),media),task=await tasks.create(source,1,'balanced','one'),run=()=>{calls++;return Promise.resolve('text')},signal=new AbortController().signal
   await expect(tasks.run(task.id,'two',run,()=>{},signal)).rejects.toThrow('连接');await writeFile(source,'changed');await expect(tasks.run(task.id,'one',run,()=>{},signal)).rejects.toThrow('源文件');expect(calls).toBe(0)
  }finally{await rm(root,{recursive:true,force:true})}
 })
})
