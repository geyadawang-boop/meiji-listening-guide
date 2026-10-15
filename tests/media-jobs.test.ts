import {afterEach,describe,it,expect} from 'vitest'
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {NativeDownloadJobs} from '../src/main/media-jobs'
const roots:string[]=[]
afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true})})
async function setup(){const root=await mkdtemp(join(tmpdir(),'meijiang-jobs-'));roots.push(root);return {root,store:new NativeDownloadJobs(root)}}
const input={identity:'BV1Q5HXzuEJX:22:2',url:'https://www.bilibili.com/video/BV1Q5HXzuEJX/?p=2',title:'第二节',options:{height:720}}
describe('native download journal',()=>{
 it('freezes recipes and does not touch old queue records',async()=>{
  const {root,store}=await setup();await writeFile(join(root,'media.sqlite'),'old queue baseline')
  const row=await store.create(input);row.recipe.height=1080
  expect((await store.read(row.id)).recipe.height).toBe(720)
  expect((await store.list())[0].source_url).toBe(input.url)
  expect(await readFile(join(root,'media.sqlite'),'utf8')).toBe('old queue baseline')
 })
 it('uses revision guards so cancellation prevents late completion',async()=>{
  const {store}=await setup(),queued=await store.create(input),running=await store.transition(queued.id,queued.revision,'running')
  const path=join(await store.taskDirectory(queued.id),'result.mp4');await writeFile(path,'verified fake media bytes')
  const proof=await store.evidence(queued.id,'result.mp4')
  const cancelled=await store.transition(queued.id,running.revision,'cancelled')
  await expect(store.complete(queued.id,running.revision,[proof])).rejects.toThrow('拒绝发布')
  await expect(store.transition(queued.id,running.revision,'running')).rejects.toThrow('已改变')
  expect((await store.transition(queued.id,cancelled.revision,'queued')).state).toBe('queued')
 })
 it('only publishes matching byte/hash evidence and rechecks every output on open',async()=>{
  const {store}=await setup(),queued=await store.create(input),running=await store.transition(queued.id,queued.revision,'running'),directory=await store.taskDirectory(queued.id)
  await writeFile(join(directory,'result.mp4'),'video');await writeFile(join(directory,'result.srt'),'subtitle')
  const proof=await store.evidence(queued.id,'result.mp4'),subtitle=await store.evidence(queued.id,'result.srt')
  await expect(store.complete(queued.id,running.revision,[{...proof,bytes:100}])).rejects.toThrow('校验失败')
  await store.complete(queued.id,running.revision,[proof,subtitle]);expect(await store.file(queued.id)).toBe(join(directory,'result.mp4'))
  await writeFile(join(directory,'result.srt'),'changed');await expect(store.file(queued.id)).rejects.toThrow('改变')
 })
 it('recovers queued/running work as interrupted without silently restarting it',async()=>{
  const {root,store}=await setup(),first=await store.create(input),second=await store.create(input)
  await store.transition(first.id,first.revision,'running')
  const recovered=new NativeDownloadJobs(root),rows=await recovered.list()
  expect(rows).toHaveLength(2);expect(rows.every(row=>row.state==='interrupted')).toBe(true)
  expect((await recovered.read(second.id)).revision).toBe(1)
  expect((await store.read(first.id)).state).toBe('running')
 })
 it('rejects path escape and tampered recipe recovery while retaining evidence',async()=>{
  const {root,store}=await setup(),row=await store.create(input)
  await expect(store.evidence(row.id,'../outside.pdf')).rejects.toThrow('路径')
  await expect(store.evidence(row.id,'job.json')).rejects.toThrow('路径')
  const path=join(await store.taskDirectory(row.id),'job.json'),saved=JSON.parse(await readFile(path,'utf8'));saved.recipe.height=1080;await writeFile(path,JSON.stringify(saved))
  await expect(new NativeDownloadJobs(root).initialize()).rejects.toThrow('不一致')
  expect((JSON.parse(await readFile(path,'utf8'))).recipe.height).toBe(1080)
 })
 it('serializes overlapping state updates rather than losing cancellation',async()=>{
  const {store}=await setup(),row=await store.create(input)
  const results=await Promise.allSettled([store.transition(row.id,0,'cancelled'),store.transition(row.id,0,'running')])
  expect(results.map(r=>r.status)).toEqual(['fulfilled','rejected']);expect((await store.read(row.id)).state).toBe('cancelled')
 })
 it('finishes an interrupted cleanup only after rechecking the final output on restart',async()=>{
  const {root,store}=await setup(),row=await store.create(input),running=await store.transition(row.id,0,'running'),directory=await store.taskDirectory(row.id)
  await writeFile(join(directory,'result.mp4'),'final bytes');await writeFile(join(directory,'track-0.partial'),'intermediate')
  await store.complete(row.id,running.revision,[await store.evidence(row.id,'result.mp4')],['track-0.partial'])
  const recovered=new NativeDownloadJobs(root);expect((await recovered.list())[0].cleanup).toEqual([])
  await expect(readFile(join(directory,'track-0.partial'))).rejects.toThrow();expect(await readFile(await recovered.file(row.id),'utf8')).toBe('final bytes')
 })
 it('keeps intermediates and exposes a warning if the final output changed before recovery cleanup',async()=>{
  const {root,store}=await setup(),row=await store.create(input),running=await store.transition(row.id,0,'running'),directory=await store.taskDirectory(row.id)
  await writeFile(join(directory,'result.mp4'),'final bytes');await writeFile(join(directory,'track-0.partial'),'intermediate')
  await store.complete(row.id,running.revision,[await store.evidence(row.id,'result.mp4')],['track-0.partial']);await writeFile(join(directory,'result.mp4'),'user edited')
  const recovered=new NativeDownloadJobs(root),rows=await recovered.list();expect(rows[0].warning).toContain('原中间文件保留');expect(await readFile(join(directory,'track-0.partial'),'utf8')).toBe('intermediate')
 })
 it('cannot register the final output or job record for cleanup, including Windows case aliases',async()=>{
  const {store}=await setup(),row=await store.create(input),running=await store.transition(row.id,0,'running'),directory=await store.taskDirectory(row.id)
  await writeFile(join(directory,'result.mp4'),'final bytes');const proof=await store.evidence(row.id,'result.mp4')
  for(const name of ['RESULT.MP4','JOB.JSON','../outside','C:outside'])await expect(store.complete(row.id,running.revision,[proof],[name])).rejects.toThrow('非中间文件')
 })
})
