// Read-only WCDB primitives adapted from fanyuantaier/wechatauto-replica,
// Apache-2.0, commit 62503d76a0db069171cb4e42e87090ad285db489.
import {createHmac, pbkdf2Sync, timingSafeEqual} from 'node:crypto'
export function verifyWeixinKey(key: Buffer, page: Buffer) {
 if (![32, 48].includes(key.length) || page.length !== 4096) return false
 const salt = key.length === 48 ? key.subarray(32) : page.subarray(0, 16),
  macSalt = Buffer.from(salt.map(value => value ^ 58)),
  macKey = pbkdf2Sync(key.subarray(0, 32), macSalt, 2, 32, 'sha512')
 try {
  const number = Buffer.alloc(4)
  number.writeUInt32LE(1)
  const actual = createHmac('sha512', macKey).update(page.subarray(16, 4032)).update(number).digest()
  return timingSafeEqual(actual, page.subarray(4032))
 } finally {
  macKey.fill(0)
 }
}
export type WeixinMemory = {
 read: (address: number, length: number) => Buffer | undefined
 find: (needle: Buffer) => number[]
 module: {base: number; size: number}
 guard: () => void
}
function pointer(data: Buffer, offset = 0) {
 const value = data.readBigUInt64LE(offset)
 return value >= 65536n && value < 140737488355328n ? Number(value) : 0
}
export function readWeixinIdentity(memory: WeixinMemory) {
 const {base, size} = memory.module
 if (!base || size <= 0 || size >= 268435456) return ''
 let position = -1
 for (let offset = Math.floor((size - 1) / 1048576) * 1048576; offset >= 0 && position < 0; offset -= 1048576) {
  memory.guard()
  const image = memory.read(base + offset, Math.min(1048608, size - offset))
  if (!image) continue
  for (let i = Math.floor(Math.min(1048576, image.length - 16) / 8) * 8; i >= 16; i -= 8) {
   if (i % 8192 === 0) memory.guard()
   if (
    image.readUInt32LE(i) === 13 &&
    (image.readUInt32LE(i + 8) | 15) === 15 &&
    image.subarray(i - 16, i - 3).equals(Buffer.from('global_config'))
   ) {
    position = offset + i
    break
   }
  }
 }
 if (position < 0) return ''
 const first = memory.read(base + position - 312, 8)
 if (!first) return ''
 const p1 = pointer(first)
 if (!p1) return ''
 const second = memory.read(p1 + 104, 8)
 if (!second) return ''
 const cfg = pointer(second)
 if (!cfg) return ''
 const layout = memory.read(cfg + 72, 32)
 if (!layout) return ''
 const length = Number(layout.readBigUInt64LE(16))
 if (!Number.isSafeInteger(length) || length < 1 || length > 200) return ''
 const bytes = length <= 15 ? layout.subarray(0, length) : memory.read(pointer(layout), length)
 return bytes?.length === length ? new TextDecoder('utf-8', {fatal: true}).decode(bytes) : ''
}
export function scanWeixinKeys(memory: WeixinMemory, pages: Map<string, Buffer>) {
 const marker = Buffer.from('com.Tencent.WCDB.Config.Cipher'),
  mask = Buffer.from('d2c7442458020000004889442450488b450048844c2448488944254048584c24', 'hex'),
  needles = memory.find(marker),
  keys = new Map<string, Buffer>(),
  tested = new Set<string>()
 try {
  for (const needle of needles) {
   const pair = Buffer.alloc(16)
   pair.writeBigUInt64LE(BigInt(needle))
   pair.writeBigUInt64LE(BigInt(marker.length), 8)
   for (const at of memory.find(pair)) {
    memory.guard()
    const node = memory.read(at - 16, 80)
    if (
     !node ||
     node.length < 64 ||
     !needles.includes(pointer(node, 16)) ||
     Number(node.readBigUInt64LE(24)) !== marker.length
    )
     continue
    const config = pointer(node, 40)
    if (!config) continue
    const obj = memory.read(config + 136, 40)
    if (!obj) continue
    const location = pointer(obj, 8),
     length = Number(obj.readBigUInt64LE(16))
    if (!location || length <= 0 || length > 1024) continue
    const encrypted = memory.read(location, length)
    if (!encrypted || encrypted.length !== length) continue
    const decoded = Buffer.from(encrypted.map((value, index) => value ^ mask[index % mask.length]))
    try {
     for (const match of decoded.toString('latin1').matchAll(/[xX]'([0-9a-fA-F]{64,192})'/g)) {
      const run = match[1],
       starts = [
        0,
        ...(run.length > 96 ? Array.from({length: Math.floor((run.length - 64) / 32) + 1}, (_, i) => i * 32) : []),
        ...(run.length > 96 ? [run.length - 64] : [])
       ]
      for (const start of new Set(starts)) {
       memory.guard()
       const candidate = Buffer.from(run.slice(start, start + 64), 'hex')
       if (candidate.length !== 32 || new Set(candidate).size < 15 || tested.has(candidate.toString('hex'))) {
        candidate.fill(0)
        continue
       }
       tested.add(candidate.toString('hex'))
       if (tested.size > 4096) throw new Error('微信密钥核验达到预算')
       const choices = [
        candidate,
        ...(start + 96 <= run.length
         ? [Buffer.concat([candidate, Buffer.from(run.slice(start + 64, start + 96), 'hex')])]
         : [])
       ]
       try {
        for (const choice of choices)
         for (const [path, page] of pages) {
          if (!keys.has(path) && verifyWeixinKey(choice, page)) keys.set(path, Buffer.from(choice))
         }
       } finally {
        for (const choice of choices) choice.fill(0)
       }
      }
     }
    } finally {
     decoded.fill(0)
     encrypted.fill(0)
    }
    if (keys.size === pages.size) return keys
   }
  }
  return keys
 } catch (error) {
  for (const key of keys.values()) key.fill(0)
  throw error
 }
}
