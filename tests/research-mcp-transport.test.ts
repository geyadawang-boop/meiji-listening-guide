import {describe,it,expect} from 'vitest'
import {NativeMcpSession,mcpEndpoint} from '../src/main/research-mcp-transport'
import {publicAddress,publicHttps,publicHttpResponse} from '../src/main/public-http'
type Exchange=NonNullable<ConstructorParameters<typeof NativeMcpSession>[1]>
const signal=()=>new AbortController().signal
function fixture(mode:'json'|'sse'|'wrong-id'|'server-request'|'rate-limit'='json'){
 const calls:{method:string;headers:Headers;body:Record<string,unknown>}[]=[]
 const exchange:Exchange=async(_url,init)=>{
  if(init.method==='DELETE')return {response:new Response(null,{status:204}),close:async()=>{}}
  const body=JSON.parse(String(init.body)),headers=new Headers(init.headers);calls.push({method:body.method,headers,body})
  if(body.method==='notifications/initialized')return {response:new Response(null,{status:202}),close:async()=>{}}
  if(mode==='rate-limit')return {response:new Response('rate limited',{status:429}),close:async()=>{}}
  const result=body.method==='initialize'?{protocolVersion:'2025-11-25',capabilities:{tools:{}}}:{tools:[{name:'lookup',inputSchema:{type:'object'},annotations:{readOnlyHint:true}}]}
  const packet=JSON.stringify({jsonrpc:'2.0',id:mode==='wrong-id'?999:body.id,...mode==='server-request'?{method:'sampling/createMessage',params:{}}:{result}})
  return {response:new Response(mode==='sse'?`event: message\ndata: ${packet}\n\n`:packet,{headers:{'content-type':mode==='sse'?'text/event-stream':'application/json','MCP-Session-Id':'fixture-session'}}),close:async()=>{}}
 }
 return {exchange,calls}
}
describe('native public MCP transport',()=>{
 it('negotiates protocol, confirms initialization and keeps session headers',async()=>{
  const f=fixture(),session=new NativeMcpSession('https://public.example/mcp',f.exchange)
  expect(await session.tools(signal())).toHaveLength(1);expect(f.calls.map(c=>c.method)).toEqual(['initialize','notifications/initialized','tools/list']);expect(f.calls[2].headers.get('MCP-Session-Id')).toBe('fixture-session');await session.close()
 })
 it('accepts JSON and SSE envelopes but refuses mismatched responses and server-side execution requests',async()=>{
  expect(await new NativeMcpSession('https://public.example/mcp',fixture('sse').exchange).tools(signal())).toHaveLength(1)
  await expect(new NativeMcpSession('https://public.example/mcp',fixture('wrong-id').exchange).tools(signal())).rejects.toThrow('编号不一致')
  await expect(new NativeMcpSession('https://public.example/mcp',fixture('server-request').exchange).tools(signal())).rejects.toThrow('额外操作')
 })
 it('does not automatically retry rate-limited requests',async()=>{const f=fixture('rate-limit');await expect(new NativeMcpSession('https://public.example/mcp',f.exchange).tools(signal())).rejects.toThrow('限流');expect(f.calls).toHaveLength(1)})
 it('finishes at a complete SSE result without waiting for a persistent stream to close',async()=>{
  let cancelled=false
  const exchange:Exchange=async(_url,init)=>{const body=JSON.parse(String(init.body));return {response:new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode(`event: message\ndata: ${JSON.stringify({jsonrpc:'2.0',id:body.id,result:{tools:[]}})}\n\n`))},cancel(){cancelled=true}}),{headers:{'content-type':'text/event-stream'}}),close:async()=>{}}}
  expect(await new NativeMcpSession('https://public.example/mcp',exchange).request('tools/list',{},signal())).toEqual({tools:[]});expect(cancelled).toBe(true)
 })
 it('refuses credentials, query secrets and local-network endpoints',()=>{
  for(const address of ['http://public.example/mcp','https://user:password@public.example/mcp','https://public.example/mcp?key=secret','https://127.0.0.1/mcp','https://[::1]/mcp','https://localhost/mcp'])expect(()=>mcpEndpoint(address)).toThrow()
  expect(()=>publicHttps('https://public.example/mcp#fragment')).toThrow()
 })
 it('rejects mixed public/private DNS resolution before issuing any request',async()=>{
  let sent=false
  await expect(publicHttpResponse('https://public.example/mcp',{},async()=>{sent=true;return new Response('no')},async()=>[{address:'93.184.216.34',family:4},{address:'127.0.0.1',family:4}])).rejects.toThrow('保留网络')
  expect(sent).toBe(false)
  for(const address of ['0.0.0.0','100.64.0.1','169.254.0.1','192.168.1.1','::ffff:127.0.0.1','2001:0db8::1','2002:7f00:1::1','3fff::1'])expect(publicAddress(address)).toBe(false)
  expect(publicAddress('1.1.1.1')).toBe(true);expect(publicAddress('2606:4700:4700::1111')).toBe(true)
 })
})
