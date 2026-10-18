import {constants} from 'node:fs'
import {appendFile, copyFile, readFile, rm} from 'node:fs/promises'
import {resolve} from 'node:path'
import {PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFObject, PDFRef, PDFString} from 'pdf-lib'
import {z} from 'zod'
import {highlightSchema, type Highlight} from '@shared/study'

// Historical batch annotations used opaque IDs as well as UUIDs. Keep their
// identities stable when editing; new UI annotations still use highlightSchema.
const storedHighlightSchema = highlightSchema.extend({id: z.string().min(1).max(500)})
const requestSchema = z.discriminatedUnion('action', [
 z.object({action: z.literal('inspect'), path: z.string().min(1)}),
 z.object({
  action: z.literal('write'),
  path: z.string().min(1),
  output: z.string().min(1),
  rows: z.array(
   storedHighlightSchema.extend({
    color: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1), z.number().min(0).max(1)]),
    description: z.string()
   })
  )
 })
])
export type PdfBookInfo = {pages: number; sizes: [number, number, number][]; previous: Highlight[]}
const name = PDFName.of
function text(object: PDFObject | undefined): string {
 return object instanceof PDFString || object instanceof PDFHexString ? object.decodeText() : ''
}
function annotationList(document: PDFDocument, pageIndex: number): PDFArray | undefined {
 return document.getPage(pageIndex).node.lookupMaybe(name('Annots'), PDFArray)
}
function inspect(document: PDFDocument): PdfBookInfo {
 const previous: Highlight[] = []
 for (const [index] of document.getPages().entries()) {
  const annotations = annotationList(document, index)
  for (const ref of annotations?.asArray() ?? []) {
   const annotation = document.context.lookup(ref, PDFDict)
   if (!text(annotation.get(name('NM'))).startsWith('meijiang:')) continue
   const metadata = text(annotation.get(name('MeijiangData')))
   if (!metadata) continue
   const rect = annotation
    .lookup(name('Rect'), PDFArray)
    .asArray()
    .map(value => document.context.lookup(value, PDFNumber).asNumber())
   if (rect.length !== 4) throw new Error('教材划线坐标无法读取，原文件未修改')
   const [x, y, right, top] = rect
   previous.push(
    storedHighlightSchema.parse({...JSON.parse(metadata), page: index + 1, rect: [x, y, right - x, top - y]})
   )
  }
 }
 return {
  pages: document.getPageCount(),
  sizes: document.getPages().map(page => [page.getWidth(), page.getHeight(), page.getRotation().angle]),
  previous
 }
}

// Append only changed page dictionaries and new annotations. Original image,
// font, text and object-stream bytes remain a byte-for-byte prefix of the output.
function lastXref(original: Buffer): number {
 const ending = /startxref\s+(\d+)\s+%%EOF\s*$/.exec(
  original.subarray(Math.max(0, original.length - 4096)).toString('latin1')
 )
 if (!ending) throw new Error('教材 PDF 尾部索引不完整，原文件未修改')
 const previous = Number(ending[1])
 if (!Number.isSafeInteger(previous) || previous < 0 || previous >= original.length)
  throw new Error('教材 PDF 索引无效，原文件未修改')
 return previous
}
function incrementalUpdate(original: Buffer, document: PDFDocument, changed: Map<PDFRef, PDFObject>): Buffer {
 const previous = lastXref(original)
 const chunks: Buffer[] = [Buffer.from('\n')]
 let offset = original.length + 1
 const entries: {ref: PDFRef; offset: number}[] = []
 for (const [ref, object] of [...changed].sort(([a], [b]) => a.objectNumber - b.objectNumber)) {
  entries.push({ref, offset})
  const block = Buffer.from(`${ref.objectNumber} ${ref.generationNumber} obj\n${object.toString()}\nendobj\n`, 'ascii')
  chunks.push(block)
  offset += block.length
 }
 const xrefOffset = offset
 let xref = 'xref\n'
 for (const {ref, offset: position} of entries) {
  if (position > 9999999999) throw new Error('教材 PDF 超出增量索引支持范围')
  xref += `${ref.objectNumber} 1\n${String(position).padStart(10, '0')} ${String(ref.generationNumber).padStart(5, '0')} n \n`
 }
 // Empty selections still create a valid incremental revision.
 if (!entries.length) xref += '0 1\n0000000000 65535 f \n'
 const trailer = document.context.obj({
  Size: document.context.largestObjectNumber + 1,
  ...document.context.trailerInfo,
  Prev: previous
 })
 chunks.push(Buffer.from(`${xref}trailer\n${trailer.toString()}\nstartxref\n${xrefOffset}\n%%EOF\n`, 'ascii'))
 return Buffer.concat(chunks)
}

