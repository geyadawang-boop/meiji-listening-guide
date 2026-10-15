import {test,expect,vi,afterEach} from 'vitest'
import {EventEmitter} from 'node:events'
import {mkdtemp,writeFile,readFile,rm,access} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
const browser=vi.hoisted(()=>({script:vi.fn<(...args:unknown[])=>Promise<unknown>>(),windows:[] as any[]}))
vi.mock('electron',()=>({
 app:{isPackaged:false,getAppPath:()=>process.cwd()},nativeImage:{},net:{fetch:vi.fn()},session:{fromPartition:()=>({setPermissionRequestHandler:vi.fn()})},
 BrowserWindow:class extends EventEmitter{
  destroyed=false;webContents=new EventEmitter() as EventEmitter&{executeJavaScript:typeof browser.script;setWindowOpenHandler:()=>void}
  constructor(..._args:unknown[]){super();this.webContents.executeJavaScript=browser.script;this.webContents.setWindowOpenHandler=()=>{};browser.windows.push(this)}
  isDestroyed(){return this.destroyed}close(){this.destroyed=true;this.emit('closed')}
  async loadURL(){queueMicrotask(()=>this.webContents.emit('did-finish-load'))}
 }
}))
import {VideoPpt} from '../src/main/video-ppt'
import {snapanyDownload} from '../src/main/snapany'
import type {BrowserWindow} from 'electron'
afterEach(()=>{vi.useRealTimers();browser.windows.length=0;browser.script.mockReset()})
test('pending tasks retain interrupted and corrupt records, with names and actionable errors',async()=>{
 const root=await mkdtemp(join(tmpdir(),'video-recovery-'))
 try{
  const v=new VideoPpt(root,{chat:async()=>''},()=>{}),interrupted=await v.create('未完成下载'),corrupt=await v.create('损坏记录'),valid=await v.create('正常待确认')
  await writeFile(interrupted.video+'.partial','preserve me');await writeFile(join(corrupt.dir,'source.json'),'{broken')
  await writeFile(join(valid.dir,'source.json'),JSON.stringify({id:valid.id,name:valid.name,duration:10,width:100,height:100,preview:'data:image/jpeg;base64,test',crop:{left:0,right:1,top:0,bottom:1},warning:''}))
  const rows=await v.pending();expect(rows).toHaveLength(3)
  expect(rows.find(t=>t.id===interrupted.id)).toMatchObject({name:'未完成下载',error:expect.stringContaining('准备未完成')})
  expect(rows.find(t=>t.id===corrupt.id)).toMatchObject({name:'损坏记录',error:expect.stringContaining('损坏')})
  expect(rows.find(t=>t.id===valid.id)?.error).toBeUndefined()
  expect(await readFile(interrupted.video+'.partial','utf8')).toBe('preserve me')
  expect(await v.location(corrupt.id)).toBe(corrupt.dir);await expect(v.location('../other')).rejects.toThrow('编号')
 }finally{await rm(root,{recursive:true,force:true})}
})
test('completed subtitle cleanup deletes only its own downloaded-video task',async()=>{
 const root=await mkdtemp(join(tmpdir(),'video-cleanup-'))
 try{
  const v=new VideoPpt(root,{chat:async()=>''},()=>{}),complete=await v.create('字幕已保存'),other=await v.create('其它未完成任务')
  await writeFile(complete.video,'downloaded video');await writeFile(other.video,'keep this video')
  await v.discardCompleted(complete.id)
  await expect(access(complete.dir)).rejects.toThrow()
  expect(await readFile(other.video,'utf8')).toBe('keep this video')
  await expect(v.discardCompleted('../other')).rejects.toThrow('编号')
 }finally{await rm(root,{recursive:true,force:true})}
})
test('interrupted subtitle task remains resumable and a saved result is recorded before cleanup',async()=>{
 const root=await mkdtemp(join(tmpdir(),'video-subtitle-resume-'))
 try{
  const v=new VideoPpt(root,{chat:async()=>''},()=>{})
  const task=await v.create('P5 字幕转写',{kind:'subtitle',outputName:'P5-离线转写.srt',courseName:'口腔正畸学',url:'https://www.bilibili.com/video/BV1Q5HXzuEJX/?p=5',page:5})
  await writeFile(task.video,'downloaded video')
  expect((await v.pending()).find(item=>item.id===task.id)).toMatchObject({kind:'subtitle',name:'P5 字幕转写'})
  const output=join(root,'final.srt');await writeFile(output,'1\n00:00:01,000 --> 00:00:02,000\n讲解开始\n')
  await v.markSubtitleSaved(task.id,output)
  expect((await v.pending()).find(item=>item.id===task.id)?.savedPath).toBe(output)
  expect((await v.subtitleTask(task.id)).saved?.sha256).toMatch(/^[a-f\d]{64}$/)
  await v.discardCompleted(task.id)
  await expect(access(task.dir)).rejects.toThrow()
  expect(await readFile(output,'utf8')).toContain('讲解开始')
 }finally{await rm(root,{recursive:true,force:true})}
})
test('initial background-script failure rejects promptly and closes its hidden window',async()=>{
 browser.script.mockRejectedValue(new Error('selector failed'))
 await expect(snapanyDownload({} as BrowserWindow,'https://www.bilibili.com/video/BV1Q5HXzuEJX/','unused',()=>{},new AbortController().signal)).rejects.toThrow('后台页面解析失败')
 expect(browser.windows[0].destroyed).toBe(true);expect(browser.script).toHaveBeenCalledTimes(1)
})
test('polling-script failure stops polling instead of waiting for a three-minute timeout',async()=>{
 vi.useFakeTimers();browser.script.mockResolvedValueOnce(undefined).mockRejectedValue(new Error('poll failed'))
 const pending=snapanyDownload({} as BrowserWindow,'https://www.bilibili.com/video/BV1Q5HXzuEJX/','unused',()=>{},new AbortController().signal)
 const assertion=expect(pending).rejects.toThrow('后台页面解析失败')
 await vi.advanceTimersByTimeAsync(1500);await assertion
 expect(browser.script).toHaveBeenCalledTimes(2);expect(vi.getTimerCount()).toBe(0)
})
