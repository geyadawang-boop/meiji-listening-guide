import type {Api} from '@main/ai/api'
import type {FileInput} from '@main/ai/api'

// Keep one active provider behind the existing workflow boundary.
export function modelRouter(select: () => Pick<Api, 'chat' | 'json'>) {
 return {
  chat(...args: Parameters<Api['chat']>) {
   return select().chat(...args)
  },
  json<T>(
   prompt: string,
   input: unknown,
   validate: (value: unknown) => T,
   signal?: AbortSignal,
   file?: FileInput,
   options?: {images?: {label: string; url: string}[]}
  ) {
   return select().json(prompt, input, validate, signal, file, options)
  }
 }
}