export async function executePdfOperation(input: unknown): Promise<PdfBookInfo | {pages: number; count: number}> {
 const request = requestSchema.parse(input)
 const original = await readFile(request.path)
 const document = await PDFDocument.load(original, {updateMetadata: false})
 const info = inspect(document)
 if (request.action === 'inspect') return info
 if (resolve(request.path).toLowerCase() === resolve(request.output).toLowerCase())
  throw new Error('请先保存至临时文件，不能直接覆盖教材')
 const changed = new Map<PDFRef, PDFObject>()
 const size = /\/Size\s+(\d+)/.exec(original.subarray(lastXref(original)).toString('latin1'))
 if (size) document.context.largestObjectNumber = Math.max(document.context.largestObjectNumber, Number(size[1]) - 1)
 for (const [index, page] of document.getPages().entries()) {
  const annotations = annotationList(document, index)
  if (!annotations) continue
  const kept = annotations
   .asArray()
   .filter(ref => !text(document.context.lookup(ref, PDFDict).get(name('NM'))).startsWith('meijiang:'))
  if (kept.length !== annotations.size()) {
   page.node.set(name('Annots'), document.context.obj(kept))
   changed.set(page.ref, page.node)
  }
 }
 for (const row of request.rows) {
  const page = document.getPages()[row.page - 1]
  const [x, y, width, height] = row.rect
  if (
   !page ||
   x < 0 ||
   y < 0 ||
   width <= 0 ||
   height <= 0 ||
   x + width > page.getWidth() + 0.1 ||
   y + height > page.getHeight() + 0.1
  )
   throw new Error('划线超出教材页面，请重新检查')
  const {color, description, ...metadata} = row
  const annotation = document.context.obj({
   Type: 'Annot',
   Subtype: 'Highlight',
   Rect: [x, y, x + width, y + height],
   QuadPoints: [x, y + height, x + width, y + height, x, y, x + width, y],
   C: color,
   CA: 0.3,
   F: 4,
   NM: PDFHexString.fromText('meijiang:' + row.id),
   T: PDFHexString.fromText('摘云'),
   Contents: PDFHexString.fromText(description),
   MeijiangData: PDFHexString.fromText(JSON.stringify(metadata))
  })
  const ref = document.context.register(annotation)
  // Clone inherited/indirect annotation arrays before editing, so another page
  // sharing an array does not receive this page's highlights.
  const annotations = document.context.obj(annotationList(document, row.page - 1)?.asArray() ?? [])
  annotations.push(ref)
  page.node.set(name('Annots'), annotations)
  changed.set(ref, annotation)
  changed.set(page.ref, page.node)
 }
 const revision = incrementalUpdate(original, document, changed)
 let created = false
 try {
  await copyFile(request.path, request.output, constants.COPYFILE_EXCL)
  created = true
  await appendFile(request.output, revision)
  const saved = await readFile(request.output)
  if (!saved.subarray(0, original.length).equals(original)) throw new Error('教材在写入时发生变化，原文件未修改')
  const verified = inspect(await PDFDocument.load(saved, {updateMetadata: false}))
  if (verified.pages !== info.pages || verified.previous.length !== request.rows.length)
   throw new Error('保存检查失败，原教材未修改')
  for (const [index, row] of request.rows.entries()) {
   if (
    !verified.previous.some(
     value =>
      value.id === row.id &&
      value.page === row.page &&
      value.rect.every((number, coordinate) => Math.abs(number - row.rect[coordinate]) < 0.00001)
    )
   )
    throw new Error(`第 ${index + 1} 项划线保存检查失败，原教材未修改`)
  }
  return {pages: verified.pages, count: info.previous.length}
 } catch (error) {
  if (created) await rm(request.output, {force: true})
  throw error
 }
}
