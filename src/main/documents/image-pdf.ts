import {deflate} from 'node:zlib'
import {promisify} from 'node:util'

const compress = promisify(deflate)
type Picture = {getSize(): {width: number; height: number}; toBitmap(): Buffer}

// Lossless full-page RGB images. PDF allows each page to have its own canvas.
// Decode and compress one page at a time; no Office app or PDF rasterization.
export async function imagePdf(images: Array<() => Picture>, signal?: AbortSignal): Promise<Buffer> {
 if (!images.length) throw new Error('没有可导出的页面')
 const chunks: Buffer[] = [Buffer.from('%PDF-1.7\n%\xE2\xE3\xCF\xD3\n', 'latin1')],
  offsets: number[] = [0]
 let length = chunks[0].length
 const append = (data: Buffer) => {
  chunks.push(data)
  length += data.length
 }
 const object = (id: number, data: Buffer | string) => {
  offsets[id] = length
  append(Buffer.from(`${id} 0 obj\n`))
  append(typeof data === 'string' ? Buffer.from(data) : data)
  append(Buffer.from('\nendobj\n'))
 }
 const stream = (dictionary: string, data: Buffer) =>
  Buffer.concat([Buffer.from(`<< ${dictionary} /Length ${data.length} >>\nstream\n`), data, Buffer.from('\nendstream')])
 object(1, '<< /Type /Catalog /Pages 2 0 R >>')
 object(2, `<< /Type /Pages /Count ${images.length} /Kids [${images.map((_, i) => `${3 + i * 3} 0 R`).join(' ')}] >>`)
 for (const [i, load] of images.entries()) {
  signal?.throwIfAborted()
  const image = load(),
   {width, height} = image.getSize(),
   bitmap = image.toBitmap()
  if (width < 1 || height < 1 || bitmap.length !== width * height * 4) throw new Error('图片像素数据无效')
  const rgb = Buffer.allocUnsafe(width * height * 3)
  for (let pixel = 0; pixel < width * height; pixel++) {
   const a = bitmap[pixel * 4 + 3] / 255
   // Electron's Windows BGRA channels are already premultiplied by alpha.
   for (let channel = 0; channel < 3; channel++)
    rgb[pixel * 3 + channel] = Math.min(255, Math.round(bitmap[pixel * 4 + 2 - channel] + 255 * (1 - a)))
  }
  const encoded = await compress(rgb)
  signal?.throwIfAborted()
  const page = 3 + i * 3,
   picture = page + 1,
   content = page + 2
  object(
   page,
   `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /XObject << /Im ${picture} 0 R >> >> /Contents ${content} 0 R >>`
  )
  object(
   picture,
   stream(
    `/Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode`,
    encoded
   )
  )
  object(content, stream('', Buffer.from(`q\n${width} 0 0 ${height} 0 0 cm\n/Im Do\nQ\n`)))
 }
 const xref = length,
  count = 3 + images.length * 3
 append(
  Buffer.from(
   `xref\n0 ${count}\n0000000000 65535 f \n` +
    Array.from({length: count - 1}, (_, i) => `${String(offsets[i + 1]).padStart(10, '0')} 00000 n \n`).join('') +
    `trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  )
 )
 signal?.throwIfAborted()
 return Buffer.concat(chunks)
}
