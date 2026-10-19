import {Agent, ProxyAgent, Socks5ProxyAgent, Dispatcher1Wrapper, buildConnector, type Dispatcher} from 'undici'
import type {NativeMediaOptions} from '@main/media/core/media-options'
import {mediaTuning} from '@main/media/core/media-options'
type Fetcher = (url: string, init?: RequestInit) => Promise<Response>
export async function mediaDelay(ms: number, signal?: AbortSignal | null) {
 signal?.throwIfAborted()
 if (ms <= 0) return
 await new Promise<void>((resolve, reject) => {
  const timer = setTimeout(done, ms)
  function done() {
   signal?.removeEventListener('abort', cancel)
   resolve()
  }
  function cancel() {
   clearTimeout(timer)
   reject(new Error('下载等待已取消'))
  }
  signal?.addEventListener('abort', cancel, {once: true})
  if (signal?.aborted) cancel()
 })
}
/** Per-job connection settings and aggregate bandwidth budget, shared by concurrent ranges. */
export function createMediaTransport(base: Fetcher, options: NativeMediaOptions) {
 const tuning = mediaTuning(options.custom_args),
  seconds = typeof tuning['--socket-timeout'] === 'number' ? tuning['--socket-timeout'] : 60,
  connect = buildConnector({family: options.force_ipv4 ? 4 : undefined, timeout: seconds * 1000})
 let dispatcher: Dispatcher | undefined
 if (options.proxy) {
  const proxy = new URL(options.proxy)
  if (proxy.protocol === 'socks5:' || proxy.protocol === 'socks5h:') {
   proxy.protocol = 'socks5:'
   dispatcher = new Socks5ProxyAgent(proxy, {
    connect,
    connectTimeout: seconds * 1000,
    headersTimeout: seconds * 1000,
    bodyTimeout: seconds * 1000
   })
  } else
   dispatcher = new ProxyAgent({
    uri: proxy.href,
    proxyTls: {family: options.force_ipv4 ? 4 : undefined, timeout: seconds * 1000},
    requestTls: {timeout: seconds * 1000},
    headersTimeout: seconds * 1000,
    bodyTimeout: seconds * 1000
   })
 } else if (options.force_ipv4 || tuning['--socket-timeout'])
  dispatcher = new Agent({connect, headersTimeout: seconds * 1000, bodyTimeout: seconds * 1000})
 const nativeDispatcher = dispatcher ? new Dispatcher1Wrapper(dispatcher) : undefined
 let scheduled = 0,
  lastRequest = Number.NEGATIVE_INFINITY
 const fetcher: Fetcher = async (url, init = {}) => {
  const interval = Number(tuning['--sleep-requests'] || 0) * 1000,
   now = performance.now(),
   next = Math.max(now, lastRequest + interval)
  lastRequest = next
  await mediaDelay(next - now, init.signal)
  const response = await base(url, {
   ...init,
   ...(nativeDispatcher ? {dispatcher: nativeDispatcher} : {})
  } as RequestInit)
  if (!options.rate_kbps || !response.body) return response
  const reader = response.body.getReader(),
   signal = init.signal
  const body = new ReadableStream<Uint8Array>({
   async pull(controller) {
    try {
     signal?.throwIfAborted()
     const chunk = await reader.read()
     if (chunk.done) {
      controller.close()
      return
     }
     const now = performance.now()
     scheduled = Math.max(now, scheduled) + (chunk.value.byteLength / (options.rate_kbps * 1024)) * 1000
     await mediaDelay(scheduled - now, signal)
     controller.enqueue(chunk.value)
    } catch (error) {
     await reader.cancel().catch(() => {})
     controller.error(error)
    }
   },
   async cancel() {
    await reader.cancel().catch(() => {})
   }
  })
  return new Response(body, {status: response.status, statusText: response.statusText, headers: response.headers})
 }
 return {
  fetcher,
  async close() {
   if (dispatcher) await dispatcher.destroy()
  }
 }
}
