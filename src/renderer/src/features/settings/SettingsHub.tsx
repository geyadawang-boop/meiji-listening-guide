import {useEffect, useState} from 'react'
import {
 Blocks,
 Cpu,
 GraduationCap,
 MessagesSquare,
 Palette,
 ScrollText,
 Search,
 Sparkles,
 UserRoundCog
} from 'lucide-react'
import {Button, Input, TextArea} from '@heroui/react'
import {WindowMenuButton, WindowPanel} from '@renderer/ui/WindowPanel'
import {ThemePicker} from '@renderer/ui/ThemePicker'
import {SelectField} from '@renderer/ui/SelectField'
import {AlertBox} from '@renderer/ui/AlertBox'
import {QwenSettings} from '@renderer/features/settings/QwenSettings'
import {CommunicationsPanel} from '@renderer/features/communications/Communications'
import {LearningMethodsPanel} from '@renderer/features/tools/LearningMethods'
import {McpToolsPanel} from '@renderer/features/tools/McpTools'
import {RuntimePanel} from '@renderer/features/tools/Runtime'
import {AppearanceEditor} from '@renderer/features/appearance/Appearance'
import {IdentityEditor} from '@renderer/features/identity/Identity'
import type {AppearanceState} from '@shared/appearance'
import type {Identity} from '@shared/identity'
import type {Course, Settings} from '@shared/types'

export type SettingsHubSection =
 | 'qwen'
 | 'search'
 | 'communications'
 | 'methods'
 | 'mcp'
 | 'runtime'
 | 'prompts'
 | 'appearance'
 | 'identity'

const sections: {id: SettingsHubSection; name: string; description: string; icon: typeof Sparkles}[] = [
 {id: 'appearance', name: '界面与主题', description: '主题、聊天背景与字号', icon: Palette},
 {id: 'qwen', name: '通义千问', description: '模型连接、密钥与文本/视觉模型', icon: Sparkles},
 {id: 'search', name: '搜索', description: 'Tavily 密钥与默认搜索引擎', icon: Search},
 {id: 'communications', name: '通讯助手', description: 'QQ / 微信连接与自动回复', icon: MessagesSquare},
 {id: 'methods', name: '学习方法', description: '固定学习要求与方法（Skill）', icon: GraduationCap},
 {id: 'mcp', name: 'MCP 工具', description: '外部工具连接与授权', icon: Blocks},
 {id: 'runtime', name: '运行环境', description: '媒体与运行组件检查', icon: Cpu},
 {id: 'prompts', name: '提示词', description: '各任务使用的提示词', icon: ScrollText},
 {id: 'identity', name: '角色与头像', description: '名字、头像与角色设定', icon: UserRoundCog}
]

const promptNames: Record<string, string> = {
 subtitles: '旧字幕提示词',
 correction: '原文与 PPT 校订',
 notes: '教师重点',
 'past-exam': '历年卷拆题',
 match: '真题匹配',
 search: '网上题抽取',
 answer: '参考解析',
 chat: '课程追问'
}

