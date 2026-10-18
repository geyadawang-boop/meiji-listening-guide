import Database from 'better-sqlite3'
import {randomUUID} from 'node:crypto'
import {mkdirSync} from 'node:fs'
import {join} from 'node:path'
import type {
 ChatSession,
 Course,
 CourseFile,
 Detail,
 Lecture,
 LectureDetail,
 LectureNotes,
 Message,
 PastQuestion,
 PracticeSet,
 Segment
} from '@shared/types'
import {toSrt} from '@shared/srt'
export class Store {
 db: Database.Database
 constructor(public root: string) {
  mkdirSync(root, {recursive: true})
  this.db = new Database(join(root, 'assistant.db'))
  this.db.pragma('journal_mode = WAL')
  this.db.pragma('synchronous = FULL')
  this.db.pragma('foreign_keys = ON')
  this.db.exec(`
      CREATE TABLE IF NOT EXISTS courses(id TEXT PRIMARY KEY,name TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS study_entries(id TEXT PRIMARY KEY,json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS course_files(id TEXT PRIMARY KEY,course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,kind TEXT NOT NULL,filename TEXT,path TEXT,text TEXT,chunks_json TEXT,needs_ocr INTEGER DEFAULT 0);
      CREATE TABLE IF NOT EXISTS past_questions(id TEXT PRIMARY KEY,course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,file_id TEXT REFERENCES course_files(id) ON DELETE CASCADE,question_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS lectures(id TEXT PRIMARY KEY,course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,title TEXT,video_path TEXT,ppt_path TEXT,ppt_text TEXT,status TEXT DEFAULT '待转写',created_at TEXT DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS subtitles(lecture_id TEXT PRIMARY KEY REFERENCES lectures(id) ON DELETE CASCADE,srt_text TEXT,segments_json TEXT);
      CREATE TABLE IF NOT EXISTS correction_checkpoints(lecture_id TEXT PRIMARY KEY REFERENCES lectures(id) ON DELETE CASCADE,fingerprint TEXT NOT NULL,total INTEGER NOT NULL,segments_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS lecture_notes(lecture_id TEXT PRIMARY KEY REFERENCES lectures(id) ON DELETE CASCADE,notes_json TEXT,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS practice_sets(lecture_id TEXT PRIMARY KEY REFERENCES lectures(id) ON DELETE CASCADE,past_ids_json TEXT,extended_json TEXT,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY,course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,lecture_id TEXT REFERENCES lectures(id) ON DELETE CASCADE,role TEXT,content TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS chat_sessions(id TEXT PRIMARY KEY,course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,title TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    `)
  if (!(this.db.pragma('table_info(lectures)') as {name: string}[]).some(c => c.name === 'source_video_path'))
   this.db.exec("ALTER TABLE lectures ADD COLUMN source_video_path TEXT NOT NULL DEFAULT ''")
  for (const [name, type] of [
   ['transcript_path', "TEXT NOT NULL DEFAULT ''"],
   ['transcript_text', "TEXT NOT NULL DEFAULT ''"],
   ['time_estimated', 'INTEGER NOT NULL DEFAULT 0'],
   ['ppt_processed', 'INTEGER NOT NULL DEFAULT 0']
  ])
   if (!(this.db.pragma('table_info(lectures)') as {name: string}[]).some(c => c.name === name))
    this.db.exec(`ALTER TABLE lectures ADD COLUMN ${name} ${type}`)
  if (!(this.db.pragma('table_info(chat_sessions)') as {name: string}[]).some(c => c.name === 'lecture_id'))
   this.db.exec('ALTER TABLE chat_sessions ADD COLUMN lecture_id TEXT REFERENCES lectures(id) ON DELETE SET NULL')
  this.db.transaction(() => {
   if (!(this.db.pragma('table_info(messages)') as {name: string}[]).some(c => c.name === 'session_id'))
    this.db.exec('ALTER TABLE messages ADD COLUMN session_id TEXT REFERENCES chat_sessions(id) ON DELETE CASCADE')
   for (const c of this.courses()) {
    const session = this.sessions(c.id)[0] || this.createSession(c.id)
    this.db.prepare('UPDATE messages SET session_id=? WHERE course_id=? AND session_id IS NULL').run(session.id, c.id)
    this.renamePlaceholderSessions(c.id)
   }
  })()
 }
 courses(): Course[] {
  return this.db.prepare('SELECT * FROM courses ORDER BY created_at,id').all() as Course[]
 }
 createCourse(name: string): Course {
  if (!name.trim()) throw new Error('课程名称不能为空')
  const id = randomUUID()
  this.db.transaction(() => {
   this.db.prepare('INSERT INTO courses(id,name) VALUES(?,?)').run(id, name.trim())
   this.createSession(id)
  })()
  return this.course(id)
 }
 sessions(courseId?: string): ChatSession[] {
  return (
   courseId
    ? this.db.prepare('SELECT * FROM chat_sessions WHERE course_id=? ORDER BY rowid').all(courseId)
    : this.db.prepare('SELECT * FROM chat_sessions ORDER BY rowid').all()
  ) as ChatSession[]
 }
 private sessionName(courseId: string, base: string, ignoreId?: string) {
  const used = new Set(
   this.sessions(courseId)
    .filter(s => s.id !== ignoreId)
    .map(s => s.title)
  )
  if (!used.has(base)) return base
  let n = 2
  while (used.has(base + ' · ' + n)) n++
  return base + ' · ' + n
 }
 renamePlaceholderSessions(courseId: string, lectureId?: string) {
  const preferred = lectureId ? this.lecture(lectureId) : undefined
  if (preferred && preferred.course_id !== courseId) throw new Error('课次不属于当前课程')
  for (const s of this.sessions(courseId)) {
   if (!/^(会话 \d+|新对话(?: · \d+)?)$/.test(s.title)) continue
   const row =
    preferred ||
    (this.db
     .prepare(
      'SELECT l.* FROM messages m JOIN lectures l ON l.id=m.lecture_id WHERE m.session_id=? ORDER BY m.rowid LIMIT 1'
     )
     .get(s.id) as Lecture | undefined) ||
    (this.db.prepare('SELECT * FROM lectures WHERE course_id=? ORDER BY created_at,id LIMIT 1').get(courseId) as
     | Lecture
     | undefined)
   const name = this.sessionName(courseId, row?.title || '新对话', s.id)
   this.db.prepare('UPDATE chat_sessions SET title=?,lecture_id=? WHERE id=?').run(name, row?.id || null, s.id)
  }
 }
 createSession(courseId: string, title?: string, lectureId?: string): ChatSession {
  this.course(courseId)
  const lecture = lectureId
   ? this.lecture(lectureId)
   : (this.db.prepare('SELECT * FROM lectures WHERE course_id=? ORDER BY created_at,id LIMIT 1').get(courseId) as
      | Lecture
      | undefined)
  if (lecture && lecture.course_id !== courseId) throw new Error('课次不属于当前课程')
  const id = randomUUID(),
   name = this.sessionName(courseId, title?.trim() || lecture?.title || '新对话')
  this.db
   .prepare('INSERT INTO chat_sessions(id,course_id,title,lecture_id) VALUES(?,?,?,?)')
   .run(id, courseId, name, lecture?.id || null)
  return this.session(id, courseId)
 }
 deleteSession(courseId: string, id: string): ChatSession[] {
  this.session(id, courseId)
  this.db.transaction(() => {
   this.db.prepare('DELETE FROM chat_sessions WHERE id=? AND course_id=?').run(id, courseId)
   if (!this.sessions(courseId).length) this.createSession(courseId)
  })()
  this.db.pragma('wal_checkpoint(FULL)')
  return this.sessions(courseId)
 }
 session(id: string, courseId: string): ChatSession {
  const row = this.db.prepare('SELECT * FROM chat_sessions WHERE id=? AND course_id=?').get(id, courseId) as
   | ChatSession
   | undefined
  if (!row) throw new Error('会话不属于当前课程')
  return row
 }
 course(id: string): Course {
  const row = this.db.prepare('SELECT * FROM courses WHERE id=?').get(id) as Course | undefined
  if (!row) throw new Error('课程不存在')
  return row
 }
 detail(id: string): Detail {
  return {
   course: this.course(id),
   sessions: this.sessions(id),
   files: (
    this.db.prepare('SELECT * FROM course_files WHERE course_id=?').all(id) as (CourseFile & {chunks_json: string})[]
   ).map(f => ({...f, chunks: JSON.parse(f.chunks_json)})),
   questions: (
    this.db.prepare('SELECT question_json FROM past_questions WHERE course_id=?').all(id) as {question_json: string}[]
   ).map(q => JSON.parse(q.question_json)),
   lectures: this.db.prepare('SELECT * FROM lectures WHERE course_id=? ORDER BY created_at,id').all(id) as Lecture[],
   messages: this.db.prepare('SELECT * FROM messages WHERE course_id=? ORDER BY rowid').all(id) as Message[]
  }
 }
 insertFile(file: CourseFile) {
  this.course(file.course_id)
  this.db
   .prepare(
    'INSERT INTO course_files(id,course_id,kind,filename,path,text,chunks_json,needs_ocr) VALUES(?,?,?,?,?,?,?,?)'
   )
   .run(
    file.id,
    file.course_id,
    file.kind,
    file.filename,
    file.path,
    file.text,
    JSON.stringify(file.chunks),
    file.needs_ocr
   )
 }
 removeFile(courseId: string, id: string) {
  this.db.transaction(() => {
   this.db.prepare('DELETE FROM course_files WHERE course_id=? AND id=?').run(courseId, id)
   this.db
    .prepare('DELETE FROM practice_sets WHERE lecture_id IN (SELECT id FROM lectures WHERE course_id=?)')
    .run(courseId)
  })()
 }
 replaceQuestions(courseId: string, fileId: string, questions: PastQuestion[]) {
  if (!this.db.prepare('SELECT id FROM course_files WHERE id=? AND course_id=?').get(fileId, courseId))
   throw new Error('资料不属于当前课程')
  this.db.transaction(() => {
   this.db.prepare('DELETE FROM past_questions WHERE file_id=? AND course_id=?').run(fileId, courseId)
   const s = this.db.prepare('INSERT INTO past_questions VALUES(?,?,?,?)')
   for (const q of questions) s.run(q.id, courseId, fileId, JSON.stringify(q))
   this.db
    .prepare('DELETE FROM practice_sets WHERE lecture_id IN (SELECT id FROM lectures WHERE course_id=?)')
    .run(courseId)
  })()
 }
 saveQuestions(courseId: string, questions: PastQuestion[]) {
  const existing = this.detail(courseId).questions
  if (questions.some(q => q.courseId !== courseId || !existing.some(v => v.id === q.id)))
   throw new Error('题目不属于当前课程')
  this.db.transaction(() => {
   for (const q of existing)
    if (!questions.some(v => v.id === q.id))
     this.db.prepare('DELETE FROM past_questions WHERE id=? AND course_id=?').run(q.id, courseId)
   for (const q of questions)
    this.db
     .prepare('UPDATE past_questions SET question_json=? WHERE id=? AND course_id=?')
     .run(JSON.stringify(q), q.id, courseId)
   this.db
    .prepare('DELETE FROM practice_sets WHERE lecture_id IN (SELECT id FROM lectures WHERE course_id=?)')
    .run(courseId)
  })()
 }
 createLecture(
  courseId: string,
  title: string,
  video: string,
  ppt: string,
  pptText: string,
  sourceVideo = video
 ): Lecture {
  this.course(courseId)
  if (!title.trim()) throw new Error('请填写课次标题')
  const id = randomUUID()
  this.db
   .prepare(
    'INSERT INTO lectures(id,course_id,title,video_path,ppt_path,ppt_text,source_video_path) VALUES(?,?,?,?,?,?,?)'
   )
   .run(id, courseId, title, video, ppt, pptText, sourceVideo)
  this.renamePlaceholderSessions(courseId, id)
  return this.lecture(id)
 }
 lecture(id: string): Lecture {
  const v = this.db.prepare('SELECT * FROM lectures WHERE id=?').get(id) as Lecture | undefined
  if (!v) throw new Error('课次不存在')
  return v
 }
 lectureDetail(id: string): LectureDetail {
  const s = this.db.prepare('SELECT * FROM subtitles WHERE lecture_id=?').get(id) as
   | {srt_text: string; segments_json: string}
   | undefined
  const n = this.db.prepare('SELECT notes_json FROM lecture_notes WHERE lecture_id=?').get(id) as
   | {notes_json: string}
   | undefined
  const p = this.db.prepare('SELECT extended_json FROM practice_sets WHERE lecture_id=?').get(id) as
   | {extended_json: string}
   | undefined
  const checkpoint = this.correctionCheckpoint(id),
   segments = checkpoint?.segments || (s ? JSON.parse(s.segments_json) : [])
  return {
   lecture: this.lecture(id),
   segments,
   srt: checkpoint ? toSrt(segments) : s?.srt_text || '',
   notes: n ? JSON.parse(n.notes_json) : null,
   practice: p ? JSON.parse(p.extended_json) : null,
   ...(checkpoint ? {correction: {completed: segments.length, total: checkpoint.total}} : {})
  }
 }
 status(id: string, status: string) {
  this.lecture(id)
  this.db.prepare('UPDATE lectures SET status=? WHERE id=?').run(status, id)
 }
 correctionCheckpoint(id: string) {
  const row = this.db
   .prepare('SELECT fingerprint,total,segments_json FROM correction_checkpoints WHERE lecture_id=?')
   .get(id) as {fingerprint: string; total: number; segments_json: string} | undefined
  return row
   ? {fingerprint: row.fingerprint, total: row.total, segments: JSON.parse(row.segments_json) as Segment[]}
   : undefined
 }
 saveCorrectionBatch(id: string, fingerprint: string, total: number, segments: Segment[]) {
  this.db.transaction(() => {
   this.db
    .prepare('INSERT OR REPLACE INTO correction_checkpoints VALUES(?,?,?,?)')
    .run(id, fingerprint, total, JSON.stringify(segments))
   this.db.prepare('DELETE FROM lecture_notes WHERE lecture_id=?').run(id)
   this.db.prepare('DELETE FROM practice_sets WHERE lecture_id=?').run(id)
   this.status(id, `校订中（已保存 ${segments.length}/${total} 条）`)
  })()
  this.db.pragma('wal_checkpoint(FULL)')
 }
 saveSubtitles(id: string, segments: Segment[]) {
  this.lecture(id)
  this.db.transaction(() => {
   this.db.prepare('INSERT OR REPLACE INTO subtitles VALUES(?,?,?)').run(id, toSrt(segments), JSON.stringify(segments))
   this.db.prepare('DELETE FROM correction_checkpoints WHERE lecture_id=?').run(id)
   this.db.prepare('DELETE FROM lecture_notes WHERE lecture_id=?').run(id)
   this.db.prepare('DELETE FROM practice_sets WHERE lecture_id=?').run(id)
   this.status(id, '字幕完成')
  })()
 }
 saveNotes(id: string, notes: LectureNotes) {
  this.lecture(id)
  this.db.transaction(() => {
   this.db
    .prepare('INSERT OR REPLACE INTO lecture_notes(lecture_id,notes_json) VALUES(?,?)')
    .run(id, JSON.stringify(notes))
   this.db.prepare('DELETE FROM practice_sets WHERE lecture_id=?').run(id)
  })()
 }
 savePractice(id: string, p: PracticeSet) {
  this.lecture(id)
  this.db
   .prepare('INSERT OR REPLACE INTO practice_sets(lecture_id,past_ids_json,extended_json) VALUES(?,?,?)')
   .run(id, JSON.stringify(p.past.map(q => q.id)), JSON.stringify(p))
 }
 message(courseId: string, lectureId: string | null, role: 'user' | 'assistant', content: string, sessionId?: string) {
  this.course(courseId)
  const session = sessionId
   ? this.session(sessionId, courseId)
   : this.sessions(courseId)[0] || this.createSession(courseId)
  if (lectureId && this.lecture(lectureId).course_id !== courseId) throw new Error('课次不属于当前课程')
  this.db
   .prepare('INSERT INTO messages(id,course_id,lecture_id,role,content,session_id) VALUES(?,?,?,?,?,?)')
   .run(randomUUID(), courseId, lectureId, role, content, session.id)
 }
 close() {
  this.db.pragma('wal_checkpoint(TRUNCATE)')
  this.db.close()
 }
}
