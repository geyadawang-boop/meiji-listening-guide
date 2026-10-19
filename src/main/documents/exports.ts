import {BrowserWindow, app} from 'electron'
import {writeFile, rm} from 'node:fs/promises'
import {Document, Packer, Paragraph, TextRun} from 'docx'
import type {LectureDetail} from '@shared/types'
import type {Course} from '@shared/types'
import {buildCourseEvidenceBundle, courseEvidenceMarkdown} from '@shared/course-evidence'
import {time} from '@shared/srt'
import {reserveFile} from '@main/library/library'
export const exportFormats = {
 subtitles: ['srt', 'txt'],
 notes: ['md', 'docx'],
 practice: ['md', 'docx', 'pdf'],
 'evidence-bundle': ['json', 'md']
} as const
export type ExportKind = keyof typeof exportFormats
export function validateExportFormat(kind: ExportKind, format: string) {
 if (!exportFormats[kind].some(candidate => candidate === format)) throw new Error('不支持的导出格式')
}
export function markdown(detail: LectureDetail, kind: 'notes' | 'practice'): string {
 const out = [`# ${detail.lecture.title} · ${kind === 'notes' ? '听课笔记' : '课后练习'}`, '']
 if (kind === 'notes') {
  if (!detail.notes) throw new Error('还没有听课笔记')
  const groups = [
   ['教师明确重点', detail.notes.keyPoints],
   ['明确不考', detail.notes.notTested],
   ['表态含糊', detail.notes.uncertain || []]
  ] as const
  for (const [title, points] of groups) {
   out.push(`## ${title}`, '')
   for (const p of points)
    out.push(
     `### ${'level' in p ? `[${p.level}] ` : ''}${p.topic}`,
     `${p.timestamp} · ${p.verified ? '原话已核验' : '⚠ 疑似编造或时间不符'}`,
     '',
     `> ${p.quote}`,
     '',
     'detail' in p ? p.detail : '',
     'pptRef' in p && p.pptRef ? `课件：${p.pptRef}` : '',
     ''
    )
  }
 } else {
  if (!detail.practice) throw new Error('还没有练习题')
  for (const [title, items] of [
   ['历年真题', detail.practice.past],
   ['有来源的拓展练习', detail.practice.extended],
   ['AI 自测题（非历年真题）', detail.practice.generated || []]
  ] as const) {
   out.push(`## ${title}（${items.length} 道）`, '')
   items.forEach((q, i) =>
    out.push(
     `### ${i + 1}. ${q.topic} · ${q.type}`,
     '',
     q.stem,
     '',
     `来源：${q.sourceUrl || q.sourceFile || ''}${q.year ? ' · ' + q.year : ''}`,
     `关联：${q.reason}`,
     '',
     q.answer ? `${q.aiAnswer ? 'AI 生成，仅供参考' : '参考答案'}：\n${q.answer}` : '暂无答案',
     q.answerSourceUrl ? `答案来源：${q.answerSourceUrl}` : '',
     q.explanation ? `详解（AI 辅助整理）：\n${q.explanation}` : '',
     q.attempt
      ? `我的回答：${q.attempt.response}\n判定：${q.attempt.verdict === 'correct' ? '正确' : q.attempt.verdict === 'incorrect' ? '需要再练习' : '待自查'}\n${q.attempt.feedback}`
      : '',
     ''
    )
   )
  }
  if (detail.practice.shortage) out.push(`拓展题不足 ${detail.practice.shortage} 道，未用 AI 编题冒充搜索结果。`)
 }
 return out.join('\n')
}
export async function exportFile(
 detail: LectureDetail,
 kind: ExportKind,
 format: string,
 directory: string,
 course?: Course
) {
 validateExportFormat(kind, format)
 const filename = detail.lecture.title.replace(/[<>:"/\\|?*]/g, '_')
 if (kind === 'subtitles' && !detail.segments.length) throw new Error('没有字幕可导出')
 if (kind === 'evidence-bundle' && !course) throw new Error('缺少课程元信息，无法导出课程学习证据包')
 const bundle =
  kind === 'evidence-bundle'
   ? buildCourseEvidenceBundle(course!, detail, new Date().toISOString(), app.getVersion())
   : undefined
 const text =
  kind === 'subtitles'
   ? ''
   : kind === 'evidence-bundle'
     ? format === 'md'
      ? courseEvidenceMarkdown(bundle!)
      : JSON.stringify(bundle, null, 2)
     : markdown(detail, kind)
 const path = await reserveFile(directory, `${filename}-${kind}.${format}`)
 try {
  if (kind === 'subtitles') {
   await writeFile(
    path,
    format === 'srt' ? detail.srt : detail.segments.map(s => `[${time(s.start, false)}] ${s.text}`).join('\n'),
    'utf8'
   )
   return path
  }
  if (format === 'md' || format === 'json') await writeFile(path, text, 'utf8')
  else if (format === 'docx') {
   const doc = new Document({
    sections: [
     {
      properties: {},
      children: text.split('\n').map(
       line =>
        new Paragraph({
         children: [
          new TextRun({
           text: line.replace(/^#{1,3} /, ''),
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
   await writeFile(path, await Packer.toBuffer(doc))
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
       `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>body{font:12pt 'Microsoft YaHei',sans-serif;line-height:1.6;padding:24px}pre{white-space:pre-wrap;word-break:break-word;font:inherit}</style><pre>${escape(text)}</pre>`
      )
    )
    await writeFile(path, await print.webContents.printToPDF({printBackground: true, pageSize: 'A4'}))
   } finally {
    print.destroy()
   }
  }
  return path
 } catch (error) {
  await rm(path, {force: true})
  throw error
 }
}
