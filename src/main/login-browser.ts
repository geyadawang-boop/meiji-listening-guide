import {access, constants} from 'node:fs/promises'
import {join} from 'node:path'
import {spawn} from 'node:child_process'

export function chromeCandidates(env: NodeJS.ProcessEnv = process.env) {
 return [
  ...new Set(
   [env.PROGRAMFILES && join(env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'), env['PROGRAMFILES(X86)'] && join(env['PROGRAMFILES(X86)']!, 'Google', 'Chrome', 'Application', 'chrome.exe'), env.LOCALAPPDATA && join(env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe')].filter(
    (p): p is string => !!p
   )
  )
 ]
}

export async function openCodexLoginInChrome(
 url: string,
 deps = {
  candidates: () => chromeCandidates(),
  exists: async (path: string) => {
   try {
    await access(path, constants.F_OK)
    return true
   } catch {
    return false
   }
  },
  launch: (executable: string, link: string) =>
   new Promise<void>((resolve, reject) => {
    // Pass the login URL as a literal argument. Reuse Chrome's normal profile.
    const child = spawn(executable, [link], {shell: false, detached: true, windowsHide: true, stdio: 'ignore'})
    child.once('error', () => reject(new Error('无法打开 Chrome，请确认 Chrome 可以正常启动')))
    child.once('spawn', () => {
     child.unref()
     resolve()
    })
   })
 }
) {
 const link = new URL(url)
 if (link.protocol !== 'https:' || !['auth.openai.com', 'chatgpt.com'].includes(link.hostname)) throw new Error('Codex 登录地址不符合官方域名')
 for (const path of deps.candidates()) {
  if (await deps.exists(path)) {
   await deps.launch(path, link.href)
   return
  }
 }
 throw new Error('未找到 Chrome，请先安装 Google Chrome 后再登录')
}
