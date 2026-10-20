import {useEffect, useState} from 'react'
import {
 Blocks,
 CloudDownload,
 Cpu,
 GraduationCap,
 MessagesSquare,
 MonitorPlay,
 Palette,
 ScrollText,
 Search,
 Sparkles,
 UserRoundCog
} from 'lucide-react'
import {Button, Card, Input, TextArea} from '@heroui/react'
import {WindowMenuButton, WindowPanel} from '@renderer/ui/WindowPanel'
import {ThemePicker} from '@renderer/ui/ThemePicker'
import {SelectField} from '@renderer/ui/SelectField'
import {notify} from '@renderer/ui/ToastHost'
import {QwenSettings} from '@renderer/features/settings/QwenSettings'
import {CommunicationsPanel} from '@renderer/features/communications/Communications'
import {LearningMethodsPanel} from '@renderer/features/tools/LearningMethods'
import {McpToolsPanel} from '@renderer/features/tools/McpTools'
import {RuntimePanel} from '@renderer/features/tools/Runtime'
import {AppearanceEditor} from '@renderer/features/appearance/Appearance'
import {IdentityEditor} from '@renderer/features/identity/Identity'
import {BiliAccountPanel} from '@renderer/features/bilibili/BiliAccount'
import {ZhiyunLoginPanel} from '@renderer/features/zhiyun/ZhiyunLogin'
import type {SettingsSection} from '@renderer/app/settings-navigation'
import type {AppearanceState} from '@shared/appearance'
import type {Identity} from '@shared/identity'
import type {Course, Settings} from '@shared/types'

const sections: {id: SettingsSection; name: string; description: string; icon: typeof Sparkles}[] = [
 {id: 'appearance', name: '外观与主题', description: '应用主题与聊天外观', icon: Palette},
 {id: 'identity', name: '身份与角色', description: '我的资料、头像与助手角色设定', icon: UserRoundCog},
 {id: 'qwen', name: '模型服务', description: '通义千问 API、密钥与文本/视觉模型', icon: Sparkles},
 {id: 'methods', name: '学习方法', description: '固定要求、学习方法与内置工具组', icon: GraduationCap},
 {id: 'prompts', name: '提示词库', description: '各任务使用的提示词', icon: ScrollText},
 {id: 'search', name: '搜索服务', description: '题目搜索与网页搜索', icon: Search},
 {id: 'communications', name: '即时通讯', description: 'QQ / 微信连接、消息读取与回复', icon: MessagesSquare},
 {id: 'mcp', name: 'MCP 工具', description: '外部 MCP 服务连接与工具授权', icon: Blocks},
 {id: 'zhiyun', name: '智云课堂', description: '智云课堂账号登录与网页会话', icon: CloudDownload},
 {id: 'bilibili', name: 'B站', description: 'B站账号登录与收藏夹读取', icon: MonitorPlay},
 {id: 'runtime', name: '运行组件', description: '媒体、字幕等组件检查与安装', icon: Cpu}
]

const sectionGroups: {title: string; ids: SettingsSection[]}[] = [
 {title: '助手与外观', ids: ['appearance', 'identity', 'qwen', 'methods', 'prompts']},
 {title: '外部连接', ids: ['search', 'communications', 'mcp', 'zhiyun', 'bilibili']},
 {title: '系统', ids: ['runtime']}
]

