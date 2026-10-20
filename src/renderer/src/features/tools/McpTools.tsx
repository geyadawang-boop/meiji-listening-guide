import {Button, Card, Checkbox, Input} from '@heroui/react'
import {useEffect, useState} from 'react'
import {notify} from '@renderer/ui/ToastHost'
const invoke = <T,>(action: string, args?: unknown) => window.assistant.invoke<T>(action, args)
const request = <T,>(action: string, args: unknown = {}) => invoke<T>('tools:request', {action, args})
const op = () => crypto.randomUUID().replaceAll('-', '')
type Server = {
 id: string
 name: string
 endpoint: string
 enabled: boolean
 allowed_tools: string[]
 tools: {name: string; description: string; read_only_declared: boolean; input_schema: unknown}[]
}
type Overview = {mcp: {revision: number; servers: Server[]}}
export function McpToolsPanel() {
 const [data, setData] = useState<Overview>(),
  [serverName, setServerName] = useState(''),
  [endpoint, setEndpoint] = useState(''),
  [busy, setBusy] = useState(false)
 async function refresh() {
  setData(await request<Overview>('overview'))
 }
 async function run(fn: () => Promise<unknown>) {
  setBusy(true)
  try {
   await fn()
   await refresh()
  } catch (reason) {
   notify.error(reason)
  } finally {
   setBusy(false)
  }
 }
 useEffect(() => {
  void run(async () => {
   await refresh()
  })
 }, [])
 const editServer = (server: Server, allowed: string[], enabled: boolean) =>
  request('mcp-change', {
   op: op(),
   revision: data!.mcp.revision,
   change: {
    kind: 'server',
    id: server.id,
    name: server.name,
    endpoint: server.endpoint,
    allowed_tools: allowed,
    enabled
   }
  })
 return (
  <div className="panel-section">
   {data && (
    <>
     <Card className="knowledge-card">
      <p className="hint">
       接入公开 HTTPS MCP
       的只读工具。先读取清单、再勾选允许工具、最后在研究页选择本轮工具；不自动执行远端工具，不支持密钥连接。
      </p>
      <Input
       aria-label="MCP名称"
       placeholder="连接名称"
       value={serverName}
       onChange={e => setServerName(e.target.value)}
      />
      <Input
       aria-label="MCP地址"
       placeholder="https://.../mcp"
       value={endpoint}
       onChange={e => setEndpoint(e.target.value)}
      />
      <Button
       variant="tertiary"
       size="sm"
       isDisabled={busy || !serverName || !endpoint}
       onClick={() =>
        void run(async () => {
         await request('mcp-change', {
          op: op(),
          revision: data.mcp.revision,
          change: {kind: 'server', id: null, name: serverName, endpoint, enabled: false, allowed_tools: []}
         })
         setEndpoint('')
         setServerName('')
        })
       }
      >
       添加连接
      </Button>
     </Card>
     {data.mcp.servers.map(server => (
      <Card className="knowledge-card" key={server.id}>
       <h3>{server.name}</h3>
       <p>{server.endpoint}</p>
       <div className="row">
        <Button
         variant="tertiary"
         size="sm"
         isDisabled={busy}
         onClick={() => void run(() => request('mcp-discover', {op: op(), id: server.id, revision: data.mcp.revision}))}
        >
         读取工具清单
        </Button>
        <Button
         variant="tertiary"
         size="sm"
         isDisabled={busy || !server.allowed_tools.length}
         onClick={() => void run(() => editServer(server, server.allowed_tools, !server.enabled))}
        >
         {server.enabled ? '停用连接' : '启用连接'}
        </Button>
        <Button
         variant="ghost"
         size="sm"
         isDisabled={busy}
         onClick={() =>
          void run(() =>
           request('mcp-change', {op: op(), revision: data.mcp.revision, change: {kind: 'remove', id: server.id}})
          )
         }
        >
         删除连接
        </Button>
       </div>
       {server.tools.map(tool => (
        <details key={tool.name}>
         <summary>
          <Checkbox
           className="media-check"
           isSelected={server.allowed_tools.includes(tool.name)}
           isDisabled={busy || !tool.read_only_declared}
           onChange={() =>
            void run(() =>
             editServer(
              server,
              server.allowed_tools.includes(tool.name)
               ? server.allowed_tools.filter(name => name !== tool.name)
               : [...server.allowed_tools, tool.name],
              false
             )
            )
           }
          >
           <Checkbox.Content>
            <Checkbox.Control>
             <Checkbox.Indicator />
            </Checkbox.Control>
            {tool.name} · {tool.read_only_declared ? '声明只读' : '未声明只读，禁用'}
           </Checkbox.Content>
          </Checkbox>
         </summary>
         <p>{tool.description}</p>
         <pre>{JSON.stringify(tool.input_schema, null, 2)}</pre>
        </details>
       ))}
      </Card>
     ))}
    </>
   )}
  </div>
 )
}
