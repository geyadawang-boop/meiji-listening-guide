export function bilibiliUrl(value: string) {
 const u = new URL(value.trim())
 if (
  u.protocol !== 'https:' ||
  !['www.bilibili.com', 'bilibili.com'].includes(u.hostname) ||
  !/^\/video\/(BV[\w]+|av\d+)\/?$/.test(u.pathname) ||
  u.username ||
  u.password
 )
  throw new Error('请输入完整的 B 站视频网址，例如 https://www.bilibili.com/video/BV…/?p=5')
 const p = u.searchParams.get('p')
 if (p && !/^[1-9]\d*$/.test(p)) throw new Error('视频分 P 编号无效')
 u.hash = ''
 return u.href
}
export function videoMediaUrl(value: string) {
 try {
  const u = new URL(value)
  return (
   u.protocol === 'https:' &&
   !u.username &&
   !u.password &&
   (!u.port || u.port === '443') &&
   /(^|\.)bilivideo\.com$/.test(u.hostname) &&
   /\.mp4$/i.test(u.pathname)
  )
 } catch {
  return false
 }
}
export type Region = {left: number; right: number; top: number; bottom: number}
export function checkedRegion(c: Region) {
 if (
  Object.values(c).some(n => !Number.isFinite(n) || n < 0 || n > 1) ||
  c.right - c.left < 0.1 ||
  c.bottom - c.top < 0.1
 )
  throw new Error('请框选有效的 PPT 区域')
 return c
}
// Changes are measured on the cropped slide, excluding lecturer/chat/video chrome.
// Require a stable second sample; record the first instant of the new stable page.
export class StableSlides {
 private last?: Buffer
 private pending?: {pixels: Buffer; time: number}
 private accepted?: Buffer
 times: number[] = []
 static difference(a: Buffer, b: Buffer) {
  let sum = 0
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i])
  return sum / (a.length * 255)
 }
 push(pixels: Buffer, time: number) {
  if (!this.last || StableSlides.difference(pixels, this.last) > 0.0018)
   this.pending = {pixels: Buffer.from(pixels), time}
  else if (this.pending && (!this.accepted || StableSlides.difference(this.pending.pixels, this.accepted) > 0.003)) {
   this.times.push(this.pending.time)
   this.accepted = this.pending.pixels
   this.pending = undefined
  }
  this.last = Buffer.from(pixels)
 }
}
