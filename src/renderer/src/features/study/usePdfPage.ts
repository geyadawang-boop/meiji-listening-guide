import {useEffect, useRef, useState} from 'react'
import {
 getDocument,
 GlobalWorkerOptions,
 type PDFDocumentProxy,
 type PDFPageProxy,
 type PageViewport
} from 'pdfjs-dist/legacy/build/pdf.mjs'
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url'
import type {Book} from '@renderer/features/study/types'

GlobalWorkerOptions.workerSrc = workerUrl

const invoke = <T>(action: string, args?: unknown) => window.assistant.invoke<T>(action, args)

export function usePdfPage(book: Book | null, pageNumber: number, frameWidth: number, zoom: number, version = 0) {
 const canvas = useRef<HTMLCanvasElement | null>(null),
  [document, setDocument] = useState<PDFDocumentProxy | null>(null),
  [viewport, setViewport] = useState<PageViewport | null>(null),
  [size, setSize] = useState({width: 1, height: 1}),
  [rendering, setRendering] = useState(false),
  [error, setError] = useState('')

 useEffect(() => {
  if (!book) {
   setDocument(null)
   setViewport(null)
   return
  }
  let active = true,
   loading: Awaited<ReturnType<typeof getDocument>> | null = null
  const task = (async () => {
   const url = await invoke<string>('textbook:bytes', {id: book.id})
   return getDocument({
    url,
    disableAutoFetch: true,
    disableStream: true,
    rangeChunkSize: 1048576,
    canvasMaxAreaInBytes: 32000000
   })
  })()
  void task
   .then(value => {
    loading = value
    return value.promise
   })
   .then(value => {
    if (active) {
     setDocument(value)
     setError('')
    }
   })
   .catch(reason => {
    if (active) setError(reason instanceof Error ? reason.message : String(reason))
   })
  return () => {
   active = false
   if (loading) void loading.destroy()
   else void task.then(value => value.destroy()).catch(() => undefined)
  }
 }, [book?.id, version])

 useEffect(() => {
  if (!document || !canvas.current || frameWidth <= 1) return
  let active = true,
   page: PDFPageProxy | null = null,
   renderTask: ReturnType<PDFPageProxy['render']> | null = null
  setRendering(true)
  const task = (async () => {
   page = await document.getPage(pageNumber)
   if (!active) return
   const base = page.getViewport({scale: 1}),
    scale = Math.max(0.2, Math.min(4, (frameWidth * zoom) / base.width)),
    next = page.getViewport({scale}),
    target = canvas.current
   if (!target || !active) return
   const ratio = Math.min(2, window.devicePixelRatio || 1)
   target.width = Math.max(1, Math.floor(next.width * ratio))
   target.height = Math.max(1, Math.floor(next.height * ratio))
   target.style.width = `${Math.floor(next.width)}px`
   target.style.height = `${Math.floor(next.height)}px`
   const context = target.getContext('2d')
   if (!context) throw new Error('无法创建教材画布')
   renderTask = page.render({
    canvas: target,
    canvasContext: context,
    viewport: next,
    transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0]
   })
   await renderTask.promise
   if (active) {
    setViewport(next)
    setSize({width: next.width, height: next.height})
    setError('')
   }
  })()
  void task
   .catch(reason => {
    if (active && (reason as {name?: string})?.name !== 'RenderingCancelledException')
     setError(reason instanceof Error ? reason.message : String(reason))
   })
   .finally(() => {
    if (active) setRendering(false)
    page?.cleanup()
   })
  return () => {
   active = false
   renderTask?.cancel()
   page?.cleanup()
  }
 }, [document, pageNumber, frameWidth, zoom, book?.id, version])

 return {canvas, viewport, size, rendering, error}
}
