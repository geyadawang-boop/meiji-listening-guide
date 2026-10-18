import {Button, Surface} from '@heroui/react'
import {useContext} from 'react'
import {IdentityContext, IdentityAvatar} from '@renderer/features/identity/Identity'
import {useEffect, useState, type ReactNode} from 'react'
import {Copy} from 'lucide-react'

// Agent message structure and waiting duration follow ElecKoi MessageBubble / ChatWaitingReply.
export function ChatMessage({
 role,
 content,
 children,
 pending = false
}: {
 role: 'user' | 'assistant'
 content: string
 children: ReactNode
 pending?: boolean
}) {
 const identity = useContext(IdentityContext)
 return (
  <article className={`message message-agent ${role === 'user' ? 'mine' : 'theirs'}`}>
   <span className="chat-avatar" aria-hidden="true">
    <IdentityAvatar role={role} />
   </span>
   <header className="chat-author">{role === 'user' ? identity.userName : identity.assistantName}</header>
   <Surface className="chat-bubble" variant="transparent">
    {children}
   </Surface>
   {!pending && (
    <div className="chat-message-actions">
     <Button
      variant="ghost"
      size="sm"
      isIconOnly
      aria-label="复制消息"
      onClick={() => void navigator.clipboard.writeText(content)}
     >
      <Copy size={16} />
     </Button>
    </div>
   )}
  </article>
 )
}
export function ChatWaitingReply({streaming}: {streaming: boolean}) {
 const [seconds, setSeconds] = useState(0)
 useEffect(() => {
  const start = Date.now(),
   timer = window.setInterval(() => setSeconds(Math.floor((Date.now() - start) / 1000)), 1000)
  return () => window.clearInterval(timer)
 }, [])
 return (
  <div className="chat-waiting-reply" role="status">
   <span className="chat-running-dot" />
   {streaming ? '正在回复' : '正在等待模型回复'}… <span>用时 {seconds} 秒</span>
  </div>
 )
}
