import {Alert, CloseButton} from '@heroui/react'
import type {ReactNode} from 'react'

/** 统一提示条：错误/警告等消息全部使用 HeroUI Alert。 */
export function AlertBox({
 children,
 status = 'danger',
 title,
 onClose
}: {
 children: ReactNode
 status?: 'default' | 'accent' | 'success' | 'warning' | 'danger'
 title?: string
 onClose?: () => void
}) {
 if (!children) return null
 return (
  <Alert className="app-alert" status={status}>
   <Alert.Indicator />
   <Alert.Content>
    {title ? <Alert.Title>{title}</Alert.Title> : null}
    <Alert.Description>{children}</Alert.Description>
   </Alert.Content>
   {onClose ? <CloseButton aria-label="关闭提示" onPress={onClose} /> : null}
  </Alert>
 )
}
