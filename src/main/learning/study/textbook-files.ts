import {createReadStream} from 'node:fs'
import {stat} from 'node:fs/promises'
import {createHash, randomUUID} from 'node:crypto'
import {createServer} from 'node:http'
import {executePdfOperation} from '@main/documents/pdf-annotations'
import type {Highlight} from '@shared/study'

export async function fileHash(path: string) {
 const hash = createHash('sha256')
 for await (const chunk of createReadStream(path)) hash.update(chunk)
 return hash.digest('hex')
}
export function pdfOperation<T>(request: Record<string, unknown>): Promise<T> {
 return executePdfOperation(request) as Promise<T>
}
export type BookInfo = {pages: number; sizes: [number, number, number][]; previous: Highlight[]}

// A random capability URL exposes only a selected PDF, never a filesystem path.
export class TextbookFiles {
 private files = new Map<string, string>()
 private server = createServer(async (req, res) => {
  try {
   const path = this.files.get((req.url || '').split('?')[0].slice(1))
   if (!path) {
    res.writeHead(404).end()
    return
   }
   const size = (await stat(path)).size
   res.setHeader('Access-Control-Allow-Origin', '*')
   res.setHeader('Access-Control-Expose-Headers', 'Accept-Ranges,Content-Length,Content-Range')
   res.setHeader('Accept-Ranges', 'bytes')
   res.setHeader('Content-Type', 'application/pdf')
   res.setHeader('Cache-Control', 'no-store')
   if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Headers', 'Range')
    res.writeHead(204).end()
    return
   }
   if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end()
    return
   }
   let first = 0,
    last = size - 1
   const range = req.headers.range
   if (range) {
    const match = /^bytes=(\d+)-(\d*)$/.exec(range)
    if (!match) {
     res.writeHead(416, {'Content-Range': `bytes */${size}`}).end()
     return
    }
    first = Number(match[1])
    last = match[2] ? Math.min(Number(match[2]), size - 1) : last
    if (first > last || first >= size) {
     res.writeHead(416, {'Content-Range': `bytes */${size}`}).end()
     return
    }
    res.statusCode = 206
    res.setHeader('Content-Range', `bytes ${first}-${last}/${size}`)
   }
   res.setHeader('Content-Length', last - first + 1)
   if (req.method === 'HEAD') {
    res.end()
    return
   }
   const stream = createReadStream(path, {start: first, end: last})
   res.on('close', () => stream.destroy())
   stream.on('error', () => res.destroy())
   stream.pipe(res)
  } catch {
   res.destroy()
  }
 })
 private ready: Promise<number> | null = null
 async url(path: string) {
  if (!this.ready) {
   this.ready = new Promise((resolve, reject) => {
    this.server.once('error', reject)
    this.server.listen(0, '127.0.0.1', () => {
     const address = this.server.address()
     if (address && typeof address !== 'string') resolve(address.port)
     else reject(new Error('教材预览启动失败'))
    })
    this.server.unref()
   })
  }
  const port = await this.ready,
   key = randomUUID()
  this.files.set(key, path)
  return `http://127.0.0.1:${port}/${key}`
 }
}
