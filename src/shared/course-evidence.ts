import {createHash} from 'node:crypto'
import type {Course, LectureDetail, PracticeQuestion} from './types'

export type EvidenceStatus = 'verified' | 'uncertain' | 'unavailable'

export interface EvidenceBlock<T> {
 status: EvidenceStatus
 note: string
 contentHash?: string
 data?: T
}

type NoteItem = {
 status: EvidenceStatus
 quoteVerified: boolean
 category: string
 topic: string
 quote: string
 timestamp: string
 detail?: string
 level?: string
 pptRef?: string
}

type PracticeItem = {
 status: EvidenceStatus
 aiGenerated: boolean
 topic: string
 type: string
 stem: string
 reason: string
 source: {url?: string; file?: string; year?: string}
 answer?: string
 answerStatus: EvidenceStatus
 answerSource?: string
 answerSourceUrl?: string
 explanation?: string
 attempt?: PracticeQuestion['attempt']
}

export interface CourseEvidenceBundle {
 schemaVersion: '1.0.0'
 generatedAt: string
 revisionId: string
 producer: {name: '摘云'; version: string | null}
 verificationScope: string
 course: {id: string; name: string; createdAt: string}
 lecture: {
  id: string
  title: string
  createdAt: string
  status: string
  coverage: {
   segmentCount: number
   startMs?: number
   endMs?: number
   partial: boolean
   completed?: number
   total?: number
  }
 }
 sources: {
  transcript: EvidenceBlock<{filename?: string; textAvailable: boolean; text?: string}>
  subtitles: EvidenceBlock<{segmentCount: number; complete: boolean}>
  courseware: EvidenceBlock<{filename?: string; textAvailable: boolean; pageMarkers: number[]}>
  video: EvidenceBlock<{filename?: string; framesAvailable: false}>
 }
 evidence: {
  subtitles: EvidenceBlock<
   Array<{
    id: string
    startMs: number
    endMs: number
    text: string
    originalText?: string
    uncertainty?: {flagged: boolean; reason?: string}
    status: EvidenceStatus
   }>
  >
  notes: EvidenceBlock<{
   keyPoints: EvidenceBlock<NoteItem[]>
   notTested: EvidenceBlock<NoteItem[]>
   uncertain: EvidenceBlock<NoteItem[]>
  }>
  summary: EvidenceBlock<NoteItem[]>
  courseware: EvidenceBlock<{
   extractedText?: string
   pageIndex: Array<{page: number; locator: string}>
   noteReferences: Array<{topic: string; timestamp: string; locator: string; status: EvidenceStatus}>
   ocr: EvidenceBlock<never[]>
  }>
  frames: EvidenceBlock<never[]>
  knowledgeBase: EvidenceBlock<never[]>
  practice: EvidenceBlock<{
   past: EvidenceBlock<PracticeItem[]>
   extended: EvidenceBlock<PracticeItem[]>
   generated: EvidenceBlock<PracticeItem[]>
   shortage: number
  }>
 }
}

const hash = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex')
const filename = (path: string) => path.replace(/\\/g, '/').split('/').at(-1) || undefined
const statusForNotes = (items: {verified?: boolean}[] | undefined, present: boolean): EvidenceStatus => {
 if (!present || !items?.length) return 'unavailable'
 return (items || []).every(item => item.verified === true) ? 'verified' : 'uncertain'
}

function noteItems(
 items:
  | Array<{
     topic: string
     quote: string
     timestamp: string
     verified?: boolean
     detail?: string
     level?: string
     pptRef?: string
    }>
  | undefined,
 category: string
): EvidenceBlock<NoteItem[]> {
 const data = (items || []).map(item => ({
  status:
   category === '教师表态含糊'
    ? ('uncertain' as const)
    : item.verified === true
      ? ('verified' as const)
      : ('uncertain' as const),
  quoteVerified: item.verified === true,
  category,
  topic: item.topic,
  quote: item.quote,
  timestamp: item.timestamp,
  ...(item.detail ? {detail: item.detail} : {}),
  ...(item.level ? {level: item.level} : {}),
  ...(item.pptRef ? {pptRef: item.pptRef} : {})
 }))
 return {
  status: category === '教师表态含糊' && data.length ? 'uncertain' : statusForNotes(items, items !== undefined),
  note: 'verified 仅表示应用的原话/时间匹配校验通过；含糊陈述仍按其类别保留。',
  ...(data.length ? {contentHash: hash(JSON.stringify(data))} : {}),
  data
 }
}

