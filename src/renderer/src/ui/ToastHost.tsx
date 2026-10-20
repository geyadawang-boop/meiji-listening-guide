import {Toast, toast as heroToast} from '@heroui/react'
import type {ReactNode} from 'react'

type ToastVariant = 'default' | 'accent' | 'success' | 'warning' | 'danger'

type NotifyAction = {
 label: ReactNode
 onPress: () => void
}

export type NotifyOptions = {
 title?: ReactNode
 variant?: ToastVariant
 description?: ReactNode
 timeout?: number
 action?: NotifyAction
 indicator?: ReactNode
 key?: string
 dedupeWindow?: number
 onClose?: () => void
}

type EmitOptions = Omit<NotifyOptions, 'title'> & {isLoading?: boolean}

type PromiseMessages<T> = {
 loading: ReactNode
 success: ReactNode | ((value: T) => ReactNode)
 error?: ReactNode | ((error: unknown) => ReactNode)
}

const timeout: Record<ToastVariant, number> = {
 default: 4000,
 accent: 4000,
 success: 3000,
 warning: 5000,
 danger: 6000
}

const recent = new Map<string, {id: string; expires: number; closed: boolean}>()

/** 统一通知出口：全应用只挂载一个 Toast.Provider，业务代码通过 notify 触发。 */
export function ToastHost() {
 return <Toast.Provider placement="bottom" width={400} maxVisibleToasts={3} aria-label="通知" />
}

/** 清理 Electron IPC / Zod 包装，得到可直接展示给用户的错误文案。 */
export function errorMessage(error: unknown): string {
 let text = messageOf(error)
 for (let index = 0; index < 3; index++) {
  text = text
   .trim()
   .replace(/^Error invoking remote method\s+'[^']*':\s*/i, '')
   .replace(/^(?:Error|ZodError):\s*/i, '')
 }
 text = text.trim()
 if (!text) return '操作失败，请稍后重试'
 if (/^\[\s*\{/.test(text) && /"code"\s*:/.test(text)) return '请求参数无效，请刷新后重试'
 return text
}

function messageOf(error: unknown) {
 if (typeof error === 'string') return error
 if (error instanceof Error) return error.message
 if (error && typeof error === 'object' && 'message' in error) {
  const message = (error as {message?: unknown}).message
  if (typeof message === 'string') return message
 }
 return error == null ? '' : String(error)
}

function fingerprint(message: ReactNode) {
 return typeof message === 'string' || typeof message === 'number' ? String(message) : ''
}

function actionProps(action?: NotifyAction) {
 return action
  ? {children: action.label, onPress: action.onPress, size: 'sm' as const, variant: 'tertiary' as const}
  : undefined
}

function emit(variant: ToastVariant, message: ReactNode, options: EmitOptions = {}) {
 const dedupeWindow = options.dedupeWindow ?? 2000
 const key = options.key ?? `${variant}:${fingerprint(options.description ?? message)}`
 const now = Date.now()
 const previous = recent.get(key)
 if (previous && previous.expires > now) {
  if (!previous.closed) {
   heroToast.update(previous.id, message, {
    description: options.description,
    variant,
    timeout: options.timeout ?? timeout[variant],
    actionProps: actionProps(options.action),
    indicator: options.indicator,
    isLoading: options.isLoading,
    onClose: () => {
     previous.closed = true
     options.onClose?.()
    }
   })
   previous.expires = now + dedupeWindow
  }
  return previous.id
 }
 const entry = {id: '', expires: now + dedupeWindow, closed: false}
 const id = heroToast(message, {
  description: options.description,
  variant,
  timeout: options.timeout ?? timeout[variant],
  actionProps: actionProps(options.action),
  indicator: options.indicator,
  isLoading: options.isLoading,
  onClose: () => {
   entry.closed = true
   options.onClose?.()
  }
 })
 entry.id = id
 recent.set(key, entry)
 if (recent.size > 50) {
  for (const [current, value] of recent) if (value.expires < now) recent.delete(current)
 }
 return id
}

export const notify = {
 success(message: ReactNode, options?: NotifyOptions) {
  return emit('success', message, options)
 },
 info(message: ReactNode, options?: NotifyOptions) {
  return emit('accent', message, options)
 },
 warning(message: ReactNode, options?: NotifyOptions) {
  return emit('warning', message, options)
 },
 error(error: unknown, options: NotifyOptions = {}) {
  const {title = '操作失败', description, ...rest} = options
  return emit('danger', title, {...rest, description: description ?? errorMessage(error)})
 },
 loading(message: ReactNode, options: NotifyOptions = {}) {
  return emit('default', message, {...options, timeout: 0, isLoading: true})
 },
 update(id: string, message: ReactNode, options: NotifyOptions = {}) {
  return heroToast.update(id, message, {
   description: options.description,
   variant: options.variant,
   timeout: options.timeout,
   actionProps: actionProps(options.action),
   indicator: options.indicator,
   onClose: options.onClose
  })
 },
 dismiss(id: string) {
  heroToast.close(id)
 },
 clear() {
  heroToast.clear()
 },
 promise<T>(task: Promise<T> | (() => Promise<T>), messages: PromiseMessages<T>) {
  return heroToast.promise(task, {
   loading: messages.loading,
   success: messages.success,
   error: error =>
    messages.error
     ? typeof messages.error === 'function'
      ? messages.error(error)
      : messages.error
     : errorMessage(error)
  })
 }
}
