import {z} from 'zod'
export const questionSchema = z.object({
 id: z.string(),
 courseId: z.string(),
 sourceFile: z.string(),
 year: z.string().optional(),
 type: z.string(),
 stem: z.string().min(1),
 answer: z.string().optional(),
 knowledgePoints: z.array(z.string())
})
export const pointSchema = z.object({
 level: z.enum(['必考', '很可能考', '重要', '要求掌握']),
 topic: z.string(),
 detail: z.string(),
 quote: z.string().min(1),
 timestamp: z.string().regex(/^\d{2,}:\d{2}:\d{2}$/),
 pptRef: z.string().optional(),
 verified: z.boolean().optional()
})
const quoteSchema = pointSchema.omit({level: true, detail: true, pptRef: true})
export const notesSchema = z.object({
 keyPoints: z.array(pointSchema),
 notTested: z.array(quoteSchema),
 uncertain: z.array(quoteSchema).default([])
})
export type PastQuestion = z.infer<typeof questionSchema>
export type LectureNotes = z.infer<typeof notesSchema>
export interface Segment {
 start: number
 end: number
 text: string
 originalText?: string
 uncertain?: boolean
 reason?: string
}
export interface Course {
 id: string
 name: string
 created_at: string
}
export interface LibraryFile {
 path: string
 name: string
 category: string
 course: string
 size: number
 modified: string
}
export interface ZhiyunCourse {
 id: string
 title: string
 teacher: string
 term: string
}
export interface ZhiyunLesson {
 id: string
 title: string
 teacher: string
 videoAvailable: boolean
 videoUrl?: string
}
export interface CourseFile {
 id: string
 course_id: string
 kind: 'senior_notes' | 'past_exam'
 filename: string
 path: string
 text: string
 chunks: string[]
 needs_ocr: number
}
export interface Lecture {
 id: string
 course_id: string
 title: string
 video_path: string
 source_video_path: string
 ppt_path: string
 ppt_text: string
 transcript_path: string
 transcript_text: string
 time_estimated: number
 ppt_processed: number
 status: string
 created_at: string
}
export interface ChatSession {
 id: string
 course_id: string
 title: string
 created_at: string
 lecture_id?: string | null
}
export interface Message {
 id: string
 course_id: string
 lecture_id: string | null
 session_id: string
 role: 'user' | 'assistant'
 content: string
 created_at: string
}
export interface PracticeQuestion {
 stem: string
 type: string
 topic: string
 reason: string
 answer?: string
 explanation?: string
 answerSource?: 'imported' | 'searched' | 'ai'
 answerSourceUrl?: string
 searchStatus?: string
 correctOptionKeys?: string[]
 attempt?: {response: string; verdict: 'correct' | 'incorrect' | 'review'; feedback: string}
 sourceUrl?: string
 sourceFile?: string
 year?: string
 id?: string
 aiAnswer?: boolean
}
export interface PracticeSet {
 past: PracticeQuestion[]
 extended: PracticeQuestion[]
 generated?: PracticeQuestion[]
 shortage: number
}
export interface Profile {
 id: string
 name: string
 baseUrl: string
 model: string
 visionModel?: string
 apiFormat?: 'chat_completions' | 'responses'
 hasKey?: boolean
 keyLength?: number
 apiKey?: string
 models?: string[]
 provider?: string
 parameters?: Record<string, {temperature?: number; topP?: number; maxTokens?: number; reasoningEffort?: string}>
}
export interface Settings {
 connection?: 'qwen'
 profiles: Profile[]
 activeProfile: string
 hasSearchKey: boolean
 searchKey?: string
 searchProvider?: 'duckduckgo' | 'searxng'
 searchEndpoint?: string
 theme: 'light' | 'dark' | 'system'
 browserWidth: number
 browserOpen: boolean
 maxMinutes: number
 maxGB: number
 compress: boolean
 prompts: Record<string, string>
}
export interface Detail {
 course: Course
 files: CourseFile[]
 questions: PastQuestion[]
 lectures: Lecture[]
 messages: Message[]
 sessions: ChatSession[]
}
export interface LectureDetail {
 lecture: Lecture
 segments: Segment[]
 srt: string
 notes: LectureNotes | null
 practice: PracticeSet | null
 correction?: {completed: number; total: number}
}
export interface Progress {
 lectureId?: string
 stage: string
 message: string
 part?: number
 total?: number
 error?: boolean
}
export interface JobState {
 key: string
 lectureId?: string
 progress?: Progress
}
export type EventPayload =
 | {kind: 'progress'; data: Progress}
 | {kind: 'job'; data: {key: string; lectureId?: string; state: 'finished'; error?: string}}
 | {kind: 'chat'; requestId: string; text: string}
 | {kind: 'browser'; url: string}
 | {kind: 'window'; data: {maximized: boolean}}
 | {kind: 'video-batch'; items: import('./video-ppt.js').VideoBatchItem[]}
export interface Bridge {
 invoke<T = unknown>(action: string, args?: unknown): Promise<T>
 onEvent(callback: (event: EventPayload) => void): () => void
 filePath(file: File): string
}
declare global {
 interface Window {
  assistant: Bridge
 }
}
