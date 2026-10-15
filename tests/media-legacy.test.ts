import {describe,it,expect,afterEach} from 'vitest'
import {mkdir,mkdtemp,readFile,writeFile,rm,rename} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import {LegacyDownloads} from '../src/main/media-legacy'
import {NativeDownloadService} from '../src/main/media-download-service'
import {mediaOptions} from '../src/main/media-options'
import type {MediaCatalog,MediaJob} from '../src/shared/media'
const roots:string[]=[],services:NativeDownloadService[]=[]
afterEach(async()=>{for(const service of services.splice(0))await service.dispose();for(const root of roots.splice(0))await rm(root,{recursive:true,force:true})})
const bvid='BV1Q5HXzuEJX',id='a'.repeat(32),url=`https://www.bilibili.com/video/${bvid}/?p=2`
async function fixture(state='completed'){
 const root=await mkdtemp(join(tmpdir(),'meijiang-legacy-media-'));roots.push(root)
 await mkdir(join(root,'knowledge_base'))
 const legacy=new LegacyDownloads(root),scope=await legacy.scope(),directory=join(root,'records',scope,id),downloadRoot=join(root,'downloads'),bundle=join(downloadRoot,bvid)
 await mkdir(directory,{recursive:true});await mkdir(bundle,{recursive:true})
 const row={id,kb_root_id:scope,title:'旧课程第二节',state,stage:state,source:{bvid,cid:22,page:2,url,storage_id:bvid},options:mediaOptions({retries:0}),download_root:downloadRoot,output:state==='completed'?bundle:'',files:['lesson.mp4'],progress:{},error:'',warning:''}
 const marker={schema_version:2,managed_by:'bilisum',bvid,ownership_id:'f'.repeat(32),download_root:downloadRoot.toLowerCase(),directory:bundle.toLowerCase()}
 const recordPath=join(directory,'state.json'),markerPath=join(bundle,'.bilisum-download.json')
 await writeFile(recordPath,JSON.stringify(row));await writeFile(markerPath,JSON.stringify(marker));await writeFile(join(bundle,'lesson.mp4'),'synthetic old output: ownership check only')
 return {root,legacy,scope,row,recordPath,markerPath,bundle,marker}
}
function native(root:string){let requests=0;const service=new NativeDownloadService('unused',root,{async readMedia(path:string){if(path.endsWith('/view'))return {bvid,title:'课程',pages:[{cid:22,page:2,part:'第二节',duration:2}]};if(path.endsWith('/playurl'))return {dash:{video:[{id:80,height:240,baseUrl:'https://fixture.bilivideo.com/video'}]}};return {subtitle:{subtitles:[]}}}},async()=>{requests++;throw new Error('受控下载失败')});services.push(service);return {service,requests:()=>requests}}
async function settled(service:NativeDownloadService){for(let i=0;i<100;i++){const rows=await service.execute('list') as MediaJob[];if(rows[0]?.state==='error')return rows;await new Promise(resolve=>setTimeout(resolve,5))}throw new Error('未完成迁入')}
describe('read-only legacy download compatibility',()=>{
 it('matches the old root identity and opens v2-owned outputs without modifying records or markers',async()=>{
  const f=await fixture(),before=[await readFile(f.recordPath,'utf8'),await readFile(f.markerPath,'utf8')]
  expect(f.scope).toBe('kbr_'+createHash('sha256').update(JSON.stringify(['kbr',join(f.root,'knowledge_base').toLowerCase()])).digest('hex').slice(0,32))
  expect((await f.legacy.list())[0].title).toBe('旧课程第二节');expect(await f.legacy.file(id)).toBe(f.bundle)
  expect([await readFile(f.recordPath,'utf8'),await readFile(f.markerPath,'utf8')]).toEqual(before)
 })
 it('refuses mismatched ownership, old marker versions and incomplete outputs',async()=>{
  const f=await fixture()
  for(const marker of [{...f.marker,bvid:'BV1oENdzLEgo'},{...f.marker,schema_version:1},{...f.marker,download_root:f.root.toLowerCase()}]){await writeFile(f.markerPath,JSON.stringify(marker));await expect(f.legacy.file(id)).rejects.toThrow()}
  await writeFile(f.markerPath,JSON.stringify(f.marker));await writeFile(join(f.bundle,'left.part'),'partial');await expect(f.legacy.file(id)).rejects.toThrow('未完成')
 })
 it('shows an old running record as interrupted without rewriting it and detects changed snapshots',async()=>{
  const f=await fixture('running'),before=await readFile(f.recordPath,'utf8'),saved=await f.legacy.read(id)
  expect((await f.legacy.list())[0].state).toBe('interrupted');expect(await readFile(f.recordPath,'utf8')).toBe(before)
  await writeFile(f.recordPath,JSON.stringify({...f.row,title:'新版本'}));await expect(f.legacy.unchanged(saved)).rejects.toThrow('已改变')
 })
 it('does not reuse old exact-format IDs or inconsistent page URLs',async()=>{
  const f=await fixture('error')
  await writeFile(f.recordPath,JSON.stringify({...f.row,options:mediaOptions({format_ids:'80+30280'})}));await expect(f.legacy.recipe(id)).rejects.toThrow('精确格式')
  await writeFile(f.recordPath,JSON.stringify({...f.row,source:{...f.row.source,url:`https://www.bilibili.com/video/${bvid}/?p=1`}}));await expect(f.legacy.recipe(id)).rejects.toThrow('身份不一致')
 })
 it('surfaces corrupt and relocated histories instead of silently deleting or trusting them',async()=>{
  const f=await fixture();await writeFile(f.recordPath,'{bad JSON');expect((await f.legacy.list())[0].error_message).toContain('无法核对');expect(await readFile(f.recordPath,'utf8')).toBe('{bad JSON')
  await rename(join(f.root,'records',f.scope),join(f.root,'records','kbr_'+'f'.repeat(32)));await expect(f.legacy.list()).rejects.toThrow('另一资料路径')
 })
 it('does not block new downloads for an empty old root directory',async()=>{
  const f=await fixture();await rm(join(f.root,'records',f.scope,id),{recursive:true});await rename(join(f.root,'records',f.scope),join(f.root,'records','kbr_'+'f'.repeat(32)))
  expect(await f.legacy.list()).toEqual([])
 })
 it('migrates an explicit retry to a native record with the same visible ID and keeps the old file unchanged',async()=>{
  const f=await fixture('error'),before=await readFile(f.recordPath,'utf8'),{service,requests}=native(f.root)
  expect((await service.execute('list') as MediaJob[])).toHaveLength(1)
  const queued=await service.execute('retry',{id}) as MediaJob;expect(queued.id).toBe(id)
  const rows=await settled(service);expect(rows).toHaveLength(1);expect(requests()).toBe(1);expect(await readFile(f.recordPath,'utf8')).toBe(before)
  const saved=JSON.parse(await readFile(join(f.root,'native-downloads',id,'job.json'),'utf8'));expect(saved.legacy.id).toBe(id);expect(saved.legacy.recordHash).toMatch(/^[a-f0-9]{64}$/)
 })
 it('reuses a completed matching legacy bundle on create without downloading it again',async()=>{
  const f=await fixture(),{service,requests}=native(f.root),catalog=await service.execute('catalog',{url}) as MediaCatalog
  const existing=await service.execute('create',{token:catalog.token,options:{retries:0}}) as MediaJob
  expect(existing.id).toBe(id);expect(existing.state).toBe('completed');expect(requests()).toBe(0);expect(await service.execute('file',{id})).toBe(f.bundle)
 })
})
