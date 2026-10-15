import {_electron as electron} from 'playwright'
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import assert from 'node:assert/strict'
const root=resolve('.'),base=join(root,'test-results');await mkdir(base,{recursive:true});const output=await mkdtemp(join(base,'typescript-followup-'))
const env=Object.fromEntries(Object.entries(process.env).filter((pair):pair is [string,string]=>typeof pair[1]==='string'));delete env.ELECTRON_RUN_AS_NODE;env.LISTENING_ASSISTANT_DATA=join(output,'data')
const app=await electron.launch({executablePath:join(root,'node_modules/electron/dist/electron.exe'),args:[root],env})
try{
 const page=await app.firstWindow();await page.waitForFunction(()=>!!(window as any).assistant)
 // Exercise real IPC first. The following UI-only fixture never touches an account or starts a model.
 const native=await page.evaluate(async()=>{const invoke=(window as any).assistant.invoke;return {jobs:await invoke('media:list'),tools:await invoke('tools:request',{action:'overview',args:{}}),options:await invoke('media:options')}})
 assert.ok(Array.isArray(native.jobs));assert.ok(native.tools)
 await app.evaluate(({ipcMain},fixture)=>{
  ipcMain.removeHandler('assistant:invoke');ipcMain.handle('assistant:invoke',async(_event,action:string,args:any)=>{
   if(action==='media:options')return fixture.options
   if(action==='media:list'||action==='subtitle-sync:list')return []
   if(action==='media:auth-list')return []
   if(action==='media:catalog')return {url:'https://www.youtube.com/watch?v=abcdefghijk',title:'界面专项样例',playlist:false,duration:10,heights:[240],subtitles:[]}
   if(action==='tools:request'&&args.action==='overview')return {...fixture.tools,workflows:[{workflow_id:'a'.repeat(32),question:'旧版样例问题',status:'legacy_saved',revision:1,fence:0,outcome_unknown:false,notice:'历史结果未重新核验',steps:[{name:'综合回答',status:'completed',answer:'保存时答案'}]}]}
   if(action==='tools:request'&&args.action==='materials')return {items:[],next_offset:null}
   throw new Error('UI fixture does not support '+action)
  })
 },native)
 await page.locator('.app-icon-rail').getByRole('button',{name:'视频资源',exact:true}).click()
 const media=page.getByRole('region',{name:'媒体下载',exact:true});await media.getByRole('textbox',{name:'媒体网址',exact:true}).fill('https://www.youtube.com/watch?v=abcdefghijk');await media.getByRole('button',{name:'读取可用格式',exact:true}).click();await media.getByText('更多下载选项',{exact:true}).click()
 const sponsor=media.getByRole('textbox',{name:'移除片段类型',exact:true});await sponsor.fill('sponsor,intro');assert.match(await sponsor.getAttribute('title')||'',/字幕与章节同步调整/);assert.equal(await sponsor.inputValue(),'sponsor,intro')
 await media.getByText('站点登录档案',{exact:true}).click();await media.getByRole('textbox',{name:'登录档案名称',exact:true}).fill('界面验证档案');await media.getByRole('textbox',{name:'登录档案站点域名',exact:true}).fill('youtube.com');await media.getByLabel('加密下载任务记录（媒体文件本身不加密）',{exact:true}).check();assert.equal(await media.getByLabel('加密下载任务记录（媒体文件本身不加密）',{exact:true}).isChecked(),true);
 await page.screenshot({path:join(output,'片段移除界面.png')})
 await page.locator('.app-icon-rail').getByRole('button',{name:'工具与工作流',exact:true}).click()
 const tools=page.getByRole('region',{name:'工具与工作流',exact:true});await tools.getByText('历史结果未重新核验',{exact:true}).waitFor();assert.equal(await tools.getByRole('button',{name:'继续工作流',exact:true}).count(),0)
 await tools.getByRole('button',{name:'用当前资料重建工作流',exact:true}).click();await tools.getByText('已载入原问题，请重新选择当前资料，再创建工作流',{exact:true}).waitFor();assert.equal(await page.locator('iframe,webview').count(),0)
 await page.screenshot({path:join(output,'旧工作流界面.png')});await writeFile(join(output,'report.json'),JSON.stringify({sourceWindow:true,realNativeDownloadAndResearchIpc:true,uiOnlyLegacyFixture:true,sponsorOptionEditable:true,legacyFlowReadonlyAndExplicitRebuild:true,noWebview:true,noRealAccountsOrCourseMaterials:true}));console.log(JSON.stringify({output,passed:true}))
}finally{await app.close()}
