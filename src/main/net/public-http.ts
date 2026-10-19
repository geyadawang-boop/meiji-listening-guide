import {lookup} from 'node:dns/promises'
import {BlockList, isIP, type LookupFunction} from 'node:net'
import {Agent, Dispatcher1Wrapper} from 'undici'
const blocked = new BlockList()
for (const [network, prefix] of [
 ['0.0.0.0', 8],
 ['10.0.0.0', 8],
 ['100.64.0.0', 10],
 ['127.0.0.0', 8],
 ['169.254.0.0', 16],
 ['172.16.0.0', 12],
 ['192.0.0.0', 24],
 ['192.0.2.0', 24],
 ['192.168.0.0', 16],
 ['198.18.0.0', 15],
 ['198.51.100.0', 24],
 ['203.0.113.0', 24],
 ['224.0.0.0', 3]
] as const)
 blocked.addSubnet(network, prefix, 'ipv4')
for (const [network, prefix] of [
 ['2001::', 32],
 ['2001:db8::', 32],
 ['2001:10::', 28],
 ['2001:20::', 28],
 ['2002::', 16],
 ['3fff::', 20]
] as const)
 blocked.addSubnet(network, prefix, 'ipv6')
export function publicAddress(address: string) {
 const family = isIP(address)
 if (family === 4) return !blocked.check(address, 'ipv4')
 return family === 6 && /^[23][0-9a-f]{3}:/i.test(address) && !blocked.check(address, 'ipv6')
}
export function publicHttps(input: string) {
 const url = new URL(input)
 if (
  url.protocol !== 'https:' ||
  url.username ||
  url.password ||
  (url.port && url.port !== '443') ||
  url.hash ||
  !url.hostname ||
  url.hostname.endsWith('.') ||
  /^(?:localhost|.*\.localhost|.*\.local)$/i.test(url.hostname) ||
  (isIP(url.hostname.replace(/^\[|\]$/g, '')) && !publicAddress(url.hostname.replace(/^\[|\]$/g, '')))
 )
  throw new Error('请使用公开 HTTPS 地址，不含账号、片段或自定义端口')
 return url
}
type Resolver = (hostname: string) => Promise<{address: string; family: number}[]>
export async function publicHttpResponse(
 input: string,
 init: RequestInit = {},
 fetcher: typeof fetch = fetch,
 resolver: Resolver = hostname => lookup(hostname, {all: true, verbatim: true})
) {
 const url = publicHttps(input),
  hostname = url.hostname.replace(/^\[|\]$/g, ''),
  addresses = isIP(hostname) ? [{address: hostname, family: isIP(hostname)}] : await resolver(hostname)
 if (!addresses.length || addresses.some(row => !publicAddress(row.address)))
  throw new Error('服务地址指向本地或保留网络，请核对公开服务地址')
 const pinned: LookupFunction = (name, options, callback) => {
  if (name !== hostname) {
   callback(new Error('服务连接主机已改变'), ' ', 4)
   return
  }
  const wanted = typeof options === 'number' ? options : options.family,
   available = addresses.filter(row => !wanted || row.family === wanted),
   all = typeof options === 'object' && options.all
  if (!available.length) {
   callback(new Error('服务没有可用的公开地址'), ' ', 4)
   return
  }
  if (all) callback(null, available)
  else callback(null, available[0].address, available[0].family)
 }
 const agent = new Agent({connect: {lookup: pinned, timeout: 15000}, headersTimeout: 20000, bodyTimeout: 20000}),
  dispatcher = new Dispatcher1Wrapper(agent)
 try {
  const response = await fetcher(url.href, {
   ...init,
   dispatcher,
   redirect: 'error',
   credentials: 'omit',
   signal: AbortSignal.any([init.signal || new AbortController().signal, AbortSignal.timeout(60000)])
  } as RequestInit)
  return {response, close: () => agent.destroy()}
 } catch (error) {
  await agent.destroy()
  throw error
 }
}
export async function boundedPublicText(response: Response, max = 262144) {
 if (!response.body) return ''
 if (Number(response.headers.get('content-length') || 0) > max) {
  await response.body.cancel()
  throw new Error('外部服务响应超过大小上限')
 }
 const reader = response.body.getReader(),
  chunks: Uint8Array[] = []
 let length = 0
 try {
  while (true) {
   const item = await reader.read()
   if (item.done) break
   length += item.value.length
   if (length > max) throw new Error('外部服务响应超过大小上限')
   chunks.push(item.value)
  }
  return Buffer.concat(chunks, length).toString('utf8')
 } finally {
  await reader.cancel().catch(() => {})
 }
}
