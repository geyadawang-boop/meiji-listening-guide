import {Button} from '@heroui/react'
import type {ReactNode} from 'react'
import {Modal} from '@renderer/ui/UiParts'

/** 统一确认弹窗：HeroUI Modal + 官方关闭按钮 + 危险操作二次确认。 */
export function ConfirmDialog({
 title,
 children,
 confirmLabel = '删除',
 busy = false,
 onCancel,
 onConfirm
}: {
 title: string
 children: ReactNode
 confirmLabel?: string
 busy?: boolean
 onCancel: () => void
 onConfirm: () => void
}) {
 return (
  <Modal
   title={title}
   close={() => {
    if (!busy) onCancel()
   }}
  >
   <div className="confirm-body">{children}</div>
   <footer>
    <Button variant="ghost" size="sm" type="button" isDisabled={busy} onClick={onCancel}>
     取消
    </Button>
    <Button variant="danger" size="sm" type="button" isDisabled={busy} onClick={onConfirm}>
     {confirmLabel}
    </Button>
   </footer>
  </Modal>
 )
}
