export interface IpcHandler {
 readonly actions: ReadonlySet<string>
 invoke(action: string, object: Record<string, unknown>): Promise<unknown>
}
export async function dispatch(
 handlers: readonly IpcHandler[],
 action: string,
 object: Record<string, unknown>
): Promise<unknown> {
 const handler = handlers.find(item => item.actions.has(action))
 if (!handler) throw new Error('未知操作')
 return handler.invoke(action, object)
}
