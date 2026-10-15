import {afterEach,describe,it,expect} from 'vitest'
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import {createServer,type Server} from 'node:http'
import {transferMedia} from '../src/main/media-transfer'

const directories:string[]=[],servers:Server[]=[]
afterEach(async()=>{for(const server of servers.splice(0))await new Promise<void>(resolve=>{server.closeAllConnections();server.close(()=>resolve())});for(const directory of directories.splice(0))await rm(directory,{recursive:true,force:true})})
async function task(){const directory=await mkdtemp(join(tmpdir(),'meijiang-transfer-'));directories.push(directory);return {directory,key:'video',identity:'BV1Q5HXzuEJX:22:2',url:'https://upos.bilivideo.com/file',signal:new AbortController().signal}}
const response=(text:string,status=200,headers:Record<string,string>={})=>new Response(text,{status,headers:{etag:'"fixture-v1"','content-length':String(Buffer.byteLength(text)),...headers}})
async function seed(input:Awaited<ReturnType<typeof task>>,body='abc'){
 await writeFile(join(input.directory,'video.partial'),body)
 await writeFile(join(input.directory,'video.resume.json'),JSON.stringify({version:1,identity:input.identity,size:body.length,hash:createHash('sha256').update(body).digest('hex'),etag:'"fixture-v1"',total:6}))
}
describe('native streaming transfer',()=>{
 it('streams a real HTTP response to disk and returns byte/hash evidence',async()=>{
  const server=createServer((_request,res)=>{res.writeHead(200,{'content-length':'6',etag:'"fixture-v1"'});res.write('abc');res.end('def')});servers.push(server)
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
  const address=server.address() as {port:number},input=await task(),result=await transferMedia({...input,url:`http://127.0.0.1:${address.port}/file`,fetcher:fetch})
  expect(await readFile(result.path,'utf8')).toBe('abcdef');expect(result.size).toBe(6);expect(result.hash).toBe(createHash('sha256').update('abcdef').digest('hex'))
 })
 it('resumes only a verified prefix with a matching strong ETag and range',async()=>{
  const input=await task();await seed(input)
  const result=await transferMedia({...input,fetcher:async(_url,init)=>{expect(new Headers(init?.headers).get('Range')).toBe('bytes=3-');expect(new Headers(init?.headers).get('If-Range')).toBe('"fixture-v1"');return response('def',206,{'content-range':'bytes 3-5/6'})}})
  expect(await readFile(result.path,'utf8')).toBe('abcdef')
 })
 it('restarts instead of appending when a server ignores range or local bytes changed',async()=>{
  const input=await task();await seed(input)
  expect(await readFile((await transferMedia({...input,fetcher:async()=>response('NEWNEW',200,{etag:'"fixture-v2"'})})).path,'utf8')).toBe('NEWNEW')
  await seed(input);await writeFile(join(input.directory,'video.partial'),'bad')
  await transferMedia({...input,fetcher:async(_url,init)=>{expect(new Headers(init?.headers).has('Range')).toBe(false);return response('abcdef')}})
  expect(await readFile(join(input.directory,'video.partial'),'utf8')).toBe('abcdef')
 })
 it('refuses changed validators and malformed ranges without changing old recovery files',async()=>{
  const input=await task();await seed(input);const before=await readFile(join(input.directory,'video.resume.json'),'utf8')
  const invalid:Record<string,string>[]=[{etag:'"new"','content-range':'bytes 3-5/6'},{'content-range':'bytes 0-2/6'},{'content-range':'bytes 3-5/9'}]
  for(const headers of invalid)await expect(transferMedia({...input,fetcher:async()=>response('def',206,headers)})).rejects.toThrow('断点响应')
  expect(await readFile(join(input.directory,'video.partial'),'utf8')).toBe('abc');expect(await readFile(join(input.directory,'video.resume.json'),'utf8')).toBe(before)
 })
 it('preserves cancelled partial bytes and resumes them on retry',async()=>{
  const input=await task(),controller=new AbortController()
  await expect(transferMedia({...input,signal:controller.signal,fetcher:async()=>response('abc',200,{'content-length':'6'}),progress:()=>controller.abort()})).rejects.toThrow()
  expect(await readFile(join(input.directory,'video.partial'),'utf8')).toBe('abc')
  const saved=JSON.parse(await readFile(join(input.directory,'video.resume.json'),'utf8'));expect(saved.size).toBe(3)
  const result=await transferMedia({...input,fetcher:async()=>response('def',206,{'content-range':'bytes 3-5/6'})})
  expect(await readFile(result.path,'utf8')).toBe('abcdef')
 })
 it('rejects incomplete, oversized, unsolicited partial and empty bodies',async()=>{
  const input=await task()
  await expect(transferMedia({...input,fetcher:async()=>response('abc',200,{'content-length':'6'})})).rejects.toThrow('不完整')
  await expect(transferMedia({...input,maxBytes:2,fetcher:async()=>response('abcdef')})).rejects.toThrow('上限')
  const fresh=await task();await expect(transferMedia({...fresh,fetcher:async()=>response('abc',206,{'content-range':'bytes 0-2/6'})})).rejects.toThrow('断点请求')
  await expect(transferMedia({...fresh,fetcher:async()=>response('')})).rejects.toThrow('不完整')
 })
 it('reuses a complete verified partial only after the server confirms its strong validator and size',async()=>{
  const input=await task();await seed(input,'abcdef')
  const result=await transferMedia({...input,fetcher:async()=>new Response(null,{status:416,headers:{etag:'"fixture-v1"','content-range':'bytes */6'}})})
  expect(await readFile(result.path,'utf8')).toBe('abcdef')
  await expect(transferMedia({...input,fetcher:async()=>new Response(null,{status:416,headers:{etag:'"changed"','content-range':'bytes */6'}})})).rejects.toThrow('HTTP 416')
 })
 it('does not overwrite an active transfer or allow path traversal',async()=>{
  const input=await task();await writeFile(join(input.directory,'video.lock'),'active')
  await expect(transferMedia({...input,fetcher:async()=>response('abcdef')})).rejects.toThrow()
  expect(await readFile(join(input.directory,'video.lock'),'utf8')).toBe('active')
  await expect(transferMedia({...input,key:'../outside',fetcher:async()=>response('abcdef')})).rejects.toThrow('标识')
 })
})

