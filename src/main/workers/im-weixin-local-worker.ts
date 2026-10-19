import {randomUUID} from 'node:crypto'
import {z} from 'zod'
import {weixinProcesses, WeixinProcessMemory} from '@main/im/weixin/im-weixin-process'
import {NativeWeixinReader} from '@main/im/weixin/im-weixin-database'
const readers = new Map<string, NativeWeixinReader>(),
 probes = new Map<string, {connection: string; revision: string; reader: NativeWeixinReader; expires: number}>()
const capabilities = {
 directory: true,
 receive: true,
 draft: true,
 send: false,
 images: false,
 automation: false,
 receive_mode: 'selected_peer_sequence',
 background_read: true
}
function expire() {
 for (const [id, probe] of probes)
  if (Date.now() > probe.expires) {
   probe.reader.close()
   probes.delete(id)
  }
}
function release() {
 for (const reader of readers.values()) reader.close()
 readers.clear()
 for (const probe of probes.values()) probe.reader.close()
 probes.clear()
}
const expiry = setInterval(expire, 10000)
expiry.unref()
process.on('disconnect', () => {
 release()
 process.exit(0)
})
process.on('message', (message: unknown) => {
 let requestId = 0
 try {
  const request = z
   .object({
    id: z.number().int().positive(),
    action: z.enum(['processes', 'probe', 'confirm', 'invalidate', 'verify', 'directory', 'receive', 'shutdown']),
    input: z.record(z.string(), z.unknown())
   })
   .parse(message)
  requestId = request.id
  expire()
  const input = request.input
  let result: unknown
  if (request.action === 'shutdown') {
   release()
   result = {closed: true}
  } else if (request.action === 'processes') result = weixinProcesses()
  else if (request.action === 'probe') {
   if (probes.size >= 4) throw new Error('待确认微信读取绑定已达到上限')
   const value = z
     .object({
      connection_id: z.string(),
      revision: z.string(),
      pid: z.number().int().positive(),
      created: z.number().finite()
     })
     .parse(input),
    reader = new NativeWeixinReader(new WeixinProcessMemory(value.pid, value.created)),
    token = randomUUID().replaceAll('-', '')
   probes.set(token, {connection: value.connection_id, revision: value.revision, reader, expires: Date.now() + 120000})
   result = {
    probe_id: token,
    account: reader.account,
    capabilities,
    state: 'local_read_ready',
    network_online: null,
    expires_in: 120
   }
  } else if (request.action === 'confirm') {
   const value = z
     .object({
      connection_id: z.string(),
      revision: z.string(),
      probe_id: z.string(),
      account: z.string(),
      user_confirmed: z.literal(true)
     })
     .parse(input),
    probe = probes.get(value.probe_id)
   if (
    !probe ||
    probe.connection !== value.connection_id ||
    probe.revision !== value.revision ||
    probe.reader.account !== value.account
   )
    throw new Error('本机微信读取绑定已失效')
   probe.reader.verify(value.account, probe.reader.readerId)
   readers.get(value.connection_id)?.close()
   readers.set(value.connection_id, probe.reader)
   probes.delete(value.probe_id)
   result = {account: value.account, session: {reader_id: probe.reader.readerId, cursors: {}}, capabilities}
  } else if (request.action === 'invalidate') {
   const connection = z.string().parse(input.connection_id)
   readers.get(connection)?.close()
   readers.delete(connection)
   for (const [id, probe] of probes)
    if (probe.connection === connection) {
     probe.reader.close()
     probes.delete(id)
    }
   result = {invalidated: true}
  } else {
   const value = z
     .object({connection_id: z.string(), account: z.string(), session: z.object({reader_id: z.string()}).passthrough()})
     .parse(input),
    reader = readers.get(value.connection_id)
   if (!reader) throw new Error('本机微信绑定已失效，请重新选择进程核验')
   reader.verify(value.account, value.session.reader_id)
   result =
    request.action === 'verify'
     ? {verified: true}
     : request.action === 'directory'
       ? reader.directory()
       : reader.receive(z.string().parse(input.peer), value.session)
  }
  process.send?.({id: requestId, ok: true, result})
 } catch (error) {
  process.send?.({
   id: requestId,
   ok: false,
   error: error instanceof Error ? error.message.slice(0, 200) : '本机微信只读任务未完成'
  })
 }
})