function practiceItems(
 items: PracticeQuestion[] | undefined,
 present: boolean,
 aiGenerated = false
): EvidenceBlock<PracticeItem[]> {
 const data = (items || []).map(item => ({
  status: 'uncertain' as const,
  aiGenerated: aiGenerated || item.aiAnswer === true,
  topic: item.topic,
  type: item.type,
  stem: item.stem,
  reason: item.reason,
  source: {
   ...(item.sourceUrl ? {url: item.sourceUrl} : {}),
   ...(item.sourceFile ? {file: item.sourceFile} : {}),
   ...(item.year ? {year: item.year} : {})
  },
  ...(item.answer ? {answer: item.answer} : {}),
  answerStatus: item.answer ? ('uncertain' as const) : ('unavailable' as const),
  ...(item.answerSource ? {answerSource: item.answerSource} : item.aiAnswer ? {answerSource: 'ai'} : {}),
  ...(item.answerSourceUrl ? {answerSourceUrl: item.answerSourceUrl} : {}),
  ...(item.explanation ? {explanation: item.explanation} : {}),
  ...(item.attempt ? {attempt: item.attempt} : {})
 }))
 return {
  status: present ? (data.length ? 'uncertain' : 'unavailable') : 'unavailable',
  note: present
   ? data.length
    ? '题目来源、答案和应用内作答记录照原值导出；此包不对题目或参考答案作外部真实性背书。'
    : '练习集已保存，但当前没有题目条目。'
   : '当前课次没有已保存的练习题集。',
  ...(data.length ? {contentHash: hash(JSON.stringify(data))} : {}),
  data
 }
}

