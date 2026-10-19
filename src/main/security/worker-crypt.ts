import {z} from 'zod'
import {BACKEND_PROTOCOL} from '@shared/backend-protocol'

export type MediaCrypt = (raw: Buffer, decrypt?: boolean) => Buffer | Promise<Buffer>
const limit = 16 * 1024 * 1024
const encoded = z
 .string()
 .min(4)
 .max(Math.ceil(limit / 3) * 4)
export const mediaCryptRequest = z
 .object({
  protocol: z.literal(BACKEND_PROTOCOL),
  kind: z.literal('crypt'),
  key: z.number().int().positive().safe(),
  decrypt: z.boolean(),
  data: encoded
 })
 .strict()
const reply = z
 .object({
  kind: z.literal('crypt-result'),
  key: z.number().int().positive().safe(),
  ok: z.boolean(),
  data: encoded.optional(),
  error: z.string().max(1000).optional()
 })
 .strict()
export function decodeMediaCrypt(value: string) {
 const data = Buffer.from(encoded.parse(value), 'base64')
 if (!data.length || data.length > limit || data.toString('base64') !== value) throw new Error('加密消息内容无效')
 return data
}
/** Byte-only channel to this utility process's parent; never grants filesystem access. */
export class MediaEncryptionClient {
 private sequence = 0
 private closed = false
 private pending = new Map<
  number,
  {resolve: (data: Buffer) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout>}
 >()
 constructor(private send: (message: unknown) => void) {}
 readonly protect: MediaCrypt = (raw, decrypt = false) => {
  if (this.closed || this.pending.size >= 4 || !raw.length || raw.length > limit)
   return Promise.reject(new Error('加密通道已关闭或请求超过限制'))
  const key = ++this.sequence
  return new Promise<Buffer>((resolve, reject) => {
   const timer = setTimeout(() => {
    this.pending.delete(key)
    reject(new Error('系统加密请求超时，未写入凭据'))
   }, 30000)
   this.pending.set(key, {resolve, reject, timer})
   try {
    this.send({protocol: BACKEND_PROTOCOL, kind: 'crypt', key, decrypt, data: raw.toString('base64')})
   } catch (error) {
    clearTimeout(timer)
    this.pending.delete(key)
    reject(error instanceof Error ? error : new Error('系统加密通道不可用'))
   }
  })
 }
 receive(raw: unknown) {
  const message = reply.parse(raw),
   item = this.pending.get(message.key)
  if (!item) return
  this.pending.delete(message.key)
  clearTimeout(item.timer)
  try {
   if (!message.ok || !message.data) throw new Error(message.error || '系统加密未完成')
   item.resolve(decodeMediaCrypt(message.data))
  } catch (error) {
   item.reject(error instanceof Error ? error : new Error('系统加密结果无效'))
  }
 }
 close() {
  this.closed = true
  for (const item of this.pending.values()) {
   clearTimeout(item.timer)
   item.reject(new Error('系统加密通道已关闭'))
  }
  this.pending.clear()
 }
}
