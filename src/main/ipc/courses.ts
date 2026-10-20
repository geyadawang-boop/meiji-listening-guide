import {isAbsolute} from 'node:path'
import {z} from 'zod'
import {ensureLibrary} from '@main/library/library'
import {copyInto, importDocument, parseCourseware, serializeCoursewareSourceCache} from '@main/documents/documents'
import {questionSchema} from '@shared/types'
import {readTranscript} from '@main/documents/transcript'
import {managedFile} from '@main/library/file-manager'
import type {ApplicationContext} from '@main/app/context'
import type {IpcHandler} from '@main/ipc/handler'
export function createCoursesHandler(
 context: Pick<
  ApplicationContext,
  'db' | 'directory' | 'flows' | 'idSchema' | 'job' | 'jobs' | 'libraryRoot' | 'pick' | 'root'
 >
): IpcHandler {
 const {db, directory, flows, idSchema, job, jobs, libraryRoot, pick, root} = context
 const resolveSource = (source: string) =>
  isAbsolute(source) ? Promise.resolve(source) : managedFile(libraryRoot, source)
 return {
  actions: new Set([
   'courses',
   'lecture:delete',
   'course:delete',
   'course:create',
   'course:detail',
   'sessions',
   'session:create',
   'session:delete',
   'pick',
   'files:add',
   'files:remove',
   'questions:split',
   'questions:save',
   'lecture:create',
   'lecture:transcript',
   'lecture:courseware',
   'lecture:detail'
  ]),
  async invoke(action, object) {
   const id = () => z.string().uuid().parse(object.id),
    courseId = () => z.string().uuid().parse(object.courseId)
   switch (action) {
    case 'courses':
     return db.courses()
    case 'lecture:delete': {
     if (jobs.size) throw new Error('请等待当前任务完成后再删除课次')
     if (object.confirmed !== true) throw new Error('请先确认删除课次')
     db.lecture(id())
     db.db.transaction(() => {
      db.db.prepare('DELETE FROM messages WHERE lecture_id=?').run(id())
      db.db.prepare('DELETE FROM lectures WHERE id=?').run(id())
     })()
     db.db.pragma('wal_checkpoint(FULL)')
     return true
    }
    case 'course:delete': {
     if (jobs.size) throw new Error('请等待当前任务完成后再删除课程')
     if (object.confirmed !== true) throw new Error('请先确认删除课程')
     db.course(id())
     db.db.prepare('DELETE FROM courses WHERE id=?').run(id())
     db.db.pragma('wal_checkpoint(FULL)')
     return true
    }
    case 'course:create': {
     const course = db.createCourse(z.string().min(1).max(200).parse(object.name))
     await ensureLibrary(libraryRoot, [course.name])
     return course
    }
    case 'course:detail':
     return db.detail(id())
    case 'sessions':
     return db.sessions()
    case 'session:create': {
     const cid = courseId(),
      lecture = object.lectureId ? db.lecture(idSchema.parse(object.lectureId)) : undefined
     if (lecture && lecture.course_id !== cid) throw new Error('课次不属于当前课程')
     return db.createSession(cid, lecture?.title, lecture?.id)
    }
    case 'session:delete': {
     if (jobs.size) throw new Error('请等待当前任务完成后再删除会话')
     if (object.confirmed !== true) throw new Error('请先确认删除会话')
     return db.deleteSession(courseId(), id())
    }
    case 'pick':
     return pick(
      z.enum(['transcript', 'document', 'srt', 'courseware']).parse(object.kind),
      object.courseId ? idSchema.parse(object.courseId) : undefined
     )
    case 'files:add': {
     const course = courseId()
     db.course(course)
     const paths = z.array(z.string()).max(50).parse(object.paths),
      kind = z.enum(['senior_notes', 'past_exam']).parse(object.kind)
     const added = []
     for (const path of paths) {
      const file = await importDocument(
       root,
       course,
       kind,
       path,
       await directory(kind === 'past_exam' ? '历年卷' : '笔记', course)
      )
      db.insertFile(file)
      added.push(file)
     }
     return added
    }
    case 'files:remove':
     db.removeFile(courseId(), id())
     return true
    case 'questions:split':
     return job('exam:' + id(), signal => flows.splitExam(courseId(), id(), signal))
    case 'questions:save':
     db.saveQuestions(courseId(), questionSchema.array().parse(object.questions))
     return true
    case 'lecture:create': {
     const course = courseId()
     db.course(course)
     const transcriptInput = z.string().min(1).parse(object.transcriptPath),
      pptInput = z.string().parse(object.pptPath || ''),
      source = await resolveSource(transcriptInput),
      ppt = pptInput ? await resolveSource(pptInput) : '',
      original = await readTranscript(source)
     const parsed = ppt ? await parseCourseware(ppt) : undefined
     if (parsed?.needsOcr) throw new Error('课件是扫描 PDF，请使用 PPTX 或文字 PDF')
     const pptPath = ppt ? await copyInto(root, course, ppt, 'courseware', await directory('PPT', course)) : ''
     const pptText =
      ppt && parsed
       ? await serializeCoursewareSourceCache(pptPath, parsed.text, 'local', parsed.needsOcr, parsed.omissions)
       : ''
     const lecture = db.createLecture(course, z.string().min(1).max(200).parse(object.title), '', pptPath, pptText)
     const path = await copyInto(root, course, source, 'transcripts', await directory('语音原文', course))
     db.db
      .prepare('UPDATE lectures SET transcript_path=?,transcript_text=?,time_estimated=?,status=? WHERE id=?')
      .run(path, original.text, original.estimated ? 1 : 0, '待校订', lecture.id)
     return db.lecture(lecture.id)
    }
    case 'lecture:transcript': {
     const lecture = db.lecture(id()),
      source = await resolveSource(z.string().min(1).parse(object.path)),
      original = await readTranscript(source),
      path = await copyInto(
       root,
       lecture.course_id,
       source,
       'transcripts',
       await directory('语音原文', lecture.course_id)
      )
     db.db
      .prepare('UPDATE lectures SET transcript_path=?,transcript_text=?,time_estimated=?,status=? WHERE id=?')
      .run(path, original.text, original.estimated ? 1 : 0, '待校订', lecture.id)
     db.db.prepare('DELETE FROM correction_checkpoints WHERE lecture_id=?').run(lecture.id)
     db.db.prepare('DELETE FROM subtitles WHERE lecture_id=?').run(lecture.id)
     db.db.prepare('DELETE FROM lecture_notes WHERE lecture_id=?').run(lecture.id)
     db.db.prepare('DELETE FROM practice_sets WHERE lecture_id=?').run(lecture.id)
     return db.lectureDetail(lecture.id)
    }
    case 'lecture:courseware': {
     const lecture = db.lecture(id()),
      source = await resolveSource(z.string().min(1).parse(object.path)),
      parsed = await parseCourseware(source)
     if (parsed.needsOcr) throw new Error('课件是扫描件，需要先 OCR 为文本 PDF')
     const path = await copyInto(
      root,
      lecture.course_id,
      source,
      'courseware',
      await directory('PPT', lecture.course_id)
     )
     const cachedText = await serializeCoursewareSourceCache(
      path,
      parsed.text,
      'local',
      parsed.needsOcr,
      parsed.omissions
     )
     db.db
      .prepare('UPDATE lectures SET ppt_path=?,ppt_text=?,ppt_processed=0 WHERE id=?')
      .run(path, cachedText, lecture.id)
     db.db.prepare('DELETE FROM correction_checkpoints WHERE lecture_id=?').run(lecture.id)
     db.db.prepare('DELETE FROM subtitles WHERE lecture_id=?').run(lecture.id)
     db.db.prepare('DELETE FROM lecture_notes WHERE lecture_id=?').run(lecture.id)
     db.db.prepare('DELETE FROM practice_sets WHERE lecture_id=?').run(lecture.id)
     return db.lectureDetail(lecture.id)
    }
    case 'lecture:detail':
     return db.lectureDetail(id())
    default:
     throw new Error('未知操作')
   }
  }
 }
}
