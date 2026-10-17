export const BACKEND_PROTOCOL = 1
export function backendRequest(id: number, action: string, args: unknown) {
 return {protocol: BACKEND_PROTOCOL, id, action, args}
}
export function checkProtocol(reply: {protocol?: unknown}) {
 if (reply.protocol !== undefined && reply.protocol !== BACKEND_PROTOCOL)
  throw new Error('后台协议版本不兼容，请完整更新应用')
}
