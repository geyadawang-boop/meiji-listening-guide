import type {CodexClient} from './codex'
import type {FileInput} from './api'

// Choose a connection at each request; preserve its arguments and receiver.
export function modelRouter(select:()=>Pick<CodexClient,'chat'|'json'>){
 return {
  chat(...args:Parameters<CodexClient['chat']>){return select().chat(...args)},
  json<T>(prompt:string,input:unknown,validate:(value:unknown)=>T,signal?:AbortSignal,file?:FileInput){
   return select().json(prompt,input,validate,signal,file)
  }
 }
}