const promptNames: Record<string, string> = {
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
 initialSection,
 busy,
 close,
 save,
 appearance,
 appearanceSaved,
 courses,
 courseId,
 identity,
 identitySave,
 backLabel
}: {
 visible: boolean
 initial: Settings
 initialSection?: SettingsSection
 busy: boolean
 close: () => void
 save: (settings: Settings) => Promise<boolean>
 appearance: AppearanceState
 appearanceSaved: (state: AppearanceState) => void
 courses: Course[]
 courseId: string
 identity: Identity
 identitySave: (value: Identity) => Promise<void>
 backLabel?: string
}) {
 const [value, setValue] = useState(initial),
  [section, setSection] = useState<SettingsSection>(initialSection ?? 'appearance'),
  [prompt, setPrompt] = useState('correction')
 const update = (patch: Partial<Settings>) => {
  setValue(current => ({...current, ...patch}))
 }
 useEffect(() => {
  setValue(initial)
 }, [initial])
 useEffect(() => {
  if (initialSection) setSection(initialSection)
 }, [initialSection])
 const active = sections.find(item => item.id === section)!
 return (
  <WindowPanel
   visible={visible}
   label="设置"
   title="设置"
   description="助手、外部连接与系统设置"
   heading={active.name}
   subheading={active.description}
   menu={sectionGroups.map(group => (
    <div className="window-menu-group" key={group.title}>
     <p className="window-menu-group__title">{group.title}</p>
     {group.ids.map(id => {
      const item = sections.find(section => section.id === id)!
      return (
       <WindowMenuButton
        key={item.id}
        active={section === item.id}
        icon={<item.icon aria-hidden="true" />}
        onSelect={() => {
         setSection(item.id)
        }}
       >
        {item.name}
       </WindowMenuButton>
      )
     })}
    </div>
   ))}
   actions={
    section === 'search' || section === 'prompts' ? (
     <Button
      variant="primary"
      size="sm"
      isDisabled={busy}
      onPress={() => void save(value).then(ok => ok && notify.success('设置已保存'))}
     >
      保存设置
     </Button>
    ) : null
   }
   close={close}
   backLabel={backLabel}
  >
   {section === 'search' && (
    <div className="panel-section">
     <Card className="knowledge-card">
      <h3>题目与答案搜索</h3>
      <p className="hint">Tavily 用于补充拓展题和参考解析；未配置时保留拓展题差额，参考解析改用备用搜索。</p>
      <label>
       Tavily API Key
       <Input
        type="password"
        autoComplete="off"
        value={value.searchKey || ''}
        placeholder={value.hasSearchKey ? '已加密保存；留空保持原密钥' : '未配置时显示拓展题差额'}
        onChange={event => update({searchKey: event.target.value || undefined})}
       />
      </label>
     </Card>
     <Card className="knowledge-card">
      <h3>研究网页搜索</h3>
      <p className="hint">研究中的「网页搜索（后台）」使用此服务；题目搜索仍使用上面的 Tavily。</p>
      <label>
       研究网页搜索服务
       <SelectField
        label="研究网页搜索服务"
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
     </Card>
    </div>
   )}
   {section === 'prompts' && (
    <div className="panel-section">
     <label>
      任务提示词
      <SelectField
       label="任务提示词"
       value={prompt}
       onChange={next => setPrompt(next)}
       options={[
        ...Object.keys(promptNames)
         .filter(item => item in value.prompts)
         .map(item => ({value: item, label: promptNames[item]})),
        ...Object.keys(value.prompts)
         .filter(item => item !== 'subtitles' && !(item in promptNames))
         .map(item => ({value: item, label: item}))
       ]}
      />
     </label>
     <TextArea
      className="prompt-editor"
      aria-label="提示词内容"
      value={value.prompts[prompt]}
      onChange={event => update({prompts: {...value.prompts, [prompt]: event.target.value}})}
     />
    </div>
   )}
   {section === 'qwen' && (
    <QwenSettings
     value={value}
     update={update}
     busy={busy}
     save={() => void save({...value, connection: 'qwen'}).then(ok => ok && notify.success('设置已保存'))}
    />
   )}
   {section === 'communications' && <CommunicationsPanel />}
   {section === 'methods' && <LearningMethodsPanel />}
   {section === 'mcp' && <McpToolsPanel />}
   {section === 'runtime' && <RuntimePanel />}
   {section === 'zhiyun' && (
    <div className="panel-section">
     <Card className="knowledge-card">
      <h3>智云课堂账号</h3>
      <p className="hint">登录后回到智云导入搜索课程。登录网页只在本应用的独立会话中打开，不会读取其他浏览器账号。</p>
      <ZhiyunLoginPanel />
     </Card>
    </div>
   )}
   {section === 'bilibili' && (
    <div className="panel-section">
     <Card className="knowledge-card">
      <h3>B站账号</h3>
      <p className="hint">
       登录保存在本应用的独立 B 站会话中，不读取 Chrome 或 BiliSum 的账号；只读取收藏列表，不修改 B 站收藏。
      </p>
      <BiliAccountPanel />
     </Card>
    </div>
   )}
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
