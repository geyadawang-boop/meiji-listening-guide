import {useContext} from 'react'
import {IdentityContext, IdentityAvatar} from './Identity'
import {useEffect, useState, type ReactNode} from 'react'
import {DshCopyIcon} from './ChatIcons'

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
   <div className="chat-bubble">{children}</div>
   {!pending && (
    <div className="chat-message-actions">
     <button title="复制" aria-label="复制消息" onClick={() => void navigator.clipboard.writeText(content)}>
      <DshCopyIcon />
     </button>
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
