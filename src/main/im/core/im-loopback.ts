import {boundedPublicText} from '@main/net/public-http'
export function imLoopback(input: string) {
 const url = new URL(input)
 if (
  url.protocol !== 'http:' ||
  url.hostname !== '127.0.0.1' ||
  !url.port ||
  url.username ||
  url.password ||
  url.search ||
  url.hash ||
  !['', '/'].includes(url.pathname)
 )
  throw new Error('通讯组件只接受本机 127.0.0.1 端口')
 return url.origin
}
export async function imLocalJson(
 base: string,
 path: string,
 body: unknown,
 token: string,
 signal: AbortSignal,
 fetcher: typeof fetch = fetch
) {
 const origin = imLoopback(base)
 if (!/^\/[A-Za-z0-9_/-]+$/.test(path) || path.includes('..')) throw new Error('通讯操作路径无效')
 const response = await fetcher(origin + path, {
  method: 'POST',
  headers: {'content-type': 'application/json', ...(token ? {Authorization: 'Bearer ' + token} : {})},
  body: JSON.stringify(body),
  redirect: 'error',
  credentials: 'omit',
  signal: AbortSignal.any([signal, AbortSignal.timeout(15000)])
 })
 if (!response.ok) throw new Error('本机通讯组件未确认请求：' + response.status)
 return JSON.parse(await boundedPublicText(response, 2 * 1024 * 1024)) as unknown
}
