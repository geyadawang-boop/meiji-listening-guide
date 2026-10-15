import {z} from 'zod'
import {publicHttps,publicHttpResponse,boundedPublicText} from './public-http'
const versions=['2025-11-25','2025-06-18','2025-03-26']
const packet=z.object({jsonrpc:z.literal('2.0'),id:z.number().int().optional(),result:z.unknown().optional(),error:z.object({code:z.number(),message:z.string()}).optional(),method:z.string().optional()})
async function readSseReply(response:Response,id:number){
 if(!response.body)throw new Error('MCP 响应缺少结果')
 const reader=response.body.getReader(),decoder=new TextDecoder(),messages:unknown[]=[];let buffered='',bytes=0
 try{while(true){
  const chunk=await reader.read();if(chunk.done)break;bytes+=chunk.value.length;if(bytes>262144)throw new Error('MCP 响应超过大小上限')
  buffered=(buffered+decoder.decode(chunk.value,{stream:true})).replace(/\r\n/g,'\n')
  let end:number
  while((end=buffered.indexOf('\n\n'))>=0){const event=buffered.slice(0,end);buffered=buffered.slice(end+2);const data=event.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');if(!data)continue
   const value=JSON.parse(data),parsed=packet.parse(value);messages.push(value);if(messages.length>128)throw new Error('MCP 响应消息过多')
   if(parsed.method&&parsed.id!==undefined)throw new Error('MCP 服务请求客户端执行额外操作，本次未执行')
   if(parsed.id===id&&!parsed.method)return messages
  }
 }
 throw new Error('MCP 响应不完整或请求编号不一致')
 }finally{await reader.cancel().catch(()=>{})}
}
export function mcpEndpoint(input:string){const url=publicHttps(input);if(url.search||url.href.length>1500)throw new Error('MCP 地址不能包含查询参数或密钥');return url.href}
type Exchange=(url:string,init:RequestInit)=>ReturnType<typeof publicHttpResponse>
export class NativeMcpSession{
 private sequence=0
 private session:string|undefined
 private version:string|undefined
 private ready=false
 readonly endpoint:string
 constructor(endpoint:string,private exchange:Exchange=publicHttpResponse){this.endpoint=mcpEndpoint(endpoint)}
 async request(method:string,params:unknown,signal:AbortSignal){
  const id=++this.sequence,headers:Record<string,string>={'Content-Type':'application/json',Accept:'application/json, text/event-stream','Accept-Encoding':'identity'}
  if(this.session)headers['MCP-Session-Id']=this.session;if(this.version)headers['MCP-Protocol-Version']=this.version
  const body=JSON.stringify({jsonrpc:'2.0',id,method,params});if(Buffer.byteLength(body)>32768)throw new Error('MCP 请求参数超过大小上限')
  const {response,close}=await this.exchange(this.endpoint,{method:'POST',headers,body,signal})
  try{
   if(!response.ok)throw new Error(response.status===429?'MCP 服务已限流，不自动重试':response.status===401||response.status===403?'MCP 服务需要身份验证，公开连接不支持密钥':response.status===404&&this.session?'MCP 会话已过期，不自动重放调用':`MCP 服务返回 HTTP ${response.status}`)
   const session=response.headers.get('MCP-Session-Id');if(session&&!/^[\x21-\x7e]{1,512}$/.test(session))throw new Error('MCP 会话编号无效')
   if(this.session&&session&&session!==this.session)throw new Error('MCP 会话发生改变')
   if(method==='initialize')this.session=session||undefined
   const type=response.headers.get('content-type')?.split(';')[0].trim()
   let messages:unknown[]
   if(type==='application/json')messages=[JSON.parse(await boundedPublicText(response))]
   else if(type==='text/event-stream')messages=await readSseReply(response,id)
   else throw new Error('MCP 服务响应格式不支持')
   if(messages.length>128)throw new Error('MCP 响应消息过多')
   const replies=messages.map(message=>packet.parse(message));if(replies.some(reply=>reply.method&&reply.id!==undefined))throw new Error('MCP 服务请求客户端执行额外操作，本次未执行')
   const matching=replies.filter(reply=>reply.id===id&&!reply.method)
   if(matching.length!==1)throw new Error('MCP 响应不完整或请求编号不一致')
   const reply=matching[0];if(reply.error)throw new Error('MCP 服务拒绝请求，不自动重试');if(reply.result===undefined)throw new Error('MCP 响应缺少结果')
   return reply.result
  }finally{await response.body?.cancel().catch(()=>{});await close()}
 }
 async initialize(signal:AbortSignal){
  if(this.ready)return
  const value=z.object({protocolVersion:z.string(),capabilities:z.record(z.string(),z.unknown())}).parse(await this.request('initialize',{protocolVersion:versions[0],capabilities:{},clientInfo:{name:'Meijiang-Native',version:'1'}},signal))
  if(!versions.includes(value.protocolVersion))throw new Error('MCP 协议版本不受支持')
  this.version=value.protocolVersion
  const headers:Record<string,string>={'Content-Type':'application/json',Accept:'application/json, text/event-stream','MCP-Protocol-Version':this.version};if(this.session)headers['MCP-Session-Id']=this.session
  const {response,close}=await this.exchange(this.endpoint,{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'}),signal})
  try{if(response.status!==202&&!response.ok)throw new Error('MCP 初始化确认失败');await response.body?.cancel()}finally{await close()}
  this.ready=true
 }
 async tools(signal:AbortSignal){await this.initialize(signal);const list:unknown[]=[];let cursor:string|undefined
  for(let page=0;page<5;page++){const value=z.object({tools:z.array(z.unknown()),nextCursor:z.string().max(2000).optional()}).parse(await this.request('tools/list',cursor?{cursor}:{},signal));list.push(...value.tools);if(list.length>64)throw new Error('MCP 工具目录超过64项');if(!value.nextCursor)return list;if(value.nextCursor===cursor)throw new Error('MCP 工具分页没有进展');cursor=value.nextCursor}
  throw new Error('MCP 工具目录分页超过本次范围，未把部分目录当作完整目录')
 }
 async close(){if(!this.session)return;try{const {response,close}=await this.exchange(this.endpoint,{method:'DELETE',headers:{'MCP-Session-Id':this.session,'MCP-Protocol-Version':this.version||versions[0]},signal:AbortSignal.timeout(3000)});try{await response.body?.cancel()}finally{await close()}}catch{/* Session cleanup is best effort and never retries a tools/call. */}this.session=undefined;this.ready=false}
}
