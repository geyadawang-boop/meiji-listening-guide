import {readFile, lstat, realpath, unlink} from 'node:fs/promises'
import {extname, resolve} from 'node:path'
import {createHash} from 'node:crypto'

export const fileHash = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex')
export function verifyGeneratedPdf(data: Buffer, expectedPages: number) {
 const text = data.toString('latin1'),
  end = /startxref\n(\d+)\n%%EOF\n$/.exec(text)
 if (!data.subarray(0, 8).toString().startsWith('%PDF-') || !end) throw new Error('PDF 完整性检查失败，PPT 已保留')
 const xref = text.slice(Number(end[1])),
  table = /^xref\n0 (\d+)\n([\s\S]+?)trailer\n/.exec(xref)
 if (!table) throw new Error('PDF 索引检查失败，PPT 已保留')
 const lines = table[2].trimEnd().split('\n')
 if (lines.length !== Number(table[1])) throw new Error('PDF 索引不完整，PPT 已保留')
 let pages = 0
 for (let i = 1; i < lines.length; i++) {
  const row = /^(\d{10}) \d{5} n(?: |$)/.exec(lines[i])
  if (!row || !text.startsWith(`${i} 0 obj\n`, Number(row[1]))) throw new Error('PDF 对象检查失败，PPT 已保留')
  if (text.startsWith('<< /Type /Page /Parent ', Number(row[1]) + `${i} 0 obj\n`.length)) pages++
 }
 if (pages !== expectedPages || pages < 1) throw new Error('PDF 页数检查失败，PPT 已保留')
}

export async function deleteConvertedPpt(
 source: string,
 sourceHash: string,
 pdf: string,
 expectedPdf: Buffer,
 pages: number,
 replaceReferences: () => void
) {
 if (!['.ppt', '.pptx'].includes(extname(source).toLowerCase()) || resolve(source) === resolve(pdf))
  throw new Error('PPT 清理路径无效')
 const actualPdf = await readFile(pdf)
 if (!actualPdf.equals(expectedPdf)) throw new Error('PDF 保存检查失败，PPT 已保留')
 verifyGeneratedPdf(actualPdf, pages)
 const info = await lstat(source)
 if (info.isSymbolicLink() || !info.isFile() || resolve(await realpath(source)) !== resolve(source))
  throw new Error('PPT 是链接或路径已改变，已保留')
 if (fileHash(await readFile(source)) !== sourceHash) throw new Error('PPT 在分析后发生变化，已保留')
 // Persist associations before deleting the exact analyzed file. Never scan by
 // filename prefix or delete unrelated course files.
 replaceReferences()
 await unlink(source)
}
