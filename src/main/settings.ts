import { app, safeStorage } from 'electron'
import { join } from 'node:path'
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import type { Settings, Profile } from '../shared/types'
import { validateDeepSeek } from './deepseek'
interface Stored extends Omit<Settings,'profiles'|'hasSearchKey'|'searchKey'> { profiles:(Profile & {encryptedKey?:string})[]; encryptedSearchKey?:string; videoPolicyVersion?:number }
export class SettingsStore {
  private path: string
  private value: Stored
  constructor(root:string) {
    mkdirSync(root,{recursive:true}); this.path=join(root,'settings.json')
    this.value=existsSync(this.path)?JSON.parse(readFileSync(this.path,'utf8')):{profiles:[],activeProfile:'',theme:'light',browserWidth:420,browserOpen:true,maxMinutes:60,maxGB:1.5,compress:false,prompts:{}}
    if(this.value.videoPolicyVersion!==2){if(this.value.maxMinutes===45||this.value.maxMinutes>=60){this.value.maxMinutes=60;this.value.compress=false}this.value.videoPolicyVersion=2;this.flush()}
    for (const name of ['correction','notes','past-exam','match','search','answer','chat']) {
      if (this.value.prompts[name]===undefined) this.value.prompts[name]=readFileSync(join(app.isPackaged?process.resourcesPath:app.getAppPath(),'prompts',name+'.txt'),'utf8')
    }
  }
  public get(): Settings {
    const {encryptedSearchKey,profiles,videoPolicyVersion,...rest}=this.value
    return {...rest,hasSearchKey:!!encryptedSearchKey,profiles:profiles.map(({encryptedKey,apiKey,...p})=>({...p,hasKey:!!encryptedKey,keyLength:encryptedKey?this.decrypt(encryptedKey).length:0}))}
  }
  public codexSelection():Settings['codex'] {return this.value.codex?{...this.value.codex}:undefined}
  private encrypt(value:string):string {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('系统加密存储不可用，未保存密钥')
    return safeStorage.encryptString(value).toString('base64')
  }
  private decrypt(value?:string):string { return value ? safeStorage.decryptString(Buffer.from(value,'base64')) : '' }
  public save(settings:Settings):Settings {
    if (!(settings.maxMinutes>=1 && settings.maxMinutes<=60) || !(settings.maxGB>0 && settings.maxGB<=10)) throw new Error('视频限制设置不合法')
    const profiles=settings.profiles.map(p=> {
      const name=p.name?.trim(), model=p.model?.trim(), baseUrl=p.baseUrl?.trim()
      if (!name || !model) throw new Error('请填写配置名称和模型名后再保存')
      if (!baseUrl) throw new Error('请填写 API 的 Base URL 后再保存')
      let parsed:URL
      try {parsed=new URL(baseUrl)} catch {throw new Error('API 地址格式不正确，请填写完整地址，例如 https://服务地址/v1')}
      if (!['https:','http:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('API 地址必须是 HTTP(S)，不能包含密码')
      for(const param of Object.values(p.parameters||{})){if((param.temperature!==undefined&&(!Number.isFinite(param.temperature)||param.temperature<0||param.temperature>2))||(param.topP!==undefined&&(!Number.isFinite(param.topP)||param.topP<0||param.topP>1))||(param.maxTokens!==undefined&&(!Number.isInteger(param.maxTokens)||param.maxTokens<1)))throw new Error('模型参数超出允许范围')}
      const id=p.id || randomUUID(), old=this.value.profiles.find(v=>v.id===id)
      if(p.apiFormat!==undefined&&!['chat_completions','responses'].includes(p.apiFormat))throw new Error('不支持此 API 接口格式')
      return {id,name,baseUrl:baseUrl.replace(/\/$/,''),model,apiFormat:p.apiFormat||old?.apiFormat||'chat_completions',provider:p.provider||old?.provider||'custom',parameters:p.parameters||old?.parameters||{},models:p.models||old?.models||[],encryptedKey:p.apiKey?.trim()?this.encrypt(p.apiKey.trim()):old?.encryptedKey}
    })
    const encryptedSearchKey=settings.searchKey===undefined?this.value.encryptedSearchKey:settings.searchKey?this.encrypt(settings.searchKey):undefined
    if(settings.codex && (typeof settings.codex.model!=='string'||typeof settings.codex.effort!=='string'))throw new Error('Codex 模型设置不正确')
    if(settings.connection!==undefined&&!['codex','deepseek'].includes(settings.connection))throw new Error('模型连接方式不正确')
    if(settings.connection==='deepseek'){const selected=profiles.find(p=>p.id===settings.activeProfile);if(!selected||selected.provider!=='deepseek')throw new Error('请选择 DeepSeek 配置');validateDeepSeek({...selected,key:this.decrypt(selected.encryptedKey)})}
    const next:Stored={connection:settings.connection||'codex',codex:settings.codex||this.value.codex,videoPolicyVersion:2,profiles,activeProfile:profiles.some(p=>p.id===settings.activeProfile)?settings.activeProfile:profiles[0]?.id||'',encryptedSearchKey,theme:settings.theme==='dark'?'dark':'light',browserWidth:Math.min(900,Math.max(280,settings.browserWidth)),browserOpen:!!settings.browserOpen,maxMinutes:settings.maxMinutes,maxGB:settings.maxGB,compress:!!settings.compress,prompts:settings.prompts}
    this.flush(next); this.value=JSON.parse(readFileSync(this.path,'utf8')); return this.get()
  }
  public browser(width:number,open:boolean) { this.value.browserWidth=Math.min(900,Math.max(280,width));this.value.browserOpen=open;this.flush() }
  public revealKey(id:string) {const p=this.value.profiles.find(p=>p.id===id);if(!p?.encryptedKey)throw new Error('此配置尚未保存密钥');return this.decrypt(p.encryptedKey)}
  public draft(p:Profile) {
    const baseUrl=p.baseUrl?.trim();let url:URL
    try {url=new URL(baseUrl)}catch{throw new Error('请填写完整的 API 地址')}
    if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw new Error('API 地址必须是 HTTP(S)，不能包含密码')
    const old=this.value.profiles.find(v=>v.id===p.id),key=p.apiKey?.trim()||this.decrypt(old?.encryptedKey)
    if(!key)throw new Error('请填写 API Key，或使用此配置已保存的密钥')
    return {...p,baseUrl:baseUrl.replace(/\/$/,''),key}
  }
  public profile() { const p=this.value.profiles.find(p=>p.id===this.value.activeProfile); if(!p)throw new Error('请先在设置中添加并选择 API 配置');return {...p,key:this.decrypt(p.encryptedKey)} }
  public searchKey() { const k=this.decrypt(this.value.encryptedSearchKey);if(!k)throw new Error('未配置 Tavily 搜索密钥，将如实保留拓展题差额');return k }
  public prompt(name:string) { return this.value.prompts[name] || '' }
  private flush(value=this.value) {writeFileSync(this.path+'.tmp',JSON.stringify(value,null,2),'utf8');renameSync(this.path+'.tmp',this.path)}
}
