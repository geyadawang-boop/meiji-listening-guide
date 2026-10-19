import {Button, Input} from '@heroui/react'
import {useEffect, useState} from 'react'
import {SelectField} from '@renderer/ui/SelectField'
import type {Profile, Settings} from '@shared/types'
const invoke = <T,>(action: string, args?: unknown) => window.assistant.invoke<T>(action, args)
const fallback: Profile = {
 id: 'qwen-default',
 name: '通义千问',
 provider: 'qwen',
 baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
 model: '',
 visionModel: '',
 apiFormat: 'chat_completions',
 models: []
}
export function QwenSettings({
 value,
 update,
 save,
 busy
}: {
 value: Settings
 update: (patch: Partial<Settings>) => void
 save: () => void
 busy: boolean
}) {
 const [pending, setPending] = useState(false),
  [notice, setNotice] = useState(''),
  [manualText, setManualText] = useState(''),
  [manualVision, setManualVision] = useState('')
 const profile = value.profiles.find(p => p.id === value.activeProfile) || value.profiles[0] || fallback
 useEffect(() => {
  if (!value.profiles.length) update({profiles: [fallback], activeProfile: fallback.id, connection: 'qwen'})
 }, [])
 const patch = (fields: Partial<Profile>) =>
  update({
   connection: 'qwen',
   activeProfile: profile.id,
   profiles: [{...profile, ...fields, provider: 'qwen', apiFormat: 'chat_completions'}]
  })
 const disabled = busy || pending,
  hasKey = !!(profile.apiKey?.trim() || profile.hasKey)
 async function run(fn: () => Promise<void>) {
  setPending(true)
  setNotice('')
  try {
   await fn()
  } catch (error) {
   setNotice(error instanceof Error ? error.message : String(error))
  } finally {
   setPending(false)
  }
 }
 async function readModels() {
  await run(async () => {
   const models = await invoke<string[]>('settings:models', {profile})
   patch({models})
   setNotice(`已读取 ${models.length} 个模型。视觉识别仍使用单独选择的视觉模型。`)
  })
 }
 async function test() {
  await run(async () => setNotice('连接测试成功：' + (await invoke<string>('settings:probe', {profile}))))
 }
 const known = [...new Set(profile.models || [])]
 // VL 名称仅作候选提示，实际能力由服务商确认。
 const visionCandidates = [
  ...new Set([
   profile.visionModel || '',
   ...(profile.models || []).filter(model => /(?:^|[-_/.])vl(?:$|[-_/.\d])/i.test(model))
  ])
 ]
 return (
  <div className="panel-section">
   <header>
    <div>
     <h2>通义千问连接</h2>
     <p className="hint">模型通过 DashScope OpenAI 兼容 API 直连。旧登录凭据不会迁移到此连接。</p>
    </div>
    <div>
     <Button
      variant="tertiary"
      size="sm"
      isDisabled={disabled}
      onClick={() => void invoke('external', {url: 'https://bailian.console.aliyun.com/'})}
     >
      获取千问 API Key
     </Button>
     <Button variant="primary" size="sm" isDisabled={disabled} onClick={save}>
      保存并使用千问
     </Button>
    </div>
   </header>
   <label>
    API 地址
    <Input
     aria-label="千问 API 地址"
     disabled={disabled}
     value={profile.baseUrl}
     onChange={e => patch({baseUrl: e.target.value})}
    />
   </label>
   <label>
    千问 API Key
    <Input
     aria-label="千问 API Key"
     type="password"
     autoComplete="off"
     spellCheck={false}
     disabled={disabled}
     value={profile.apiKey || ''}
     placeholder={profile.hasKey ? '已加密保存，留空保持原密钥' : '填写千问 API Key'}
     onChange={e => patch({apiKey: e.target.value || undefined})}
    />
   </label>
   <label>
    文本模型
    <SelectField
     label="文本模型"
     placeholder="请选择文本模型"
     isDisabled={disabled}
     value={profile.model}
     onChange={next => patch({model: next})}
     options={[
      {value: '', label: '请选择文本模型'},
      ...[...new Set([profile.model, ...known])].filter(Boolean).map(model => ({value: model, label: model}))
     ]}
    />
   </label>
   <div className="row">
    <Input
     aria-label="自定义文本模型 ID"
     disabled={disabled}
     value={manualText}
     placeholder="自定义文本模型 ID"
     onChange={e => setManualText(e.target.value)}
    />
    <Button
     variant="tertiary"
     size="sm"
     isDisabled={disabled || !manualText.trim()}
     onClick={() => {
      const model = manualText.trim()
      patch({model, models: [...new Set([...(profile.models || []), model])]})
      setManualText('')
     }}
    >
     添加文本模型
    </Button>
   </div>
   <label>
    视觉模型
    <SelectField
     label="视觉模型"
     placeholder="请选择视觉模型"
     isDisabled={disabled}
     value={profile.visionModel || ''}
     onChange={next => patch({visionModel: next})}
     options={[
      {value: '', label: '请选择视觉模型'},
      ...visionCandidates.filter(Boolean).map(model => ({value: model, label: model}))
     ]}
    />
   </label>
   <div className="row">
    <Input
     aria-label="自定义视觉模型 ID"
     disabled={disabled}
     value={manualVision}
     placeholder="自定义视觉模型 ID"
     onChange={e => setManualVision(e.target.value)}
    />
    <Button
     variant="tertiary"
     size="sm"
     isDisabled={disabled || !manualVision.trim()}
     onClick={() => {
      const model = manualVision.trim()
      patch({visionModel: model, models: [...new Set([...(profile.models || []), model])]})
      setManualVision('')
     }}
    >
     添加视觉模型
    </Button>
   </div>
   <p className="hint">
    请选择服务端可用的文本模型和视觉模型。含图像的任务使用视觉模型。视觉候选按可用模型的 VL
    名称筛选，名称不保证支持图像；请核对服务商说明，也可手动填写完整
    ID。模型调用会将字幕、图片和课程资料发送到你配置的服务端。
   </p>
   <div className="toolbar">
    <Button variant="tertiary" size="sm" isDisabled={disabled || !hasKey} onClick={() => void readModels()}>
     读取可用模型
    </Button>
    <Button variant="tertiary" size="sm" isDisabled={disabled || !hasKey} onClick={() => void test()}>
     测试千问连接
    </Button>
   </div>
   {notice && (
    <p role="status" className="notice">
     {notice}
    </p>
   )}
  </div>
 )
}
