import {parseSrt, verifyNotes} from '@shared/srt'
import {z} from 'zod'
import {readFile} from 'node:fs/promises'
import {notesSchema} from '@shared/types'
import {answerChoices, compareChoices, questionOptions} from '@shared/practice'
import {prepareAnswer} from '@main/learning/practice-answer'
import {isCasualChat} from '@main/learning/chat-policy'
import {identityPrompt} from '@shared/identity'
import type {ApplicationContext} from '@main/app/context'
import type {IpcHandler} from '@main/ipc/handler'
export function createLearningHandler(
 context: Pick<
  ApplicationContext,
  | 'answerDependencies'
  | 'db'
  | 'emit'
  | 'flows'
  | 'idSchema'
  | 'identity'
  | 'job'
  | 'pick'
  | 'routed'
  | 'saveNoteFile'
  | 'testApi'
 >
): IpcHandler {
 const {answerDependencies, db, emit, flows, idSchema, identity, job, pick, routed, saveNoteFile, testApi} = context
 return {
  actions: new Set([
   'subtitles:generate',
   'subtitles:save',
   'subtitles:import',
   'notes:generate',
   'notes:save',
   'practice:generate',
   'practice:submit',
   'practice:answer',
   'practice:prepare',
   'practice:reset',
   'chat'
  ]),
  async invoke(action, object) {
   const id = () => z.string().uuid().parse(object.id),
    courseId = () => z.string().uuid().parse(object.courseId)
   switch (action) {
    case 'subtitles:generate':
     return job('lecture:' + id(), signal =>
      flows.transcribe(id(), signal, z.enum(['quality', 'balanced', 'text']).default('quality').parse(object.mode))
     )
    case 'subtitles:save':
     db.saveSubtitles(id(), parseSrt(z.string().parse(object.srt)))
     return db.lectureDetail(id())
    case 'subtitles:import': {
     const paths = await pick('srt')
     if (paths[0]) db.saveSubtitles(id(), parseSrt(await readFile(paths[0], 'utf8')))
     return db.lectureDetail(id())
    }
    case 'notes:generate':
     return job('lecture:' + id(), async signal => {
      const value = await flows.notes(id(), signal)
      await saveNoteFile(id())
      return value
     })
    case 'notes:save': {
     const value = verifyNotes(notesSchema.parse(object.notes), db.lectureDetail(id()).segments)
     db.saveNotes(id(), value)
     await saveNoteFile(id())
     return value
    }
    case 'practice:generate':
     return job('lecture:' + id(), async signal => {
      if (!db.lectureDetail(id()).notes) {
       await flows.notes(id(), signal)
       await saveNoteFile(id())
      }
      return flows.practice(id(), signal, object.withSearch === true)
     })
    case 'practice:submit': {
     const detail = db.lectureDetail(id())
     if (!detail.practice) throw new Error('还没有练习')
     const group = z.enum(['past', 'extended', 'generated']).parse(object.group),
      index = z.number().int().nonnegative().parse(object.index),
      q = detail.practice[group]?.[index]
     if (!q) throw new Error('题目不存在')
     const response = z.string().trim().min(1).max(10000).parse(object.response)
     if (!q.answer) throw new Error('请先补全已有题目的答案，再作答')
     const options = questionOptions(q.stem)
     if (!options.length) throw new Error('非选择题直接查看参考答案，无需作答')
     const correct = answerChoices(
      q.answer,
      options.map(o => o.key)
     )
     q.correctOptionKeys = correct
     const matched = compareChoices(response, correct)
     q.attempt = {
      response,
      verdict: correct.length ? (matched ? 'correct' : 'incorrect') : 'review',
      feedback: correct.length
       ? matched
        ? '选项正确。'
        : '所选选项与参考答案不一致。'
       : '参考答案未明确标出选项字母，请对照答案自查。'
     }
     db.savePractice(id(), detail.practice)
     return detail.practice
    }
    case 'practice:answer':
     return job('lecture:' + id(), async signal => {
      const detail = db.lectureDetail(id())
      if (!detail.practice) throw new Error('还没有练习')
      const group = z.enum(['past', 'extended', 'generated']).parse(object.group),
       index = z.number().int().nonnegative().parse(object.index),
       q = detail.practice[group]?.[index]
      if (!q) throw new Error('题目不存在')
      detail.practice[group]![index] = await prepareAnswer(
       q,
       db.course(detail.lecture.course_id).name,
       answerDependencies,
       signal
      )
      db.savePractice(id(), detail.practice)
      return detail.practice
     })
    case 'practice:prepare':
     return job('lecture:' + id(), async signal => {
      const detail = db.lectureDetail(id())
      if (!detail.practice) throw new Error('还没有练习')
      for (const group of ['past', 'extended', 'generated'] as const)
       for (const [index, q] of (detail.practice[group] || []).entries())
        detail.practice[group]![index] = await prepareAnswer(
         q,
         db.course(detail.lecture.course_id).name,
         answerDependencies,
         signal
        )
      db.savePractice(id(), detail.practice)
      return detail.practice
     })
    case 'practice:reset': {
     const detail = db.lectureDetail(id())
     if (!detail.practice) throw new Error('还没有练习')
     const group = z.enum(['past', 'extended', 'generated']).parse(object.group),
      index = z.number().int().nonnegative().parse(object.index),
      q = detail.practice[group]?.[index]
     if (!q) throw new Error('题目不存在')
     delete q.attempt
     db.savePractice(id(), detail.practice)
     return detail.practice
    }
    case 'chat':
     return job('chat:' + courseId(), async signal => {
      const course = db.course(courseId()),
       lectureId = object.lectureId ? idSchema.parse(object.lectureId) : null,
       lecture = lectureId ? db.lecture(lectureId) : null
      if (lecture && lecture.course_id !== course.id) throw new Error('课次不属于本课程')
      const content = z.string().min(1).max(12000).parse(object.content),
       requestId = z.string().parse(object.requestId)
      const session = object.sessionId
       ? db.session(idSchema.parse(object.sessionId), course.id)
       : db.sessions(course.id)[0]
      const casual = isCasualChat(content)
      db.message(course.id, lectureId, 'user', content, session.id)
      const messages: import('@main/ai/api').ChatMessage[] = [
        {role: 'system', content: identityPrompt(identity.get())},
        {role: 'user', content}
       ],
       stream = (text: string) => emit({kind: 'chat', requestId, text})
      const reply = await (testApi ? testApi.chat(messages, stream, signal) : routed.chat(messages, stream, signal))
      db.message(course.id, lectureId, 'assistant', reply, session.id)
      return reply
     })
    default:
     throw new Error('未知操作')
   }
  }
 }
}
