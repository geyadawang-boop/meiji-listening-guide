import {it,expect,vi} from 'vitest'
import {chromeCandidates,openCodexLoginInChrome} from '../src/main/login-browser'

it('uses installed Chrome and passes the official login URL as a literal argument',async()=>{
 const launch=vi.fn(async()=>{}),exists=vi.fn(async(p:string)=>p==='chrome-user.exe')
 const url='https://auth.openai.com/authorize?state=a%26b&redirect_uri=http%3A%2F%2Flocalhost'
 await openCodexLoginInChrome(url,{candidates:()=>['missing.exe','chrome-user.exe'],exists,launch})
 expect(launch).toHaveBeenCalledExactlyOnceWith('chrome-user.exe',url)
})
it('reports missing Chrome without opening a different browser',async()=>{
 const launch=vi.fn(async()=>{})
 await expect(openCodexLoginInChrome('https://chatgpt.com/',{candidates:()=>['missing.exe'],exists:async()=>false,launch})).rejects.toThrow('未找到 Chrome')
 expect(launch).not.toHaveBeenCalled()
})
it('rejects unofficial or insecure login links',async()=>{
 const exists=vi.fn(async()=>true),launch=vi.fn(async()=>{})
 for(const url of ['http://auth.openai.com/','https://auth.openai.com.evil.example/','file:///C:/file']){
  await expect(openCodexLoginInChrome(url,{candidates:()=>['chrome.exe'],exists,launch})).rejects.toThrow('官方域名')
 }
 expect(exists).not.toHaveBeenCalled();expect(launch).not.toHaveBeenCalled()
})
it('checks the system and current-user Chrome installation folders',()=>{
 expect(chromeCandidates({PROGRAMFILES:'C:/Program Files','PROGRAMFILES(X86)':'C:/Program Files (x86)',LOCALAPPDATA:'C:/Users/Test/AppData/Local'})).toHaveLength(3)
 expect(chromeCandidates({})).toEqual([])
})
