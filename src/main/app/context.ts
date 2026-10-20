import type {BrowserWindow, Session} from 'electron'
import type {ZodString} from 'zod'
import type {EventPayload, JobState} from '@shared/types'
import type {VideoSeries} from '@shared/video-ppt'
import type {RuntimeComponents} from '@main/app/runtime-components'
import type {Store} from '@main/storage/db'
import type {AppearanceStore} from '@main/config/appearance'
import type {IdentityStore} from '@main/config/identity'
import type {SettingsStore} from '@main/config/settings'
import type {Api} from '@main/ai/api'
import type {modelRouter} from '@main/ai/model-router'
import type {KnowledgeBase} from '@main/knowledge/knowledge'
import type {MediaBackend} from '@main/media/core/media'
import type {NativeResearchBackend} from '@main/research/research'
import type {VisualTasks} from '@main/learning/video/visual'
import type {SubtitleSync, Dependencies as SubtitleSyncDependencies} from '@main/learning/subtitles/subtitle-sync'
import type {
 SubtitleDerived,
 Dependencies as SubtitleDerivedDependencies
} from '@main/learning/subtitles/subtitle-derived'
import type {BiliResources} from '@main/media/bilibili/bili-resources'
import type {BiliDiscussion} from '@main/media/bilibili/bili-discussion'
import type {PptExtractor} from '@main/documents/ppt-extract'
import type {TextbookHighlighter} from '@main/learning/study/study'
import type {VideoPpt} from '@main/learning/video/video-ppt'
import type {readBiliSubtitles} from '@main/media/bilibili/bili-subtitles'
import type {Workflows} from '@main/learning/workflows'
import type {AnswerDependencies} from '@main/learning/practice-answer'
import type {Zhiyun} from '@main/zhiyun/zhiyun'
import type {ZhiyunBrowser} from '@main/zhiyun/zhiyun-browser'

type VideoPptExport = Awaited<ReturnType<VideoPpt['export']>>
type TranscribedTask = {id: string; dir: string; video: string; name: string}
type SavedTranscription = {
 title: string
 page: number
 source: string
 warning: string
 cleanupWarning: string
 srt: string
 count: number
 savedPath: string
}
type SavedVideoPdf = {
 path: string
 kept: VideoPptExport['kept']
 removed: VideoPptExport['removed']
 cleaned: boolean
 cleanupWarning: string
}

/** 组装根注入的全部域服务与调用方回调；ipc 层只允许 Pick 自己需要的字段。 */
export type ApplicationContext = {
 runtime: RuntimeComponents
 answerDependencies: AnswerDependencies
 api: Api
 appearance: AppearanceStore
 biliFixture: string | undefined
 biliDiscussion: BiliDiscussion
 biliResources: BiliResources
 biliSession: Session
 db: Store
 derivedDependencies: SubtitleDerivedDependencies
 directory: (category: 'PPT' | '语音原文' | '笔记' | '历年卷', courseId: string) => Promise<string>
 emit: (event: EventPayload) => void
 fetchBiliSubtitle: (url: string, signal: AbortSignal) => ReturnType<typeof readBiliSubtitles>
 flows: Workflows
 highlighter: TextbookHighlighter
 idSchema: ZodString
 identity: IdentityStore
 job: <T>(key: string, fn: (signal: AbortSignal) => Promise<T>) => Promise<T>
 jobs: Map<string, AbortController>
 jobState: () => JobState | null
 knowledge: KnowledgeBase
 libraryRoot: string
 media: MediaBackend
 pick: (kind: string, course?: string) => Promise<string[]>
 pptExtractor: PptExtractor
 root: string
 routed: ReturnType<typeof modelRouter>
 saveBiliSubtitle: (url: string, title: string, srt: string, selectedCourse: string | undefined) => Promise<string>
 saveNoteFile: (lectureId: string) => Promise<void>
 saveTranscribedVideo: (
  task: TranscribedTask,
  name: string,
  selectedCourse: string | undefined,
  signal: AbortSignal,
  page?: number
 ) => Promise<SavedTranscription>
 saveVideoPdf: (
  videoId: string,
  selectedCourse: string | undefined,
  choices: Parameters<VideoPpt['export']>[1],
  signal: AbortSignal
 ) => Promise<SavedVideoPdf>
 settings: SettingsStore
 subtitleDerived: SubtitleDerived
 subtitleSync: SubtitleSync
 syncDependencies: (selectedCourse: string | undefined) => SubtitleSyncDependencies
 testApi: Api | undefined
 toolsBackend: NativeResearchBackend
 videoPpt: VideoPpt
 videoProgress: (message: string) => void
 videoSeriesCache: Map<string, VideoSeries>
 visual: VisualTasks
 visualConnection: () => string
 window: BrowserWindow
 zhiyun: Zhiyun
 zhiyunBrowser: ZhiyunBrowser
}
