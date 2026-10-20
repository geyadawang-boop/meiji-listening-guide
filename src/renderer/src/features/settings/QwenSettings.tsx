import {Button, Input} from '@heroui/react'
import {useEffect, useState} from 'react'
import {SelectField} from '@renderer/ui/SelectField'
import {notify} from '@renderer/ui/ToastHost'
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
const jobRunning = (error: unknown) => /当前已有任务运行/.test(error instanceof Error ? error.message : String(error))
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
 const [notice, setNotice] = useState(''),
  [manualText, setManualText] = useState(''),
  [manualVision, setManualVision] = useState(''),
  [reading, setReading] = useState(false),
  [testing, setTesting] = useState(false),
  [attempt, setAttempt] = useState(0),
  [probeAttempt, setProbeAttempt] = useState(0),
  [available, setAvailable] = useState<boolean | null>(null)
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
 const disabled = busy || reading,
  hasKey = !!(profile.apiKey?.trim() || profile.hasKey),
  unavailable = available !== true,
  textPlaceholder = reading ? '正在读取可用模型…' : unavailable ? '暂无可用的文本模型' : '请选择文本模型',
  visionPlaceholder = reading ? '正在读取可用模型…' : unavailable ? '暂无可用的视觉模型' : '请选择视觉模型'
 // 自动读取可用模型：进入页面、地址或密钥变化时重新读取；失败即视为 API 不可用。
 useEffect(() => {
  if (!hasKey) {
   setAvailable(false)
   setNotice('填写并保存通义千问 API Key 后自动读取可用模型')
   return
  }
  if (busy) return
  let cancelled = false
  const timer = setTimeout(() => {
   setReading(true)
   setNotice('正在读取可用模型…')
   void invoke<string[]>('settings:models', {profile})
    .then(models => {
     if (cancelled) return
     patch({models})
     setAvailable(true)
     setNotice(`已自动读取 ${models.length} 个可用模型`)
    })
    .catch(error => {
     if (cancelled) return
     if (jobRunning(error)) {
      setNotice('任务运行中，稍后自动重试读取模型')
      setTimeout(() => {
       if (!cancelled) setAttempt(value => value + 1)
      }, 1500)
      return
     }
     setAvailable(false)
     setNotice(error instanceof Error ? error.message : String(error))
     notify.error(error, {title: '读取可用模型失败'})
    })
    .finally(() => {
     if (!cancelled) setReading(false)
    })
  }, 700)
  return () => {
   cancelled = true
   clearTimeout(timer)
  }
 }, [profile.baseUrl, profile.apiKey, profile.hasKey, profile.id, busy, attempt])
 // 自动测试连接：读取成功后，所选文本模型或连接信息变化时静默测试。
 useEffect(() => {
  if (busy || !available || !hasKey || !profile.model) return
  let cancelled = false
  const timer = setTimeout(() => {
   setTesting(true)
   void invoke<string>('settings:probe', {profile})
    .then(reply => {
     if (!cancelled) setNotice('连接测试成功：' + reply)
    })
    .catch(error => {
     if (cancelled) return
     if (jobRunning(error)) {
      setTimeout(() => {
       if (!cancelled) setProbeAttempt(value => value + 1)
      }, 1500)
      return
     }
     setNotice('连接测试失败：' + (error instanceof Error ? error.message : String(error)))
     notify.error(error, {title: '连接测试失败'})
    })
    .finally(() => {
     if (!cancelled) setTesting(false)
    })
  }, 500)
  return () => {
   cancelled = true
   clearTimeout(timer)
  }
 }, [profile.model, profile.baseUrl, profile.apiKey, profile.hasKey, available, busy, probeAttempt])
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
    <div className="row">
     <Button
      variant="tertiary"
      size="sm"
      isDisabled={disabled}
      onClick={() => void invoke('external', {url: 'https://bailian.console.aliyun.com/'})}
     >
      获取通义千问 API Key
     </Button>
     <Button variant="primary" size="sm" isDisabled={disabled} onClick={save}>
      保存模型设置
     </Button>
    </div>
   </header>
   <label>
    API 地址
    <Input
     aria-label="通义千问 API 地址"
     disabled={disabled}
     value={profile.baseUrl}
     onChange={e => patch({baseUrl: e.target.value})}
    />
   </label>
   <label>
    通义千问 API Key
    <Input
     aria-label="通义千问 API Key"
     type="password"
     autoComplete="off"
     spellCheck={false}
     disabled={disabled}
     value={profile.apiKey || ''}
     placeholder={profile.hasKey ? '已加密保存，留空保持原密钥' : '填写通义千问 API Key'}
     onChange={e => patch({apiKey: e.target.value || undefined})}
    />
   </label>
   <label>
    文本模型
    <SelectField
     label="文本模型"
     placeholder={textPlaceholder}
     isDisabled={disabled || unavailable}
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
     placeholder={visionPlaceholder}
     isDisabled={disabled || unavailable}
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
   {(notice || testing) && (
    <p role="status" className="notice">
     {testing ? '正在自动测试连接…' : notice}
    </p>
   )}
  </div>
 )
}
