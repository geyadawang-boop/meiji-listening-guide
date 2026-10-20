import {Button} from '@heroui/react'
import type {Progress} from '@shared/types'

export function TaskStatus({
 progress,
 busy,
 onCancel
}: {
 progress: Progress | null
 busy: boolean
 onCancel: () => void
}) {
 const stage = progress?.stage || '正在处理',
  message = progress?.message || '请稍等'
 return (
  <div
   aria-atomic="true"
   aria-hidden={!busy}
   aria-live="polite"
   className="task-capsule"
   data-open={busy}
   role="status"
  >
   <span className="task-capsule__dot" aria-hidden="true" />
   <span className="task-capsule__text" title={`${stage} · ${message}`}>
    <strong className="task-capsule__stage">{stage}</strong>
    {` · ${message}`}
   </span>
   <Button className="rounded-full" size="sm" variant="ghost" onClick={onCancel}>
    取消
   </Button>
  </div>
 )
}
