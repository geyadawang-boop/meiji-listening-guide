import {app, safeStorage} from 'electron'
import {join} from 'node:path'
import {readFileSync, writeFileSync, mkdirSync, existsSync, renameSync} from 'node:fs'
import {createHash} from 'node:crypto'
import type {Settings, Profile} from '@shared/types'
type StoredProfile = Profile & {encryptedKey?: string; apiKey?: string}
interface Stored extends Omit<Settings, 'profiles' | 'activeProfile' | 'hasSearchKey' | 'searchKey' | 'connection'> {
 // Keep pre-migration fields intact but never expose or use their credentials.
 profiles: StoredProfile[]
 activeProfile?: string
 connection?: string
 codex?: unknown
 qwenProfile?: StoredProfile
 encryptedSearchKey?: string
 videoPolicyVersion?: number
}
const defaultProfile = (): Profile => ({
 id: 'qwen-default',
 name: '通义千问',
 provider: 'qwen',
 baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
 model: '',
 visionModel: '',
 apiFormat: 'chat_completions',
 models: []
})
const endpointIdentity = (profile: Profile) => {
 const url = new URL(profile.baseUrl)
 if (url.search || url.hash) throw new Error('API 地址不能包含查询参数或片段')
 return `${url.origin}${url.pathname.replace(/\/$/, '')}`
}
export class SettingsStore {
 private path: string
 private value: Stored
 constructor(root: string) {
  mkdirSync(root, {recursive: true})
  this.path = join(root, 'settings.json')
  this.value = existsSync(this.path)
   ? JSON.parse(readFileSync(this.path, 'utf8'))
   : {
      profiles: [],
      activeProfile: '',
      theme: 'light',
      browserWidth: 420,
      browserOpen: true,
      maxMinutes: 60,
      maxGB: 1.5,
      compress: false,
      prompts: {}
     }
  // Legacy Codex/DeepSeek profiles stay encrypted in their original fields.
  // The active provider receives a fresh identity and never inherits those keys.
  if (!this.value.qwenProfile) {
   this.value.qwenProfile = defaultProfile()
   this.value.connection = 'qwen'
   this.flush()
  }
  if (this.value.videoPolicyVersion !== 2) {
   if (this.value.maxMinutes === 45 || this.value.maxMinutes >= 60) {
    this.value.maxMinutes = 60
    this.value.compress = false
   }
   this.value.videoPolicyVersion = 2
   this.flush()
  }
  for (const name of ['correction', 'notes', 'past-exam', 'match', 'search', 'answer', 'chat']) {
   if (this.value.prompts[name] === undefined)
    this.value.prompts[name] = readFileSync(
     join(app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'src'), 'prompts', name + '.txt'),
     'utf8'
    )
  }
 }
 public get(): Settings {
  const {
   encryptedSearchKey,
   profiles: _legacyProfiles,
   activeProfile: _legacyActive,
   connection: _legacyConnection,
   codex: _legacyCodex,
   qwenProfile,
   videoPolicyVersion,
   ...rest
  } = this.value
  const profile: StoredProfile = qwenProfile || {...defaultProfile()},
   {encryptedKey, apiKey, ...publicProfile} = profile
  return {
   ...rest,
   connection: 'qwen',
   hasSearchKey: !!encryptedSearchKey,
   profiles: [
    {
     ...publicProfile,
     provider: 'qwen',
     apiFormat: 'chat_completions',
     hasKey: !!encryptedKey,
     keyLength: encryptedKey ? this.decrypt(encryptedKey).length : 0
    }
   ],
   activeProfile: profile.id
  }
 }
 private requireSecureStorage() {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('系统加密存储不可用，未读取或保存密钥')
  if (
   process.platform === 'linux' &&
   !['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6'].includes(safeStorage.getSelectedStorageBackend())
  )
   throw new Error('系统未提供安全密钥库，未读取或保存密钥')
 }
 private encrypt(value: string): string {
  this.requireSecureStorage()
  return safeStorage.encryptString(value).toString('base64')
 }
 private decrypt(value?: string): string {
  if (!value) return ''
  this.requireSecureStorage()
  return safeStorage.decryptString(Buffer.from(value, 'base64'))
 }
 public save(settings: Settings): Settings {
  if (!(settings.maxMinutes >= 1 && settings.maxMinutes <= 60) || !(settings.maxGB > 0 && settings.maxGB <= 10))
   throw new Error('视频限制设置不合法')
  const input =
    settings.profiles.find(p => p.id === settings.activeProfile) || settings.profiles[0] || defaultProfile(),
   name = input.name?.trim(),
   model = input.model?.trim(),
   visionModel = input.visionModel?.trim() || '',
   baseUrl = input.baseUrl?.trim()
  if (!name) throw new Error('请填写配置名称')
  if (!baseUrl) throw new Error('请填写千问 API 的 Base URL')
  let parsed: URL
  try {
   parsed = new URL(baseUrl)
  } catch {
   throw new Error('API 地址格式不正确，请填写完整地址')
  }
  if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password)
   throw new Error('API 地址必须是 HTTP(S)，不能包含密码')
  endpointIdentity({...input, baseUrl})
  for (const param of Object.values(input.parameters || {})) {
   if (
    (param.temperature !== undefined &&
     (!Number.isFinite(param.temperature) || param.temperature < 0 || param.temperature > 2)) ||
    (param.topP !== undefined && (!Number.isFinite(param.topP) || param.topP < 0 || param.topP > 1)) ||
    (param.maxTokens !== undefined && (!Number.isInteger(param.maxTokens) || param.maxTokens < 1))
   )
    throw new Error('模型参数超出允许范围')
  }
  const id = 'qwen',
   old = this.value.qwenProfile,
   identity = endpointIdentity({...input, baseUrl}),
   oldIdentity = old ? endpointIdentity(old) : ''
  if (!input.apiKey?.trim() && old?.encryptedKey && identity !== oldIdentity)
   throw new Error('API 地址已改变。为避免把旧密钥发送到新地址，请重新填写该地址的千问 API Key')
  // Verify retained credentials before writing any other settings.
  if (!input.apiKey?.trim()) this.decrypt(old?.encryptedKey)
  if (settings.searchKey === undefined) this.decrypt(this.value.encryptedSearchKey)
  const profile: StoredProfile = {
   id,
   name,
   baseUrl: baseUrl.replace(/\/$/, ''),
   model,
   visionModel,
   apiFormat: 'chat_completions',
   provider: 'qwen',
   parameters: input.parameters || {},
   models: [...new Set([model, visionModel, ...(input.models || [])])],
   encryptedKey: input.apiKey?.trim() ? this.encrypt(input.apiKey.trim()) : old?.encryptedKey
  }
  const encryptedSearchKey =
   settings.searchKey === undefined
    ? this.value.encryptedSearchKey
    : settings.searchKey
      ? this.encrypt(settings.searchKey)
      : undefined
  const next: Stored = {
   ...this.value,
   connection: 'qwen',
   qwenProfile: profile,
   encryptedSearchKey,
   searchProvider: settings.searchProvider === 'searxng' ? 'searxng' : 'duckduckgo',
   searchEndpoint: (settings.searchEndpoint || '').trim(),
   videoPolicyVersion: 2,
   theme: settings.theme === 'dark' ? 'dark' : settings.theme === 'system' ? 'system' : 'light',
   browserWidth: Math.min(900, Math.max(280, settings.browserWidth)),
   browserOpen: !!settings.browserOpen,
   maxMinutes: settings.maxMinutes,
   maxGB: settings.maxGB,
   compress: !!settings.compress,
   prompts: settings.prompts
  }
  this.flush(next)
  this.value = JSON.parse(readFileSync(this.path, 'utf8'))
  return this.get()
 }
 public browser(width: number, open: boolean) {
  this.value.browserWidth = Math.min(900, Math.max(280, width))
  this.value.browserOpen = open
  this.flush()
 }
 // 缓存已读取的可用模型，避免聊天界面每次进入都重新请求服务端。
 public cacheModels(models: string[]) {
  const p = this.value.qwenProfile
  if (!p) return
  const merged = [...new Set([p.model, p.visionModel, ...models].filter((item): item is string => !!item))]
  if (JSON.stringify(merged) === JSON.stringify(p.models || [])) return
  this.value.qwenProfile = {...p, models: merged}
  this.flush()
 }
 public revealKey(id: string) {
  const p = this.value.qwenProfile
  if (id !== 'qwen' || !p?.encryptedKey) throw new Error('此千问配置尚未保存密钥')
  return this.decrypt(p.encryptedKey)
 }
 public draft(p: Profile): Profile & {key: string} {
  const baseUrl = p.baseUrl?.trim()
  let url: URL
  try {
   url = new URL(baseUrl)
  } catch {
   throw new Error('请填写完整的 API 地址')
  }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
   throw new Error('API 地址必须是 HTTP(S)，不能包含密码')
  const old = this.value.qwenProfile
  if (p.provider && p.provider !== 'qwen') throw new Error('本版本仅支持千问模型配置')
  const identity = endpointIdentity({...p, baseUrl}),
   oldIdentity = old ? endpointIdentity(old) : ''
  if (old?.encryptedKey && identity !== oldIdentity && !p.apiKey?.trim())
   throw new Error('API 地址已改变，请填写该地址对应的千问 API Key')
  const key = p.apiKey?.trim() || (identity === oldIdentity ? this.decrypt(old?.encryptedKey) : '')
  if (!key) throw new Error('请填写千问 API Key，并确认 Base URL 与密钥属于同一服务')
  return {
   ...p,
   provider: 'qwen',
   apiFormat: 'chat_completions',
   visionModel: p.visionModel?.trim() || '',
   baseUrl: baseUrl.replace(/\/$/, ''),
   key
  }
 }
 public profile() {
  const p = this.value.qwenProfile
  if (!p) throw new Error('请先在设置中配置千问')
  const {encryptedKey, apiKey, ...safe} = p
  return this.draft({...safe, apiKey: undefined})
 }
 public connectionFingerprint() {
  const p: StoredProfile = this.value.qwenProfile || defaultProfile()
  return createHash('sha256')
   .update(
    JSON.stringify([p.baseUrl, p.model, p.visionModel, p.apiFormat, p.parameters, p.encryptedKey || 'missing-key'])
   )
   .digest('hex')
 }
 public searchKey() {
  const k = this.decrypt(this.value.encryptedSearchKey)
  if (!k) throw new Error('未配置 Tavily 搜索密钥，将如实保留拓展题差额')
  return k
 }
 public prompt(name: string) {
  return this.value.prompts[name] || ''
 }
 private flush(value = this.value) {
  writeFileSync(this.path + '.tmp', JSON.stringify(value, null, 2), 'utf8')
  renameSync(this.path + '.tmp', this.path)
 }
}
