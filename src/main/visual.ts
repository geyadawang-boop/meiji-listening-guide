import {readFile,writeFile,mkdir,rename,readdir} from 'node:fs/promises'
import {join} from 'node:path'
import {createHash,randomUUID} from 'node:crypto'
import {createReadStream} from 'node:fs'
import {z} from 'zod'
import type {MediaBackend} from './media'
export type VisualFrame={path:string;time:number;hash:string;status:'等待识别'|'已完成'|'失败';text?:string;error?:string}
export type VisualTask={id:string;source:string;sourceHash:string;duration:number;frames:VisualFrame[];gaps:unknown[];connection:string;output?:string;outputHash?:string;cleaned?:boolean;preparation?:{cap:number;policy:string;status:string;error?:string}}
const digest=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex')
async function fileDigest(path:string){const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);return hash.digest('hex')}
export class VisualTasks{
 constructor(private root:string,private media:MediaBackend){}
 private async save(task:VisualTask){await mkdir(this.root,{recursive:true});const path=join(this.root,task.id+'.json');await writeFile(path+'.tmp',JSON.stringify(task,null,2));await rename(path+'.tmp',path)}
 async list(){await mkdir(this.root,{recursive:true});const result:VisualTask[]=[];for(const name of await readdir(this.root)){if(/^[a-f0-9]{32}\.json$/.test(name))result.push(JSON.parse(await readFile(join(this.root,name),'utf8')))}return result.reverse()}
 async create(path:string,cap:number,policy:string,connection:string,signal?:AbortSignal){const task:VisualTask={id:randomUUID().replaceAll('-',''),source:path,sourceHash:await fileDigest(path),duration:0,frames:[],gaps:[],connection,preparation:{cap,policy,status:'等待提取'}};await this.save(task);return this.prepare(task.id,connection,signal)}
 async prepare(id:string,connection:string,signal?:AbortSignal){
  z.string().regex(/^[a-f0-9]{32}$/).parse(id);const task:VisualTask=JSON.parse(await readFile(join(this.root,id+'.json'),'utf8'))
  if(task.connection!==connection)throw new Error('连接已变化，请重新建立任务');if(!task.preparation)throw new Error('任务没有待提取记录');if(task.frames.length)return task
  if(await fileDigest(task.source)!==task.sourceHash)throw new Error('原文件已改变，请重新建立任务')
  const cancel=()=>{void this.media.request('visual-cancel',{id}).catch(()=>{})};signal?.addEventListener('abort',cancel,{once:true})
  try{signal?.throwIfAborted();task.preparation.status='提取中';await this.save(task);const captured=await this.media.request<VisualTask>('visual-frames',{id,path:task.source,cap:task.preparation.cap,policy:task.preparation.policy,expectedHash:task.sourceHash});signal?.throwIfAborted();task.frames=captured.frames.map(frame=>({...frame,status:'等待识别'}));task.duration=captured.duration;task.gaps=captured.gaps;task.preparation.status='已提取';delete task.preparation.error;await this.save(task);return task}
  catch(reason){task.preparation.status='等待继续';task.preparation.error=reason instanceof Error?reason.message:String(reason);await this.save(task);throw reason}
  finally{signal?.removeEventListener('abort',cancel)}
 }
 async run(id:string,connection:string,recognize:(frame:VisualFrame,signal:AbortSignal)=>Promise<string>,progress:(message:string)=>void,signal:AbortSignal){
  z.string().regex(/^[a-f0-9]{32}$/).parse(id);const task:VisualTask=JSON.parse(await readFile(join(this.root,id+'.json'),'utf8'))
  if(task.id!==id||task.connection!==connection)throw new Error('识别连接已有改变，请用当前配置新建任务；旧成果保留')
  if(!task.frames.length)throw new Error('请先完成画面提取')
  if(task.output&&await fileDigest(task.output)!==task.outputHash)throw new Error('识别成果已改变，保留当前文件，请重新建立任务')
  const current=async()=>{if(await fileDigest(task.source)!==task.sourceHash)throw new Error('源文件已经改变，请新建画面识别任务')}
  await current()
  for(const [index,frame] of task.frames.entries()){
   signal.throwIfAborted();if(frame.status==='已完成')continue
   progress(`识别画面 ${index+1}/${task.frames.length}`)
   try{if(digest(await readFile(frame.path))!==frame.hash)throw new Error('所选画面已改变');const text=await recognize(frame,signal);signal.throwIfAborted();await current();if(!text.trim())throw new Error('识别未返回文字');frame.text=text;frame.status='已完成';delete frame.error}
   catch(reason){signal.throwIfAborted();frame.status='失败';frame.error=reason instanceof Error?reason.message:String(reason)}
   await this.save(task)
  }
  await current()
  const failed=task.frames.filter(frame=>frame.status!=='已完成'),gapText=task.gaps.length?task.gaps.map(gap=>`- ${JSON.stringify(gap)}`).join('\n'):'- 提取器没有报告缺口；稀疏采样仍不代表识别了未选取的时段。'
  const text=`# 画面文字与内容\n\n来源：${task.source}\n源文件 SHA256：${task.sourceHash}\n总时长：${task.duration.toFixed(2)} 秒\n\n仅识别所选的 ${task.frames.filter(frame=>frame.status==='已完成').length}/${task.frames.length} 个画面，不代表视频全部内容。\n\n## 抽样缺口\n\n${gapText}\n\n## 识别结果\n\n`+task.frames.map(frame=>`### ${Math.floor(frame.time/60)}:${Math.floor(frame.time%60).toString().padStart(2,'0')} · ${frame.status}\n\n${frame.status==='已完成'?frame.text:`未得到可用识别结果：${frame.error||'仍待处理'}`}\n\n画面 SHA256：${frame.hash}`).join('\n\n')+`\n\n## 未完成项目\n\n${failed.length?failed.map(frame=>`- ${Math.floor(frame.time/60)}:${Math.floor(frame.time%60).toString().padStart(2,'0')}：${frame.error||'仍待处理'}`).join('\n'):'- 无'}`
  const output=join(this.root,task.id+'-画面识别.md')
  if(task.output){if(await fileDigest(output)!==task.outputHash)throw new Error('识别成果已改变，保留当前文件');await writeFile(output,text,'utf8')}
  else try{await writeFile(output,text,{encoding:'utf8',flag:'wx'})}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;throw new Error('已有识别成果文件，保留当前文件')}
  if(await readFile(output,'utf8')!==text)throw new Error('画面成果保存核验失败');task.output=output;task.outputHash=digest(text);await this.save(task)
  if(!failed.length){await this.media.request('visual-cleanup',{id});task.cleaned=true;await this.save(task)}
  return task
 }
}
