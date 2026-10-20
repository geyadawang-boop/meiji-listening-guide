import {KnowledgeBase} from '@renderer/features/knowledge/KnowledgeBase'
import {TaskCenter} from '@renderer/features/tasks/TaskCenter'
import {RecognitionTools} from '@renderer/features/recognition/RecognitionTools'
import {Study} from '@renderer/features/study/Study'
import {ToolsWorkbench} from '@renderer/features/tools/ToolsWorkbench'
import {learningViews, type LearningView} from '@renderer/features/video/LearningNav'
import {VideoPpt} from '@renderer/features/video/VideoPpt'
import {ZhiyunImporter} from '@renderer/features/zhiyun/ZhiyunImporter'
import type {Course} from '@shared/types'

/** 二级功能窗口：统一按 modal 状态挂载，App 只保留状态与业务回调。 */
export type AppWindowKey =
 | LearningView
 | 'study'
 | 'knowledge'
 | 'recognition'
 | 'tools'
 | 'zhiyun'
 | 'files'
 | 'tasks'
 | null

export function AppWindows({
 current,
 setModal,
 courses,
 courseId,
 courseName,
 reloadCourse,
 zhiyunImported,
 videoRestoreId,
 openVideoTask,
 clearVideoTask
}: {
 current: AppWindowKey
 setModal: (value: AppWindowKey) => void
 courses: Course[]
 courseId: string
 courseName?: string
 reloadCourse: () => Promise<unknown>
 zhiyunImported: (lectureId: string, courseId: string) => Promise<void>
 videoRestoreId: string
 openVideoTask: (id: string) => void
 clearVideoTask: () => void
}) {
 const videoVisible = learningViews.some(item => item.id === current)
 return (
  <>
   <Study visible={current === 'study'} courses={courses} close={() => setModal(null)} refresh={reloadCourse} />
   <ToolsWorkbench visible={current === 'tools'} close={() => setModal(null)} />
   <KnowledgeBase visible={current === 'knowledge'} close={() => setModal(null)} />
   <TaskCenter
    visible={current === 'tasks'}
    close={() => setModal(null)}
    open={setModal}
    restoreVideoTask={openVideoTask}
   />
   <RecognitionTools
    visible={current === 'recognition'}
    close={() => setModal(null)}
    courseId={courseId}
    courseName={courseName}
    files={() => setModal('files')}
   />
   <VideoPpt
    visible={videoVisible}
    view={videoVisible ? (current as LearningView) : 'videoPpt'}
    select={setModal}
    close={() => setModal(null)}
    courseId={courseId}
    courseName={courseName}
    restoreTaskId={videoRestoreId}
    onTaskRestored={clearVideoTask}
   />
   <ZhiyunImporter
    visible={current === 'zhiyun'}
    localCourseId={courseId}
    close={() => setModal(null)}
    imported={zhiyunImported}
   />
  </>
 )
}
