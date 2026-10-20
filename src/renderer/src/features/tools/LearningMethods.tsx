import {Button, Card, Checkbox, Input, TextArea} from '@heroui/react'
import {useEffect, useState} from 'react'
import {notify} from '@renderer/ui/ToastHost'
const invoke = <T,>(action: string, args?: unknown) => window.assistant.invoke<T>(action, args)
const request = <T,>(action: string, args: unknown = {}) => invoke<T>('tools:request', {action, args})
const op = () => crypto.randomUUID().replaceAll('-', '')
type Skill = {id: string; name: string; description: string; body: string; enabled: boolean}
type Overview = {
 extensions: {
  revision: number
  skills: Skill[]
  standing_instructions: {enabled: boolean; body: string}
  plugins: {id: string; name: string; enabled: boolean; description: string}[]
 }
}
export function LearningMethodsPanel() {
 const [data, setData] = useState<Overview>(),
  [skillName, setSkillName] = useState(''),
  [description, setDescription] = useState(''),
  [body, setBody] = useState(''),
  [editing, setEditing] = useState<string | null>(null),
  [rules, setRules] = useState(''),
  [rulesEnabled, setRulesEnabled] = useState(false),
  [busy, setBusy] = useState(false)
 async function refresh() {
  setData(await request<Overview>('overview'))
 }
 async function run(fn: () => Promise<unknown>) {
  setBusy(true)
  try {
   await fn()
   await refresh()
  } catch (reason) {
   notify.error(reason)
  } finally {
   setBusy(false)
  }
 }
 useEffect(() => {
  void run(async () => {
   await refresh()
  })
 }, [])
 const editExtension = (change: unknown) =>
  request('extension-change', {op: op(), revision: data!.extensions.revision, change})
 return (
  <div className="panel-section">
   {data && (
    <>
     <Card className="knowledge-card">
      <h3>固定学习要求</h3>
      <Button
       variant="tertiary"
       size="sm"
       onClick={() => {
        setRules(data.extensions.standing_instructions.body)
        setRulesEnabled(data.extensions.standing_instructions.enabled)
       }}
      >
       读取已保存要求
      </Button>
      <TextArea aria-label="固定学习要求" maxLength={4000} value={rules} onChange={e => setRules(e.target.value)} />
      <Checkbox className="media-check" isSelected={rulesEnabled} onChange={setRulesEnabled}>
       <Checkbox.Content>
        <Checkbox.Control>
         <Checkbox.Indicator />
        </Checkbox.Control>
        在后续任务中启用
       </Checkbox.Content>
      </Checkbox>
      <Button
       variant="tertiary"
       size="sm"
       isDisabled={busy}
       onClick={() => void run(() => editExtension({kind: 'instructions', enabled: rulesEnabled, body: rules}))}
      >
       保存要求
      </Button>
     </Card>
     <Card className="knowledge-card">
      <h3>{editing ? '编辑学习方法' : '添加学习方法'}</h3>
      <p className="hint">可从 Skill.md 导入，或手动填写名称、说明与步骤。</p>
      <Button
       variant="tertiary"
       size="sm"
       isDisabled={busy}
       onClick={() =>
        void run(async () => {
         const value = await invoke<{name: string; description: string; body: string} | null>('tools:skill-open')
         if (value) {
          setEditing(null)
          setSkillName(value.name)
          setDescription(value.description)
          setBody(value.body)
          notify.info('方法已读入，请核对后点击保存方法')
         }
        })
       }
      >
       导入 Skill.md
      </Button>
      <Input
       aria-label="方法名称"
       placeholder="英文短名，例如 compare-sources"
       value={skillName}
       onChange={e => setSkillName(e.target.value)}
      />
      <Input
       aria-label="方法说明"
       placeholder="方法说明"
       value={description}
       onChange={e => setDescription(e.target.value)}
      />
      <TextArea
       aria-label="方法正文"
       placeholder="具体学习步骤；不会执行其中的系统命令"
       maxLength={6000}
       value={body}
       onChange={e => setBody(e.target.value)}
      />
      <Button
       variant="tertiary"
       size="sm"
       isDisabled={busy || !skillName || !description || !body}
       onClick={() =>
        void run(async () => {
         await editExtension({kind: 'skill', id: editing, name: skillName, description, body, enabled: true})
         setEditing(null)
         setBody('')
         setSkillName('')
         setDescription('')
        })
       }
      >
       保存方法
      </Button>
     </Card>
     {data.extensions.skills.map(skill => (
      <Card className="knowledge-card" key={skill.id}>
       <h3>{skill.name}</h3>
       <p>{skill.description}</p>
       <div className="row">
        <Button
         variant="tertiary"
         size="sm"
         onClick={() => {
          setEditing(skill.id)
          setSkillName(skill.name)
          setDescription(skill.description)
          setBody(skill.body)
         }}
        >
         编辑
        </Button>
        <Button
         variant="tertiary"
         size="sm"
         isDisabled={busy}
         onClick={() =>
          void run(() =>
           editExtension({
            kind: 'skill',
            id: skill.id,
            name: skill.name,
            description: skill.description,
            body: skill.body,
            enabled: !skill.enabled
           })
          )
         }
        >
         {skill.enabled ? '停用' : '启用'}
        </Button>
        <Button
         variant="ghost"
         size="sm"
         isDisabled={busy}
         onClick={() => void run(() => editExtension({kind: 'remove', id: skill.id}))}
        >
         删除方法
        </Button>
       </div>
      </Card>
     ))}
     <Card className="knowledge-card">
      <h3>内置工具组</h3>
      {data.extensions.plugins.map(plugin => (
       <Checkbox
        className="media-check"
        key={plugin.id}
        isSelected={plugin.enabled}
        isDisabled={busy}
        onChange={() => void run(() => editExtension({kind: 'plugin', id: plugin.id, enabled: !plugin.enabled}))}
       >
        <Checkbox.Content>
         <Checkbox.Control>
          <Checkbox.Indicator />
         </Checkbox.Control>
         <span>
          {plugin.name}
          <small>{plugin.description}</small>
         </span>
        </Checkbox.Content>
       </Checkbox>
      ))}
     </Card>
    </>
   )}
  </div>
 )
}