export function buildCourseEvidenceBundle(
 course: Course,
 detail: LectureDetail,
 generatedAt = new Date().toISOString(),
 producerVersion?: string
): CourseEvidenceBundle {
 const lecture = detail.lecture
 const segments = detail.segments
 const correction = detail.correction
 const partial = !!correction
 const subtitlesComplete = segments.length > 0 && !partial
 const allSegmentsTraceable =
  subtitlesComplete && segments.every(segment => !!segment.originalText && segment.uncertain === false)
 const transcriptAvailable = !!lecture.transcript_text
 const coursewareAvailable = !!lecture.ppt_text
 const pageMarkers = [...lecture.ppt_text.matchAll(/\[第\s*(\d+)\s*页\]/g)].map(match => Number(match[1]))
 const notesPresent = detail.notes !== null
 const notes = detail.notes
 const notesKeyPoints = noteItems(notes?.keyPoints, '教师明确重点')
 const notesNotTested = noteItems(notes?.notTested, '教师明确不考')
 const notesUncertain = noteItems(notes?.uncertain, '教师表态含糊')
 const subtitleData = segments.map(segment => ({
  id: hash(JSON.stringify([lecture.id, segment.start, segment.end, segment.text])).slice(0, 24),
  startMs: segment.start,
  endMs: segment.end,
  text: segment.text,
  ...(segment.originalText ? {originalText: segment.originalText} : {}),
  ...(segment.uncertain || segment.reason
   ? {uncertainty: {flagged: !!segment.uncertain, ...(segment.reason ? {reason: segment.reason} : {})}}
   : {}),
  status:
   partial || segment.uncertain !== false || !segment.originalText ? ('uncertain' as const) : ('verified' as const)
 }))
 const subtitleHash = hash(JSON.stringify(segments))
 const transcriptHash = transcriptAvailable ? hash(lecture.transcript_text) : undefined
 const coursewareHash = coursewareAvailable ? hash(lecture.ppt_text) : undefined
 const noteHash = notesPresent ? hash(JSON.stringify(notes)) : undefined
 const practice = detail.practice
 const practiceData = {
  past: practiceItems(practice?.past, !!practice),
  extended: practiceItems(practice?.extended, !!practice),
  generated: practiceItems(practice?.generated || [], !!practice, true),
  shortage: practice?.shortage || 0
 }
 const revisionId = hash(
  JSON.stringify({
   course: [course.id, course.name, course.created_at],
   lecture: [lecture.id, lecture.title, lecture.created_at, lecture.status],
   files: [
    filename(lecture.transcript_path),
    filename(lecture.ppt_path),
    filename(lecture.source_video_path || lecture.video_path)
   ],
   transcriptHash: transcriptHash || null,
   subtitleHash: segments.length ? subtitleHash : null,
   coursewareHash: coursewareHash || null,
   noteHash: noteHash || null,
   practiceHash: practice ? hash(JSON.stringify(practice)) : null,
   coverage: correction ? [correction.completed, correction.total] : null
  })
 )
 const coverage = {
  segmentCount: segments.length,
  ...(segments.length
   ? {
      startMs: segments.reduce((min, segment) => Math.min(min, segment.start), segments[0].start),
      endMs: segments.reduce((max, segment) => Math.max(max, segment.end), segments[0].end)
     }
   : {}),
  partial,
  ...(correction ? {completed: correction.completed, total: correction.total} : {})
 }
 const noteReferences = (notes?.keyPoints || [])
  .filter(point => !!point.pptRef)
  .map(point => ({
   topic: point.topic,
   timestamp: point.timestamp,
   locator: point.pptRef!,
   status: 'uncertain' as const
  }))
 const coursewareStatus: EvidenceStatus = coursewareAvailable ? 'uncertain' : 'unavailable'

 return {
  schemaVersion: '1.0.0',
  generatedAt,
  revisionId,
  producer: {name: '摘云', version: producerVersion || null},
  verificationScope:
   'verified 只表示本地应用已有的原话匹配或来源校订标记通过；不表示模型内容已由外部权威、教师或原始媒体独立证实。',
  course: {id: course.id, name: course.name, createdAt: course.created_at},
  lecture: {
   id: lecture.id,
   title: lecture.title,
   createdAt: lecture.created_at,
   status: lecture.status,
   coverage
  },
  sources: {
   transcript: {
    status: transcriptAvailable ? 'uncertain' : 'unavailable',
    note: transcriptAvailable
     ? '导出的是数据库中保存的语音识别原文；哈希针对保存的文本，不含本地文件字节。'
     : '数据库中没有保存的语音原文文本。',
    ...(transcriptHash ? {contentHash: transcriptHash} : {}),
    data: {
     ...(lecture.transcript_path ? {filename: filename(lecture.transcript_path)} : {}),
     textAvailable: transcriptAvailable,
     ...(transcriptAvailable ? {text: lecture.transcript_text} : {})
    }
   },
   subtitles: {
    status: !segments.length
     ? 'unavailable'
     : correction || !allSegmentsTraceable || segments.some(segment => segment.uncertain)
       ? 'uncertain'
       : 'verified',
    note: correction
     ? '字幕校订仍在进行；覆盖字段记录已保存片段数和总片段数，不能代表全课完整。'
     : allSegmentsTraceable
       ? '每条字幕都有原始文本对照且没有待核对标记；这只描述应用中的校订状态。'
       : '字幕来源方式或原文对照未完整保存，无法据此确认每条字幕的校订来源。',
    ...(segments.length ? {contentHash: subtitleHash} : {}),
    data: {segmentCount: segments.length, complete: subtitlesComplete}
   },
   courseware: {
    status: coursewareStatus,
    note: coursewareAvailable
     ? '包含已保存的提取文本哈希；课件文件本身不打包，且原有记录未保存逐页 OCR/置信度。'
     : lecture.ppt_path
       ? '已关联课件文件，但数据库没有可导出的提取文本。'
       : '没有关联课件。',
    ...(coursewareHash ? {contentHash: coursewareHash} : {}),
    data: {
     ...(lecture.ppt_path ? {filename: filename(lecture.ppt_path)} : {}),
     textAvailable: coursewareAvailable,
     pageMarkers
    }
   },
   video: {
    status: lecture.video_path || lecture.source_video_path ? 'uncertain' : 'unavailable',
    note: '只记录数据库中是否关联视频文件；课次数据模型未保存对应的画面识别索引。',
    data: {
     ...(lecture.source_video_path || lecture.video_path
      ? {filename: filename(lecture.source_video_path || lecture.video_path)}
      : {}),
     framesAvailable: false
    }
   }
  },
  evidence: {
   subtitles: {
    status: !segments.length
     ? 'unavailable'
     : correction || segments.some(segment => segment.uncertain) || !allSegmentsTraceable
       ? 'uncertain'
       : 'verified',
    note: correction
     ? '当前为部分校订快照，必须结合 coverage.completed/total 阅读。'
     : 'verified 表示存在原文对照且应用未标记待核对，不代表独立人工听审。',
    ...(segments.length ? {contentHash: subtitleHash} : {}),
    data: subtitleData
   },
   notes: {
    status:
     !notesPresent || [notesKeyPoints, notesNotTested, notesUncertain].every(block => block.status === 'unavailable')
      ? 'unavailable'
      : [notesKeyPoints, notesNotTested, notesUncertain].some(block => block.status === 'uncertain')
        ? 'uncertain'
        : 'verified',
    note: notesPresent
     ? '各类别保留独立状态及原句时间；verified 仅表示应用内匹配校验通过。'
     : '当前课次没有已保存的课程笔记。',
    ...(noteHash ? {contentHash: noteHash} : {}),
    data: {keyPoints: notesKeyPoints, notTested: notesNotTested, uncertain: notesUncertain}
   },
   summary: {
    status: notesKeyPoints.status,
    note: '摘要要点直接复用本节已保存的教师明确重点笔记，不另行生成视频摘要；每条保留原句时间与应用内核验状态。',
    contentHash: notesKeyPoints.contentHash,
    data: notesKeyPoints.data
   },
   courseware: {
    status: coursewareStatus,
    note: coursewareAvailable
     ? '提取文本可用，但不是逐页 OCR 核验记录；只有存储文本中已有页码标记才输出页索引。'
     : '未保存可导出的课件文字。',
    ...(coursewareHash ? {contentHash: coursewareHash} : {}),
    data: {
     ...(coursewareAvailable ? {extractedText: lecture.ppt_text} : {}),
     pageIndex: pageMarkers.map(page => ({page, locator: `[第 ${page} 页]`})),
     noteReferences,
     ocr: {status: 'unavailable', note: '当前课次数据没有可关联的 OCR 结果或置信度记录。', data: []}
    }
   },
   frames: {status: 'unavailable', note: '当前课程数据模型没有与课次关联的画面帧/哈希索引；未生成画面证据。', data: []},
   knowledgeBase: {status: 'unavailable', note: '当前课次数据没有持久化的知识库引用记录；未生成知识库引用。', data: []},
   practice: {
    status:
     !practice ||
     [practiceData.past, practiceData.extended, practiceData.generated].every(block => block.status === 'unavailable')
      ? 'unavailable'
      : 'uncertain',
    note: !practice
     ? '当前课次没有已保存的练习题集。'
     : '作答结果是应用保存的本地判定记录，不等同于教师评分；题目和答案真实性未经本导出流程独立确认。',
    ...(practice ? {contentHash: hash(JSON.stringify(practice))} : {}),
    data: practiceData
   }
  }
 }
}

