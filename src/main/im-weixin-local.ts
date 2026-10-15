import {fork,type ChildProcess} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {z} from 'zod'
import {NativeWindowsJob} from './windows-native'
/** Isolated native reader. Keys never cross IPC, touch a file or survive worker shutdown. */
export class NativeWeixinLocal{
 private worker:ChildProcess|undefined
 private job:NativeWindowsJob|undefined
 private pending=new Map<number,{resolve:(value:unknown)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>()
 private sequence=0
 private closed=false
 private fail=()=>{this.job?.close();this.job=undefined;this.worker?.kill();this.worker=undefined;for(const item of this.pending.values()){clearTimeout(item.timer);item.reject(new Error('本机微信读取进程已中断，请重新核验绑定'))}this.pending.clear()}
 private start(){
  if(this.closed)throw new Error('本机微信读取后台已关闭');if(this.worker)return this.worker
  const job=new NativeWindowsJob(),worker=fork(fileURLToPath(new URL('./im-weixin-local-worker.js',import.meta.url)),[],{execPath:process.execPath,execArgv:[],env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},silent:true,windowsHide:true});this.job=job;this.worker=worker
  worker.stdout?.on('data',()=>{});worker.stderr?.on('data',()=>{});worker.on('error',()=>{if(this.worker===worker)this.fail()});worker.on('exit',()=>{if(this.worker===worker)this.fail()})
  try{if(!worker.pid)throw new Error('本机读取后台未启动');job.adopt(worker.pid)}catch(error){this.fail();throw error}
  worker.on('message',(raw:unknown)=>{try{const value=z.object({id:z.number().int().positive(),ok:z.boolean(),result:z.unknown().optional(),error:z.string().max(1000).optional()}).parse(raw),item=this.pending.get(value.id);if(!item)return;this.pending.delete(value.id);clearTimeout(item.timer);value.ok?item.resolve(value.result):item.reject(new Error(value.error||'本机读取失败'))}catch{this.fail()}})
  return worker
 }
 async request<T=unknown>(action:string,input:unknown={},signal?:AbortSignal):Promise<T>{
  signal?.throwIfAborted();const worker=this.start(),id=++this.sequence
  return new Promise<T>((resolve,reject)=>{const aborted=()=>this.fail(),finish=()=>signal?.removeEventListener('abort',aborted),timer=setTimeout(this.fail,action==='probe'?40000:20000);this.pending.set(id,{resolve:value=>{finish();resolve(value as T)},reject:error=>{finish();reject(error)},timer});signal?.addEventListener('abort',aborted,{once:true});if(signal?.aborted){this.fail();return}worker.send({id,action,input},error=>{if(error)this.fail()})})
 }
 async invalidate(connection_id:string){if(this.worker)await this.request('invalidate',{connection_id})}
 async dispose(){this.closed=true;this.fail()}
}
