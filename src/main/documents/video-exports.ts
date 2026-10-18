import {BrowserWindow} from 'electron'
import {readFile, writeFile, rm} from 'node:fs/promises'
import {basename, extname} from 'node:path'
import {Document, Packer, Paragraph, TextRun} from 'docx'
import {z} from 'zod'
import {parseSrt, time} from '@shared/srt'
import {notesSvg} from '@shared/video-notes'
import {reserveFile} from '@main/library/library'

export function subtitleText(srt: string, format: 'txt' | 'md' | 'vtt') {
 const cues = parseSrt(srt)
 if (!cues.length) throw new Error('没有可导出的字幕')
 if (format === 'vtt')
  return (
   'WEBVTT\n\n' +
   cues
    .map(
     (cue, i) =>
      `${i + 1}\n${time(cue.start).replace(',', '.')} --> ${time(cue.end).replace(',', '.')}\n${cue.text.replace(/-->/g, '→')}`
    )
    .join('\n\n') +
   '\n'
  )
 return (
  (format === 'md' ? '# 视频字幕\n\n' : '') +
  cues.map(cue => `[${time(cue.start, false)}] ${cue.text}`).join(format === 'md' ? '\n\n' : '\n') +
  '\n'
 )
}
export async function saveTextExport(directory: string, title: string, srt: string, format: 'txt' | 'md' | 'vtt') {
 const text = subtitleText(srt, format),
  path = await reserveFile(directory, `${title}-字幕.${format}`)
 try {
  await writeFile(path, text, 'utf8')
  if ((await readFile(path, 'utf8')) !== text) throw new Error('字幕导出校验失败')
  return path
 } catch (error) {
  await rm(path, {force: true})
  throw error
 }
}
export async function exportVideoNotes(source: string, directory: string, format: 'docx' | 'pdf' | 'svg') {
 const text = await readFile(source, 'utf8'),
  title = basename(source, extname(source))
 const path = await reserveFile(directory, `${title}.${format}`)
 try {
  let bytes: Buffer
  if (format === 'docx') {
   const doc = new Document({
    sections: [
     {
      children: text.split('\n').map(
       line =>
        new Paragraph({
         children: [
          new TextRun({
           text: line.replace(/^#{1,3} /, '').replace(/\*\*/g, ''),
           bold: line.startsWith('#'),
           size: line.startsWith('# ') ? 32 : 22
          })
         ],
         spacing: {after: 120}
        })
      )
     }
    ]
   })
   bytes = await Packer.toBuffer(doc)
  } else if (format === 'svg') {
   const records = z
    .array(
     z.object({
      cue: z.number(),
      quote: z.string(),
      point: z.string().max(600),
      topic: z.string().max(80),
      timestamp: z.string()
     })
    )
    .max(20000)
    .parse(JSON.parse(await readFile(source.replace(/\.md$/i, '.json'), 'utf8')))
   bytes = Buffer.from(notesSvg(title, records), 'utf8')
  } else {
   const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
   const print = new BrowserWindow({
    show: false,
    webPreferences: {nodeIntegration: false, contextIsolation: true, sandbox: true}
   })
   try {
    await print.loadURL(
     'data:text/html;charset=utf-8,' +
      encodeURIComponent(
       `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>body{font:12pt 'Microsoft YaHei',sans-serif;line-height:1.7;padding:24px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}</style><pre>${escape(text)}</pre>`
      )
    )
    bytes = await print.webContents.printToPDF({printBackground: true, pageSize: 'A4'})
   } finally {
    print.destroy()
   }
  }
  await writeFile(path, bytes)
  if (!(await readFile(path)).equals(bytes)) throw new Error('笔记导出校验失败')
  return path
 } catch (error) {
  await rm(path, {force: true})
  throw error
 }
}
