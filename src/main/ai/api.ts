import type {Profile} from '@shared/types'
import type {SettingsStore} from '@main/config/settings'
import {setTimeout as delay} from 'node:timers/promises'
export interface FileInput {
 filename: string
 file_data: string
 path?: string
}
export interface ChatMessage {
 role: 'system' | 'user' | 'assistant'
 content:
  | string
  | ({type: 'text'; text: string} | {type: 'file'; file: FileInput} | {type: 'image_url'; image_url: {url: string}})[]
}
class ApiConnectionError extends Error {}
export function isRetryableApiError(error: unknown): boolean {
 // 只重试连接故障；鉴权失败和明确截断不属于此类。
 for (let depth = 0; error instanceof Error && depth < 3; depth++) {
  if (error instanceof ApiConnectionError || error.name === 'TimeoutError') return true
  const code = (error as Error & {code?: string}).code || ''
  if (
   /ERR_CONNECTION_(CLOSED|RESET|ABORTED)|ERR_(NETWORK_CHANGED|TIMED_OUT|EMPTY_RESPONSE)|ECONNRESET|ECONNABORTED|ETIMEDOUT|UND_ERR_(SOCKET|CONNECT_TIMEOUT|HEADERS_TIMEOUT|BODY_TIMEOUT)|fetch failed|network error|aborted due to timeout|HTTP (429|5\d\d)/i.test(
    code + ' ' + error.message
   )
  )
   return true
  error = error.cause
 }
 return false
}
async function requestError(response: Response, nativeFile: boolean, hasFile: boolean) {
 let hint = ''
 if (response.status === 404) hint = '服务端未找到当前模型或接口，请在设置中重新选择文本/视觉模型，并确认 API 地址'
 else if (response.status === 400) {
  // Classify internally; never return provider text, which may echo credentials or request data.
  try {
   const body = (await response.json()) as {error?: {code?: string; param?: string; message?: string}}
   const detail = [body.error?.code, body.error?.param, body.error?.message]
    .filter(v => typeof v === 'string')
    .join(' ')
   if (/reasoning(?:_effort|\.effort)?|推理强度/i.test(detail))
    hint = '服务端拒绝了推理强度参数，请在模型参数中选择提供方默认'
   else if (/temperature|top_p/i.test(detail)) hint = '服务端拒绝了温度或 Top P 参数，请恢复提供方默认'
   else if (/max_(?:output_)?tokens/i.test(detail)) hint = '服务端拒绝了最大输出参数，请检查模型允许的输出上限'
   else if (/file|pptx?|attachment|mime|文件|附件/i.test(detail))
    hint = '服务端拒绝了课件文件输入，请核对该模型与接口允许的文件格式及大小'
   else if (/model|模型/i.test(detail)) hint = '服务端拒绝了当前模型，请核对模型名与接口是否匹配'
  } catch {}
 }
 const error = new Error(
  `API 请求失败（HTTP ${response.status}），${hint || '请检查地址、接口格式、模型、密钥或配额'}${nativeFile ? '；PPT 原文件上传需要服务商支持 Responses 文件输入' : hasFile ? '；此任务需要服务商与模型支持 PDF 文件输入' : ''}`
 )
 const retryAfter = response.headers.get('retry-after')
 if (retryAfter) {
  const milliseconds = /^\d+(?:\.\d+)?$/.test(retryAfter)
   ? Number(retryAfter) * 1000
   : Date.parse(retryAfter) - Date.now()
  if (Number.isFinite(milliseconds) && milliseconds > 0)
   Object.assign(error, {retryAfterMs: Math.min(milliseconds, 2_147_483_647)})
 }
 return error
}
export async function readSse(body: ReadableStream<Uint8Array>, onText: (text: string) => void): Promise<string> {
 const reader = body.getReader(),
  decoder = new TextDecoder()
 let buffer = '',
  all = '',
  finishReason = '',
  completed = false
 const event = (value: string) => {
  const data = value
   .split('\n')
   .filter(l => l.startsWith('data:'))
   .map(l => l.slice(5).trimStart())
   .join('\n')
   .trim()
  if (!data) return
  if (data === '[DONE]') {
   if (!finishReason || finishReason === 'stop') completed = true
   return
  }
  const obj = JSON.parse(data)
  if (obj.error || obj.type === 'response.failed' || obj.type === 'response.incomplete')
   throw new Error('API 未完成流式输出，请检查服务配置或输出长度限制')
  if (obj.type === 'response.completed') {
   if (obj.response?.status && obj.response.status !== 'completed') throw new Error('API 未完成流式输出')
   completed = true
   return
  }
  const reason = obj.choices?.[0]?.finish_reason
  if (typeof reason === 'string') {
   finishReason = reason
   if (reason === 'length' || reason === 'content_filter')
    throw new Error(
     reason === 'length' ? 'API 输出达到长度限制，未保存不完整结果' : 'API 输出被内容安全过滤，未保存不完整结果'
    )
   if (reason && reason !== 'stop') throw new Error('API 未正常结束文本输出，未保存结果')
   if (reason === 'stop') completed = true
  }
  const delta = obj.type === 'response.output_text.delta' ? obj.delta : obj.choices?.[0]?.delta?.content
  if (typeof delta === 'string') {
   all += delta
   onText(delta)
  }
 }
 try {
  for (;;) {
   const {value, done} = await reader.read()
   buffer += decoder.decode(value, {stream: !done}).replace(/\r/g, '')
   let index: number
   while ((index = buffer.indexOf('\n\n')) >= 0) {
    event(buffer.slice(0, index))
    buffer = buffer.slice(index + 2)
   }
   if (done) {
    if (buffer.trim()) event(buffer)
    break
   }
  }
  if (!completed) throw new ApiConnectionError('API 流提前结束，缺少有效完成标记，未保存不完整结果')
  if (!all.trim()) throw new Error('API 未返回文本')
  return all
 } finally {
  reader.releaseLock()
 }
}
export class Api {
 constructor(
  private settings: SettingsStore,
  private request: (input: string, init?: RequestInit) => Promise<Response> = fetch
 ) {}
 async chat(
  messages: ChatMessage[],
  onText?: (text: string) => void,
  signal?: AbortSignal,
  draft?: Profile,
  options?: {images?: {label: string; url: string}[]; onRetry?: () => void; profile?: Profile}
 ): Promise<string> {
  signal?.throwIfAborted()
  const p = draft ? this.settings.draft(draft) : this.settings.profile(),
   nativeFile = messages.some(
    m => Array.isArray(m.content) && m.content.some(part => part.type === 'file' && !/\.pdf$/i.test(part.file.filename))
   ),
   optionImages = options?.images || []
  const inlineImages = messages.flatMap(m =>
    Array.isArray(m.content) ? m.content.filter(part => part.type === 'image_url') : []
   ),
   hasImages = optionImages.length > 0 || inlineImages.length > 0
  const model = hasImages ? p.visionModel?.trim() || '' : p.model
  if (!model.trim()) throw new Error(hasImages ? '请先在设置中选择千问视觉模型' : '请先在设置中选择千问文本模型')
  const responses = nativeFile || p.apiFormat === 'responses',
   endpoint = p.baseUrl.replace(/\/$/, '') + (responses ? '/responses' : '/chat/completions')
  const parameters = p.parameters?.[model] || {}
  const controller = AbortSignal.any([AbortSignal.timeout(180000), ...(signal ? [signal] : [])])
  let routedMessages = messages.map(m => ({...m, content: Array.isArray(m.content) ? [...m.content] : m.content}))
  if (optionImages.length) {
   const index = routedMessages.map(m => m.role).lastIndexOf('user')
   if (index < 0) throw new Error('图片输入缺少用户消息')
   const current = routedMessages[index].content,
    parts: Exclude<ChatMessage['content'], string> =
     typeof current === 'string' ? [{type: 'text', text: current}] : [...current]
   for (const image of optionImages) {
    parts.push({type: 'text', text: image.label})
    parts.push({type: 'image_url', image_url: {url: image.url}})
   }
   routedMessages[index] = {...routedMessages[index], content: parts}
  }
  const input = responses
   ? {
      input: routedMessages.map(m => ({
       role: m.role,
       content:
        typeof m.content === 'string'
         ? m.content
         : m.content.map(part =>
            part.type === 'text'
             ? {type: 'input_text', text: part.text}
             : part.type === 'image_url'
               ? {type: 'input_image', image_url: part.image_url.url}
               : {type: 'input_file', filename: part.file.filename, file_data: part.file.file_data}
           )
      })),
      store: false
     }
   : {messages: routedMessages}
  const response = await this.request(endpoint, {
   method: 'POST',
   headers: {'Content-Type': 'application/json', ...(p.key ? {Authorization: `Bearer ${p.key}`} : {})},
   body: JSON.stringify({
    model,
    ...input,
    stream: !!onText,
    ...(parameters.temperature !== undefined ? {temperature: parameters.temperature} : {}),
    ...(parameters.topP !== undefined ? {top_p: parameters.topP} : {}),
    ...(parameters.maxTokens !== undefined
     ? {[responses ? 'max_output_tokens' : 'max_tokens']: parameters.maxTokens}
     : {}),
    ...(parameters.reasoningEffort
     ? responses
      ? {reasoning: {effort: parameters.reasoningEffort}}
      : {reasoning_effort: parameters.reasoningEffort}
     : {})
   }),
   signal: controller
  })
  if (!response.ok)
   throw await requestError(
    response,
    nativeFile,
    messages.some(m => Array.isArray(m.content) && m.content.some(p => p.type === 'file'))
   )
  if (onText && response.body) return readSse(response.body, onText)
  const data = (await response.json()) as {
   status?: string
   incomplete_details?: unknown
   output?: {type: string; content?: {type: string; text?: string}[]}[]
   choices?: {finish_reason?: string; message?: {content?: string | {type: string; text?: string}[]}}[]
  }
  if (data.status === 'incomplete' || data.status === 'failed' || (responses && data.status !== 'completed'))
   throw new Error('API 未完成输出，请检查输出长度限制或服务状态')
  const choice = data.choices?.[0],
   finish = choice?.finish_reason
  // 兼容未返回 finish_reason 的完整 JSON 响应。
  if (!responses && finish && finish !== 'stop')
   throw new Error(
    finish === 'length'
     ? 'API 输出达到长度限制，未保存不完整结果'
     : finish === 'content_filter'
       ? 'API 输出被内容安全过滤，未保存不完整结果'
       : 'API 未正常结束，未保存结果'
   )
  const body = choice?.message?.content,
   value = responses
    ? data.output
       ?.filter(item => item.type === 'message')
       .flatMap(item => item.content || [])
       .filter(part => part.type === 'output_text')
       .map(part => part.text || '')
       .join('')
    : Array.isArray(body)
      ? body
         .filter(part => part.type === 'text')
         .map(part => part.text || '')
         .join('')
      : body
  if (!value?.trim()) throw new Error('API 未返回有效文本')
  return value
 }
 async models(profile: Profile): Promise<string[]> {
  const p = this.settings.draft(profile)
  const response = await this.request(p.baseUrl + '/models', {
   headers: {Authorization: `Bearer ${p.key}`},
   signal: AbortSignal.timeout(30000)
  })
  if (!response.ok) throw new Error(`读取模型失败（HTTP ${response.status}），请检查地址与密钥；也可手动填写完整模型名`)
  const data = (await response.json()) as {data?: {id?: string}[]}
  const models = [
   ...new Set(
    (Array.isArray(data.data) ? data.data : [])
     .map(v => v.id)
     .filter((id): id is string => typeof id === 'string' && !!id.trim())
   )
  ]
  if (!models.length) throw new Error('服务未返回模型列表，请手动填写完整模型名')
  return models
 }
 async json<T>(
  prompt: string,
  input: unknown,
  validate: (data: unknown) => T,
  signal?: AbortSignal,
  file?: FileInput,
  options?: {images?: {label: string; url: string}[]; onRetry?: () => void; profile?: Profile}
 ): Promise<T> {
  let feedback = ''
  for (let attempt = 0; attempt < 2; attempt++) {
   const text = JSON.stringify(input) + feedback
   const content: ChatMessage['content'] = file
    ? [
       {type: 'file', file: {filename: file.filename, file_data: file.file_data}},
       {type: 'text', text}
      ]
    : text
   const raw = await this.chat(
    [
     {role: 'system', content: prompt},
     {role: 'user', content}
    ],
    undefined,
    signal,
    options?.profile,
    options
   )
   try {
    const clean = raw
     .replace(/^\s*```(?:json)?\s*/i, '')
     .replace(/\s*```\s*$/, '')
     .trim()
    return validate(JSON.parse(clean))
   } catch (error) {
    if (signal?.aborted) throw error
    if (attempt === 1) throw error
    feedback = '\n上次输出未通过格式校验。请严格返回指定结构的合法 JSON，不加说明。'
    options?.onRetry?.()
    await delay(1500, undefined, {signal})
   }
  }
  throw new Error('结构化输出失败')
 }
}
