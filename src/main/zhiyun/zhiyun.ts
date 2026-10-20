import {randomUUID} from 'node:crypto'
import {createWriteStream} from 'node:fs'
import {rename, rm} from 'node:fs/promises'
import {Readable, Transform} from 'node:stream'
import {pipeline} from 'node:stream/promises'
import type {ZhiyunCourse, ZhiyunLesson} from '@shared/types'

type Fetch = (url: string, init?: RequestInit) => Promise<Response>
const base = 'https://onlineroom.cmc.zju.edu.cn'
const pause = (ms: number, signal: AbortSignal) =>
 new Promise<void>((resolve, reject) => {
  signal.throwIfAborted()
  const abort = () => {
   clearTimeout(timer)
   reject(new Error('已取消导出'))
  }
  const timer = setTimeout(() => {
   signal.removeEventListener('abort', abort)
   resolve()
  }, ms)
  signal.addEventListener('abort', abort, {once: true})
 })
export function zhiyunMediaUrl(value: string) {
 const url = new URL(value, base)
 if (
  !['http:', 'https:'].includes(url.protocol) ||
  !/(^|\.)cmc\.zju\.edu\.cn$/.test(url.hostname) ||
  url.username ||
  url.password
 )
  throw new Error('智云课堂返回的资源地址不受支持')
 return url.href
}
export function zhiyunLessons(rows: Record<string, unknown>[]): ZhiyunLesson[] {
 return rows
  .filter(row => /^\d+$/.test(String(row.sub_id || row.id)))
  .map(row => {
   let content: Record<string, any>
   try {
    content =
     typeof row.content === 'string'
      ? JSON.parse(row.content)
      : row.content == null
        ? {}
        : (row.content as Record<string, any>)
   } catch {
    throw new Error('智云课次播放信息损坏，请刷新课次列表后重试')
   }
   if (!content || typeof content !== 'object' || Array.isArray(content))
    throw new Error('智云课次播放信息格式异常，请刷新课次列表后重试')
   const url = content.save_playback?.contents || content.playback?.url || ''
   return {
    id: String(row.sub_id || row.id),
    title: String(row.title || row.sub_title || '未命名课次'),
    teacher: String(row.lecturer_name || ''),
    videoAvailable: !!url,
    videoUrl: url
   }
  })
  .filter(row => /^\d+$/.test(row.id))
}
export class Zhiyun {
 constructor(
  private fetch: Fetch,
  private progress: (message: string) => void
 ) {}
 private async request(url: string, init: RequestInit = {}) {
  for (let attempt = 0; ; attempt++) {
   try {
    return await this.fetch(url, init)
   } catch (error) {
    const transient =
     /net::ERR_(?:CONNECTION_(?:CLOSED|RESET|TIMED_OUT)|NETWORK_CHANGED|TIMED_OUT)|ECONNRESET|ETIMEDOUT|fetch failed/i.test(
      error instanceof Error ? error.message : ''
     )
    if (init.signal?.aborted || !transient || attempt >= 2) throw error
    this.progress(`智云连接暂时中断，正在重试（${attempt + 1}/2）`)
    await pause(500 * (attempt + 1), init.signal || new AbortController().signal)
   }
  }
 }
 private async json(path: string, params: Record<string, string>, signal?: AbortSignal): Promise<any> {
  const url = new URL(path, base)
  url.search = new URLSearchParams(params).toString()
  const response = await this.request(url.href, {
   signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000)
  })
  if ([401, 403].includes(response.status)) throw new Error('请先登录智云课堂，再重试')
  if (!response.ok) throw new Error(`智云课堂暂时无法访问（${response.status}）`)
  const text = await response.text()
  let data: any
  try {
   data = JSON.parse(text)
  } catch {
   if (/text\/html/i.test(response.headers.get('content-type') || '') || /^\s*</.test(text))
    throw new Error('智云课堂返回了登录页，请先登录')
   throw new Error('智云课堂响应格式异常，请稍后重试')
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('智云课堂响应格式异常，请稍后重试')
  if ([5002, 401, 403].includes(Number(data.code))) throw new Error('请先登录智云课堂，再重试')
  return data
 }
 async search(keyword: string, page: number): Promise<{courses: ZhiyunCourse[]; hasMore: boolean}> {
  const user = await this.json('/userapi/v1/infosimple', {})
  const account = user.params
  if (!account?.id || !account.account) throw new Error('请先在左侧智云登录页面完成登录，再重试搜索')
  const tenant = String(account.tenant_id || '112')
  const data = await this.json('/pptnote/v1/searchlist', {
   tenant_id: tenant,
   tenant_code: tenant,
   user_id: String(account.id),
   user_name: String(account.account),
   title: keyword,
   realname: '',
   trans: '',
   page: String(page),
   per_page: '20'
  })
  if (Number(data.code) !== 0) throw new Error('搜索失败，请在智云课堂确认登录后重试')
  const result = data.total?.list !== undefined ? data.total : data.data?.list !== undefined ? data.data : data
  const rows = result.list
  if (!Array.isArray(rows) && rows !== null) throw new Error('智云课堂搜索返回格式异常，请稍后重试')
  const courses: ZhiyunCourse[] = (rows || [])
   .filter((row: any) => /^\d+$/.test(String(row.course_id || row.id)) && row.c_type !== 'recommend')
   .map((row: any) => ({
    id: String(row.course_id || row.id),
    title: String(row.title || row.course_title || '未命名课程'),
    teacher: String(row.lecturer_name || row.realname || row.teacher || ''),
    term: String(row.term_name || row.term_names || '')
   }))
  return {courses: [...new Map(courses.map(c => [c.id, c])).values()], hasMore: page * 20 < Number(result.total || 0)}
 }
 async lessons(courseId: string): Promise<ZhiyunLesson[]> {
  const data = await this.json('/courseapi/v2/course/catalogue', {course_id: courseId, tenant_code: '112'})
  if (!data.success || data.result?.code !== 200) throw new Error('无法读取课程课次，请确认课程访问权限')
  if (!Array.isArray(data.result.data)) throw new Error('智云课次列表格式异常，请刷新后重试')
  return zhiyunLessons(data.result.data)
 }
 async resource(
  courseId: string,
  subId: string,
  kind: 'transcript' | 'ppt',
  signal: AbortSignal
 ): Promise<{url: string; filename: string}> {
  const lessons = await this.lessons(courseId),
   lesson = lessons.find(row => row.id === subId)
  if (!lesson) throw new Error('没有找到所选课次，请重新选择')
  const label = kind === 'ppt' ? 'PPT' : '语音识别原文',
   params = {type: kind === 'ppt' ? '1' : '2', sub_id: subId, get_source_url: '1'}
  let created = false
  for (let i = 0; i < 60; i++) {
   signal.throwIfAborted()
   const data = await this.json('/courseapi/v2/export/get-courseware-status', params, signal)
   if (Number(data.code) === 0 && data.data?.path_name) {
    const filename = String(data.data.file_name || lesson.title + (kind === 'ppt' ? '.pptx' : '.docx'))
    if (!(kind === 'ppt' ? /\.pptx?$/i : /\.(docx|txt|srt)$/i).test(filename))
     throw new Error('官网返回的文件格式暂不支持')
    return {url: zhiyunMediaUrl(data.data.path_name), filename}
   }
   if (![1, 200].includes(Number(data.code))) throw new Error(`本课次暂无可导出的${label}`)
   if (!created) {
    const result = await this.json(
     '/courseapi/v2/export/export-async',
     {sub_id: subId, export_type: 'courseware', type: params.type},
     signal
    )
    if (Number(result.code) !== 0) throw new Error(`智云课堂未能生成${label}`)
    created = true
   }
   this.progress(`智云课堂正在生成${label}…`)
   await pause(10000, signal)
  }
  throw new Error(`${label}生成超时，请稍后再试`)
 }
 async download(url: string, path: string, signal: AbortSignal) {
  const partial = path + '.part-' + randomUUID()
  let done = 0,
   last = 0
  try {
   const response = await this.request(zhiyunMediaUrl(url), {signal})
   if (!response.ok || !response.body) throw new Error(`资源下载失败（${response.status}）`)
   if (/text\/html|application\/json/i.test(response.headers.get('content-type') || ''))
    throw new Error('资源返回了登录页，请先登录智云课堂')
   const total = Number(response.headers.get('content-length') || 0)
   const meter = new Transform({
    transform: (chunk, _encoding, callback) => {
     done += chunk.length
     if (Date.now() - last > 500) {
      last = Date.now()
      this.progress(`已下载 ${(done / 1048576).toFixed(1)} MB${total ? ` / ${(total / 1048576).toFixed(1)} MB` : ''}`)
     }
     callback(null, chunk)
    }
   })
   await pipeline(Readable.fromWeb(response.body as any), meter, createWriteStream(partial), {signal})
   if (!done || (total && done !== total)) throw new Error('下载文件不完整，请重试')
   signal.throwIfAborted()
   await rename(partial, path)
   this.progress('导出完成')
   return path
  } catch (error) {
   await rm(partial, {force: true})
   throw error
  }
 }
}
