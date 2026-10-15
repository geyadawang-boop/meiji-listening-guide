import {afterEach,describe,it,expect} from 'vitest'
import {createServer,type Server} from 'node:http'
import {createServer as createTcpServer} from 'node:net'
import {createMediaTransport,mediaDelay} from '../src/main/media-transport'
import {mediaOptions} from '../src/main/media-options'
const servers:Server[]=[],transports:ReturnType<typeof createMediaTransport>[]=[]
const extraCleanup:(()=>Promise<void>)[]=[]
afterEach(async()=>{for(const transport of transports.splice(0))await transport.close();for(const server of servers.splice(0))await new Promise<void>(resolve=>{server.closeAllConnections();server.close(()=>resolve())});for(const cleanup of extraCleanup.splice(0))await cleanup()})
async function listen(server:Server){servers.push(server);await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));return (server.address() as {port:number}).port}
describe('native download networking',()=>{
 it('fetches through the configured HTTP proxy without contacting the target directly',async()=>{
  const requests:string[]=[],port=await listen(createServer((req,res)=>{requests.push(req.url||'');res.end('proxied media bytes')})),transport=createMediaTransport(fetch,mediaOptions({proxy:`http://127.0.0.1:${port}`}));transports.push(transport)
  const response=await transport.fetcher('http://media.invalid/video',{redirect:'error'});expect(await response.text()).toBe('proxied media bytes');expect(requests).toEqual(['http://media.invalid/video'])
 })
 it('uses the IPv4 connector with the actual Node fetch implementation',async()=>{
  const port=await listen(createServer((_req,res)=>res.end('ipv4'))),transport=createMediaTransport(fetch,mediaOptions({force_ipv4:true}));transports.push(transport)
  expect(await (await transport.fetcher(`http://localhost:${port}/`)).text()).toBe('ipv4')
 })
 it('tunnels through SOCKS5 with proxy-side DNS and an IPv4 proxy connection',async()=>{
  let target='';const http=createServer((_req,res)=>res.end('socks media'))
  const proxy=createTcpServer(socket=>{let stage=0,pending=Buffer.alloc(0);const onData=(bytes:Buffer)=>{pending=Buffer.concat([pending,bytes]);if(stage===0){if(pending.length<2+pending[1])return;pending=pending.subarray(2+pending[1]);stage=1;socket.write(Buffer.from([5,0]))}else{if(pending.length<5||pending[3]!==3)return;const length=pending[4];if(pending.length<7+length)return;target=pending.subarray(5,5+length).toString();socket.off('data',onData);socket.write(Buffer.from([5,0,0,1,127,0,0,1,0,0]));http.emit('connection',socket)}};socket.on('data',onData)})
  await new Promise<void>(resolve=>proxy.listen(0,'127.0.0.1',resolve));extraCleanup.push(()=>new Promise<void>(resolve=>proxy.close(()=>resolve())))
  const port=(proxy.address() as {port:number}).port,transport=createMediaTransport(fetch,mediaOptions({proxy:`socks5h://localhost:${port}`,force_ipv4:true}));transports.push(transport)
  expect(await (await transport.fetcher('http://media.invalid/video')).text()).toBe('socks media');expect(target).toBe('media.invalid')
 })
 it('limits aggregate delivered bytes and permits cancellation while waiting',async()=>{
  const transport=createMediaTransport(async()=>new Response('x'.repeat(1024)),mediaOptions({rate_kbps:4}));transports.push(transport)
  const started=performance.now();expect((await (await transport.fetcher('https://media.invalid/')).text()).length).toBe(1024);expect(performance.now()-started).toBeGreaterThanOrEqual(200)
  const controller=new AbortController(),pending=(await transport.fetcher('https://media.invalid/',{signal:controller.signal})).text();controller.abort();await expect(pending).rejects.toThrow()
 })
 it('does not allocate or alter a dispatcher when no networking overrides are selected',async()=>{
  let supplied:RequestInit|undefined;const transport=createMediaTransport(async(_url,init)=>{supplied=init;return new Response('same')},mediaOptions());transports.push(transport)
  await transport.fetcher('https://media.invalid/',{headers:{Range:'bytes=0-'}});expect(supplied).toEqual({headers:{Range:'bytes=0-'}})
 })
 it('cancels configurable request spacing without a blocking sleep',async()=>{
  const controller=new AbortController(),pending=mediaDelay(60000,controller.signal);controller.abort();await expect(pending).rejects.toThrow('取消')
 })
})
