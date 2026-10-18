import {createHash} from 'node:crypto'
import {decodeHTML} from 'entities'
import iconv from 'iconv-lite'
import {z} from 'zod'
import {publicHttpResponse, publicHttps} from '@main/net/public-http'
import type {ExternalEvidence} from '@main/research/research-external'
export type FulltextChoice = {url: string; pages?: number[]}
export type FulltextEvidence = {
 provider: 'arxiv' | 'web'
 title: string
 url: string
 text: string
 scope: 'web_excerpt' | 'pdf_page'
 obtainedAt: string
 sha256: string
 page?: number
 totalPages?: number
 truncated: boolean
 responseSha256: string
}
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
async function bytes(response: Response, max: number, signal: AbortSignal) {
 if (!response.body) throw new Error('正文响应为空')
 if (Number(response.headers.get('content-length') || 0) > max) {
  await response.body.cancel()
  throw new Error('正文文件超过大小上限')
 }
 const reader = response.body.getReader(),
  parts: Uint8Array[] = []
 let size = 0
 try {
  while (true) {
   signal.throwIfAborted()
   const item = await reader.read()
   if (item.done) break
   size += item.value.length
   if (size > max) throw new Error('正文文件超过大小上限')
   parts.push(item.value)
  }
  return Buffer.concat(parts, size)
 } finally {
  await reader.cancel().catch(() => {})
 }
}
function decodePage(data: Buffer, contentType: string) {
 const declared =
  /charset\s*=\s*["']?([a-z0-9_-]+)/i.exec(contentType)?.[1] ||
  /<meta\b[^>]*charset\s*=\s*["']?([a-z0-9_-]+)/i.exec(data.subarray(0, 8192).toString('ascii'))?.[1] ||
  'utf8'
 if (!iconv.encodingExists(declared)) throw new Error('网页字符编码不受支持')
 return iconv.decode(data, declared)
}
export function publicPageText(html: string) {
 const title = decodeHTML(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.replace(/<[^>]*>/g, '') || '公开网页')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, 300)
 const visible = html
  .replace(/<!--([\s\S]*?)-->/g, ' ')
  .replace(/<(script|style|template|noscript|svg|iframe|nav|footer)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
 const article =
  /<(?:article|main)\b[^>]*>([\s\S]*?)<\/(?:article|main)>/i.exec(visible)?.[1] ||
  /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(visible)?.[1] ||
  visible
 const text = decodeHTML(
  article.replace(/<(?:br|\/p|\/div|\/h[1-6]|\/li|\/section)\b[^>]*>/gi, '\n').replace(/<[^>]*>/g, ' ')
 )
  .replace(/[ \t\r]+/g, ' ')
  .replace(/\n\s*\n+/g, '\n\n')
  .trim()
 if (
  !text ||
  /just a moment|verify you are human|captcha|访问验证|安全验证|请登录后查看/i.test(title + '\n' + text.slice(0, 500))
 )
  throw new Error('网页未返回可核验正文，可能要求登录或验证')
 return {title, text: text.slice(0, 12000), truncated: text.length > 12000}
}
/** Exact URLs selected by the user. No automatic publisher browsing or full-document claims. */
export class NativeResearchFulltext {
 constructor(private exchange: typeof publicHttpResponse = publicHttpResponse) {}
 async read(channels: string[], choices: unknown, signal: AbortSignal) {
  const selected = z
   .array(
    z
     .object({url: z.string().max(2000), pages: z.array(z.number().int().min(1).max(64)).min(1).max(4).optional()})
     .strict()
   )
   .max(4)
   .parse(choices || [])
  if (new Set(selected.map(row => row.url)).size !== selected.length) throw new Error('正文网址重复，请合并所选页码')
  const rows: FulltextEvidence[] = []
  let pdfCount = 0
  for (const choice of selected) {
   signal.throwIfAborted()
   const url = publicHttps(choice.url),
    arxiv = url.hostname === 'arxiv.org' && /^\/(?:abs|pdf)\/(?:\d{4}\.\d{4,5}|[a-z-]+\/\d{7})v\d+$/.test(url.pathname)
   if (arxiv) {
    if (!channels.includes('arxiv_fulltext') || !channels.includes('arxiv'))
     throw new Error('arXiv 正文需同时勾选 arXiv 及正文渠道')
    if (!choice.pages || new Set(choice.pages).size !== choice.pages.length || ++pdfCount > 2 || url.search)
     throw new Error('每次最多两篇固定版本论文，每篇明确选择至多四个物理页')
    const target = 'https://arxiv.org/pdf/' + url.pathname.replace(/^\/(?:abs|pdf)\//, ''),
     result = await this.exchange(target, {signal, headers: {Accept: 'application/pdf'}})
    let data: Buffer
    try {
     if (!result.response.ok) throw new Error('论文正文请求未成功')
     data = await bytes(result.response, 8 * 1024 * 1024, signal)
     if (!data.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new Error('论文接口未返回 PDF')
    } finally {
     await result.close()
    }
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs'),
     task = pdfjs.getDocument({data: new Uint8Array(data), useSystemFonts: true, disableFontFace: true}),
     abort = () => {
      void task.destroy().catch(() => {})
     }
    signal.addEventListener('abort', abort, {once: true})
    try {
     signal.throwIfAborted()
     const pdf = await task.promise
     if (pdf.numPages > 64 || choice.pages.some(page => page > pdf.numPages))
      throw new Error('论文页数超出预算或所选物理页不存在')
     for (const page of choice.pages) {
      signal.throwIfAborted()
      const content = await (await pdf.getPage(page)).getTextContent(),
       text = content.items
        .map(item => ('str' in item ? item.str + ('hasEOL' in item && item.hasEOL ? '\n' : ' ') : ''))
        .join('')
        .trim()
      if (!text) throw new Error('所选论文页未取得文字，当前不会自动OCR或宣称读完')
      const value = {
       provider: 'arxiv' as const,
       title: url.pathname.split('/').at(-1)! + ' · 第' + page + '页',
       url: target,
       text: text.slice(0, 12000),
       scope: 'pdf_page' as const,
       obtainedAt: new Date().toISOString(),
       page,
       totalPages: pdf.numPages,
       truncated: text.length > 12000,
       responseSha256: createHash('sha256').update(data).digest('hex')
      }
      rows.push({...value, sha256: hash(value)})
     }
    } finally {
     signal.removeEventListener('abort', abort)
     await task.destroy()
    }
   } else {
    if (!channels.includes('web_pages') || !channels.includes('web') || choice.pages)
     throw new Error('公开网页正文需同时勾选网页搜索与正文渠道，且不设置PDF页码')
    const result = await this.exchange(url.href, {signal, headers: {Accept: 'text/html, text/plain;q=0.8'}})
    try {
     if (!result.response.ok) throw new Error('网页正文请求未成功')
     const contentType = result.response.headers.get('content-type') || ''
     if (!/^(?:text\/html|application\/xhtml\+xml|text\/plain)(?:;|$)/i.test(contentType))
      throw new Error('所选网址不是公开文字网页')
     const data = await bytes(result.response, 2 * 1024 * 1024, signal),
      decoded = decodePage(data, contentType),
      parsed = contentType.startsWith('text/plain')
       ? {title: url.hostname, text: decoded.slice(0, 12000), truncated: decoded.length > 12000}
       : publicPageText(decoded)
     if (!parsed.text.trim()) throw new Error('正文为空')
     const value = {
      provider: 'web' as const,
      ...parsed,
      url: url.href,
      scope: 'web_excerpt' as const,
      obtainedAt: new Date().toISOString(),
      responseSha256: createHash('sha256').update(data).digest('hex')
     }
     rows.push({...value, sha256: hash(value)})
    } finally {
     await result.close()
    }
   }
  }
  return rows
 }
 verify(rows: (ExternalEvidence | FulltextEvidence)[]) {
  for (const row of rows) {
   const {sha256, ...value} = row
   publicHttps(row.url)
   if (hash(value) !== sha256) throw new Error('正文快照内容与回执不符')
  }
 }
}
