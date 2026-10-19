import {Image, Scan} from 'lucide-react'
import {useState} from 'react'
import {WindowMenuButton, WindowPanel} from '@renderer/ui/WindowPanel'
import {PptExtractPanel} from '@renderer/features/ppt-extract/PptExtract'
import {VisualAnalysisPanel} from '@renderer/features/visual/VisualAnalysis'

type RecognitionView = 'ppt' | 'visual'
const views: {id: RecognitionView; title: string; description: string}[] = [
 {id: 'ppt', title: 'PPT 截取', description: '拖入图片型 PPTX，提取课件页并保存 PDF'},
 {id: 'visual', title: '画面识别', description: '文字识别、图表解释与画面摘要'}
]
const viewIcons: Record<RecognitionView, typeof Scan> = {ppt: Scan, visual: Image}

/** 识别工具：PPT 截取与画面识别共用一个窗口，左菜单切换。 */
export function RecognitionTools({
 visible,
 close,
 courseId,
 courseName,
 files
}: {
 visible: boolean
 close: () => void
 courseId: string
 courseName?: string
 files: () => void
}) {
 const [view, setView] = useState<RecognitionView>('ppt')
 const active = views.find(item => item.id === view)!
 return (
  <WindowPanel
   visible={visible}
   label="识别工具"
   title="识别工具"
   description={
    <>
     识别图片与 PPT 内容，
     <br />
     成果保存到课程资料。
    </>
   }
   heading={active.title}
   subheading={active.description}
   menu={views.map(item => {
    const Icon = viewIcons[item.id]
    return (
     <WindowMenuButton
      key={item.id}
      active={view === item.id}
      icon={<Icon aria-hidden="true" />}
      onSelect={() => setView(item.id)}
     >
      {item.title}
     </WindowMenuButton>
    )
   })}
   close={close}
  >
   <div hidden={view !== 'ppt'}>
    <PptExtractPanel visible={visible && view === 'ppt'} courseId={courseId} courseName={courseName} files={files} />
   </div>
   <div hidden={view !== 'visual'}>
    <VisualAnalysisPanel visible={visible && view === 'visual'} />
   </div>
  </WindowPanel>
 )
}
