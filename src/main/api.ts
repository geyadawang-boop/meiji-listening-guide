import type { Profile } from '../shared/types'
import type { SettingsStore } from './settings'
export interface FileInput {filename:string;file_data:string;path?:string}
export interface ChatMessage { role:'system'|'user'|'assistant'; content:string|({type:'text';text:string}|{type:'file';file:FileInput}|{type:'image_url';image_url:{url:string}})[] }
async function requestError(response:Response,nativeFile:boolean,hasFile:boolean) {
  let hint=''
  if(response.status===400){
    // Classify internally; never return provider text, which may echo credentials or request data.
    try{
      const body=await response.json() as {error?:{code?:string;param?:string;message?:string}}
      const detail=[body.error?.code,body.error?.param,body.error?.message].filter(v=>typeof v==='string').join(' ')
      if(/reasoning(?:_effort|\.effort)?|推理强度/i.test(detail))hint='服务端拒绝了推理强度参数，请在模型参数中选择提供方默认'
      else if(/temperature|top_p/i.test(detail))hint='服务端拒绝了温度或 Top P 参数，请恢复提供方默认'
      else if(/max_(?:output_)?tokens/i.test(detail))hint='服务端拒绝了最大输出参数，请检查模型允许的输出上限'
      else if(/file|pptx?|attachment|mime|文件|附件/i.test(detail))hint='服务端拒绝了课件文件输入，请核对该模型与接口允许的文件格式及大小'
      else if(/model|模型/i.test(detail))hint='服务端拒绝了当前模型，请核对模型名与接口是否匹配'
    }catch{}
  }
  return new Error(`API 请求失败（HTTP ${response.status}），${hint||'请检查地址、接口格式、模型、密钥或配额'}${nativeFile?'；PPT 原文件上传需要服务商支持 Responses 文件输入':hasFile?'；此任务需要服务商与模型支持 PDF 文件输入':''}`)
}
export async function readSse(body:ReadableStream<Uint8Array>,onText:(text:string)=>void):Promise<string> {
  const reader=body.getReader(), decoder=new TextDecoder();let buffer='',all=''
  const event=(value:string)=> {
    const data=value.split('\n').filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n').trim()
    if(!data || data==='[DONE]')return
    const obj=JSON.parse(data)
    if(obj.error||obj.type==='response.failed'||obj.type==='response.incomplete')throw new Error('API 未完成流式输出，请检查服务配置或输出长度限制')
    const delta=obj.type==='response.output_text.delta'?obj.delta:obj.choices?.[0]?.delta?.content
    if(typeof delta==='string') {all+=delta;onText(delta)}
  }
  try {
    for(;;) {
      const {value,done}=await reader.read();buffer+=decoder.decode(value,{stream:!done}).replace(/\r/g,'')
      let index:number
      while((index=buffer.indexOf('\n\n'))>=0) {event(buffer.slice(0,index));buffer=buffer.slice(index+2)}
      if(done){if(buffer.trim())event(buffer);break}
    }
    if(!all.trim())throw new Error('API 未返回文本')
    return all
  } finally {reader.releaseLock()}
}
export class Api {
  constructor(private settings:SettingsStore,private request:(input:string,init?:RequestInit)=>Promise<Response>=fetch){}
  async chat(messages:ChatMessage[],onText?:(text:string)=>void,signal?:AbortSignal,draft?:Profile):Promise<string> {
    const p=draft?this.settings.draft(draft):this.settings.profile(),nativeFile=messages.some(m=>Array.isArray(m.content)&&m.content.some(part=>part.type==='file'&&!/\.pdf$/i.test(part.file.filename))),responses=nativeFile||p.apiFormat==='responses',endpoint=p.baseUrl.replace(/\/$/,'')+(responses?'/responses':'/chat/completions')
    const parameters=p.parameters?.[p.model]||{}
    const controller=AbortSignal.any([AbortSignal.timeout(180000),...(signal?[signal]:[])])
    const input=responses?{input:messages.map(m=>({role:m.role,content:typeof m.content==='string'?m.content:m.content.map(part=>part.type==='text'?{type:'input_text',text:part.text}:part.type==='image_url'?{type:'input_image',image_url:part.image_url.url}:{type:'input_file',filename:part.file.filename,file_data:part.file.file_data})})),store:false}:{messages}
    const response=await this.request(endpoint,{method:'POST',headers:{'Content-Type':'application/json',...(p.key?{Authorization:`Bearer ${p.key}`}:{})},body:JSON.stringify({model:p.model,...input,stream:!!onText,...(parameters.temperature!==undefined?{temperature:parameters.temperature}:{}),...(parameters.topP!==undefined?{top_p:parameters.topP}:{}),...(parameters.maxTokens!==undefined?{[responses?'max_output_tokens':'max_tokens']:parameters.maxTokens}:{}),...(parameters.reasoningEffort?(responses?{reasoning:{effort:parameters.reasoningEffort}}:{reasoning_effort:parameters.reasoningEffort}):{})}),signal:controller})
    if(!response.ok)throw await requestError(response,nativeFile,messages.some(m=>Array.isArray(m.content)&&m.content.some(p=>p.type==='file')))
    if(onText && response.body)return readSse(response.body,onText)
    const data=await response.json() as {status?:string;output?:{type:string;content?:{type:string;text?:string}[]}[];choices?:{message?:{content?:string}}[]}
    if(data.status==='incomplete'||data.status==='failed')throw new Error('API 未完成输出，请检查输出长度限制或服务状态')
    const value=responses?data.output?.filter(item=>item.type==='message').flatMap(item=>item.content||[]).filter(part=>part.type==='output_text').map(part=>part.text||'').join(''):data.choices?.[0]?.message?.content
    if(!value)throw new Error('API 未返回有效文本')
    return value
  }
  async models(profile:Profile):Promise<string[]> {
    const p=this.settings.draft(profile)
    const response=await this.request(p.baseUrl+'/models',{headers:{Authorization:`Bearer ${p.key}`},signal:AbortSignal.timeout(30000)})
    if(!response.ok)throw new Error(`读取模型失败（HTTP ${response.status}），请检查地址与密钥；也可手动填写完整模型名`)
    const data=await response.json() as {data?:{id?:string}[]}
    const models=[...new Set((Array.isArray(data.data)?data.data:[]).map(v=>v.id).filter((id):id is string=>typeof id==='string'&&!!id.trim()))]
    if(!models.length)throw new Error('服务未返回模型列表，请手动填写完整模型名')
    return models
  }
  async json<T>(prompt:string,input:unknown,validate:(data:unknown)=>T,signal?:AbortSignal,file?:FileInput):Promise<T> {
    let feedback=''
    for(let attempt=0;attempt<2;attempt++) {
      const text=JSON.stringify(input)+feedback
      const content:ChatMessage['content']=file?[{type:'file',file:{filename:file.filename,file_data:file.file_data}},{type:'text',text}]:text
      const raw=await this.chat([{role:'system',content:prompt},{role:'user',content}],undefined,signal)
      try {
        const clean=raw.replace(/^\s*```(?:json)?\s*/i,'').replace(/\s*```\s*$/,'').trim()
        return validate(JSON.parse(clean))
      }catch(error) {
        if(signal?.aborted)throw error
        if(attempt===1)throw error
        feedback='\n上次输出未通过格式校验。请严格返回指定结构的合法 JSON，不加说明。'
        await new Promise(r=>setTimeout(r,1500))
      }
    }
    throw new Error('结构化输出失败')
  }
}
