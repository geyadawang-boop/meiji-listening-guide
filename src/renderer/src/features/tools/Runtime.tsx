import {Card} from '@heroui/react'
import {useEffect, useState} from 'react'
import {AlertBox} from '@renderer/ui/AlertBox'
import {RuntimePanel as RuntimeComponents} from '@renderer/features/tools/RuntimePanel'
const request = <T,>(action: string, args: unknown = {}) => window.assistant.invoke<T>('tools:request', {action, args})
type Overview = {runtime: {dependencies: {id: string; label: string; state: string; version?: string}[]}}
export function RuntimePanel() {
 const [data, setData] = useState<Overview>(),
  [error, setError] = useState('')
 useEffect(() => {
  void request<Overview>('overview')
   .then(setData)
   .catch(reason => setError(reason instanceof Error ? reason.message : String(reason)))
 }, [])
 return (
  <div className="panel-section">
   {error && <AlertBox>{error}</AlertBox>}
   <Card className="knowledge-card">
    <RuntimeComponents />
    <p className="hint">组件存在不代表模型已经加载或外部账号可用。</p>
    {data?.runtime.dependencies.map(item => (
     <div className="row" key={item.id}>
      <span>{item.label}</span>
      <span>
       {item.state === 'detected' ? '已找到' : item.state === 'missing' ? '当前环境未找到' : '待检查'}{' '}
       {item.version || ''}
      </span>
     </div>
    ))}
   </Card>
  </div>
 )
}
