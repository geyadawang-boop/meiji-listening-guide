import {useState} from 'react'
import {Button} from '@heroui/react'
import {ConfirmDialog} from '@renderer/ui/ConfirmDialog'
import {SelectField} from '@renderer/ui/SelectField'
import {correctionModes, type CorrectionMode} from '@shared/correction'

export function CorrectionControls({
 lectureId,
 disabled,
 hasCheckpoint,
 hasSegments,
 run
}: {
 lectureId: string
 disabled: boolean
 hasCheckpoint: boolean
 hasSegments: boolean
 run: (mode: CorrectionMode) => void
}) {
 const [mode, setMode] = useState<CorrectionMode>(() => {
   try {
    const saved = localStorage.getItem('correction-mode:' + lectureId)
    return correctionModes.find(item => item.value === saved)?.value || 'quality'
   } catch {
    return 'quality'
   }
  }),
  [pendingMode, setPendingMode] = useState<CorrectionMode | null>(null),
  [switched, setSwitched] = useState(false)
 const modeLabel = (value: CorrectionMode) => correctionModes.find(item => item.value === value)?.label || value
 const applyMode = (next: CorrectionMode, confirmed = false) => {
  setMode(next)
  if (confirmed) setSwitched(true)
  try {
   localStorage.setItem('correction-mode:' + lectureId, next)
  } catch {
   /* Selection still works for this session. */
  }
 }
 const requestMode = (next: CorrectionMode) => {
  if (next === mode) return
  if (hasCheckpoint) {
   setPendingMode(next)
   return
  }
  applyMode(next)
 }
 const label =
  switched && hasCheckpoint
   ? '按新策略重新校订'
   : hasCheckpoint
     ? '继续校订字幕'
     : hasSegments
       ? '重新校订字幕'
       : '原文 + PPT 校订字幕'
 return (
  <div className="flex flex-col gap-2">
   <div className="flex flex-wrap items-center gap-2">
    <label className="flex items-center gap-2">
     <span className="whitespace-nowrap text-sm">字幕校订策略</span>
     <span className="inline-block w-36 shrink-0">
      <SelectField
       label="字幕校订策略"
       value={mode}
       options={correctionModes}
       isDisabled={disabled}
       onChange={value => requestMode(value as CorrectionMode)}
      />
     </span>
    </label>
    <Button
     variant="primary"
     size="sm"
     isDisabled={disabled}
     onClick={() => {
      setSwitched(false)
      run(mode)
     }}
    >
     {label}
    </Button>
   </div>
   <p className="hint">切换策略会从第一批重新校订；选项说明见下拉列表。</p>
   {pendingMode && (
    <ConfirmDialog
     title="切换校订策略？"
     confirmLabel="切换并重新校订"
     busy={disabled}
     onCancel={() => setPendingMode(null)}
     onConfirm={() => {
      applyMode(pendingMode, true)
      setPendingMode(null)
     }}
    >
     {`当前课次还有未完成断点。切换到「${modeLabel(pendingMode)}」后，下次校订会从第一批开始；新策略首批成功后旧断点会被覆盖，旧策略进度无法恢复。`}
    </ConfirmDialog>
   )}
  </div>
 )
}
