import {describe,it,expect,afterEach} from 'vitest'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {NativeDownloadService} from '../src/main/media-download-service'
import {NativeDownloadJobs} from '../src/main/media-jobs'
import type {MediaCatalog,MediaJob} from '../src/shared/media'
const roots:string[]=[],services:NativeDownloadService[]=[]
afterEach(async()=>{for(const service of services.splice(0))await service.dispose();for(const root of roots.splice(0))await rm(root,{recursive:true,force:true})})
const bvid='BV1Q5HXzuEJX',url=`https://www.bilibili.com/video/${bvid}/?p=2`
async function setup(hang=false){
 const root=await mkdtemp(join(tmpdir(),'meijiang-queue-'));roots.push(root)
 let downloads=0,cid=22
 const api={async readMedia(path:string){if(path.endsWith('/view'))return {bvid,title:'隔离课程',pages:[{cid,page:2,part:'第二节',duration:2}]};if(path.endsWith('/playurl'))return {dash:{video:[{id:80,height:240,codecid:7,baseUrl:'https://fixture.bilivideo.com/video'}]}};return {subtitle:{subtitles:[]}}}}
 const fetcher=async(_url:string,init?:RequestInit):Promise<Response>=>{downloads++;if(!hang)throw new Error('受控下载失败');return new Promise((_resolve,reject)=>{const abort=()=>reject(new Error('已取消'));init?.signal?.addEventListener('abort',abort,{once:true});if(init?.signal?.aborted)abort()})}
 const service=new NativeDownloadService('unused-test-resources',root,api,fetcher);services.push(service)
 return {root,service,downloads:()=>downloads,setCid:(value:number)=>{cid=value}}
}
async function create(service:NativeDownloadService){const catalog=await service.execute('catalog',{url,options:{retries:0}}) as MediaCatalog;return await service.execute('create',{token:catalog.token,options:{retries:0}}) as MediaJob}
async function until(service:NativeDownloadService,id:string,state:string){for(let i=0;i<200;i++){const rows=await service.execute('list') as MediaJob[],row=rows.find(row=>row.id===id);if(row?.state===state)return row;await new Promise(resolve=>setTimeout(resolve,5))}throw new Error('状态等待超时：'+state)}
describe('native download queue control',()=>{
 it('returns public directories without starting media downloads',async()=>{const {service,downloads}=await setup();const result=await service.execute('catalog',{url,playlist:true}) as MediaCatalog;expect(result.entries).toHaveLength(1);expect(downloads()).toBe(0)})
 it('refuses an expired or unknown token and changed page identity before creating a job',async()=>{const {service,setCid,downloads}=await setup();await expect(service.execute('create',{token:'a'.repeat(32)})).rejects.toThrow('失效');const source=await service.execute('catalog',{url}) as MediaCatalog;setCid(99);await expect(service.execute('create',{token:source.token})).rejects.toThrow('身份');expect(await service.execute('list')).toEqual([]);expect(downloads()).toBe(0)})
 it('returns responsive status while downloading and cancels the active stream',async()=>{const {service,downloads}=await setup(true),row=await create(service);await until(service,row.id,'running');const cancelled=await service.execute('cancel',{id:row.id}) as MediaJob;expect(cancelled.state).toBe('cancelled');expect(downloads()).toBeLessThanOrEqual(1);await expect(service.execute('file',{id:row.id})).rejects.toThrow('尚无')})
 it('keeps queued cancellation separate from the active task',async()=>{const {service,downloads}=await setup(true),first=await create(service);await until(service,first.id,'running');const second=await create(service);expect((await service.execute('cancel',{id:second.id}) as MediaJob).state).toBe('cancelled');expect((await service.execute('list') as MediaJob[]).find(row=>row.id===first.id)?.state).toBe('running');expect(downloads()).toBeLessThanOrEqual(1);await service.execute('cancel',{id:first.id})})
 it('persists errors and only retries when explicitly requested',async()=>{const {service,downloads}=await setup(),row=await create(service);await until(service,row.id,'error');expect(downloads()).toBe(1);await service.execute('retry',{id:row.id});await until(service,row.id,'error');expect(downloads()).toBe(2)})
 it('does not automatically restart previous queued work after process recovery',async()=>{const {root,service,downloads}=await setup(),old=new NativeDownloadJobs(root),row=await old.create({identity:`${bvid}:22:2`,url,title:'旧队列',options:{retries:0}});const rows=await service.execute('list') as MediaJob[];expect(rows[0].state).toBe('interrupted');expect(downloads()).toBe(0);await service.execute('retry',{id:row.id});await until(service,row.id,'error');expect(downloads()).toBe(1)})
 it('shutdown waits for cancellation and refuses further commands',async()=>{const {service}=await setup(true),row=await create(service);await until(service,row.id,'running');await service.dispose();await expect(service.execute('list')).rejects.toThrow('关闭')})
})