export function SettingsHub({
 visible,
 initial,
 busy,
 error,
 close,
 save,
 appearance,
 appearanceSaved,
 courses,
 courseId,
 identity,
 identitySave
}: {
 visible: boolean
 initial: Settings
 busy: boolean
 error: string
 close: () => void
 save: (settings: Settings) => Promise<boolean>
 appearance: AppearanceState
 appearanceSaved: (state: AppearanceState) => void
 courses: Course[]
 courseId: string
 identity: Identity
 identitySave: (value: Identity) => Promise<void>
}) {
 const [value, setValue] = useState(initial),
  [section, setSection] = useState<SettingsHubSection>('appearance'),
  [prompt, setPrompt] = useState('correction'),
  [saved, setSaved] = useState(false)
 const update = (patch: Partial<Settings>) => {
  setValue(current => ({...current, ...patch}))
  setSaved(false)
 }
 useEffect(() => {
  setValue(initial)
 }, [initial])
 const active = sections.find(item => item.id === section)!
 return (
  <WindowPanel
   visible={visible}
   label="设置"
   title="设置"
   description="模型、搜索、通讯、外观与角色"
   heading={active.name}
   subheading={active.description}
   menu={sections.map(item => (
    <WindowMenuButton
     key={item.id}
     active={section === item.id}
     icon={<item.icon aria-hidden="true" />}
     onSelect={() => {
      setSection(item.id)
      setSaved(false)
     }}
    >
     {item.name}
    </WindowMenuButton>
   ))}
   actions={
    section === 'search' || section === 'prompts' ? (
     <Button variant="primary" size="sm" isDisabled={busy} onPress={() => void save(value).then(ok => setSaved(ok))}>
      保存设置
     </Button>
    ) : null
   }
   close={close}
  >
   {error && <AlertBox>{error}</AlertBox>}
   {section === 'search' && (
    <div className="panel-section">
     <label>
      Tavily 搜索 API Key
      <Input
       type="password"
       autoComplete="off"
       value={value.searchKey || ''}
       placeholder={value.hasSearchKey ? '已加密保存；留空保持原密钥' : '未配置时显示拓展题差额'}
       onChange={event => update({searchKey: event.target.value || undefined})}
      />
     </label>
     <label>
      默认搜索服务
      <SelectField
       label="默认搜索服务"
       value={value.searchProvider ?? 'duckduckgo'}
       onChange={next => update({searchProvider: next === 'searxng' ? 'searxng' : 'duckduckgo'})}
       options={[
        {value: 'duckduckgo', label: 'DuckDuckGo'},
        {value: 'searxng', label: 'SearXNG'}
       ]}
      />
     </label>
     {value.searchProvider === 'searxng' && (
      <label>
       SearXNG 实例地址
       <Input
        aria-label="SearXNG 实例地址"
        placeholder="公开 HTTPS 实例地址"
        value={value.searchEndpoint || ''}
        onChange={event => update({searchEndpoint: event.target.value})}
       />
      </label>
     )}
     {saved && (
      <p className="hint" role="status">
       已保存
      </p>
     )}
    </div>
   )}
   {section === 'prompts' && (
    <div className="panel-section">
     <label>
      提示词
      <SelectField
       label="提示词"
       value={prompt}
       onChange={next => setPrompt(next)}
       options={Object.keys(value.prompts)
        .filter(item => item !== 'subtitles')
        .map(item => ({value: item, label: promptNames[item] || item}))}
      />
     </label>
     <TextArea
      className="prompt-editor"
      aria-label="提示词内容"
      value={value.prompts[prompt]}
      onChange={event => update({prompts: {...value.prompts, [prompt]: event.target.value}})}
     />
     {saved && (
      <p className="hint" role="status">
       已保存
      </p>
     )}
    </div>
   )}
   {section === 'qwen' && (
    <QwenSettings
     value={value}
     update={update}
     busy={busy}
     save={() => void save({...value, connection: 'qwen'}).then(ok => setSaved(ok))}
    />
   )}
   {section === 'communications' && <CommunicationsPanel />}
   {section === 'methods' && <LearningMethodsPanel />}
   {section === 'mcp' && <McpToolsPanel />}
   {section === 'runtime' && <RuntimePanel />}
   {section === 'appearance' && (
    <>
     <div className="panel-section theme-section">
      <strong>主题</strong>
      <ThemePicker
       value={value.theme}
       onChange={next => {
        update({theme: next})
        void save({...value, theme: next})
       }}
      />
      <p className="hint">跟随系统会自动匹配电脑的浅色 / 深色外观。</p>
     </div>
     <AppearanceEditor
      embedded
      initial={appearance}
      courseId={courseId}
      courses={courses}
      close={close}
      saved={appearanceSaved}
     />
    </>
   )}
   {section === 'identity' && <IdentityEditor embedded initial={identity} close={close} save={identitySave} />}
  </WindowPanel>
 )
}
