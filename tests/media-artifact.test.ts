import {describe,it,expect,afterEach} from 'vitest'
import {mkdtemp,readFile,writeFile,rename,rm,access} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {OwnedMediaArtifact} from '../src/main/media-artifact'
const roots:string[]=[],plan='a'.repeat(64)
afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true})})
async function setup(){const root=await mkdtemp(join(tmpdir(),'meijiang-artifact-'));roots.push(root);return {root,path:join(root,'result.mkv'),artifact:new OwnedMediaArtifact(root,'result.mkv',plan)}}
describe('owned intermediate media publication',()=>{
 it('reuses a completed verified attempt while refusing a changed output',async()=>{
  const {root,path,artifact}=await setup();expect((await artifact.prepare()).reused).toBe(false);await writeFile(path,'verified test bytes');await artifact.finish()
  expect((await new OwnedMediaArtifact(root,'result.mkv',plan).prepare()).reused).toBe(true)
  await writeFile(path,'user modified');await expect(new OwnedMediaArtifact(root,'result.mkv',plan).prepare()).rejects.toThrow('被修改');expect(await readFile(path,'utf8')).toBe('user modified')
 })
 it('retains incomplete output and its ownership proof until a verified successor exists',async()=>{
  const {root,path,artifact}=await setup();await artifact.prepare();await writeFile(path,'incomplete prior output')
  const next=new OwnedMediaArtifact(root,'result.mkv',plan);await next.prepare();await expect(access(path)).rejects.toThrow()
  const archived=next.intermediates().find(name=>name.startsWith('.incomplete-'))!;expect(await readFile(join(root,archived),'utf8')).toBe('incomplete prior output')
  await writeFile(path,'complete new output');await next.finish();expect(await readFile(join(root,archived),'utf8')).toBe('incomplete prior output')
 })
 it('recovers a crash between archiving and saving the updated ownership record',async()=>{
  const {root,path,artifact}=await setup();await artifact.prepare();await writeFile(path,'prior bytes')
  const owner=JSON.parse(await readFile(path+'.reservation.json','utf8')),archived=`.incomplete-${owner.owner}-result.mkv`;await rename(path,join(root,archived))
  const recovered=new OwnedMediaArtifact(root,'result.mkv',plan);await recovered.prepare();expect(recovered.intermediates()).toContain(archived)
 })
 it('never overwrites an unreserved file or accepts a different recipe',async()=>{
  const f=await setup();await writeFile(f.path,'unowned');await expect(f.artifact.prepare()).rejects.toThrow('已经存在');expect(await readFile(f.path,'utf8')).toBe('unowned')
  const second=await setup();await second.artifact.prepare();await expect(new OwnedMediaArtifact(second.root,'result.mkv','b'.repeat(64)).prepare()).rejects.toThrow('设置不同')
 })
})
