import {describe,it,expect,afterEach} from 'vitest'
import {createServer,type Server} from 'node:http'
import {mkdtemp,readFile,rm,access} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createHash} from 'node:crypto'
import {transferMediaRanges} from '../src/main/media-parallel-transfer'
const roots:string[]=[],servers:Server[]=[]
afterEach(async()=>{for(const server of servers.splice(0))await new Promise<void>(resolve=>{server.closeAllConnections();server.close(()=>resolve())});for(const root of roots.splice(0))await rm(root,{recursive:true,force:true})})
async function fixture(mode:'ranges'|'ignore'|'changed'='ranges'){
 const directory=await mkdtemp(join(tmpdir(),'meijiang-parallel-'));roots.push(directory)
 const body=Buffer.alloc(512*1024);for(let i=0;i<body.length;i++)body[i]=i%251
 let active=0,maxActive=0,ranges=0,full=0;const requested:number[]=[]
 const server=createServer((req,res)=>{
  if(req.method==='HEAD'){res.writeHead(200,{'content-length':String(body.length),'accept-ranges':'bytes',etag:'"original"'});res.end();return}
  const range=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range||'')
  if(range&&mode!=='ignore'){
   ranges++;active++;maxActive=Math.max(maxActive,active);const start=Number(range[1]),end=range[2]?Number(range[2]):body.length-1
   requested.push(end-start+1)
   res.writeHead(206,{'content-length':String(end-start+1),'content-range':`bytes ${start}-${end}/${body.length}`,etag:mode==='changed'?'"new-version"':'"original"'})
   setTimeout(()=>{res.end(body.subarray(start,end+1));active--},20)
  }else{full++;res.writeHead(200,{'content-length':String(body.length),etag:'"original"'});res.end(body)}
 });servers.push(server);await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
 const port=(server.address() as {port:number}).port
 return {input:{directory,key:'track-0',identity:'BV1Q5HXzuEJX:22:2:stream',url:`http://127.0.0.1:${port}/video`,signal:new AbortController().signal,fetcher:fetch},body,stats:()=>({maxActive,ranges,full,requested})}
}
describe('native concurrent byte ranges',()=>{
 it('downloads concurrent ranges, merges exact bytes and reuses complete verified chunks',async()=>{
  const f=await fixture(),result=await transferMediaRanges(f.input,4)
  expect(await readFile(result.path)).toEqual(f.body);expect(result.hash).toBe(createHash('sha256').update(f.body).digest('hex'));expect(result.intermediates).toHaveLength(12)
  expect(f.stats().maxActive).toBeGreaterThan(1);expect(f.stats().ranges).toBe(4)
  const reused=await transferMediaRanges(f.input,4);expect(reused.hash).toBe(result.hash);expect(f.stats().ranges).toBe(4)
 })
 it('falls back with an explicit warning when advertised ranges are ignored',async()=>{
  const f=await fixture('ignore'),result=await transferMediaRanges(f.input,4)
  expect(result.warning).toContain('串行');expect(await readFile(result.path)).toEqual(f.body);expect(f.stats().full).toBeGreaterThan(1)
 })
 it('never publishes a merged object when a range validator changes',async()=>{
  const f=await fixture('changed');await expect(transferMediaRanges(f.input,4)).rejects.toThrow('媒体版本不一致')
  await expect(access(join(f.input.directory,'track-0.partial'))).rejects.toThrow()
 })
 it('rejects invalid concurrency and aborts all range work on cancellation',async()=>{
  const f=await fixture();await expect(transferMediaRanges(f.input,17)).rejects.toThrow('片段数')
  const controller=new AbortController();controller.abort();await expect(transferMediaRanges({...f.input,signal:controller.signal},4)).rejects.toThrow()
 })
 it.each([1,3])('uses the requested chunk size with a bounded %s-worker pool and restores exact pieces',async concurrency=>{
  const f=await fixture(),input={...f.input,chunkBytes:100000,writeBufferBytes:1024},result=await transferMediaRanges(input,concurrency)
  expect(await readFile(result.path)).toEqual(f.body);expect(f.stats().ranges).toBe(6);expect(f.stats().maxActive).toBeLessThanOrEqual(concurrency);expect(f.stats().requested.every(size=>size<=100000)).toBe(true);expect(result.intermediates).toHaveLength(18)
  const reused=await transferMediaRanges(input,concurrency);expect(reused.hash).toBe(result.hash);expect(f.stats().ranges).toBe(6)
 })
 it('refuses excessive chunk counts and invalid buffer sizes before downloading',async()=>{
  const f=await fixture();await expect(transferMediaRanges({...f.input,chunkBytes:1},3)).rejects.toThrow('4096');await expect(transferMediaRanges({...f.input,writeBufferBytes:1},3)).rejects.toThrow('缓冲区');expect(f.stats().ranges).toBe(0)
 })
})
