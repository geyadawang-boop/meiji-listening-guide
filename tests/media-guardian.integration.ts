import assert from 'node:assert/strict'
import {fork,type ChildProcess} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {mkdir,writeFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {randomUUID} from 'node:crypto'
import {mediaCommand} from '../src/main/media-command'
const resources=resolve('resources')
if(process.argv[2]==='owned-worker'){
 const controller=new AbortController();process.on('message',()=>controller.abort())
 void mediaCommand(resources,'ffmpeg.exe',['-hide_banner','-loglevel','error','-nostdin','-re','-f','lavfi','-i','color=c=blue:s=64x64:r=10','-t','120','-f','null','-'],controller.signal,undefined,pid=>process.send?.({pid})).then(()=>{process.exitCode=0;if(process.connected)process.disconnect()}).catch(()=>{process.exitCode=0;if(process.connected)process.disconnect()})
}else{
 const created:ChildProcess[]=[],pids:number[]=[]
 try{
  async function worker(){const child=fork(fileURLToPath(import.meta.url),['owned-worker'],{stdio:['ignore','ignore','pipe','ipc'],windowsHide:true});created.push(child);const pid=await new Promise<number>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('未收到媒体启动回执')),10000);child.once('message',raw=>{clearTimeout(timer);resolve((raw as {pid:number}).pid)});child.once('error',reject)});pids.push(pid);process.kill(pid,0);return {child,pid}}
  async function gone(pid:number){for(let i=0;i<100;i++){try{process.kill(pid,0)}catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH')return;throw error}await new Promise(resolve=>setTimeout(resolve,50))}throw new Error('调用进程退出后媒体仍在运行')}
  const crashed=await worker();crashed.child.kill();await gone(crashed.pid)
  const cancelled=await worker();cancelled.child.send({cancel:true});await gone(cancelled.pid)
  const directory=resolve('test-results','media-guardian-'+randomUUID());await mkdir(directory,{recursive:true})
  const report={realFfmpeg:true,ownedCallerKilled:true,ipcDisconnectStopsMedia:true,activeCancellationStopsMedia:true,noUnknownPidTermination:true,pythonUsed:false,completeMigration:false}
  await writeFile(join(directory,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({directory,...report}))
 }finally{for(const child of created)if(child.connected)child.send({cancel:true})}
}
