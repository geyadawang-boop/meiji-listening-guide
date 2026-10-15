import {test,expect,vi} from 'vitest'
import {modelRouter} from '../src/main/model-router'
import type {CodexClient} from '../src/main/codex'
test('routes each request explicitly, preserving image options, validation and receiver',async()=>{
 const make=(name:string)=>({name,chat:vi.fn(function(this:{name:string},..._args:unknown[]){return Promise.resolve(this.name)}),json:vi.fn(function<T>(this:{name:string},_prompt:string,input:unknown,validate:(v:unknown)=>T){return Promise.resolve(validate(input))})})
 const codex=make('codex'),deepseek=make('deepseek');let selected=codex
 const routed=modelRouter(()=>selected as Pick<CodexClient,'chat'|'json'>)
 const signal=new AbortController().signal,options={fast:true,images:[{label:'page',url:'data:image/jpeg;base64,test'}]},messages=[{role:'user' as const,content:'hello'}]
 expect(await routed.chat(messages,undefined,signal,undefined,undefined,options)).toBe('codex')
 expect(codex.chat).toHaveBeenCalledWith(messages,undefined,signal,undefined,undefined,options)
 selected=deepseek
 expect(await routed.chat(messages)).toBe('deepseek')
 expect(await routed.json('prompt',{n:1},v=>(v as {n:number}).n,signal)).toBe(1)
 expect(deepseek.json).toHaveBeenCalledTimes(1)
 expect(Object.keys(routed)).toEqual(['chat','json'])
})
