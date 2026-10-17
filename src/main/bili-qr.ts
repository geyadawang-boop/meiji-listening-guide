import encodeQR from 'qr'

/** Local TypeScript rendering; no Python process or remote QR service. */
export function biliQrImage(value: string): string {
 if (value.length > 2000) throw new Error('扫码地址无效')
 let url: URL
 try {
  url = new URL(value)
 } catch {
  throw new Error('扫码地址无效')
 }
 if (
  url.username ||
  url.password ||
  !['https://passport.bilibili.com', 'https://account.bilibili.com'].includes(url.origin)
 )
  throw new Error('扫码地址无效')
 return encodeQR(value, 'data-url', {border: 4, scale: 5})
}
