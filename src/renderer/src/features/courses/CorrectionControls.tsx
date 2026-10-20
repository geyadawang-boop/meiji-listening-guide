import {useState} from 'react'
import {Button} from '@heroui/react'
import {SelectField} from '@renderer/ui/SelectField'
import {correctionModes, type CorrectionMode} from '@shared/correction'

export function CorrectionControls({
 lectureId,
 disabled,
 label,
 run
}: {
 lectureId: string
 disabled: boolean
 label: string
 run: (mode: CorrectionMode) => void
}) {
 const [mode, setMode] = useState<CorrectionMode>(() => {
  try {
   const saved = localStorage.getItem('correction-mode:' + lectureId)
   return correctionModes.find(item => item.value === saved)?.value || 'quality'
  } catch {
   return 'quality'
  }
 })
 return (
  <div className="flex flex-col gap-2">
   <SelectField
    label="字幕校订策略"
    value={mode}
    options={correctionModes}
    isDisabled={disabled}
    onChange={value => {
     setMode(value as CorrectionMode)
     try {
      localStorage.setItem('correction-mode:' + lectureId, value)
     } catch {
      /* Selection still works for this session. */
     }
    }}
   />
   <p className="hint">{correctionModes.find(item => item.value === mode)?.description} 切换模式会重新校订。</p>
   <Button variant="primary" size="sm" isDisabled={disabled} onClick={() => run(mode)}>
    {label}
   </Button>
  </div>
 )
}
