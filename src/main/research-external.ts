import {createHash} from 'node:crypto'
import {decodeHTML} from 'entities'
import {SaxesParser} from 'saxes'
import {z} from 'zod'
import {boundedPublicText, publicHttpResponse, publicHttps} from './public-http'
export type ExternalEvidence = {
 provider: 'crossref' | 'semantic' | 'arxiv' | 'web'
 title: string
 url: string
 text: string
 scope: 'metadata' | 'abstract' | 'search_snippet' | 'web_excerpt' | 'pdf_page'
 obtainedAt: string
 sha256: string
 page?: number
 totalPages?: number
 truncated?: boolean
 responseSha256?: string
}
export function externalEvidenceText(source: ExternalEvidence) {
 return '读取范围：' + source.scope + '；仅为 ' + source.obtainedAt + ' 获取的快照，不表示已读全文。\n' + source.text
}
type Exchange = typeof publicHttpResponse
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
function plain(input: string) {
 return decodeHTML(input.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ').replace(/<[^>]*>/g, ' '))
  .replace(/\s+/g, ' ')
  .trim()
}
function evidence(
 provider: ExternalEvidence['provider'],
 title: string,
 url: string,
 text: string,
 scope: ExternalEvidence['scope']
): ExternalEvidence {
 publicHttps(url)
 title = plain(title).slice(0, 300)
 text = plain(text).slice(0, 6000)
 if (!title) throw new Error('外部检索返回空标题')
 const value = {provider, title, url, text, scope, obtainedAt: new Date().toISOString()}
 return {...value, sha256: hash(value)}
}
/** Opt-in, bounded public queries. Saved search snippets and abstracts never imply full-paper reading. */
export class NativeResearchExternal {
 constructor(private exchange: Exchange = publicHttpResponse) {}
 private async get(url: string, signal: AbortSignal) {
  const result = await this.exchange(url, {
   signal,
   headers: {
    Accept: 'application/json, application/atom+xml, text/html;q=0.8',
    'User-Agent': 'Meijiang-NativeResearch/1.0'
   }
  })
  try {
   if (!result.response.ok)
    throw new Error(
     result.response.status === 429 ? '检索服务限流，请稍后手动重试' : '检索服务返回 ' + result.response.status
    )
   return await boundedPublicText(result.response, 1048576)
  } finally {
   await result.close()
  }
 }
 async search(channels: string[], question: string, web: unknown, signal: AbortSignal) {
  z.string().trim().min(1).max(1500).parse(question)
  const query = question.trim().slice(0, 200),
   rows: ExternalEvidence[] = []
  for (const channel of channels) {
   signal.throwIfAborted()
   if (channel === 'crossref') {
    const url = new URL('https://api.crossref.org/works')
    url.search = new URLSearchParams({query, rows: '4'}).toString()
    const value = z
     .object({
      status: z.literal('ok'),
      message: z.object({
       items: z.array(
        z
         .object({
          DOI: z
           .string()
           .regex(/^10\.[0-9]{4,9}\/[^\s]+$/)
           .max(256),
          title: z.array(z.string()).min(1),
          abstract: z.string().nullish(),
          author: z
           .array(z.object({given: z.string().optional(), family: z.string().optional(), name: z.string().optional()}))
           .optional()
         })
         .passthrough()
       )
      })
     })
     .parse(JSON.parse(await this.get(url.href, signal)))
    for (const item of value.message.items.slice(0, 4)) {
     const authors =
      item.author
       ?.slice(0, 8)
       .map(author => author.name || [author.given, author.family].filter(Boolean).join(' '))
       .join(', ') || ''
     rows.push(
      evidence(
       'crossref',
       item.title[0],
       'https://doi.org/' + encodeURI(item.DOI.toLowerCase()),
       '作者：' + authors + '\n' + (item.abstract || '仅取得题录，无可用摘要。'),
       item.abstract ? 'abstract' : 'metadata'
      )
     )
    }
   }
   if (channel === 'semantic') {
    const url = new URL('https://api.semanticscholar.org/graph/v1/paper/search')
    url.search = new URLSearchParams({query, limit: '4', fields: 'title,abstract,authors,year,externalIds'}).toString()
    const value = z
     .object({
      data: z.array(
       z.object({
        paperId: z.string().regex(/^[a-f0-9]{40}$/i),
        title: z.string(),
        abstract: z.string().nullish(),
        year: z.number().int().nullish(),
        authors: z.array(z.object({name: z.string()})).optional()
       })
      )
     })
     .parse(JSON.parse(await this.get(url.href, signal)))
    for (const item of value.data.slice(0, 4))
     rows.push(
      evidence(
       'semantic',
       item.title,
       'https://www.semanticscholar.org/paper/' + item.paperId,
       '年份：' +
        (item.year || '未知') +
        ' 作者：' +
        (item.authors || [])
         .slice(0, 8)
         .map(author => author.name)
         .join(', ') +
        '\n' +
        (item.abstract || '仅取得题录，无可用摘要。'),
       item.abstract ? 'abstract' : 'metadata'
      )
     )
   }
   if (channel === 'arxiv') {
    const exact = /(?:arxiv\.org\/(?:abs|pdf)\/)?(\d{4}\.\d{4,5}(?:v\d+)?)\b/i.exec(query)
    const url = new URL('https://export.arxiv.org/api/query')
    url.search = new URLSearchParams({
     ...(exact ? {id_list: exact[1]} : {search_query: 'all:' + query}),
     start: '0',
     max_results: '4'
    }).toString()
    rows.push(...this.parseArxiv(await this.get(url.href, signal)))
   }
   if (channel === 'web') {
    const options = z
     .discriminatedUnion('provider', [
      z.object({provider: z.literal('duckduckgo')}),
      z.object({provider: z.literal('searxng'), endpoint: z.string().min(1)})
     ])
     .parse(web || {provider: 'duckduckgo'})
    if (options.provider === 'searxng') {
     const base = publicHttps(options.endpoint)
     if (base.search) throw new Error('搜索实例地址不应带查询参数')
     base.pathname = base.pathname.replace(/\/?$/, '/') + 'search'
     base.search = new URLSearchParams({q: query, format: 'json'}).toString()
     const value = z
      .object({results: z.array(z.object({title: z.string(), url: z.string(), content: z.string().default('')}))})
      .parse(JSON.parse(await this.get(base.href, signal)))
     for (const item of value.results.slice(0, 4))
      rows.push(evidence('web', item.title, item.url, item.content, 'search_snippet'))
    } else {
     const url = new URL('https://html.duckduckgo.com/html/')
     url.search = new URLSearchParams({q: query}).toString()
     const html = await this.get(url.href, signal)
     if (/anomaly-modal|bots use DuckDuckGo|challenge-form/i.test(html))
      throw new Error('搜索服务要求人工验证，本次没有取得网页来源')
     const matches = [
      ...html.matchAll(
       /<a\b(?=[^>]*class=["'][^"']*\bresult__a\b[^"']*["'])[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
      )
     ].slice(0, 4)
     for (const match of matches) {
      const redirect = new URL(decodeHTML(match[1]), url),
       target = redirect.hostname.endsWith('duckduckgo.com') ? redirect.searchParams.get('uddg') : redirect.href
      if (!target) continue
      const tail = html.slice(match.index! + match[0].length, match.index! + match[0].length + 16000),
       snippet =
        /<(?:a|div)\b[^>]*class=["'][^"']*\bresult__snippet\b[^"']*["'][^>]*>([\s\S]*?)<\/(?:a|div)>/i.exec(
         tail
        )?.[1] || ''
      try {
       rows.push(evidence('web', match[2], target, snippet, 'search_snippet'))
      } catch {}
     }
    }
   }
  }
  const seen = new Set<string>()
  return rows
   .filter(row => {
    if (seen.has(row.url)) return false
    seen.add(row.url)
    return true
   })
   .slice(0, 12)
 }
 parseArxiv(xml: string) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('论文响应包含不支持的声明')
  const parser = new SaxesParser({xmlns: false}),
   rows: ExternalEvidence[] = [],
   path: string[] = []
  let entry: Record<string, string> | undefined
  parser.on('opentag', tag => {
   path.push(tag.name)
   if (tag.name === 'entry') entry = {}
  })
  parser.on('text', text => {
   const key = path.at(-1)
   if (entry && key && ['id', 'title', 'summary'].includes(key)) entry[key] = (entry[key] || '') + text
  })
  parser.on('closetag', tag => {
   if (tag.name === 'entry' && entry) {
    const url = new URL(entry.id)
    if (
     !['arxiv.org', 'export.arxiv.org'].includes(url.hostname) ||
     !/^\/abs\/(?:\d{4}\.\d{4,5}|[a-z-]+\/\d{7})(?:v\d+)?$/.test(url.pathname)
    )
     throw new Error('论文版本地址无效')
    url.protocol = 'https:'
    url.hostname = 'arxiv.org'
    rows.push(
     evidence('arxiv', entry.title, url.href, entry.summary || '无可用摘要', entry.summary ? 'abstract' : 'metadata')
    )
    entry = undefined
   }
   path.pop()
  })
  parser.write(xml).close()
  return rows.slice(0, 4)
 }
 verify(rows: ExternalEvidence[]) {
  for (const row of rows) {
   const {sha256, ...value} = row
   publicHttps(row.url)
   if (hash(value) !== sha256) throw new Error('外部来源快照校验失败')
  }
 }
}