const statusText: Record<EvidenceStatus, string> = {
 verified: '已核验（应用内标记）',
 uncertain: '待核对/来源不完整',
 unavailable: '不可用'
}
function codeFence(value: string): string {
 let longest = 0
 for (const match of value.matchAll(/`+/g)) longest = Math.max(longest, match[0].length)
 return '`'.repeat(Math.max(3, longest + 1))
}

export function courseEvidenceMarkdown(bundle: CourseEvidenceBundle): string {
 const lines = [
  `# ${bundle.course.name} · ${bundle.lecture.title} · 课程学习证据包`,
  '',
  `- Schema：${bundle.schemaVersion}`,
  `- 生成应用：${bundle.producer.name} ${bundle.producer.version || '版本未知'}`,
  `- 生成时间：${bundle.generatedAt}`,
  `- 课程 ID：${bundle.course.id}；创建：${bundle.course.createdAt}`,
  `- 课次 ID：${bundle.lecture.id}；创建：${bundle.lecture.createdAt}；当前状态：${bundle.lecture.status}`,
  `- 内容修订指纹：${bundle.revisionId}`,
  `- 核验范围：${bundle.verificationScope}`,
  `- 字幕覆盖：${bundle.lecture.coverage.segmentCount} 条${bundle.lecture.coverage.partial ? `，部分校订 ${bundle.lecture.coverage.completed}/${bundle.lecture.coverage.total}` : ''}`,
  ''
 ]
 const section = (title: string, block: EvidenceBlock<unknown>) =>
  lines.push(
   `## ${title} · ${statusText[block.status]}`,
   '',
   block.note,
   ...(block.contentHash ? [``, `内容 SHA-256：${block.contentHash}`] : []),
   ''
  )
 section('来源：语音原文', bundle.sources.transcript)
 if (bundle.sources.transcript.data?.filename) lines.push(`存储文件：${bundle.sources.transcript.data.filename}`, '')
 if (bundle.sources.transcript.data?.text) {
  const fence = codeFence(bundle.sources.transcript.data.text)
  lines.push('### 原始语音识别文本', '', `${fence}text`, bundle.sources.transcript.data.text, fence, '')
 }
 section('来源：字幕', bundle.sources.subtitles)
 section('来源：视频文件', bundle.sources.video)
 if (bundle.sources.video.data?.filename) lines.push(`存储文件：${bundle.sources.video.data.filename}`, '')
 section('字幕片段', bundle.evidence.subtitles)
 for (const segment of bundle.evidence.subtitles.data || []) {
  lines.push(
   `### ${segment.startMs}–${segment.endMs} ms · ${statusText[segment.status]}`,
   '',
   `片段 ID：${segment.id}`,
   '',
   segment.text,
   ''
  )
  if (segment.originalText) lines.push(`原文对照：${segment.originalText}`, '')
  if (segment.uncertainty?.reason) lines.push(`待核对原因：${segment.uncertainty.reason}`, '')
 }
 const renderNotes = (title: string, block: EvidenceBlock<NoteItem[]> | undefined) => {
  const current = block || {status: 'unavailable' as const, note: '当前课次没有已保存的课程笔记。', data: []}
  section(title, current)
  for (const item of current.data || [])
   lines.push(
    `- [${statusText[item.status]}] ${item.timestamp} · ${item.topic}: “${item.quote}”${item.level ? `（${item.level}）` : ''}${item.pptRef ? `；课件引用：${item.pptRef}` : ''}${item.detail ? `\n  ${item.detail}` : ''}`
   )
  lines.push('')
 }
 section('课程笔记', bundle.evidence.notes)
 renderNotes('教师明确重点', bundle.evidence.notes.data?.keyPoints)
 renderNotes('教师明确不考', bundle.evidence.notes.data?.notTested)
 renderNotes('教师表态含糊', bundle.evidence.notes.data?.uncertain)
 section('摘要要点（复用教师明确重点）', bundle.evidence.summary)
 for (const item of bundle.evidence.summary.data || [])
  lines.push(`- [${statusText[item.status]}] ${item.timestamp} · ${item.topic}: “${item.quote}”`)
 lines.push('')
 section('来源：课件/提取文本', bundle.sources.courseware)
 section('课件文本与页索引', bundle.evidence.courseware)
 if (bundle.sources.courseware.data?.filename) lines.push(`课件文件：${bundle.sources.courseware.data.filename}`, '')
 if (bundle.evidence.courseware.data?.pageIndex.length)
  lines.push(
   '页索引：',
   ...bundle.evidence.courseware.data.pageIndex.map(item => `- 第 ${item.page} 页：${item.locator}`),
   ''
  )
 if (bundle.evidence.courseware.data?.noteReferences.length)
  lines.push(
   '笔记中的课件引用：',
   ...bundle.evidence.courseware.data.noteReferences.map(
    item => `- ${item.topic}（${item.timestamp}）：${item.locator} · ${statusText[item.status]}`
   ),
   ''
  )
 if (bundle.evidence.courseware.data?.extractedText) {
  const fence = codeFence(bundle.evidence.courseware.data.extractedText)
  lines.push(`${fence}text`, bundle.evidence.courseware.data.extractedText, fence, '')
 }
 section('OCR', bundle.evidence.courseware.data?.ocr || {status: 'unavailable', note: '没有 OCR 记录。', data: []})
 section('视频画面索引', bundle.evidence.frames)
 section('知识库引用', bundle.evidence.knowledgeBase)
 section('练习与作答', bundle.evidence.practice)
 if (bundle.evidence.practice.data) lines.push(`练习题差额：${bundle.evidence.practice.data.shortage}`, '')
 for (const [title, block] of [
  ['历年题', bundle.evidence.practice.data?.past],
  ['拓展题', bundle.evidence.practice.data?.extended],
  ['AI 自测题', bundle.evidence.practice.data?.generated]
 ] as const) {
  lines.push(`### ${title} · ${block ? statusText[block.status] : '不可用'}`, '')
  for (const item of block?.data || []) {
   lines.push(
    `- [${statusText[item.status]}] ${item.topic} · ${item.type}`,
    `  ${item.stem}`,
    `  来源：${item.source.url || item.source.file || '未记录'}${item.source.year ? ` · ${item.source.year}` : ''}`,
    `  关联：${item.reason}`
   )
   if (item.answer) lines.push(`  参考答案（${statusText[item.answerStatus]}）：${item.answer}`)
   if (item.answerSource) lines.push(`  答案来源类型：${item.answerSource}`)
   if (item.answerSourceUrl) lines.push(`  答案来源链接：${item.answerSourceUrl}`)
   if (item.explanation) lines.push(`  解析：${item.explanation}`)
   if (item.attempt)
    lines.push(`  我的作答：${item.attempt.response}；应用内判定：${item.attempt.verdict}；${item.attempt.feedback}`)
   lines.push('')
  }
 }
 return lines.join('\n')
}
